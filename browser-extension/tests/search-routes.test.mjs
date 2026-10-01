import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildSearchPlan, buildSearchRequest, getPermissionOrigins, SEARCH_SOURCES } from "../luz-crawl/search-routes.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "luz-crawl");

test("extension manifest uses least-privilege page interaction permissions", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(new Set(manifest.permissions), new Set(["activeTab", "alarms", "scripting", "storage"]));
  assert.deepEqual(manifest.host_permissions, ["http://127.0.0.1:8765/*"]);
  assert.equal("content_scripts" in manifest, false);
  for (const origin of getPermissionOrigins()) assert.ok(manifest.optional_host_permissions.includes(origin), origin);
  for (const file of ["popup.html", "popup.js", "popup.css", "search-routes.js", "search-job.js", "capture-page.js", "background.js", "bridge-client.js"]) {
    await readFile(path.join(root, file), "utf8");
  }
});

test("source catalog groups varied source types and produces one deduplicated authorization request", () => {
  const categories = new Set(SEARCH_SOURCES.map((source) => source.category));
  assert.ok(categories.has("代码仓库"));
  assert.ok(categories.has("社交内容"));
  assert.ok(categories.has("问答社区"));
  assert.ok(categories.has("文章索引"));
  assert.ok(categories.has("B2B 供应链"));
  assert.ok(categories.has("企业信息"));
  assert.ok(categories.has("政府公示"));
  const origins = getPermissionOrigins();
  assert.equal(origins.length, new Set(origins).size);
  assert.ok(origins.includes("https://www.qcc.com/*"));
  assert.ok(origins.includes("https://www.gsxt.gov.cn/*"));
});

test("1688 query uses a GBK form request instead of a hand-built UTF-8 URL", () => {
  const request = buildSearchRequest("1688", "深圳家具工厂");
  assert.equal(request.type, "form");
  assert.equal(request.charset, "GBK");
  assert.equal(request.field, "keywords");
  assert.equal(request.query, "深圳家具工厂");
  assert.equal(request.action, "https://s.1688.com/company/pc/factory_search.htm");
  assert.equal("url" in request, false);
});

test("1688 product listings remain available as a separate route", () => {
  const request = buildSearchRequest("1688_products", "深圳家具桌椅");
  assert.equal(request.type, "form");
  assert.equal(request.action, "https://s.1688.com/selloffer/offer_search.htm");
  assert.equal(request.query, "深圳家具桌椅");
});

test("other platform routes preserve the exact query after URL decoding", () => {
  for (const source of SEARCH_SOURCES.filter((item) => item.mode === "url")) {
    const request = buildSearchRequest(source.id, "深圳 家具工厂");
    assert.equal(request.type, "url");
    const parsed = new URL(request.url);
    const query = parsed.searchParams.get(source.id === "xiaohongshu" ? "keyword" : source.id === "weixin" ? "query" : "q");
    assert.equal(query, "深圳 家具工厂", source.id);
  }
});

test("enterprise source routes open the official search homepages for visible UI search", () => {
  assert.equal(buildSearchRequest("qichacha", "深圳家具企业").url, "https://www.qcc.com/");
  assert.equal(buildSearchRequest("gsxt", "深圳家具企业").url, "https://www.gsxt.gov.cn/");
  const plan = buildSearchPlan("qichacha", "深圳家具企业");
  assert.match(plan.steps[1], /深圳家具企业/);
  assert.match(plan.fallback, /验证码/);
});

test("empty and unsupported searches fail before opening a site", () => {
  assert.throws(() => buildSearchRequest("github", "   "), /请输入搜索关键词/);
  assert.throws(() => buildSearchRequest("unknown", "query"), /不支持的搜索来源/);
});
