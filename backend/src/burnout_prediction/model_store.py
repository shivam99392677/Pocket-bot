"""
Model Store
Centralises model directory resolution and provides a clean
interface for saving/loading per-user model state.
Keeps file-system concerns out of the strategy classes.
"""

import os
import logging
from pathlib import Path

log = logging.getLogger(__name__)


def resolve_model_dir() -> str:
    """
    Finds or creates the models/ directory relative to this file.
    Uses /tmp/models when running in Vercel serverless environment.
    """
    if os.getenv("VERCEL"):
        model_dir = Path("/tmp/models")
    else:
        here = Path(__file__).resolve().parent
        model_dir = here / "models"
    model_dir.mkdir(parents=True, exist_ok=True)
    return str(model_dir)


def delete_user_models(model_dir: str, user_id: int) -> bool:
    """
    Remove a user's model files (e.g. if user resets their account).
    Returns True if files were deleted, False if they didn't exist.
    """
    deleted = False
    for kind in ("financial", "mental", "refit_stamp"):
        path = os.path.join(model_dir, f"{user_id}_{kind}.pkl")
        if os.path.exists(path):
            os.remove(path)
            deleted = True
            log.info(f"Deleted model file: {path}")
    return deleted


def list_trained_users(model_dir: str):
    """Return list of user IDs that have trained ML models."""
    if not os.path.isdir(model_dir):
        return []
    files = os.listdir(model_dir)
    user_ids = set()
    for f in files:
        if f.endswith("_financial.pkl"):
            try:
                uid = int(f.replace("_financial.pkl", ""))
                user_ids.add(uid)
            except ValueError:
                pass
    return sorted(user_ids)
