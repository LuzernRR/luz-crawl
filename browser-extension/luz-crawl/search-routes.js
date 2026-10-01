export const SEARCH_SOURCES = Object.freeze([
  {
    id: "github",
    label: "GitHub 开源项目",
    category: "代码仓库",
    domain: "github.com",
    permissionOrigin: "https://github.com/*",
    mode: "url",
    buildUrl: (query) => `https://github.com/search?q=${encodeURIComponent(query)}&type=repositories`,
  },
  {
    id: "xiaohongshu",
    label: "小红书笔记",
    category: "社交内容",
    domain: "xiaohongshu.com",
    permissionOrigin: "https://www.xiaohongshu.com/*",
    mode: "url",
    buildUrl: (query) => `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(query)}`,
  },
  {
    id: "x",
    label: "X 帖子",
    category: "社交内容",
    domain: "x.com",
    permissionOrigin: "https://x.com/*",
    mode: "url",
    buildUrl: (query) => `https://x.com/search?q=${encodeURIComponent(query)}`,
  },
  {
    id: "zhihu",
    label: "知乎内容",
    category: "问答社区",
    domain: "zhihu.com",
    permissionOrigin: "https://www.zhihu.com/*",
    mode: "url",
    buildUrl: (query) => `https://www.zhihu.com/search?type=content&q=${encodeURIComponent(query)}`,
  },
  {
    id: "weixin",
    label: "公众号文章（搜狗索引）",
    category: "文章索引",
    domain: "weixin.sogou.com",
    permissionOrigin: "https://weixin.sogou.com/*",
    mode: "url",
    buildUrl: (query) => `https://weixin.sogou.com/weixin?type=2&query=${encodeURIComponent(query)}`,
  },
  {
    id: "1688",
    label: "1688 工厂",
    category: "B2B 供应链",
    domain: "1688.com",
    permissionOrigin: ["https://www.1688.com/*", "https://s.1688.com/*"],
    mode: "gbk-form",
    entryUrl: "https://www.1688.com/",
    action: "https://s.1688.com/company/pc/factory_search.htm",
    charset: "GBK",
    field: "keywords",
  },
  {
    id: "1688_products",
    label: "1688 商品",
    category: "B2B 供应链",
    domain: "1688.com",
    permissionOrigin: ["https://www.1688.com/*", "https://s.1688.com/*"],
    mode: "gbk-form",
    entryUrl: "https://www.1688.com/",
    action: "https://s.1688.com/selloffer/offer_search.htm",
    charset: "GBK",
    field: "keywords",
  },
  {
    id: "qichacha",
    label: "企查查企业信息",
    category: "企业信息",
    domain: "qcc.com",
    permissionOrigin: "https://www.qcc.com/*",
    mode: "manual-homepage",
    homepage: "https://www.qcc.com/",
  },
  {
    id: "gsxt",
    label: "国家企业信用信息公示系统",
    category: "政府公示",
    domain: "gsxt.gov.cn",
    permissionOrigin: "https://www.gsxt.gov.cn/*",
    mode: "manual-homepage",
    homepage: "https://www.gsxt.gov.cn/",
  },
]);

export function getSearchSource(sourceId) {
  const source = SEARCH_SOURCES.find((item) => item.id === sourceId);
  if (!source) throw new Error(`不支持的搜索来源：${sourceId}`);
  return source;
}

export function getPermissionOrigins(sources = SEARCH_SOURCES) {
  return [...new Set(sources.flatMap((source) => {
    if (!source.permissionOrigin) return [];
    return Array.isArray(source.permissionOrigin) ? source.permissionOrigin : [source.permissionOrigin];
  }))];
}

export function buildSearchRequest(sourceId, rawQuery) {
  const query = String(rawQuery ?? "").trim();
  if (!query) throw new Error("请输入搜索关键词。");

  const source = getSearchSource(sourceId);
  if (source.mode === "url") {
    return { type: "url", sourceId, url: source.buildUrl(query), query };
  }
  if (source.mode === "gbk-form") {
    return {
      type: "form",
      sourceId,
      action: source.action,
      method: "get",
      charset: source.charset,
      field: source.field,
      query,
    };
  }
  return {
    type: "manual-homepage",
    sourceId,
    url: source.homepage,
    query,
  };
}

export function buildSearchPlan(sourceId, rawQuery) {
  const request = buildSearchRequest(sourceId, rawQuery);
  const source = getSearchSource(sourceId);
  const steps = request.type === "manual-homepage"
    ? [
        `复用扩展搜索标签打开 ${source.domain} 官方站点。`,
        `在站内搜索框输入并核对：${request.query}`,
        "该站点暂无可靠的自动搜索路由；搜索完成后可手动采集当前页可见链接。",
      ]
    : [
        `检查 ${source.domain} 的页面权限；可在弹窗中一次授权所有已登记来源。`,
        `复用扩展搜索标签并打开 ${source.domain} 站内搜索。`,
        `提交精确关键词：${request.query}`,
        "页面加载后由扩展自动采集最多 40 条可见结果链接。",
      ];
  return {
    tool: "Luz Crawl 浏览器扩展",
    sourceId,
    source: source.label,
    domain: source.domain,
    query: request.query,
    resultLimit: 40,
    steps,
    fallback: "若遇到登录、验证码或访问限制，停在当前页面交由用户处理；不切换浏览器、不绕过拦截。",
  };
}
