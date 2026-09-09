"""
PostgreSQL-backed expense service.
Replaces legacy SQLite service — all reads and writes go through PostgreSQL.
"""

import os
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, Optional, List
from pathlib import Path

try:
    from db_postgres import get_db_cursor
except ImportError:
    from ..db_postgres import get_db_cursor

log = logging.getLogger(__name__)
DB_PATH = None  # Preserved symbol for legacy compatibility


def _row_to_dict(row) -> Dict:
    return dict(row) if row else {}


def _parse_user_id(user_id) -> int:
    try:
        return int(user_id)
    except (ValueError, TypeError):
        return user_id


class SQLiteExpenseService:
    """
    PostgreSQL-backed expense service.
    Maintains compatibility with TrendAnalyzer, ExpenseForecaster, AlertSystem, ExpenseInitializer, main_api.
    """

    # ------------------------------------------------------------------
    # Expense reads
    # ------------------------------------------------------------------

    def get_user_expenses(self, user_id: str) -> Dict:
        """Fetch all expenses for a user, keyed by row id (str)."""
        try:
            uid = _parse_user_id(user_id)
            with get_db_cursor() as cur:
                cur.execute("SELECT * FROM expenses WHERE user_id = %s", (uid,))
                rows = cur.fetchall()
            return {str(r["id"]): _row_to_dict(r) for r in rows}
        except Exception as e:
            log.error(f"PostgreSQL error in get_user_expenses: {e}")
            return {}

    def get_previous_month_expenses(self, user_id: str) -> Dict:
        """Fetch last month's expenses."""
        try:
            today = datetime.now()
            first_day_current = today.replace(day=1)
            last_day_previous = first_day_current - timedelta(days=1)
            first_day_previous = last_day_previous.replace(day=1)
            uid = _parse_user_id(user_id)

            with get_db_cursor() as cur:
                cur.execute(
                    """
                    SELECT * FROM expenses
                    WHERE user_id = %s
                      AND date >= %s
                      AND date <= %s
                    """,
                    (uid,
                     first_day_previous.strftime("%Y-%m-%d"),
                     last_day_previous.strftime("%Y-%m-%d"))
                )
                rows = cur.fetchall()
            return {str(r["id"]): _row_to_dict(r) for r in rows}
        except Exception as e:
            log.error(f"PostgreSQL error in get_previous_month_expenses: {e}")
            return {}

    def get_current_month_expenses(self, user_id: str) -> Dict:
        """Fetch this month's expenses."""
        try:
            first_day = datetime.now().replace(day=1).strftime("%Y-%m-%d")
            uid = _parse_user_id(user_id)

            with get_db_cursor() as cur:
                cur.execute(
                    """
                    SELECT * FROM expenses
                    WHERE user_id = %s
                      AND date >= %s
                    """,
                    (uid, first_day)
                )
                rows = cur.fetchall()
            return {str(r["id"]): _row_to_dict(r) for r in rows}
        except Exception as e:
            log.error(f"PostgreSQL error in get_current_month_expenses: {e}")
            return {}

    # ------------------------------------------------------------------
    # Expense writes
    # ------------------------------------------------------------------

    def add_expense(self, user_id: str, amount: float, category: str,
                    description: str = "", date: Optional[str] = None) -> Optional[str]:
        """Insert a new expense row. Returns the new row id as string."""
        try:
            if date is None:
                date = datetime.now().strftime("%Y-%m-%d")
            uid = _parse_user_id(user_id)

            with get_db_cursor(commit=True) as cur:
                cur.execute(
                    """
                    INSERT INTO expenses (user_id, amount, category, description, date)
                    VALUES (%s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (uid, amount, category, description, date)
                )
                row = cur.fetchone()
                return str(row["id"]) if row else None
        except Exception as e:
            log.error(f"PostgreSQL error in add_expense: {e}")
            return None

    # ------------------------------------------------------------------
    # Budget plan
    # ------------------------------------------------------------------

    def save_budget_plan(self, user_id: str, budget_plan: Dict) -> bool:
        """Persist a budget plan as JSON blob in 'recommendations' table."""
        try:
            uid = _parse_user_id(user_id)
            payload = json.dumps({
                "plan": budget_plan,
                "created_date": datetime.now().isoformat(),
                "month": datetime.now().strftime("%Y-%m")
            })
            with get_db_cursor(commit=True) as cur:
                cur.execute(
                    """
                    DELETE FROM recommendations
                    WHERE user_id = %s AND type = 'budget_plan'
                      AND date LIKE %s
                    """,
                    (uid, datetime.now().strftime("%Y-%m") + "%")
                )
                cur.execute(
                    """
                    INSERT INTO recommendations (user_id, date, type, text)
                    VALUES (%s, %s, 'budget_plan', %s)
                    """,
                    (uid, datetime.now().strftime("%Y-%m-%d"), payload)
                )
            return True
        except Exception as e:
            log.error(f"PostgreSQL error in save_budget_plan: {e}")
            return False

    def get_budget_plan(self, user_id: str) -> Optional[Dict]:
        """Retrieve the most recent budget plan for a user."""
        try:
            uid = _parse_user_id(user_id)
            with get_db_cursor() as cur:
                cur.execute(
                    """
                    SELECT text FROM recommendations
                    WHERE user_id = %s AND type = 'budget_plan'
                    ORDER BY created_at DESC
                    LIMIT 1
                    """,
                    (uid,)
                )
                row = cur.fetchone()
            if row and row.get("text"):
                return json.loads(row["text"])
            return None
        except Exception as e:
            log.error(f"PostgreSQL error in get_budget_plan: {e}")
            return None

    # ------------------------------------------------------------------
    # Alerts
    # ------------------------------------------------------------------

    def save_alerts(self, user_id: str, alerts_dict: Dict) -> bool:
        """Persist a dict of alert objects."""
        try:
            uid = _parse_user_id(user_id)
            today_str = datetime.now().strftime("%Y-%m-%d")

            with get_db_cursor(commit=True) as cur:
                cur.execute(
                    """
                    DELETE FROM recommendations
                    WHERE user_id = %s AND type = 'alert'
                      AND date = %s
                    """,
                    (uid, today_str)
                )
                for alert_id, alert_data in alerts_dict.items():
                    cur.execute(
                        """
                        INSERT INTO recommendations (user_id, date, type, text)
                        VALUES (%s, %s, 'alert', %s)
                        """,
                        (uid, today_str, json.dumps({**alert_data, "alert_id": alert_id}))
                    )
            return True
        except Exception as e:
            log.error(f"PostgreSQL error in save_alerts: {e}")
            return False

    def get_user_alerts(self, user_id: str) -> List[Dict]:
        """Return list of alert dicts for the user."""
        try:
            uid = _parse_user_id(user_id)
            with get_db_cursor() as cur:
                cur.execute(
                    """
                    SELECT text FROM recommendations
                    WHERE user_id = %s AND type = 'alert'
                    ORDER BY created_at DESC
                    """,
                    (uid,)
                )
                rows = cur.fetchall()
            return [json.loads(r["text"]) for r in rows if r.get("text")]
        except Exception as e:
            log.error(f"PostgreSQL error in get_user_alerts: {e}")
            return []

    def acknowledge_alert(self, user_id: str, alert_id: str) -> bool:
        """Mark a specific alert as acknowledged."""
        try:
            uid = _parse_user_id(user_id)
            with get_db_cursor(commit=True) as cur:
                cur.execute(
                    """
                    SELECT id, text FROM recommendations
                    WHERE user_id = %s AND type = 'alert'
                    """,
                    (uid,)
                )
                rows = cur.fetchall()
                for row in rows:
                    if not row.get("text"):
                        continue
                    data = json.loads(row["text"])
                    if data.get("alert_id") == alert_id:
                        data["acknowledged"] = True
                        cur.execute(
                            "UPDATE recommendations SET text = %s WHERE id = %s",
                            (json.dumps(data), row["id"])
                        )
            return True
        except Exception as e:
            log.error(f"PostgreSQL error in acknowledge_alert: {e}")
            return False
