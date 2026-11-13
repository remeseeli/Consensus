import argparse
import asyncio
import re
from dataclasses import dataclass

from app.db import upsert_chunk, wait_for_db
from app.embeddings import embed_texts
from app.wiki_client import WikiClient

DEFAULT_SEED_TOPICS = [
    "Knowledge graph",
    "Retrieval-augmented generation",
    "Semantic search",
    "Vector database",
    "MariaDB",
    "Artificial intelligence",
    "Large language model",
    "Natural language processing",
    "Information retrieval",
    "Transformer (deep learning architecture)",
    "Word embedding",
    "Mind map",
    "Graph database",
    "PageRank",
    "Wikipedia",
    "Attention (machine learning)",
    "Cosine similarity",
    "Tf-idf",
    "Hierarchical navigable small world",
    "Relational database",
]

SECTION_RE = re.compile(r"^(={2,4})\s*(.+?)\s*\1\s*$", re.MULTILINE)
SKIP_SECTIONS = {"see also", "references", "external links", "further reading", "notes", "bibliography"}


@dataclass
class TextChunk:
    section: str
    index: int
    text: str


def split_sections(full_text: str) -> list[tuple[str, str]]:
    matches = list(SECTION_RE.finditer(full_text))
    sections: list[tuple[str, str]] = []

    intro_end = matches[0].start() if matches else len(full_text)
    intro_text = full_text[:intro_end].strip()
    if intro_text:
        sections.append(("Introduction", intro_text))

    for i, match in enumerate(matches):
        heading = match.group(2).strip()
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(full_text)
        body = full_text[start:end].strip()
        if heading.lower() not in SKIP_SECTIONS and len(body) > 60:
            sections.append((heading, body))

    return sections


def chunk_article(full_text: str, max_chars: int = 800, overlap_chars: int = 150) -> list[TextChunk]:
    chunks: list[TextChunk] = []
    chunk_idx = 0

    for section_title, body in split_sections(full_text):
        paragraphs = [p.strip() for p in re.split(r"\n{2,}", body) if p.strip()]
        sentences: list[str] = []
        for p in paragraphs:
            sentences.extend(re.split(r"(?<=[.!?])\s+", p))

        current = ""
        for sent in sentences:
            sent = sent.strip()
            if not sent:
                continue
            if len(current) + len(sent) + 1 <= max_chars:
                current = f"{current} {sent}".strip()
            else:
                if len(current) >= 80:
                    chunks.append(TextChunk(section=section_title, index=chunk_idx, text=current))
                    chunk_idx += 1
                    overlap = current[-overlap_chars:] if len(current) > overlap_chars else current
                    current = f"{overlap} {sent}".strip()
                else:
                    current = f"{current} {sent}".strip()

        if len(current) >= 80:
            chunks.append(TextChunk(section=section_title, index=chunk_idx, text=current))
            chunk_idx += 1

    return chunks


async def ingest_topics(topics: list[str], expand_hops: int = 0, max_linked: int = 3) -> None:
    wait_for_db()
    wiki = WikiClient()

    queue = list(dict.fromkeys(topics))
    visited: set[str] = set()

    if expand_hops > 0:
        seed_count = len(queue)
        for seed in queue[:seed_count]:
            page = await wiki.resolve_topic(seed)
            if page:
                links = [l["title"] for l in page.get("links", [])[:max_linked]]
                for l in links:
                    if l not in queue:
                        queue.append(l)

    total_chunks = 0
    for topic in queue:
        resolved = await wiki.resolve_topic(topic)
        if not resolved:
            print(f"[SKIP] Not found: {topic}")
            continue

        title = resolved["title"]
        if title in visited:
            continue
        visited.add(title)

        article = await wiki.get_full_article(title)
        if not article:
            print(f"[SKIP] No text: {title}")
            continue

        chunks = chunk_article(article["text"])
        if not chunks:
            print(f"[SKIP] Empty chunks: {title}")
            continue

        # Prefix section & title for richer semantic embeddings
        embed_inputs = [
            f"{article['title']} — {c.section}: {c.text}" for c in chunks
        ]
        vectors = embed_texts(embed_inputs)

        for chunk, vec in zip(chunks, vectors):
            upsert_chunk(
                article_title=article["title"],
                article_url=article["url"],
                section_title=chunk.section,
                chunk_index=chunk.index,
                chunk_text=chunk.text,
                embedding=vec,
            )

        total_chunks += len(chunks)
        print(f"[OK] {article['title']}: stored {len(chunks)} chunks")

    print(f"Ingestion complete. Articles={len(visited)}, Chunks={total_chunks}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest Wikipedia articles into MariaDB VECTOR store.")
    parser.add_argument("--topics", nargs="*", help="List of Wikipedia topics to ingest.")
    parser.add_argument("--expand-links", type=int, default=0, help="Expand 1 hop of linked articles (0 or 1).")
    parser.add_argument("--max-linked", type=int, default=2, help="Max linked articles per seed topic.")
    args = parser.parse_args()

    topics = args.topics if args.topics else DEFAULT_SEED_TOPICS
    asyncio.run(ingest_topics(topics, expand_hops=args.expand_links, max_linked=args.max_linked))


if __name__ == "__main__":
    main()