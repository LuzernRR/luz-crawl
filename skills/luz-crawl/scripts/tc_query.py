#!/usr/bin/env python3
"""Expand a research topic into varied, synonym-flexible search queries.

The caller (agent) supplies topic-specific synonyms; this module supplies the
structural variation. Nothing about any single topic is hard-coded here.
"""

from __future__ import annotations

import re

# Chinese interrogative scaffolding that carries no retrieval value.
_SCAFFOLD = (
    "你有哪些", "有哪些", "你们有哪些", "大家有哪些", "还有哪些",
    "你觉得", "怎么样才能", "怎么才能", "怎样才能", "如何才能",
    "是什么样的", "是怎样的", "是什么", "为什么", "怎么办",
    "怎么样", "什么样", "怎样", "如何", "哪些", "什么",
)
_TAIL = ("吗", "呢", "啊", "呀", "的", "了")
_PUNCT = "？?！!。，,、；;：:“”\"'（）()【】[]《》<>~·—-_ \t　"

# Structural templates. `{c}` is the topic core; these vary *shape*, not meaning.
_TEMPLATES_ZH = (
    "{c}",
    "{c} 技巧",
    "{c} 方法",
    "{c} 经验",
    "{c} 心得",
    "{c} 细节",
    "{c} 实战",
    "{c} 总结",
    "如何 {c}",
    "{c} 知乎 高赞",
    "{c} 公众号 文章",
    "{c} 干货 分享",
)
_TEMPLATES_SITE = (
    "site:zhihu.com {c}",
    "site:zhuanlan.zhihu.com {c}",
    "site:mp.weixin.qq.com {c}",
)


def topic_core(topic: str) -> str:
    """Strip question scaffolding and punctuation down to the retrievable core."""
    core = topic.strip().strip(_PUNCT)
    # Drop a leading "爬取文章：" / "帮我搜索:" style command prefix.
    core = re.sub(r"^[^:：]{0,12}[:：]\s*", "", core, count=1)
    changed = True
    while changed:
        changed = False
        core = core.strip(_PUNCT)
        for token in _SCAFFOLD:
            if core.startswith(token) and len(core) > len(token) + 1:
                core = core[len(token):]
                changed = True
            if core.endswith(token) and len(core) > len(token) + 1:
                core = core[: -len(token)]
                changed = True
    for token in _TAIL:
        if core.endswith(token) and len(core) > 2:
            core = core[: -len(token)]
    return core.strip(_PUNCT) or topic.strip(_PUNCT)


def expand(topic: str, synonyms: list[str] | None = None, *, limit: int = 24,
           include_site: bool = True) -> list[str]:
    """Build a de-duplicated, ordered query list from a topic plus synonyms.

    `synonyms` are alternative phrasings of the same intent, generated per run by
    the caller. Each synonym is treated as a first-class core, so every synonym
    also receives the structural templates.
    """
    cores: list[str] = []
    for candidate in [topic_core(topic), *(synonyms or [])]:
        candidate = candidate.strip(_PUNCT)
        if candidate and candidate not in cores:
            cores.append(candidate)

    queries: list[str] = []

    def push(value: str) -> None:
        value = re.sub(r"\s+", " ", value).strip()
        if value and value not in queries:
            queries.append(value)

    # Bare cores first: highest-precision, and they carry the synonym variation.
    for core in cores:
        push(core)
    # Then interleave templates across cores so no single core dominates the head.
    for template in _TEMPLATES_ZH[1:]:
        for core in cores:
            push(template.format(c=core))
    if include_site:
        for template in _TEMPLATES_SITE:
            for core in cores[:3]:
                push(template.format(c=core))
    return queries[:limit]


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("topic")
    parser.add_argument("--synonym", action="append", default=[])
    parser.add_argument("--limit", type=int, default=24)
    args = parser.parse_args()

    print(f"core: {topic_core(args.topic)}")
    for i, query in enumerate(expand(args.topic, args.synonym, limit=args.limit), 1):
        print(f"{i:>3}. {query}")
