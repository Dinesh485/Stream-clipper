const STATUS_COLORS = {
  pending: { bg: "#2a2a2a", color: "#888", border: "#444" },
  running: { bg: "#2d1f0a", color: "#f4a261", border: "#7a4a1a" },
  done: { bg: "#0a2420", color: "#2a9d8f", border: "#1a5a50" },
  error: { bg: "#2a0a0a", color: "#e63946", border: "#7a1a1a" },
};

const STATUS_LABELS = {
  pending: "Pending",
  running: "Running",
  done: "Done",
  error: "Error",
};

export default function StatusPill({ status, label }) {
  const s = STATUS_COLORS[status] || STATUS_COLORS.pending;
  const displayLabel = label || STATUS_LABELS[status] || status;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        padding: "3px 9px",
        borderRadius: "20px",
        fontSize: "0.75rem",
        fontWeight: 600,
        background: s.bg,
        color: s.color,
        border: `1px solid ${s.border}`,
        userSelect: "none",
        whiteSpace: "nowrap",
      }}
    >
      {status === "running" && (
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: s.color,
            animation: "pulse 1.2s ease-in-out infinite",
            flexShrink: 0,
          }}
        />
      )}
      {displayLabel}
    </span>
  );
}
