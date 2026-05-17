import sys

# Ensure stdout/stderr can encode all UTF-8 characters (₹, em-dashes, etc.).
# On Windows the default is cp1252 which raises UnicodeEncodeError whenever
# SQLAlchemy echo=True or any logger emits a line containing ₹.
# This must run before any logging configuration touches the streams.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    except Exception:
        pass

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import time

from app.core.config import settings
from app.db.session import engine
import app.db.base  # noqa
from app.models.base import Base
from app.api.routes import auth, orgs, transactions, invites, api_keys, audit, reports, billing, reconcile_v2

Base.metadata.create_all(bind=engine)

# Seed plans on every startup (idempotent)
from app.db.session import SessionLocal
from app.services.billing import seed_plans
_db = SessionLocal()
try:
    seed_plans(_db)
finally:
    _db.close()

limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title=settings.APP_NAME,
    description="SMB Finance Clarity — GST reconciliation, expense categorisation, CFO insights.",
    version=settings.APP_VERSION,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.CORS_ALLOW_ALL else settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    start = time.time()
    response = await call_next(request)
    response.headers["X-Process-Time"] = f"{(time.time() - start)*1000:.1f}ms"
    return response

@app.get("/health", tags=["meta"])
def health():
    from app.db.session import SessionLocal
    import sqlalchemy
    db = SessionLocal()
    try:
        db.execute(sqlalchemy.text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False
    finally:
        db.close()
    return {
        "status":  "ok" if db_ok else "degraded",
        "app":     settings.APP_NAME,
        "version": settings.APP_VERSION,
        "db":      "ok" if db_ok else "error",
        "llm":     "configured" if settings.ANTHROPIC_API_KEY else "rules fallback",
        "email":   "configured" if settings.SMTP_HOST else "not configured",
        "stripe":  "configured" if settings.STRIPE_SECRET_KEY else "demo mode",
    }

app.include_router(auth.router,         prefix="/api")
app.include_router(orgs.router,         prefix="/api")
app.include_router(transactions.router, prefix="/api")
app.include_router(invites.router,      prefix="/api")
app.include_router(api_keys.router,     prefix="/api")
app.include_router(audit.router,        prefix="/api")
app.include_router(reports.router,      prefix="/api")
app.include_router(billing.router,      prefix="/api")
app.include_router(reconcile_v2.router, prefix="/api")
