import { useState, useEffect, useRef } from "react";
import axios from "axios";
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
  return exports.some(e => e.status === "running" || e.status === "pending");
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

export default function ExportsPanel({ onClose }) {
  const [exports, setExports] = useState([]);
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
                  <StatusBadge status={ex.status} />
                  {ex.error && <span className="export-item-error">{ex.error}</span>}
                </div>
                <div className="export-item-actions">
                  {ex.status === "done" && (
                    <button className="btn btn-primary btn-sm" onClick={() => handleDownload(ex)}>
                      ⬇ Download
                    </button>
                  )}
                  <button className="btn btn-ghost btn-sm"
                    onClick={e => handleDelete(ex.id, e)}
                    disabled={ex.status === "running"}>
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
