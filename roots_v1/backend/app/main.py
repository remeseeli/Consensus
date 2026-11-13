from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.db import get_chunk_stats, wait_for_db
from app.rag import answer_question
from app.topic_expander import expand_topic


@asynccontextmanager
async def lifespan(_: FastAPI):
    wait_for_db()
    yield


app = FastAPI(
    title="Wiki Mind Map & RAG API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class RagRequest(BaseModel):
    question: str = Field(..., min_length=3, max_length=500)
    top_k: int = Field(default=6, ge=1, le=15)


@app.get("/api/health")
def health():
    stats = get_chunk_stats()
    return {"status": "ok", "knowledge_base": stats}


@app.get("/api/mindmap")
async def get_mindmap(
    topic: str = Query(..., min_length=1, max_length=200),
    max_branches: int = Query(default=12, ge=3, le=20),
):
    try:
        return await expand_topic(topic, max_branches=max_branches)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Topic expansion failed: {exc}") from exc


@app.post("/api/rag")
def post_rag(req: RagRequest):
    try:
        return answer_question(req.question, top_k=req.top_k)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"RAG query failed: {exc}") from exc