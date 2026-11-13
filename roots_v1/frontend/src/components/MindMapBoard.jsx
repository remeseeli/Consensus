import { useEffect, useRef } from "react";
import MindMapCard from "./MindMapCard";

const EXAMPLE_TOPICS = ["Knowledge graph", "MariaDB", "Quantum computing"];
const EXAMPLE_QUESTIONS = [
  "How does retrieval-augmented generation work?",
  "What is cosine similarity in vector search?"
];

export default function MindMapBoard({ maps, onRemove, onPickExample }) {
  const boardRef = useRef(null);

  useEffect(() => {
    if (boardRef.current && maps.length > 0) {
      boardRef.current.scrollTo({
        left: boardRef.current.scrollWidth,
        behavior: "smooth"
      });
    }
  }, [maps.length]);

  return (
    <div id="map" ref={boardRef}>
      <div className="soil-stage">
        <div className="soil-horizon" aria-hidden="true" />
        <div className="soil-pebbles" aria-hidden="true" />

        {maps.length === 0 ? (
          <div className="empty-board">
            <div className="empty-sprout" aria-hidden="true">
              <svg width="58" height="58" viewBox="-29 -40 58 58">
                <ellipse cx="0" cy="10" rx="18" ry="5" fill="#2e1808" opacity="0.68" />
                <path d="M0,10 Q-1,-2 0,-16" stroke="#84a98c" strokeWidth="3.8" strokeLinecap="round" fill="none" />
                <path d="M-1,-10 Q-15,-10 -19,-24 Q-3,-25 -1,-10Z" fill="#606c38" />
                <path d="M1,-14 Q16,-14 20,-28 Q3,-29 1,-14Z" fill="#99c286" />
              </svg>
            </div>
            <h2>Plant a topic or ask a question</h2>
            <p>
              Topics sprout an interactive link-graph mind map; questions search MariaDB vectors
              for a cited Wikipedia answer.
            </p>

            {onPickExample && (
              <div className="example-chips">
                {EXAMPLE_TOPICS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="chip"
                    onClick={() => onPickExample(item, "topic")}
                  >
                    Topic: {item}
                  </button>
                ))}
                {EXAMPLE_QUESTIONS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="chip chip-rag"
                    onClick={() => onPickExample(item, "rag")}
                  >
                    Q&amp;A: {item}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="canvas-row">
            {maps.map((m) => (
              <MindMapCard key={m.id} mapItem={m} onRemove={onRemove} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}