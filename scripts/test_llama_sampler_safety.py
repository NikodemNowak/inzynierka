"""Compile and run completion ownership tests against installed llama.rn source.

Requires a GCC-compatible C++20 compiler (GCC or Clang); no model is downloaded.
This checks C++ resource ownership, not execution on an iPhone or the JS bridge.
"""

import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile


def source_definition(source: str, signature: str) -> str:
    # Ignore braces inside comments/strings while finding definition boundaries.
    masked = re.sub(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|//[^\n]*|/\*.*?\*/',
                    lambda match: " " * len(match.group()), source, flags=re.DOTALL)
    if source.count(signature) != 1:
        raise ValueError(f"Expected one definition of {signature}")
    location = source.index(signature)
    start = source.rfind("\n", 0, location) + 1
    opening = masked.index("{", location)
    depth = 1
    end = opening + 1
    while depth and end < len(masked):
        depth += (masked[end] == "{") - (masked[end] == "}")
        end += 1
    if depth:
        raise ValueError(f"Unclosed definition {signature}")
    return source[start:end]


def ownership_methods(source: str) -> str:
    # Compile directly from the installed dependency, not copies in the fixture.
    # Other completion methods require the complete inference engine.
    methods = []
    for name in ("llama_rn_context_completion", "~llama_rn_context_completion",
                 "initSampling", "resetSpeculative"):
        signature = "llama_rn_context_completion::" + name + "("
        methods.append(source_definition(source, signature))
    return ('#include "rn-completion.h"\n#include "rn-llama.h"\n'
            'namespace rnllama {\n' + "\n\n".join(methods) + "\n}\n")


def run_tests(source_root: Path, compiler: str, build_directory: Path) -> int:
    fixture = Path(__file__).with_name("native") / "llama_sampler_safety.cpp"
    implementation = source_root / "rn-completion.cpp"
    if not implementation.is_file():
        raise FileNotFoundError(implementation)
    build_directory.mkdir(parents=True, exist_ok=True)
    methods = build_directory / "completion-ownership.cpp"
    methods.write_text(ownership_methods(implementation.read_text(encoding="utf-8")),
                       encoding="utf-8")
    executable = build_directory / ("sampler-safety.exe" if os.name == "nt" else "sampler-safety")
    command = [
        compiler,
        "-std=c++20",
        "-O2",
        "-g",
        "-ffunction-sections",
        "-fdata-sections",
        "-I", str(source_root),
        "-I", str(source_root / "common"),
        "-I", str(source_root / "ggml-cpu"),
        str(methods),
        str(fixture),
        "-Wl,-dead_strip" if sys.platform == "darwin" else "-Wl,--gc-sections",
        "-o", str(executable),
    ]
    print(f"Testing installed C++ implementation: {implementation}", flush=True)
    subprocess.run(command, check=True)
    ownership_result = subprocess.run([str(executable)], check=False).returncode

    sampling_source = (source_root / "common" / "sampling.cpp").read_text(encoding="utf-8")
    sampling_methods = build_directory / "sampling-ownership.cpp"
    # The unmodified prefix contains the factory's includes, ring buffer and
    # private common_sampler definition; no implementation is mirrored in tests.
    factory_source = sampling_source[:sampling_source.index("std::string common_params_sampling::print()")]
    factory_source += source_definition(sampling_source, "common_sampler * common_sampler_init(")
    factory_source += "\n" + source_definition(sampling_source, "void common_sampler_free(")
    sampling_methods.write_text(factory_source, encoding="utf-8")
    prefill_fixture = fixture.with_name("llama_sampler_prefill_safety.cpp")
    prefill_executable = executable.with_name("prefill-" + executable.name)
    prefill_command = [str(sampling_methods) if argument == str(methods) else
                       str(prefill_fixture) if argument == str(fixture) else
                       str(prefill_executable) if argument == str(executable) else argument
                       for argument in command]
    print(f"Testing installed sampler factory: {source_root / 'common' / 'sampling.cpp'}", flush=True)
    subprocess.run(prefill_command, check=True)
    prefill_result = subprocess.run([str(prefill_executable)], check=False).returncode

    jsi_source = (source_root / "jsi" / "JSIParams.cpp").read_text(encoding="utf-8")
    start = jsi_source.index('std::string grammar = getPropertyAsString(runtime, params, "grammar");')
    end = jsi_source.index("std::string jsonSchema = ", start)
    provenance_fixture = fixture.with_name("llama_sampler_grammar_provenance.cpp")
    provenance_source = build_directory / "grammar-provenance.cpp"
    provenance_source.write_text(provenance_fixture.read_text(encoding="utf-8").replace(
        "// __GRAMMAR_CLASSIFICATION__", jsi_source[start:end]), encoding="utf-8")
    provenance_executable = executable.with_name("provenance-" + executable.name)
    provenance_command = [str(provenance_source) if argument == str(methods) else
                          str(provenance_executable) if argument == str(executable) else argument
                          for argument in command if argument != str(fixture)]
    print(f"Testing installed grammar classification: {source_root / 'jsi' / 'JSIParams.cpp'}", flush=True)
    subprocess.run(provenance_command, check=True)
    provenance_result = subprocess.run([str(provenance_executable)], check=False).returncode
    return 0 if all(result == 0 for result in (ownership_result, prefill_result, provenance_result)) else 1


def main() -> int:
    repository = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path,
                        default=repository / "app" / "node_modules" / "llama.rn" / "cpp")
    parser.add_argument("--cxx", default=os.environ.get("CXX") or shutil.which("g++") or "clang++")
    parser.add_argument("--build-dir", type=Path)
    arguments = parser.parse_args()
    if arguments.build_dir:
        return run_tests(arguments.source_root.resolve(), arguments.cxx, arguments.build_dir.resolve())
    with tempfile.TemporaryDirectory(prefix="notatki-sampler-test-") as directory:
        return run_tests(arguments.source_root.resolve(), arguments.cxx, Path(directory))


if __name__ == "__main__":
    raise SystemExit(main())
