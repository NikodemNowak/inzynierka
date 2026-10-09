#!/usr/bin/env python3
"""Reject an iPhone app whose ExpoModulesJSI imports cannot be resolved."""

import argparse
import json
import plistlib
import re
import subprocess
import sys
from pathlib import Path

# Expo changed a Swift getter ABI in a patch release; compilation succeeded but
# dyld aborted at launch. Compare current imports, never a fixed old symbol.
# https://github.com/expo/expo/pull/46438
SWIFT_JSI_PREFIXES = ("_$s14ExpoModulesJSI", "_$S14ExpoModulesJSI")
IMPORT_ROW = re.compile(
    r"^\s*(?:[0-9a-fA-F]+\s+)?\(undefined\)\s+"
    r"(?:weak\s+)?(?:private\s+)?external\s+(\S+)"
    r"(?:\s+\(from ([^)]+)\))?\s*$"
)


def is_header(line):
    return line.endswith(" (for architecture arm64):")


def parse_imports(output):
    result = set()
    for line in output.splitlines():
        if not line.strip() or is_header(line):
            continue
        match = IMPORT_ROW.fullmatch(line)
        if not match:
            raise ValueError(f"Unrecognized nm import output: {line}")
        symbol, provider = match.groups()
        if provider == "ExpoModulesJSI" or symbol.startswith(SWIFT_JSI_PREFIXES):
            result.add(symbol)
    return result


def parse_exports(output):
    result = set()
    for line in output.splitlines():
        if not line.strip() or is_header(line):
            continue
        symbol = line.strip()
        if not symbol.startswith("_") or re.search(r"\s", symbol):
            raise ValueError(f"Unrecognized nm export output: {line}")
        result.add(symbol)
    return result


def bundle_executable(bundle):
    with (bundle / "Info.plist").open("rb") as source:
        name = plistlib.load(source).get("CFBundleExecutable")
    if not isinstance(name, str) or not name or name in (".", "..") or "/" in name or "\\" in name:
        raise ValueError(f"Invalid CFBundleExecutable in {bundle}")
    binary = bundle / name
    if not binary.is_file():
        raise ValueError(f"Missing bundle executable: {binary}")
    return binary


def nm(binary, *options):
    # Selecting arm64 prevents another universal slice from masking a missing
    # iPhone symbol. A missing slice/tool or malformed binary is a hard failure.
    process = subprocess.run(
        ["xcrun", "nm", "-arch", "arm64", *options, str(binary)],
        capture_output=True, text=True, check=True,
    )
    if process.stderr.strip():
        raise ValueError(f"nm could not fully inspect {binary}: {process.stderr.strip()}")
    return process.stdout


def check_app(app):
    frameworks = app / "Frameworks"
    if not app.is_dir() or not frameworks.is_dir():
        raise ValueError(f"Missing app/frameworks directory: {app}")
    jsi_bundle = frameworks / "ExpoModulesJSI.framework"
    jsi = bundle_executable(jsi_bundle)
    exported = parse_exports(nm(jsi, "-gUj"))
    if not exported:
        raise ValueError("ExpoModulesJSI exports are empty")
    consumers = [bundle_executable(app)] + [
        bundle_executable(bundle) for bundle in sorted(frameworks.glob("*.framework"))
        if bundle != jsi_bundle
    ] + sorted(frameworks.glob("*.dylib"))
    required = set()
    missing = {}
    for consumer in consumers:
        imports = parse_imports(nm(consumer, "-m", "-u"))
        required.update(imports)
        if imports - exported:
            missing[str(consumer.relative_to(app))] = sorted(imports - exported)
    if not required:
        raise ValueError("No ExpoModulesJSI imports found; cannot validate this app")
    report = {"architecture": "arm64", "checkedBinaries": len(consumers),
              "checkedJSIImports": len(required), "missing": missing}
    print(json.dumps(report, indent=2))
    if missing:
        raise ValueError("ExpoModulesJSI ABI mismatch; refusing to package IPA")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", type=Path, help="Built device .app bundle")
    args = parser.parse_args()
    try:
        check_app(args.app)
    except (OSError, ValueError, plistlib.InvalidFileException, subprocess.CalledProcessError) as error:
        print(f"Expo ABI check failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
