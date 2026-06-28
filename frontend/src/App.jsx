import { useState } from "react";
import Home from "./pages/Home";
import Detail from "./pages/Detail";
import ExportsPanel from "./components/ExportsPanel";
import SettingsModal from "./components/SettingsModal";
import "./App.css";

export default function App() {
  const [page, setPage] = useState("home");
  const [selectedVideoId, setSelectedVideoId] = useState(null);
  const [showExports, setShowExports] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div className="app-topbar">
        <span className="app-topbar-title">🎬 Stream Clipper</span>
        <div style={{ display: "flex", gap: 8 }}>
          {page === "home" && (
            <button className="btn btn-primary btn-sm" onClick={() => setShowAddModal(true)}>
              + Add Video
            </button>
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
          />
        )}
      </div>

      {showExports && <ExportsPanel onClose={() => setShowExports(false)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
