"""
Storage layer for conversations and peer support data.

ConversationStorage now persists messages to the SQLite chat_history table
so history survives server restarts. All other storage classes remain
in-memory (peer/analytics are session-scoped by design).
"""

import json
import logging
from typing import Optional, List, Dict, Any
from datetime import datetime

try:
    from db_postgres import get_db_cursor
except ImportError:
    from ..db_postgres import get_db_cursor

logger = logging.getLogger(__name__)


class ConversationStorage:
    """
    Persist conversation messages to the PostgreSQL chat_history table.
    Falls back to in-memory storage if the DB is unavailable.
    """

    def __init__(self):
        # In-memory fallback / metadata store
        self._meta: Dict[str, Dict] = {}

    # ------------------------------------------------------------------
    # Messages
    # ------------------------------------------------------------------

    def save_message(
        self,
        user_id: str,
        role: str,
        content: str,
        message_type: str
    ) -> None:
        """Persist one chat turn to chat_history. User turn and assistant
        turn are each stored as separate rows."""
        try:
            uid = int(user_id) if str(user_id).isdigit() else 0
            with get_db_cursor(commit=True) as cur:
                cur.execute(
                    """
                    INSERT INTO chat_history
                        (user_id, date, user_message, ai_response, context)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (
                        uid,
                        datetime.now().strftime("%Y-%m-%d"),
                        content if role == "user"      else "",
                        content if role == "assistant" else "",
                        json.dumps({"role": role, "message_type": message_type}),
                    )
                )
        except Exception as e:
            logger.warning(f"chat_history DB write failed (non-fatal): {e}")

    def get_conversation(
        self,
        user_id: str,
        limit: Optional[int] = None
    ) -> List[Dict]:
        """Retrieve conversation history from DB (newest-last order)."""
        try:
            uid = int(user_id) if str(user_id).isdigit() else 0
            query = (
                "SELECT user_message, ai_response, context, created_at"
                " FROM chat_history WHERE user_id=%s"
                " ORDER BY created_at ASC"
            )
            params: tuple = (uid,)
            if limit:
                query = (
                    "SELECT user_message, ai_response, context, created_at"
                    " FROM (SELECT * FROM chat_history WHERE user_id=%s"
                    "        ORDER BY created_at DESC LIMIT %s) sub"
                    " ORDER BY created_at ASC"
                )
                params = (uid, limit)

            with get_db_cursor() as cur:
                cur.execute(query, params)
                rows = cur.fetchall()

            messages = []
            for row in rows:
                ctx = json.loads(row["context"] or "{}")
                role = ctx.get("role", "user")
                content = row["user_message"] if role == "user" else row["ai_response"]
                if content:
                    messages.append({
                        "role": role,
                        "content": content,
                        "message_type": ctx.get("message_type", role),
                        "timestamp": str(row["created_at"]),
                    })
            return messages
        except Exception as e:
            logger.warning(f"chat_history DB read failed: {e}")
            return []

    def clear_conversation(self, user_id: str) -> None:
        """Delete all chat history for a user from the DB."""
        try:
            uid = int(user_id) if str(user_id).isdigit() else 0
            with get_db_cursor(commit=True) as cur:
                cur.execute("DELETE FROM chat_history WHERE user_id=%s", (uid,))
        except Exception as e:
            logger.warning(f"chat_history DB clear failed: {e}")
        self._meta.pop(user_id, None)

    # ------------------------------------------------------------------
    # Metadata (kept in-memory — lightweight)
    # ------------------------------------------------------------------

    def save_metadata(self, user_id: str, metadata: Dict[str, Any]) -> None:
        if user_id not in self._meta:
            self._meta[user_id] = {}
        self._meta[user_id].update({
            **metadata,
            "updated_at": datetime.now().isoformat()
        })

    def get_metadata(self, user_id: str) -> Optional[Dict]:
        return self._meta.get(user_id)


class PeerSupportStorage:
    """Store peer support connections and interactions"""

    def __init__(self):
        """Initialize peer storage"""
        self.peers: Dict[str, Dict] = {}
        self.connections: Dict[str, Dict] = {}
        self.reviews: Dict[str, List[Dict]] = {}

    def save_peer(
        self,
        peer_id: str,
        profile: Dict[str, Any]
    ) -> None:
        """Save peer profile"""
        self.peers[peer_id] = {
            **profile,
            "created_at": datetime.now().isoformat() if "created_at" not in profile else profile["created_at"],
            "updated_at": datetime.now().isoformat()
        }
        logger.info(f"Saved peer profile: {peer_id}")

    def get_peer(self, peer_id: str) -> Optional[Dict]:
        """Get peer profile"""
        return self.peers.get(peer_id)

    def save_connection(
        self,
        connection_id: str,
        connection_data: Dict[str, Any]
    ) -> None:
        """Save peer support connection"""
        self.connections[connection_id] = {
            **connection_data,
            "created_at": datetime.now().isoformat() if "created_at" not in connection_data else connection_data["created_at"],
            "updated_at": datetime.now().isoformat()
        }
        logger.info(f"Saved connection: {connection_id}")

    def get_connection(self, connection_id: str) -> Optional[Dict]:
        """Get connection details"""
        return self.connections.get(connection_id)

    def save_review(
        self,
        connection_id: str,
        peer_id: str,
        user_id: str,
        rating: float,
        feedback: Optional[str] = None
    ) -> None:
        """Save peer review"""
        if peer_id not in self.reviews:
            self.reviews[peer_id] = []

        review = {
            "connection_id": connection_id,
            "user_id": user_id,
            "rating": rating,
            "feedback": feedback,
            "created_at": datetime.now().isoformat()
        }

        self.reviews[peer_id].append(review)
        logger.info(f"Saved review for peer {peer_id}")

    def get_peer_reviews(self, peer_id: str) -> List[Dict]:
        """Get reviews for a peer"""
        return self.reviews.get(peer_id, [])

    def get_average_rating(self, peer_id: str) -> Optional[float]:
        """Get average rating for a peer"""
        reviews = self.reviews.get(peer_id, [])
        if not reviews:
            return None

        ratings = [r["rating"] for r in reviews]
        return sum(ratings) / len(ratings)


class KnowledgeBaseStorage:
    """Store rule-based knowledge base"""

    def __init__(self):
        """Initialize knowledge base"""
        self.articles: Dict[str, Dict] = {}
        self.categories: Dict[str, List[str]] = {}

    def add_article(
        self,
        article_id: str,
        category: str,
        title: str,
        content: str,
        tags: Optional[List[str]] = None
    ) -> None:
        """Add article to knowledge base"""
        self.articles[article_id] = {
            "category": category,
            "title": title,
            "content": content,
            "tags": tags or [],
            "created_at": datetime.now().isoformat()
        }

        if category not in self.categories:
            self.categories[category] = []

        if article_id not in self.categories[category]:
            self.categories[category].append(article_id)

        logger.info(f"Added article: {article_id}")

    def get_article(self, article_id: str) -> Optional[Dict]:
        """Get article by ID"""
        return self.articles.get(article_id)

    def search_articles(self, query: str) -> List[Dict]:
        """Search articles"""
        results = []

        for article_id, article in self.articles.items():
            if (query.lower() in article["title"].lower() or
                query.lower() in article["content"].lower() or
                any(query.lower() in tag.lower() for tag in article.get("tags", []))):
                results.append({**article, "id": article_id})

        return results

    def get_category_articles(self, category: str) -> List[Dict]:
        """Get all articles in a category"""
        article_ids = self.categories.get(category, [])
        return [
            {**self.articles[aid], "id": aid}
            for aid in article_ids
            if aid in self.articles
        ]


class AnalyticsStorage:
    """Store analytics and metrics"""

    def __init__(self):
        """Initialize analytics"""
        self.events: List[Dict] = []
        self.metrics: Dict[str, Any] = {}

    def log_event(
        self,
        event_type: str,
        user_id: Optional[str] = None,
        metadata: Optional[Dict] = None
    ) -> None:
        """Log an event"""
        event = {
            "event_type": event_type,
            "user_id": user_id,
            "metadata": metadata or {},
            "timestamp": datetime.now().isoformat()
        }
        self.events.append(event)
        logger.info(f"Logged event: {event_type}")

    def get_events(
        self,
        event_type: Optional[str] = None,
        user_id: Optional[str] = None,
        limit: int = 100
    ) -> List[Dict]:
        """Get events with optional filtering"""
        filtered = self.events

        if event_type:
            filtered = [e for e in filtered if e["event_type"] == event_type]

        if user_id:
            filtered = [e for e in filtered if e["user_id"] == user_id]

        return filtered[-limit:]

    def update_metric(self, metric_name: str, value: Any) -> None:
        """Update a metric"""
        self.metrics[metric_name] = {
            "value": value,
            "updated_at": datetime.now().isoformat()
        }

    def get_metric(self, metric_name: str) -> Any:
        """Get a metric value"""
        metric = self.metrics.get(metric_name, {})
        return metric.get("value")

    def get_all_metrics(self) -> Dict[str, Any]:
        """Get all metrics"""
        return {
            name: data.get("value")
            for name, data in self.metrics.items()
        }
