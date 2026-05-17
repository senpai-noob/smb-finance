import Link from "next/link";
import { BarChart3, ArrowRight } from "lucide-react";

export default function LandingPage() {
  return (
    <main style={{
      minHeight: "100vh",
      background: "#0a0e1a",
      color: "#f8fafc",
      fontFamily: "'Manrope', system-ui, sans-serif",
      position: "relative",
      overflow: "hidden",
    }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');`}</style>

      {/* Grain */}
      <div aria-hidden style={{
        position: "fixed", inset: 0, pointerEvents: "none", opacity: 0.04, zIndex: 0,
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
      }} />
      {/* Glow */}
      <div aria-hidden style={{
        position: "fixed", top: -240, left: "50%", transform: "translateX(-50%)",
        width: 900, height: 480, borderRadius: "50%", pointerEvents: "none", zIndex: 0,
        background: "radial-gradient(ellipse, rgba(52,211,153,0.10), transparent 70%)",
        filter: "blur(40px)",
      }} />

      <div style={{ position: "relative", zIndex: 1 }}>

        {/* Masthead */}
        <header style={{
          maxWidth: 1200, margin: "0 auto",
          padding: "32px 28px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          borderBottom: "1px solid rgba(30,41,59,0.5)",
        }}>
          <Link href="/" style={{
            display: "flex", alignItems: "center", gap: 10,
            textDecoration: "none", color: "#34d399",
          }}>
            <BarChart3 size={22} />
            <span style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 24, letterSpacing: "-0.01em",
            }}>
              ClarityBooks
            </span>
          </Link>
          <nav style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <Link href="/login" style={{
              fontSize: 13, color: "#94a3b8", textDecoration: "none",
              fontFamily: "'Manrope', system-ui, sans-serif",
            }}>
              Sign in
            </Link>
            <Link href="/register" style={ctaBtn()}>
              Get started <ArrowRight size={13} />
            </Link>
          </nav>
        </header>

        {/* Hero — editorial broadsheet */}
        <section style={{
          maxWidth: 1100, margin: "0 auto",
          padding: "80px 28px 60px",
          display: "grid", gridTemplateColumns: "1fr", gap: 40,
          position: "relative",
        }}>
          {/* Eyebrow */}
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase",
            color: "#34d399",
            opacity: 0, animation: "rise 600ms 100ms ease-out forwards",
          }}>
            VOL. 01 · A finance newsletter for Indian SMBs
          </div>

          {/* Headline */}
          <h1 style={{
            margin: 0,
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: "clamp(48px, 8vw, 100px)",
            lineHeight: 0.95, letterSpacing: "-0.02em",
            color: "#f1f5f9",
            opacity: 0, animation: "rise 700ms 250ms ease-out forwards",
          }}>
            Your books,
            <br />
            <em style={{ color: "#34d399", fontStyle: "italic" }}>in plain English.</em>
          </h1>

          {/* Lead */}
          <p style={{
            margin: 0,
            maxWidth: 640,
            fontSize: 18, lineHeight: 1.55,
            color: "#94a3b8",
            fontFamily: "'Manrope', system-ui, sans-serif",
            opacity: 0, animation: "rise 700ms 400ms ease-out forwards",
          }}>
            Upload a Shopify payout or bank CSV — ClarityBooks reconciles the lot,
            flags the anomalies, drafts a P&amp;L, and tells you what your numbers
            actually mean. No CA jargon, no spreadsheets, no surprises before GSTR-3B.
          </p>

          {/* CTAs */}
          <div style={{
            display: "flex", gap: 12, flexWrap: "wrap",
            opacity: 0, animation: "rise 700ms 550ms ease-out forwards",
          }}>
            <Link href="/register" style={ctaBtn(true)}>
              Get started free <ArrowRight size={14} />
            </Link>
            <Link href="/login" style={{
              ...ctaBtn(false),
              border: "1px solid rgba(30,41,59,0.8)",
              background: "transparent",
              color: "#cbd5e1",
            }}>
              Sign in
            </Link>
          </div>

          {/* Caption strip */}
          <div style={{
            marginTop: 16, paddingTop: 18,
            borderTop: "1px solid rgba(30,41,59,0.5)",
            display: "flex", gap: 28, flexWrap: "wrap",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase",
            color: "#475569",
            opacity: 0, animation: "rise 700ms 700ms ease-out forwards",
          }}>
            <span>5-rule anomaly engine</span>
            <span style={{ color: "#27272a" }}>·</span>
            <span>4-pass reconciliation</span>
            <span style={{ color: "#27272a" }}>·</span>
            <span>Claude-powered insights</span>
            <span style={{ color: "#27272a" }}>·</span>
            <span>Indian fiscal year aware</span>
          </div>
        </section>

        {/* Pull-quote divider */}
        <section style={{
          maxWidth: 880, margin: "60px auto",
          padding: "0 28px",
          opacity: 0, animation: "rise 700ms 850ms ease-out forwards",
        }}>
          <blockquote style={{
            margin: 0,
            padding: "32px 36px",
            borderLeft: "3px solid #34d399",
            background: "linear-gradient(90deg, rgba(52,211,153,0.05), transparent 40%)",
            borderRadius: "0 12px 12px 0",
          }}>
            <p style={{
              margin: 0,
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontStyle: "italic", fontSize: 28, lineHeight: 1.3,
              color: "#e2e8f0",
            }}>
              &ldquo;Tally tells you what happened. ClarityBooks tells you what to do about it.&rdquo;
            </p>
            <footer style={{
              marginTop: 14,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase",
              color: "#52525b",
            }}>
              ·  the difference, in one line
            </footer>
          </blockquote>
        </section>

        {/* Features — editorial vignettes */}
        <section style={{
          maxWidth: 1100, margin: "0 auto",
          padding: "40px 28px 80px",
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 14, marginBottom: 32,
          }}>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase",
              color: "#475569",
            }}>
              What you get
            </span>
            <div style={{ flex: 1, height: 1, background: "rgba(30,41,59,0.5)" }} />
          </div>

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 36,
          }}>
            <FeatureVignette
              kicker="01"
              title="Reconciliation moat"
              body="A 4-pass deterministic engine pairs your Shopify line-items to bank credits — exact match first, then fuzzy amount with date windows, then subset-sum fee inference. Whatever it can't pair becomes a triage queue you clear with bulk actions."
              accent="#34d399"
            />
            <FeatureVignette
              kicker="02"
              title="Anomaly intelligence"
              body="Five rules quietly watch your data — vendor spend spikes, missing Shopify payouts, duplicate charges, GST mismatches, refunds without a matching charge. Each comes with a Claude-written explanation and a one-click action."
              accent="#fbbf24"
            />
            <FeatureVignette
              kicker="03"
              title="GST &amp; P&amp;L, done"
              body="CGST/SGST breakdown per category, a properly-formatted P&L for your CA, monthly trend with margin column. Excel export and email-to-accountant included. GSTR-3B no longer a panic."
              accent="#60a5fa"
            />
          </div>
        </section>

        {/* Closing line */}
        <section style={{
          maxWidth: 880, margin: "0 auto",
          padding: "40px 28px 80px",
          textAlign: "center",
        }}>
          <h2 style={{
            margin: "0 0 18px",
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: 36, fontStyle: "italic", lineHeight: 1.15,
            color: "#e2e8f0",
          }}>
            Built for the founder who&apos;d rather <span style={{ color: "#34d399" }}>build</span> than reconcile.
          </h2>
          <Link href="/register" style={ctaBtn(true)}>
            Start free <ArrowRight size={14} />
          </Link>
        </section>

        {/* Footer */}
        <footer style={{
          borderTop: "1px solid rgba(30,41,59,0.5)",
          padding: "24px 28px",
          textAlign: "center",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase",
          color: "#3f3f46",
        }}>
          ClarityBooks · Built with FastAPI + Next.js · MIT
        </footer>
      </div>

      <style>{`
        @keyframes rise {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </main>
  );
}

function FeatureVignette({
  kicker, title, body, accent,
}: { kicker: string; title: string; body: string; accent: string }) {
  return (
    <article style={{
      display: "flex", flexDirection: "column", gap: 12,
      paddingLeft: 16,
      borderLeft: `1px solid ${accent}33`,
    }}>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11, letterSpacing: "0.2em",
        color: accent,
      }}>
        {kicker}
      </div>
      <h3 style={{
        margin: 0,
        fontFamily: "'Instrument Serif', Georgia, serif",
        fontStyle: "italic", fontSize: 26, lineHeight: 1.1,
        color: "#f1f5f9",
      }}>
        {title}
      </h3>
      <p style={{
        margin: 0,
        fontSize: 14, lineHeight: 1.6,
        color: "#94a3b8",
        fontFamily: "'Manrope', system-ui, sans-serif",
      }}>
        {body}
      </p>
    </article>
  );
}

function ctaBtn(emerald: boolean = true): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "10px 18px", borderRadius: 8,
    border: emerald ? "none" : "1px solid rgba(30,41,59,0.8)",
    background: emerald ? "#34d399" : "transparent",
    color: emerald ? "#0f172a" : "#cbd5e1",
    fontSize: 13, fontWeight: 700,
    fontFamily: "'Manrope', system-ui, sans-serif",
    textDecoration: "none",
  };
}
