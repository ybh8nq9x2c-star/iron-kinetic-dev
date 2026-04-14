"""
Iron Kinetic Reddit Swarm - Pipeline Runner
High-level pipeline for generating, reviewing, and storing posts.
"""

from datetime import datetime, timezone

from pymongo import MongoClient

from src.config import Config, log
from src.db import get_client, get_collection, close_connection
from src.swarm_agent import IronKineticRedditAgent
from src.swarm_coordinator import SwarmCoordinator
from src.quality_reviewer import QualityReviewer


def run_one() -> dict:
    """Pick next pending job, run full pipeline.

    Returns:
        Result dict with status and post info.
    """
    client = get_client()
    content_coll = get_collection(Config.COLLECTION_CONTENT)

    # Find oldest draft job
    job = content_coll.find_one(
        {"stato": "draft", "titolo": ""},
        sort=[("created_at", 1)],
    )

    if job is None:
        log.info("No pending jobs found.")
        return {"status": "no_jobs", "message": "No pending jobs"}

    agent_instance_id = job.get("agentInstanceId")
    context_data = job.get("datiContestoUsati", {})
    user_data = context_data.get("userData", {})
    subreddit = context_data.get("subreddit", "")

    log.info(
        "Running job %s: agent=%s subreddit=%s",
        job.get("jobId"), agent_instance_id, subreddit,
    )

    # Generate post via agent
    agent = IronKineticRedditAgent(agent_instance_id, client)
    agent.load_configuration()

    context = {
        "utente_tipo": user_data.get("utente_tipo", "intermediate"),
        "lingua": user_data.get("lingua", "en"),
        "subreddit": subreddit,
        "angolo_preferito": user_data.get("angolo_preferito"),
        **user_data,
    }

    result = agent.generate_post(context)

    if result.get("status") == "error":
        # Update job as failed
        content_coll.update_one(
            {"_id": job["_id"]},
            {"$set": {
                "stato": "fallito",
                "feedback.error": result.get("metadata", {}).get("error", "Unknown"),
            }},
        )
        return {"status": "error", "job_id": job.get("jobId")}

    titolo = result.get("titolo", "")
    corpo = result.get("corpo", "")

    # Quality review
    reviewer = QualityReviewer()
    review_result = reviewer.review({"titolo": titolo, "corpo": corpo})

    score = review_result.get("score", 0.0)
    approved = review_result.get("approved", False)
    notes = review_result.get("notes", [])

    # Update content document
    new_stato = "pubblicato" if approved else "draft"
    content_coll.update_one(
        {"_id": job["_id"]},
        {"$set": {
            "titolo": titolo,
            "corpo": corpo,
            "stato": new_stato,
            "qualitaScore": score,
            "feedback.review": review_result,
            "datiContestoUsati.privacy": result.get("metadata", {}).get("privacy", {}),
            "timestampPubblicazione": datetime.now(timezone.utc) if approved else None,
        }},
    )

    log.info(
        "Job %s complete: score=%.2f approved=%s",
        job.get("jobId"), score, approved,
    )

    return {
        "status": "approved" if approved else "review_needed",
        "job_id": job.get("jobId"),
        "score": score,
        "notes": notes,
        "titolo": titolo,
    }


def run_batch(count: int = 5) -> list:
    """Run N posts sequentially.

    Args:
        count: Number of posts to process.

    Returns:
        List of result dicts.
    """
    results = []
    log.info("Starting batch of %d posts...", count)

    for i in range(count):
        log.info("--- Batch post %d/%d ---", i + 1, count)
        result = run_one()
        results.append(result)

        if result.get("status") == "no_jobs":
            log.info("No more jobs available, stopping batch.")
            break

    approved_count = sum(1 for r in results if r.get("status") == "approved")
    log.info(
        "Batch complete: %d/%d approved",
        approved_count, len(results),
    )

    return results


def run_daily() -> dict:
    """Create and process daily batch.

    Creates POSTS_PER_DAY jobs across features and languages,
    then processes them through the pipeline.

    Returns:
        Summary dict.
    """
    client = get_client()
    coordinator = SwarmCoordinator(client)

    posts_per_day = Config.POSTS_PER_DAY
    log.info("Starting daily pipeline: %d posts", posts_per_day)

    # Define distribution of posts
    distribution = [
        {"feature": "referral", "lingua": "en", "weight": 0.2},
        {"feature": "referral", "lingua": "it", "weight": 0.15},
        {"feature": "predictive_curve", "lingua": "en", "weight": 0.15},
        {"feature": "predictive_curve", "lingua": "it", "weight": 0.1},
        {"feature": "meal_plan", "lingua": "en", "weight": 0.1},
        {"feature": "meal_plan", "lingua": "it", "weight": 0.08},
        {"feature": "check_in", "lingua": "en", "weight": 0.07},
        {"feature": "check_in", "lingua": "it", "weight": 0.05},
        {"feature": "subscription", "lingua": "en", "weight": 0.05},
        {"feature": "subscription", "lingua": "it", "weight": 0.03},
        {"feature": "generic_progress", "lingua": "en", "weight": 0.01},
        {"feature": "generic_progress", "lingua": "it", "weight": 0.01},
    ]

    subreddits_en = ["r/loseit", "r/progresspics", "r/fitness", "r/nutrition", "r/BodyweightFitness"]
    subreddits_it = ["r/italy", "r/progresspics", "r/fitness"]

    import random

    jobs_created = 0
    for _ in range(posts_per_day):
        # Weighted random selection
        r = random.random()
        cumulative = 0.0
        selected = distribution[0]
        for d in distribution:
            cumulative += d["weight"]
            if r <= cumulative:
                selected = d
                break

        feature = selected["feature"]
        lingua = selected["lingua"]
        subs = subreddits_en if lingua == "en" else subreddits_it
        subreddit = random.choice(subs)

        user_data = {
            "utente_tipo": random.choice(["beginner", "intermediate", "experienced"]),
            "lingua": lingua,
        }

        try:
            coordinator.request_post_generation(
                feature=feature,
                lingua=lingua,
                subreddit=subreddit,
                user_data=user_data,
                force_diversity=True,
            )
            jobs_created += 1
        except Exception as e:
            log.warning("Failed to create job: %s", e)

    log.info("Created %d jobs. Processing...", jobs_created)

    # Process all created jobs
    results = run_batch(jobs_created)

    approved = sum(1 for r in results if r.get("status") == "approved")

    return {
        "jobs_created": jobs_created,
        "jobs_processed": len(results),
        "approved": approved,
        "approval_rate": round(approved / max(1, len(results)), 3),
    }
