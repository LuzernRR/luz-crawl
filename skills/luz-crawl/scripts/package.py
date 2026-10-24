#!/usr/bin/env python3
"""Package LuzCrawl with its browser extension and clean memory defaults."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / 'opencli/package.json').read_text(encoding='utf-8'))['version']
EXCLUDED = {'node_modules', 'package-lock.json', '__pycache__', '.git', '.pytest_cache', '.venv', 'state', 'outputs', 'raw', 'browser-profile', '.capture.lock', 'events', 'legacy', 'pending'}
DOCUMENTS = ['SKILL.md', 'README.md', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CHANGELOG.md']


def sources():
    result = {name: (ROOT / name).read_bytes() for name in DOCUMENTS}
    for directory in ['agents', 'assets', 'references', 'scripts', 'opencli', 'tests', 'browser-extension']:
        for current, dirs, files in os.walk(ROOT / directory, followlinks=False):
            dirs[:] = [name for name in dirs if name not in EXCLUDED | {'memory'} and not (Path(current) / name).is_junction()]
            for name in sorted(files):
                file = Path(current) / name
                relative = file.relative_to(ROOT)
                if not file.is_symlink() and not EXCLUDED.intersection(relative.parts) and not name.startswith('.env') and file.suffix not in {'.pyc', '.tmp', '.zip', '.orig', '.log'}:
                    result[relative.as_posix()] = file.read_bytes()
    defaults = {'format': 'html', 'naming': '{seq}_{title}', 'window': 'foreground', 'close_after_use': True, 'keywords': []}
    result['opencli/memory/preferences.json'] = (json.dumps(defaults, indent=2) + '\n').encode()
    return result


def write_zip(file, entries):
    hashes = {name: hashlib.sha256(data).hexdigest() for name, data in sorted(entries.items())}
    entries = {**entries, 'PACKAGE-CHECKSUMS.json': (json.dumps(hashes, indent=2, ensure_ascii=False) + '\n').encode('utf-8')}
    file.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(file, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(entries.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 10, 24, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)
    with zipfile.ZipFile(file) as archive:
        assert archive.testzip() is None, f'ZIP integrity failure: {file}'
        for name, expected in hashes.items():
            assert hashlib.sha256(archive.read(name)).hexdigest() == expected, name
        assert not any(EXCLUDED.intersection(Path(name).parts) for name in archive.namelist())
        assert not any('memory/' in name and not name.endswith('memory/preferences.json') for name in archive.namelist())
    return {'file': str(file.resolve()), 'bytes': file.stat().st_size, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'source_files': len(hashes)}


def plugin_sources(files):
    interface = {'displayName': 'LuzCrawl', 'shortDescription': 'Browser search, HTML capture and local search memory.', 'longDescription': 'Self-contained browser extension, skill and search experience with verified source URLs and manual login continuation.', 'developerName': 'LuzernRR', 'category': 'Productivity', 'capabilities': ['Read', 'Write'], 'defaultPrompt': 'Use $luz-crawl to search in the browser, verify sources and save HTML with local experience.', 'brandColor': '#8FB396', 'composerIcon': './assets/icon-400.png', 'logo': './assets/logo.png'}
    legacy = {'name': 'luz-crawl', 'version': VERSION, 'description': 'LuzCrawl browser capture and local memory.', 'author': {'name': 'LuzernRR'}, 'skills': './skills/', 'interface': interface}
    portable = {'$schema': 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', 'name': 'luz-crawl', 'version': VERSION, 'description': legacy['description'], 'extensions': {'com.openai': {'interface': interface}}}
    plugin = {f'skills/luz-crawl/{name}': data for name, data in files.items()}
    plugin['.codex-plugin/plugin.json'] = (json.dumps(legacy, indent=2) + '\n').encode()
    plugin['plugin.json'] = (json.dumps(portable, indent=2) + '\n').encode()
    for name in DOCUMENTS:
        if name == 'SKILL.md':
            continue
        data = files[name].decode('utf-8')
        for prefix in ['references/', 'browser-extension/']:
            data = data.replace('](' + prefix, '](skills/luz-crawl/' + prefix)
        plugin[name] = data.encode('utf-8')
    for name, data in files.items():
        if name.startswith('assets/'):
            plugin[name] = data
    return plugin


def build(out):
    files = sources()
    assert files['SKILL.md'].startswith((b'---\n', b'---\r\n'))
    plugin = plugin_sources(files)
    native = {name.removeprefix('opencli/'): data for name, data in files.items() if name.startswith('opencli/')}
    extension = {name.removeprefix('browser-extension/'): data for name, data in files.items() if name.startswith('browser-extension/')}
    native.update({f'browser-extension/{name}': data for name, data in extension.items()})
    for name in ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']:
        native[name] = files[name]
    native['README.md'] = (f'# LuzCrawl {VERSION} 原生采集插件\n\n'
        '完整 Skill 与使用说明：https://github.com/LuzernRR/luz-crawl\n\n'
        '需要 Node.js 24.5+ 和 @jackwener/opencli@1.8.8。将完整目录放入 ~/.opencli/plugins/luz-crawl/，'
        '在 Edge / Chrome 扩展页加载 browser-extension/，再运行 opencli daemon restart。\n\n'
        '```powershell\nopencli luz-crawl doctor\nopencli luz-crawl search github "browser automation" --read 1\n'
        'opencli luz-crawl capture "https://example.com/article" --comments --download\n```\n\n'
        '日常完整命令、手动登录接续和浏览器接口使用完整 Skill 包。个人记忆未包含在本包中。'
        '原创采集部分采用 LICENSE 中的 PolyForm Noncommercial 1.0.0；browser-extension/ 保留 Apache-2.0。\n').encode('utf-8')
    assert all(name in extension for name in ['manifest.json', 'LICENSE', 'NOTICE', 'help.html'])
    result = [write_zip(out / 'luz-crawl-skill.zip', {f'luz-crawl/{name}': data for name, data in files.items()}), write_zip(out / 'luz-crawl-codex-plugin.zip', plugin), write_zip(out / 'luz-crawl-opencli-plugin.zip', native), write_zip(out / 'LuzCrawl-browser-extension.zip', extension)]
    public_checksums = [{**item, 'file': Path(item['file']).name} for item in result]
    (out / 'checksums.json').write_text(json.dumps({'version': VERSION, 'packages': public_checksums}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(build(args.out.resolve()), ensure_ascii=False, indent=2))
