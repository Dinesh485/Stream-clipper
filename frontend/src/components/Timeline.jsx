import { useRef, useEffect, useState, useCallback } from "react";
import "./Timeline.css";

const HANDLE_WIDTH = 8;
const MIN_SEG_DURATION = 0.5;
const MAX_ZOOM = 100;
const MIN_ZOOM = 1;

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

export default function Timeline({
  duration,
  segments,
  activeIdx,
  currentTime,
  onSeek,
  onSegmentChange,
  onSelectSegment,
}) {
  const containerRef = useRef(null);
  const canvasRef    = useRef(null);
  const dragRef      = useRef(null);
  const rafRef       = useRef(null);

  // zoom: how many times we're magnified (1 = full video visible)
  // panOffset: seconds from the start of the video at the left edge of the view
  const [zoom, setZoom]           = useState(1);
  const [panOffset, setPanOffset] = useState(0); // seconds

  const zoomRef      = useRef(zoom);
  const panOffsetRef = useRef(panOffset);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panOffsetRef.current = panOffset; }, [panOffset]);

  const COLORS = [
    { fill: "rgba(230,57,70,0.45)",   border: "#e63946" },
    { fill: "rgba(42,157,143,0.45)",  border: "#2a9d8f" },
    { fill: "rgba(244,162,97,0.45)",  border: "#f4a261" },
    { fill: "rgba(100,149,237,0.45)", border: "#6495ed" },
    { fill: "rgba(180,100,220,0.45)", border: "#b464dc" },
  ];

  // ── Coordinate helpers (zoom-aware) ──────────────────────────────────────

  // How many seconds are visible at current zoom
  function visibleDuration(z = zoomRef.current) {
    return duration / z;
  }

  // time → canvas pixel x
  function toX(t, W, z = zoomRef.current, pan = panOffsetRef.current) {
    const vis = duration / z;
    return ((t - pan) / vis) * W;
  }

  // canvas pixel x → time
  function toT(x, W, z = zoomRef.current, pan = panOffsetRef.current) {
    const vis = duration / z;
    return clamp(pan + (x / W) * vis, 0, duration);
  }

  // Clamp pan so we never scroll past the ends
  function clampPan(pan, z) {
    const vis = duration / z;
    return clamp(pan, 0, Math.max(0, duration - vis));
  }

  // ── Draw ─────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !duration) return;

    const W   = container.clientWidth;
    const H   = canvas.height;
    const dpr = window.devicePixelRatio || 1;
    const z   = zoomRef.current;
    const pan = panOffsetRef.current;

    // Only resize if needed
    if (canvas.width !== W * dpr) {
      canvas.width       = W * dpr;
      canvas.style.width = W + "px";
      // Update cursor based on zoom
      canvas.style.cursor = z > 1 ? "grab" : "crosshair";
    }

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, W, H);

    // Time markers — pick interval based on visible window, not full duration
    const vis = visibleDuration(z);
    const interval = pickInterval(vis);
    const startT   = Math.floor(pan / interval) * interval;

    ctx.font      = "10px monospace";
    ctx.textAlign = "center";
    for (let t = startT; t <= pan + vis + interval; t += interval) {
      if (t < 0 || t > duration) continue;
      const x = toX(t, W, z, pan);
      ctx.fillStyle = "#2a2a2a";
      ctx.fillRect(x, 0, 1, H);
      ctx.fillStyle = "#666";
      ctx.fillText(fmtTime(t), clamp(x, 20, W - 20), 10);
    }

    // Segments
    const segH = H * 0.55;
    const segY = (H - segH) / 2 + 6;

    segments.forEach((seg, i) => {
      const x1 = toX(seg.start, W, z, pan);
      const x2 = toX(seg.end,   W, z, pan);
      const w  = Math.max(x2 - x1, 2);
      const c  = COLORS[i % COLORS.length];
      const isActive = i === activeIdx;

      ctx.fillStyle = c.fill;
      ctx.fillRect(x1, segY, w, segH);

      ctx.strokeStyle = c.border;
      ctx.lineWidth   = isActive ? 2 : 1;
      ctx.strokeRect(x1, segY, w, segH);

      if (isActive) {
        ctx.fillStyle = c.fill.replace("0.45", "0.65");
        ctx.fillRect(x1, segY, w, segH);
      }

      ctx.fillStyle = c.border;
      ctx.fillRect(x1,              segY, HANDLE_WIDTH, segH);
      ctx.fillRect(x2 - HANDLE_WIDTH, segY, HANDLE_WIDTH, segH);

      if (w > 30) {
        ctx.fillStyle = "#fff";
        ctx.font      = `bold ${isActive ? 11 : 10}px sans-serif`;
        ctx.textAlign = "left";
        ctx.fillText(`${i + 1}`, x1 + HANDLE_WIDTH + 3, segY + segH / 2 + 4);
      }
    });

    // Playhead
    const px = toX(currentTime, W, z, pan);
    if (px >= 0 && px <= W) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, H);
      ctx.stroke();

      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.moveTo(px - 5, 0);
      ctx.lineTo(px + 5, 0);
      ctx.lineTo(px, 8);
      ctx.closePath();
      ctx.fill();
    }

    // Zoom level indicator (top-right)
    if (z > 1) {
      const label = `${z.toFixed(1)}×`;
      ctx.font      = "bold 10px monospace";
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillText(label, W - 6, H - 5);
    }
  }, [segments, activeIdx, currentTime, duration, zoom, panOffset]);

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [draw]);

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

  // Auto-pan to keep playhead in view when playing
  useEffect(() => {
    const z   = zoomRef.current;
    if (z <= 1) return;
    const vis = duration / z;
    const pan = panOffsetRef.current;
    const margin = vis * 0.1; // 10% margin
    if (currentTime < pan + margin || currentTime > pan + vis - margin) {
      const newPan = clampPan(currentTime - vis / 2, z);
      setPanOffset(newPan);
    }
  }, [currentTime, duration]);

  // ── Wheel zoom ────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function onWheel(e) {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const W    = canvas.clientWidth;
      const mouseX = e.clientX - rect.left;

      const oldZ   = zoomRef.current;
      const oldPan = panOffsetRef.current;

      // Time under the cursor before zoom
      const timeAtCursor = toT(mouseX, W, oldZ, oldPan);

      // Zoom in/out — trackpad pinch sends deltaY with ctrlKey
      const delta  = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const newZ   = clamp(oldZ * delta, MIN_ZOOM, MAX_ZOOM);

      // Adjust pan so the time under the cursor stays under the cursor
      const newVis = duration / newZ;
      const newPan = clampPan(timeAtCursor - (mouseX / W) * newVis, newZ);

      setZoom(newZ);
      setPanOffset(newPan);
    }

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [duration]);

  // ── Hit testing ───────────────────────────────────────────────────────────
  function hitTest(x) {
    if (!canvasRef.current || !duration) return null;
    const W   = canvasRef.current.clientWidth;
    const z   = zoomRef.current;
    const pan = panOffsetRef.current;

    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i];
      const x1  = toX(seg.start, W, z, pan);
      const x2  = toX(seg.end,   W, z, pan);

      if (x >= x1 && x <= x1 + HANDLE_WIDTH)          return { type: "left",  idx: i };
      if (x >= x2 - HANDLE_WIDTH && x <= x2)           return { type: "right", idx: i };
      if (x > x1 + HANDLE_WIDTH && x < x2 - HANDLE_WIDTH) return { type: "body",  idx: i };
    }
    return null;
  }

  // ── Mouse events ──────────────────────────────────────────────────────────
  function onMouseDown(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const x    = e.clientX - rect.left;
    const hit  = hitTest(x);

    if (hit) {
      const seg = segments[hit.idx];
      dragRef.current = { ...hit, startX: x, origStart: seg.start, origEnd: seg.end };
      onSelectSegment(hit.idx);
      e.preventDefault();
    } else {
      // Could be a seek-click or a pan-drag — decide on mouseup/move
      dragRef.current = {
        type: "pan",
        startX: x,
        startPan: panOffsetRef.current,
        moved: false,
      };
      e.preventDefault();
    }
  }

  function onMouseMove(e) {
    const canvas = canvasRef.current;
    if (!canvas || !duration) return;

    const rect = canvas.getBoundingClientRect();
    const x    = e.clientX - rect.left;
    const W    = canvas.clientWidth;
    const z    = zoomRef.current;
    const pan  = panOffsetRef.current;

    if (dragRef.current?.type === "pan") {
      const dx = x - dragRef.current.startX;
      if (Math.abs(dx) > 3) {
        dragRef.current.moved = true;
        canvas.style.cursor = "grabbing";
      }
      if (dragRef.current.moved) {
        // dx pixels → seconds
        const vis    = duration / z;
        const dtSecs = (dx / W) * vis;
        const newPan = clampPan(dragRef.current.startPan - dtSecs, z);
        setPanOffset(newPan);
      }
      return;
    }

    const hit = hitTest(x);
    canvas.style.cursor =
      hit?.type === "left" || hit?.type === "right" ? "ew-resize" :
      hit?.type === "body" ? "grab" :
      z > 1 ? "grab" : "crosshair";

    if (!dragRef.current) return;

    const drag = dragRef.current;
    const dt   = toT(x, W, z, pan) - toT(drag.startX, W, z, pan);
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

    onSegmentChange(idx, {
      start: parseFloat(newStart.toFixed(2)),
      end:   parseFloat(newEnd.toFixed(2)),
    });
  }

  function onMouseUp(e) {
    const drag = dragRef.current;
    // If it was a pan drag with no movement → treat as seek
    if (drag?.type === "pan" && !drag.moved) {
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const x    = (e?.clientX ?? drag.startX + rect.left) - rect.left;
        const W    = canvas.clientWidth;
        onSeek(toT(x, W));
      }
    }
    dragRef.current = null;
    if (canvasRef.current) {
      const z = zoomRef.current;
      canvasRef.current.style.cursor = z > 1 ? "grab" : "crosshair";
    }
  }

  // Touch support
  function getTouchX(e) {
    return e.touches[0].clientX - canvasRef.current.getBoundingClientRect().left;
  }

  function onTouchStart(e) {
    const x   = getTouchX(e);
    const hit = hitTest(x);
    if (hit) {
      const seg = segments[hit.idx];
      dragRef.current = { ...hit, startX: x, origStart: seg.start, origEnd: seg.end };
      onSelectSegment(hit.idx);
    } else {
      dragRef.current = {
        type: "pan",
        startX: x,
        startPan: panOffsetRef.current,
        moved: false,
      };
    }
  }

  function onTouchMove(e) {
    if (!dragRef.current) return;
    e.preventDefault();
    onMouseMove({ clientX: e.touches[0].clientX });
  }

  function onTouchEnd(e) {
    const touch = e.changedTouches[0];
    onMouseUp({ clientX: touch?.clientX });
  }

  // ── Zoom controls ─────────────────────────────────────────────────────────
  function zoomIn() {
    const newZ   = clamp(zoomRef.current * 2, MIN_ZOOM, MAX_ZOOM);
    const vis    = duration / newZ;
    const center = panOffsetRef.current + visibleDuration(zoomRef.current) / 2;
    setPanOffset(clampPan(center - vis / 2, newZ));
    setZoom(newZ);
  }

  function zoomOut() {
    const newZ   = clamp(zoomRef.current / 2, MIN_ZOOM, MAX_ZOOM);
    const vis    = duration / newZ;
    const center = panOffsetRef.current + visibleDuration(zoomRef.current) / 2;
    setPanOffset(clampPan(center - vis / 2, newZ));
    setZoom(newZ);
  }

  function resetZoom() {
    setZoom(1);
    setPanOffset(0);
  }

  // Jump to playhead
  function jumpToPlayhead() {
    const z   = zoomRef.current;
    const vis = duration / z;
    setPanOffset(clampPan(currentTime - vis / 2, z));
  }

  return (
    <div className="timeline-wrap">
      <div ref={containerRef} className="timeline-canvas-wrap">
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
          onTouchEnd={onTouchEnd}
        />
      </div>

      {/* Zoom controls */}
      <div className="timeline-controls">
        <button className="tl-btn" onClick={zoomOut}  disabled={zoom <= MIN_ZOOM} title="Zoom out">−</button>
        <button className="tl-btn" onClick={zoomIn}   disabled={zoom >= MAX_ZOOM} title="Zoom in">+</button>
        {zoom > 1 && (
          <>
            <span className="tl-zoom-label">{zoom.toFixed(1)}×</span>
            <button className="tl-btn tl-btn-text" onClick={resetZoom} title="Reset zoom">Reset</button>
            <button className="tl-btn tl-btn-text" onClick={jumpToPlayhead} title="Center on playhead">⊙ Playhead</button>
          </>
        )}

        {/* Scrollbar — only shown when zoomed in */}
        {zoom > 1 && (
          <input
            type="range"
            className="tl-scrollbar"
            min={0}
            max={Math.max(0, duration - duration / zoom)}
            step={duration / zoom / 100}
            value={panOffset}
            onChange={e => setPanOffset(parseFloat(e.target.value))}
            title="Scroll timeline"
          />
        )}
      </div>
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────

function fmtTime(s) {
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function pickInterval(visibleSecs) {
  if (visibleSecs <= 10)   return 1;
  if (visibleSecs <= 30)   return 5;
  if (visibleSecs <= 60)   return 10;
  if (visibleSecs <= 300)  return 30;
  if (visibleSecs <= 600)  return 60;
  if (visibleSecs <= 1800) return 120;
  if (visibleSecs <= 3600) return 300;
  return 600;
}
