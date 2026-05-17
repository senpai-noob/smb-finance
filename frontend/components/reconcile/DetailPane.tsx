"use client";
import { useState } from "react";
import { X, Check, Clock, AlertTriangle } from "lucide-react";
import { MatchRow, AnomalyRow, patchMatch, patchAnomaly } from "@/lib/reconcile";
import { InboxItem } from "./InboxRow";

const RULE_LABEL: Record<string, string> = {
  vendor_spike:            "Vendor spike",
  payout_cadence_gap:      "Payout overdue",
  duplicate_within_window: "Possible duplicate",
  gst_mismatch:            "GST mismatch",
  refund_without_charge:   "Orphan refund",
};

export function DetailPane({
  item,
  onClose,
  onChange,
}: {
  item: InboxItem | null;
  onClose: () => void;
  onChange: (updated: MatchRow | AnomalyRow) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  if (!item) {
    return (
      <aside style={paneStyle(false)}>
        <div style={{
          height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
          color: "#334155", fontSize: 13,
          fontFamily: "'Manrope', system-ui, sans-serif",
        }}>
          Select an item to see details
        </div>
      </aside>
    );
  }

  async function act(action: string, fn: () => Promise<MatchRow | AnomalyRow>) {
    setBusy(action);
    try {
      const updated = await fn();
      onChange(updated);
    } finally {
      setBusy(null);
    }
  }

  const isAnomaly = item.kind === "anomaly";
  const title = isAnomaly
    ? RULE_LABEL[(item.data as AnomalyRow).rule_id] ?? (item.data as AnomalyRow).rule_id
    : `${labelForMatch(item.data as MatchRow)}`;

  const accent = isAnomaly
    ? sevColor((item.data as AnomalyRow).severity)
    : confColor((item.data as MatchRow).confidence);

  return (
    <aside style={paneStyle(true)}>
      {/* Corner glow tinted by severity */}
      <div aria-hidden style={{
        position: "absolute", top: -100, right: -100, width: 280, height: 280,
        borderRadius: "50%", pointerEvents: "none",
        background: `radial-gradient(circle, ${accent}22, transparent 70%)`,
      }} />

      <header style={{
        position: "relative",
        display: "flex", justifyContent: "space-between", alignItems: "flex-start",
        padding: "22px 24px 16px",
        borderBottom: "1px solid rgba(30,41,59,0.5)",
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase",
            color: accent, marginBottom: 8,
          }}>
            {isAnomaly ? "Anomaly" : "Match"} · {isAnomaly
              ? (item.data as AnomalyRow).severity
              : (item.data as MatchRow).confidence}
          </div>
          <h2 style={{
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: 26, color: "#f1f5f9", margin: 0, lineHeight: 1.15,
            fontStyle: "italic",
          }}>
            {title}
          </h2>
        </div>
        <button onClick={onClose} style={{
          background: "transparent", border: "none", color: "#475569",
          cursor: "pointer", padding: 6, flexShrink: 0,
        }}>
          <X size={18} />
        </button>
      </header>

      <div style={{ position: "relative", padding: "20px 24px", overflowY: "auto", flex: 1 }}>
        {/* Explanation */}
        {item.data.explanation && (
          <div style={{
            fontFamily: "'Manrope', system-ui, sans-serif",
            fontSize: 14, color: "#cbd5e1", lineHeight: 1.6,
            paddingBottom: 18,
            borderBottom: "1px solid rgba(30,41,59,0.4)", marginBottom: 18,
          }}>
            {item.data.explanation}
          </div>
        )}

        {/* Evidence */}
        <SectionLabel>Evidence</SectionLabel>
        <pre style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
          color: "#94a3b8",
          background: "rgba(15,23,42,0.6)",
          border: "1px solid rgba(30,41,59,0.7)", borderRadius: 10,
          padding: 14, margin: "10px 0 22px",
          whiteSpace: "pre-wrap", wordBreak: "break-word",
          maxHeight: 340, overflowY: "auto",
        }}>
{JSON.stringify(evidence(item), null, 2)}
        </pre>

        {/* Actions */}
        <SectionLabel>Actions</SectionLabel>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          {isAnomaly ? (
            <>
              <ActionBtn tone="emerald" busy={busy === "accept"} icon={<Check size={12} />} label="Accept"
                onClick={() => act("accept", () => patchAnomaly((item.data as AnomalyRow).id, "accepted"))} />
              <ActionBtn tone="rose" busy={busy === "dismiss"} icon={<X size={12} />} label="Dismiss"
                onClick={() => act("dismiss", () => patchAnomaly((item.data as AnomalyRow).id, "dismissed"))} />
              <ActionBtn tone="slate" busy={busy === "snooze7"} icon={<Clock size={12} />} label="Snooze 1w"
                onClick={() => act("snooze7", () => {
                  const until = new Date(Date.now() + 7 * 86400_000).toISOString();
                  return patchAnomaly((item.data as AnomalyRow).id, "snoozed", until);
                })} />
              <ActionBtn tone="slate" busy={busy === "snooze30"} icon={<Clock size={12} />} label="Snooze 30d"
                onClick={() => act("snooze30", () => {
                  const until = new Date(Date.now() + 30 * 86400_000).toISOString();
                  return patchAnomaly((item.data as AnomalyRow).id, "snoozed", until);
                })} />
            </>
          ) : (
            <>
              <ActionBtn tone="emerald" busy={busy === "accept"} icon={<Check size={12} />} label="Accept"
                onClick={() => act("accept", () => patchMatch((item.data as MatchRow).id, "accepted"))} />
              <ActionBtn tone="rose" busy={busy === "reject"} icon={<X size={12} />} label="Reject"
                onClick={() => act("reject", () => patchMatch((item.data as MatchRow).id, "rejected"))} />
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

function paneStyle(active: boolean): React.CSSProperties {
  return {
    position: "relative",
    width: active ? 440 : 280,
    flexShrink: 0,
    borderLeft: "1px solid rgba(30,41,59,0.55)",
    background: "rgba(10,14,26,0.85)",
    display: "flex", flexDirection: "column",
    overflow: "hidden",
    transition: "width 200ms ease-out",
  };
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase",
      color: "#52525b",
    }}>{children}</div>
  );
}

function ActionBtn({
  tone, label, icon, onClick, busy,
}: {
  tone: "emerald" | "rose" | "slate";
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  busy: boolean;
}) {
  const c = tone === "emerald" ? { border: "rgba(52,211,153,0.35)", text: "#6ee7b7", bg: "rgba(52,211,153,0.05)" }
          : tone === "rose"    ? { border: "rgba(251,113,133,0.35)", text: "#fda4af", bg: "rgba(251,113,133,0.05)" }
          :                       { border: "rgba(148,163,184,0.3)",  text: "#cbd5e1", bg: "transparent" };
  return (
    <button onClick={onClick} disabled={busy} style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "7px 12px", borderRadius: 8,
      border: `1px solid ${c.border}`,
      background: c.bg,
      color: c.text, fontSize: 12, cursor: busy ? "wait" : "pointer",
      fontFamily: "'Manrope', system-ui, sans-serif",
      opacity: busy ? 0.6 : 1,
    }}>
      {icon} {label}
    </button>
  );
}

function evidence(item: InboxItem): Record<string, unknown> {
  if (item.kind === "anomaly") return {
    id: item.data.id,
    rule: item.data.rule_id,
    severity: item.data.severity,
    status: item.data.status,
    transaction_ids: item.data.transaction_ids,
    detail: item.data.detail,
    detected_at: item.data.detected_at,
  };
  return {
    id: item.data.id,
    source_txn_id: item.data.source_txn_id,
    bank_txn_id: item.data.bank_txn_id,
    confidence: item.data.confidence,
    pass_no: item.data.pass_no,
    inferred_fee: item.data.inferred_fee,
    status: item.data.status,
  };
}

function labelForMatch(m: MatchRow): string {
  const passName = m.pass_no === 1 ? "Exact" : m.pass_no === 2 ? "Fuzzy" : "Fee-grouped";
  return `${passName} match`;
}

function sevColor(s: string): string {
  return s === "high" ? "#fb7185" : s === "medium" ? "#fbbf24" : "#64748b";
}
function confColor(c: string): string {
  return c === "high" ? "#22c55e" : c === "medium" ? "#fbbf24" : "#64748b";
}
