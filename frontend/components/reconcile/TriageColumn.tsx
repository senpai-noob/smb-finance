"use client";
import { ReactNode, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export function TriageColumn({
  title,
  count,
  accent,
  defaultCollapsed = false,
  children,
}: {
  title: string;
  count: number;
  accent: "emerald" | "amber" | "rose";
  defaultCollapsed?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(!defaultCollapsed);
  const accentColor = accent === "emerald" ? "#34d399"
                    : accent === "amber"   ? "#fbbf24"
                    : "#fb7185";

  return (
    <section style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
      <header
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 0", borderBottom: `1px solid ${accentColor}33`,
          cursor: "pointer", userSelect: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {open ? <ChevronDown size={13} style={{ color: accentColor }} />
                : <ChevronRight size={13} style={{ color: accentColor }} />}
          <span style={{
            fontFamily: "'Manrope', system-ui, sans-serif",
            fontSize: 13, color: "#e2e8f0", fontWeight: 600,
          }}>
            {title}
          </span>
          <span style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
            color: "#64748b", fontVariantNumeric: "tabular-nums",
          }}>
            {count}
          </span>
        </div>
      </header>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {children}
        </div>
      )}
    </section>
  );
}
