import test from "node:test";
import assert from "node:assert/strict";
import { collectVisibleResults } from "../luz-crawl/capture-page.js";

function withFakePage({ text = "搜索结果", href = "https://1688.example/search?q=desk&signature=secret#top", anchors = [], passwordField = false } = {}, run) {
  const previous = {
    document: globalThis.document,
    location: globalThis.location,
    getComputedStyle: globalThis.getComputedStyle,
  };
  const root = {
    querySelectorAll: () => anchors,
    querySelector: () => null,
  };
  globalThis.document = {
    title: "深圳家具搜索结果",
    body: { innerText: text, querySelectorAll: () => anchors },
    querySelector: (selector) => selector.includes("input[type='password']") ? (passwordField ? {} : null) : root,
  };
  const parsed = new URL(href);
  globalThis.location = { href, pathname: parsed.pathname, search: parsed.search };
  globalThis.getComputedStyle = () => ({ display: "block", visibility: "visible", opacity: "1" });
  return Promise.resolve().then(run).finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
}

function anchor(href, innerText, visible = true) {
  return {
    href,
    innerText,
    title: "",
    getAttribute: () => null,
    getBoundingClientRect: () => visible ? { width: 100, height: 20 } : { width: 0, height: 0 },
  };
}

test("capture keeps visible links, omits phone/email labels, and removes signed URL values", async () => {
  const result = await withFakePage({
    anchors: [
      anchor("https://supplier.example/profile?signature=secret&from=search#contact", "深圳家具供应商 13800138000 sales@example.com"),
      anchor("https://hidden.example/profile", "隐藏链接", false),
    ],
  }, () => collectVisibleResults({ delayMs: 0 }));

  assert.equal(result.links.length, 1);
  assert.match(result.links[0].title, /\[手机号已省略\]/);
  assert.match(result.links[0].title, /\[邮箱已省略\]/);
  assert.equal(result.links[0].url, "https://supplier.example/profile?from=search");
  assert.equal(result.blockReason, null);
});

test("1688 capture filters navigation, promotion, and chat links but keeps supplier details", async () => {
  const result = await withFakePage({
    anchors: [
      anchor("https://s.1688.com/company/pc/factory_search.htm?keywords=query", "找工厂"),
      anchor("https://sale.1688.com/factory/bd_jpzz.html?_topOfferId_=featured", "一钻工厂"),
      anchor("https://amos.alicdn.com/getcid.aw?uid=supplier", "7x24H响应"),
      anchor("https://rule.1688.com/policy/terms.htm", "服务条款"),
      anchor("https://detail.1688.com/offer/123.html", "深圳实木家具工厂"),
      anchor("https://www.1688.com/company/example", "深圳市家具制造有限公司"),
    ],
  }, () => collectVisibleResults({ delayMs: 0, sourceId: "1688" }));

  assert.deepEqual(result.links.map((link) => link.title), ["深圳实木家具工厂", "深圳市家具制造有限公司"]);
});

test("1688 product capture keeps item and shop pages while removing chat and tracking URLs", async () => {
  const result = await withFakePage({
    anchors: [
      anchor("https://air.1688.com/app/channel-fe/search/index.html", "找代发"),
      anchor("https://dj.1688.com/ci_bb?a=1&e=opaque-tracker", "商品推广跳转"),
      anchor("https://air.1688.com/app/ocms-fusion-components-1688/def_cbu_web_im/index.html?uid=seller", "联系卖家"),
      anchor("https://detail.m.1688.com/page/index.html?offerId=1043223269197&uuid=private&trace_log=ad", "深圳办公桌椅组合 ¥ 149 青岛玮奥达家具行"),
      anchor("https://shop618c39131y665.1688.com/?tracelog=p4p", "青岛玮奥达家具行"),
    ],
  }, () => collectVisibleResults({ delayMs: 0, sourceId: "1688_products" }));

  assert.equal(result.links.length, 2);
  assert.equal(result.links[0].url, "https://detail.m.1688.com/page/index.html?offerId=1043223269197");
  assert.equal(result.links[1].url, "https://shop618c39131y665.1688.com/");
});

test("verification pages produce no links and do not retain session-like URL parameters", async () => {
  const result = await withFakePage({
    text: "安全验证，请完成验证后继续",
    href: "https://supplier.example/challenge?session=secret#verify",
    anchors: [anchor("https://supplier.example/visible", "不应采集的链接")],
  }, () => collectVisibleResults({ delayMs: 0 }));

  assert.equal(result.blockReason, "页面要求完成安全验证");
  assert.deepEqual(result.links, []);
  assert.equal(result.url, "https://supplier.example/challenge");
});

test("login pages with a password form pause instead of saving navigation links", async () => {
  const result = await withFakePage({
    text: "账号密码登录，请输入密码",
    href: "https://supplier.example/login?next=%2Fsearch",
    passwordField: true,
    anchors: [anchor("https://supplier.example/help", "帮助中心")],
  }, () => collectVisibleResults({ delayMs: 0 }));

  assert.equal(result.blockReason, "页面要求登录");
  assert.deepEqual(result.links, []);
});

test("X onboarding redirects are identified as login handoffs", async () => {
  const result = await withFakePage({
    text: "Sign in to X",
    href: "https://x.com/i/jf/onboarding/web?redirect_after_login=%2Fsearch%3Fq%3Dtest&mode=login",
    anchors: [anchor("https://x.com/explore", "Explore")],
  }, () => collectVisibleResults({ delayMs: 0, sourceId: "x" }));

  assert.equal(result.blockReason, "页面要求登录");
  assert.deepEqual(result.links, []);
});
