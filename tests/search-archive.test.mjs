import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { search } from '../opencli/lib/search.mjs';
import { OperationError } from '../opencli/lib/failure.mjs';
import { rememberSite } from '../opencli/lib/memory.mjs';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'luz-crawl-search-'));
test.after(() => fs.rm(temp, { recursive: true, force: true }));

test('business portals and unknown domains never silently fall back to an external index', async () => {
  const previous=process.env.LUZ_CRAWL_STATE;
  process.env.LUZ_CRAWL_STATE=path.join(temp,'native-only-state');
  try {
    await rememberSite({site:'https://unlisted.example',name:'unlisted.example'});
    // Old saved sites can still have public_index enabled; enforce the boundary at dispatch.
    const sites=JSON.parse(await fs.readFile(path.join(process.env.LUZ_CRAWL_STATE,'sites.json'),'utf8'));
    sites[0].public_index=true;
    await fs.writeFile(path.join(process.env.LUZ_CRAWL_STATE,'sites.json'),JSON.stringify(sites));
    for(const platform of ['ccgp','qcc','1688','huitun','douyin-creator','unlisted.example']) {
      const urls=[];
      const result=await search({}, {platform,query:'门窗',read:0,out:path.join(temp,`native-${platform}`)}, {summary:()=>({})}, async (_page,options)=>{
        urls.push(options.url);
        const folder=path.join(options.out,'raw','discovery');
        await fs.mkdir(path.join(folder,'raw'),{recursive:true});
        await fs.writeFile(path.join(folder,'raw/content.json'),JSON.stringify({requested_url:options.url,links:[]}));
        return {folder,status:'partial',resolved_url:options.url,url_check:{valid_content:false},search_action:{submitted:false},limitations:['no result yet']};
      });
      assert.equal(urls.length,1,platform);
      assert.ok(!urls.some(url=>new URL(url).hostname.endsWith('bing.com')),platform);
      assert.equal(result.search_status,'no_verified_candidates');
    }
  } finally {
    if(previous===undefined) delete process.env.LUZ_CRAWL_STATE;
    else process.env.LUZ_CRAWL_STATE=previous;
  }
});

test('searches in one task reuse a single numbered folder and keep separate result files', async () => {
  const previousThread = process.env.CODEX_THREAD_ID;
  const previousState = process.env.LUZ_CRAWL_STATE;
  process.env.CODEX_THREAD_ID = 'parent-search-thread';
  process.env.LUZ_CRAWL_STATE = path.join(temp, 'state');
  try {
    const out = path.join(temp, 'output');
    const operations = { summary: () => ({ browser_calls: 1 }) };
    let captures = 0;
    const capturePage = async (_page, options) => {
      const folder = path.join(options.out, 'raw', `capture-${++captures}`);
      await fs.mkdir(path.join(folder, 'raw'), { recursive: true });
      await fs.writeFile(path.join(folder, 'raw', 'content.json'), JSON.stringify({ requested_url: options.url, links: [] }));
      return { folder, status: 'captured', resolved_url: options.url, url_check: { valid_content: true }, search_action: { submitted: true }, limitations: [] };
    };

    const first = await search({}, { platform: 'xhs', query: 'folder rule', read: 0, out }, operations, capturePage);
    const second = await search({}, { platform: 'xhs', query: 'another query', read: 0, out }, operations, capturePage);
    process.env.CODEX_THREAD_ID = 'worker-search-thread';
    const delegated = await search({}, { platform: 'xhs', query: 'delegated query', read: 0, out: first.search_archive }, operations, capturePage);
    const entries = await fs.readdir(out, { withFileTypes: true });

    assert.equal(first.search_archive, second.search_archive);
    assert.equal(first.search_archive, delegated.search_archive);
    assert.equal(path.basename(first.search_archive), '001_xhs_folder rule');
    assert.notEqual(first.search_index, second.search_index);
    assert.notEqual(second.search_index, delegated.search_index);
    assert.equal(path.dirname(first.search_index), path.join(first.search_archive, 'raw'));
    assert.equal(path.dirname(second.search_index), path.join(second.search_archive, 'raw'));
    assert.equal(path.dirname(delegated.search_index), path.join(delegated.search_archive, 'raw'));
    assert.equal(JSON.parse(await fs.readFile(first.search_index, 'utf8')).search_archive, first.search_archive);
    assert.ok(entries.length === 1 && entries.every((entry) => entry.isDirectory()));
    assert.ok(captures >= 3);
    assert.ok((await fs.readdir(path.join(first.search_archive, 'raw'))).length > 0);
    assert.ok((await fs.readdir(path.join(first.search_archive, 'raw'))).filter((name) => name.startsWith('search-')).length === 3);
    assert.equal(first.html_file, second.html_file);

    const explicitRaw = path.join(temp, 'explicit-output', 'raw');
    const third = await search({}, { platform: 'xhs', query: 'raw output', read: 0, out: explicitRaw }, operations, capturePage);
    assert.equal(path.dirname(third.search_archive), path.dirname(explicitRaw));
    assert.ok((await fs.readdir(path.dirname(explicitRaw), { withFileTypes: true })).every((entry) => entry.isDirectory()));
  } finally {
    if (previousThread === undefined) delete process.env.CODEX_THREAD_ID;
    else process.env.CODEX_THREAD_ID = previousThread;
    if (previousState === undefined) delete process.env.LUZ_CRAWL_STATE;
    else process.env.LUZ_CRAWL_STATE = previousState;
  }
});

test('a loose file at raw root blocks search before browser access and remains untouched', async () => {
  const previousState = process.env.LUZ_CRAWL_STATE;
  process.env.LUZ_CRAWL_STATE = path.join(temp, 'loose-state');
  try {
    const out = path.join(temp, 'loose-output');
    const raw = path.join(out, 'raw');
    await fs.mkdir(raw, { recursive: true });
    await fs.writeFile(path.join(raw, 'legacy.html'), 'keep');
    let browserCalls = 0;

    await assert.rejects(
      () => search({}, { platform: 'xhs', query: 'must stop', out }, { summary: () => ({}) }, async () => { browserCalls++; }),
      /Raw root contains loose files;.*legacy\.html/
    );
    assert.equal(browserCalls, 0);
    assert.equal(await fs.readFile(path.join(raw, 'legacy.html'), 'utf8'), 'keep');
    assert.deepEqual(await fs.readdir(raw), ['legacy.html']);
  } finally {
    if (previousState === undefined) delete process.env.LUZ_CRAWL_STATE;
    else process.env.LUZ_CRAWL_STATE = previousState;
  }
});

test('a failed browser route still leaves a result record in its search folder', async () => {
  const previousState = process.env.LUZ_CRAWL_STATE;
  process.env.LUZ_CRAWL_STATE = path.join(temp, 'failed-state');
  try {
    const out = path.join(temp, 'failed-output');
    const result = await search({}, { platform: 'xhs', query: 'browser unavailable', read: 0, out }, { summary: () => ({}) }, async () => { throw new Error('browser unavailable'); });
    const saved = JSON.parse(await fs.readFile(result.search_index, 'utf8'));
    const entries = await fs.readdir(out, { withFileTypes: true });

    assert.equal(result.status, 'failed');
    assert.match(result.error, /browser unavailable/);
    assert.equal(saved.search_archive, result.search_archive);
    assert.ok(entries.length === 1 && entries[0].isDirectory());
  } finally {
    if (previousState === undefined) delete process.env.LUZ_CRAWL_STATE;
    else process.env.LUZ_CRAWL_STATE = previousState;
  }
});


test('an interrupted detail read keeps discovered candidates and the concrete stop reason', async () => {
  const previous = process.env.LUZ_CRAWL_STATE;
  process.env.LUZ_CRAWL_STATE = path.join(temp, 'interrupted-state');
  try {
    let calls = 0;
    const result = await search({}, {platform: 'x', query: 'AI tutorial', read: 1, out: path.join(temp, 'interrupted')}, {summary: () => ({})}, async (_page, options) => {
      if (++calls > 1) throw new OperationError('operation_budget', 'Local request window is exhausted');
      const folder = path.join(options.out, 'raw', '001_search');
      await fs.mkdir(path.join(folder, 'raw'), {recursive: true});
      await fs.writeFile(path.join(folder, 'raw/content.json'), JSON.stringify({requested_url: options.url, links: [{url: 'https://x.com/example/status/123', text: 'AI tutorial'}]}));
      return {folder, status: 'captured', resolved_url: options.url, url_check: {valid_content: true}, search_action: {submitted: true}, limitations: []};
    });
    assert.equal(result.status, 'partial');
    assert.equal(result.discovered_candidates, 1);
    assert.equal(result.candidates[0].url, 'https://x.com/example/status/123');
    assert.match(result.error, /Local request window/);
    assert.equal(result.stop_reason, 'operation_budget');
    const saved = JSON.parse(await fs.readFile(result.search_index, 'utf8'));
    assert.equal(saved.discovered_candidates, 1);
  } finally {
    if (previous === undefined) delete process.env.LUZ_CRAWL_STATE;
    else process.env.LUZ_CRAWL_STATE = previous;
  }
});
