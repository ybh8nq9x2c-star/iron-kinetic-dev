"""
Iron Kinetic Reddit Swarm - Seed Profiles
Inserts exactly 30 distinct agent profiles into swarm_agent_definitions.

Usage: python seed/seed_profiles.py
"""

import sys
import os

# Ensure project root is on path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.config import Config, log
from src.db import get_client, get_collection, close_connection


# Subreddits by language
SUBREDDITS_EN = ["r/loseit", "r/progresspics", "r/fitness", "r/nutrition", "r/BodyweightFitness"]
SUBREDDITS_IT = ["r/italy", "r/progresspics", "r/fitness"]


def _build_profile(
    nn: str,
    feature: str,
    lingua: str,
    utente_tipo: str,
    angolo: str,
    tono: str,
    subreddit: str,
) -> dict:
    """Build a single agent profile document.

    Args:
        nn: Two-digit sequence number.
        feature: Feature type.
        lingua: Language code.
        utente_tipo: User type.
        angolo: Angle (A/B/C).
        tono: Preferred tone.
        subreddit: Target subreddit.

    Returns:
        Agent definition document dict.
    """
    agent_type = f"{feature}_{lingua}_{utente_tipo}_{angolo}_{tono}_{subreddit.replace('/', '')}_{nn}"

    # DNA rules vary by feature and language
    vieta_nel_titolo = ["iron kinetic", "app"]

    frasi_obbligatorie = _get_frasi_obbligatorie(feature, lingua)
    struttura_post = _get_struttura_post(feature, lingua)

    return {
        "agentType": agent_type,
        "feature": feature,
        "lingua": lingua,
        "subredditTarget": subreddit,
        "utenteTipo": utente_tipo,
        "angolo": angolo,
        "tonoPreferito": tono,
        "dnaRulesOverride": {
            "strutturaPost": struttura_post,
            "vietaNelTitolo": vieta_nel_titolo,
            "frasiObbligatorie": frasi_obbligatorie,
        },
        "pesiSelezione": {
            "performanceScore": 0.4,
            "freshnessScore": 0.3,
            "angoloBalance": angolo,
        },
    }


def _get_frasi_obbligatorie(feature: str, lingua: str) -> list:
    """Get mandatory phrases based on feature and language."""
    phrases = {
        ("referral", "it"): [
            "Ha fatto la differenza per me",
            "Se interessa vi racconto",
            "Non mi aspetto che funzioni per tutti",
        ],
        ("referral", "en"): [
            "It made a real difference for me",
            "If anyone's curious I can share more",
            "Your mileage may vary",
        ],
        ("predictive_curve", "it"): [
            "I progressi non sono lineari",
            "Ci sono settimane migliori e altre peggiori",
            "La tendenza generale è positiva",
        ],
        ("predictive_curve", "en"): [
            "Progress isn't linear",
            "Some weeks are better than others",
            "The overall trend is positive",
        ],
        ("meal_plan", "it"): [
            "Pianificare i pasti mi ha salvato",
            "Non è una dieta, è un approccio",
            "Mangiare bene non deve essere complicato",
        ],
        ("meal_plan", "en"): [
            "Meal planning saved me",
            "It's not a diet, it's an approach",
            "Eating well doesn't have to be complicated",
        ],
        ("check_in", "it"): [
            "Fare il punto regolarmente aiuta",
            "Piccoli passi portano lontano",
            "Non mi fermo più al primo ostacolo",
        ],
        ("check_in", "en"): [
            "Regular check-ins help a lot",
            "Small steps add up",
            "I don't stop at the first obstacle anymore",
        ],
        ("subscription", "it"): [
            "Investire in se stessi è la cosa migliore",
            "Valuto sempre il rapporto qualità-prezzo",
            "Non mi pento di averci provato",
        ],
        ("subscription", "en"): [
            "Investing in yourself is worth it",
            "I always evaluate the value proposition",
            "No regrets about trying it out",
        ],
        ("generic_progress", "it"): [
            "Un passo alla volta",
            "Non è stato facile ma ne è valsa la pena",
        ],
        ("generic_progress", "en"): [
            "One step at a time",
            "It wasn't easy but it was worth it",
        ],
    }
    return phrases.get((feature, lingua), ["Autenticità sopra tutto"])


def _get_struttura_post(feature: str, lingua: str) -> dict:
    """Get post structure template based on feature and language."""
    if lingua == "it":
        titolo = f"[placeholder] - {feature.replace('_', ' ')} (angolo variabile)"
        corpo = (
            "Paragrafo 1: Contesto personale (chi sono, perché ho iniziato). "
            "Paragrafo 2: Cosa ho fatto di concreto. "
            "Paragrafo 3: Risultati ottenuti con dati aggregati. "
            "Paragrafo 4: Considerazioni finali."
        )
    else:
        titolo = f"[placeholder] - {feature.replace('_', ' ')} (variable angle)"
        corpo = (
            "Paragraph 1: Personal context (who I am, why I started). "
            "Paragraph 2: What I actually did. "
            "Paragraph 3: Results with aggregate data. "
            "Paragraph 4: Final thoughts."
        )
    return {"titolo": titolo, "corpo": corpo}


def _generate_all_profiles() -> list:
    """Generate all 30 agent profile documents.

    Distribution:
        8 referral (4 it, 4 en)
        6 predictive_curve (3 it, 3 en)
        5 meal_plan (3 it, 2 en)
        5 check_in (3 it, 2 en)
        4 subscription (2 it, 2 en)
        2 generic_progress (1 it, 1 en)

    Returns:
        List of 30 profile dicts.
    """
    profiles = []
    nn_counter = 0

    def next_nn():
        nonlocal nn_counter
        nn_counter += 1
        return f"{nn_counter:02d}"

    # --- 8 referral profiles (4 it, 4 en) ---
    referral_configs = [
        # (lingua, utente_tipo, angolo, tono, subreddit)
        ("it", "beginner", "A", "motivazionale", "r/italy"),
        ("it", "intermediate", "B", "pratico", "r/progresspics"),
        ("it", "experienced", "C", "sorpreso", "r/fitness"),
        ("it", "intermediate", "A", "riflessivo", "r/italy"),
        ("en", "beginner", "A", "motivazionale", "r/loseit"),
        ("en", "intermediate", "B", "pratico", "r/progresspics"),
        ("en", "experienced", "C", "sorpreso", "r/nutrition"),
        ("en", "beginner", "B", "riflessivo", "r/fitness"),
    ]
    for lingua, utente_tipo, angolo, tono, subreddit in referral_configs:
        profiles.append(_build_profile(
            next_nn(), "referral", lingua, utente_tipo, angolo, tono, subreddit
        ))

    # --- 6 predictive_curve profiles (3 it, 3 en) ---
    predictive_configs = [
        ("it", "beginner", "A", "motivazionale", "r/progresspics"),
        ("it", "intermediate", "B", "pratico", "r/fitness"),
        ("it", "experienced", "C", "riflessivo", "r/italy"),
        ("en", "beginner", "A", "motivazionale", "r/loseit"),
        ("en", "intermediate", "B", "pratico", "r/BodyweightFitness"),
        ("en", "experienced", "C", "sorpreso", "r/progresspics"),
    ]
    for lingua, utente_tipo, angolo, tono, subreddit in predictive_configs:
        profiles.append(_build_profile(
            next_nn(), "predictive_curve", lingua, utente_tipo, angolo, tono, subreddit
        ))

    # --- 5 meal_plan profiles (3 it, 2 en) ---
    meal_plan_configs = [
        ("it", "beginner", "A", "pratico", "r/fitness"),
        ("it", "intermediate", "B", "motivazionale", "r/italy"),
        ("it", "experienced", "C", "riflessivo", "r/progresspics"),
        ("en", "beginner", "A", "pratico", "r/nutrition"),
        ("en", "intermediate", "B", "motivazionale", "r/loseit"),
    ]
    for lingua, utente_tipo, angolo, tono, subreddit in meal_plan_configs:
        profiles.append(_build_profile(
            next_nn(), "meal_plan", lingua, utente_tipo, angolo, tono, subreddit
        ))

    # --- 5 check_in profiles (3 it, 2 en) ---
    check_in_configs = [
        ("it", "beginner", "A", "motivazionale", "r/italy"),
        ("it", "intermediate", "B", "pratico", "r/fitness"),
        ("it", "experienced", "C", "sorpreso", "r/progresspics"),
        ("en", "beginner", "A", "pratico", "r/loseit"),
        ("en", "intermediate", "B", "riflessivo", "r/fitness"),
    ]
    for lingua, utente_tipo, angolo, tono, subreddit in check_in_configs:
        profiles.append(_build_profile(
            next_nn(), "check_in", lingua, utente_tipo, angolo, tono, subreddit
        ))

    # --- 4 subscription profiles (2 it, 2 en) ---
    subscription_configs = [
        ("it", "intermediate", "A", "pratico", "r/fitness"),
        ("it", "experienced", "B", "riflessivo", "r/italy"),
        ("en", "beginner", "A", "motivazionale", "r/loseit"),
        ("en", "intermediate", "C", "pratico", "r/nutrition"),
    ]
    for lingua, utente_tipo, angolo, tono, subreddit in subscription_configs:
        profiles.append(_build_profile(
            next_nn(), "subscription", lingua, utente_tipo, angolo, tono, subreddit
        ))

    # --- 2 generic_progress profiles (1 it, 1 en) ---
    generic_configs = [
        ("it", "intermediate", "A", "motivazionale", "r/progresspics"),
        ("en", "beginner", "B", "pratico", "r/progresspics"),
    ]
    for lingua, utente_tipo, angolo, tono, subreddit in generic_configs:
        profiles.append(_build_profile(
            next_nn(), "generic_progress", lingua, utente_tipo, angolo, tono, subreddit
        ))

    return profiles


def seed_all_profiles() -> dict:
    """Insert all 30 profiles into the database.

    Returns:
        Summary dict with count and details.
    """
    coll = get_collection(Config.COLLECTION_DEFINITIONS)
    profiles = _generate_all_profiles()

    # Clear existing profiles
    deleted = coll.delete_many({})
    if deleted.deleted_count > 0:
        log.info("Cleared %d existing profiles.", deleted.deleted_count)

    # Insert all profiles
    result = coll.insert_many(profiles)
    inserted = len(result.inserted_ids)

    log.info("Seeded %d agent profiles.", inserted)

    # Summary by feature
    feature_counts = {}
    for p in profiles:
        feat = p["feature"]
        feature_counts[feat] = feature_counts.get(feat, 0) + 1

    log.info("Distribution: %s", feature_counts)

    return {
        "total_inserted": inserted,
        "distribution": feature_counts,
    }


if __name__ == "__main__":
    try:
        summary = seed_all_profiles()
        print(f"Seeded {summary['total_inserted']} profiles.")
        print(f"Distribution: {summary['distribution']}")
    finally:
        close_connection()
