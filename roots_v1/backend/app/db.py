import json
import time
from contextlib import contextmanager
from typing import Any, Generator

import pymysql
from pymysql.cursors import DictCursor

from app.config import settings


def get_connection() -> pymysql.Connection:
    return pymysql.connect(
        host=settings.db_host,
        port=settings.db_port,
        user=settings.db_user,
        password=settings.db_password,
        database=settings.db_name,
        charset="utf8mb4",
        cursorclass=DictCursor,
        autocommit=True,
    )


@contextmanager
def db_cursor() -> Generator[DictCursor, None, None]:
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            yield cursor
    finally:
        conn.close()


def wait_for_db(max_retries: int = 20, delay_sec: float = 2.0) -> None:
    last_err: Exception | None = None
    for _ in range(max_retries):
        try:
            with db_cursor() as cur:
                cur.execute("SELECT 1")
            return
        except Exception as exc:
            last_err = exc
            time.sleep(delay_sec)
    raise RuntimeError(f"Database unavailable after {max_retries} attempts: {last_err}")


def vector_to_sql_text(vec: list[float]) -> str:
    # MariaDB VEC_FromText accepts JSON-style array string '[0.1, -0.2, ...]'
    return json.dumps([round(float(x), 6) for x in vec])


def search_similar_chunks(query_embedding: list[float], top_k: int) -> list[dict[str, Any]]:
    vec_str = vector_to_sql_text(query_embedding)
    sql = """
        SELECT
            id,
            article_title,
            article_url,
            section_title,
            chunk_index,
            chunk_text,
            VEC_DISTANCE_COSINE(embedding, VEC_FromText(%s)) AS distance
        FROM wiki_chunks
        ORDER BY distance ASC
        LIMIT %s
    """
    with db_cursor() as cur:
        cur.execute(sql, (vec_str, top_k))
        rows = cur.fetchall()
    return list(rows)


def upsert_chunk(
    article_title: str,
    article_url: str,
    section_title: str,
    chunk_index: int,
    chunk_text: str,
    embedding: list[float],
) -> None:
    vec_str = vector_to_sql_text(embedding)
    sql = """
        INSERT INTO wiki_chunks (
            article_title, article_url, section_title, chunk_index, chunk_text, embedding
        )
        VALUES (%s, %s, %s, %s, %s, VEC_FromText(%s))
        ON DUPLICATE KEY UPDATE
            article_url = VALUES(article_url),
            section_title = VALUES(section_title),
            chunk_text = VALUES(chunk_text),
            embedding = VALUES(embedding)
    """
    with db_cursor() as cur:
        cur.execute(
            sql,
            (
                article_title[:255],
                article_url[:1024],
                section_title[:512],
                chunk_index,
                chunk_text,
                vec_str,
            ),
        )


def get_chunk_stats() -> dict[str, int]:
    with db_cursor() as cur:
        cur.execute("SELECT COUNT(*) AS chunks, COUNT(DISTINCT article_title) AS articles FROM wiki_chunks")
        row = cur.fetchone() or {"chunks": 0, "articles": 0}
    return {"chunks": int(row["chunks"]), "articles": int(row["articles"])}