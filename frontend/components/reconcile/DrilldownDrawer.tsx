"use client";
import { X } from "lucide-react";
import { MatchRow, AnomalyRow } from "@/lib/reconcile";

export function DrilldownDrawer({
  open, onClose, kind, data,
}: {
  open: boolean;
  onClose: () => void;
  kind: "match" | "anomaly" | null;
  data: MatchRow | AnomalyRow | null;
}) {
  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0,
          background: "rgba(2,6,23,0.6)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 200ms", zIndex: 60,
        }}
      />
      <aside style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 480,
        background: "#0a0e1a", borderLeft: "1px solid rgba(30,41,59,0.8)",
        transform: open ? "translateX(0)" : "translateX(100%)",
        transition: "transform 220ms ease-out",
        zIndex: 70, padding: 24, overflowY: "auto",
        fontFamily: "'Manrope', system-ui, sans-serif", color: "#e2e8f0",
      }}>
        <header style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          marginBottom: 20,
        }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
            color: "#475569", letterSpacing: "0.12em", textTransform: "uppercase",
          }}>
            {kind ?? "Detail"}
          </div>
          <button onClick={onClose} style={{
            background: "transparent", border: "none", color: "#64748b",
            cursor: "pointer", padding: 4,
          }}>
            <X size={16} />
          </button>
        </header>

        {data && (
          <pre style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11, color: "#94a3b8",
            background: "rgba(15,23,42,0.6)",
            border: "1px solid rgba(30,41,59,0.7)",
            borderRadius: 10, padding: 14,
            whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>
{JSON.stringify(data, null, 2)}
          </pre>
        )}
      </aside>
    </>
  );
}
