"""
Iron Kinetic Reddit Swarm - Database Module
MongoDB connection singleton with collection helpers.
"""

from pymongo import MongoClient
from pymongo.database import Database

from src.config import Config, log

_client: MongoClient = None
_db: Database = None


def get_client() -> MongoClient:
    """Get or create the MongoDB client singleton."""
    global _client
    if _client is None:
        log.info("Connecting to MongoDB...")
        _client = MongoClient(
            Config.MONGODB_URI,
            serverSelectionTimeoutMS=10000,
            connectTimeoutMS=10000,
            maxPoolSize=10,
        )
        # Force connection test
        _client.admin.command("ping")
        log.info("MongoDB connection established.")
    return _client


def get_db() -> Database:
    """Get the application database reference."""
    global _db
    if _db is None:
        client = get_client()
        _db = client[Config.DB_NAME]
    return _db


def get_collection(name: str):
    """Get a collection by name from the application database."""
    return get_db()[name]


def get_definitions_collection():
    """Get the swarm_agent_definitions collection."""
    return get_collection(Config.COLLECTION_DEFINITIONS)


def get_instances_collection():
    """Get the swarm_agent_instances collection."""
    return get_collection(Config.COLLECTION_INSTANCES)


def get_content_collection():
    """Get the swarm_generated_content collection."""
    return get_collection(Config.COLLECTION_CONTENT)


def get_knowledge_collection():
    """Get the swarm_knowledge_base collection."""
    return get_collection(Config.COLLECTION_KNOWLEDGE)


def close_connection():
    """Close the MongoDB connection."""
    global _client, _db
    if _client is not None:
        _client.close()
        log.info("MongoDB connection closed.")
        _client = None
        _db = None
