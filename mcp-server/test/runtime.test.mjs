import test from 'node:test';
import assert from 'node:assert/strict';
import { runProcess } from '../runtime.mjs';

test('超出管道上限后停止累计子进程输出', async () => {
  await assert.rejects(
    runProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(5 * 1024 * 1024))']),
    /输出超过限制/
  );
});
