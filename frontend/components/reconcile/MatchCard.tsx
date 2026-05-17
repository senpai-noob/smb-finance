"use client";
import { useState } from "react";
import { Loader2, Check, X } from "lucide-react";
import { MatchRow, patchMatch } from "@/lib/reconcile";

const CONF_COLOR = {
  high:   { bg: "rgba(52,211,153,0.08)", border: "rgba(52,211,153,0.3)", text: "#34d399" },
  medium: { bg: "rgba(251,191,36,0.08)", border: "rgba(251,191,36,0.3)", text: "#fbbf24" },
  low:    { bg: "rgba(148,163,184,0.08)", border: "rgba(148,163,184,0.25)", text: "#94a3b8" },
};

const PASS_LABEL: Record<number, string> = {
  1: "Exact match",
  2: "Fuzzy match",
  3: "Fee-inferred match",
};

export function MatchCard({
  match,
  onChange,
  onOpenDrilldown,
}: {
  match: MatchRow;
  onChange: (updated: MatchRow) => void;
  onOpenDrilldown: (matchId: number) => void;
}) {
  const [busy, setBusy] = useState<"accept" | "reject" | null>(null);
  const conf = CONF_COLOR[match.confidence];

  async function act(status: "accepted" | "rejected") {
    setBusy(status === "accepted" ? "accept" : "reject");
    try {
      const updated = await patchMatch(match.id, status);
      onChange(updated);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div onClick={() => onOpenDrilldown(match.id)} style={{
      cursor: "pointer",
      border: `1px solid ${conf.border}`,
      borderRadius: 12,
      background: conf.bg,
      padding: 16,
      display: "flex", flexDirection: "column", gap: 10,
      opacity: match.status === "rejected" ? 0.4 : 1,
      transition: "opacity 150ms",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
          letterSpacing: "0.12em", textTransform: "uppercase",
          color: conf.text,
        }}>
          {PASS_LABEL[match.pass_no] ?? "Match"} · {match.confidence}
        </span>
        {match.inferred_fee != null && (
          <span style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
            color: "#94a3b8",
          }}>
            fee ₹{Math.abs(match.inferred_fee).toLocaleString("en-IN")}
          </span>
        )}
      </div>

      <div style={{
        fontFamily: "'Manrope', system-ui, sans-serif",
        fontSize: 13, color: "#e2e8f0", lineHeight: 1.5,
      }}>
        {match.explanation ?? "Reconciled."}
      </div>

      <div style={{ display: "flex", gap: 8 }} onClick={e => e.stopPropagation()}>
        <button
          onClick={() => act("accepted")}
          disabled={busy !== null || match.status === "accepted"}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "5px 10px", borderRadius: 7,
            border: "1px solid rgba(52,211,153,0.3)",
            background: match.status === "accepted" ? "rgba(52,211,153,0.15)" : "transparent",
            color: "#6ee7b7", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          {busy === "accept" ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          {match.status === "accepted" ? "Accepted" : "Accept"}
        </button>
        <button
          onClick={() => act("rejected")}
          disabled={busy !== null || match.status === "rejected"}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "5px 10px", borderRadius: 7,
            border: "1px solid rgba(251,113,133,0.3)",
            background: "transparent",
            color: "#fda4af", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          {busy === "reject" ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
          Reject
        </button>
      </div>
    </div>
  );
}
