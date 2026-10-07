import importlib.util
import json
import re
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DATAFORM = ROOT / "dataform"
BUILDER_PATH = ROOT / "scripts" / "build_dataform_root_tree.py"
CLI_PACKAGE = ROOT / "dataform-cli" / "package.json"
COMMIT = "937d3913d98509b982ad24884ee083f7e792d35b"

_spec = importlib.util.spec_from_file_location("build_dataform_root_tree", BUILDER_PATH)
builder = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(builder)


class DataformRootTreeTest(unittest.TestCase):
    def build_tree(self, source=DATAFORM):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        out = Path(directory.name) / "tree"
        builder.build(source, out, COMMIT)
        return out

    def test_settings_live_at_root_without_placeholders(self):
        tree = self.build_tree()
        settings = (tree / "workflow_settings.yaml").read_text()

        self.assertIn("defaultProject: resonate-placeholder-project", settings)
        self.assertIn("GENERATED FILE", settings)
        self.assertIn("workers/analytics-dataflow/dataform", settings)
        self.assertIn("analytics_project: resonate-placeholder-project", settings)
        self.assertIn("freshness_hours:", settings)
        for path in tree.rglob("*"):
            if path.is_file():
                self.assertIsNone(re.search(r"YOUR_[A-Z0-9_]+", path.read_text()), path)

    def test_core_version_matches_pinned_cli(self):
        tree = self.build_tree()
        settings = (tree / "workflow_settings.yaml").read_text()
        cli_version = json.loads(CLI_PACKAGE.read_text())["dependencies"]["@dataform/cli"]

        self.assertRegex(cli_version, r"^\d+\.\d+\.\d+$", "CLI must be pinned exactly")
        self.assertIn(f"dataformCoreVersion: {cli_version}\n", settings)

    def test_project_files_copied_and_sensitive_files_excluded(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "dataform"
            for relative in ("definitions/a/x.sqlx", "includes/c.js", "README.md"):
                (source / relative).parent.mkdir(parents=True, exist_ok=True)
                (source / relative).write_text("x")
            (source / "workflow_settings.yaml.example").write_text(
                "defaultProject: YOUR_DATAFORM_EXECUTION_PROJECT\n"
            )
            (source / "workflow_settings.yaml").write_text("defaultProject: real-project\n")
            (source / ".df-credentials.json").write_text("{}")
            (source / ".df-extra").write_text("x")
            (source / "node_modules" / "pkg").mkdir(parents=True)
            (source / "node_modules" / "pkg" / "index.js").write_text("x")

            out = Path(directory) / "tree"
            builder.build(source, out, COMMIT)

            self.assertTrue((out / "definitions/a/x.sqlx").is_file())
            self.assertTrue((out / "includes/c.js").is_file())
            self.assertTrue((out / "README.md").is_file())
            self.assertFalse((out / "workflow_settings.yaml.example").exists())
            self.assertFalse((out / ".df-credentials.json").exists())
            self.assertFalse((out / ".df-extra").exists())
            self.assertFalse((out / "node_modules").exists())
            self.assertNotIn("real-project", (out / "workflow_settings.yaml").read_text())

    def test_real_project_definitions_and_includes_are_copied(self):
        tree = self.build_tree()
        for sub in ("definitions", "includes"):
            expected = sorted(p.relative_to(DATAFORM) for p in (DATAFORM / sub).rglob("*") if p.is_file())
            actual = sorted(p.relative_to(tree) for p in (tree / sub).rglob("*") if p.is_file())
            self.assertTrue(expected)
            self.assertEqual(expected, actual)
        self.assertFalse((tree / "workflow_settings.yaml.example").exists())

    def test_provenance_file_records_source(self):
        tree = self.build_tree()
        provenance = (tree / "GENERATED_FROM").read_text()

        self.assertIn(f"Source commit: {COMMIT}", provenance)
        self.assertIn("Source path: workers/analytics-dataflow/dataform", provenance)
        self.assertIn("Do not edit or merge", provenance)

    def test_non_empty_output_directory_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            (out / "stale.txt").write_text("stale")
            with self.assertRaises(builder.BuildError):
                builder.build(DATAFORM, out, COMMIT)
            self.assertEqual(["stale.txt"], [p.name for p in out.iterdir()])

    def test_unknown_placeholder_and_bad_commit_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "dataform"
            (source / "definitions").mkdir(parents=True)
            (source / "workflow_settings.yaml.example").write_text("defaultProject: YOUR_UNMAPPED_THING\n")
            with self.assertRaises(builder.BuildError):
                builder.build(source, Path(directory) / "out", COMMIT)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(builder.BuildError):
                builder.build(DATAFORM, Path(directory) / "out", "not-a-commit")

    def test_example_does_not_commit_deployment_values(self):
        example = (DATAFORM / "workflow_settings.yaml.example").read_text()
        self.assertIn("dataformCoreVersion:", example)
        self.assertIn("YOUR_DATAFORM_EXECUTION_PROJECT", example)


if __name__ == "__main__":
    unittest.main()
