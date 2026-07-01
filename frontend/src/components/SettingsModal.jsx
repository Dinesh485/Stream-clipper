import { useState, useEffect } from "react";
import { api } from "../api";
import "./SettingsModal.css";

const WHISPER_MODELS = ["tiny", "base", "small", "medium", "large-v2", "large-v3"];

export default function SettingsModal({ onClose }) {
  const [settings, setSettings]       = useState(null);
  const [apiKey, setApiKey]           = useState("");
  const [whisperModel, setWhisperModel] = useState("medium");
  const [geminiModel, setGeminiModel] = useState("gemini-2.5-flash");
  const [geminiModels, setGeminiModels]   = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [ytClientId, setYtClientId]   = useState("");
  const [ytClientSecret, setYtClientSecret] = useState("");
  const [editingYtCreds, setEditingYtCreds] = useState(false);
  const [saving, setSaving]           = useState(false);
  const [saved, setSaved]             = useState(false);
  const [showKey, setShowKey]         = useState(false);
  const [showYtSecret, setShowYtSecret] = useState(false);
  const [connecting, setConnecting]   = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    api.getSettings().then(s => {
      setSettings(s);
      setWhisperModel(s.whisper_model || "medium");
      setGeminiModel(s.gemini_model || "gemini-2.5-flash");
      // Fetch model list if API key is configured
      if (s.gemini_api_key_set) {
        setLoadingModels(true);
        api.listGeminiModels()
          .then(r => setGeminiModels(r.models))
          .catch(() => {})
          .finally(() => setLoadingModels(false));
      }
    });
  }, []);

  // Listen for the OAuth popup result
  useEffect(() => {
    function onMessage(e) {
      if (e.data?.type !== "yt_auth") return;
      setConnecting(false);
      if (e.data.success) {
        // Refresh settings to show new auth state
        api.getSettings().then(s => setSettings(s));
      } else {
        alert(`YouTube auth failed: ${e.data.error || "unknown error"}`);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    const fields = { whisper_model: whisperModel, gemini_model: geminiModel };
    if (apiKey.trim()) fields.gemini_api_key = apiKey.trim();
    if (ytClientId.trim()) fields.yt_client_id = ytClientId.trim();
    if (ytClientSecret.trim()) fields.yt_client_secret = ytClientSecret.trim();
    try {
      const updated = await api.updateSettings(fields);
      setSettings(updated);
      setApiKey("");
      setYtClientId("");
      setYtClientSecret("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      // Re-fetch model list if API key was just set
      if (fields.gemini_api_key && updated.gemini_api_key_set) {
        setLoadingModels(true);
        api.listGeminiModels()
          .then(r => setGeminiModels(r.models))
          .catch(() => {})
          .finally(() => setLoadingModels(false));
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleConnect() {
    setConnecting(true);
    try {
      const { url } = await api.getYouTubeAuthUrl();
      window.open(url, "yt_oauth", "width=520,height=640,scrollbars=yes");
      // Result comes back via postMessage listener above
    } catch (e) {
      setConnecting(false);
      alert(e.response?.data?.detail || e.message || "Failed to get auth URL");
    }
  }

  async function handleDisconnect() {
    if (!confirm("Disconnect your YouTube account? You can reconnect any time.")) return;
    setDisconnecting(true);
    try {
      await api.disconnectYouTube();
      const updated = await api.getSettings();
      setSettings(updated);
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={e => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="settings-close" onClick={onClose}>✕</button>
        </div>

        {!settings ? (
          <div className="settings-loading">
            <span className="spinner" style={{ width: 24, height: 24 }} />
          </div>
        ) : (
          <form className="settings-form" onSubmit={handleSave}>

            {/* ── Gemini API Key ──────────────────────────────────────── */}
            <div className="settings-section">
              <label className="settings-label">Gemini API Key</label>
              {settings.gemini_api_key_set && (
                <p className="settings-current">
                  Current: <code>{settings.gemini_api_key_masked}</code>
                  <span className="settings-set-badge">✓ Set</span>
                </p>
              )}
              {!settings.gemini_api_key_set && (
                <p className="settings-warning">⚠ Not set — AI Ideas won't work until configured</p>
              )}
              <div className="settings-key-wrap">
                <input
                  type={showKey ? "text" : "password"}
                  className="settings-input"
                  placeholder={settings.gemini_api_key_set ? "Enter new key to replace..." : "AIza..."}
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  autoComplete="off"
                />
                <button type="button" className="btn btn-ghost btn-sm"
                  onClick={() => setShowKey(v => !v)}>
                  {showKey ? "Hide" : "Show"}
                </button>
              </div>
              <p className="settings-hint">
                Get your key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a>
              </p>
            </div>

            {/* ── Gemini Model ─────────────────────────────────────────── */}
            <div className="settings-section">
              <label className="settings-label">Gemini Model</label>
              {!settings.gemini_api_key_set ? (
                <p className="settings-hint">Set your Gemini API key above to load available models.</p>
              ) : loadingModels ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="spinner" style={{ width: 14, height: 14 }} />
                  <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>Loading models...</span>
                </div>
              ) : geminiModels.length > 0 ? (
                <select
                  className="settings-input"
                  value={geminiModel}
                  onChange={e => setGeminiModel(e.target.value)}
                >
                  {geminiModels.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              ) : (
                /* fallback: API key set but fetch failed — allow free-text */
                <input
                  type="text"
                  className="settings-input"
                  placeholder="e.g. gemini-2.5-flash"
                  value={geminiModel}
                  onChange={e => setGeminiModel(e.target.value)}
                />
              )}
              <p className="settings-hint">
                Used for AI clip idea generation.
              </p>
            </div>

            {/* ── Whisper Model ───────────────────────────────────────── */}
            <div className="settings-section">
              <label className="settings-label">Whisper Model</label>
              <select
                className="settings-input"
                value={whisperModel}
                onChange={e => setWhisperModel(e.target.value)}
              >
                {WHISPER_MODELS.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <p className="settings-hint">
                Larger models are more accurate but slower. <code>medium</code> is a good default.
              </p>
            </div>

            {/* ── YouTube OAuth ────────────────────────────────────────── */}
            <div className="settings-section">
              <label className="settings-label">YouTube Integration</label>

              {/* OAuth client credentials — always editable */}
              {(!settings.yt_client_id_set || !settings.yt_client_secret_set || editingYtCreds) ? (
                <>
                  {(!settings.yt_client_id_set || !settings.yt_client_secret_set) && (
                    <p className="settings-warning">
                      ⚠ Enter your Google OAuth client credentials to enable YouTube features.
                    </p>
                  )}
                  <p className="settings-hint" style={{ marginBottom: 8 }}>
                    Create OAuth 2.0 credentials in the{" "}
                    <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">
                      Google Cloud Console
                    </a>{" "}
                    (Application type: Web, redirect URI: <code>http://localhost:8000/api/youtube/callback</code>).
                  </p>
                  <input
                    type="text"
                    className="settings-input"
                    placeholder={settings.yt_client_id_set ? "Enter new Client ID to replace..." : "Client ID"}
                    value={ytClientId}
                    onChange={e => setYtClientId(e.target.value)}
                    autoComplete="off"
                    style={{ marginBottom: 8 }}
                  />
                  <div className="settings-key-wrap" style={{ marginBottom: 4 }}>
                    <input
                      type={showYtSecret ? "text" : "password"}
                      className="settings-input"
                      placeholder={settings.yt_client_secret_set ? "Enter new Client Secret to replace..." : "Client Secret"}
                      value={ytClientSecret}
                      onChange={e => setYtClientSecret(e.target.value)}
                      autoComplete="off"
                    />
                    <button type="button" className="btn btn-ghost btn-sm"
                      onClick={() => setShowYtSecret(v => !v)}>
                      {showYtSecret ? "Hide" : "Show"}
                    </button>
                  </div>
                  {editingYtCreds && (
                    <button type="button" className="btn btn-ghost btn-sm"
                      style={{ alignSelf: "flex-start" }}
                      onClick={() => { setEditingYtCreds(false); setYtClientId(""); setYtClientSecret(""); }}>
                      Cancel
                    </button>
                  )}
                </>
              ) : (
                /* Credentials set — show status + edit button */
                <div className="yt-creds-row">
                  <span className="settings-set-badge">✓ Credentials saved</span>
                  <button type="button" className="btn btn-ghost btn-sm"
                    onClick={() => setEditingYtCreds(true)}>
                    Edit Credentials
                  </button>
                </div>
              )}

              {/* Connect / disconnect — only when creds are saved and not editing */}
              {settings.yt_client_id_set && settings.yt_client_secret_set && !editingYtCreds && (
                <div className="yt-connect-row" style={{ marginTop: 8 }}>
                  {settings.yt_authenticated ? (
                    <>
                      <span className="settings-set-badge yt-connected-badge">✓ Connected to YouTube</span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={handleDisconnect}
                        disabled={disconnecting}
                      >
                        {disconnecting ? "Disconnecting..." : "Disconnect"}
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="settings-warning">Not connected — click Connect to authorize.</p>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm yt-connect-btn"
                        onClick={handleConnect}
                        disabled={connecting}
                      >
                        {connecting ? (
                          <><span className="spinner" style={{ width: 12, height: 12 }} /> Connecting...</>
                        ) : (
                          "▶ Connect YouTube"
                        )}
                      </button>
                    </>
                  )}
                </div>
              )}

              <p className="settings-hint" style={{ marginTop: 6 }}>
                Enables browsing your channel videos and uploading clips as private videos.
              </p>
            </div>

            <div className="settings-footer">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? "Saving..." : saved ? "✓ Saved" : "Save Settings"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
