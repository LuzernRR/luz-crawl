import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atomicWrite, hash, verifyArchive } from '../opencli/lib/archive.mjs';
import { buildSearchPlan, collect, refreshCollection } from '../opencli/lib/collect.mjs';

const temp=await fs.mkdtemp(path.join(os.tmpdir(),'luzcrawl-collection-'));
process.env.LUZ_CRAWL_STATE=path.join(temp,'memory');
test.after(()=>fs.rm(temp,{recursive:true,force:true}));

async function source(task,options,extra={}) {
  const url=`https://example.com/${task.platform}`;
  const folder=path.join(options.out,'raw','001_原文');
  const content={requested_url:url,resolved_url:url,title:'原文',platform:task.platform,status:'captured',url_check:{valid_content:true},items:[{kind:'page_body',text:`${task.platform}原文尾部`}],comments:[{text:'最后一条评论'}]};
  const json=JSON.stringify(content); await atomicWrite(path.join(folder,'raw/content.json'),json);
  await atomicWrite(path.join(folder,'raw/manifest.json'),{files:[{path:'raw/content.json',sha256:hash(json)}]});
  return{folder,status:'captured',browser:{closed:true},...extra};
}

test('plans canonicalize platform aliases and use only confirmed sites for all',async()=>{
  const plan=await buildSearchPlan('Python开源工具',{platform:'GitHub,github,Bing'});
  assert.deepEqual(plan.tasks.map(task=>task.platform),['github','bing']);
  assert.ok(plan.tasks.every(task=>task.query==='Python开源工具'));
  const all=await buildSearchPlan('同一主题',{platform:'all'});
  assert.ok(all.tasks.some(task=>task.platform==='bilibili'));
  assert.ok(!all.tasks.some(task=>task.platform==='qianfan'));
  await assert.rejects(()=>buildSearchPlan('主题',{platform:'missing-platform'}),/Unknown platform/);
});

test('collect runs sequentially and exports one HTML with complete source text and comments',async()=>{
  const out=path.join(temp,'complete'); const visited=[];
  const result=await collect('开源工具',{out,platform:'github,bing',read:1},async(task,options)=>{visited.push(task.platform);return source(task,options);});
  assert.deepEqual(visited,['github','bing']);assert.equal(result.status,'captured');assert.equal(result.verified_sources,2);
  assert.equal(result.requested_tasks,2);assert.equal(result.attempted_tasks,2);
  assert.deepEqual((await fs.readdir(out)).sort(),[path.basename(result.html_file),'raw','参考链接.md'].sort());
  const html=await fs.readFile(result.html_file,'utf8');
  assert.ok(html.includes('github原文尾部') && html.includes('bing原文尾部') && html.includes('最后一条评论'));
  assert.ok((await verifyArchive(result.folder)).ok);
  assert.equal((await refreshCollection(result.folder)).status,'captured');
  await fs.appendFile(result.html_file,'用户修改');
  await assert.rejects(()=>refreshCollection(result.folder),/edited/);
});

test('missing sources, partial downloads and early cleanup stops remain partial',async()=>{
  const failed=await collect('开源工具',{out:path.join(temp,'failed'),platform:'github,bing'},(task,options)=>task.platform==='bing'?{status:'failed',error:'Invalid URL',browser:{closed:true}}:source(task,options));
  assert.equal(failed.status,'partial');assert.equal(failed.verified_sources,1);assert.equal(failed.attempted_tasks,2);
  const media=await collect('开源工具',{out:path.join(temp,'media'),platform:'github'},(task,options)=>source(task,options,{downloads:{status:'partial',failures:[{error:'HTTP 403'}]}}));
  assert.equal(media.status,'partial');
  const stopped=await collect('开源工具',{out:path.join(temp,'stopped'),platform:'github,bing'},(task,options)=>source(task,options,{browser:{closed:false}}));
  assert.equal(stopped.status,'partial');assert.equal(stopped.attempted_tasks,1);assert.equal(stopped.requested_tasks,2);assert.equal(stopped.browser.closed,false);
});

test('report picks up a continued login task without replacing user-edited output',async()=>{
  const initial=await collect('开源工具',{out:path.join(temp,'continued'),platform:'github'},async()=>({status:'awaiting_user',task_id:'manual-task',browser:{closed:true,parked:true}}));
  assert.equal(initial.verified_sources,0);assert.equal(initial.awaiting_user.length,1);
  const out=initial.results[0].out;
  await atomicWrite(path.join(out,'raw/tasks/manual-task.json'),{result:await source({platform:'github'},{out})});
  const refreshed=await refreshCollection(initial.folder);
  assert.equal(refreshed.status,'captured');assert.equal(refreshed.verified_sources,1);assert.equal(refreshed.awaiting_user.length,0);
  assert.equal(refreshed.results[0].resumed_from,'manual-task');assert.ok((await verifyArchive(refreshed.folder)).ok);
});
