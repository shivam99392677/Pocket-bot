"""
PostgreSQL Database Adapter for PocketBuddy Python Backend.
Provides thread-safe connection pooling and dict-like cursor access using psycopg2.
"""

import os
import logging
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlparse
from dotenv import load_dotenv

import psycopg2
import psycopg2.extras
from psycopg2.pool import ThreadedConnectionPool

log = logging.getLogger(__name__)

# Load environment variables
load_dotenv(Path(__file__).resolve().parents[2] / ".env")
load_dotenv(Path(__file__).resolve().parents[1] / ".env")


def get_connection_config() -> dict:
    """Parse connection configuration from DATABASE_URL or individual PG* env vars."""
    database_url = os.getenv("DATABASE_URL")
    if database_url:
        parsed = urlparse(database_url)
        return {
            "dbname": parsed.path.lstrip("/"),
            "user": parsed.username,
            "password": parsed.password,
            "host": parsed.hostname or "localhost",
            "port": parsed.port or 5432,
        }

    return {
        "dbname": os.getenv("PGDATABASE", "pocketbuddy"),
        "user": os.getenv("PGUSER", "postgres"),
        "password": os.getenv("PGPASSWORD", "postgres"),
        "host": os.getenv("PGHOST", "localhost"),
        "port": int(os.getenv("PGPORT", 5432)),
    }


class PostgresDB:
    _pool: ThreadedConnectionPool = None

    @classmethod
    def get_pool(cls) -> ThreadedConnectionPool:
        if cls._pool is None or cls._pool.closed:
            config = get_connection_config()
            log.info(f"Initializing PostgreSQL pool for database: {config['dbname']} on {config['host']}:{config['port']}")
            cls._pool = ThreadedConnectionPool(
                minconn=1,
                maxconn=10,
                **config
            )
        return cls._pool

    @classmethod
    @contextmanager
    def get_cursor(cls, commit: bool = False):
        pool = cls.get_pool()
        conn = pool.getconn()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cursor:
                yield cursor
                if commit:
                    conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            pool.putconn(conn)


@contextmanager
def get_db_cursor(commit: bool = False):
    """Convenience context manager yielding RealDictCursor."""
    with PostgresDB.get_cursor(commit=commit) as cursor:
        yield cursor
