"""
Iron Kinetic Reddit Swarm - Configuration Module
Loads environment variables and sets up logging.
"""

import os
import logging
from pathlib import Path

from dotenv import load_dotenv

# Load .env from project root
_project_root = Path(__file__).resolve().parent.parent
load_dotenv(_project_root / ".env")


class Config:
    """Central configuration loaded from environment variables."""

    MONGODB_URI: str = os.getenv("MONGODB_URI", "mongodb://localhost:27017/iron_kinetic_swarm")
    ZAI_API_KEY: str = os.getenv("ZAI_API_KEY", "")
    ZAI_BASE_URL: str = os.getenv("ZAI_BASE_URL", "https://api.z.ai/api/v1")
    ZAI_MODEL: str = os.getenv("ZAI_MODEL", "GLM-5.1")
    POSTS_PER_DAY: int = int(os.getenv("POSTS_PER_DAY", "14"))
    QUALITY_THRESHOLD: float = float(os.getenv("QUALITY_THRESHOLD", "0.7"))
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "info").upper()

    DB_NAME: str = "iron_kinetic_swarm"

    # Collection names
    COLLECTION_DEFINITIONS: str = "swarm_agent_definitions"
    COLLECTION_INSTANCES: str = "swarm_agent_instances"
    COLLECTION_CONTENT: str = "swarm_generated_content"
    COLLECTION_KNOWLEDGE: str = "swarm_knowledge_base"

    # Retry settings
    LLM_MAX_RETRIES: int = 3
    LLM_RETRY_BASE_DELAY: float = 1.0

    # Privacy settings
    K_ANONYMITY_MIN: int = 5

    @classmethod
    def reload(cls):
        """Reload configuration from environment."""
        load_dotenv(_project_root / ".env", override=True)
        cls.MONGODB_URI = os.getenv("MONGODB_URI", cls.MONGODB_URI)
        cls.ZAI_API_KEY = os.getenv("ZAI_API_KEY", cls.ZAI_API_KEY)
        cls.ZAI_BASE_URL = os.getenv("ZAI_BASE_URL", cls.ZAI_BASE_URL)
        cls.ZAI_MODEL = os.getenv("ZAI_MODEL", cls.ZAI_MODEL)
        cls.POSTS_PER_DAY = int(os.getenv("POSTS_PER_DAY", str(cls.POSTS_PER_DAY)))
        cls.QUALITY_THRESHOLD = float(os.getenv("QUALITY_THRESHOLD", str(cls.QUALITY_THRESHOLD)))
        cls.LOG_LEVEL = os.getenv("LOG_LEVEL", cls.LOG_LEVEL).upper()


def setup_logger(name: str = "swarm") -> logging.Logger:
    """Create and configure a logger instance."""
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler()
        fmt = logging.Formatter(
            "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
        handler.setFormatter(fmt)
        logger.addHandler(handler)
    logger.setLevel(getattr(logging, Config.LOG_LEVEL, logging.INFO))
    return logger


log = setup_logger("swarm")
