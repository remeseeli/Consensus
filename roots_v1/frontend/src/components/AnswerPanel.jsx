import { useState } from "react";

function renderCitedAnswer(answer, passages) {
  const passageMap = new Map((passages || []).map((p) => [String(p.citation), p]));
  const parts = answer.split(/(\[\d+\])/g);

  return parts.map((part, idx) => {
    const match = part.match(/^\[(\d+)\]$/);
    if (!match) return <span key={idx}>{part}</span>;
    const passage = passageMap.get(match[1]);
    if (!passage) {
      return (
        <span key={idx} className="cite-chip">
          {part}
        </span>
      );
    }
    return (
      <a
        key={idx}
        className="cite-chip"
        href={passage.url}
        target="_blank"
        rel="noopener noreferrer"
        title={`${passage.title} — ${passage.section}`}
      >
        {part}
      </a>
    );
  });
}

export default function AnswerPanel({ ragResult }) {
  const [showPassages, setShowPassages] = useState(false);

  if (!ragResult) return null;

  return (
    <section id="answer">
      <div className="answer-header">
        <div>
          <span className="answer-eyebrow">Wikipedia Grounded Synthesis</span>
          <h3>{ragResult.question}</h3>
        </div>
        <span className="mode-pill">Mode: {ragResult.mode}</span>
      </div>

      <p className="answer-text">{renderCitedAnswer(ragResult.answer, ragResult.passages)}</p>

      <div className="sources-block">
        <span className="sources-label">Referenced Articles</span>
        <div className="source-cards">
          {ragResult.sources.map((src) => {
            const pct = Math.min(100, Math.round(src.similarity * 100));
            return (
              <a
                key={src.url}
                href={src.url}
                target="_blank"
                rel="noopener noreferrer"
                className="source-card"
              >
                <div className="source-card-top">
                  <span className="source-title">{src.title} ↗</span>
                  <span className="sim-score">{pct}%</span>
                </div>
                <div className="sim-bar-track">
                  <div className="sim-bar-fill" style={{ width: `${pct}%` }} />
                </div>
              </a>
            );
          })}
        </div>
      </div>

      {ragResult.passages?.length > 0 && (
        <div className="passages-block">
          <button
            type="button"
            className="toggle-passages"
            onClick={() => setShowPassages((v) => !v)}
          >
            {showPassages
              ? "Hide retrieved MariaDB passages"
              : `Inspect ${ragResult.passages.length} retrieved MariaDB passages`}
          </button>

          {showPassages && (
            <div className="passage-list">
              {ragResult.passages.map((p) => (
                <div key={`${p.citation}-${p.title}`} className="passage-item">
                  <div className="passage-meta">
                    <span className="cite-chip">[{p.citation}]</span>
                    <a href={p.url} target="_blank" rel="noopener noreferrer">
                      {p.title} — {p.section}
                    </a>
                    <span className="passage-sim">
                      {Math.round(p.similarity * 100)}% cosine similarity
                    </span>
                  </div>
                  <p>{p.excerpt}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}