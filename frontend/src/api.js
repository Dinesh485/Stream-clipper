import axios from "axios";

export const api = {
  // Video library
  addVideo: (url) =>
    axios.post(`/api/videos`, { url }).then((r) => r.data),

  listVideos: () =>
    axios.get(`/api/videos`).then((r) => r.data),

  getVideo: (id) =>
    axios.get(`/api/videos/${id}`).then((r) => r.data),

  deleteVideo: (id) =>
    axios.delete(`/api/videos/${id}`).then((r) => r.data),

  getStatus: (id) =>
    axios.get(`/api/videos/${id}/status`).then((r) => r.data),

  // Actions
  startDownload: (id) =>
    axios.post(`/api/videos/${id}/download`).then((r) => r.data),

  startTranscribe: (id) =>
    axios.post(`/api/videos/${id}/transcribe`).then((r) => r.data),

  startGenerateIdeas: (id) =>
    axios.post(`/api/videos/${id}/generate-ideas`).then((r) => r.data),

  // Export — starts background job, returns export record
  exportClip: (video_id, title, description, segments) =>
    axios.post(`/api/export`, { video_id, title, description, segments }).then((r) => r.data),

  // Exports list
  listExports: () =>
    axios.get(`/api/exports`).then((r) => r.data),

  deleteExport: (id) =>
    axios.delete(`/api/exports/${id}`).then((r) => r.data),

  exportDownloadUrl: (id) => `/api/exports/${id}/download`,

  // Idea management
  createIdea: (videoId, title, description) =>
    axios.post(`/api/videos/${videoId}/ideas`, { title, description }).then(r => r.data),

  updateIdea: (videoId, ideaIdx, fields) =>
    axios.put(`/api/videos/${videoId}/ideas/${ideaIdx}`, fields).then(r => r.data),

  deleteIdea: (videoId, ideaIdx) =>
    axios.delete(`/api/videos/${videoId}/ideas/${ideaIdx}`).then(r => r.data),

  // Gemini models
  listGeminiModels: () =>
    axios.get(`/api/gemini/models`).then((r) => r.data),

  // Settings
  getSettings: () =>
    axios.get(`/api/settings`).then((r) => r.data),

  updateSettings: (fields) =>
    axios.put(`/api/settings`, fields).then((r) => r.data),

  // YouTube OAuth
  getYouTubeStatus: () =>
    axios.get(`/api/youtube/status`).then((r) => r.data),

  getYouTubeAuthUrl: () =>
    axios.get(`/api/youtube/auth-url`).then((r) => r.data),

  disconnectYouTube: () =>
    axios.post(`/api/youtube/disconnect`).then((r) => r.data),

  // YouTube channel videos (completed live broadcasts)
  getChannelVideos: (maxResults = 50, pageToken = null, bust = false) => {
    const params = { max_results: maxResults };
    if (pageToken) params.page_token = pageToken;
    if (bust) params.bust = true;
    return axios.get(`/api/youtube/channel-videos`, { params }).then((r) => r.data);
  },

  // Upload exported clip to YouTube
  uploadToYouTube: (exportId, privacyStatus = "private") =>
    axios.post(`/api/youtube/upload`, { export_id: exportId, privacy_status: privacyStatus }).then((r) => r.data),

  // File URLs
  thumbnailUrl: (id) => `/thumbnails/${id}`,
  videoUrl: (id) => `/video/${id}`,
  waveformUrl: (id) => `/api/waveform/${id}`,
  transcriptUrl: (id) => `/api/transcript/${id}`,
};
