import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function within(root, candidate) {
  return candidate === root || candidate.startsWith(root + path.sep);
}

function pendingTask(result) {
  for (const source of [...(result.sources || []), ...(result.results || [])]) {
    const pending = pendingTask(source);
    if (pending) return pending;
  }
  if (result.status === 'awaiting_user' && idPattern.test(result.task_id || '')) return result;
  return result.awaiting_user?.find?.(item => idPattern.test(item.task_id || ''));
}

export class Jobs {
  constructor({ runtime, stateRoot, outputRoot, verificationUrl, verificationTimeoutMs = 30 * 60_000 }) {
    this.runtime = runtime;
    this.directory = path.join(stateRoot, 'mcp-jobs');
    this.outputRoot = path.resolve(outputRoot);
    this.verificationUrl = verificationUrl;
    this.verificationTimeoutMs = verificationTimeoutMs;
    this.active = null;
    this.waiting = null;
    this.verificationTimer = null;
  }

  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await mkdir(this.outputRoot, { recursive: true, mode: 0o700 });
    for (const name of await readdir(this.directory)) {
      if (!name.endsWith('.json') || !idPattern.test(name.slice(0, -5))) continue;
      const job = JSON.parse(await readFile(path.join(this.directory, name), 'utf8'));
      if (['running', 'queued', 'awaiting_user'].includes(job.state)) {
        job.state = 'interrupted';
        job.message = '服务已重启；原浏览器页面可能不再存在。若有待验证任务，可调用继续以重新检查。';
        await this.save(job);
      }
    }
  }

  clearVerificationTimer() {
    clearTimeout(this.verificationTimer);
    this.verificationTimer = null;
  }

  async expireVerification(id) {
    if (this.waiting !== id || this.active) return;
    this.active = id;
    let closeBrowser = true;
    try {
      const job = await this.load(id);
      if (job.state !== 'awaiting_user') { closeBrowser = false; return; }
      job.state = 'interrupted';
      job.message = '人工验证等待超时；浏览器已关闭以释放资源，调用 luz_continue 可重新打开。';
      await this.save(job);
      this.waiting = null;
    } catch {
      this.waiting = null;
    } finally {
      this.clearVerificationTimer();
      if (closeBrowser) {
        try { await this.runtime.close?.(); } catch {}
      }
      if (this.active === id) this.active = null;
    }
  }

  scheduleVerificationTimeout(id) {
    this.clearVerificationTimer();
    this.verificationTimer = setTimeout(() => { void this.expireVerification(id); }, this.verificationTimeoutMs);
    this.verificationTimer.unref?.();
  }

  async load(id) {
    if (!idPattern.test(id)) throw new Error('任务不存在。');
    try { return JSON.parse(await readFile(path.join(this.directory, id + '.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') throw new Error('任务不存在。'); throw error; }
  }

  async save(job) {
    job.updated_at = new Date().toISOString();
    const target = path.join(this.directory, job.id + '.json');
    const temporary = target + '.' + randomUUID() + '.tmp';
    await writeFile(temporary, JSON.stringify(job, null, 2), { mode: 0o600 });
    await rename(temporary, target);
  }

  async start(kind, input) {
    if (this.active) throw new Error('已有任务正在运行或等待人工验证，请先完成或继续该任务。');
    if (this.waiting) throw new Error('任务 ' + this.waiting + ' 正在等待人工验证，请先处理。');
    const job = { id: randomUUID(), kind, input, state: 'queued', created_at: new Date().toISOString() };
    this.active = job.id;
    try { await this.save(job); }
    catch (error) { this.active = null; throw error; }
    void this.execute(job, false);
    return this.publicJob(job);
  }

  async get(id) {
    return this.publicJob(await this.load(id));
  }

  publicJob(job) {
    return {
      ...job,
      ...(job.state === 'awaiting_user' ? {
        verification_url: this.verificationUrl,
        instruction: '打开验证地址，在同一浏览器页面手动完成登录或验证，然后调用 luz_continue。'
      } : {})
    };
  }

  async resume(id) {
    if (!idPattern.test(id)) throw new Error('任务不存在。');
    if (this.active && this.active !== id) throw new Error('另一个任务正在运行。');
    if (this.waiting && this.waiting !== id) throw new Error('请先处理等待人工验证的任务 ' + this.waiting + '。');
    const job = await this.load(id);
    if (!['awaiting_user', 'interrupted'].includes(job.state) || !job.pending_task_id) throw new Error('该任务没有可续接的人工验证步骤。');
    if (['rate_limited', 'platform_cooldown'].includes(job.pending_reason)) {
      throw new Error('该任务因平台限流或冷却停止，不能通过继续操作绕过。');
    }
    this.active = id;
    const previousState = job.state;
    job.state = 'queued';
    try { await this.save(job); }
    catch (error) {
      this.active = null;
      job.state = previousState;
      if (previousState === 'awaiting_user') this.scheduleVerificationTimeout(id);
      throw error;
    }
    this.clearVerificationTimer();
    void this.execute(job, true);
    return this.publicJob(job);
  }

  async cancel(id) {
    if (!idPattern.test(id)) throw new Error('任务不存在。');
    if (this.active) throw new Error('任务仍在运行，请等待当前步骤完成后再取消。');
    const job = await this.load(id);
    if (!['awaiting_user', 'interrupted'].includes(job.state)) throw new Error('仅可取消等待人工验证或中断的任务。');
    this.active = id;
    try {
      if (job.pending_task_id) {
        if (this.runtime.start) await this.runtime.start();
        const result = await this.runtime.run(['cancel', job.pending_task_id, '--profile', this.runtime.profile]);
        if (result.status !== 'cancelled') throw new Error('采集工具未确认取消，任务保持原状态。');
        job.cancel_result = result;
      }
      job.state = 'cancelled';
      job.message = '任务已取消，已保存的采集文件保留。';
      await this.save(job);
      if (this.waiting === id) this.waiting = null;
      this.clearVerificationTimer();
      return this.publicJob(job);
    } finally {
      if (job.state === 'cancelled') await this.runtime.close?.();
      this.active = null;
    }
  }

  command(job) {
    const common = ['--out', job.folder, '--profile', this.runtime.profile, '--window', 'foreground'];
    let args;
    if (job.kind === 'capture') args = ['capture', job.input.url, ...common];
    else if (job.kind === 'search') args = ['search', job.input.platform, job.input.query, '--read', String(job.input.read), ...common];
    else {
      args = ['collect', job.input.input, '--read', String(job.input.read), ...common];
      if (job.input.platform) args.push('--platform', job.input.platform);
    }
    if (job.input.comments) args.push('--comments');
    if (job.input.download) args.push('--download');
    return args;
  }

  async execute(job, resume) {
    try {
      job.state = 'running';
      await this.save(job);
      if (this.runtime.start) await this.runtime.start();
      if (!this.runtime.profile) throw new Error('浏览器尚未连接。');
      if (!resume) {
        const title = job.kind === 'capture' ? new URL(job.input.url).hostname : (job.input.query || job.input.input).slice(0, 80);
        const begin = await this.runtime.run(['begin', title, '--out', this.outputRoot, '--new']);
        const folder = path.resolve(begin.folder || '');
        if (!within(this.outputRoot, folder)) throw new Error('创建的任务目录不在输出目录内。');
        job.folder = folder;
        await this.save(job);
      }
      const args = resume ? ['continue', job.pending_task_id, '--profile', this.runtime.profile] : this.command(job);
      let result = await this.runtime.run(args);
      if (resume && job.kind === 'search' && ['captured', 'completed'].includes(result.status)) {
        job.continuation_result = result;
        result = await this.runtime.run(this.command(job));
      }
      if (resume && job.collection_folder && ['captured', 'completed'].includes(result.status)) {
        job.continuation_result = result;
        job.result = await this.runtime.run(['report', job.collection_folder]);
        if (job.result.attempted_tasks < job.result.requested_tasks) {
          job.message = '合集已刷新；人工验证后的剩余项目未自动执行。';
        }
      } else {
        job.result = result;
      }
      if (!resume && job.kind === 'collect' && Array.isArray(job.result.awaiting_user) && job.result.awaiting_user.length) {
        const collection = path.resolve(job.result.folder || '');
        if (!within(this.outputRoot, collection)) throw new Error('合集目录不在输出目录内。');
        job.collection_folder = collection;
      }
      const pending = pendingTask(job.result);
      job.pending_task_id = pending?.task_id;
      const source = job.result.results?.find(item => item.task_id === job.pending_task_id) || pending;
      job.pending_reason = source?.awaiting_reason || source?.stop_reason;
      job.state = pending ? 'awaiting_user' : (job.result.status || 'failed');
      if (job.state === 'awaiting_user' && !job.pending_task_id) {
        job.message = '结果要求人工处理，但未返回可续接的任务 ID；请检查采集结果。';
      }
      await this.save(job);
      if (job.state === 'awaiting_user') {
        this.waiting = job.id;
        this.scheduleVerificationTimeout(job.id);
      }
      else if (this.waiting === job.id) this.waiting = null;
    } catch (error) {
      job.state = 'failed';
      job.message = error.message;
      await this.save(job).catch(() => {});
      if (this.waiting === job.id) this.waiting = null;
    } finally {
      if (job.state !== 'awaiting_user') await this.runtime.close?.();
      if (this.active === job.id) this.active = null;
    }
  }

  async listFiles(id) {
    const job = await this.load(id);
    if (!job.folder) throw new Error('任务或输出目录不存在。');
    const root = await realpath(this.outputRoot);
    const start = await realpath(job.folder);
    if (!within(root, start)) throw new Error('任务输出目录超出允许范围。');
    const found = [];
    const visit = async directory => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (found.length >= 500) return;
        const full = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) await visit(full);
        else if (entry.isFile()) found.push({ path: path.relative(root, full).split(path.sep).join('/'), bytes: (await stat(full)).size });
      }
    };
    await visit(start);
    if (job.result?.html_file) {
      const html = await realpath(job.result.html_file).catch(() => null);
      if (html && within(root, html) && !found.some(item => item.path === path.relative(root, html).split(path.sep).join('/'))) {
        found.push({ path: path.relative(root, html).split(path.sep).join('/'), bytes: (await stat(html)).size });
      }
    }
    return { files: found, truncated: found.length >= 500 };
  }

  async readText(relativePath) {
    const root = await realpath(this.outputRoot);
    const candidate = path.resolve(root, relativePath);
    if (!within(root, candidate)) throw new Error('文件不在输出目录内。');
    const resolved = await realpath(candidate);
    if (!within(root, resolved)) throw new Error('文件链接指向输出目录外。');
    if (!/\.(json|html|md|txt|csv)$/i.test(resolved)) throw new Error('仅支持读取文本、JSON 和 HTML 文件。');
    const info = await stat(resolved);
    if (!info.isFile() || info.size > 1024 * 1024) throw new Error('文件超过 1 MiB 或不是普通文件。');
    return { path: path.relative(root, resolved).split(path.sep).join('/'), text: await readFile(resolved, 'utf8') };
  }
}
