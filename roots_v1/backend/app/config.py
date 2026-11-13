import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    db_host: str = os.getenv("DB_HOST", "localhost")
    db_port: int = int(os.getenv("DB_PORT", "3306"))
    db_user: str = os.getenv("DB_USER", "wiki_user")
    db_password: str = os.getenv("DB_PASSWORD", "wiki_pass")
    db_name: str = os.getenv("DB_NAME", "wiki_rag")

    embedding_provider: str = os.getenv("EMBEDDING_PROVIDER", "local")  # local | openai
    embedding_model: str = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
    embedding_dim: int = int(os.getenv("EMBEDDING_DIM", "384"))

    llm_provider: str = os.getenv("LLM_PROVIDER", "auto")  # auto | openai | extractive
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    openai_base_url: str = os.getenv("OPENAI_BASE_URL", "")
    llm_model: str = os.getenv("LLM_MODEL", "gpt-4o-mini")

    topic_cache_ttl_hours: int = int(os.getenv("TOPIC_CACHE_TTL_HOURS", "24"))
    rag_top_k: int = int(os.getenv("RAG_TOP_K", "6"))
    wiki_user_agent: str = os.getenv(
        "WIKI_USER_AGENT",
        "WikiMindMapRAG/1.0 (https://github.com/example/wiki-mindmap-rag)"
    )


settings = Settings()