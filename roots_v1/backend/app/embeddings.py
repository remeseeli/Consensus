from functools import lru_cache
from typing import Iterable

from openai import OpenAI

from app.config import settings


@lru_cache(maxsize=1)
def _get_local_model():
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(settings.embedding_model)


@lru_cache(maxsize=1)
def _get_openai_client() -> OpenAI:
    kwargs = {"api_key": settings.openai_api_key}
    if settings.openai_base_url:
        kwargs["base_url"] = settings.openai_base_url
    return OpenAI(**kwargs)


def embed_texts(texts: Iterable[str]) -> list[list[float]]:
    items = [t.strip() or " " for t in texts]
    if not items:
        return []

    if settings.embedding_provider == "openai":
        client = _get_openai_client()
        resp = client.embeddings.create(model=settings.embedding_model, input=items)
        return [d.embedding for d in resp.data]

    model = _get_local_model()
    vectors = model.encode(items, normalize_embeddings=True, show_progress_bar=False)
    return [v.tolist() for v in vectors]


def embed_text(text: str) -> list[float]:
    return embed_texts([text])[0]