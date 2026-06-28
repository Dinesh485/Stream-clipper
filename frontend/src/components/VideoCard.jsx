import { api } from "../api";
import StatusPill from "./StatusPill";
import "./VideoCard.css";

function formatDuration(seconds) {
  if (!seconds) return "--:--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function VideoCard({ video, onClick, onDelete }) {
  const isDownloading = video.download_status === "running";
  const downloadDone = video.download_status === "done";
  const progress = video.download_progress || 0;

  function handleDelete(e) {
    e.stopPropagation();
    if (confirm(`Delete "${video.title || "this video"}"? This cannot be undone.`)) {
      onDelete(video.id);
    }
  }

  return (
    <div className="video-card" onClick={onClick} role="button" tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}>
      <div className="video-card-thumb">
        {downloadDone ? (
          <img
            src={api.thumbnailUrl(video.id)}
            alt={video.title || "Video thumbnail"}
            className="video-card-thumb-img"
            loading="lazy"
            onError={(e) => {
              e.target.style.display = "none";
              e.target.nextSibling.style.display = "flex";
            }}
          />
        ) : null}
        <div
          className={`video-card-thumb-placeholder ${!downloadDone ? "visible" : ""}`}
          style={{ display: downloadDone ? "none" : "flex" }}
        >
          <span className="thumb-icon">🎬</span>
          {video.title && (
            <span className="thumb-title">{video.title}</span>
          )}
        </div>

        {isDownloading && (
          <div className="video-card-progress-bar">
            <div
              className="video-card-progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {video.duration && (
          <span className="video-card-duration">{formatDuration(video.duration)}</span>
        )}

        <button className="video-card-delete" onClick={handleDelete} title="Delete video">
          🗑
        </button>
      </div>

      <div className="video-card-body">
        <h3 className="video-card-title">{video.title || "Untitled"}</h3>

        <div className="video-card-pills">
          <StatusPill status={video.download_status} label="Download" />
          <StatusPill status={video.transcribe_status} label="Transcribe" />
          <StatusPill status={video.ideas_status} label="Ideas" />
        </div>
      </div>
    </div>
  );
}
