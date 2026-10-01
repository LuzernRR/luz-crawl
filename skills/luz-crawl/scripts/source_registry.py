#!/usr/bin/env python3
"""Static source metadata; runtime probes still decide what is usable."""

from __future__ import annotations

from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse


PLATFORM_CATALOG: dict[str, dict] = {
    "github": {
        "label": "GitHub",
        "aliases": ("github", "gh"),
        "domains": ("github.com",),
        "opencli_site": "github",
        "route_key": "gh",
        "purpose": "Repositories, code, releases, issues, and implementation evidence",
    },
    "1688": {
        "label": "1688 / 阿里巴巴",
        "aliases": ("1688", "阿里巴巴", "阿里巴巴1688"),
        "domains": ("1688.com", "open.1688.com"),
        "opencli_site": "1688",
        "route_key": "1688",
        "purpose": "供应商、商品、店铺和工厂线索",
        "limitation": (
            "OpenCLI 搜索结果是候选；需逐条核对商品页/店铺页。登录或验证状态可能阻断搜索，"
            "不得自动发起登录、短信验证或绕过页面限制。生产 API 需按阿里开放平台授权接入。"
        ),
    },
    "qichacha": {
        "label": "企查查开放平台",
        "aliases": ("qichacha", "企查查", "qcc"),
        "domains": ("qcc.com", "openapi.qcc.com", "api.qichacha.com"),
        "route_key": "qichacha",
        "purpose": "企业候选发现、工商字段核验和风险信息补充",
        "limitation": (
            "官方 API 需企业实名认证、接口开通与应用场景审核；需在本机安全配置 QCC_APP_KEY / "
            "QCC_SECRET_KEY。预检不会展示密钥，也不会发起计费 API 请求。"
        ),
    },
    "gsxt": {
        "label": "国家企业信用信息公示系统",
        "aliases": ("gsxt", "国家企业信用信息公示系统", "企业公示系统"),
        "domains": ("gsxt.gov.cn", "bt.gsxt.gov.cn"),
        "route_key": "gsxt",
        "purpose": "核对企业登记状态、年报及经营异常等官方公示信息",
        "limitation": "可能要求网页验证码或人工验证；不得绕过访问控制。",
    },
    "shenzhen_home_directories": {
        "label": "深圳家居行业与政府目录",
        "aliases": ("深圳家居行业", "深圳家具行业协会", "深圳家居企业目录"),
        "domains": (
            "szfa.com", "cff.szfa.com", "sz.gov.cn", "amr.sz.gov.cn", "fgw.sz.gov.cn",
        ),
        "route_key": "shenzhen_home_directories",
        "purpose": "发现深圳家居/家具企业、行业协会会员和政府公开企业名录",
        "limitation": "目录与会员名册只用于发现候选；逐家核对企业官网、主营和联系入口。",
    },
    "x": {
        "label": "X",
        "aliases": ("x", "twitter"),
        "domains": ("x.com",),
        "opencli_site": "twitter",
        "route_key": "twitter",
        "purpose": "X posts, accounts, and discussions",
        "retention": "Generic local index keeps only source URL/platform until current developer terms are checked.",
    },
    "xiaohongshu": {
        "label": "小红书",
        "aliases": ("xiaohongshu", "小红书", "xhs"),
        "domains": ("xiaohongshu.com",),
        "opencli_site": "xiaohongshu",
        "route_key": "xiaohongshu",
        "purpose": "小红书笔记、商品和评论",
        "limitation": "笔记详情可读性取决于登录态和有效笔记链接。",
    },
    "zhihu": {
        "label": "知乎",
        "aliases": ("zhihu", "知乎"),
        "domains": ("zhihu.com",),
        "opencli_site": "zhihu",
        "route_key": "zhihu",
        "purpose": "知乎回答、文章和问题",
        "limitation": "登录状态会影响结果数量和详情可读性。",
    },
    "wechat": {
        "label": "微信公众号",
        "aliases": ("wechat", "weixin", "公众号", "微信公众号"),
        "domains": ("weixin.sogou.com", "mp.weixin.qq.com"),
        "opencli_site": "weixin",
        "route_key": "wechat",
        "purpose": "微信公众号文章",
        "limitation": "OpenCLI 搜索使用搜狗微信文章索引，不等同于微信客户端站内搜索。",
    },
    "reddit": {
        "label": "Reddit",
        "aliases": ("reddit",),
        "domains": ("reddit.com",),
        "route_key": "reddit",
        "purpose": "社区讨论、使用体验和比较",
    },
    "youtube": {
        "label": "YouTube",
        "aliases": ("youtube",),
        "domains": ("youtube.com",),
        "route_key": "youtube",
        "purpose": "视频、字幕和评论",
    },
    "bilibili": {
        "label": "哔哩哔哩",
        "aliases": ("bilibili", "哔哩哔哩", "b站"),
        "domains": ("bilibili.com",),
        "route_key": "bilibili",
        "purpose": "视频、字幕和评论",
    },
    "v2ex": {
        "label": "V2EX",
        "aliases": ("v2ex",),
        "domains": ("v2ex.com",),
        "route_key": "v2ex",
        "purpose": "开发者讨论和经验",
    },
}


ALIAS_TO_PLATFORM = {
    alias.lower(): platform
    for platform, entry in PLATFORM_CATALOG.items()
    for alias in entry["aliases"]
}

OPENCLI_SITE_BY_PLATFORM = {
    alias.lower(): entry["opencli_site"]
    for entry in PLATFORM_CATALOG.values()
    if entry.get("opencli_site")
    for alias in entry["aliases"]
}


def normalize_platform(value: str) -> str:
    normalized = value.strip().lower()
    return ALIAS_TO_PLATFORM.get(normalized, normalized)


def safe_source_url(value: str) -> str:
    """Canonicalize a saved source link while dropping token-like query values."""
    parsed = urlparse(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return ""
    secret_keys = {
        "xsec_token", "access_token", "refresh_token", "token", "auth",
        "authorization", "cookie", "session", "signature", "sig",
    }
    query = urlencode([
        (key, item) for key, item in parse_qsl(parsed.query, keep_blank_values=True)
        if key.lower() not in secret_keys
    ])
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path, parsed.params, query, ""))


def planned_sites(platforms: list[str]) -> list[dict]:
    """Return human-readable website targets without implying route availability."""
    results: list[dict] = []
    seen: set[str] = set()
    for value in platforms:
        key = normalize_platform(value)
        entry = PLATFORM_CATALOG.get(key)
        if not entry or key in seen:
            continue
        seen.add(key)
        results.append({
            "platform": key,
            "label": entry["label"],
            "domains": list(entry["domains"]),
            "limitation": entry.get("limitation", ""),
            "retention": entry.get("retention", ""),
            "contact_policy": entry.get("contact_policy", ""),
        })
    return results
