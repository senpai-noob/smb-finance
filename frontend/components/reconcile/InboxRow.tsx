"use client";
import { MatchRow, AnomalyRow } from "@/lib/reconcile";

export type InboxItem =
  | { kind: "match";   data: MatchRow }
  | { kind: "anomaly"; data: AnomalyRow };

const RULE_LABEL: Record<string, string> = {
  vendor_spike:            "Vendor spike",
  payout_cadence_gap:      "Payout overdue",
  duplicate_within_window: "Duplicate",
  gst_mismatch:            "GST mismatch",
  refund_without_charge:   "Orphan refund",
};

const PASS_LABEL: Record<number, string> = {
  1: "Exact",
  2: "Fuzzy",
  3: "Fee-grouped",
};

/** 3-px coloured severity rail on the leftmost edge of each row. */
function severityColor(item: InboxItem): string {
  if (item.kind === "anomaly") {
    if (item.data.status === "dismissed") return "#27272a";
    if (item.data.status === "accepted")  return "#34d399";
    return item.data.severity === "high"   ? "#fb7185"
         : item.data.severity === "medium" ? "#fbbf24"
         : "#64748b";
  }
  // match
  if (item.data.status === "rejected") return "#27272a";
  if (item.data.status === "accepted") return "#34d399";
  return item.data.confidence === "high"   ? "#22c55e"      // dim emerald
       : item.data.confidence === "medium" ? "#fbbf24"
       : "#64748b";
}

function statusGlyph(item: InboxItem): string {
  const status = item.data.status;
  if (status === "accepted")  return "✓";
  if (status === "rejected" || status === "dismissed") return "×";
  if (status === "snoozed")   return "◴";
  return "·";
}

function vendorOf(item: InboxItem): string {
  if (item.kind === "anomaly") {
    const d = item.data.detail as Record<string, unknown>;
    return (d.vendor as string) || RULE_LABEL[item.data.rule_id] || item.data.rule_id;
  }
  // For match, the explanation is descriptive enough — we don't have direct vendor.
  return item.data.explanation?.split(".")[0]?.slice(0, 64) ?? `Match #${item.data.id}`;
}

function amountOf(item: InboxItem): number | null {
  if (item.kind === "anomaly") {
    const d = item.data.detail as Record<string, unknown>;
    const a = d.amount ?? d.current ?? d.last_payout_amount ?? d.stored_gst;
    return typeof a === "number" ? a : null;
  }
  // For matches, the inferred_fee is the most representative number.
  return item.data.inferred_fee ?? null;
}

function metaOf(item: InboxItem): string {
  if (item.kind === "anomaly") {
    const label = RULE_LABEL[item.data.rule_id] ?? item.data.rule_id;
    return `Anomaly · ${item.data.severity} · ${label}`;
  }
  const pass = PASS_LABEL[item.data.pass_no] ?? `Pass ${item.data.pass_no}`;
  return `Match · ${item.data.confidence} · ${pass}`;
}

export function InboxRow({
  item,
  selected,
  checked,
  onClick,
  onToggleCheck,
}: {
  item: InboxItem;
  selected: boolean;
  checked: boolean;
  onClick: () => void;
  onToggleCheck: () => void;
}) {
  const railColor = severityColor(item);
  const amount    = amountOf(item);
  const dim       = item.data.status === "dismissed" || item.data.status === "rejected";
  const isAnomaly = item.kind === "anomaly";

  return (
    <div
      onClick={onClick}
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: "6px 18px 1fr 130px 110px",
        alignItems: "center",
        gap: 14,
        padding: "9px 18px 9px 0",
        borderBottom: "1px solid rgba(30,41,59,0.45)",
        cursor: "pointer",
        background: selected ? "rgba(15,23,42,0.85)" : "transparent",
        opacity: dim ? 0.42 : 1,
        transition: "background 120ms, opacity 200ms",
      }}
      onMouseEnter={e => {
        if (!selected) e.currentTarget.style.background = "rgba(15,23,42,0.5)";
      }}
      onMouseLeave={e => {
        if (!selected) e.currentTarget.style.background = "transparent";
      }}
    >
      {/* Severity rail */}
      <div style={{
        width: selected ? 6 : 3,
        height: 36,
        marginLeft: selected ? 0 : 3,
        background: railColor,
        borderRadius: "0 2px 2px 0",
        transition: "width 120ms, margin-left 120ms",
      }} />

      {/* Checkbox + status glyph */}
      <div
        onClick={e => { e.stopPropagation(); onToggleCheck(); }}
        style={{
          width: 18, height: 18, borderRadius: 4,
          border: `1px solid ${checked ? "#34d399" : "rgba(71,85,105,0.7)"}`,
          background: checked ? "rgba(52,211,153,0.18)" : "transparent",
          color: "#34d399", fontSize: 12, lineHeight: "16px", textAlign: "center",
          cursor: "pointer", flexShrink: 0,
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        {checked ? "✓" : statusGlyph(item) === "·" ? "" : statusGlyph(item)}
      </div>

      {/* Vendor + meta */}
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{
          fontFamily: "'Manrope', system-ui, sans-serif",
          fontSize: 13.5, fontWeight: 500,
          color: selected ? "#6ee7b7" : "#e2e8f0",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          textTransform: isAnomaly ? "none" : "none",
        }}>
          {vendorOf(item)}
        </div>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase",
          color: "#52525b",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {metaOf(item)}
        </div>
      </div>

      {/* Date */}
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10.5, color: "#475569",
        letterSpacing: "0.08em", textTransform: "uppercase",
        textAlign: "right",
      }}>
        {dateOf(item) ?? ""}
      </div>

      {/* Amount in serif italic */}
      <div style={{
        fontFamily: "'Instrument Serif', Georgia, serif",
        fontStyle: "italic",
        fontSize: 18, textAlign: "right",
        fontVariantNumeric: "tabular-nums",
        color: amount == null ? "#334155"
             : amount >= 0    ? "#e2e8f0"
             :                  "#fda4af",
        whiteSpace: "nowrap",
      }}>
        {amount == null
          ? "—"
          : `${amount < 0 ? "−" : ""}₹${Math.abs(amount).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
      </div>
    </div>
  );
}

function dateOf(item: InboxItem): string | null {
  const raw = item.kind === "anomaly" ? item.data.detected_at : item.data.updated_at;
  if (!raw) return null;
  const d = new Date(raw);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}
