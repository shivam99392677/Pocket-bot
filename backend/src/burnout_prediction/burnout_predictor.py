"""
BurnoutPredictor  —  the single public entry point.

Usage:
    predictor = BurnoutPredictor(db_path="path/to/pocketbuddy.db")
    result = predictor.predict(user_id=3)

The predictor transparently selects the right tier on every call:
    days_of_data < 4  →  RuleBasedStrategy   (confidence ~0.35-0.50)
    days_of_data 4-6  →  HybridStrategy      (confidence ~0.55-0.63)
    days_of_data ≥ 7  →  MLStrategy          (confidence 0.65 → 0.92)
"""

import logging
from datetime import datetime

from .feature_engineer import FeatureEngineer
from .model_store import resolve_model_dir
from .score_combiner import ScoreCombiner
from .schemas import (
    BurnoutPredictionResponse,
    BurnoutAlertLevel,
    PredictionStrategy,
)
from .strategies.rule_based import RuleBasedStrategy
from .strategies.hybrid import HybridStrategy
from .strategies.ml_strategy import MLStrategy

log = logging.getLogger(__name__)


class BurnoutPredictor:
    """
    Facade over the three-tier prediction system.
    Thread-safe for concurrent web requests (stateless per call).
    """

    def __init__(self, db_path: str = None):
        self._db_path = db_path
        self._fe = FeatureEngineer(db_path)
        self._combiner = ScoreCombiner()
        self._model_dir = resolve_model_dir()

        # Strategies (shared, stateless for rule/hybrid; ML uses per-user files)
        self._rule_strategy = RuleBasedStrategy()
        self._hybrid_strategy = HybridStrategy()
        self._ml_strategy = MLStrategy(
            model_dir=self._model_dir,
            feature_engineer=self._fe,
        )

    # ──────────────────────────────────────────────────────────────────
    # Main predict method
    # ──────────────────────────────────────────────────────────────────

    def predict(self, user_id: int) -> BurnoutPredictionResponse:
        """
        Run a full burnout prediction for the given user.
        Automatically selects the right strategy tier based on data availability.
        Returns a safe default response on any unexpected error.
        """
        try:
            days_of_data = self._fe.get_data_day_count(user_id)

            # Build feature vectors (always needed by all tiers)
            fin_features = self._fe.build_financial_features(user_id)
            men_features = self._fe.build_mental_features(user_id)
        except Exception as e:
            log.error(f"Feature engineering failed for user {user_id}: {e}")
            return self._error_response(user_id, str(e))

        try:
            # ── Strategy selection ──────────────────────────────────────
            strategy = self._select_strategy(days_of_data)

            if strategy == PredictionStrategy.ML:
                result = self._ml_strategy.predict(
                    fin_features, men_features, days_of_data, user_id=user_id
                )
            elif strategy == PredictionStrategy.HYBRID:
                result = self._hybrid_strategy.predict(
                    fin_features, men_features, days_of_data
                )
            else:
                result = self._rule_strategy.predict(
                    fin_features, men_features, days_of_data
                )
        except Exception as e:
            log.error(f"Strategy prediction failed for user {user_id}: {e}")
            # Fall back to rule-based which has no external dependencies
            try:
                result = self._rule_strategy.predict(fin_features, men_features, days_of_data)
            except Exception as e2:
                log.error(f"Rule-based fallback also failed for user {user_id}: {e2}")
                return self._error_response(user_id, str(e))

        # ── Enrich with alert level and recommendations ─────────────
        alert_level = self._combiner.get_alert_level(result.combined_score)
        recommendations = self._combiner.build_recommendations(result, alert_level)
        next_upgrade = self._combiner.days_until_upgrade(days_of_data)

        return BurnoutPredictionResponse(
            user_id=str(user_id),
            date=datetime.now().date().isoformat(),
            financial_score=result.financial_score,
            mental_score=result.mental_score,
            combined_score=result.combined_score,
            alert_level=alert_level,
            top_risk_factors=result.risk_factors[:5],  # top 5 factors
            recommendations=recommendations,
            strategy_used=result.strategy_used,
            confidence=result.confidence,
            days_of_data=days_of_data,
            next_upgrade_in_days=next_upgrade if next_upgrade > 0 else None,
            financial_details=result.financial_details,
            mental_details=result.mental_details,
        )

    @staticmethod
    def _error_response(user_id: int, error_msg: str) -> BurnoutPredictionResponse:
        """Return a safe neutral response when prediction cannot be completed."""
        return BurnoutPredictionResponse(
            user_id=str(user_id),
            date=datetime.now().date().isoformat(),
            financial_score=0.0,
            mental_score=0.0,
            combined_score=0.0,
            alert_level=BurnoutAlertLevel.GOOD,
            top_risk_factors=[],
            recommendations=["Unable to compute prediction — please check in again later."],
            strategy_used=PredictionStrategy.RULE_BASED,
            confidence=0.0,
            days_of_data=0,
            next_upgrade_in_days=None,
            financial_details={"error": error_msg},
            mental_details={"error": error_msg},
        )

    # ──────────────────────────────────────────────────────────────────
    # Strategy selection
    # ──────────────────────────────────────────────────────────────────

    @staticmethod
    def _select_strategy(days_of_data: int) -> PredictionStrategy:
        if days_of_data >= 7:
            return PredictionStrategy.ML
        if days_of_data >= 4:
            return PredictionStrategy.HYBRID
        return PredictionStrategy.RULE_BASED
