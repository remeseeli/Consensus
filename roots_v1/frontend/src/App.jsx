import { useEffect, useState } from "react";
import { askRagQuestion, fetchHealth, fetchTopicMindMap } from "./api";
import MindMapBoard from "./components/MindMapBoard";
import AnswerPanel from "./components/AnswerPanel";

const QUESTION_START =
  /^(what|how|why|who|when|where|which|is|are|was|were|does|do|did|can|could|should|will|would)\b/i;

function isQuestion(text) {
  return text.endsWith("?") || QUESTION_START.test(text) || text.split(/\s+/).length > 4;
}

export default function App() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("auto"); // auto | topic | rag
  const [status, setStatus] = useState("Ready to explore.");
  const [loading, setLoading] = useState(false);
  const [maps, setMaps] = useState([]);
  const [ragResult, setRagResult] = useState(null);
  const [kbStats, setKbStats] = useState(null);

  useEffect(() => {
    fetchHealth()
      .then((h) => setKbStats(h.knowledge_base))
      .catch(() => {});
  }, []);

  async function runQuery(text, forcedMode = mode) {
    const clean = text.trim();
    if (!clean || loading) return;

    const runRag = forcedMode === "rag" || (forcedMode === "auto" && isQuestion(clean));
    setLoading(true);
    setStatus(
      runRag
        ? "Embedding question & searching MariaDB vectors..."
        : `Expanding "${clean}" from Wikipedia link graph...`
    );

    try {
      if (runRag) {
        const res = await askRagQuestion(clean);
        setRagResult(res);
        setMaps((prev) => [
          ...prev,
          { id: crypto.randomUUID(), kind: "rag", tree: res.tree }
        ]);
        setStatus(`Answer grounded in ${res.sources.length} Wikipedia article(s).`);
      } else {
        const res = await fetchTopicMindMap(clean);
        setMaps((prev) => [
          ...prev,
          { id: crypto.randomUUID(), kind: "topic", cached: res.cached, tree: res.tree }
        ]);
        const count = res.tree?.children?.length || 0;
        setStatus(
          `Mapped ${count} related topics for "${res.topic}"${res.cached ? " (from cache)" : ""}.`
        );
      }
    } catch (err) {
      setStatus(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    runQuery(query, mode);
  }

  function handlePickExample(exampleText, exampleMode) {
    setQuery(exampleText);
    setMode(exampleMode);
    runQuery(exampleText, exampleMode);
  }

  function handleRemoveMap(id) {
    setMaps((prev) => prev.filter((m) => m.id !== id));
  }

  return (
    <div className="wrap">
      <header>
        <div className="header-top">
          <div className="brand">
            <h1>Wiki Mind Map</h1>
            <p className="tagline">
              Explore Wikipedia link graphs or ask questions grounded in MariaDB Vector Search.
            </p>
          </div>
          {kbStats && (
            <span className="kb-pill">
              <span className="kb-dot" />
              MariaDB KB: {kbStats.articles} articles · {kbStats.chunks} chunks
            </span>
          )}
        </div>
      </header>

      <form onSubmit={handleSubmit} className="search-form">
        <select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Query mode">
          <option value="auto">Auto-detect</option>
          <option value="topic">Topic Map</option>
          <option value="rag">Ask Q&amp;A (RAG)</option>
        </select>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Enter a topic or ask a natural-language question..."
          required
        />
        <button type="submit" disabled={loading}>
          {loading ? "Growing…" : "Explore"}
        </button>
      </form>

      <div id="status" className={loading ? "is-loading" : ""}>
        <span className="status-dot" />
        <span>{status}</span>
      </div>

      <MindMapBoard
        maps={maps}
        onRemove={handleRemoveMap}
        onPickExample={handlePickExample}
      />
      <AnswerPanel ragResult={ragResult} />
    </div>
  );
}