import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atomicWrite } from '../opencli/lib/archive.mjs';
import { summaryEntry, writeCrawlSummary } from '../opencli/lib/crawl-summary.mjs';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(),'luzcrawl-summary-'));
test.after(()=>fs.rm(tmp,{recursive:true,force:true}));

test('summarizes visible content and candidates without accepting unsafe links',()=>{
  const row=summaryEntry({requested_url:'https://example.com/detail',title:'采购公告',status:'captured',items:[{text:'已取得门窗采购正文和供货安装范围。'}],discovered_candidates:3,media:[{kind:'image'},{kind:'audio'}]});
  assert.match(row.summary,/门窗采购正文/);
  assert.match(row.summary,/3条候选/);
  assert.match(row.summary,/1张图片、0段视频、1段音频/);
  assert.match(summaryEntry({url:'https://example.com/audio',status:'captured',post:{audios:[{}]}}).summary,/1段音频/);
  for(const url of ['javascript:alert(1)','file:///private','https://user:pass@example.com']) assert.equal(summaryEntry({url}),null);
  const moved=summaryEntry({url:'https://example.com/',status:'completed',results:[{action:'read',value:{url:'https://example.com/',text:'导航前的正文',title:'旧页'}},{action:'click',value:{url:'https://example.com/new',title:'新页'}}]});
  assert.equal(moved.url,'https://example.com/new');
  assert.equal(moved.chars,0);
});

test('rebuilds one task report from nested evidence, deduplicates and shows latest failures',async()=>{
  const root=path.join(tmp,'task');
  await atomicWrite(path.join(root,'luz-task.json'),{schema_version:1,kind:'task_archive',title:'门窗调研'});
  const deep=path.join(root,'raw/001/raw/sources/web/raw/001/raw');
  await atomicWrite(path.join(deep,'content.json'),{requested_url:'https://example.com/a',status:'captured',captured_at:'2026-10-25T01:00:00Z',title:'供应商 <script>alert(1)</script>',text:'可公开获取的供货安装需求正文。'});
  await atomicWrite(path.join(root,'raw/tasks/one.json'),{at:'2026-10-25T02:00:00Z',url:'https://example.com/a',result:{status:'captured'}});
  await atomicWrite(path.join(root,'batch-one.json'),{results:[{url:'https://example.com/b',title:'旧公告',text:'历史成功记录不能覆盖新的登录失败。',status:'captured',finished_at:'2026-10-25T01:00:00Z'},{url:'https://example.com/b',status:'awaiting_user',awaiting_reason:'login_required',finished_at:'2026-10-25T03:00:00Z'},{url:'https://example.com/c',status:'skipped'}]});
  await atomicWrite(path.join(root,'raw/snapshots/content.json'),{url:'https://excluded.test/',status:'captured'});
  const results=await Promise.all([writeCrawlSummary(deep),writeCrawlSummary(root)]);
  assert.equal(results[0].file,path.join(root,'raw/crawl-summary.json'));
  assert.equal(results[1].websites,1);assert.equal(results[1].pages,2);assert.equal(results[1].records,3);
  const html=await fs.readFile(results[1].html_file,'utf8');
  assert.equal(JSON.parse(await fs.readFile(results[1].file,'utf8')).records,3);
  await assert.rejects(()=>fs.access(path.join(root,'raw/爬取总结.html')),{code:'ENOENT'});
  assert.match(html,/供货安装需求正文/);
  assert.match(html,/需要登录/);
  assert(!html.includes('历史成功记录不能'));
  assert(!html.includes('excluded.test'));
  assert(!html.includes('<script>alert(1)</script>'));
  assert(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.equal(html.match(/class="title" href="https:\/\/example.com\/a"/g).length,1);
  assert(!html.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>|<[^>]+>/g,'').includes('https://'));
  await assert.rejects(()=>fs.access(path.join(root,'参考链接.md')),{code:'ENOENT'});
});
