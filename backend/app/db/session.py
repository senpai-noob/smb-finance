from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.core.config import settings

# --- SQLite (local MVP) ---
# connect_args is required for SQLite to work with FastAPI's threading model.
# When you switch to Postgres, remove connect_args entirely.
connect_args = {}
if settings.DATABASE_URL.startswith("sqlite"):
    connect_args = {
        "check_same_thread": False,
        "timeout":           30,   # wait up to 30s for a write lock instead of failing
    }

engine = create_engine(
    settings.DATABASE_URL,
    connect_args=connect_args,
    echo=settings.DEBUG,
)

# Enable SQLite WAL mode so readers don't block writers (and vice-versa).
# Without this, every reconciliation run can hit "database is locked" the
# moment any other process touches the file (sqlite3 CLI, DB Browser, etc.).
if settings.DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _enable_sqlite_wal(dbapi_conn, _):  # noqa: ANN001
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL;")
        cursor.execute("PRAGMA synchronous=NORMAL;")
        cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
