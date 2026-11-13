import json
import re
from collections import Counter
from typing import Any

from openai import OpenAI

from app.config import settings
from app.db import search_similar_chunks
from app.embeddings import embed_text
from app.wiki_client import wiki_search_url, wiki_url

STOPWORDS = {
    "the", "and", "for", "with", "that", "this", "from", "into", "about", "which",
    "where", "when", "what", "who", "how", "why", "are", "was", "were", "been",
    "being", "have", "has", "had", "does", "did", "can", "could", "would", "should",
    "also", "such", "than", "then", "them", "they", "their", "there", "these", "those",
    "used", "using", "many", "more", "most", "some", "other", "over", "between",
}


def _use_llm() -> bool:
    if settings.llm_provider == "extractive":
        return False
    if settings.llm_provider == "openai":
        return bool(settings.openai_api_key or settings.openai_base_url)
    return bool(settings.openai_api_key or settings.openai_base_url)


def _extract_concepts_fallback(text: str, sources: list[dict[str, Any]], limit: int = 7) -> list[dict[str, str]]:
    source_titles = {s["title"].lower(): s for s in sources}
    tokens = re.findall(r"[A-Za-z][A-Za-z0-9\-]{2,}", text)
    counts = Counter(t.lower() for t in tokens if t.lower() not in STOPWORDS)
    concepts: list[dict[str, str]] = []
    for word, _ in counts.most_common(limit):
        label = word.capitalize()
        matched = source_titles.get(word)
        concepts.append(
            {
                "name": label,
                "url": matched["url"] if matched else wiki_search_url(label),
            }
        )
    return concepts


def _extractive_rag(question: str, chunks: list[dict[str, Any]]) -> tuple[str, list[dict[str, str]]]:
    q_terms = {
        w for w in re.findall(r"[a-z0-9]+", question.lower())
        if len(w) > 2 and w not in STOPWORDS
    }
    selected_sentences: list[str] = []
    seen: set[str] = set()

    for idx, ch in enumerate(chunks[:4], start=1):
        sentences = re.split(r"(?<=[.!?])\s+", ch["chunk_text"].strip())
        scored = []
        for s in sentences:
            if len(s) < 25:
                continue
            words = set(re.findall(r"[a-z0-9]+", s.lower()))
            overlap = len(q_terms & words)
            scored.append((overlap, s))
        scored.sort(key=lambda x: x[0], reverse=True)
        for _, s in scored[:2]:
            if s not in seen:
                seen.add(s)
                selected_sentences.append(f"{s} [{idx}]")

    answer = " ".join(selected_sentences) if selected_sentences else chunks[0]["chunk_text"][:500] + " [1]"
    sources = [{"title": c["article_title"], "url": c["article_url"]} for c in chunks]
    concepts = _extract_concepts_fallback(answer, sources)
    return answer, concepts


def _llm_rag(question: str, chunks: list[dict[str, Any]]) -> tuple[str, list[dict[str, str]]]:
    kwargs: dict[str, Any] = {"api_key": settings.openai_api_key or "ollama"}
    if settings.openai_base_url:
        kwargs["base_url"] = settings.openai_base_url
    client = OpenAI(**kwargs)

    context_blocks = []
    for idx, ch in enumerate(chunks, start=1):
        context_blocks.append(
            f"[{idx}] Article: {ch['article_title']} | Section: {ch['section_title']}\n{ch['chunk_text']}"
        )
    context_text = "\n\n".join(context_blocks)

    system_prompt = (
        "You are a knowledgeable research assistant grounded strictly in the provided Wikipedia passages. "
        "Answer the user's question concisely and accurately using ONLY the provided passages, citing "
        "passages inline like [1], [2]. Return valid JSON with keys:\n"
        '  "answer": string (the grounded answer with inline citations),\n'
        '  "concepts": array of 5 to 8 objects with {"name": string, "wikipedia_title": string}\n'
        "representing the key concepts mentioned in your answer."
    )
    user_prompt = f"Question: {question}\n\nWikipedia Passages:\n{context_text}"

    resp = client.chat.completions.create(
        model=settings.llm_model,
        temperature=0.2,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    raw = resp.choices[0].message.content or "{}"
    parsed = json.loads(raw)
    answer = parsed.get("answer", "").strip()
    concepts_raw = parsed.get("concepts", [])

    concepts = []
    for c in concepts_raw[:8]:
        name = str(c.get("name", "")).strip()
        wiki_title = str(c.get("wikipedia_title", "")).strip() or name
        if name:
            concepts.append({"name": name, "url": wiki_url(wiki_title)})

    if not concepts:
        sources = [{"title": c["article_title"], "url": c["article_url"]} for c in chunks]
        concepts = _extract_concepts_fallback(answer, sources)

    return answer, concepts


def answer_question(question: str, top_k: int | None = None) -> dict[str, Any]:
    k = top_k or settings.rag_top_k
    q_vec = embed_text(question)
    chunks = search_similar_chunks(q_vec, k)

    if not chunks:
        raise ValueError(
            "The knowledge base is empty. Run the ingestion job (`python ingest.py`) first."
        )

    if _use_llm():
        try:
            answer, concepts = _llm_rag(question, chunks)
            mode = "llm"
        except Exception:
            answer, concepts = _extractive_rag(question, chunks)
            mode = "extractive-fallback"
    else:
        answer, concepts = _extractive_rag(question, chunks)
        mode = "extractive"

    # Deduplicate sources while preserving citation index mapping
    sources: list[dict[str, Any]] = []
    seen_articles: set[str] = set()
    passages: list[dict[str, Any]] = []

    for idx, ch in enumerate(chunks, start=1):
        similarity = max(0.0, round(1.0 - float(ch["distance"]), 4))
        section_url = wiki_url(ch["article_title"], ch["section_title"])
        passages.append(
            {
                "citation": idx,
                "title": ch["article_title"],
                "section": ch["section_title"],
                "url": section_url,
                "similarity": similarity,
                "excerpt": ch["chunk_text"],
            }
        )
        if ch["article_title"] not in seen_articles:
            seen_articles.add(ch["article_title"])
            sources.append(
                {
                    "title": ch["article_title"],
                    "url": ch["article_url"],
                    "similarity": similarity,
                }
            )

    short_q = question if len(question) <= 42 else question[:39].rstrip() + "..."
    tree = {
        "name": short_q,
        "url": None,
        "children": [
            {
                "name": "Key Concepts",
                "url": None,
                "children": concepts,
            },
            {
                "name": "Sources",
                "url": None,
                "children": [{"name": s["title"], "url": s["url"]} for s in sources],
            },
        ],
    }

    return {
        "question": question,
        "answer": answer,
        "mode": mode,
        "sources": sources,
        "passages": passages,
        "tree": tree,
    }