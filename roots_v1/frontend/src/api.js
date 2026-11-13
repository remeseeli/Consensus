export async function fetchHealth() {
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error("Backend health check failed.");
  return res.json();
}

export async function fetchTopicMindMap(topic) {
  const params = new URLSearchParams({ topic });
  const res = await fetch(`/api/mindmap?${params.toString()}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Failed to load topic mind map.");
  return data;
}

export async function askRagQuestion(question, topK = 6) {
  const res = await fetch("/api/rag", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, top_k: topK })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Failed to answer question.");
  return data;
}