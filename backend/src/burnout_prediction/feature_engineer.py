"""
Feature Engineering for Burnout Prediction
Pulls data from SQLite and builds financial + mental feature vectors.

Financial features  : F1-F16
Mental features     : M1-M15

All features are derived — no schema changes needed.
emergency_fund = monthly_income * 0.10  (derived, not stored)
"""

import os
import sqlite3
from typing import Dict, List, Tuple, Optional
from contextlib import contextmanager
from datetime import datetime, timedelta
from statistics import mean, stdev

from .schemas import FinancialFeatures, MentalFeatures

try:
    from db_postgres import get_db_cursor
except ImportError:
    from ..db_postgres import get_db_cursor

# Mood encoding: maps raw mood strings to numeric scores
MOOD_SCORES: Dict[str, float] = {
    "happy": 1.0,
    "neutral": 0.5,
    "anxious": -0.5,
    "sad": -0.75,
    "overwhelmed": -1.0,
}


class DBWrapper:
    """Wrapper around psycopg2 RealDictCursor to maintain SQLite-compatible API."""
    def __init__(self, cursor):
        self.cursor = cursor

    def execute(self, sql: str, params=()):
        formatted_sql = sql.replace("?", "%s")
        self.cursor.execute(formatted_sql, params)
        return self.cursor


class FeatureEngineer:
    """
    Extracts and engineers features from PostgreSQL for a given user.
    All queries are read-only — never modifies the database.
    """

    def __init__(self, db_path: Optional[str] = None):
        self.db_path = db_path

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_data_day_count(self, user_id: int) -> int:
        """Return total distinct days the user has logged health check-ins."""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT COUNT(DISTINCT date) AS cnt FROM health_logs WHERE user_id = ?",
                (user_id,),
            ).fetchone()
            return int(row["cnt"]) if row else 0

    def build_financial_features(self, user_id: int) -> FinancialFeatures:
        """Build the complete financial feature vector for a user."""
        with self._conn() as conn:
            user = self._fetch_user(conn, user_id)
            if not user:
                return FinancialFeatures()

            monthly_income: float = float(user["monthly_income"] or 0)
            emergency_fund: float = monthly_income * 0.10
            spendable_budget: float = monthly_income - emergency_fund

            today = datetime.now().date()
            month_start = today.replace(day=1)

            # -- Daily averages --
            daily_7d = self._daily_avg_spend(conn, user_id, days=7)
            daily_30d = self._daily_avg_spend(conn, user_id, days=30)

            # -- Weekly totals --
            week_current = self._weekly_spend(conn, user_id, weeks_ago=0)
            week_last = self._weekly_spend(conn, user_id, weeks_ago=1)

            # -- Expense growth rate (week-over-week) --
            if week_last > 0:
                growth_rate = (week_current - week_last) / week_last
            else:
                growth_rate = 0.0

            # -- Current month spend so far --
            month_spent = self._month_spend(conn, user_id, month_start)

            # -- Projected month-end spend --
            days_elapsed = today.day
            days_in_month = self._days_in_month(today)
            if days_elapsed > 0 and daily_7d > 0:
                projected = month_spent + daily_7d * (days_in_month - days_elapsed)
            else:
                projected = month_spent

            # -- Budget utilisation --
            if spendable_budget > 0:
                budget_util_pct = (month_spent / spendable_budget) * 100
            else:
                budget_util_pct = 0.0

            # -- Days until broke (using 7d daily avg vs remaining budget) --
            remaining = spendable_budget - month_spent
            if daily_7d > 0:
                days_until_broke = remaining / daily_7d
            else:
                days_until_broke = float(days_in_month - days_elapsed)
            days_until_broke = max(0.0, days_until_broke)

            # -- Category spend ratios (last 30 days) --
            cat_totals = self._category_totals(conn, user_id, days=30)
            total_30d = sum(cat_totals.values()) or 1.0
            food_ratio = cat_totals.get("food", 0) / total_30d
            transport_ratio = cat_totals.get("transport", 0) / total_30d
            entertainment_ratio = cat_totals.get("entertainment", 0) / total_30d

            # -- Impulse spend count --
            # Expenses > 2× that category's daily average in last 30 days
            impulse_count = self._impulse_spend_count(conn, user_id, days=30)

            # -- Budget safety margin --
            budget_safety_margin = spendable_budget - projected

            # -- Category overspend count --
            # How many categories are above their proportional share of spendable budget
            cat_overspend = self._category_overspend_count(
                conn, user_id, spendable_budget, month_start
            )

            # -- Food homemade ratio (last 7 days) --
            homemade_ratio = self._food_homemade_ratio(conn, user_id, days=7)

            # -- Skipped meals count (days with < 3 food log entries in last 7d) --
            skipped_meals = self._skipped_meals_count(conn, user_id, days=7)

            return FinancialFeatures(
                daily_spend_avg_7d=round(daily_7d, 4),
                daily_spend_avg_30d=round(daily_30d, 4),
                weekly_spend_current=round(week_current, 4),
                weekly_spend_last=round(week_last, 4),
                expense_growth_rate=round(growth_rate, 4),
                projected_month_end_spend=round(projected, 4),
                budget_utilization_pct=round(budget_util_pct, 4),
                days_until_broke=round(days_until_broke, 4),
                food_spend_ratio=round(food_ratio, 4),
                transport_spend_ratio=round(transport_ratio, 4),
                entertainment_spend_ratio=round(entertainment_ratio, 4),
                impulse_spend_count=impulse_count,
                budget_safety_margin=round(budget_safety_margin, 4),
                category_overspend_count=cat_overspend,
                food_homemade_ratio=round(homemade_ratio, 4),
                skipped_meals_count=skipped_meals,
                emergency_fund=round(emergency_fund, 4),
                spendable_budget=round(spendable_budget, 4),
            )

    def build_mental_features(self, user_id: int) -> MentalFeatures:
        """Build the complete mental feature vector for a user."""
        with self._conn() as conn:
            logs_7d = self._health_logs(conn, user_id, days=7)

            if not logs_7d:
                return MentalFeatures()

            sleep_vals = [r["sleep_hours"] for r in logs_7d]
            stress_vals = [r["stress_level"] for r in logs_7d]
            exercise_vals = [r["exercise_minutes"] for r in logs_7d]
            mood_vals = [MOOD_SCORES.get(r["mood"], 0.5) for r in logs_7d]
            energy_vals = [r["energy_level"] for r in logs_7d]
            social_vals = [r["social_activity"] for r in logs_7d]

            sleep_avg = mean(sleep_vals)
            stress_avg = mean(stress_vals)
            exercise_avg = mean(exercise_vals)
            mood_avg = mean(mood_vals)
            energy_avg = mean(energy_vals)
            social_avg = mean(social_vals)

            # -- Sleep deficit vs personal baseline --
            baseline_sleep = self._baseline_sleep(conn, user_id)
            sleep_deficit = max(0.0, baseline_sleep - sleep_avg)

            # -- Stress trend (slope of stress over last 7 days) --
            stress_trend = self._linear_slope(stress_vals)

            # -- No-exercise days --
            no_exercise_days = sum(1 for v in exercise_vals if v < 5)

            # -- Bad mood streak (consecutive days ending today) --
            bad_mood_streak = self._bad_mood_streak(conn, user_id)

            # -- Sleep consistency (std dev; higher = more irregular) --
            sleep_consistency = stdev(sleep_vals) if len(sleep_vals) > 1 else 0.0

            # -- Stress-sleep interaction --
            # High stress * low sleep = compounding burnout signal
            sleep_ratio = sleep_avg / 8.0  # normalise to 8hr ideal
            stress_sleep_interaction = stress_avg * (1.0 - min(sleep_ratio, 1.0))

            # -- Goal completion rate --
            goal_rate, missed_goals = self._goal_metrics(conn, user_id, logs_7d)

            # -- Skipped meals (last 7 days) --
            skipped_meals = self._skipped_meals_count(conn, user_id, days=7)

            return MentalFeatures(
                sleep_avg_7d=round(sleep_avg, 4),
                sleep_deficit=round(sleep_deficit, 4),
                stress_avg_7d=round(stress_avg, 4),
                stress_trend=round(stress_trend, 4),
                exercise_avg_7d=round(exercise_avg, 4),
                no_exercise_days_7d=no_exercise_days,
                mood_score_avg=round(mood_avg, 4),
                bad_mood_streak=bad_mood_streak,
                energy_avg_7d=round(energy_avg, 4),
                social_activity_avg_7d=round(social_avg, 4),
                goal_completion_rate=round(goal_rate, 4),
                missed_goals_count=missed_goals,
                skipped_meals_count=skipped_meals,
                sleep_consistency=round(sleep_consistency, 4),
                stress_sleep_interaction=round(stress_sleep_interaction, 4),
            )

    def get_historical_feature_rows(
        self, user_id: int, days: int = 30
    ) -> List[Dict]:
        """
        Build a list of daily feature snapshots for the last N days.
        Used to bootstrap initial ML training.
        Returns list of dicts: {date, fin_vector, men_vector}
        """
        rows = []
        today = datetime.now().date()

        with self._conn() as conn:
            for i in range(days - 1, -1, -1):
                target_date = today - timedelta(days=i)
                fin_vec = self._financial_vector_on_date(conn, user_id, target_date)
                men_vec = self._mental_vector_on_date(conn, user_id, target_date)
                if fin_vec is not None or men_vec is not None:
                    rows.append(
                        {
                            "date": str(target_date),
                            "fin_vector": fin_vec or [0.0] * 16,
                            "men_vector": men_vec or [0.0] * 15,
                        }
                    )
        return rows

    # ------------------------------------------------------------------
    # Financial helpers
    # ------------------------------------------------------------------

    def _daily_avg_spend(self, conn, user_id: int, days: int) -> float:
        cutoff = (datetime.now().date() - timedelta(days=days)).isoformat()
        row = conn.execute(
            """
            SELECT COALESCE(SUM(amount), 0) AS total,
                   COUNT(DISTINCT date)     AS active_days
            FROM expenses
            WHERE user_id = ? AND date >= ?
            """,
            (user_id, cutoff),
        ).fetchone()
        if not row or row["active_days"] == 0:
            return 0.0
        return float(row["total"]) / float(row["active_days"])

    def _weekly_spend(self, conn, user_id: int, weeks_ago: int) -> float:
        today = datetime.now().date()
        end = today - timedelta(weeks=weeks_ago)
        start = end - timedelta(days=6)
        row = conn.execute(
            """
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM expenses
            WHERE user_id = ? AND date >= ? AND date <= ?
            """,
            (user_id, start.isoformat(), end.isoformat()),
        ).fetchone()
        return float(row["total"]) if row else 0.0

    def _month_spend(self, conn, user_id: int, month_start) -> float:
        row = conn.execute(
            """
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM expenses
            WHERE user_id = ? AND date >= ?
            """,
            (user_id, month_start.isoformat()),
        ).fetchone()
        return float(row["total"]) if row else 0.0

    def _category_totals(self, conn, user_id: int, days: int) -> Dict[str, float]:
        cutoff = (datetime.now().date() - timedelta(days=days)).isoformat()
        rows = conn.execute(
            """
            SELECT category, COALESCE(SUM(amount), 0) AS total
            FROM expenses
            WHERE user_id = ? AND date >= ?
            GROUP BY category
            """,
            (user_id, cutoff),
        ).fetchall()
        return {r["category"]: float(r["total"]) for r in rows}

    def _impulse_spend_count(self, conn, user_id: int, days: int) -> int:
        """
        Count individual expenses > 2× the daily average for their category.
        """
        cutoff = (datetime.now().date() - timedelta(days=days)).isoformat()
        # Category-level daily averages
        rows = conn.execute(
            """
            SELECT e.id, e.category, e.amount,
                   AVG(e.amount) OVER (PARTITION BY e.category) AS cat_avg
            FROM expenses e
            WHERE e.user_id = ? AND e.date >= ?
            """,
            (user_id, cutoff),
        ).fetchall()
        return sum(1 for r in rows if float(r["amount"]) > 2.0 * float(r["cat_avg"]))

    def _category_overspend_count(
        self, conn, user_id: int, spendable_budget: float, month_start
    ) -> int:
        """
        Count how many categories are above their proportional share of spendable budget.
        Proportional share = (category_pct_last_30d) * spendable_budget
        """
        if spendable_budget <= 0:
            return 0

        # Last 30 days proportions
        cat_30d = self._category_totals(conn, user_id, days=30)
        total_30d = sum(cat_30d.values()) or 1.0
        cat_proportions = {c: v / total_30d for c, v in cat_30d.items()}

        # Current month actuals
        cat_month = self._category_totals_since(conn, user_id, month_start)

        overspend = 0
        for cat, pct in cat_proportions.items():
            budget_for_cat = pct * spendable_budget
            actual = cat_month.get(cat, 0.0)
            if actual > budget_for_cat:
                overspend += 1
        return overspend

    def _category_totals_since(self, conn, user_id: int, since_date) -> Dict[str, float]:
        rows = conn.execute(
            """
            SELECT category, COALESCE(SUM(amount), 0) AS total
            FROM expenses
            WHERE user_id = ? AND date >= ?
            GROUP BY category
            """,
            (user_id, since_date.isoformat()),
        ).fetchall()
        return {r["category"]: float(r["total"]) for r in rows}

    def _food_homemade_ratio(self, conn, user_id: int, days: int) -> float:
        cutoff = (datetime.now().date() - timedelta(days=days)).isoformat()
        row = conn.execute(
            """
            SELECT COUNT(*) AS total,
                   SUM(CASE WHEN is_homemade = 1 THEN 1 ELSE 0 END) AS homemade
            FROM food_logs
            WHERE user_id = ? AND date >= ?
            """,
            (user_id, cutoff),
        ).fetchone()
        if not row or row["total"] == 0:
            return 0.5  # neutral default
        return float(row["homemade"]) / float(row["total"])

    def _skipped_meals_count(self, conn, user_id: int, days: int) -> int:
        """
        Days with < 3 food_log entries = partially skipped meals.
        Includes today so a skipped meal today is caught immediately.
        """
        cutoff = (datetime.now().date() - timedelta(days=days)).isoformat()
        rows = conn.execute(
            """
            SELECT date, COUNT(*) AS meal_count
            FROM food_logs
            WHERE user_id = ? AND date >= ?
            GROUP BY date
            """,
            (user_id, cutoff),
        ).fetchall()

        # Days present in food_logs but with fewer than 3 meals
        partial_days = sum(1 for r in rows if r["meal_count"] < 3)

        # Days with zero food entries in the window (including today)
        dates_with_entries = {r["date"] for r in rows}
        today = datetime.now().date()
        # range(days + 1) so the window is [today-days .. today] inclusive
        all_dates = {
            (today - timedelta(days=i)).isoformat() for i in range(days + 1)
        }
        zero_entry_days = len(all_dates - dates_with_entries)

        return partial_days + zero_entry_days

    # ------------------------------------------------------------------
    # Mental helpers
    # ------------------------------------------------------------------

    def _health_logs(self, conn, user_id: int, days: int) -> List[Dict]:
        cutoff = (datetime.now().date() - timedelta(days=days)).isoformat()
        return conn.execute(
            """
            SELECT sleep_hours, stress_level, mood, exercise_minutes,
                   energy_level, social_activity, date
            FROM health_logs
            WHERE user_id = ? AND date >= ?
            ORDER BY date ASC
            """,
            (user_id, cutoff),
        ).fetchall()

    def _baseline_sleep(self, conn, user_id: int) -> float:
        """First 7 check-ins define the personal sleep baseline."""
        row = conn.execute(
            """
            SELECT AVG(sleep_hours) AS baseline
            FROM (
                SELECT sleep_hours
                FROM health_logs
                WHERE user_id = ?
                ORDER BY date ASC
                LIMIT 7
            )
            """,
            (user_id,),
        ).fetchone()
        if not row or row["baseline"] is None:
            return 7.0  # sensible default
        return float(row["baseline"])

    def _linear_slope(self, values: List[float]) -> float:
        """
        Simple OLS slope over the series.
        Positive = trending up, negative = trending down.
        """
        n = len(values)
        if n < 2:
            return 0.0
        x_mean = (n - 1) / 2.0
        y_mean = mean(values)
        num = sum((i - x_mean) * (v - y_mean) for i, v in enumerate(values))
        den = sum((i - x_mean) ** 2 for i in range(n))
        return num / den if den != 0 else 0.0

    def _bad_mood_streak(self, conn, user_id: int) -> int:
        """
        Count consecutive *calendar* days ending today where mood is negative
        (anxious, sad, overwhelmed).  Gaps in check-in history break the streak.
        """
        rows = conn.execute(
            """
            SELECT date, mood FROM health_logs
            WHERE user_id = ?
            ORDER BY date DESC
            LIMIT 14
            """,
            (user_id,),
        ).fetchall()

        streak = 0
        negative_moods = {"anxious", "sad", "overwhelmed"}
        prev_date = None

        for row in rows:
            row_date = datetime.strptime(row["date"], "%Y-%m-%d").date()

            # If there's a gap of more than 1 day between entries, streak is broken
            if prev_date is not None and (prev_date - row_date).days > 1:
                break

            if row["mood"] in negative_moods:
                streak += 1
                prev_date = row_date
            else:
                break  # non-negative day breaks the streak

        return streak

    def _goal_metrics(
        self, conn, user_id: int, logs_7d: List[Dict]
    ) -> Tuple[float, int]:
        """
        Returns (completion_rate 0-1, missed_goals_count).
        Compares actual health_log averages against active routine_goals.
        """
        goals = conn.execute(
            """
            SELECT goal_type, weekly_target
            FROM routine_goals
            WHERE user_id = ? AND status = 'active'
            """,
            (user_id,),
        ).fetchall()

        if not goals or not logs_7d:
            return 1.0, 0  # no goals = not failing any

        completed = 0
        missed = 0

        for goal in goals:
            gtype = goal["goal_type"]
            target = float(goal["weekly_target"])

            if gtype == "sleep":
                actual = mean([r["sleep_hours"] for r in logs_7d])
            elif gtype == "exercise":
                actual = mean([r["exercise_minutes"] for r in logs_7d])
            elif gtype == "stress":
                # For stress, lower is better; goal is to stay below target
                actual = mean([r["stress_level"] for r in logs_7d])
                completed += 1 if actual <= target else 0
                missed += 1 if actual > target else 0
                continue
            elif gtype == "study":
                actual = mean([r.get("study_hours", 0) for r in logs_7d])
            else:
                continue

            if actual >= target * 0.5:  # within 50% of target counts
                completed += 1
            else:
                missed += 1

        total = completed + missed
        rate = completed / total if total > 0 else 1.0
        return rate, missed

    # ------------------------------------------------------------------
    # Historical snapshot helpers (for ML bootstrap)
    # ------------------------------------------------------------------

    def _financial_vector_on_date(
        self, conn, user_id: int, target_date
    ) -> Optional[List[float]]:
        """Build a financial feature vector as-of a specific historical date."""
        user = self._fetch_user(conn, user_id)
        if not user:
            return None

        monthly_income = float(user["monthly_income"] or 0)
        emergency_fund = monthly_income * 0.10
        spendable_budget = monthly_income - emergency_fund
        month_start = target_date.replace(day=1)

        # 7d and 30d look-back relative to target_date
        cutoff_7d = (target_date - timedelta(days=7)).isoformat()
        cutoff_30d = (target_date - timedelta(days=30)).isoformat()
        target_iso = target_date.isoformat()

        def daily_avg(cutoff: str) -> float:
            r = conn.execute(
                """
                SELECT COALESCE(SUM(amount),0) AS t, COUNT(DISTINCT date) AS d
                FROM expenses WHERE user_id=? AND date>=? AND date<=?
                """,
                (user_id, cutoff, target_iso),
            ).fetchone()
            if not r or r["d"] == 0:
                return 0.0
            return float(r["t"]) / float(r["d"])

        daily_7d = daily_avg(cutoff_7d)
        daily_30d = daily_avg(cutoff_30d)

        def week_total(week_end) -> float:
            ws = (week_end - timedelta(days=6)).isoformat()
            we = week_end.isoformat()
            r = conn.execute(
                "SELECT COALESCE(SUM(amount),0) AS t FROM expenses WHERE user_id=? AND date>=? AND date<=?",
                (user_id, ws, we),
            ).fetchone()
            return float(r["t"]) if r else 0.0

        wc = week_total(target_date)
        wl = week_total(target_date - timedelta(days=7))
        growth = (wc - wl) / wl if wl > 0 else 0.0

        month_spent_r = conn.execute(
            "SELECT COALESCE(SUM(amount),0) AS t FROM expenses WHERE user_id=? AND date>=? AND date<=?",
            (user_id, month_start.isoformat(), target_iso),
        ).fetchone()
        month_spent = float(month_spent_r["t"]) if month_spent_r else 0.0

        days_elapsed = target_date.day
        days_in_month = self._days_in_month(target_date)
        projected = month_spent + daily_7d * max(0, days_in_month - days_elapsed)

        util_pct = (month_spent / spendable_budget * 100) if spendable_budget > 0 else 0.0
        remaining = spendable_budget - month_spent
        days_broke = (remaining / daily_7d) if daily_7d > 0 else float(days_in_month)
        safety_margin = spendable_budget - projected

        cats_r = conn.execute(
            """
            SELECT category, COALESCE(SUM(amount),0) AS t
            FROM expenses WHERE user_id=? AND date>=? AND date<=?
            GROUP BY category
            """,
            (user_id, cutoff_30d, target_iso),
        ).fetchall()
        cats = {r["category"]: float(r["t"]) for r in cats_r}
        total_cat = sum(cats.values()) or 1.0

        food_r = cats.get("food", 0) / total_cat
        transport_r = cats.get("transport", 0) / total_cat
        ent_r = cats.get("entertainment", 0) / total_cat

        # Simplified impulse count for historical: expense > 2× category avg over the 30d window
        cat_avg_per_expense = {
            cat: total / max(1, sum(
                1 for r2 in conn.execute(
                    "SELECT 1 FROM expenses WHERE user_id=? AND category=? AND date>=? AND date<=?",
                    (user_id, cat, cutoff_30d, target_iso),
                ).fetchall()
            ))
            for cat, total in cats.items()
        }
        impulse = 0
        for r in conn.execute(
            "SELECT amount, category FROM expenses WHERE user_id=? AND date>=? AND date<=?",
            (user_id, cutoff_30d, target_iso),
        ).fetchall():
            avg = cat_avg_per_expense.get(r["category"], 0)
            if avg > 0 and float(r["amount"]) > 2.0 * avg:
                impulse += 1

        homemade_r = conn.execute(
            """
            SELECT COUNT(*) AS t,
                   SUM(CASE WHEN is_homemade=1 THEN 1 ELSE 0 END) AS h
            FROM food_logs WHERE user_id=? AND date>=? AND date<=?
            """,
            (user_id, cutoff_7d, target_iso),
        ).fetchone()
        hm_ratio = (float(homemade_r["h"]) / float(homemade_r["t"])) if homemade_r and homemade_r["t"] else 0.5

        skip_r = conn.execute(
            """
            SELECT date, COUNT(*) AS c
            FROM food_logs WHERE user_id=? AND date>=? AND date<=?
            GROUP BY date
            """,
            (user_id, cutoff_7d, target_iso),
        ).fetchall()
        skip_meals = sum(1 for r in skip_r if r["c"] < 3)

        overspend = 0
        for cat, v in cats.items():
            prop = v / total_cat
            budg = prop * spendable_budget
            act = cats.get(cat, 0)
            if act > budg:
                overspend += 1

        return [
            daily_7d, daily_30d, wc, wl, growth, projected, util_pct,
            min(days_broke, 31), food_r, transport_r, ent_r,
            float(impulse), safety_margin, float(overspend),
            hm_ratio, float(skip_meals),
        ]

    def _mental_vector_on_date(
        self, conn, user_id: int, target_date
    ) -> Optional[List[float]]:
        """Build a mental feature vector as-of a specific historical date."""
        cutoff_7d = (target_date - timedelta(days=7)).isoformat()
        target_iso = target_date.isoformat()

        logs = conn.execute(
            """
            SELECT sleep_hours, stress_level, mood, exercise_minutes,
                   energy_level, social_activity
            FROM health_logs
            WHERE user_id=? AND date>=? AND date<=?
            ORDER BY date ASC
            """,
            (user_id, cutoff_7d, target_iso),
        ).fetchall()

        if not logs:
            return None

        sleep_vals = [r["sleep_hours"] for r in logs]
        stress_vals = [r["stress_level"] for r in logs]
        ex_vals = [r["exercise_minutes"] for r in logs]
        mood_vals = [MOOD_SCORES.get(r["mood"], 0.5) for r in logs]
        energy_vals = [r["energy_level"] for r in logs]
        social_vals = [r["social_activity"] for r in logs]

        sl_avg = mean(sleep_vals)
        st_avg = mean(stress_vals)
        ex_avg = mean(ex_vals)
        mo_avg = mean(mood_vals)
        en_avg = mean(energy_vals)
        so_avg = mean(social_vals)

        baseline_r = conn.execute(
            """
            SELECT AVG(sleep_hours) AS b
            FROM (SELECT sleep_hours FROM health_logs
                  WHERE user_id=? ORDER BY date ASC LIMIT 7)
            """,
            (user_id,),
        ).fetchone()
        baseline_sleep = float(baseline_r["b"]) if baseline_r and baseline_r["b"] else 7.0

        sleep_deficit = max(0.0, baseline_sleep - sl_avg)
        stress_trend = self._linear_slope(stress_vals)
        no_ex_days = sum(1 for v in ex_vals if v < 5)

        # Bad mood streak ending on target_date
        streak_rows = conn.execute(
            """
            SELECT mood FROM health_logs
            WHERE user_id=? AND date<=?
            ORDER BY date DESC LIMIT 14
            """,
            (user_id, target_iso),
        ).fetchall()
        streak = 0
        neg = {"anxious", "sad", "overwhelmed"}
        for r in streak_rows:
            if r["mood"] in neg:
                streak += 1
            else:
                break

        sl_cons = stdev(sleep_vals) if len(sleep_vals) > 1 else 0.0
        sl_ratio = sl_avg / 8.0
        st_sl_interaction = st_avg * (1.0 - min(sl_ratio, 1.0))

        # Skipped meals on this date window
        skip_r = conn.execute(
            """
            SELECT date, COUNT(*) AS c
            FROM food_logs WHERE user_id=? AND date>=? AND date<=?
            GROUP BY date
            """,
            (user_id, cutoff_7d, target_iso),
        ).fetchall()
        skip_meals = sum(1 for r in skip_r if r["c"] < 3)

        # Goal metrics (simplified for historical)
        goals = conn.execute(
            "SELECT goal_type, weekly_target FROM routine_goals WHERE user_id=? AND status='active'",
            (user_id,),
        ).fetchall()
        completed = missed = 0
        for g in goals:
            gtype = g["goal_type"]
            target = float(g["weekly_target"])
            if gtype == "sleep":
                actual = sl_avg
            elif gtype == "exercise":
                actual = ex_avg
            elif gtype == "stress":
                completed += 1 if st_avg <= target else 0
                missed += 1 if st_avg > target else 0
                continue
            elif gtype == "study":
                # health_logs doesn't have study_hours in the historical query;
                # treat as completed (study tracking is separate from mental burnout)
                completed += 1
                continue
            else:
                continue
            if actual >= target * 0.5:
                completed += 1
            else:
                missed += 1
        total_g = completed + missed
        goal_rate = completed / total_g if total_g > 0 else 1.0

        return [
            sl_avg, sleep_deficit, st_avg, stress_trend, ex_avg,
            float(no_ex_days), mo_avg, float(streak), en_avg, so_avg,
            goal_rate, float(missed), float(skip_meals), sl_cons, st_sl_interaction,
        ]

    # ------------------------------------------------------------------
    # Utility helpers
    # ------------------------------------------------------------------

    def _fetch_user(self, conn, user_id: int):
        return conn.execute(
            "SELECT id, monthly_income, daily_budget FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()

    @contextmanager
    def _conn(self):
        """Context manager yielding SQLite connection if db_path is set, else PostgreSQL cursor wrapper."""
        if self.db_path and os.path.exists(self.db_path):
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            try:
                yield conn
            finally:
                conn.close()
        else:
            with get_db_cursor() as cursor:
                yield DBWrapper(cursor)

    @staticmethod
    def _days_in_month(d) -> int:
        """Return total days in the month of date d."""
        if d.month == 12:
            return 31
        next_m = d.replace(month=d.month + 1, day=1)
        return (next_m - d.replace(day=1)).days


