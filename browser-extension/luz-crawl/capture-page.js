export async function collectVisibleResults({ delayMs = 1400, sourceId = "" } = {}) {
  // Let client-rendered result cards settle after the tab reports complete.
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));

  const scrub = (value) => String(value ?? "")
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, "[手机号已省略]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[邮箱已省略]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);

  const isVisible = (element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  };

  const root = document.querySelector("main, [role='main'], #content, #main") || document.body;
  const pageText = (document.body?.innerText || "").slice(0, 2400);
  const pagePath = `${location.pathname} ${location.search}`.toLowerCase();
  let blockReason = null;
  if (/安全验证|滑动验证|请完成验证|访问频繁|异常访问|人机验证|unusual traffic|verify you are human|captcha/i.test(pageText)
      || /captcha|challenge|security-check/i.test(pagePath)) {
    blockReason = "页面要求完成安全验证";
  } else if (/\/login|\/signin|\/passport|\/auth|\/onboarding(?:\/|$)|[?&]mode=login(?:&|$)/i.test(pagePath)
      || (document.querySelector("input[type='password']")
        && /扫码登录|账号密码登录|请登录后|登录以继续|sign in to|log in to|password/i.test(pageText))) {
    blockReason = "页面要求登录";
  }

  const safePageUrl = () => {
    const current = new URL(location.href);
    for (const key of [...current.searchParams.keys()]) {
      if (/^(xsec_token|access_token|auth|auth_code|signature|session|cookie)$/i.test(key)) {
        current.searchParams.delete(key);
      }
    }
    current.hash = "";
    return current.toString();
  };

  if (blockReason) {
    return {
      title: scrub(document.title),
      url: safePageUrl(),
      capturedAt: new Date().toISOString(),
      links: [],
      blockReason,
    };
  }

  const seen = new Set();
  const links = [];
  const chromeTitles = new Set([
    "去安装", "找货源", "找工厂", "找供应商", "找代发", "工业品", "找服务", "一钻工厂", "二钻工厂", "7x24H响应",
    "点此可以直接和卖家交流选好的宝贝，或相互交流网购体验，还支持语音视频噢。",
    "阿里巴巴集团", "阿里巴巴国际站", "1688", "全球速卖通", "淘宝网", "阿里妈妈", "阿里云计算",
    "AliOS", "阿里通信", "支付宝", "阿里健康", "跨境供应链", "Lazada", "达摩院", "阿里安全",
    "淘宝海外", "联系我们", "知识产权保护", "著作权与商标声明", "廉正举报", "法律声明", "服务条款",
    "隐私政策", "网站导航", "帮助中心", "意见反馈", "关于我们", "首页", "登录", "注册",
  ]);
  const isChromeLink = (url, title) => {
    if (chromeTitles.has(title)) return true;
    if (sourceId !== "1688" && sourceId !== "1688_products") return false;

    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (["amos.alicdn.com", "fuwu.1688.com", "air.1688.com", "dj.1688.com"].includes(host)) return true;
    if (host === "sale.1688.com" && path === "/factory/bd_jpzz.html") return true;
    if (["www.alibabagroup.com", "www.alibaba.com", "www.aliexpress.com", "www.taobao.com",
      "www.alimama.com", "www.aliyun.com", "www.alios.cn", "aliqin.tmall.com", "www.alihealth.cn",
      "onetouch.alibaba.com", "taobao.lazada.sg", "damo.alibaba.com", "s.alibaba.com", "world.taobao.com",
      "114.1688.com", "page.1688.com", "rule.1688.com", "taotian.jubao.alibaba.com"].includes(host)) return true;
    if (host === "s.1688.com" && [
      "/selloffer/offer_search.htm", "/company/pc/factory_search.htm", "/company/company_search.htm", "/selloffer/imall_search.htm",
    ].includes(path)) return true;
    return false;
  };

  for (const anchor of root.querySelectorAll("a[href]")) {
    if (!isVisible(anchor)) continue;
    let url;
    try {
      url = new URL(anchor.href, location.href);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;

    if ((sourceId === "1688" || sourceId === "1688_products")
        && /(^|\.)1688\.com$/i.test(url.hostname)) {
      // Keep only stable item/company identifiers; discard advertising and session tracking values.
      const stableParams = new Set(["offerid", "id", "companyid", "memberid"]);
      for (const key of [...url.searchParams.keys()]) {
        if (!stableParams.has(key.toLowerCase())) url.searchParams.delete(key);
      }
    }

    // Drop session and signed-access values before storing a source URL locally.
    for (const key of [...url.searchParams.keys()]) {
      if (/^(xsec_token|access_token|auth|auth_code|signature|session|cookie)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";

    const title = scrub(anchor.innerText || anchor.getAttribute("aria-label") || anchor.title);
    const normalizedUrl = url.toString();
    if (title.length < 3 || isChromeLink(url, title) || seen.has(normalizedUrl)) continue;
    seen.add(normalizedUrl);
    links.push({ title, url: normalizedUrl });
    if (links.length >= 40) break;
  }

  return {
    title: scrub(document.title),
    url: safePageUrl(),
    capturedAt: new Date().toISOString(),
    links,
    blockReason: null,
  };
}
