import { useState, useEffect } from "react";
import { api } from "../api";
import "./SettingsModal.css";

const WHISPER_MODELS = ["tiny", "base", "small", "medium", "large-v2", "large-v3"];

export default function SettingsModal({ onClose }) {
  const [settings, setSettings] = useState(null);
  const [apiKey, setApiKey] = useState("");
  const [whisperModel, setWhisperModel] = useState("medium");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    api.getSettings().then(s => {
      setSettings(s);
      setWhisperModel(s.whisper_model || "medium");
    });
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    const fields = { whisper_model: whisperModel };
    if (apiKey.trim()) fields.gemini_api_key = apiKey.trim();
    try {
      const updated = await api.updateSettings(fields);
      setSettings(updated);
      setApiKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
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
