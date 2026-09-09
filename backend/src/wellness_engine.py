from datetime import datetime
from typing import Dict, List, Any
import calendar

from burnout_prediction.feature_engineer import FeatureEngineer
from burnout_prediction.burnout_predictor import BurnoutPredictor
from expense_management.sqlite_service import SQLiteExpenseService

class WellnessEngine:
    def __init__(self):
        self.fe = FeatureEngineer()
        self.predictor = BurnoutPredictor()
        self.db_service = SQLiteExpenseService()

    def calculate_financial_health(self, user_id: str) -> Dict[str, Any]:
        """
        Calculate financial health score based on:
        - Budget utilization (budget adherence)
        - Forecast vs budget
        - Expense trends (expense growth rate)
        """
        try:
            user_id_int = int(user_id)
            fin = self.fe.build_financial_features(user_id_int)
            
            # 1. Budget Adherence
            # If budget utilization is <= 100%, adherence is 100. If > 100%, subtract the overrun.
            budget_util = fin.budget_utilization_pct
            if fin.spendable_budget > 0:
                budget_adherence = max(0, 100 - max(0, int(budget_util - 100)))
            else:
                budget_adherence = 100
            
            # 2. Savings Score
            plan_data = self.db_service.get_budget_plan(user_id)
            savings_target = 0.0
            if plan_data:
                plan = plan_data.get("plan", plan_data)
                savings_target = float(plan.get("savings_target", 0.0))
            
            projected_spend = fin.projected_month_end_spend
            total_budget = fin.spendable_budget + fin.emergency_fund # Total monthly income
            
            projected_savings = total_budget - projected_spend
            if savings_target > 0:
                savings_score = max(0, min(100, int((projected_savings / savings_target) * 100)))
            else:
                savings_score = max(0, min(100, int(((total_budget - projected_spend) / total_budget) * 100))) if total_budget > 0 else 50
                
            # 3. Forecast Score
            # Based on how much projected spend fits in the budget.
            if projected_spend > 0 and fin.spendable_budget > 0:
                if projected_spend <= fin.spendable_budget:
                    forecast_score = 100
                else:
                    overrun_pct = (projected_spend - fin.spendable_budget) / fin.spendable_budget
                    forecast_score = max(0, min(100, int(100 - (overrun_pct * 100))))
            else:
                forecast_score = 100 if fin.spendable_budget > 0 else 50

            # Financial Health is average of the three
            financial_health = int((budget_adherence + savings_score + forecast_score) / 3)

            return {
                "financial_health": financial_health,
                "budget_adherence": int(budget_adherence),
                "savings_score": int(savings_score),
                "forecast_score": int(forecast_score)
            }
        except Exception as e:
            print(f"Error calculating financial health for user {user_id}: {e}")
            return {
                "financial_health": 50,
                "budget_adherence": 50,
                "savings_score": 50,
                "forecast_score": 50
            }

    def calculate_wellness_score(self, financial_health_score: int, burnout_score: int) -> Dict[str, Any]:
        """
        wellness_score = 0.6 * financial_health_score + 0.4 * burnout_score_inverse
        Where burnout_score_inverse = 100 - burnout_score
        """
        burnout_score_inverse = 100 - burnout_score
        wellness_score = int(0.6 * financial_health_score + 0.4 * burnout_score_inverse)
        
        # Categorise
        if wellness_score >= 80:
            category = "Good"
        elif wellness_score >= 50:
            category = "Moderate"
        else:
            category = "Poor"

        return {
            "wellness_score": wellness_score,
            "category": category,
            "burnout_score": burnout_score,
            "financial_health_score": financial_health_score
        }

    def generate_insights(self, user_id: str, wellness_score: int, financial_health: int, burnout_score: int) -> Dict[str, List[str]]:
        """
        Generate insights categorised into:
        1. financial
        2. wellness
        3. productivity
        """
        try:
            user_id_int = int(user_id)
            pred = self.predictor.predict(user_id_int)
            burnout_recs = pred.recommendations
        except Exception:
            burnout_recs = ["Take regular breaks during study sessions."]

        financial_recs = []
        wellness_recs = []
        productivity_recs = []

        # Categorise burnout predictor recommendations
        for rec in burnout_recs:
            rec_lower = rec.lower()
            if any(w in rec_lower for w in ["spend", "budget", "cost", "save", "meal prep", "financial", "fund"]):
                financial_recs.append(rec)
            elif any(w in rec_lower for w in ["study", "work", "priorit", "break", "screen", "midnight"]):
                productivity_recs.append(rec)
            else:
                wellness_recs.append(rec)

        # Supplement with custom financial health rules if empty
        if not financial_recs:
            if financial_health < 50:
                financial_recs.append("Financial stress level is high. Review your expenses immediately.")
                financial_recs.append("Consider cooking at home to save on food expenses this week.")
            elif financial_health < 80:
                financial_recs.append("Check your spending category breakdown; one category might be creeping up.")
            else:
                financial_recs.append("Your spending is well within budget. Keep it consistent!")

        # Supplement with custom wellness rules if empty
        if not wellness_recs:
            if burnout_score > 70:
                wellness_recs.append("Your burnout risk is high. Please prioritize sleep and consider talking to a friend or mentor.")
                wellness_recs.append("Engage in a 10-minute walk outside; fresh air helps reduce cortisol.")
            elif burnout_score > 40:
                wellness_recs.append("Aim for at least 7-8 hours of sleep tonight.")
                wellness_recs.append("Maintain a consistent bedtime routine to aid recovery.")
            else:
                wellness_recs.append("Your wellness metrics look stable. Keep up your current healthy routine!")

        # Supplement with custom productivity rules if empty
        if not productivity_recs:
            if burnout_score > 50:
                productivity_recs.append("Use the Pomodoro technique: study for 25 minutes, then take a 5-minute break.")
                productivity_recs.append("Avoid studying after midnight to improve sleep and memory retention.")
            else:
                productivity_recs.append("Keep maintaining a balanced study and rest schedule.")

        return {
            "financial": financial_recs[:3],
            "wellness": wellness_recs[:3],
            "productivity": productivity_recs[:3]
        }
