# Luz Crawl

A Codex plugin for planning and conducting evidence-backed, multi-source research. It maps relevant sources, collects and verifies evidence, records limitations, and saves reusable research notes.

## Contents

- .codex-plugin/: plugin manifest and interface assets
- skills/luz-crawl/: the skill instructions, references, and helper scripts

The public package omits personal search history and local research dossiers. Runtime experience is initialized separately for each user. Local output paths and the OpenCLI bridge directory can be configured through LUZ_CRAWL_OUTPUT_ROOT, LUZ_PROMPT_LIBRARY_ROOT, CODEX_HOME, and OPENCLI_BROWSER_BRIDGE_DIR.

## Use

Install this repository as a Codex plugin using the Codex plugin manager, or copy skills/luz-crawl/ into your Codex skills directory. Follow the skill's setup and source-access instructions before using platform-specific search routes.

## License

No open-source license is included. All rights remain with the author unless a license is added.
