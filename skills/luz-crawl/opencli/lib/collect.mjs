import fs from 'node:fs/promises';
import path from 'node:path';
import { allocateRun, nameRun, atomicWrite, hash, recordReference, findExperience } from './archive.mjs';
import { canonicalURL, extractURLs, validateURL } from './platforms.mjs';
import { preferences, sites, loadTask } from './memory.mjs';
import { withBrowser, parkTask } from './browser-session.mjs';
import { capture } from './capture.mjs';
import { search } from './search.mjs';
import { downloadResult } from './download.mjs';
import { readArchive, reportDocument } from './report.mjs';

export async function buildSearchPlan(topic, options={}) {
  if (!topic?.trim() || topic.length > 2000) throw new Error('Provide a topic of 1-2000 characters.');
  const available=await sites(); const saved=await preferences();
  const seeds=JSON.parse(await fs.readFile(new URL('../experience/seeds.json',import.meta.url),'utf8'));
  let requested;
  let reason='内容与社区';
  if(options.file) requested=JSON.parse(await fs.readFile(path.resolve(options.file),'utf8'));
  else {
    let chosen=options.platform?.split(/[,，]/).map(value=>value.trim()).filter(Boolean);
    if(chosen?.includes('all')) chosen=seeds.verified_content_platforms;
    if(!chosen?.length) chosen=saved.preferred_platforms;
    if(!chosen?.length) {
      if(/招标|投标|采购|供应商|标书|tender|procurement/i.test(topic)) { chosen=['ccgp','ggzy','chinabidding','qianlima','bidcenter','made-in-china','bing'];reason='采购与公告'; }
      else if(/开源|编程|代码|开发|程序|python|javascript|github|typescript|linux|api|coding/i.test(topic)) { chosen=['github','csdn','cnblogs','juejin','stackoverflow','devto','hackernews','v2ex','bilibili','youtube','bing'];reason='技术与开源'; }
      else chosen=['xhs','x','zhihu','douban','reddit','douyin','bilibili','youtube','wechat','weibo','instagram','tiktok','google','bing'];
      chosen=chosen.filter(id=>seeds.verified_content_platforms?.includes(id));
    }
    if(!options.platform) chosen=chosen.filter(id=>!saved.excluded_platforms?.includes(id));
    requested=chosen.map(platform=>({platform,query:topic,reason}));
  }
  if(!Array.isArray(requested) || !requested.length || requested.length>60) throw new Error('A search plan must contain 1-60 tasks.');
  const plan=[]; const seen=new Set();
  for(const task of requested) {
    if(typeof task?.platform !== 'string' || typeof task?.query !== 'string' || !task.query.trim() || task.query.length>2000) throw new Error('Each plan task needs a platform and a non-empty query.');
    const site=available.find(site=>site.id.toLowerCase()===task.platform.toLowerCase() || site.aliases?.some(alias=>alias.toLowerCase()===task.platform.toLowerCase()));
    if(!site) throw new Error(`Unknown platform: ${task.platform}. Register the site with remember first.`);
    const key=site.id+'\n'+task.query;
    if(!seen.has(key)) { seen.add(key);plan.push({platform:site.id,query:task.query,reason:task.reason || reason}); }
  }
  return {topic,selected_by:options.file ? 'agent_plan' : options.platform ? 'explicit_platforms' : saved.preferred_platforms?.length ? 'saved_preferences' : 'topic_category',tasks:plan,keyword_hints:(await findExperience(topic)).keywords,preferred_keywords:saved.keywords || []};
}

async function runTask(task, options) {
  const kind=task.url ? 'capture' : 'search';
  const result=await withBrowser(kind,{...options,...task},(page,values)=>kind==='search' ? search(page,values) : capture(page,values));
  if(result.status==='awaiting_user' && result.task_id) {
    try { await parkTask(await loadTask(result.task_id)); }
    catch(error) { result.cleanup_error=error.message;return result; }
    result.browser={...result.browser,closed:true,retained:false,parked:true};
    result.next_action=`任务已保存并关闭页面；执行 continue ${result.task_id} 后手动登录或验证。`;
  }
  if(options.download && result.browser?.closed) await downloadResult(result);
  return result;
}

async function sourceArchives(results) {
  const found=[]; const seen=new Set();
  async function add(source) {
    if(!source.folder) return;
    const archive=await readArchive(source.folder);
    if(!archive) return;
    const id=canonicalURL(archive.content.requested_url);
    if(seen.has(id)) return;
    seen.add(id);found.push(archive);
    for(const related of archive.content.related || []) {
      if(related.folder && path.resolve(related.folder).startsWith(path.resolve(archive.folder)+path.sep)) await add(related);
    }
  }
  for(const result of results) for(const source of result.sources || [result]) await add(source);
  return found;
}

async function reportFiles(folder) {
  const files=[];
  async function visit(directory) {
    for(const entry of await fs.readdir(directory,{withFileTypes:true})) {
      const file=path.join(directory,entry.name);
      if(entry.isSymbolicLink()) throw new Error('Collection evidence cannot contain symlinks.');
      if(entry.isDirectory()) await visit(file);
      else if(file!==path.join(folder,'raw/manifest.json') && !entry.name.endsWith('.lock')) {
        const bytes=await fs.readFile(file);files.push({path:path.relative(folder,file).split(path.sep).join('/'),bytes:bytes.length,sha256:hash(bytes)});
      }
    }
  }
  await visit(folder);return files;
}

async function writeReport(folder, index) {
  const output=path.dirname(path.dirname(folder));
  const archives=await sourceArchives(index.results);
  const status=archives.length && index.results.length===index.plan.tasks.length && index.results.every(result=>result.status==='captured' && result.browser?.closed && (result.sources || [result]).every(source=>!['partial','failed'].includes(source.downloads?.status))) ? 'captured' : 'partial';
  const html=await reportDocument(index.title,archives,output,index.results);
  await atomicWrite(path.join(folder,'raw/collection.json'),index);
  await atomicWrite(path.join(folder,index.primary_file),html);
  const htmlFile=path.join(output,index.primary_file);await atomicWrite(htmlFile,html);
  const files=await reportFiles(folder);
  await atomicWrite(path.join(folder,'raw/manifest.json'),{schema_version:2,kind:'collection',output_layout:'html_and_raw_v1',primary_file:index.primary_file,title:index.title,captured_at:new Date().toISOString(),status,requested_tasks:index.plan.tasks.length,attempted_tasks:index.results.length,verified_sources:archives.length,files});
  for(const archive of archives) await recordReference({output,base:path.dirname(folder)},{title:archive.content.title,primary_file:index.primary_file,requested_url:archive.content.requested_url,canonical_url:canonicalURL(archive.content.requested_url)});
  return {folder,html_file:htmlFile,requested_tasks:index.plan.tasks.length,attempted_tasks:index.results.length,verified_sources:archives.length,source_folders:archives.map(archive=>archive.folder),awaiting_user:index.results.filter(result=>result.task_id && result.status==='awaiting_user').map(result=>({platform:result.platform,task_id:result.task_id})),results:index.results,status,browser:{closed:index.results.every(result=>result.browser?.closed ?? !result.browser)}};
}

export async function refreshCollection(directory) {
  const folder=path.resolve(directory);
  if(path.basename(path.dirname(folder))!=='raw') throw new Error('Use the collection folder returned by collect.');
  const index=JSON.parse(await fs.readFile(path.join(folder,'raw/collection.json'),'utf8'));
  if(path.basename(index.primary_file)!==index.primary_file || !index.primary_file.endsWith('.html')) throw new Error('Invalid collection HTML filename.');
  const manifest=JSON.parse(await fs.readFile(path.join(folder,'raw/manifest.json'),'utf8'));
  for(const name of [index.primary_file,'raw/collection.json']) {
    const expected=manifest.files.find(file=>file.path===name)?.sha256;
    if(hash(await fs.readFile(path.join(folder,name)))!==expected) throw new Error('Collection HTML or index was edited; refusing to overwrite it.');
  }
  if(hash(await fs.readFile(path.join(path.dirname(path.dirname(folder)),index.primary_file)))!==manifest.files.find(file=>file.path===index.primary_file)?.sha256) throw new Error('Delivered collection HTML was edited; refusing to overwrite it.');
  await fs.writeFile(path.join(folder,'.capture.lock'),String(process.pid),{flag:'wx'});
  try {
    for(const [position,row] of index.results.entries()) if(row.task_id) {
      const audit=JSON.parse(await fs.readFile(path.join(row.out,'raw/tasks',row.task_id+'.json'),'utf8'));
      if(audit.result?.status && audit.result.status!=='awaiting_user') index.results[position]={...row,...audit.result,task_id:undefined,resumed_from:row.task_id};
    }
    return await writeReport(folder,index);
  } finally {await fs.rm(path.join(folder,'.capture.lock'));}
}

export async function collect(input, values, execute=runTask) {
  const options={...values,comments:values.comments ?? true,download:values.download ?? true,read:Number(values.read ?? 1),scrolls:Number(values.scrolls ?? 20)};
  if(!Number.isInteger(options.read) || options.read<1 || options.read>20) throw new Error('collect --read must be 1-20.');
  if(/^https?:\/\//i.test((input || '').trim())) validateURL(input.trim());
  let links=extractURLs(input || '');
  if(options.file && !options.file.toLowerCase().endsWith('.json')) links=extractURLs(await fs.readFile(path.resolve(options.file),'utf8'));
  if(links.length===1) return execute({url:links[0]},options);
  const plan=links.length ? {topic:input || '链接合集',selected_by:'links',tasks:links.map(url=>({url}))} : await buildSearchPlan(input,options);
  if(values.resume) throw new Error('collect creates a new collection; resume a saved login task with continue, then run report on its collection folder.');
  const run=await allocateRun(options.out); const title=values.name || (links.length ? '链接合集' : input);
  try {
    const primary_file=await nameRun(run,title);
    const index={title,primary_file,plan,created_at:new Date().toISOString(),results:[]};
    await atomicWrite(path.join(run.folder,'raw/collection.json'),index);
    for(const task of plan.tasks) {
      const out=path.join(run.folder,'raw/sources',task.platform || 'links');
      let result;
      try { result=await execute(task,{...options,out}); }
      catch(error) { result={status:'failed',error:error.message}; }
      index.results.push({...task,...result,out});
      await atomicWrite(path.join(run.folder,'raw/collection.json'),index);
      if(result.browser && !result.browser.closed) break;
    }
    return await writeReport(run.folder,index);
  } finally {await run.release();}
}
