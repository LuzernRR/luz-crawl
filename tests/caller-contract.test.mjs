import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skills = fileURLToPath(new URL('../../', import.meta.url));
const contract = path.join(skills, 'luz-crawl/references/caller-output-contract.md');

test('every installed caller skill links the same project-isolation contract', async () => {
  const callers = [];
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, {withFileTypes:true})) {
      if (entry.isSymbolicLink() || ['node_modules','memory','legacy','.git','browser-extension'].includes(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { await visit(file); continue; }
      if (entry.name !== 'SKILL.md' || file === path.join(skills, 'luz-crawl/SKILL.md')) continue;
      const text = await fs.readFile(file, 'utf8');
      if (!/luz[- _]crawl|LuzCrawl/i.test(text)) continue;
      callers.push(file);
      const link = text.match(/\]\(([^)]+caller-output-contract\.md)\)/)?.[1];
      assert.ok(link, `Missing project contract: ${file}`);
      assert.equal(path.resolve(path.dirname(file), link), contract);
      assert.match(text, /raw\/.*同名最终 HTML/);
    }
  }
  await visit(skills);
  assert.ok(callers.length >= 11);
  await fs.access(contract);
});
