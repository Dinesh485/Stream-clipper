import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { api } from "../api";
import "./ExportsPanel.css";

function useCopy() {
  const [copied, setCopied] = useState(false);
  function copy(text) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return [copied, copy];
}

function CopyButton({ text }) {
  const [copied, copy] = useCopy();
  return (
    <button className={`copy-btn ${copied ? "copy-btn-done" : ""}`}
      title={copied ? "Copied!" : "Copy"}
      onClick={() => copy(text)}>
      {copied ? "✓" : "📋"}
    </button>
  );
}

function hasRunning(exports) {
  return exports.some(e =>
    e.status === "running" || e.status === "pending" ||
    e.yt_upload_status === "uploading" ||
    e.yt_caption_status === "transcribing" ||
    e.yt_caption_status === "uploading"
  );
}

function StatusBadge({ status }) {
  const map = {
    pending: { label: "Pending",      color: "#888" },
    running: { label: "Exporting...", color: "#f4a261" },
    done:    { label: "Done",         color: "#2a9d8f" },
    error:   { label: "Error",        color: "#e63946" },
  };
  const s = map[status] || map.pending;
  return (
    <span className="export-badge" style={{ color: s.color, borderColor: s.color }}>
      {status === "running" && <span className="export-spinner" />}
      {s.label}
    </span>
  );
}

function YtUploadBadge({ status, progress, videoUrl }) {
  if (!status || status === "idle") return null;

  const map = {
    uploading:    { label: `Uploading${progress > 0 ? ` ${Math.round(progress)}%` : "..."}`, color: "#f4a261" },
    done:         { label: "On YouTube ✓", color: "#ff4444" },
    error:        { label: "Upload failed", color: "#e63946" },
  };
  const s = map[status];
  if (!s) return null;

  return (
    <span className="export-badge yt-badge" style={{ color: s.color, borderColor: s.color }}>
      {status === "uploading" && <span className="export-spinner" />}
      {status === "done" && videoUrl
        ? <a href={videoUrl} target="_blank" rel="noreferrer" style={{ color: s.color, textDecoration: "none" }}>
            ▶ {s.label}
          </a>
        : s.label}
    </span>
  );
}

function YtCaptionBadge({ status }) {
  const map = {
    transcribing: { label: "Transcribing clip...", color: "#f4a261" },
    pending:      { label: "Captions pending",    color: "#888" },
    uploading:    { label: "Uploading captions...", color: "#f4a261" },
    done:         { label: "Captions ✓",           color: "#2a9d8f" },
    error:        { label: "Captions failed",      color: "#e63946" },
  };
  const s = map[status];
  if (!s) return null;
  return (
    <span className="export-badge" style={{ color: s.color, borderColor: s.color }}>
      {(status === "transcribing" || status === "uploading") && <span className="export-spinner" />}
      {s.label}
    </span>
  );
}

export default function ExportsPanel({ onClose, ytAuthenticated }) {
  const [exports, setExports]     = useState([]);
  const [uploading, setUploading] = useState({});
  const pollRef = useRef(null);

  async function fetchExports() {
    const res = await axios.get("/api/exports");
    setExports(res.data);
    return res.data;
  }

  useEffect(() => { fetchExports(); }, []);

  useEffect(() => {
    function schedule(list) {
      if (hasRunning(list)) {
        pollRef.current = setTimeout(async () => {
          const updated = await fetchExports();
          schedule(updated);
        }, 2000);
      }
    }
    schedule(exports);
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [exports]);

  async function handleDelete(id, e) {
    e.stopPropagation();
    await axios.delete(`/api/exports/${id}`);
    setExports(prev => prev.filter(ex => ex.id !== id));
  }

  function handleDownload(ex) {
    const a = document.createElement("a");
    a.href = `/api/exports/${ex.id}/download`;
    const safe = (ex.title || "clip").replace(/[^\w\- ]/g, "").trim().replace(/ /g, "_");
    a.download = `${safe}.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function handleUpload(ex) {
    if (uploading[ex.id]) return;
    setUploading(prev => ({ ...prev, [ex.id]: true }));
    try {
      await api.uploadToYouTube(ex.id, "private");
      // Start polling to track upload progress
      const updated = await fetchExports();
      // polling loop handles the rest
    } catch (e) {
      alert(e.response?.data?.detail || e.message || "Upload failed");
    } finally {
      setUploading(prev => ({ ...prev, [ex.id]: false }));
    }
  }

  return (
    <div className="exports-overlay" onClick={onClose}>
      <div className="exports-panel" onClick={e => e.stopPropagation()}>
        <div className="exports-header">
          <h2>Exports</h2>
          <button className="exports-close" onClick={onClose}>✕</button>
        </div>

        {exports.length === 0 ? (
          <div className="exports-empty">
            <p>No exports yet.</p>
            <p>Click "Export" in the editor to start one.</p>
          </div>
        ) : (
          <div className="exports-list">
            {exports.map(ex => (
              <div key={ex.id} className="export-item">
                <div className="export-item-info">
                  <div className="export-item-row">
                    <span className="export-item-title">{ex.title || "Untitled"}</span>
                    {ex.title && <CopyButton text={ex.title} />}
                  </div>
                  {ex.description && (
                    <div className="export-item-row">
                      <span className="export-item-desc">{ex.description}</span>
                      <CopyButton text={ex.description} />
                    </div>
                  )}
                  <div className="export-item-badges">
                    <StatusBadge status={ex.status} />
                    <YtUploadBadge
                      status={ex.yt_upload_status}
                      progress={ex.yt_upload_progress}
                      videoUrl={ex.yt_video_url}
                    />
                    <YtCaptionBadge status={ex.yt_caption_status} />
                  </div>
                  {ex.error && <span className="export-item-error">{ex.error}</span>}
                  {ex.yt_upload_error && (
                    <span className="export-item-error">YouTube: {ex.yt_upload_error}</span>
                  )}
                </div>

                <div className="export-item-actions">
                  {ex.status === "done" && (
                    <button className="btn btn-primary btn-sm" onClick={() => handleDownload(ex)}>
                      ⬇ Download
                    </button>
                  )}
                  {/* Upload to YouTube — only show for manual retry after failure */}
                  {ex.status === "done" &&
                   ytAuthenticated &&
                   ex.yt_upload_status === "error" && (
                    <button
                      className="btn btn-sm yt-upload-btn"
                      onClick={() => handleUpload(ex)}
                      disabled={uploading[ex.id]}
                      title="Retry upload to YouTube"
                    >
                      {uploading[ex.id]
                        ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Uploading...</>
                        : "↑ Retry Upload"}
                    </button>
                  )}
                  <button className="btn btn-ghost btn-sm"
                    onClick={e => handleDelete(ex.id, e)}
                    disabled={ex.status === "running" || ex.yt_upload_status === "uploading"}>
                    🗑
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
