import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { api } from "../api";
import StatusPill from "../components/StatusPill";
import Timeline from "../components/Timeline";
import "./Detail.css";

// ── helpers ────────────────────────────────────────────────────────────────

function formatTime(seconds) {
  if (seconds == null || isNaN(seconds)) return "0:00";
  const s = Math.floor(Math.abs(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function parseIdeas(ideas) {
  if (Array.isArray(ideas)) return ideas;
  return [];
}

function totalDur(segments) {
  return (segments || []).reduce((s, seg) => s + Math.max(0, seg.end - seg.start), 0);
}

function isRunning(v) {
  return v.download_status === "running" || v.transcribe_status === "running" || v.ideas_status === "running";
}

// ── main component ─────────────────────────────────────────────────────────

export default function Detail({ videoId, onBack }) {
  const [video, setVideo]                 = useState(null);
  const [loading, setLoading]             = useState(true);
  const [actionLoading, setActionLoading] = useState({});
  const [activeIdea, setActiveIdea]       = useState(null);
  const [activeIdeaIdx, setActiveIdeaIdx] = useState(null);
  const [showNewIdeaForm, setShowNewIdeaForm] = useState(false);
  const [newIdeaTitle, setNewIdeaTitle]   = useState("");
  const [newIdeaDesc, setNewIdeaDesc]     = useState("");
  const pollRef = useRef(null);

  const fetchVideo = useCallback(async () => {
    try { const d = await api.getVideo(videoId); setVideo(d); return d; }
    catch { return null; }
  }, [videoId]);

  useEffect(() => { fetchVideo().finally(() => setLoading(false)); }, [fetchVideo]);

  useEffect(() => {
    if (!video) return;
    function schedule(v) {
      if (isRunning(v)) {
        pollRef.current = setTimeout(async () => {
          const u = await fetchVideo(); if (u) schedule(u);
        }, 2000);
      }
    }
    schedule(video);
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [video, fetchVideo]);

  async function handleAction(action) {
    setActionLoading(p => ({ ...p, [action]: true }));
    try {
      let u;
      if (action === "download") u = await api.startDownload(videoId);
      else if (action === "transcribe") u = await api.startTranscribe(videoId);
      else if (action === "ideas") u = await api.startGenerateIdeas(videoId);
      if (u) setVideo(u);
    } catch (e) { console.error(e); }
    finally { setActionLoading(p => ({ ...p, [action]: false })); }
  }

  async function handleCreateIdea(e) {
    e.preventDefault();
    if (!newIdeaTitle.trim()) return;
    try {
      const newIdx = parseIdeas(video.ideas).length;
      const updatedIdeas = await api.createIdea(videoId, newIdeaTitle.trim(), newIdeaDesc.trim());
      setVideo(v => ({ ...v, ideas: updatedIdeas }));
      // auto-select the new idea
      const newIdea = updatedIdeas[newIdx];
      setActiveIdea(newIdea);
      setActiveIdeaIdx(newIdx);
      setShowNewIdeaForm(false);
      setNewIdeaTitle("");
      setNewIdeaDesc("");
    } catch (e) { console.error(e); }
  }

  async function handleDeleteIdea(e, idx) {
    e.stopPropagation();
    try {
      const updatedIdeas = await api.deleteIdea(videoId, idx);
      setVideo(v => ({ ...v, ideas: updatedIdeas }));
      // If the deleted idea was active, deselect
      setActiveIdea(prev => {
        if (activeIdeaIdx === idx) { setActiveIdeaIdx(null); return null; }
        // recalculate idx after deletion
        if (activeIdeaIdx > idx) setActiveIdeaIdx(i => i - 1);
        return prev;
      });
    } catch (e) { console.error(e); }
  }

  function selectIdea(idea, i) {
    setActiveIdea(idea);
    setActiveIdeaIdx(i);
  }

  if (loading) return (
    <div className="detail-loading">
      <span className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
    </div>
  );

  if (!video) return (
    <div className="detail-loading">
      <p>Video not found.</p>
      <button className="btn btn-ghost" onClick={onBack}>← Back</button>
    </div>
  );

  const ideas = parseIdeas(video.ideas);
  const userIdeas = ideas.map((idea, i) => ({ idea, i })).filter(({ idea }) => idea.source === "user" || !idea.source);
  const aiIdeas   = ideas.map((idea, i) => ({ idea, i })).filter(({ idea }) => idea.source === "ai");
  const showAiSection = video.transcribe_status === "done" || video.ideas_status === "done" || aiIdeas.length > 0 || video.ideas_status === "running";

  return (
    <div className="detail">

      {/* ── Left sidebar: stages ────────────────────────────────────────── */}
      <aside className="detail-sidebar">
        <button className="detail-back" onClick={onBack}>← Back</button>

        <div className="detail-thumb-wrap">
          {video.download_status === "done"
            ? <img src={api.thumbnailUrl(video.id)} alt={video.title} className="detail-thumb"
                onError={e => e.target.style.display = "none"} />
            : <div className="detail-thumb-placeholder">🎬</div>}
        </div>

        <h2 className="detail-title">{video.title || "Untitled"}</h2>
        {video.duration > 0 && <p className="detail-duration">{formatTime(video.duration)}</p>}

        <hr className="detail-divider" />

        <StageSection name="Download" status={video.download_status} error={video.download_error}
          onStart={() => handleAction("download")} loading={actionLoading.download} canStart>
          {video.download_status === "running" && (
            <div className="stage-progress">
              <div className="stage-progress-bar">
                <div className="stage-progress-fill" style={{ width: `${video.download_progress || 0}%` }} />
              </div>
              <div className="stage-progress-meta">
                <span>{(video.download_progress || 0).toFixed(1)}%</span>
                {video.download_total && <span>{video.download_total}</span>}
                {video.download_speed && <span>{video.download_speed}</span>}
              </div>
            </div>
          )}
        </StageSection>

        <StageSection name="Transcribe" status={video.transcribe_status} error={video.transcribe_error}
          onStart={() => handleAction("transcribe")} loading={actionLoading.transcribe}
          canStart={video.download_status === "done"}
          disabledReason={video.download_status !== "done" ? "Complete download first" : null} />

        <div style={{ flex: 1 }} />

        <button className="btn btn-danger" onClick={async () => {
          if (confirm(`Delete "${video.title || "this video"}"? This cannot be undone.`)) {
            await api.deleteVideo(videoId); onBack();
          }
        }}>🗑 Delete Video</button>
      </aside>

      {/* ── Middle: ideas list ───────────────────────────────────────────── */}
      <div className="detail-ideas">

        {/* My Ideas section */}
        <div className="ideas-section-header">
          <span>My Ideas</span>
          <button className="btn btn-sm btn-ghost" style={{ fontSize: "0.75rem", padding: "2px 8px" }}
            onClick={() => { setShowNewIdeaForm(f => !f); setNewIdeaTitle(""); setNewIdeaDesc(""); }}>
            + New Idea
          </button>
        </div>

        {showNewIdeaForm && (
          <form className="new-idea-form" onSubmit={handleCreateIdea}>
            <input
              className="new-idea-input"
              placeholder="Title (required)"
              value={newIdeaTitle}
              onChange={e => setNewIdeaTitle(e.target.value)}
              autoFocus
            />
            <input
              className="new-idea-input"
              placeholder="Description (optional)"
              value={newIdeaDesc}
              onChange={e => setNewIdeaDesc(e.target.value)}
            />
            <div className="new-idea-actions">
              <button type="submit" className="btn btn-primary btn-sm" disabled={!newIdeaTitle.trim()}>Create</button>
              <button type="button" className="btn btn-ghost btn-sm"
                onClick={() => { setShowNewIdeaForm(false); setNewIdeaTitle(""); setNewIdeaDesc(""); }}>
                Cancel
              </button>
            </div>
          </form>
        )}

        <div className="ideas-list">
          {userIdeas.map(({ idea, i }) => (
            <IdeaCard key={i} idea={idea} active={activeIdeaIdx === i}
              onClick={() => selectIdea(idea, i)}
              onDelete={(e) => handleDeleteIdea(e, i)}
              showDelete />
          ))}
          {userIdeas.length === 0 && !showNewIdeaForm && (
            <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", padding: "4px 0" }}>
              No user ideas yet. Click &quot;+ New Idea&quot; to create one.
            </p>
          )}
        </div>

        {/* AI Ideas section */}
        {showAiSection && (
          <>
            <div className="ideas-section-header" style={{ marginTop: 8 }}>
              <span>AI Ideas</span>
              <button
                className="btn btn-sm btn-ghost"
                style={{ fontSize: "0.75rem", padding: "2px 8px" }}
                disabled={video.ideas_status === "running" || video.transcribe_status !== "done"}
                onClick={() => handleAction("ideas")}
              >
                {video.ideas_status === "running"
                  ? <><span className="spinner" style={{ width: 10, height: 10 }} /> Generating...</>
                  : "✨ Generate"}
              </button>
            </div>

            {video.ideas_status === "running" && aiIdeas.length === 0 && (
              <div className="detail-placeholder" style={{ flex: "none", padding: "16px 0" }}>
                <span className="spinner" style={{ width: 24, height: 24, borderWidth: 2 }} />
                <p style={{ fontSize: "0.8rem" }}>Generating AI ideas...</p>
              </div>
            )}

            <div className="ideas-list">
              {aiIdeas.map(({ idea, i }) => (
                <IdeaCard key={i} idea={idea} active={activeIdeaIdx === i}
                  onClick={() => selectIdea(idea, i)}
                  showDelete={false} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Right: inline editor — always mounted ───────────────────────── */}
      <div className="detail-editor">
        <InlineEditor
          videoId={videoId}
          activeIdea={activeIdea}
          activeIdeaIdx={activeIdeaIdx}
          transcribeStatus={video.transcribe_status}
          downloadStatus={video.download_status}
          onIdeasUpdate={(updatedIdeas) => setVideo(v => ({ ...v, ideas: updatedIdeas }))}
        />
      </div>

    </div>
  );
}

// ── StageSection ───────────────────────────────────────────────────────────

function StageSection({ name, status, error, onStart, loading, canStart, disabledReason, children }) {
  const disabled = !canStart || status === "running" || loading;
  return (
    <div className="stage-section">
      <div className="stage-header">
        <span className="stage-name">{name}</span>
        <StatusPill status={status} />
      </div>
      {status !== "running" ? (
        <button className={`btn btn-sm ${status === "done" ? "btn-ghost" : "btn-primary"}`}
          onClick={onStart} disabled={disabled} title={disabledReason || ""}>
          {loading
            ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Starting...</>
            : status === "done" ? "Redo" : `Start ${name}`}
        </button>
      ) : (
        <button className="btn btn-sm btn-secondary" disabled>
          <span className="spinner" style={{ width: 14, height: 14 }} /> Running...
        </button>
      )}
      {children}
      {status === "error" && error && <p className="stage-error">{error}</p>}
    </div>
  );
}

// ── IdeaCard ───────────────────────────────────────────────────────────────

function IdeaCard({ idea, active, onClick, onDelete, showDelete }) {
  const dur = totalDur(idea.segments);
  const segCount = (idea.segments || []).length;
  return (
    <div className={`idea-card ${active ? "idea-card-active" : ""}`}
      onClick={onClick} role="button" tabIndex={0}
      onKeyDown={e => e.key === "Enter" && onClick()}>
      <div className="idea-card-header">
        <h4 className="idea-card-title">{idea.title}</h4>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <span className="idea-card-duration">{formatTime(Math.round(dur))}</span>
          {showDelete && onDelete && (
            <button className="idea-card-delete" onClick={onDelete} title="Delete idea">🗑</button>
          )}
        </div>
      </div>
      <p className="idea-card-desc">{idea.description}</p>
      <div className="idea-card-meta">
        <span className="idea-card-segments">{segCount} seg{segCount !== 1 ? "s" : ""}</span>
        <div className="idea-card-timestamps">
          {(idea.segments || []).map((seg, i) => (
            <span key={i} className="idea-timestamp">
              {formatTime(Math.round(seg.start))}–{formatTime(Math.round(seg.end))}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── SelectionPopup ─────────────────────────────────────────────────────────

function SelectionPopup({ position, overlaps, isShrink, isMerge, isExpand, onAdd, onDismiss }) {
  const ref = useRef(null);

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape") onDismiss();
    }
    function handlePointerDown(e) {
      if (ref.current && !ref.current.contains(e.target)) onDismiss();
    }
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [onDismiss]);

  return (
    <div
      ref={ref}
      className="selection-popup"
      style={{ left: position.x, top: position.y - 48 }}
      onMouseDown={e => e.stopPropagation()}
    >
      <button
        className="btn btn-sm btn-primary"
        onClick={e => { e.stopPropagation(); onAdd(); onDismiss(); }}
      >
        {isShrink ? "⬅ Shrink Segment"
          : isMerge  ? "⇔ Merge Segments"
          : isExpand ? "↔ Expand Segment"
          : "➕ Add Segment"}
      </button>
    </div>
  );
}

// ── InlineEditor ───────────────────────────────────────────────────────────

function InlineEditor({ videoId, activeIdea, activeIdeaIdx, transcribeStatus, downloadStatus, onIdeasUpdate }) {
  const [segments, setSegments]           = useState([]);
  const [activeIdx, setActiveIdx]         = useState(0);
  const [isPreviewing, setIsPreviewing]   = useState(false);
  const [exportQueued, setExportQueued]   = useState(false);
  const [currentTime, setCurrentTime]     = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [transcript, setTranscript]       = useState([]);
  const [saveStatus, setSaveStatus]       = useState(null); // null | "saving" | "saved"

  const videoRef      = useRef(null);
  const previewRef    = useRef(null);
  const segmentsRef   = useRef(segments);
  const activeIdxRef  = useRef(activeIdx);
  const debounceRef   = useRef(null);

  useEffect(() => { segmentsRef.current = segments; }, [segments]);
  useEffect(() => { activeIdxRef.current = activeIdx; }, [activeIdx]);

  // When activeIdea changes, load its segments WITHOUT seeking or remounting video
  useEffect(() => {
    if (!activeIdea) {
      setSegments([]);
      return;
    }
    setSegments((activeIdea.segments || []).map((s, i) => ({ ...s, id: i })));
    setActiveIdx(0);
  }, [activeIdea]);

  // Reload video when download completes
  useEffect(() => {
    if (downloadStatus !== "done") return;
    const v = videoRef.current;
    if (!v) return;
    // Only reload if not already loaded (duration is 0 or NaN)
    if (!v.duration || isNaN(v.duration)) {
      v.load();
    }
  }, [downloadStatus]);
  useEffect(() => {
    if (transcribeStatus !== "done") return;
    if (transcript.length > 0) return; // already loaded
    axios.get(api.transcriptUrl(videoId))
      .then(r => setTranscript(r.data))
      .catch(() => {});
  }, [videoId, transcribeStatus]);

  // Auto-save segments with 800ms debounce
  useEffect(() => {
    if (activeIdeaIdx == null) return;
    if (!activeIdea) return;

    // Clear any pending debounce
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSaveStatus("saving");

    debounceRef.current = setTimeout(async () => {
      try {
        const segsToSave = segmentsRef.current.map(({ start, end }) => ({ start, end }));
        const updatedIdeas = await api.updateIdea(videoId, activeIdeaIdx, { segments: segsToSave });
        if (onIdeasUpdate) onIdeasUpdate(updatedIdeas);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus(null), 2000);
      } catch (e) {
        console.error("Auto-save failed", e);
        setSaveStatus(null);
      }
    }, 800);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments]);

  const activeSeg = segments[activeIdx] ?? segments[0];
  const total = segments.reduce((s, seg) => s + Math.max(0, (seg.end ?? 0) - (seg.start ?? 0)), 0);

  // Seek to segment start when active segment changes (but only if segments exist)
  useEffect(() => {
    const seg = segmentsRef.current[activeIdxRef.current];
    if (!seg || !videoRef.current) return;
    stopPreview();
    videoRef.current.currentTime = seg.start;
  }, [activeIdx]);

  function stopPreview() {
    if (previewRef.current) { cancelAnimationFrame(previewRef.current); previewRef.current = null; }
    setIsPreviewing(false);
  }

  function playAll() {
    const video = videoRef.current;
    const segs = segmentsRef.current;
    if (!video || segs.length === 0) return;
    stopPreview();

    let segIdx = 0;

    function playNext() {
      const seg = segs[segIdx];
      if (!seg || !videoRef.current) { stopPreview(); return; }
      videoRef.current.currentTime = seg.start;
      videoRef.current.play();
      setIsPreviewing(true);

      function check() {
        const v = videoRef.current;
        const s = segs[segIdx];
        if (!v || !s) { stopPreview(); return; }
        if (v.currentTime >= s.end) {
          segIdx++;
          if (segIdx < segs.length) {
            playNext();
          } else {
            v.currentTime = s.end;
            v.pause();
            stopPreview();
          }
          return;
        }
        previewRef.current = requestAnimationFrame(check);
      }
      previewRef.current = requestAnimationFrame(check);
    }

    playNext();
  }

  function handleSegmentChange(idx, { start, end }) {
    setSegments(p => p.map((s, i) => i === idx ? { ...s, start, end } : s));
  }

  function handleTimelineSeek(t) {
    if (videoRef.current) videoRef.current.currentTime = t;
  }

  function removeSegment(idx) {
    if (segments.length <= 1) return;
    setSegments(p => p.filter((_, i) => i !== idx));
    setActiveIdx(p => Math.min(p, segments.length - 2));
  }

  function addSegment() {
    const last = segments[segments.length - 1];
    const newStart = last ? last.end + 1 : 0;
    const newEnd = newStart + 10;
    setSegments(prev => [...prev, { id: Date.now(), start: newStart, end: newEnd }]);
  }

  const exportTitle = activeIdea?.title || "Custom Clip";
  const exportDescription = activeIdea?.description || null;

  async function handleExport() {
    try {
      await api.exportClip(videoId, exportTitle, exportDescription, segments);
      setExportQueued(true);
      setTimeout(() => setExportQueued(false), 3000);
    } catch (e) {
      alert(e.response?.data?.detail || e.message || "Export failed");
    }
  }

  return (
    <div className="inline-editor">
      <div className="ie-header">
        <div className="ie-header-info">
          <span className="ie-title">
            {exportTitle}
            {saveStatus && (
              <span className={`ie-save-status ${saveStatus}`}>
                {saveStatus === "saving" ? "Saving..." : "Saved ✓"}
              </span>
            )}
          </span>
          <span className="ie-total">{formatTime(Math.round(total))} total</span>
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={handleExport}
          disabled={exportQueued || segments.length === 0}
        >
          {exportQueued ? "✓ Queued" : "⬇ Export"}
        </button>
      </div>

      <video
        ref={videoRef}
        className="ie-video"
        src={api.videoUrl(videoId)}
        preload="auto"
        controls
        onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
        onLoadedMetadata={() => setVideoDuration(videoRef.current?.duration ?? 0)}
        onEnded={stopPreview}
      />

      {videoDuration > 0 && segments.length > 0 && (
        <Timeline
          duration={videoDuration}
          segments={segments}
          activeIdx={activeIdx}
          currentTime={currentTime}
          onSeek={handleTimelineSeek}
          onSegmentChange={handleSegmentChange}
          onSelectSegment={setActiveIdx}
        />
      )}

      {activeSeg && segments.length > 0 && (
        <div className="ie-inout">
          <div className="ie-inout-label">
            Segment {activeIdx + 1}
            <span className="ie-seg-dur">{formatTime(Math.round(Math.max(0, activeSeg.end - activeSeg.start)))}</span>
            <span className="ie-current-time">▶ {formatTime(Math.round(currentTime))}</span>
          </div>
          <div className="ie-inout-row">
            <span className="ie-tag in-tag">IN {formatTime(Math.round(activeSeg.start))}</span>
            <span className="ie-arrow">→</span>
            <span className="ie-tag out-tag">OUT {formatTime(Math.round(activeSeg.end))}</span>
          </div>
          <div className="ie-actions">
            <button className="btn btn-primary btn-sm" onClick={isPreviewing ? stopPreview : playAll}>
              {isPreviewing ? "⏹ Stop" : "▶ Play All Segments"}
            </button>
            <button className="btn btn-ghost btn-sm"
              onClick={() => { stopPreview(); if (videoRef.current) videoRef.current.currentTime = activeSeg.start; }}>
              ⏮ IN
            </button>
            <button className="btn btn-ghost btn-sm"
              onClick={() => {
                stopPreview();
                if (videoRef.current) {
                  videoRef.current.currentTime = activeSeg.end;
                  videoRef.current.play();
                }
              }}>
              OUT → continue ▶
            </button>
          </div>
          <p className="ie-hint">Drag segment edges on the timeline to adjust IN / OUT points</p>
        </div>
      )}

      <div className="ie-bottom-row">
        <div className="ie-segments">
          <div className="ie-segments-header">
            <span>Segments</span>
            <button
              className="btn btn-sm btn-ghost"
              style={{ fontSize: "0.72rem", padding: "2px 8px" }}
              onClick={addSegment}
              title="Add a new segment after the last one"
            >
              + Add
            </button>
          </div>
          {segments.length === 0 && (
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
              Select text in the transcript to add segments, or click an idea on the left.
            </p>
          )}
          {segments.map((seg, i) => (
            <div key={seg.id} className={`ie-seg-row ${i === activeIdx ? "ie-seg-active" : ""}`}
              onClick={() => setActiveIdx(i)}>
              <span className="ie-seg-num">{i + 1}</span>
              <span className="ie-seg-times">
                <span className="seg-in">{formatTime(Math.round(seg.start))}</span>
                <span className="seg-sep">→</span>
                <span className="seg-out">{formatTime(Math.round(seg.end))}</span>
              </span>
              <span className="ie-seg-dur-small">{formatTime(Math.round(Math.max(0, seg.end - seg.start)))}</span>
              <button className="ie-seg-remove" onClick={e => { e.stopPropagation(); removeSegment(i); }}
                disabled={segments.length <= 1}>✕</button>
            </div>
          ))}
        </div>

        {transcript.length > 0 && (
          <TranscriptPanel
            transcript={transcript}
            segments={segments}
            currentTime={currentTime}
            onAddSegment={(start, end) => {
              setSegments(prev => {
                const overlapping = prev.filter(s => s.end > start && s.start < end);
                if (overlapping.length === 0) {
                  return [...prev, { id: Date.now(), start, end }];
                }
                if (overlapping.length === 1) {
                  const seg = overlapping[0];
                  const selectionInsideSeg = start >= seg.start && end <= seg.end;
                  if (selectionInsideSeg) {
                    return prev.map(s => s.id === seg.id ? { ...s, start, end } : s);
                  }
                  return prev.map(s => s.id === seg.id
                    ? { ...s, start: Math.min(s.start, start), end: Math.max(s.end, end) }
                    : s
                  );
                }
                const mergedStart = Math.min(start, ...overlapping.map(s => s.start));
                const mergedEnd   = Math.max(end,   ...overlapping.map(s => s.end));
                const overlappingIds = new Set(overlapping.map(s => s.id));
                let replaced = false;
                return prev
                  .filter(s => !overlappingIds.has(s.id) || (!replaced && (replaced = true)))
                  .map(s => s.id === overlapping[0].id
                    ? { ...s, start: mergedStart, end: mergedEnd }
                    : s
                  );
              });
            }}
          />
        )}
      </div>
    </div>
  );
}


// ── TranscriptPanel ────────────────────────────────────────────────────────

function TranscriptPanel({ transcript, segments, currentTime, onAddSegment }) {
  const currentWordRef = useRef(null);
  const [popup, setPopup] = useState(null);

  useEffect(() => {
    currentWordRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [Math.floor(currentTime)]);

  function handleMouseUp(e) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      setPopup(null);
      return;
    }

    const range = selection.getRangeAt(0);
    if (!range) { setPopup(null); return; }

    const container = e.currentTarget;
    const wordSpans = container.querySelectorAll("span[data-start]");

    let minStart = null;
    let maxEnd = null;
    let matchCount = 0;

    for (const span of wordSpans) {
      if (selection.containsNode(span, true)) {
        const s = parseFloat(span.getAttribute("data-start"));
        const en = parseFloat(span.getAttribute("data-end"));
        if (!isNaN(s) && !isNaN(en)) {
          if (minStart === null || s < minStart) minStart = s;
          if (maxEnd === null || en > maxEnd) maxEnd = en;
          matchCount++;
        }
      }
    }

    if (matchCount < 2 || minStart === null || maxEnd === null) {
      setPopup(null);
      return;
    }

    const overlapping = segments.filter(seg => maxEnd > seg.start && minStart < seg.end);
    const overlaps = overlapping.length > 0;
    const isShrink = overlapping.length === 1 &&
      minStart >= overlapping[0].start && maxEnd <= overlapping[0].end;
    const isMerge = overlapping.length > 1;
    const isExpand = overlapping.length === 1 && !isShrink;

    const rect = range.getBoundingClientRect();
    setPopup({
      x: rect.left + rect.width / 2,
      y: rect.top,
      start: minStart,
      end: maxEnd,
      overlaps,
      isShrink,
      isMerge,
      isExpand,
    });
  }

  if (transcript.length === 0) return null;

  return (
    <div className="transcript-panel">
      <div className="transcript-heading">Transcript</div>
      <div className="transcript-body" onMouseUp={handleMouseUp}>
        {transcript.map((w, i) => {
          const isCurrent = currentTime >= w.start && currentTime <= w.end;
          const inSegment = segments.some(seg => w.end > seg.start && w.start < seg.end);

          return (
            <span
              key={i}
              data-idx={i}
              data-start={w.start}
              data-end={w.end}
              ref={isCurrent ? currentWordRef : null}
              className={`tw ${inSegment ? "tw-marked" : "tw-dim"} ${isCurrent ? "tw-current" : ""}`}
            >
              {w.word}{" "}
            </span>
          );
        })}
      </div>

      {popup && (
        <SelectionPopup
          position={{ x: popup.x, y: popup.y }}
          overlaps={popup.overlaps}
          isShrink={popup.isShrink}
          isMerge={popup.isMerge}
          isExpand={popup.isExpand}
          onAdd={() => onAddSegment(popup.start, popup.end)}
          onDismiss={() => {
            setPopup(null);
            window.getSelection()?.removeAllRanges();
          }}
        />
      )}
    </div>
  );
}
