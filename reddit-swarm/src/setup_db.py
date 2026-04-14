"""
Iron Kinetic Reddit Swarm - Database Setup
Creates all 4 collections with validators and indexes.

Usage: python -m src.setup_db
"""

from src.config import Config, log
from src.db import get_db, close_connection


def create_collections():
    """Create all 4 collections with JSON schema validators."""
    db = get_db()

    # Get existing collection names
    existing = set(db.list_collection_names())

    # 1. swarm_agent_definitions
    if Config.COLLECTION_DEFINITIONS not in existing:
        db.command("create", Config.COLLECTION_DEFINITIONS, validator={
            "$jsonSchema": {
                "bsonType": "object",
                "required": ["agentType", "feature", "lingua", "subredditTarget", "dnaRulesOverride"],
                "properties": {
                    "agentType": {"bsonType": "string"},
                    "feature": {
                        "enum": ["referral", "predictive_curve", "meal_plan", "check_in", "subscription", "generic_progress"]
                    },
                    "lingua": {"enum": ["it", "en"]},
                    "subredditTarget": {"bsonType": "string"},
                    "utenteTipo": {"enum": ["beginner", "intermediate", "experienced"]},
                    "angolo": {"enum": ["A", "B", "C"]},
                    "tonoPreferito": {"enum": ["motivazionale", "pratico", "sorpreso", "riflessivo"]},
                    "dnaRulesOverride": {
                        "bsonType": "object",
                        "required": ["strutturaPost", "vietaNelTitolo", "frasiObbligatorie"],
                        "properties": {
                            "strutturaPost": {"bsonType": "object"},
                            "vietaNelTitolo": {"bsonType": "array"},
                            "frasiObbligatorie": {"bsonType": "array"}
                        }
                    },
                    "pesiSelezione": {"bsonType": "object"}
                }
            }
        })
        log.info("Created collection: %s", Config.COLLECTION_DEFINITIONS)
    else:
        log.info("Collection already exists: %s", Config.COLLECTION_DEFINITIONS)

    # 2. swarm_agent_instances
    if Config.COLLECTION_INSTANCES not in existing:
        db.command("create", Config.COLLECTION_INSTANCES, validator={
            "$jsonSchema": {
                "bsonType": "object",
                "required": ["agentDefinitionId", "instanceId", "stato", "configurazioneCorrente"],
                "properties": {
                    "agentDefinitionId": {"bsonType": "string"},
                    "instanceId": {"bsonType": "string"},
                    "stato": {
                        "enum": ["idle", "generando", "in_pubblicazione", "in_attesa_feedback", "errore"]
                    },
                    "configurazioneCorrente": {"bsonType": "object"},
                    "ultimoUtilizzo": {"bsonType": ["date", "null"]},
                    "metriche": {"bsonType": "object"}
                }
            }
        })
        log.info("Created collection: %s", Config.COLLECTION_INSTANCES)
    else:
        log.info("Collection already exists: %s", Config.COLLECTION_INSTANCES)

    # 3. swarm_generated_content - with k-anonymity enforcement
    if Config.COLLECTION_CONTENT not in existing:
        db.command("create", Config.COLLECTION_CONTENT, validator={
            "$jsonSchema": {
                "bsonType": "object",
                "required": ["agentInstanceId", "titolo", "corpo", "stato", "datiContestoUsati"],
                "properties": {
                    "agentInstanceId": {"bsonType": "string"},
                    "titolo": {"bsonType": "string"},
                    "corpo": {"bsonType": "string"},
                    "stato": {
                        "enum": ["draft", "pubblicato", "fallito", "ritirato"]
                    },
                    "datiContestoUsati": {
                        "bsonType": "object",
                        "required": ["livelliAnonimizzazione"],
                        "properties": {
                            "livelliAnonimizzazione": {
                                "bsonType": "object",
                                "required": ["kAnonimo"],
                                "properties": {
                                    "kAnonimo": {
                                        "bsonType": "int",
                                        "minimum": 5
                                    },
                                    "deltaDivulga": {
                                        "bsonType": "double",
                                        "minimum": 0,
                                        "maximum": 1
                                    }
                                }
                            }
                        }
                    },
                    "timestampPubblicazione": {"bsonType": ["date", "null"]},
                    "qualitaScore": {"bsonType": ["double", "null"]},
                    "feedback": {"bsonType": "object"}
                }
            }
        })
        log.info("Created collection: %s", Config.COLLECTION_CONTENT)
    else:
        log.info("Collection already exists: %s", Config.COLLECTION_CONTENT)

    # 4. swarm_knowledge_base
    if Config.COLLECTION_KNOWLEDGE not in existing:
        db.command("create", Config.COLLECTION_KNOWLEDGE, validator={
            "$jsonSchema": {
                "bsonType": "object",
                "required": ["tipoLezione", "featureRiferimento", "lingua", "contenuto", "fiducia"],
                "properties": {
                    "tipoLezione": {
                        "enum": ["titolo_efficace", "frase_autentica", "errore_comune", "template_variation"]
                    },
                    "featureRiferimento": {"bsonType": "string"},
                    "lingua": {"enum": ["it", "en"]},
                    "contenuto": {"bsonType": "string"},
                    "fiducia": {
                        "bsonType": "double",
                        "minimum": 0,
                        "maximum": 1
                    },
                    "tag": {"bsonType": "array"},
                    "postOrigine": {"bsonType": "string"},
                    "dataCreazione": {"bsonType": "date"}
                }
            }
        })
        log.info("Created collection: %s", Config.COLLECTION_KNOWLEDGE)
    else:
        log.info("Collection already exists: %s", Config.COLLECTION_KNOWLEDGE)


def create_indexes():
    """Create indexes on all collections."""
    db = get_db()

    # swarm_agent_definitions indexes
    coll_defs = db[Config.COLLECTION_DEFINITIONS]
    coll_defs.create_index([("feature", 1), ("lingua", 1), ("subredditTarget", 1)])
    log.info("Created index on %s: {feature, lingua, subredditTarget}", Config.COLLECTION_DEFINITIONS)

    # swarm_agent_instances indexes
    coll_inst = db[Config.COLLECTION_INSTANCES]
    coll_inst.create_index([("stato", 1), ("ultimoUtilizzo", -1)])
    log.info("Created index on %s: {stato, ultimoUtilizzo}", Config.COLLECTION_INSTANCES)

    # swarm_generated_content indexes
    coll_content = db[Config.COLLECTION_CONTENT]
    coll_content.create_index([("stato", 1), ("timestampPubblicazione", -1)])
    log.info("Created index on %s: {stato, timestampPubblicazione}", Config.COLLECTION_CONTENT)

    # swarm_knowledge_base indexes
    coll_kb = db[Config.COLLECTION_KNOWLEDGE]
    coll_kb.create_index([("fiducia", -1)])
    coll_kb.create_index([("tag", 1)])
    log.info("Created indexes on %s: {fiducia}, {tag}", Config.COLLECTION_KNOWLEDGE)


def setup_all():
    """Create all collections and indexes."""
    log.info("Starting database setup...")
    create_collections()
    create_indexes()
    log.info("Database setup complete.")


if __name__ == "__main__":
    try:
        setup_all()
    finally:
        close_connection()
