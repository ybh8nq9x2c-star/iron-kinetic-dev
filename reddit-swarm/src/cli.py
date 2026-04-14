"""
Iron Kinetic Reddit Swarm - CLI Interface
Command-line interface for managing the swarm system.

Usage:
    python -m src.cli init
    python -m src.cli seed
    python -m src.cli generate [--count N]
    python -m src.cli status
    python -m src.cli export [--status approved]
    python -m src.cli run
"""

import argparse
import json
import sys

from src.config import Config, log
from src.db import get_client, get_collection, close_connection


def cmd_init(args):
    """Setup DB: create collections and indexes."""
    from src.setup_db import setup_all
    log.info("Initializing database...")
    setup_all()
    log.info("Database initialized successfully.")


def cmd_seed(args):
    """Seed 30 agent profiles."""
    from seed.seed_profiles import seed_all_profiles
    log.info("Seeding agent profiles...")
    seed_all_profiles()
    log.info("Seeding complete.")


def cmd_generate(args):
    """Generate N posts."""
    from src.pipeline import run_batch
    count = args.count or 1
    log.info("Generating %d post(s)...", count)
    results = run_batch(count)

    approved = sum(1 for r in results if r.get("status") == "approved")
    print(f"\nGenerated {len(results)} posts: {approved} approved")

    for r in results:
        status_icon = "✓" if r.get("status") == "approved" else "✗"
        score = r.get("score", 0)
        job_id = r.get("job_id", "?")
        titolo = r.get("titolo", "")[:60]
        print(f"  {status_icon} [{score:.2f}] {job_id}: {titolo}")


def cmd_status(args):
    """Show metrics dashboard."""
    content_coll = get_collection(Config.COLLECTION_CONTENT)
    instances_coll = get_collection(Config.COLLECTION_INSTANCES)
    knowledge_coll = get_collection(Config.COLLECTION_KNOWLEDGE)

    # Count posts by status
    pipeline = [
        {"$group": {
            "_id": "$stato",
            "count": {"$sum": 1},
        }},
    ]
    status_counts = {}
    for doc in content_coll.aggregate(pipeline):
        status_counts[doc["_id"]] = doc["count"]

    total_posts = sum(status_counts.values())
    approved = status_counts.get("pubblicato", 0)
    drafts = status_counts.get("draft", 0)
    failed = status_counts.get("fallito", 0)

    # Average quality score
    avg_pipeline = [
        {"$match": {"qualitaScore": {"$ne": None}}},
        {"$group": {
            "_id": None,
            "avgScore": {"$avg": "$qualitaScore"},
        }},
    ]
    avg_result = list(content_coll.aggregate(avg_pipeline))
    avg_score = avg_result[0]["avgScore"] if avg_result else 0.0

    # Agent instances count
    active_instances = instances_coll.count_documents({"stato": "idle"})
    total_instances = instances_coll.count_documents({})

    # Knowledge base count
    kb_count = knowledge_coll.count_documents({})

    print("\n=== Iron Kinetic Reddit Swarm Status ===")
    print(f"  Posts total:      {total_posts}")
    print(f"  Approved:         {approved}")
    print(f"  Drafts:           {drafts}")
    print(f"  Failed:           {failed}")
    print(f"  Avg quality:      {avg_score:.3f}")
    print(f"  Agent instances:  {active_instances} active / {total_instances} total")
    print(f"  Knowledge base:   {kb_count} lessons")
    print(f"  Posts/day config: {Config.POSTS_PER_DAY}")
    print()


def cmd_export(args):
    """Export posts as JSON."""
    content_coll = get_collection(Config.COLLECTION_CONTENT)
    status_filter = args.status or None

    query = {}
    if status_filter:
        query["stato"] = status_filter

    posts = list(content_coll.find(
        query,
        {"_id": 0, "titolo": 1, "corpo": 1, "stato": 1,
         "qualitaScore": 1, "jobId": 1, "agentInstanceId": 1,
         "timestampPubblicazione": 1},
    ))

    # Convert datetime objects to strings
    for post in posts:
        ts = post.get("timestampPubblicazione")
        if ts:
            post["timestampPubblicazione"] = ts.isoformat()

    output = json.dumps(posts, ensure_ascii=False, indent=2)
    print(output)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(output)
        log.info("Exported %d posts to %s", len(posts), args.output)
    else:
        log.info("Exported %d posts to stdout", len(posts))


def cmd_run(args):
    """Run daily pipeline."""
    from src.pipeline import run_daily
    log.info("Starting daily pipeline...")
    result = run_daily()
    print(f"\nDaily pipeline complete:")
    print(f"  Jobs created:   {result.get('jobs_created', 0)}")
    print(f"  Jobs processed: {result.get('jobs_processed', 0)}")
    print(f"  Approved:       {result.get('approved', 0)}")
    print(f"  Approval rate:  {result.get('approval_rate', 0):.1%}")


def main():
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Iron Kinetic Reddit Swarm Manager",
        prog="python -m src.cli",
    )
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # init
    subparsers.add_parser("init", help="Setup database (collections + indexes)")

    # seed
    subparsers.add_parser("seed", help="Seed 30 agent profiles")

    # generate
    gen_parser = subparsers.add_parser("generate", help="Generate posts")
    gen_parser.add_argument(
        "--count", "-n", type=int, default=1,
        help="Number of posts to generate (default: 1)",
    )

    # status
    subparsers.add_parser("status", help="Show metrics dashboard")

    # export
    exp_parser = subparsers.add_parser("export", help="Export posts as JSON")
    exp_parser.add_argument(
        "--status", "-s", type=str, default=None,
        help="Filter by status (draft, pubblicato, fallito)",
    )
    exp_parser.add_argument(
        "--output", "-o", type=str, default=None,
        help="Output file path (default: stdout)",
    )

    # run
    subparsers.add_parser("run", help="Run daily pipeline")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    commands = {
        "init": cmd_init,
        "seed": cmd_seed,
        "generate": cmd_generate,
        "status": cmd_status,
        "export": cmd_export,
        "run": cmd_run,
    }

    try:
        cmd_func = commands.get(args.command)
        if cmd_func:
            cmd_func(args)
        else:
            parser.print_help()
    finally:
        close_connection()


if __name__ == "__main__":
    main()
