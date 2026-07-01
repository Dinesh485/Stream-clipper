import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../api";
import VideoCard from "../components/VideoCard";
import AddVideoModal from "../components/AddVideoModal";
import "./Home.css";

function hasRunningStatus(videos) {
  return videos.some(
    (v) =>
      v.download_status === "running" ||
      v.transcribe_status === "running" ||
      v.ideas_status === "running"
  );
}

export default function Home({ onSelectVideo, showAddModal, onAddModalClose, refreshKey }) {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef(null);

  const fetchVideos = useCallback(async () => {
    try {
      const data = await api.listVideos();
      setVideos(data);
      return data;
    } catch {
      // silent fail for polling
      return [];
    }
  }, []);

  // Initial load + re-fetch when refreshKey changes
  useEffect(() => {
    setLoading(true);
    fetchVideos().finally(() => setLoading(false));
  }, [fetchVideos, refreshKey]);

  // Polling
  useEffect(() => {
    function scheduleNext(vids) {
      if (hasRunningStatus(vids)) {
        pollRef.current = setTimeout(async () => {
          const updated = await fetchVideos();
          scheduleNext(updated);
        }, 3000);
      }
    }

    scheduleNext(videos);
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [videos, fetchVideos]);

  function handleAdded(video) {
    setVideos((prev) => {
      const exists = prev.find((v) => v.id === video.id);
      if (exists) return prev;
      return [video, ...prev];
    });
    // Start polling immediately
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = setTimeout(async () => {
      await fetchVideos();
    }, 3000);
  }

  if (loading) {
    return (
      <div className="home">
        <div className="home-loading">
          <span className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
        </div>
      </div>
    );
  }

  return (
    <div className="home">
      {videos.length === 0 ? (
        <div className="home-empty">
          <div className="home-empty-icon">🎬</div>
          <h2>No videos yet</h2>
          <p>Add a YouTube video to get started with AI-powered clip ideas</p>
        </div>
      ) : (
        <div className="home-grid">
          {videos.map((video) => (
            <VideoCard
              key={video.id}
              video={video}
              onClick={() => onSelectVideo(video.id)}
              onDelete={async (id) => {
                await api.deleteVideo(id);
                setVideos((prev) => prev.filter((v) => v.id !== id));
              }}
            />
          ))}
        </div>
      )}

      {showAddModal && (
        <AddVideoModal
          onClose={onAddModalClose}
          onAdded={handleAdded}
        />
      )}
    </div>
  );
}
