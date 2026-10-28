// LuzCrawl directory settings; Apache-2.0, see LICENSE and NOTICE.
export const SETTINGS_KEY = 'luzcrawl_output_preferences_v1';

export function normalizeDirectory(value) {
  const directory = typeof value === 'string' ? value.trim() : '';
  if (!directory || directory.length > 4096 || /[\u0000-\u001f\u007f]/.test(directory) || !/^(?:[a-z]:[\\/]|\/)/i.test(directory)) {
    throw new Error('请输入绝对目录，例如 E:\\Research\\LuzCrawl。');
  }
  return directory;
}

export async function getOutputPreferences(storage = chrome.storage.local) {
  const saved = (await storage.get(SETTINGS_KEY))[SETTINGS_KEY];
  return saved || {};
}

export async function setOutputPreferences(values, storage = chrome.storage.local) {
  const output_dir = normalizeDirectory(values.output_dir);
  const updated_at = values.updated_at ?? Date.now();
  if (!Number.isSafeInteger(updated_at) || updated_at < 0) throw new Error('保存时间无效。');
  const next = { output_dir, updated_at };
  await storage.set({ [SETTINGS_KEY]: next });
  return next;
}
