import importlib.util
import plistlib
import tempfile
import unittest
from pathlib import Path


class ExpoAbiParserTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location(
            "expo_abi", Path(__file__).with_name("check-ios-expo-abi.py")
        )
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    def test_detects_changed_abi_without_hardcoding_the_old_symbol(self):
        old = "_$s14ExpoModulesJSI6ObjectV3getyyF"
        new = "_$s14ExpoModulesJSI6ObjectV3getyyKF"
        required = self.module.parse_imports(
            f"                 (undefined) external {old} (from ExpoModulesJSI)\n"
            "                 (undefined) external _jsi_c_bridge (from ExpoModulesJSI)\n"
            "                 (undefined) external _malloc (from libSystem)\n"
        )
        exported = self.module.parse_exports(f"{new}\n_jsi_c_bridge\n")
        self.assertEqual(required - exported, {old})
        self.assertNotIn("_malloc", required)

    def test_unknown_nm_output_fails_instead_of_ignoring_imports(self):
        with self.assertRaises(ValueError):
            self.module.parse_imports("nm: malformed object\n")
        with self.assertRaises(ValueError):
            self.module.parse_exports("nm: malformed object\n")

    def test_uses_plist_executable_instead_of_the_bundle_directory_name(self):
        with tempfile.TemporaryDirectory() as directory:
            bundle = Path(directory) / "Renamed.app"
            bundle.mkdir()
            (bundle / "Info.plist").write_bytes(
                plistlib.dumps({"CFBundleExecutable": "ActualExecutable"})
            )
            binary = bundle / "ActualExecutable"
            binary.write_bytes(b"fixture")
            self.assertEqual(self.module.bundle_executable(bundle), binary)
            binary.unlink()
            with self.assertRaises(ValueError):
                self.module.bundle_executable(bundle)


if __name__ == "__main__":
    unittest.main()
