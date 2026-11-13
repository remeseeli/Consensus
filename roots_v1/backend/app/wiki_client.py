from typing import Any
from urllib.parse import quote

import httpx

from app.config import settings

WIKI_API = "https://en.wikipedia.org/w/api.php"


def wiki_url(title: str, section: str | None = None) -> str:
    slug = quote(title.replace(" ", "_"), safe="/:")
    url = f"https://en.wikipedia.org/wiki/{slug}"
    if section and section.lower() != "introduction":
        anchor = quote(section.replace(" ", "_"), safe="")
        url = f"{url}#{anchor}"
    return url


def wiki_search_url(term: str) -> str:
    return f"https://en.wikipedia.org/w/index.php?search={quote(term)}"


class WikiClient:
    def __init__(self) -> None:
        self._headers = {"User-Agent": settings.wiki_user_agent}

    async def query(self, params: dict[str, Any]) -> dict[str, Any]:
        merged = {"format": "json", "redirects": 1, **params}
        async with httpx.AsyncClient(timeout=20.0, headers=self._headers) as client:
            resp = await client.get(WIKI_API, params=merged)
            resp.raise_for_status()
            return resp.json()

    async def resolve_topic(self, topic: str) -> dict[str, Any] | None:
        # Try direct page lookup first
        data = await self.query(
            {
                "action": "query",
                "titles": topic,
                "prop": "links|categories|extracts",
                "plnamespace": 0,
                "pllimit": 120,
                "clshow": "!hidden",
                "cllimit": 15,
                "exintro": 1,
                "explaintext": 1,
            }
        )
        pages = list(data.get("query", {}).get("pages", {}).values())
        if pages and "missing" not in pages[0]:
            return pages[0]

        # Fallback to Wikipedia search if exact title didn't match
        search = await self.query({"action": "query", "list": "search", "srsearch": topic, "srlimit": 1})
        hits = search.get("query", {}).get("search", [])
        if not hits:
            return None

        best_title = hits[0]["title"]
        data = await self.query(
            {
                "action": "query",
                "titles": best_title,
                "prop": "links|categories|extracts",
                "plnamespace": 0,
                "pllimit": 120,
                "clshow": "!hidden",
                "cllimit": 15,
                "exintro": 1,
                "explaintext": 1,
            }
        )
        pages = list(data.get("query", {}).get("pages", {}).values())
        if pages and "missing" not in pages[0]:
            return pages[0]
        return None

    async def get_category_members(self, category_title: str, limit: int = 20) -> list[str]:
        data = await self.query(
            {
                "action": "query",
                "list": "categorymembers",
                "cmtitle": category_title,
                "cmnamespace": 0,
                "cmlimit": limit,
            }
        )
        return [m["title"] for m in data.get("query", {}).get("categorymembers", [])]

    async def get_intro_summaries(self, titles: list[str]) -> dict[str, str]:
        summaries: dict[str, str] = {}
        # MediaWiki supports up to 20 titles per extracts query
        for i in range(0, len(titles), 20):
            batch = titles[i : i + 20]
            data = await self.query(
                {
                    "action": "query",
                    "titles": "|".join(batch),
                    "prop": "extracts",
                    "exintro": 1,
                    "explaintext": 1,
                    "exchars": 400,
                    "exlimit": len(batch),
                }
            )
            for page in data.get("query", {}).get("pages", {}).values():
                if "title" in page and "extract" in page:
                    summaries[page["title"]] = page["extract"]
        return summaries

    async def get_full_article(self, title: str) -> dict[str, str] | None:
        data = await self.query(
            {
                "action": "query",
                "titles": title,
                "prop": "extracts",
                "explaintext": 1,
                "exsectionformat": "wiki",
            }
        )
        pages = list(data.get("query", {}).get("pages", {}).values())
        if not pages or "missing" in pages[0] or not pages[0].get("extract"):
            return None
        resolved_title = pages[0]["title"]
        return {
            "title": resolved_title,
            "url": wiki_url(resolved_title),
            "text": pages[0]["extract"],
        }