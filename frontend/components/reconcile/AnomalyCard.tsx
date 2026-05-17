"use client";
import { useState } from "react";
import { Loader2, Check, X, Clock, AlertTriangle } from "lucide-react";
import { AnomalyRow, patchAnomaly } from "@/lib/reconcile";

const SEV_COLOR = {
  low:    { bg: "rgba(148,163,184,0.08)", border: "rgba(148,163,184,0.25)", text: "#94a3b8" },
  medium: { bg: "rgba(251,191,36,0.08)", border: "rgba(251,191,36,0.3)", text: "#fbbf24" },
  high:   { bg: "rgba(251,113,133,0.08)", border: "rgba(251,113,133,0.35)", text: "#fb7185" },
};

const RULE_LABEL: Record<string, string> = {
  vendor_spike:            "Vendor spike",
  payout_cadence_gap:      "Payout overdue",
  duplicate_within_window: "Possible duplicate",
  gst_mismatch:            "GST mismatch",
  refund_without_charge:   "Refund without charge",
};

export function AnomalyCard({
  anomaly,
  onChange,
  onOpenDrilldown,
}: {
  anomaly: AnomalyRow;
  onChange: (updated: AnomalyRow) => void;
  onOpenDrilldown: (anomalyId: number) => void;
}) {
  const [busy, setBusy] = useState<"accept" | "dismiss" | "snooze" | null>(null);
  const sev = SEV_COLOR[anomaly.severity];

  async function act(status: "accepted" | "dismissed" | "snoozed", days?: number) {
    setBusy(status === "accepted" ? "accept" : status === "dismissed" ? "dismiss" : "snooze");
    try {
      const until = days
        ? new Date(Date.now() + days * 86400_000).toISOString()
        : undefined;
      const updated = await patchAnomaly(anomaly.id, status, until);
      onChange(updated);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div onClick={() => onOpenDrilldown(anomaly.id)} style={{
      cursor: "pointer",
      border: `1px solid ${sev.border}`,
      borderRadius: 12,
      background: sev.bg,
      padding: 16,
      display: "flex", flexDirection: "column", gap: 10,
      opacity: anomaly.status === "dismissed" ? 0.4 : 1,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <AlertTriangle size={13} style={{ color: sev.text }} />
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
          letterSpacing: "0.12em", textTransform: "uppercase", color: sev.text,
        }}>
          {anomaly.severity} · {RULE_LABEL[anomaly.rule_id] ?? anomaly.rule_id}
        </span>
      </div>

      <div style={{
        fontFamily: "'Manrope', system-ui, sans-serif",
        fontSize: 13, color: "#e2e8f0", lineHeight: 1.5,
      }}>
        {anomaly.explanation ?? `Anomaly: ${anomaly.rule_id}`}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} onClick={e => e.stopPropagation()}>
        <button onClick={() => act("accepted")} disabled={busy !== null} style={btnStyle("emerald")}>
          {busy === "accept" ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          Accept
        </button>
        <button onClick={() => act("dismissed")} disabled={busy !== null} style={btnStyle("rose")}>
          {busy === "dismiss" ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
          Dismiss
        </button>
        <button onClick={() => act("snoozed", 7)} disabled={busy !== null} style={btnStyle("slate")}>
          {busy === "snooze" ? <Loader2 size={11} className="animate-spin" /> : <Clock size={11} />}
          Snooze 1w
        </button>
      </div>
    </div>
  );
}

function btnStyle(tone: "emerald" | "rose" | "slate"): React.CSSProperties {
  const colors = {
    emerald: { border: "rgba(52,211,153,0.3)",  text: "#6ee7b7" },
    rose:    { border: "rgba(251,113,133,0.3)", text: "#fda4af" },
    slate:   { border: "rgba(148,163,184,0.3)", text: "#cbd5e1" },
  }[tone];
  return {
    display: "flex", alignItems: "center", gap: 5,
    padding: "5px 10px", borderRadius: 7,
    border: `1px solid ${colors.border}`, background: "transparent",
    color: colors.text, fontSize: 12, cursor: "pointer",
    fontFamily: "inherit",
  };
}
