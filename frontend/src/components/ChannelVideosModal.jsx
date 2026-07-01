import { useState, useEffect, useCallback } from "react";
import { api } from "../api";
import "./ChannelVideosModal.css";

function formatDuration(seconds) {
  if (!seconds) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

const PRIVACY_ICONS = { public: "🌍", private: "🔒", unlisted: "🔗" };

export default function ChannelVideosModal({ onClose, onAdd }) {
  const [videos, setVideos]           = useState([]);
  const [nextPageToken, setNextPage]  = useState(null);
  const [loading, setLoading]         = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing]   = useState(false);
  const [fromCache, setFromCache]     = useState(false);
  const [error, setError]             = useState("");
  const [adding, setAdding]           = useState({});
  const [added, setAdded]             = useState({});
  const [search, setSearch]           = useState("");
  const [libraryIds, setLibraryIds]   = useState(new Set());

  // Fetch current library IDs on open so we always reflect latest state
  useEffect(() => {
    api.listVideos()
      .then(vs => setLibraryIds(new Set(vs.map(v => v.id))))
      .catch(() => {});
  }, []);

  const fetchPage = useCallback(async (pageToken = null, bust = false) => {
    try {
      const res = await api.getChannelVideos(50, pageToken, bust);
      setVideos(prev => pageToken ? [...prev, ...res.items] : res.items);
      setNextPage(res.nextPageToken || null);
      setFromCache(res.cached === true);
      setError("");
    } catch (e) {
      setError(e.response?.data?.detail || e.message || "Failed to load streams");
    }
  }, []);

  useEffect(() => {
    fetchPage(null, false).finally(() => setLoading(false));
  }, [fetchPage]);

  async function handleRefresh() {
    setRefreshing(true);
    await fetchPage(null, true);
    setRefreshing(false);
  }

  async function handleLoadMore() {
    if (!nextPageToken || loadingMore) return;
    setLoadingMore(true);
    await fetchPage(nextPageToken, false);
    setLoadingMore(false);
  }

  async function handleAdd(video) {
    if (adding[video.id] || added[video.id] || libraryIds.has(video.id)) return;
    setAdding(prev => ({ ...prev, [video.id]: true }));
    try {
      const result = await api.addVideo(`https://www.youtube.com/watch?v=${video.videoId}`);
      setAdded(prev => ({ ...prev, [video.id]: true }));
      setLibraryIds(prev => new Set([...prev, video.id]));
      onAdd(result);
    } catch (e) {
      alert(e.response?.data?.detail || e.message || "Failed to add video");
    } finally {
      setAdding(prev => ({ ...prev, [video.id]: false }));
    }
  }

  const filtered = search.trim()
    ? videos.filter(v => v.title.toLowerCase().includes(search.toLowerCase()))
    : videos;

  return (
    <div className="cv-overlay" onClick={onClose}>
      <div className="cv-modal" onClick={e => e.stopPropagation()}>

        <div className="cv-header">
          <div className="cv-header-left">
            <span className="cv-yt-badge">▶ YouTube</span>
            <h2>Past Live Streams</h2>
            {fromCache && !loading && (
              <span className="cv-cache-hint">cached</span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {!loading && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleRefresh}
                disabled={refreshing}
                title="Refresh from YouTube"
              >
                {refreshing
                  ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Refreshing...</>
                  : "↻ Refresh"}
              </button>
            )}
            <button className="cv-close" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>

        <div className="cv-search-bar">
          <input
            className="cv-search"
            type="text"
            placeholder="Search streams..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="cv-body">
          {loading ? (
            <div className="cv-loading">
              <span className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
              <p>Loading streams...</p>
            </div>
          ) : error ? (
            <div className="cv-error"><p>⚠ {error}</p></div>
          ) : filtered.length === 0 ? (
            <div className="cv-empty">
              <p>{search ? "No streams match your search." : "No completed live streams found."}</p>
            </div>
          ) : (
            <>
              <div className="cv-list">
                {filtered.map(video => {
                  const alreadyAdded = libraryIds.has(video.id) || added[video.id];
                  const isAdding = adding[video.id];
                  const dateStr = formatDate(video.actualStartTime);
                  return (
                    <div key={video.id} className="cv-item">
                      <div className="cv-thumb-wrap">
                        {video.thumbnail
                          ? <img src={video.thumbnail} alt={video.title} className="cv-thumb" loading="lazy" />
                          : <div className="cv-thumb-placeholder">🎬</div>
                        }
                        {video.duration > 0 && (
                          <span className="cv-duration">{formatDuration(video.duration)}</span>
                        )}
                      </div>

                      <div className="cv-item-info">
                        <span className="cv-item-title">{video.title}</span>
                        <div className="cv-item-meta">
                          {video.privacyStatus && (
                            <span className="cv-privacy">
                              {PRIVACY_ICONS[video.privacyStatus] || ""} {video.privacyStatus}
                            </span>
                          )}
                          {dateStr && <span className="cv-date">{dateStr}</span>}
                        </div>
                      </div>

                      <button
                        className={`btn btn-sm ${alreadyAdded ? "btn-ghost" : "btn-primary"}`}
                        onClick={() => handleAdd(video)}
                        disabled={alreadyAdded || isAdding}
                      >
                        {isAdding
                          ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Adding...</>
                          : alreadyAdded ? "✓ Added" : "+ Add"}
                      </button>
                    </div>
                  );
                })}
              </div>

              {nextPageToken && (
                <div className="cv-load-more">
                  <button className="btn btn-ghost" onClick={handleLoadMore} disabled={loadingMore}>
                    {loadingMore
                      ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Loading...</>
                      : "Load more"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
