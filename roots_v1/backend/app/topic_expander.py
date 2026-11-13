import json
from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np

from app.config import settings
from app.db import db_cursor
from app.embeddings import embed_texts
from app.wiki_client import WikiClient, wiki_url

NOISE_PREFIXES = ("List of ", "Outline of ", "Index of ", "Glossary of ", "Portal:", "Wikipedia:")
NOISE_CAT_WORDS = ("articles", "pages", "wikipedia", "commons", "wikidata", "redirects", "stubs")


def _cosine(a: list[float], b: list[float]) -> float:
    va = np.asarray(a, dtype=np.float32)
    vb = np.asarray(b, dtype=np.float32)
    denom = float(np.linalg.norm(va) * np.linalg.norm(vb))
    return float(np.dot(va, vb) / denom) if denom > 0 else 0.0


def _clean_title(title: str, root_title: str) -> bool:
    if not title or title.lower() == root_title.lower():
        return False
    if title.startswith(NOISE_PREFIXES):
        return False
    if title.isdigit() and len(title) == 4:  # skip bare years
        return False
    return True


def _get_cached_map(topic_key: str) -> dict[str, Any] | None:
    with db_cursor() as cur:
        cur.execute(
            """
            SELECT tree_json
            FROM topic_cache
            WHERE topic_key = %s AND expires_at > UTC_TIMESTAMP()
            """,
            (topic_key,),
        )
        row = cur.fetchone()
    if not row:
        return None
    payload = json.loads(row["tree_json"])
    payload["cached"] = True
    return payload


def _save_cached_map(topic_key: str, canonical_title: str, payload: dict[str, Any]) -> None:
    expires_at = datetime.now(timezone.utc) + timedelta(hours=settings.topic_cache_ttl_hours)
    with db_cursor() as cur:
        cur.execute(
            """
            INSERT INTO topic_cache (topic_key, canonical_title, tree_json, expires_at)
            VALUES (%s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                canonical_title = VALUES(canonical_title),
                tree_json = VALUES(tree_json),
                expires_at = VALUES(expires_at)
            """,
            (
                topic_key,
                canonical_title[:255],
                json.dumps(payload),
                expires_at.strftime("%Y-%m-%d %H:%M:%S"),
            ),
        )


async def expand_topic(topic: str, max_branches: int = 12) -> dict[str, Any]:
    normalized_key = " ".join(topic.strip().lower().split())
    cached = _get_cached_map(normalized_key)
    if cached:
        return cached

    wiki = WikiClient()
    page = await wiki.resolve_topic(topic)
    if not page:
        raise ValueError(f"No Wikipedia article found for '{topic}'.")

    root_title = page["title"]
    canonical_key = root_title.lower()
    if canonical_key != normalized_key:
        cached_canonical = _get_cached_map(canonical_key)
        if cached_canonical:
            _save_cached_map(normalized_key, root_title, cached_canonical)
            return cached_canonical

    root_intro = (page.get("extract") or "")[:600]
    direct_links = [
        l["title"]
        for l in page.get("links", [])
        if _clean_title(l["title"], root_title)
    ]

    # Select top non-meta categories and gather sibling articles
    categories = [
        c["title"]
        for c in page.get("categories", [])
        if not any(w in c["title"].lower() for w in NOISE_CAT_WORDS)
    ][:3]

    category_siblings: dict[str, list[str]] = {}
    sibling_set: set[str] = set()
    for cat in categories:
        members = await wiki.get_category_members(cat, limit=20)
        filtered = [m for m in members if _clean_title(m, root_title)]
        category_siblings[cat.replace("Category:", "")] = filtered
        sibling_set.update(filtered)

    # Candidate pool: prioritize link-graph + category-graph overlap, cap to 40 for fast scoring
    link_set = set(direct_links)
    overlap_candidates = [t for t in direct_links if t in sibling_set]
    other_links = [t for t in direct_links if t not in sibling_set]
    other_siblings = [t for t in sibling_set if t not in link_set]

    candidates = (overlap_candidates + other_links[:25] + other_siblings[:15])[:40]
    if not candidates:
        tree = {"name": root_title, "url": wiki_url(root_title), "children": []}
        result = {"topic": root_title, "url": wiki_url(root_title), "tree": tree, "cached": False}
        _save_cached_map(normalized_key, root_title, result)
        return result

    summaries = await wiki.get_intro_summaries(candidates)

    # Score candidates using semantic similarity + graph overlap bonus
    texts_to_embed = [f"{root_title}. {root_intro}"] + [
        f"{t}. {summaries.get(t, '')[:300]}" for t in candidates
    ]
    vectors = embed_texts(texts_to_embed)
    root_vec = vectors[0]

    scored: list[dict[str, Any]] = []
    for idx, title in enumerate(candidates):
        sem_score = _cosine(root_vec, vectors[idx + 1])
        graph_bonus = 0.0
        if title in link_set and title in sibling_set:
            graph_bonus = 0.18
        elif title in link_set:
            graph_bonus = 0.08
        else:
            graph_bonus = 0.05

        scored.append(
            {
                "name": title,
                "url": wiki_url(title),
                "score": round(sem_score + graph_bonus, 4),
                "summary": summaries.get(title, "")[:180],
            }
        )

    scored.sort(key=lambda x: x["score"], reverse=True)
    top_nodes = scored[:max_branches]

    # Attach up to 2 related category siblings under the top 4 primary branches
    used_names = {root_title} | {n["name"] for n in top_nodes}
    for branch in top_nodes[:4]:
        sub_children = []
        for cat_name, members in category_siblings.items():
            if branch["name"] in members:
                for m in members:
                    if m not in used_names and len(sub_children) < 2:
                        used_names.add(m)
                        sub_children.append(
                            {
                                "name": m,
                                "url": wiki_url(m),
                                "relation": cat_name,
                            }
                        )
        if sub_children:
            branch["children"] = sub_children

    tree = {
        "name": root_title,
        "url": wiki_url(root_title),
        "children": top_nodes,
    }
    result = {
        "topic": root_title,
        "url": wiki_url(root_title),
        "categories": list(category_siblings.keys()),
        "tree": tree,
        "cached": False,
    }

    _save_cached_map(normalized_key, root_title, result)
    if canonical_key != normalized_key:
        _save_cached_map(canonical_key, root_title, result)
    return result