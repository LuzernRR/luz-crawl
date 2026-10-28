import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / 'scripts' / 'package.py'
SPEC = importlib.util.spec_from_file_location('luz_package', SCRIPT)
package = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(package)


class PackageTests(unittest.TestCase):
    def test_only_portable_preferences_are_distributed(self):
        entries = package.sources()
        memory = [name for name in entries if '/memory/' in name]
        self.assertEqual(memory, ['opencli/memory/preferences.json'])
        defaults = json.loads(entries[memory[0]])
        self.assertNotIn('output_dir', defaults)
        self.assertNotIn('browser_profile', defaults)
        local = package.ROOT / 'opencli/memory/preferences.json'
        if local.is_file():
            output = json.loads(local.read_text(encoding='utf-8')).get('output_dir')
            if output:
                for name, data in entries.items():
                    if name.endswith('.md'):
                        self.assertNotIn(output, data.decode('utf-8'), name)

    def test_zip_roundtrip_checks_every_entry(self):
        with tempfile.TemporaryDirectory() as directory:
            result = package.write_zip(Path(directory) / 'sample.zip', {'SKILL.md': b'---\nname: sample\n---\n'})
            self.assertEqual(result['source_files'], 1)
            self.assertEqual(len(result['sha256']), 64)


if __name__ == '__main__':
    unittest.main()
