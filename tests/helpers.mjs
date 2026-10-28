import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ExecutionPolicy } from '../opencli/lib/execution.mjs';

export function testPolicy(directory, settings) {
  let time = Date.now();
  return new ExecutionPolicy({ directory: path.join(directory, randomUUID()), settings, now: () => time, wait: async ms => { time += ms; }, random: () => 0 });
}

export const actionArgument = code => JSON.parse(code.match(/\n\}\)\((.*)\)$/s)[1]);
