# Wiki Mind Map & RAG

An interactive Wikipedia knowledge explorer and Retrieval-Augmented Generation (RAG) Q&A app powered by **React + D3.js**, **FastAPI**, and **MariaDB 11.7+ native `VECTOR` search**.

## Features
- **Topic Mind Map**: Expands any topic using Wikipedia's link graph + category graph, ranks subtopics by structural overlap and semantic similarity, and caches results in MariaDB. Clicking any node opens its Wikipedia article.
- **Wikipedia Q&A (RAG)**: Embeds natural-language questions, retrieves top-k chunks from MariaDB using `VEC_DISTANCE_COSINE`, generates a cited answer via an LLM (with an automatic extractive fallback when no API key is set), and renders a concept mind map.

## Quick Start (Docker Compose)

1. Copy the environment file and optionally add an OpenAI-compatible key (e.g., OpenAI or local Ollama):
   ```bash
   cp .env.example .env