"""
FastAPI application - Poket Bot
Production-ready version with Expense Management & Personalized Support
Organized by feature sections for better maintainability
"""

import os
import sys
from pathlib import Path
from datetime import datetime
from typing import List, Optional
from contextlib import asynccontextmanager
from dotenv import load_dotenv

# Reconfigure stdout/stderr to UTF-8 to prevent encoding crashes on Windows console
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding='utf-8')
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# ==================== PRODUCTION-READY PATH HANDLING ====================
def setup_project_paths():
    """Automatically configure Python paths for production"""
    current_file = Path(__file__).resolve()

    # Walk up to find the project root (the folder that contains 'backend/')
    project_root = current_file.parent
    for _ in range(4):
        if (project_root / 'backend').exists():
            break
        project_root = project_root.parent

    # backend/src must be on sys.path so packages like
    # `personalised_support` and `expense_management` are importable directly.
    backend_src = project_root / 'backend' / 'src'
    for p in [str(project_root), str(backend_src)]:
        if p not in sys.path:
            sys.path.insert(0, p)

    # NOTE: Do NOT add the sub-package folders themselves (e.g. personalised_support/)
    # to sys.path — that breaks relative imports inside those packages.

    return project_root

# Setup paths before any other imports
PROJECT_ROOT = setup_project_paths()
print(f"[OK] Project Root: {PROJECT_ROOT}")
print(f"[OK] Python Path: {sys.path[0]}")

# ==================== CORE IMPORTS ====================
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import Literal


# ── Burnout: health check-in request schema ──────────────────────────────────
class HealthLogCreate(BaseModel):
    date: Optional[str] = None                          # defaults to today
    sleep_hours: float = Field(7.0, ge=0, le=24)
    stress_level: int = Field(5, ge=1, le=10)
    mood: Literal["happy", "neutral", "anxious", "sad", "overwhelmed"] = "neutral"
    study_hours: float = Field(0.0, ge=0, le=24)
    exercise_minutes: int = Field(0, ge=0, le=300)
    social_activity: int = Field(3, ge=1, le=10)
    energy_level: int = Field(5, ge=1, le=10)
    notes: str = ""

# ==================== EXPENSE MANAGEMENT IMPORTS ====================
expense_initializer = None
alert_system = None
trend_analyzer = None
forecaster = None
firebase_service = None
analyzer = None
planner = None

try:
    from backend.src.expense_management.initialize_boundary import ExpenseInitializer
    from backend.src.expense_management.alert_system import AlertSystem
    from backend.src.expense_management.trend_analyzer import TrendAnalyzer
    from backend.src.expense_management.forecaster import ExpenseForecaster
    from backend.src.expense_management.firebase_service import FirebaseExpenseService
    from backend.src.expense_management.expense_analyzer import ExpenseAnalyzer
    from backend.src.expense_management.budget_planner import BudgetPlanner
    from backend.src.expense_management.schemas import (
        InitializeUserRequest, InitializeUserResponse,
        CustomBudgetRequest, BudgetPlanResponse,
        MonthlyTrendResponse, CategoryTrendResponse,
        ForecastResponse, AlertResponse,
        RemainingBudgetResponse, DashboardResponse,
        HealthCheckResponse, ErrorResponse, ExpenseCreate,
        OnboardUserRequest, OnboardUserResponse
    )
    print("[OK] Expense Management imports successful")

    firebase_service = FirebaseExpenseService()
    expense_initializer = ExpenseInitializer()
    alert_system = AlertSystem(firebase_service)
    trend_analyzer = TrendAnalyzer(firebase_service)
    forecaster = ExpenseForecaster(firebase_service)
    analyzer = ExpenseAnalyzer()
    planner = BudgetPlanner(analyzer)

except ImportError as e:
    print(f"[WARN] First import attempt failed: {e}")

    try:
        expense_mgmt_path = PROJECT_ROOT / 'backend' / 'src' / 'expense_management'
        if str(expense_mgmt_path) not in sys.path:
            sys.path.insert(0, str(expense_mgmt_path))

        from backend.src.expense_management.initialize_boundary import ExpenseInitializer
        from backend.src.expense_management.alert_system import AlertSystem
        from backend.src.expense_management.trend_analyzer import TrendAnalyzer
        from backend.src.expense_management.forecaster import ExpenseForecaster
        from backend.src.expense_management.firebase_service import FirebaseExpenseService
        from backend.src.expense_management.expense_analyzer import ExpenseAnalyzer
        from backend.src.expense_management.budget_planner import BudgetPlanner
        from backend.src.expense_management.schemas import (
            InitializeUserRequest, InitializeUserResponse,
            CustomBudgetRequest, BudgetPlanResponse,
            MonthlyTrendResponse, CategoryTrendResponse,
            ForecastResponse, AlertResponse,
            RemainingBudgetResponse, DashboardResponse,
            HealthCheckResponse, ErrorResponse, ExpenseCreate,
            OnboardUserRequest, OnboardUserResponse
        )
        print("[OK] Expense Management imports successful (direct path)")

        firebase_service = FirebaseExpenseService()
        expense_initializer = ExpenseInitializer()
        alert_system = AlertSystem(firebase_service)
        trend_analyzer = TrendAnalyzer(firebase_service)
        forecaster = ExpenseForecaster(firebase_service)
        analyzer = ExpenseAnalyzer()
        planner = BudgetPlanner(analyzer)

    except ImportError as e2:
        print(f"[WARN] Expense Management services unavailable: {e2}")

        class MockService:
            def __init__(self, *args, **kwargs): pass
            def __getattr__(self, name):
                return lambda *args, **kwargs: {"mock": True, "message": f"Demo mode: {name} called"}

        firebase_service = MockService()
        expense_initializer = MockService()
        alert_system = MockService()
        trend_analyzer = MockService()
        forecaster = MockService()
        analyzer = MockService()
        planner = MockService()

        try:
            # pyrefly: ignore [missing-import]
            from schemas import (
                InitializeUserRequest, InitializeUserResponse,
                CustomBudgetRequest, BudgetPlanResponse,
                MonthlyTrendResponse, CategoryTrendResponse,
                ForecastResponse, AlertResponse,
                RemainingBudgetResponse, DashboardResponse,
                HealthCheckResponse, ErrorResponse, ExpenseCreate,
                OnboardUserRequest, OnboardUserResponse
            )
        except ImportError:
            class InitializeUserRequest(BaseModel): user_id: str; current_month_budget: float
            class InitializeUserResponse(BaseModel): success: bool; user_id: str
            class CustomBudgetRequest(BaseModel): user_id: str; custom_budget: float; savings_target: float = 0
            class HealthCheckResponse(BaseModel): status: str; timestamp: str; version: str
            class ExpenseCreate(BaseModel): amount: float; category: str; description: str = ""
            class OnboardUserRequest(BaseModel):
                user_id: str
                last_month_total: float
                last_month_category_expenses: dict
                this_month_budget: float
                savings_target: float = 0.0
            class OnboardUserResponse(BaseModel):
                user_id: str
                success: bool
                budget_plan: dict
                summary: dict
                error: Optional[str] = None
            BudgetPlanResponse = dict
            MonthlyTrendResponse = dict
            CategoryTrendResponse = dict
            ForecastResponse = dict
            AlertResponse = dict
            RemainingBudgetResponse = dict
            DashboardResponse = dict
            ErrorResponse = dict

# ==================== BURNOUT PREDICTION IMPORTS ====================
burnout_predictor = None

try:
    from burnout_prediction.burnout_predictor import BurnoutPredictor
    from burnout_prediction.model_store import resolve_model_dir, delete_user_models
    from burnout_prediction.schemas import BurnoutPredictionResponse

    burnout_predictor = BurnoutPredictor()
    print("[OK] Burnout Predictor initialised — db: PostgreSQL")
except ImportError as e:
    print(f"[WARN] Burnout Prediction not available: {e}")
    burnout_predictor = None

# ==================== PERSONALISED SUPPORT IMPORTS ====================
# The personalised_support package lives at backend/src/personalised_support/.
# backend/src is already on sys.path from setup_project_paths(), so we import
# it as a normal top-level package — no `src.` prefix needed.
support_router = None
chat_manager = None

try:
    # pyrefly: ignore [missing-import]
    from personalised_support.api_routes import router as support_router
    # pyrefly: ignore [missing-import]
    from personalised_support import chat_manager
    _llm_status = "operational" if chat_manager.ai_chatbot.llm else "limited (no LLM key)"
    print(f"[OK] Personalised Support imported — AI chatbot: {_llm_status}")
except ImportError as e:
    print(f"[WARN] Personalised Support not available: {e}")
    support_router = None
    chat_manager = None


# ==================== WELLNESS & BURNOUT IMPORTS ====================
wellness_engine = None
burnout_predictor = None

try:
    from burnout_prediction.burnout_predictor import BurnoutPredictor
    from wellness_engine import WellnessEngine

    wellness_engine = WellnessEngine()
    burnout_predictor = BurnoutPredictor()
    print("[OK] Wellness & Burnout services initialized successfully with PostgreSQL")
except Exception as e:
    print(f"[WARN] Wellness & Burnout services initialization failed: {e}")

# ==================== FIREBASE INITIALIZATION ====================
import firebase_admin
from firebase_admin import db

firebase_initialized = False
try:
    if not firebase_admin._apps:
        firebase_admin.initialize_app(options={
            'databaseURL': os.getenv('FIREBASE_DATABASE_URL', 'https://your-database.firebaseio.com/')
        })
    firebase_initialized = True
    print(f"✅ Firebase initialized")
except Exception as e:
    print(f"⚠ Firebase initialization: {e}")

# ==================== FASTAPI APPLICATION SETUP ====================
app = FastAPI(
    title="Poket Bot API",
    description="Complete financial management system with expense tracking, budgeting, and AI-powered personalized support",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Personalised Support routes (/api/support/...) ──────────────────────────
# Registered here so all 16 endpoints appear in /docs alongside the rest.
if support_router:
    app.include_router(support_router)
    print("[OK] Support router attached — 16 endpoints at /api/support/*")
else:
    print("[WARN] Support router not attached (import failed above)")

# ╔════════════════════════════════════════════════════════════════════════════════╗
# ║                         SYSTEM HEALTH & STATUS                                  ║
# ╚════════════════════════════════════════════════════════════════════════════════╝

@app.get("/health", response_model=HealthCheckResponse)
async def health_check():
    """System health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "version": "2.0.0",
        "firebase_initialized": firebase_initialized,
        "services_initialized": expense_initializer is not None
    }

@app.get("/")
async def root():
    """Root endpoint with API information"""
    return {
        "message": "Poket Bot API",
        "version": "2.0.0",
        "status": "operational",
        "features": {
            "expense_management": "Track, analyze, and forecast expenses",
            "budget_planning": "Create and manage budgets with AI insights",
            "financial_alerts": "Get notified of budget overruns and anomalies",
            "personalized_support": "AI chatbot, rule-based guidance, and peer support"
        },
        "endpoints": {
            "health": "/health",
            "status": "/api/v1/status",
            "docs": "/docs",
            "redoc": "/redoc"
        }
    }

@app.get("/api/v1/status")
async def system_status():
    """Get comprehensive system status and component information"""
    return {
        "status": "operational",
        "timestamp": datetime.now().isoformat(),
        "version": "2.0.0",
        "components": {
            "firebase": {
                "status": "initialized" if firebase_initialized else "unavailable",
                "available": firebase_initialized
            },
            "expense_management": {
                "analyzer": "available" if analyzer is not None else "unavailable",
                "budget_planner": "available" if planner is not None else "unavailable",
                "alert_system": "available" if alert_system is not None else "unavailable",
                "trend_analyzer": "available" if trend_analyzer is not None else "unavailable",
                "forecaster": "available" if forecaster is not None else "unavailable"
            },
            "personalized_support": {
                "status": "available" if support_router is not None else "unavailable",
                "chat_manager": "initialized" if chat_manager is not None else "unavailable"
            },
            "burnout_prediction": {
                "status": "available" if burnout_predictor is not None else "unavailable",
                "endpoints": [
                    "POST /api/v1/burnout/checkin/{user_id}",
                    "GET  /api/v1/burnout/predict/{user_id}",
                    "GET  /api/v1/burnout/history/{user_id}",
                    "POST /api/v1/burnout/save-snapshot/{user_id}",
                    "DELETE /api/v1/burnout/models/{user_id}",
                ] if burnout_predictor is not None else []
            }
        },
        "environment": {
            "project_root": str(PROJECT_ROOT),
            "python_path": sys.path[0]
        }
    }

# ╔════════════════════════════════════════════════════════════════════════════════╗
# ║                    EXPENSE MANAGEMENT FEATURE                                    ║
# ║        User initialization, expense tracking, budget management, alerts           ║
# ╚════════════════════════════════════════════════════════════════════════════════╝

# ==================== USER INITIALIZATION ====================

@app.post("/api/v1/initialize", response_model=InitializeUserResponse)
async def initialize_user(request: InitializeUserRequest):
    """
    Initialize expense management for a new user.
    Fetches historical data and creates budget plan.
    """
    try:
        if expense_initializer is None:
            raise HTTPException(status_code=503, detail="ExpenseInitializer service not available")

        result = expense_initializer.initialize_user_expenses(
            user_id=request.user_id,
            current_month_budget=request.current_month_budget
        )

        if not result.get('success'):
            raise HTTPException(status_code=500, detail=result.get('error', 'Unknown error'))

        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/onboard")
async def onboard_user(request: OnboardUserRequest):
    """
    First-time user onboarding endpoint.

    Called right after registration when the user provides:
    - Last month's total expense
    - Last month's category-wise expense breakdown
    - This month's intended budget

    The system:
    1. Persists last month's expenses to SQLite (so forecaster/trend analyzer work from day 1)
    2. Computes a category-wise budget plan for this month based on the supplied pattern
    3. Saves the budget plan to SQLite
    4. Returns the full breakdown so the frontend can show it immediately

    The chatbot will also automatically pick up this data on the next /api/support/chat call.

    Example request body:
    ```json
    {
      "user_id": "42",
      "last_month_total": 12000,
      "last_month_category_expenses": {
        "food": 4000,
        "transport": 1500,
        "entertainment": 2000,
        "education": 1500,
        "health": 500,
        "utilities": 1000,
        "others": 1500
      },
      "this_month_budget": 11000,
      "savings_target": 1000
    }
    ```
    """
    try:
        if expense_initializer is None:
            raise HTTPException(status_code=503, detail="ExpenseInitializer service not available")

        result = expense_initializer.onboard_user_with_expense_data(
            user_id=request.user_id,
            last_month_total=request.last_month_total,
            last_month_category_expenses=request.last_month_category_expenses,
            this_month_budget=request.this_month_budget,
            savings_target=request.savings_target or 0.0,
        )

        if not result.get("success"):
            raise HTTPException(status_code=500, detail=result.get("error", "Onboarding failed"))

        # Immediately push the financial context to the chatbot memory so the
        # very first chat message is already personalised.
        if chat_manager is not None:
            try:
                budget_plan = result.get("budget_plan", {})
                summary = result.get("summary", {})
                chat_manager.ai_chatbot.set_user_context(
                    request.user_id,
                    {
                        "current_month_total": 0.0,
                        "previous_month_total": request.last_month_total,
                        "budget": request.this_month_budget,
                        "budget_status": "within budget (0% used)",
                        "category_spending": {},
                        "biggest_category": summary.get("top_category"),
                        "trend": "not enough history",
                        "category_budget_breakdown": summary.get("category_budget_breakdown", {}),
                    },
                )
            except Exception as ctx_err:
                # Non-fatal — chatbot will reload context on next message
                print(f"⚠ Could not pre-load chatbot context: {ctx_err}")

        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/reinitialize-budget")
async def reinitialize_with_custom_budget(request: CustomBudgetRequest):
    """Reinitialize budget with custom amount and savings target"""
    try:
        if expense_initializer is None:
            raise HTTPException(status_code=503, detail="ExpenseInitializer service not available")

        result = expense_initializer.reinitialize_with_custom_budget(
            user_id=request.user_id,
            custom_budget=request.custom_budget,
            savings_target=request.savings_target
        )

        if not result.get('success'):
            raise HTTPException(status_code=500, detail=result.get('error', 'Unknown error'))

        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==================== EXPENSE TRACKING ====================

@app.post("/api/v1/expenses")
async def create_expense(user_id: str, expense: ExpenseCreate):
    """Create a new expense record"""
    try:
        if firebase_service is None:
            raise HTTPException(status_code=503, detail="Firebase service not available")

        expense_id = firebase_service.add_expense(
            user_id=user_id,
            amount=expense.amount,
            category=expense.category,
            description=expense.description
        )

        return {
            "success": True,
            "expense_id": expense_id
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/expenses/{user_id}")
async def get_user_expenses(user_id: str):
    """Retrieve all expenses for a user"""
    try:
        if firebase_service is None:
            raise HTTPException(status_code=503, detail="Firebase service not available")

        expenses = firebase_service.get_user_expenses(user_id)
        return {
            'user_id': user_id,
            'expenses': expenses,
            'count': len(expenses) if expenses else 0
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==================== BUDGET PLANNING & MANAGEMENT ====================

@app.get("/api/v1/budget-plan/{user_id}")
async def get_budget_plan(user_id: str):
    """Retrieve the current budget plan for a user"""
    try:
        if firebase_service is None:
            raise HTTPException(status_code=503, detail="Firebase service not available")

        plan = firebase_service.get_budget_plan(user_id)

        if not plan:
            raise HTTPException(status_code=404, detail="Budget plan not found")

        return {
            'user_id': user_id,
            'budget_plan': plan
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/remaining-budget/{user_id}")
async def get_remaining_budget(user_id: str):
    """Get remaining budget amount by category"""
    try:
        if firebase_service is None or alert_system is None:
            raise HTTPException(status_code=503, detail="Service not available")

        budget_plan = firebase_service.get_budget_plan(user_id)
        current_expenses = firebase_service.get_current_month_expenses(user_id)

        if not budget_plan:
            raise HTTPException(status_code=404, detail="Budget plan not found")

        remaining = alert_system.get_remaining_budget(budget_plan['plan'], current_expenses)

        # Calculate total remaining and safe daily limit
        total_budget = float(budget_plan['plan'].get('total_budget', 0.0))
        total_spent = sum(alert_system._categorize_expenses(current_expenses).values())
        total_remaining = total_budget - total_spent

        import calendar
        today = datetime.now()
        _, last_day = calendar.monthrange(today.year, today.month)
        remaining_days = max(1, last_day - today.day)
        safe_daily_limit = total_remaining / remaining_days

        remaining['total_remaining'] = total_remaining
        remaining['safe_daily_limit'] = safe_daily_limit

        return {
            'user_id': user_id,
            'remaining_budget': remaining,
            'total_budget': total_budget
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==================== ALERTS & ANOMALY DETECTION ====================

@app.get("/api/v1/alerts/{user_id}")
async def get_user_alerts(user_id: str):
    """Get all active alerts for a user"""
    try:
        if firebase_service is None or alert_system is None:
            raise HTTPException(status_code=503, detail="Service not available")

        budget_plan = firebase_service.get_budget_plan(user_id)
        current_expenses = firebase_service.get_current_month_expenses(user_id)

        if not budget_plan:
            raise HTTPException(status_code=404, detail="Budget plan not found")

        # Check for alerts
        category_alerts = alert_system.check_category_overspending(
            user_id, budget_plan['plan'], current_expenses
        )
        total_alert = alert_system.check_total_budget_status(
            user_id, budget_plan['plan'], current_expenses
        )

        alerts = [alert.to_dict() for alert in category_alerts]
        if total_alert:
            alerts.append(total_alert.to_dict())

        return {
            'user_id': user_id,
            'alerts': alerts,
            'alert_count': len(alerts),
            'critical_alerts': sum(1 for a in alerts if a.get('severity') == 'critical')
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/alerts/{user_id}/{alert_id}/acknowledge")
async def acknowledge_alert(user_id: str, alert_id: str):
    """Mark an alert as acknowledged by the user"""
    try:
        if alert_system is None:
            raise HTTPException(status_code=503, detail="Alert system not available")

        result = alert_system.acknowledge_alert(user_id, alert_id)

        if not result:
            raise HTTPException(status_code=500, detail="Failed to acknowledge alert")

        return {
            'success': True,
            'alert_id': alert_id,
            'acknowledged': True
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/anomalies/{user_id}")
async def detect_anomalies(user_id: str):
    """Detect unusual spending patterns and anomalies"""
    try:
        if forecaster is None:
            raise HTTPException(status_code=503, detail="Forecaster service not available")

        anomalies = forecaster.detect_anomalies(user_id)
        return anomalies
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==================== TREND ANALYSIS ====================

@app.get("/api/v1/trends/monthly/{user_id}")
async def get_monthly_trends(user_id: str, months: int = Query(6, ge=1, le=24)):
    """Get monthly spending trends for analysis"""
    try:
        if trend_analyzer is None:
            raise HTTPException(status_code=503, detail="Trend analyzer not available")

        trend = trend_analyzer.get_monthly_trend(user_id, months)

        if isinstance(trend, dict) and 'error' in trend:
            raise HTTPException(status_code=404, detail=trend['error'])

        return trend

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/trends/category/{user_id}/{category}")
async def get_category_trends(user_id: str, category: str, months: int = Query(6, ge=1, le=24)):
    """Get spending trends for a specific expense category"""
    try:
        if trend_analyzer is None:
            raise HTTPException(status_code=503, detail="Trend analyzer not available")

        trend = trend_analyzer.get_category_trend(user_id, category, months)

        if isinstance(trend, dict) and 'error' in trend:
            raise HTTPException(status_code=404, detail=trend['error'])

        return trend

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/trends/compare")
async def compare_months(user_id: str, month1: str, month2: str):
    """Compare spending between two months (format: YYYY-MM)"""
    try:
        if trend_analyzer is None:
            raise HTTPException(status_code=503, detail="Trend analyzer not available")

        comparison = trend_analyzer.compare_months(user_id, month1, month2)

        if isinstance(comparison, dict) and 'error' in comparison:
            raise HTTPException(status_code=404, detail=comparison['error'])

        return comparison

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/trends/velocity/{user_id}")
async def get_spending_velocity(user_id: str):
    """Get current spending velocity and burn rate"""
    try:
        if trend_analyzer is None:
            raise HTTPException(status_code=503, detail="Trend analyzer not available")

        velocity = trend_analyzer.get_spending_velocity(user_id)

        if isinstance(velocity, dict) and 'error' in velocity:
            raise HTTPException(status_code=404, detail=velocity['error'])

        return velocity

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==================== EXPENSE FORECASTING ====================

@app.get("/api/v1/forecast/next-month/{user_id}")
async def forecast_next_month(user_id: str, confidence: float = Query(0.85, ge=0.5, le=0.99)):
    """Forecast next month's expenses with confidence interval"""
    try:
        if forecaster is None:
            raise HTTPException(status_code=503, detail="Forecaster service not available")

        forecast = forecaster.forecast_next_month(user_id, confidence)

        if isinstance(forecast, dict) and 'error' in forecast:
            raise HTTPException(status_code=404, detail=forecast['error'])

        return forecast

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/forecast/category/{user_id}/{category}")
async def forecast_category(user_id: str, category: str, months_ahead: int = Query(1, ge=1, le=12)):
    """Forecast expenses for a specific category"""
    try:
        if forecaster is None:
            raise HTTPException(status_code=503, detail="Forecaster service not available")

        forecast = forecaster.forecast_category(user_id, category, months_ahead)

        if isinstance(forecast, dict) and 'error' in forecast:
            raise HTTPException(status_code=404, detail=forecast['error'])

        return forecast

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/forecast/seasonal/{user_id}")
async def get_seasonal_forecast(user_id: str):
    """Get seasonal spending patterns and predictions"""
    try:
        if forecaster is None:
            raise HTTPException(status_code=503, detail="Forecaster service not available")

        seasonal = forecaster.get_seasonal_forecast(user_id)

        if isinstance(seasonal, dict) and 'error' in seasonal:
            raise HTTPException(status_code=404, detail=seasonal['error'])

        return seasonal

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==================== DASHBOARD & SUMMARY ====================

@app.get("/api/v1/dashboard/{user_id}")
async def get_dashboard(user_id: str):
    """Get comprehensive dashboard with all financial data"""
    try:
        if firebase_service is None or alert_system is None or trend_analyzer is None or forecaster is None or analyzer is None:
            raise HTTPException(status_code=503, detail="One or more services not available")

        # Fetch all data
        budget_plan = firebase_service.get_budget_plan(user_id)
        current_expenses = firebase_service.get_current_month_expenses(user_id)
        previous_expenses = firebase_service.get_previous_month_expenses(user_id)

        if not budget_plan:
            return {
                "user_id": user_id,
                "status": "new_user",
                "message": "Complete onboarding to generate your financial profile"
            }

        # Get alerts
        category_alerts = alert_system.check_category_overspending(
            user_id, budget_plan['plan'], current_expenses
        )
        alerts = [alert.to_dict() for alert in category_alerts]

        # Get remaining budget
        remaining = alert_system.get_remaining_budget(budget_plan['plan'], current_expenses)

        # Calculate total remaining and safe daily limit
        total_budget = float(budget_plan['plan'].get('total_budget', 0.0))
        total_spent = sum(alert_system._categorize_expenses(current_expenses).values())
        total_remaining = total_budget - total_spent

        import calendar
        today = datetime.now()
        _, last_day = calendar.monthrange(today.year, today.month)
        remaining_days = max(1, last_day - today.day)
        safe_daily_limit = total_remaining / remaining_days

        remaining['total_remaining'] = total_remaining
        remaining['safe_daily_limit'] = safe_daily_limit

        # Get trends
        trends = trend_analyzer.get_monthly_trend(user_id, months=6)

        # Get forecast
        forecast = forecaster.forecast_next_month(user_id)

        # Get velocity
        velocity = trend_analyzer.get_spending_velocity(user_id)

        # Analyze previous and current
        prev_analysis = analyzer.analyze_previous_month(previous_expenses) if previous_expenses else {}
        curr_analysis = analyzer.analyze_previous_month(current_expenses) if current_expenses else {}

        # Get financial health score
        fin_health = 80
        budget_adherence = 100
        savings_score = 100
        forecast_score = 100
        if wellness_engine is not None:
            fin_data = wellness_engine.calculate_financial_health(user_id)
            fin_health = fin_data.get("financial_health", 50)
            budget_adherence = fin_data.get("budget_adherence", 100)
            savings_score = fin_data.get("savings_score", 100)
            forecast_score = fin_data.get("forecast_score", 100)

        # Get burnout score and risk level
        burnout_score = 0
        burnout_risk = "low"
        if burnout_predictor is not None:
            try:
                user_id_int = int(user_id)
                pred = burnout_predictor.predict(user_id_int)
                burnout_score = int(pred.combined_score * 100)
                risk_map = {
                    "good": "low",
                    "moderate": "medium",
                    "high": "high",
                    "crisis": "high"
                }
                burnout_risk = risk_map.get(pred.alert_level.value, "low")
            except Exception as e:
                print(f"Error predicting burnout in dashboard: {e}")

        # Get wellness score
        wellness_score = 80
        wellness_category = "Good"
        if wellness_engine is not None:
            well_data = wellness_engine.calculate_wellness_score(fin_health, burnout_score)
            wellness_score = well_data.get("wellness_score", 50)
            wellness_category = well_data.get("category", "Moderate")

        # Get recommendations
        recommendations = {
            "financial": [],
            "wellness": [],
            "productivity": []
        }
        if wellness_engine is not None:
            recommendations = wellness_engine.generate_insights(user_id, wellness_score, fin_health, burnout_score)

        return {
            "financial_health": fin_health,
            "wellness_score": wellness_score,
            "burnout_risk": burnout_risk,
            "remaining_budget": remaining,
            "alerts": alerts,
            "forecast": forecast if isinstance(forecast, dict) else {},
            "trend_analysis": trends.get('analysis', {}) if isinstance(trends, dict) else {},
            "recommendations": recommendations,
            
            # backwards-compatible fields
            "user_id": user_id,
            "generated_at": datetime.now().isoformat(),
            "previous_month_summary": prev_analysis,
            "current_month_summary": curr_analysis,
            "budget_plan": budget_plan.get('plan', budget_plan),
            "spending_velocity": velocity if isinstance(velocity, dict) else {},
            "wellness_category": wellness_category,
            "burnout_score": burnout_score,
            "financial_health_details": {
                "budget_adherence": budget_adherence,
                "savings_score": savings_score,
                "forecast_score": forecast_score
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== WELLNESS & BURNOUT ENDPOINTS ====================

@app.get("/api/v1/burnout/{user_id}")
async def get_user_burnout(user_id: str):
    """Retrieve burnout analysis using the ML/Hybrid/Rule-based predictor"""
    try:
        if burnout_predictor is None:
            raise HTTPException(status_code=503, detail="BurnoutPredictor service not available")
        
        user_id_int = int(user_id)
        pred = burnout_predictor.predict(user_id_int)
        
        risk_map = {
            "good": "low",
            "moderate": "medium",
            "high": "high",
            "crisis": "high"
        }
        risk_level = risk_map.get(pred.alert_level.value, "low")
        
        return {
            "user_id": user_id,
            "burnout_score": int(pred.combined_score * 100),
            "risk_level": risk_level,
            "financial_stress": int(pred.financial_score * 100),
            "mental_stress": int(pred.mental_score * 100),
            "confidence": round(pred.confidence, 2)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/wellness-score/{user_id}")
async def get_user_wellness_score(user_id: str):
    """Calculate and return the consolidated student wellness score"""
    try:
        if wellness_engine is None or burnout_predictor is None:
            raise HTTPException(status_code=503, detail="Wellness engine services not available")
        
        user_id_int = int(user_id)
        pred = burnout_predictor.predict(user_id_int)
        burnout_score = int(pred.combined_score * 100)
        
        fin_health = wellness_engine.calculate_financial_health(user_id)
        fin_score = fin_health["financial_health"]
        
        wellness_data = wellness_engine.calculate_wellness_score(fin_score, burnout_score)
        return wellness_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/financial-health/{user_id}")
async def get_user_financial_health(user_id: str):
    """Calculate and return detailed financial health metrics"""
    try:
        if wellness_engine is None:
            raise HTTPException(status_code=503, detail="Wellness engine service not available")
        
        fin_health = wellness_engine.calculate_financial_health(user_id)
        return fin_health
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/recommendations/{user_id}")
async def get_user_recommendations(user_id: str):
    """Get categorized recommendations (financial, wellness, productivity)"""
    try:
        if wellness_engine is None or burnout_predictor is None:
            raise HTTPException(status_code=503, detail="Wellness services not available")
        
        user_id_int = int(user_id)
        pred = burnout_predictor.predict(user_id_int)
        burnout_score = int(pred.combined_score * 100)
        
        fin_health = wellness_engine.calculate_financial_health(user_id)
        fin_score = fin_health["financial_health"]
        
        wellness_data = wellness_engine.calculate_wellness_score(fin_score, burnout_score)
        well_score = wellness_data["wellness_score"]
        
        recs = wellness_engine.generate_insights(user_id, well_score, fin_score, burnout_score)
        return recs
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ╔════════════════════════════════════════════════════════════════════════════════╗
# ║                        BURNOUT PREDICTION FEATURE                                ║
# ║    Health check-in logging, burnout scoring, history, model management           ║
# ╚════════════════════════════════════════════════════════════════════════════════╝

from contextlib import contextmanager
from db_postgres import get_db_cursor

class DBWrapper:
    """Wrapper around psycopg2 RealDictCursor for SQLite-compatible API."""
    def __init__(self, cursor):
        self.cursor = cursor

    def execute(self, sql: str, params=()):
        formatted_sql = sql.replace("?", "%s")
        self.cursor.execute(formatted_sql, params)
        return self.cursor

@contextmanager
def _get_db_conn(commit=False):
    """Context manager yielding PostgreSQL cursor wrapper."""
    with get_db_cursor(commit=commit) as cursor:
        yield DBWrapper(cursor)


# ── 1. Log a daily health check-in ───────────────────────────────────────────

@app.post("/api/v1/burnout/checkin/{user_id}")
async def log_health_checkin(user_id: int, log: HealthLogCreate):
    """
    Save or replace today's health check-in for the user.

    This is the data that feeds the burnout prediction model:
    sleep, stress, mood, exercise, energy, social activity.

    The table has a UNIQUE(user_id, date) constraint so calling this
    endpoint twice on the same day just overwrites the earlier entry.
    """
    try:
        checkin_date = log.date or datetime.now().strftime("%Y-%m-%d")
        with _get_db_conn(commit=True) as conn:
            conn.execute(
                """
                INSERT INTO health_logs
                    (user_id, date, sleep_hours, stress_level, mood,
                     study_hours, exercise_minutes, social_activity,
                     energy_level, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, date) DO UPDATE SET
                    sleep_hours      = EXCLUDED.sleep_hours,
                    stress_level     = EXCLUDED.stress_level,
                    mood             = EXCLUDED.mood,
                    study_hours      = EXCLUDED.study_hours,
                    exercise_minutes = EXCLUDED.exercise_minutes,
                    social_activity  = EXCLUDED.social_activity,
                    energy_level     = EXCLUDED.energy_level,
                    notes            = EXCLUDED.notes
                """,
                (
                    user_id, checkin_date,
                    log.sleep_hours, log.stress_level, log.mood,
                    log.study_hours, log.exercise_minutes,
                    log.social_activity, log.energy_level, log.notes,
                ),
            )
        return {
            "success": True,
            "user_id": user_id,
            "date": checkin_date,
            "message": "Health check-in saved. Call /api/v1/burnout/predict/{user_id} to get your burnout score.",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── 2. Get burnout prediction ─────────────────────────────────────────────────

@app.get("/api/v1/burnout/predict/{user_id}")
async def get_burnout_prediction(user_id: int):
    """
    Run the burnout prediction pipeline for a user and return the full result.

    Strategy is auto-selected based on days of health check-in data:
      • < 4 days  → Rule-based  (confidence 35–55%)
      • 4–6 days  → Hybrid      (confidence 55–65%)
      • ≥ 7 days  → ML / SGD    (confidence 65–92%)

    Response includes:
      - financial_score, mental_score, combined_score  (0.0–1.0)
      - alert_level:  good | moderate | high | crisis
      - top_risk_factors: up to 5 human-readable reasons
      - recommendations: up to 6 personalised action items
      - strategy_used, confidence, days_of_data, next_upgrade_in_days
    """
    if burnout_predictor is None:
        raise HTTPException(status_code=503, detail="Burnout Predictor service not available")
    try:
        result = burnout_predictor.predict(user_id=user_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── 3. Get recent burnout history ─────────────────────────────────────────────

@app.get("/api/v1/burnout/history/{user_id}")
async def get_burnout_history(
    user_id: int,
    days: int = Query(30, ge=1, le=90, description="How many past days to return"),
):
    """
    Return a list of past burnout scores stored in the burnout_scores table,
    along with a simple trend summary (improving / worsening).

    Each entry reflects the stored snapshot — not a live re-calculation.
    To record a new snapshot, call /predict and persist from the frontend,
    or use the /checkin endpoint which auto-saves to health_logs.
    """
    try:
        cutoff = (datetime.now().date() - __import__("datetime").timedelta(days=days)).isoformat()
        with _get_db_conn() as conn:
            rows = conn.execute(
                """
                SELECT date, score, alert_level,
                       current_sleep, current_stress, current_exercise
                FROM burnout_scores
                WHERE user_id = ? AND date >= ?
                ORDER BY date ASC
                """,
                (user_id, cutoff),
            ).fetchall()

        history = [dict(r) for r in rows]
        if not history:
            return {
                "user_id": user_id,
                "days_requested": days,
                "history": [],
                "summary": {"message": "No burnout history found. Start logging daily check-ins."},
            }

        scores = [h["score"] for h in history]
        avg_score = round(sum(scores) / len(scores), 1)
        improving = len(scores) >= 2 and scores[-1] < scores[0]

        return {
            "user_id": user_id,
            "days_requested": days,
            "history": history,
            "summary": {
                "entries": len(history),
                "average_score": avg_score,
                "latest_score": scores[-1],
                "improving": improving,
                "worst_day": history[scores.index(max(scores))]["date"],
                "best_day": history[scores.index(min(scores))]["date"],
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── 4. Save a prediction snapshot to burnout_scores ──────────────────────────

@app.post("/api/v1/burnout/save-snapshot/{user_id}")
async def save_burnout_snapshot(user_id: int):
    """
    Run the prediction AND persist the result to the burnout_scores table.

    Call this after a daily check-in so the history endpoint has data to return.
    Combines /predict + DB write in one step for convenience.
    """
    if burnout_predictor is None:
        raise HTTPException(status_code=503, detail="Burnout Predictor service not available")
    try:
        result = burnout_predictor.predict(user_id=user_id)

        today = datetime.now().strftime("%Y-%m-%d")
        fin_details = result.financial_details or {}
        men_details = result.mental_details or {}

        with _get_db_conn(commit=True) as conn:
            conn.execute(
                """
                INSERT INTO burnout_scores
                    (user_id, date, baseline_sleep, baseline_stress, baseline_exercise,
                     current_sleep, current_stress, current_exercise, score, alert_level)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, date) DO UPDATE SET
                    score       = EXCLUDED.score,
                    alert_level = EXCLUDED.alert_level,
                    current_sleep    = EXCLUDED.current_sleep,
                    current_stress   = EXCLUDED.current_stress,
                    current_exercise = EXCLUDED.current_exercise
                """,
                (
                    user_id, today,
                    7.0,   # baseline_sleep (default — not stored separately)
                    5.0,   # baseline_stress
                    30.0,  # baseline_exercise
                    men_details.get("sleep_avg_7d", 0.0),
                    men_details.get("stress_avg_7d", 0.0),
                    0.0,   # current_exercise (not in mental_details directly)
                    round(result.combined_score * 100),   # store as 0-100 int
                    result.alert_level.value,
                ),
            )

        return {
            "success": True,
            "user_id": user_id,
            "date": today,
            "snapshot_saved": True,
            "prediction": result,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── 5. Delete a user's trained ML models (reset) ─────────────────────────────

@app.delete("/api/v1/burnout/models/{user_id}")
async def delete_burnout_models(user_id: int):
    """
    Delete the per-user trained ML model files (.pkl).

    After deletion the system automatically falls back to Rule-Based,
    then rebuilds the model once the user has ≥ 7 days of check-ins again.
    Useful when a user wants to reset their prediction baseline.
    """
    if burnout_predictor is None:
        raise HTTPException(status_code=503, detail="Burnout Predictor service not available")
    try:
        from burnout_prediction.model_store import delete_user_models, resolve_model_dir
        deleted = delete_user_models(resolve_model_dir(), user_id)
        return {
            "success": True,
            "user_id": user_id,
            "models_deleted": deleted,
            "message": "Models deleted. The system will use Rule-Based strategy until 7+ check-ins are available.",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ╔════════════════════════════════════════════════════════════════════════════════╗
# ║                           ERROR HANDLING                                         ║
# ╚════════════════════════════════════════════════════════════════════════════════╝

@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    """Handle HTTP exceptions with standardized format"""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            'success': False,
            'error': exc.detail,
            'status_code': exc.status_code,
            'timestamp': datetime.now().isoformat()
        }
    )

@app.exception_handler(Exception)
async def general_exception_handler(request, exc):
    """Handle general exceptions with standardized format"""
    return JSONResponse(
        status_code=500,
        content={
            'success': False,
            'error': str(exc),
            'status_code': 500,
            'timestamp': datetime.now().isoformat()
        }
    )

# ╔════════════════════════════════════════════════════════════════════════════════╗
# ║                         APPLICATION ENTRY POINT                                  ║
# ╚════════════════════════════════════════════════════════════════════════════════╝

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "0.0.0.0")
    reload = os.getenv("ENV", "development") == "development"

    print("\n" + "=" * 80)
    print("🚀 POKET BOT - FINANCIAL MANAGEMENT API".center(80))
    print("=" * 80)
    print(f"📁 Project Root: {PROJECT_ROOT}")
    print(f"🌐 Host: {host}:{port}")
    print(f"🔄 Auto-reload: {reload}")
    print(f"📚 API Docs: http://{host}:{port}/docs")
    print(f" ReDoc:     http://{host}:{port}/redoc")
    print("\n✅ Features Enabled:")
    print(f"   • Expense Management : {'✓' if expense_initializer else '✗'}")
    print(f"   • Budget Planning    : {'✓' if planner else '✗'}")
    print(f"   • Alert System       : {'✓' if alert_system else '✗'}")
    print(f"   • Trend Analysis     : {'✓' if trend_analyzer else '✗'}")
    print(f"   • Forecasting        : {'✓' if forecaster else '✗'}")
    print(f"   • Personalised Chat  : {'✓' if support_router else '✗'}")
    print(f"   • Burnout Prediction : {'✓' if burnout_predictor else '✗'}")
    if support_router:
        print("\n📡 Support endpoints (prefix: /api/support):")
        support_paths = [
            "POST /chat                    — send message to chatbot",
            "GET  /chat/history/{user_id}  — conversation history",
            "POST /chat/context/{user_id}  — push expense context",
            "GET  /analysis/{user_id}      — analyse user needs",
            "POST /recommendations/{user_id} — personalised tips",
            "GET  /knowledge/search        — search knowledge base",
            "GET  /knowledge/categories    — list categories",
            "POST /peer/connect            — connect with peer",
            "GET  /peer/available          — list available peers",
            "POST /peer/register           — register peer",
            "GET  /peer/{peer_id}/profile  — peer stats",
            "GET  /peer/leaderboard        — top peers",
            "GET  /types                   — support modes",
            "GET  /status                  — system stats",
            "GET  /health                  — health check",
        ]
        for ep in support_paths:
            print(f"     {ep}")
    print("=" * 80 + "\n")

    uvicorn.run(
        "main_api:app",
        host=host,
        port=port,
        reload=reload,
        log_level="info"
    )