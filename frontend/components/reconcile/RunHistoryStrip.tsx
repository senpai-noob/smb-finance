"use client";
import { RunSummary } from "@/lib/reconcile";

export function RunHistoryStrip({
  runs,
  selectedRunId,
  onSelect,
}: {
  runs: RunSummary[];
  selectedRunId: number | null;
  onSelect: (id: number) => void;
}) {
  if (runs.length === 0) return null;

  return (
    <div style={{
      display: "flex", overflowX: "auto", gap: 8,
      paddingBottom: 12, marginBottom: 16,
      borderBottom: "1px solid rgba(30,41,59,0.7)",
    }}>
      {runs.slice(0, 5).map(r => {
        const active = r.id === selectedRunId;
        const matchedCount = r.summary?.matches_by_pass
          ? Object.values(r.summary.matches_by_pass).reduce((a, b) => a + b, 0)
          : 0;
        const totalSrc = matchedCount + (r.summary?.unmatched_source?.length ?? 0);
        const rate = totalSrc > 0 ? Math.round((matchedCount / totalSrc) * 100) : 0;

        return (
          <button
            key={r.id}
            onClick={() => onSelect(r.id)}
            style={{
              flexShrink: 0,
              border: active ? "1px solid #34d399" : "1px solid rgba(30,41,59,0.7)",
              background: active ? "rgba(52,211,153,0.05)" : "transparent",
              borderRadius: 10, padding: "10px 14px",
              display: "flex", flexDirection: "column", gap: 4,
              cursor: "pointer", textAlign: "left", minWidth: 180,
            }}
          >
            <div style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
              color: active ? "#34d399" : "#475569",
              letterSpacing: "0.1em", textTransform: "uppercase",
            }}>
              {new Date(r.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              {" · "}{r.status}
            </div>
            <div style={{
              fontFamily: "'Manrope', system-ui, sans-serif",
              fontSize: 12, color: "#cbd5e1",
            }}>
              {rate}% matched
            </div>
          </button>
        );
      })}
    </div>
  );
}
