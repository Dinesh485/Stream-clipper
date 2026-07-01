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
  const [homeRefreshKey, setHomeRefreshKey] = useState(0);

  useEffect(() => {
    api.getYouTubeStatus()
      .then(s => setYtAuthenticated(s.authenticated))
      .catch(() => {});
  }, []);

  function handleSettingsClose() {
    setShowSettings(false);
    api.getYouTubeStatus()
      .then(s => setYtAuthenticated(s.authenticated))
      .catch(() => {});
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
          onAdd={() => setHomeRefreshKey(k => k + 1)}
        />
      )}
    </div>
  );
}
