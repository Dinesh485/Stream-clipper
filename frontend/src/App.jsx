import { useState, useEffect } from "react";
import Home from "./pages/Home";
import Detail from "./pages/Detail";
import ExportsPanel from "./components/ExportsPanel";
import SettingsModal from "./components/SettingsModal";
import ChannelVideosModal from "./components/ChannelVideosModal";
import { api } from "./api";
import "./App.css";

export default function App() {
  const [page, setPage]                     = useState("home");
  const [selectedVideoId, setSelectedVideoId] = useState(null);
  const [showExports, setShowExports]       = useState(false);
  const [showAddModal, setShowAddModal]     = useState(false);
  const [showSettings, setShowSettings]     = useState(false);
  const [showChannelVideos, setShowChannelVideos] = useState(false);
  const [ytAuthenticated, setYtAuthenticated] = useState(false);
  const [libraryVideos, setLibraryVideos]   = useState([]); // for "already added" dedup
  const [homeRefreshKey, setHomeRefreshKey] = useState(0);

  // Check YouTube auth status on mount and after settings close
  useEffect(() => {
    api.getYouTubeStatus()
      .then(s => setYtAuthenticated(s.authenticated))
      .catch(() => {});
  }, []);

  function handleSettingsClose() {
    setShowSettings(false);
    // Re-check auth status after settings may have changed
    api.getYouTubeStatus()
      .then(s => setYtAuthenticated(s.authenticated))
      .catch(() => {});
  }

  // Keep a live list of library video IDs so ChannelVideosModal can mark already-added ones
  useEffect(() => {
    api.listVideos().then(vs => setLibraryVideos(vs)).catch(() => {});
  }, []);

  function handleVideoAdded(video) {
    setLibraryVideos(prev => {
      if (prev.find(v => v.id === video.id)) return prev;
      return [video, ...prev];
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div className="app-topbar">
        <span className="app-topbar-title">🎬 Stream Clipper</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {page === "home" && (
            <>
              <button className="btn btn-primary btn-sm" onClick={() => setShowAddModal(true)}>
                + Add Video
              </button>
              {ytAuthenticated && (
                <button
                  className="btn btn-sm yt-channel-btn"
                  onClick={() => setShowChannelVideos(true)}
                  title="Browse your YouTube live streams"
                >
                  ▶ My Streams
                </button>
              )}
            </>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => setShowExports(true)}>
            ⬇ Exports
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowSettings(true)}>
            ⚙ Settings
          </button>
        </div>
      </div>

      <div className="app-content">
        {page === "detail" && selectedVideoId ? (
          <Detail
            videoId={selectedVideoId}
            onBack={() => { setPage("home"); setSelectedVideoId(null); }}
          />
        ) : (
          <Home
            onSelectVideo={(id) => { setSelectedVideoId(id); setPage("detail"); }}
            showAddModal={showAddModal}
            onAddModalClose={() => setShowAddModal(false)}
            onVideoAdded={handleVideoAdded}
            refreshKey={homeRefreshKey}
          />
        )}
      </div>

      {showExports && (
        <ExportsPanel
          onClose={() => setShowExports(false)}
          ytAuthenticated={ytAuthenticated}
        />
      )}
      {showSettings && <SettingsModal onClose={handleSettingsClose} />}
      {showChannelVideos && (
        <ChannelVideosModal
          onClose={() => setShowChannelVideos(false)}
          onAdd={(video) => {
            handleVideoAdded(video);
            setHomeRefreshKey(k => k + 1);
          }}
          existingIds={libraryVideos.map(v => v.id)}
        />
      )}
    </div>
  );
}
