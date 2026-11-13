const API = "https://en.wikipedia.org/w/api.php";
const STOP = new Set("the a an and or of to in on for with is are was were be by as at from that this it its how what why which who when where do does did can could about into than then".split(" "));

const $ = id => document.getElementById(id);
const setStatus = msg => ($("status").textContent = msg);

const wikiUrl = title => "https://en.wikipedia.org/wiki/" + encodeURIComponent(title.replace(/ /g, "_"));
const searchUrl = term => "https://en.wikipedia.org/w/index.php?search=" + encodeURIComponent(term);

// Wrapper for Wikipedia API calls. origin=* enables browser (CORS) access.
async function wiki(params) {
  const url = new URL(API);
  url.search = new URLSearchParams({ format: "json", origin: "*", redirects: 1, ...params });
  const res = await fetch(url);
  if (!res.ok) throw new Error("Wikipedia request failed.");
  return res.json();
}

// ---------- Topic mind map ----------

async function mapTopic(topic) {
  if (!topic) throw new Error("Please enter a topic.");
  setStatus("Loading links for " + topic + "...");

  const data = await wiki({ action: "query", prop: "links", titles: topic, pllimit: "max", plnamespace: 0 });
  const page = Object.values(data.query.pages)[0];
  if ("missing" in page) throw new Error("No Wikipedia article found for that topic.");

  const children = (page.links || []).slice(0, 15).map(l => ({ name: l.title, url: wikiUrl(l.title) }));
  drawMap({ name: page.title, url: wikiUrl(page.title), children });
  setStatus(`Showing ${children.length} related topics. Click a node to open its article.`);
}

// ---------- RAG-style question answering (extractive, no LLM) ----------

async function askQuestion(question) {
  if (!question) throw new Error("Please enter a question.");
  setStatus("Searching Wikipedia...");

  // 1. Retrieve: find the most relevant articles.
  const search = await wiki({ action: "query", list: "search", srsearch: question, srlimit: 3 });
  const titles = search.query.search.map(r => r.title);
  if (!titles.length) throw new Error("No relevant articles found.");

  // 2. Fetch full plain-text content of those articles.
  const extracts = await wiki({ action: "query", prop: "extracts", explaintext: 1, exlimit: "max", titles: titles.join("|") });
  const pages = Object.values(extracts.query.pages).filter(p => p.extract);

  // 3. Rank sentences by keyword overlap with the question.
  const keywords = tokenize(question);
  const candidates = pages.flatMap(p =>
    splitSentences(p.extract).map(text => ({ text, title: p.title, score: overlap(text, keywords) }))
  );
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, 5).filter(c => c.score > 0);
  if (!top.length) throw new Error("Couldn't find a clear answer in the retrieved articles.");

  const sources = [...new Set(top.map(c => c.title))];
  renderAnswer(top, sources);

  // 4. Build a mind map from the question, its sources, and key concepts.
  const concepts = topTerms(top.map(c => c.text).join(" "), 8);
  drawMap({
    name: question.length > 40 ? question.slice(0, 40) + "..." : question,
    url: null,
    children: [
      { name: "Sources", children: sources.map(t => ({ name: t, url: wikiUrl(t) })) },
      { name: "Key concepts", children: concepts.map(t => ({ name: cap(t), url: searchUrl(t) })) }
    ]
  });
  setStatus(`Answer built from ${sources.length} Wikipedia article(s).`);
}

function renderAnswer(top, sources) {
  const box = $("answer");
  box.innerHTML = "";

  const heading = document.createElement("strong");
  heading.textContent = "Answer (from Wikipedia):";
  const body = document.createElement("p");
  body.textContent = top.map(c => c.text).join(" ");

  const list = document.createElement("ul");
  sources.forEach(title => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = wikiUrl(title);
    a.target = "_blank";
    a.textContent = title;
    li.appendChild(a);
    list.appendChild(li);
  });

  box.append(heading, body, document.createTextNode("Sources:"), list);
}

// ---------- Helpers ----------

function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter(w => w.length > 2 && !STOP.has(w));
}

function overlap(text, keywords) {
  const words = new Set(tokenize(text));
  return keywords.filter(k => words.has(k)).length;
}

function splitSentences(text) {
  return text.split(/(?<=[.!?])\s+/).filter(s => s.length > 30 && s.length < 400);
}

function topTerms(text, n) {
  const counts = {};
  tokenize(text).forEach(w => (counts[w] = (counts[w] || 0) + 1));
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- Mind map rendering (D3 radial tree) ----------

// ---------- Mind map rendering (roots and sprout) ----------

function drawMap(data) {
  const width = 900, height = 700;
  const radius = Math.min(width, height) / 2 - 110;

  const root = d3.hierarchy(data);
  d3.tree().size([2 * Math.PI, radius])(root);

  // Polar to Cartesian, with angle 0 pointing up.
  const project = d => [d.y * Math.sin(d.x), -d.y * Math.cos(d.x)];

  const svg = d3.select("#map").html("").append("svg")
    .attr("viewBox", [-width / 2, -height / 2, width, height]);

  // Roots: brown, round-capped paths that get thinner with each level.
  svg.append("g").selectAll("path").data(root.links()).join("path")
    .attr("d", d3.linkRadial().angle(d => d.x).radius(d => d.y))
    .attr("fill", "none")
    .attr("stroke", "#8b5a2b")
    .attr("stroke-linecap", "round")
    .attr("stroke-width", d => Math.max(1, 5 - d.target.depth * 1.5))
    .attr("opacity", 0.85);

  const node = svg.append("g").selectAll("g").data(root.descendants()).join("g")
    .attr("class", "node")
    .attr("transform", d => `translate(${project(d).join(",")})`)
    .on("click", (event, d) => { if (d.data.url) window.open(d.data.url, "_blank"); });

  // Center: a small sprout (stem and two leaves).
  const sprout = node.filter(d => d.depth === 0);
  sprout.append("path")
    .attr("d", "M0,10 Q0,-2 0,-12")
    .attr("fill", "none")
    .attr("stroke", "#4a7c2f")
    .attr("stroke-width", 3)
    .attr("stroke-linecap", "round");
  sprout.append("path")
    .attr("d", "M0,-8 Q-12,-10 -14,-22 Q-2,-22 0,-8Z")
    .attr("fill", "#6abf4b");
  sprout.append("path")
    .attr("d", "M0,-10 Q12,-12 14,-24 Q2,-24 0,-10Z")
    .attr("fill", "#86d45f");

  // Branches: small sandy root tips.
  node.filter(d => d.depth > 0).append("circle")
    .attr("r", 4)
    .attr("fill", "#c9a27a")
    .attr("stroke", "#8b5a2b");

  node.append("text")
    .attr("x", d => (d.depth === 0 ? 0 : d.x < Math.PI ? 10 : -10))
    .attr("y", d => (d.depth === 0 ? 30 : 0))
    .attr("dy", d => (d.depth === 0 ? 0 : "0.31em"))
    .attr("text-anchor", d => (d.depth === 0 ? "middle" : d.x < Math.PI ? "start" : "end"))
    .attr("fill", d => (d.depth === 0 ? "#2f5d1a" : "#5a3b1e"))
    .attr("font-weight", d => (d.depth === 0 ? "bold" : "normal"))
    .text(d => d.data.name);
}

// ---------- Wiring ----------

// Treat input as a question if it ends with "?", starts with a question word, or is longer than four words.
const QUESTION_START = /^(what|how|why|who|when|where|which|is|are|was|were|does|do|did|can|could|should|will|would)\b/i;

function isQuestion(text) {
  return text.endsWith("?") || QUESTION_START.test(text) || text.split(/\s+/).length > 4;
}

async function run(task) {
  try {
    setStatus("Loading...");
    await task();
  } catch (err) {
    setStatus(err.message);
  }
}

$("searchForm").addEventListener("submit", e => {
  e.preventDefault();
  const text = $("query").value.trim();
  if (!text) return;
  run(() => (isQuestion(text) ? askQuestion(text) : mapTopic(text)));
});