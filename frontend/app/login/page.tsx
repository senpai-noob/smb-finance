"use client";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiFetch, setToken } from "@/lib/api";
import { BarChart3, Loader2, AlertCircle, ArrowRight } from "lucide-react";

function LoginForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const redirect     = searchParams.get("redirect") || "/dashboard";

  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const data = await apiFetch<{ access_token: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setToken(data.access_token);
      router.push(redirect);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally { setLoading(false); }
  }

  return (
    <main style={pageStyle}>
      <FontImport />

      {/* Atmosphere */}
      <div aria-hidden style={{
        position: "fixed", inset: 0, pointerEvents: "none", opacity: 0.04, zIndex: 0,
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
      }} />
      <div aria-hidden style={{
        position: "fixed", top: -200, left: "50%", transform: "translateX(-50%)",
        width: 700, height: 380, borderRadius: "50%", pointerEvents: "none", zIndex: 0,
        background: "radial-gradient(ellipse, rgba(52,211,153,0.08), transparent 70%)",
        filter: "blur(30px)",
      }} />

      <div style={{
        position: "relative", zIndex: 1,
        display: "grid", gridTemplateColumns: "1fr",
        maxWidth: 1180, margin: "0 auto", minHeight: "100vh",
      }}>

        {/* Brand strip top */}
        <header style={{
          padding: "28px 28px 0",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <Link href="/" style={{
            display: "flex", alignItems: "center", gap: 8,
            textDecoration: "none", color: "#34d399",
          }}>
            <BarChart3 size={20} />
            <span style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 22,
            }}>
              ClarityBooks
            </span>
          </Link>
          <Link href="/register" style={{
            fontFamily: "'Manrope', system-ui, sans-serif",
            fontSize: 12, color: "#94a3b8", textDecoration: "none",
            display: "flex", alignItems: "center", gap: 4,
          }}>
            No account? <span style={{ color: "#34d399" }}>Create one</span>
            <ArrowRight size={12} style={{ color: "#34d399" }} />
          </Link>
        </header>

        {/* Editorial split: left = serif poetry, right = form */}
        <section style={{
          flex: 1, display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          gap: 64, alignItems: "center",
          padding: "60px 28px",
        }}
          className="login-split"
        >
          {/* Left — editorial */}
          <div style={{
            display: "flex", flexDirection: "column", gap: 22,
            opacity: 0, animation: "rise 600ms ease-out forwards",
          }}>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase",
              color: "#34d399",
            }}>
              Sign in to continue
            </div>
            <h1 style={{
              margin: 0,
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: "clamp(44px, 6vw, 72px)",
              lineHeight: 0.98, letterSpacing: "-0.02em",
              color: "#f1f5f9",
            }}>
              Welcome
              <br />
              <em style={{ color: "#34d399", fontStyle: "italic" }}>back.</em>
            </h1>
            <p style={{
              margin: 0, maxWidth: 380, fontSize: 14, lineHeight: 1.6,
              color: "#94a3b8",
              fontFamily: "'Manrope', system-ui, sans-serif",
            }}>
              Pick up where you left off — your triage queue, your reconciliation
              runs, your P&amp;L statement, all where you left them.
            </p>
            <div style={{
              marginTop: 8, paddingTop: 16,
              borderTop: "1px solid rgba(30,41,59,0.5)",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase",
              color: "#475569",
            }}>
              JWT bearer · data stays in your org
            </div>
          </div>

          {/* Right — form */}
          <div style={{
            opacity: 0, animation: "rise 700ms 150ms ease-out forwards",
          }}>
            <div style={{
              padding: "32px 32px 28px",
              borderRadius: 16,
              border: "1px solid rgba(30,41,59,0.7)",
              background: "rgba(15,23,42,0.6)",
              backdropFilter: "blur(16px)",
              position: "relative", overflow: "hidden",
            }}>
              {/* Subtle corner glow */}
              <div aria-hidden style={{
                position: "absolute", top: -60, right: -60, width: 200, height: 200,
                borderRadius: "50%", pointerEvents: "none",
                background: "radial-gradient(circle, rgba(52,211,153,0.12), transparent 70%)",
              }} />

              <form onSubmit={handleSubmit} style={{ position: "relative" }}>
                <FieldLabel>Email</FieldLabel>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  required placeholder="you@company.com"
                  style={fieldStyle} />

                <div style={{ height: 18 }} />

                <FieldLabel>Password</FieldLabel>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  required placeholder="••••••••"
                  style={fieldStyle} />

                {error && (
                  <div style={{
                    marginTop: 18, padding: "10px 12px", borderRadius: 8,
                    border: "1px solid rgba(251,113,133,0.3)",
                    background: "rgba(251,113,133,0.08)",
                    display: "flex", gap: 8, alignItems: "flex-start",
                    color: "#fda4af", fontSize: 12.5,
                    fontFamily: "'Manrope', system-ui, sans-serif",
                  }}>
                    <AlertCircle size={13} style={{ marginTop: 1, flexShrink: 0 }} />
                    {error}
                  </div>
                )}

                <button type="submit" disabled={loading}
                  style={{
                    width: "100%", marginTop: 22, padding: "11px 16px", borderRadius: 10,
                    border: "none", cursor: loading ? "wait" : "pointer",
                    background: "#34d399", color: "#0f172a",
                    fontSize: 14, fontWeight: 700,
                    fontFamily: "'Manrope', system-ui, sans-serif",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    opacity: loading ? 0.6 : 1,
                  }}>
                  {loading && <Loader2 size={15} className="animate-spin" />}
                  Sign in
                  {!loading && <ArrowRight size={14} />}
                </button>

                <div style={{
                  marginTop: 22, paddingTop: 18,
                  borderTop: "1px solid rgba(30,41,59,0.6)",
                  textAlign: "center",
                  fontSize: 12, color: "#475569",
                  fontFamily: "'Manrope', system-ui, sans-serif",
                }}>
                  No account?{" "}
                  <Link href={`/register${redirect !== "/dashboard" ? `?redirect=${redirect}` : ""}`}
                    style={{ color: "#34d399", textDecoration: "none", fontWeight: 600 }}>
                    Create one free
                  </Link>
                </div>
              </form>
            </div>
          </div>
        </section>

        <style>{`
          @media (max-width: 860px) {
            .login-split {
              grid-template-columns: 1fr !important;
              gap: 32px !important;
            }
          }
          @keyframes rise {
            from { opacity: 0; transform: translateY(12px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          input::placeholder { color: #334155; }
        `}</style>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#0a0e1a" }} />}>
      <LoginForm />
    </Suspense>
  );
}

/* ───────── sub-components ───────── */

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label style={{
      display: "block", marginBottom: 8,
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase",
      color: "#475569",
    }}>
      {children}
    </label>
  );
}

/* ───────── styles ───────── */

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#0a0e1a",
  color: "#f8fafc",
  fontFamily: "'Manrope', system-ui, sans-serif",
  position: "relative",
  overflow: "hidden",
};

function FontImport() {
  return (
    <style>{`@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');`}</style>
  );
}

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "11px 14px",
  borderRadius: 10,
  border: "1px solid rgba(30,41,59,0.8)",
  background: "rgba(15,23,42,0.7)",
  color: "#f1f5f9",
  fontSize: 14,
  fontFamily: "'Manrope', system-ui, sans-serif",
  outline: "none",
  transition: "border-color 150ms",
};
