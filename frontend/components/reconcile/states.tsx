"use client";
import { Loader2, Inbox, AlertCircle } from "lucide-react";

export function LoadingState({ message = "Loading reconciliation…" }: { message?: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          minHeight: 160, borderRadius: 14,
          border: "1px solid rgba(30,41,59,0.6)",
          background: "rgba(15,23,42,0.4)",
          animation: `pulse 1.6s ease-in-out ${i * 0.15}s infinite`,
        }} />
      ))}
      <style>{`@keyframes pulse { 0%,100% { opacity: 0.35 } 50% { opacity: 0.7 } }`}</style>
      <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 8,
        color: "#475569", fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>
        <Loader2 size={12} className="animate-spin" /> {message}
      </div>
    </div>
  );
}

export function EmptyState({
  title = "All caught up",
  subtitle,
}: { title?: string; subtitle?: string }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 24px",
      border: "1px dashed rgba(30,41,59,0.6)", borderRadius: 14 }}>
      <Inbox size={32} style={{ color: "#334155", margin: "0 auto 12px" }} />
      <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 22,
        color: "#94a3b8", marginBottom: 4 }}>
        {title}
      </div>
      {subtitle && (
        <div style={{ fontSize: 12, color: "#475569",
          fontFamily: "'Manrope', system-ui, sans-serif" }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

export function ErrorState({
  message, onRetry,
}: { message: string; onRetry?: () => void }) {
  return (
    <div style={{ textAlign: "center", padding: "40px 24px",
      border: "1px solid rgba(251,113,133,0.3)", background: "rgba(251,113,133,0.05)",
      borderRadius: 14 }}>
      <AlertCircle size={24} style={{ color: "#fb7185", margin: "0 auto 10px" }} />
      <div style={{ fontSize: 13, color: "#fda4af",
        fontFamily: "'Manrope', system-ui, sans-serif", marginBottom: 12 }}>
        {message}
      </div>
      {onRetry && (
        <button onClick={onRetry} style={{
          background: "transparent", border: "1px solid rgba(251,113,133,0.4)",
          color: "#fda4af", padding: "6px 14px", borderRadius: 8,
          fontSize: 12, fontFamily: "inherit", cursor: "pointer",
        }}>
          Retry
        </button>
      )}
    </div>
  );
}
