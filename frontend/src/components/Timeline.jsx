import { useRef, useEffect, useState, useCallback } from "react";
import "./Timeline.css";

const HANDLE_WIDTH = 8;   // px width of drag handles
const MIN_SEG_DURATION = 1; // minimum segment duration in seconds

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

export default function Timeline({
  duration,        // total video duration in seconds
  segments,        // [{ id, start, end }]
  activeIdx,       // index of currently active segment
  currentTime,     // current video playhead position
  onSeek,          // (seconds) => void — user clicked timeline
  onSegmentChange, // (idx, { start, end }) => void — user dragged a segment
  onSelectSegment, // (idx) => void — user clicked a segment
}) {
  const containerRef = useRef(null);
  const canvasRef    = useRef(null);
  const dragRef      = useRef(null); // { type: 'body'|'left'|'right', idx, startX, origStart, origEnd }
  const rafRef       = useRef(null);
  const [, forceRender] = useState(0);

  const COLORS = [
    { fill: "rgba(230,57,70,0.45)",   border: "#e63946" },
    { fill: "rgba(42,157,143,0.45)",  border: "#2a9d8f" },
    { fill: "rgba(244,162,97,0.45)",  border: "#f4a261" },
    { fill: "rgba(100,149,237,0.45)", border: "#6495ed" },
    { fill: "rgba(180,100,220,0.45)", border: "#b464dc" },
  ];

  // Convert time → pixel x
  function toX(t, width) {
    return (t / duration) * width;
  }

  // Convert pixel x → time
  function toT(x, width) {
    return clamp((x / width) * duration, 0, duration);
  }

  // ── Draw ─────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !duration) return;

    const W = container.clientWidth;
    const H = canvas.height;
    const dpr = window.devicePixelRatio || 1;

    // Only resize if needed
    if (canvas.width !== W * dpr) {
      canvas.width  = W * dpr;
      canvas.style.width = W + "px";
    }

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, W, H);

    // Time markers
    ctx.fillStyle = "#444";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    const markerInterval = pickInterval(duration);
    for (let t = 0; t <= duration; t += markerInterval) {
      const x = toX(t, W);
      ctx.fillStyle = "#333";
      ctx.fillRect(x, 0, 1, H);
      ctx.fillStyle = "#555";
      ctx.fillText(fmtTime(t), x, 10);
    }

    // Segments
    const segH = H * 0.55;
    const segY = (H - segH) / 2 + 6;

    segments.forEach((seg, i) => {
      const x1 = toX(seg.start, W);
      const x2 = toX(seg.end, W);
      const w  = Math.max(x2 - x1, 2);
      const c  = COLORS[i % COLORS.length];
      const isActive = i === activeIdx;

      // Body
      ctx.fillStyle = c.fill;
      ctx.fillRect(x1, segY, w, segH);

      // Border
      ctx.strokeStyle = c.border;
      ctx.lineWidth = isActive ? 2 : 1;
      ctx.strokeRect(x1, segY, w, segH);

      // Active: brighter fill
      if (isActive) {
        ctx.fillStyle = c.fill.replace("0.45", "0.65");
        ctx.fillRect(x1, segY, w, segH);
      }

      // Left handle
      ctx.fillStyle = c.border;
      ctx.fillRect(x1, segY, HANDLE_WIDTH, segH);

      // Right handle
      ctx.fillStyle = c.border;
      ctx.fillRect(x2 - HANDLE_WIDTH, segY, HANDLE_WIDTH, segH);

      // Label
      if (w > 30) {
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${isActive ? 11 : 10}px sans-serif`;
        ctx.textAlign = "left";
        ctx.fillText(`${i + 1}`, x1 + HANDLE_WIDTH + 3, segY + segH / 2 + 4);
      }
    });

    // Playhead
    const px = toX(currentTime, W);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, H);
    ctx.stroke();

    // Playhead triangle
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(px - 5, 0);
    ctx.lineTo(px + 5, 0);
    ctx.lineTo(px, 8);
    ctx.closePath();
    ctx.fill();
  }, [segments, activeIdx, currentTime, duration]);

  // Redraw whenever anything changes
  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [draw]);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(draw);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [draw]);

  // ── Hit testing ──────────────────────────────────────────────────────────
  function hitTest(x) {
    if (!canvasRef.current || !duration) return null;
    const W = canvasRef.current.clientWidth;

    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i];
      const x1 = toX(seg.start, W);
      const x2 = toX(seg.end, W);

      if (x >= x1 && x <= x1 + HANDLE_WIDTH) return { type: "left",  idx: i };
      if (x >= x2 - HANDLE_WIDTH && x <= x2)  return { type: "right", idx: i };
      if (x > x1 + HANDLE_WIDTH && x < x2 - HANDLE_WIDTH) return { type: "body", idx: i };
    }
    return null;
  }

  // ── Mouse events ─────────────────────────────────────────────────────────
  function onMouseDown(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const x    = e.clientX - rect.left;
    const hit  = hitTest(x);

    if (hit) {
      const seg = segments[hit.idx];
      dragRef.current = {
        ...hit,
        startX:    x,
        origStart: seg.start,
        origEnd:   seg.end,
      };
      onSelectSegment(hit.idx);
      e.preventDefault();
    } else {
      // Click on empty area → seek
      const W = canvasRef.current.clientWidth;
      onSeek(toT(x, W));
    }
  }

  function onMouseMove(e) {
    const canvas = canvasRef.current;
    if (!canvas || !duration) return;

    const rect = canvas.getBoundingClientRect();
    const x    = e.clientX - rect.left;
    const W    = canvas.clientWidth;

    // Update cursor
    const hit = hitTest(x);
    if (hit?.type === "left" || hit?.type === "right") {
      canvas.style.cursor = "ew-resize";
    } else if (hit?.type === "body") {
      canvas.style.cursor = "grab";
    } else {
      canvas.style.cursor = "crosshair";
    }

    // Dragging
    if (!dragRef.current) return;
    const drag  = dragRef.current;
    const dt    = toT(x, W) - toT(drag.startX, W);
    const { idx, type, origStart, origEnd } = drag;

    let newStart = origStart;
    let newEnd   = origEnd;

    if (type === "left") {
      newStart = clamp(origStart + dt, 0, origEnd - MIN_SEG_DURATION);
    } else if (type === "right") {
      newEnd = clamp(origEnd + dt, origStart + MIN_SEG_DURATION, duration);
    } else {
      const segLen = origEnd - origStart;
      newStart = clamp(origStart + dt, 0, duration - segLen);
      newEnd   = newStart + segLen;
    }

    onSegmentChange(idx, { start: parseFloat(newStart.toFixed(2)), end: parseFloat(newEnd.toFixed(2)) });
  }

  function onMouseUp() {
    dragRef.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = "crosshair";
  }

  // Touch support
  function getTouchX(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return e.touches[0].clientX - rect.left;
  }

  function onTouchStart(e) {
    const x   = getTouchX(e);
    const hit = hitTest(x);
    if (hit) {
      const seg = segments[hit.idx];
      dragRef.current = { ...hit, startX: x, origStart: seg.start, origEnd: seg.end };
      onSelectSegment(hit.idx);
    } else {
      const W = canvasRef.current.clientWidth;
      onSeek(toT(x, W));
    }
  }

  function onTouchMove(e) {
    if (!dragRef.current) return;
    e.preventDefault();
    const fakeEvent = { clientX: e.touches[0].clientX };
    onMouseMove({ clientX: e.touches[0].clientX });
  }

  return (
    <div ref={containerRef} className="timeline-wrap">
      <canvas
        ref={canvasRef}
        height={60}
        className="timeline-canvas"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onMouseUp}
      />
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────

function fmtTime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
  return `${m}:${String(sec).padStart(2,"0")}`;
}

function pickInterval(duration) {
  // pick a nice time marker interval based on video length
  if (duration <= 60)    return 10;
  if (duration <= 300)   return 30;
  if (duration <= 600)   return 60;
  if (duration <= 1800)  return 120;
  if (duration <= 3600)  return 300;
  return 600;
}
