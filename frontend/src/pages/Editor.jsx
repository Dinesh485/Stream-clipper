import { useState, useRef, useEffect } from "react";
import { api } from "../api";
import "./Editor.css";

function formatTime(seconds) {
  if (seconds == null || isNaN(seconds)) return "0:00";
  const s = Math.floor(Math.abs(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function parseTime(str) {
  if (!str) return 0;
  const parts = str.split(":").map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

export default function Editor({ videoId, idea, onBack }) {
  const [segments, setSegments] = useState(
    idea.segments.map((s, i) => ({ ...s, id: i }))
  );
  const [activeIdx, setActiveIdx] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [isPreviewing, setIsPreviewing] = useState(false);

  const videoRef = useRef(null);
  const previewRafRef = useRef(null);

  const activeSeg = segments[activeIdx] ?? segments[0];
  const totalDuration = segments.reduce(
    (sum, s) => sum + Math.max(0, (s.end ?? 0) - (s.start ?? 0)),
    0
  );

  // When active segment changes, seek video to its start
  useEffect(() => {
    if (videoRef.current && activeSeg) {
      videoRef.current.pause();
      videoRef.current.currentTime = activeSeg.start;
      stopPreview();
    }
  }, [activeIdx]);

  function stopPreview() {
    if (previewRafRef.current) {
      cancelAnimationFrame(previewRafRef.current);
      previewRafRef.current = null;
    }
    setIsPreviewing(false);
  }

  function playSegment() {
    const video = videoRef.current;
    if (!video || !activeSeg) return;

    video.currentTime = activeSeg.start;
    video.play();
    setIsPreviewing(true);

    function checkEnd() {
      if (!videoRef.current) return;
      if (videoRef.current.currentTime >= activeSeg.end) {
        videoRef.current.pause();
        videoRef.current.currentTime = activeSeg.start;
        stopPreview();
        return;
      }
      previewRafRef.current = requestAnimationFrame(checkEnd);
    }
    previewRafRef.current = requestAnimationFrame(checkEnd);
  }

  function setStartHere() {
    const video = videoRef.current;
    if (!video) return;
    const t = parseFloat(video.currentTime.toFixed(2));
    updateSegment(activeIdx, "start", t);
  }

  function setEndHere() {
    const video = videoRef.current;
    if (!video) return;
    const t = parseFloat(video.currentTime.toFixed(2));
    updateSegment(activeIdx, "end", t);
  }

  function updateSegment(idx, field, value) {
    setSegments((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s))
    );
  }

  function updateSegmentFromInput(idx, field, raw) {
    const val = parseTime(raw);
    if (!isNaN(val)) updateSegment(idx, field, val);
  }

  function addSegment() {
    const last = segments[segments.length - 1];
    const start = last ? parseFloat((last.end + 1).toFixed(2)) : 0;
    const end = parseFloat((start + 30).toFixed(2));
    const newSeg = { id: Date.now(), start, end };
    setSegments((prev) => [...prev, newSeg]);
    setActiveIdx(segments.length);
  }

  function removeSegment(idx) {
    if (segments.length <= 1) return;
    setSegments((prev) => prev.filter((_, i) => i !== idx));
    setActiveIdx((prev) => Math.min(prev, segments.length - 2));
  }

  async function handleExport() {
    setExporting(true);
    setExportError("");
    try {
      const resp = await api.exportClip(videoId, idea.title, segments);
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${idea.title.replace(/[^\w\- ]/g, "").trim()}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err.response?.data?.detail || err.message || "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="editor">
      {/* Header */}
      <div className="editor-header">
        <button className="editor-back" onClick={onBack}>← Back</button>
        <div className="editor-header-info">
          <h2 className="editor-title">{idea.title}</h2>
          <span className="editor-total-dur">
            {segments.length} segment{segments.length !== 1 ? "s" : ""} · {formatTime(Math.round(totalDuration))} total
          </span>
        </div>
        <button className="btn btn-primary" onClick={handleExport} disabled={exporting}>
          {exporting ? (
            <><span className="spinner" style={{ width: 16, height: 16 }} /> Exporting...</>
          ) : "⬇ Export MP4"}
        </button>
      </div>

      {exportError && <div className="editor-error">{exportError}</div>}

      <div className="editor-body">
        {/* Left: video + active segment controls */}
        <div className="editor-left">
          <video
            ref={videoRef}
            className="editor-video"
            src={api.videoUrl(videoId)}
            preload="metadata"
            onPause={stopPreview}
            onEnded={stopPreview}
          />

          {/* Active segment in/out controls */}
          {activeSeg && (
            <div className="editor-inout">
              <div className="inout-label">
                Segment {activeIdx + 1}
                <span className="inout-dur">
                  {formatTime(Math.round(Math.max(0, activeSeg.end - activeSeg.start)))}
                </span>
              </div>

              <div className="inout-row">
                {/* Start */}
                <div className="inout-block">
                  <span className="inout-tag in-tag">IN</span>
                  <TimeInput
                    value={activeSeg.start}
                    onChange={(v) => updateSegment(activeIdx, "start", v)}
                  />
                  <button className="btn btn-secondary btn-sm" onClick={setStartHere}>
                    Set Here
                  </button>
                </div>

                <span className="inout-arrow">→</span>

                {/* End */}
                <div className="inout-block">
                  <span className="inout-tag out-tag">OUT</span>
                  <TimeInput
                    value={activeSeg.end}
                    onChange={(v) => updateSegment(activeIdx, "end", v)}
                  />
                  <button className="btn btn-secondary btn-sm" onClick={setEndHere}>
                    Set Here
                  </button>
                </div>
              </div>

              {/* Playback controls */}
              <div className="inout-actions">
                <button
                  className="btn btn-primary"
                  onClick={isPreviewing ? stopPreview : playSegment}
                >
                  {isPreviewing ? "⏹ Stop" : "▶ Play Segment"}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    if (videoRef.current) videoRef.current.currentTime = activeSeg.start;
                  }}
                >
                  ⏮ Jump to Start
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    if (videoRef.current) videoRef.current.currentTime = activeSeg.end;
                  }}
                >
                  Jump to End ⏭
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right: segment list */}
        <div className="editor-right">
          <div className="segments-header">
            <h3>Segments</h3>
            <button className="btn btn-secondary btn-sm" onClick={addSegment}>+ Add</button>
          </div>

          <div className="segments-list">
            {segments.map((seg, i) => (
              <div
                key={seg.id}
                className={`segment-item ${i === activeIdx ? "active" : ""}`}
                onClick={() => setActiveIdx(i)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && setActiveIdx(i)}
              >
                <div className="segment-item-index">{i + 1}</div>
                <div className="segment-item-info">
                  <div className="segment-item-times">
                    <span className="seg-in">{formatTime(Math.round(seg.start))}</span>
                    <span className="seg-sep">→</span>
                    <span className="seg-out">{formatTime(Math.round(seg.end))}</span>
                  </div>
                  <div className="segment-item-dur">
                    {formatTime(Math.round(Math.max(0, seg.end - seg.start)))}
                  </div>
                </div>
                <button
                  className="segment-item-remove"
                  onClick={(e) => { e.stopPropagation(); removeSegment(i); }}
                  disabled={segments.length <= 1}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="segments-hint">
            Click a segment to edit it.<br />
            Scrub the video and use "Set Here" to adjust in/out points.
          </div>
        </div>
      </div>
    </div>
  );
}

// Controlled time input that shows formatted time while editing
function TimeInput({ value, onChange }) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState(formatTime(Math.round(value)));

  useEffect(() => {
    if (!editing) setRaw(formatTime(Math.round(value)));
  }, [value, editing]);

  function formatTime(s) {
    if (s == null || isNaN(s)) return "0:00";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    return `${m}:${String(sec).padStart(2, "0")}`;
  }

  function commit() {
    setEditing(false);
    const parts = raw.split(":").map(Number);
    if (parts.some(isNaN)) { setRaw(formatTime(Math.round(value))); return; }
    let secs = 0;
    if (parts.length === 3) secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
    else if (parts.length === 2) secs = parts[0] * 60 + parts[1];
    else secs = parts[0];
    onChange(parseFloat(secs.toFixed(2)));
  }

  return (
    <input
      className="time-input"
      value={raw}
      onFocus={() => setEditing(true)}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.target.blur(); } }}
    />
  );
}
