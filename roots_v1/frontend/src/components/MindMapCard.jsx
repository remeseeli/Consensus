import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";

const COLORS = {
  stem: "#84a98c",
  leafLight: "#606c38",
  leafDark: "#283618",
  rootStart: "#fefae0",
  rootMid: "#faedcd",
  rootTip: "#dda15e",
  accent: "#e9c46a"
};

const VIEW_W = 860;
const VIEW_H = 720;

const shorten = (s, max = 24) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function seeded(idx, offset = 0) {
  const x = Math.sin((idx + 1) * 12.9898 + offset * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export default function MindMapCard({ mapItem, onRemove }) {
  const cardRef = useRef(null);
  const svgRef = useRef(null);
  const zoomApiRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);
  const [zoomScale, setZoomScale] = useState(1);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || !mapItem?.tree) return;

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();

    const uid = `mm-${mapItem.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10)}`;
    const defs = svg.append("defs");

    // Soft subterranean glow around each sprout's root system
    const haloGrad = defs.append("radialGradient").attr("id", `${uid}-halo`);
    haloGrad.append("stop").attr("offset", "0%").attr("stop-color", "#fefae0").attr("stop-opacity", 0.22);
    haloGrad.append("stop").attr("offset", "55%").attr("stop-color", "#dda15e").attr("stop-opacity", 0.06);
    haloGrad.append("stop").attr("offset", "100%").attr("stop-color", "#7f4f24").attr("stop-opacity", 0);

    // Root gradient from bright ivory core to warm ochre tips
    const rootGrad = defs
      .append("linearGradient")
      .attr("id", `${uid}-root-grad`)
      .attr("x1", "0%")
      .attr("y1", "0%")
      .attr("x2", "100%")
      .attr("y2", "100%");
    rootGrad.append("stop").attr("offset", "0%").attr("stop-color", COLORS.rootStart);
    rootGrad.append("stop").attr("offset", "65%").attr("stop-color", COLORS.rootMid);
    rootGrad.append("stop").attr("offset", "100%").attr("stop-color", COLORS.rootTip);

    // Sprout leaf gradient
    const leafGrad = defs
      .append("linearGradient")
      .attr("id", `${uid}-leaf-grad`)
      .attr("x1", "0%")
      .attr("y1", "0%")
      .attr("x2", "100%")
      .attr("y2", "100%");
    leafGrad.append("stop").attr("offset", "0%").attr("stop-color", "#99c286");
    leafGrad.append("stop").attr("offset", "55%").attr("stop-color", COLORS.leafLight);
    leafGrad.append("stop").attr("offset", "100%").attr("stop-color", COLORS.leafDark);

    const shadow = defs
      .append("filter")
      .attr("id", `${uid}-shadow`)
      .attr("x", "-30%")
      .attr("y", "-30%")
      .attr("width", "160%")
      .attr("height", "160%");
    shadow
      .append("feDropShadow")
      .attr("dx", 0)
      .attr("dy", 2)
      .attr("stdDeviation", 2.5)
      .attr("flood-color", "#1a0e05")
      .attr("flood-opacity", 0.5);

    const zoomLayer = svg.append("g").attr("class", "zoom-layer");

    const zoom = d3
      .zoom()
      .scaleExtent([0.65, 2.5])
      .on("zoom", (event) => {
        zoomLayer.attr("transform", event.transform);
        setZoomScale(Number(event.transform.k.toFixed(2)));
      });

    svg.call(zoom);
    zoomApiRef.current = { svg, zoom };

    const radius = Math.min(VIEW_W, VIEW_H) / 2 - 145;
    const root = d3.hierarchy(mapItem.tree);
    d3.tree()
      .size([2 * Math.PI, radius])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.8) / Math.max(1, a.depth))(root);

    const project = (d) => [d.y * Math.sin(d.x), -d.y * Math.cos(d.x)];

    // Subtle botanical concentric rings
    const maxDepth = d3.max(root.descendants(), (d) => d.depth) || 1;
    const ringRadii = Array.from({ length: maxDepth }, (_, i) => ((i + 1) / maxDepth) * radius);

    zoomLayer
      .append("g")
      .selectAll("circle")
      .data(ringRadii)
      .join("circle")
      .attr("r", 0)
      .attr("fill", "none")
      .attr("stroke", "#fefae0")
      .attr("stroke-opacity", 0.08)
      .attr("stroke-dasharray", "4 7")
      .transition()
      .duration(650)
      .ease(d3.easeCubicOut)
      .attr("r", (r) => r);

    // Ambient center glow
    zoomLayer
      .append("circle")
      .attr("r", 0)
      .attr("fill", `url(#${uid}-halo)`)
      .transition()
      .duration(600)
      .attr("r", 150);

    const links = root.links().map((l, idx) => {
      const s = project(l.source);
      const t = project(l.target);
      const dx = t[0] - s[0];
      const dy = t[1] - s[1];
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const bend = (seeded(idx, 1) - 0.5) * len * 0.24;
      const c = [(s[0] + t[0]) / 2 + nx * bend, (s[1] + t[1]) / 2 + ny * bend];
      return { l, s, t, c, nx, ny, idx };
    });

    const pointOn = (p0, c, p2, t) => [
      (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p2[0],
      (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p2[1]
    ];

    const rootD = (d) => `M${d.s[0]},${d.s[1]} Q${d.c[0]},${d.c[1]} ${d.t[0]},${d.t[1]}`;
    const rootWidth = (d) => Math.max(2.2, 8.8 - d.l.target.depth * 2.6);

    // Main curved roots growing outward from center
    const rootPaths = zoomLayer
      .append("g")
      .attr("filter", `url(#${uid}-shadow)`)
      .selectAll("path")
      .data(links)
      .join("path")
      .attr("class", "root-link")
      .attr("d", rootD)
      .attr("fill", "none")
      .attr("stroke", `url(#${uid}-root-grad)`)
      .attr("stroke-linecap", "round")
      .attr("stroke-width", rootWidth)
      .attr("opacity", 0.94);

    rootPaths.each(function (d) {
      const length = this.getTotalLength();
      d3.select(this)
        .attr("stroke-dasharray", `${length} ${length}`)
        .attr("stroke-dashoffset", length)
        .transition()
        .duration(620)
        .delay(180 + (d.l.target.depth - 1) * 160)
        .ease(d3.easeCubicOut)
        .attr("stroke-dashoffset", 0)
        .on("end", function () {
          d3.select(this).attr("stroke-dasharray", null).attr("stroke-dashoffset", null);
        });
    });

    // Rootlet hairs sprouting after roots extend
    const hairs = links.flatMap((d) =>
      [0.28, 0.55, 0.82].map((t, i) => {
        const p = pointOn(d.s, d.c, d.t, t);
        const side = i % 2 === 0 ? 1 : -1;
        const L = 8 + seeded(d.idx, i + 10) * 12;
        const ex = p[0] + d.nx * side * L + (seeded(d.idx, i + 20) - 0.5) * 8;
        const ey = p[1] + d.ny * side * L + (seeded(d.idx, i + 30) - 0.5) * 8;
        const mx = (p[0] + ex) / 2 + (seeded(d.idx, i + 40) - 0.5) * 5;
        const my = (p[1] + ey) / 2 + (seeded(d.idx, i + 50) - 0.5) * 5;
        return {
          path: `M${p[0]},${p[1]} Q${mx},${my} ${ex},${ey}`,
          target: d.l.target
        };
      })
    );

    zoomLayer
      .append("g")
      .selectAll("path")
      .data(hairs)
      .join("path")
      .attr("class", "root-hair")
      .attr("d", (d) => d.path)
      .attr("fill", "none")
      .attr("stroke", COLORS.rootMid)
      .attr("stroke-linecap", "round")
      .attr("stroke-width", 1.2)
      .attr("opacity", 0)
      .transition()
      .duration(420)
      .delay((d) => 460 + (d.target.depth - 1) * 140)
      .attr("opacity", 0.52);

    // Nodes
    const node = zoomLayer
      .append("g")
      .selectAll("g")
      .data(root.descendants())
      .join("g")
      .attr("class", "node-group")
      .attr("transform", (d) => `translate(${project(d).join(",")})`)
      .style("cursor", (d) => (d.data.url ? "pointer" : "default"));

    node
      .on("mouseenter", (event, d) => {
        const ancestors = new Set(d.ancestors());
        const descendants = new Set(d.descendants());
        const activeSet = new Set([...ancestors, ...descendants]);

        rootPaths
          .transition()
          .duration(160)
          .attr("opacity", (l) => (ancestors.has(l.target) ? 1 : 0.2))
          .attr("stroke-width", (l) =>
            ancestors.has(l.target) ? rootWidth(l) + 2 : rootWidth(l)
          );

        zoomLayer
          .selectAll(".root-hair")
          .transition()
          .duration(160)
          .attr("opacity", (h) => (ancestors.has(h.target) ? 0.8 : 0.14));

        node
          .transition()
          .duration(160)
          .attr("opacity", (n) => (n.depth === 0 || activeSet.has(n) ? 1 : 0.35));

        if (cardRef.current && (d.data.url || d.data.summary || d.data.score !== undefined)) {
          const rect = cardRef.current.getBoundingClientRect();
          setTooltip({
            name: d.data.name,
            summary: d.data.summary,
            score: d.data.score,
            relation: d.data.relation,
            hasUrl: Boolean(d.data.url),
            x: Math.min(Math.max(event.clientX - rect.left, 115), rect.width - 115),
            y: Math.max(event.clientY - rect.top - 14, 54)
          });
        }
      })
      .on("mousemove", (event) => {
        if (!cardRef.current) return;
        const rect = cardRef.current.getBoundingClientRect();
        setTooltip((prev) =>
          prev
            ? {
                ...prev,
                x: Math.min(Math.max(event.clientX - rect.left, 115), rect.width - 115),
                y: Math.max(event.clientY - rect.top - 14, 54)
              }
            : null
        );
      })
      .on("mouseleave", () => {
        rootPaths
          .transition()
          .duration(180)
          .attr("opacity", 0.94)
          .attr("stroke-width", rootWidth);

        zoomLayer.selectAll(".root-hair").transition().duration(180).attr("opacity", 0.52);
        node.transition().duration(180).attr("opacity", 1);
        setTooltip(null);
      })
      .on("click", (_, d) => {
        if (d.data.url) {
          window.open(d.data.url, "_blank", "noopener,noreferrer");
        }
      });

    // Center sprout popping out from the soil mound
    const sprout = node.filter((d) => d.depth === 0).attr("filter", `url(#${uid}-shadow)`);

    // Soil mound at base
    sprout
      .append("ellipse")
      .attr("cx", 0)
      .attr("cy", 12)
      .attr("rx", 0)
      .attr("ry", 0)
      .attr("fill", "#2e1808")
      .attr("opacity", 0.72)
      .transition()
      .duration(320)
      .ease(d3.easeBackOut.overshoot(1.6))
      .attr("rx", 24)
      .attr("ry", 6.5);

    // Growing plant group anchored at soil line (0, 12)
    const plant = sprout
      .append("g")
      .attr("transform", "translate(0, 12) scale(0, 0)");

    plant
      .transition()
      .duration(560)
      .ease(d3.easeBackOut.overshoot(1.85))
      .attr("transform", "translate(0, 12) scale(1, 1)");

    // Stem (relative to soil mound at 0,0)
    plant
      .append("path")
      .attr("d", "M0,0 Q-2,-14 0,-30")
      .attr("fill", "none")
      .attr("stroke", COLORS.stem)
      .attr("stroke-width", 4.5)
      .attr("stroke-linecap", "round");

    // Left leaf unfurling
    const leftLeaf = plant
      .append("g")
      .attr("transform", "translate(-1, -23) scale(0)");
    leftLeaf
      .append("path")
      .attr("d", "M0,0 Q-16,0 -20,-15 Q-4,-16 0,0Z")
      .attr("fill", `url(#${uid}-leaf-grad)`);
    leftLeaf
      .append("path")
      .attr("d", "M-1,-1 Q-10,-6 -16,-12")
      .attr("fill", "none")
      .attr("stroke", "#d8f3dc")
      .attr("stroke-opacity", 0.48)
      .attr("stroke-width", 1);
    leftLeaf
      .transition()
      .delay(140)
      .duration(460)
      .ease(d3.easeBackOut.overshoot(2.1))
      .attr("transform", "translate(-1, -23) scale(1)");

    // Right leaf unfurling
    const rightLeaf = plant
      .append("g")
      .attr("transform", "translate(1, -27) scale(0)");
    rightLeaf
      .append("path")
      .attr("d", "M0,0 Q17,0 22,-16 Q4,-17 0,0Z")
      .attr("fill", `url(#${uid}-leaf-grad)`);
    rightLeaf
      .append("path")
      .attr("d", "M1,-1 Q10,-6 17,-13")
      .attr("fill", "none")
      .attr("stroke", "#d8f3dc")
      .attr("stroke-opacity", 0.48)
      .attr("stroke-width", 1);
    rightLeaf
      .transition()
      .delay(220)
      .duration(480)
      .ease(d3.easeBackOut.overshoot(2.1))
      .attr("transform", "translate(1, -27) scale(1)");

    // Branch node dots popping in as roots reach them
    const branchNodes = node.filter((d) => d.depth > 0);
    branchNodes
      .append("circle")
      .attr("r", 0)
      .attr("fill", (d) => (d.data.url ? COLORS.accent : COLORS.stem))
      .attr("opacity", 0.28)
      .transition()
      .delay((d) => 420 + (d.depth - 1) * 160)
      .duration(380)
      .ease(d3.easeBackOut.overshoot(2.2))
      .attr("r", (d) => (d.depth === 1 ? 8.5 : 6.5));

    branchNodes
      .append("circle")
      .attr("r", 0)
      .attr("fill", (d) => (d.data.url ? COLORS.rootStart : COLORS.stem))
      .attr("stroke", COLORS.leafDark)
      .attr("stroke-width", 1.7)
      .transition()
      .delay((d) => 420 + (d.depth - 1) * 160)
      .duration(380)
      .ease(d3.easeBackOut.overshoot(2.2))
      .attr("r", (d) => (d.depth === 1 ? 5.2 : 4));

    // Labels fading & popping in
    node
      .append("text")
      .attr("x", (d) => (d.depth === 0 ? 0 : d.x < Math.PI ? 13 : -13))
      .attr("y", (d) => (d.depth === 0 ? 44 : 0))
      .attr("dy", (d) => (d.depth === 0 ? 0 : "0.32em"))
      .attr("text-anchor", (d) =>
        d.depth === 0 ? "middle" : d.x < Math.PI ? "start" : "end"
      )
      .attr("fill", (d) => (d.depth === 0 ? "#fefae0" : d.data.url ? "#fefae0" : "#e9edc9"))
      .attr("font-family", (d) =>
        d.depth === 0 ? "'Redaction 50', Georgia, serif" : "'Plus Jakarta Sans', sans-serif"
      )
      .attr("font-weight", (d) => (d.depth === 0 ? 400 : d.depth === 1 ? 600 : 500))
      .attr("font-size", (d) => (d.depth === 0 ? 28 : d.depth === 1 ? 14 : 12.5))
      .attr("paint-order", "stroke")
      .attr("stroke", "rgba(38, 21, 9, 0.92)")
      .attr("stroke-width", (d) => (d.depth === 0 ? 5.5 : 4.2))
      .attr("stroke-linejoin", "round")
      .attr("opacity", 0)
      .text((d) => (d.depth === 0 ? shorten(d.data.name, 28) : shorten(d.data.name, 24)))
      .transition()
      .delay((d) => (d.depth === 0 ? 180 : 480 + (d.depth - 1) * 160))
      .duration(340)
      .attr("opacity", 1);

    return () => {
      svg.on(".zoom", null);
    };
  }, [mapItem]);

  function handleResetZoom() {
    if (!zoomApiRef.current) return;
    const { svg, zoom } = zoomApiRef.current;
    svg.transition().duration(320).call(zoom.transform, d3.zoomIdentity);
  }

  return (
    <div className="sprout-plot" ref={cardRef}>
      <div className="plot-controls">
        <span className={`card-badge ${mapItem.kind === "rag" ? "is-rag" : ""}`}>
          {mapItem.kind === "rag"
            ? "RAG Concepts"
            : mapItem.cached
            ? "Topic · Cached"
            : "Topic"}
        </span>

        <div className="card-actions">
          {zoomScale !== 1 && (
            <button
              type="button"
              className="card-btn"
              onClick={handleResetZoom}
              title="Reset zoom & pan"
            >
              Reset ({zoomScale}×)
            </button>
          )}
          <button
            type="button"
            className="card-btn card-btn-close"
            onClick={() => onRemove(mapItem.id)}
            title="Uproot this mind map"
            aria-label="Remove mind map"
          >
            ×
          </button>
        </div>
      </div>

      <svg ref={svgRef} viewBox={`${-VIEW_W / 2} ${-VIEW_H / 2} ${VIEW_W} ${VIEW_H}`} />

      {tooltip && (
        <div
          className="node-tooltip"
          style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }}
        >
          <div className="tooltip-title">{tooltip.name}</div>
          {tooltip.relation && (
            <div className="tooltip-meta">Category: {tooltip.relation}</div>
          )}
          {tooltip.score !== undefined && (
            <div className="tooltip-meta">
              Relevance score: {Math.min(100, Math.round(tooltip.score * 100))}%
            </div>
          )}
          {tooltip.summary && <p className="tooltip-summary">{tooltip.summary}…</p>}
          {tooltip.hasUrl && <div className="tooltip-cta">Click to open Wikipedia ↗</div>}
        </div>
      )}
    </div>
  );
}