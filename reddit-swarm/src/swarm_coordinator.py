"""
Iron Kinetic Reddit Swarm - Swarm Coordinator
Orchestrates agent selection, job creation, and feedback processing.
"""

import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from src.config import Config, log


class SwarmCoordinator:
    """Coordinates agent selection and job management."""

    def __init__(self, mongo_client):
        """Initialize with MongoDB client.

        Args:
            mongo_client: pymongo MongoClient instance.
        """
        self.mongo_client = mongo_client
        self.db = mongo_client[Config.DB_NAME]
        self.definitions_coll = self.db[Config.COLLECTION_DEFINITIONS]
        self.instances_coll = self.db[Config.COLLECTION_INSTANCES]
        self.content_coll = self.db[Config.COLLECTION_CONTENT]
        self.knowledge_coll = self.db[Config.COLLECTION_KNOWLEDGE]

    def request_post_generation(
        self,
        feature: str,
        lingua: str,
        subreddit: str,
        user_data: dict,
        angolo_preferito: Optional[str] = None,
        force_diversity: bool = False,
    ) -> str:
        """Request generation of a new post.

        Args:
            feature: Feature type (referral, meal_plan, etc.).
            lingua: Language code (it/en).
            subreddit: Target subreddit.
            user_data: User context data.
            angolo_preferito: Preferred angle (A/B/C).
            force_diversity: If True, pick least recently used agent.

        Returns:
            Job ID string.
        """
        # Select optimal agent definition
        agent_def = self._select_optimal_agent_definition(
            feature, lingua, subreddit, angolo_preferito, force_diversity
        )

        if agent_def is None:
            raise ValueError(
                f"No agent definition found for feature={feature} "
                f"lingua={lingua} subreddit={subreddit}"
            )

        # Get or create agent instance
        utente_tipo = user_data.get("utente_tipo", "intermediate")
        instance = self._get_or_create_agent_instance(
            agent_def["agentType"], utente_tipo
        )

        # Create swarm job
        priority = user_data.get("priority", 5)
        job_id = self._create_swarm_job(
            instance["instanceId"], user_data, subreddit, priority
        )

        log.info(
            "Created job %s: agent=%s feature=%s subreddit=%s",
            job_id, instance["instanceId"], feature, subreddit,
        )

        return job_id

    def _select_optimal_agent_definition(
        self,
        feature: str,
        lingua: str,
        subreddit: str,
        angolo_hint: Optional[str],
        force_diversity: bool,
    ) -> Optional[dict]:
        """Select the best agent definition based on scoring.

        Scoring: 40% performanceScore, 30% freshnessScore, 30% angoloScore

        Args:
            feature: Feature type.
            lingua: Language code.
            subreddit: Target subreddit.
            angolo_hint: Angle preference hint.
            force_diversity: If True, pick least recently used.

        Returns:
            Agent definition document or None.
        """
        # Query matching definitions
        query = {
            "feature": feature,
            "lingua": lingua,
            "subredditTarget": subreddit,
        }
        candidates = list(self.definitions_coll.find(query))

        if not candidates:
            # Try without subreddit filter
            query.pop("subredditTarget")
            candidates = list(self.definitions_coll.find(query))

        if not candidates:
            return None

        if force_diversity:
            # Pick least recently used agent
            best = None
            oldest_time = datetime.max.replace(tzinfo=timezone.utc)
            for cand in candidates:
                inst = self.instances_coll.find_one(
                    {"agentDefinitionId": cand["agentType"]},
                    sort=[("ultimoUtilizzo", 1)],
                )
                last_used = inst.get("ultimoUtilizzo") if inst else None
                if last_used is None:
                    best = cand
                    break
                if last_used < oldest_time:
                    oldest_time = last_used
                    best = cand
            return best

        # Score-based selection
        best_candidate = None
        best_score = -1.0

        for cand in candidates:
            pesi = cand.get("pesiSelezione", {})
            w_perf = pesi.get("performanceScore", 0.4)
            w_fresh = pesi.get("freshnessScore", 0.3)
            w_angolo = pesi.get("angoloBalance", 0.3)

            # Performance score from metrics
            instances = list(self.instances_coll.find(
                {"agentDefinitionId": cand["agentType"]}
            ))
            if instances:
                avg_perf = sum(
                    inst.get("metriche", {}).get("performanceScore", 0.5)
                    for inst in instances
                ) / len(instances)
            else:
                avg_perf = 0.5

            # Freshness score (higher if not used recently)
            last_used = None
            if instances:
                for inst in instances:
                    lu = inst.get("ultimoUtilizzo")
                    if lu and (last_used is None or lu > last_used):
                        last_used = lu
            if last_used:
                hours_ago = (datetime.now(timezone.utc) - last_used).total_seconds() / 3600
                fresh_score = min(1.0, hours_ago / 48.0)
            else:
                fresh_score = 1.0

            # Angolo score
            angolo_def = cand.get("angolo", "A")
            angolo_score = 1.0 if angolo_hint and angolo_def == angolo_hint else 0.5

            total = (w_perf * avg_perf) + (w_fresh * fresh_score) + (w_angolo * angolo_score)

            if total > best_score:
                best_score = total
                best_candidate = cand

        return best_candidate

    def _get_or_create_agent_instance(
        self, def_id: str, utente_tipo: str
    ) -> dict:
        """Get an existing idle instance or create a new one.

        Args:
            def_id: Agent definition ID (agentType string).
            utente_tipo: User type.

        Returns:
            Instance document dict.
        """
        # Try to find idle instance
        idle = self.instances_coll.find_one({
            "agentDefinitionId": def_id,
            "stato": "idle",
        })

        if idle:
            # Mark as generating
            self.instances_coll.update_one(
                {"_id": idle["_id"]},
                {"$set": {"stato": "generando"}},
            )
            idle["stato"] = "generando"
            return idle

        # Create new instance
        instance_id = f"{def_id}_{uuid.uuid4().hex[:8]}"
        new_instance = {
            "agentDefinitionId": def_id,
            "instanceId": instance_id,
            "stato": "generando",
            "configurazioneCorrente": {
                "utenteTipo": utente_tipo,
            },
            "ultimoUtilizzo": None,
            "metriche": {
                "performanceScore": 0.5,
                "postsGenerati": 0,
                "postsApprovati": 0,
                "scoreMedio": 0.0,
            },
        }

        self.instances_coll.insert_one(new_instance)
        log.info("Created new agent instance: %s", instance_id)
        return new_instance

    def _create_swarm_job(
        self,
        agent_instance_id: str,
        user_data: dict,
        subreddit: str,
        priority: int = 5,
    ) -> str:
        """Create a new content generation job.

        Args:
            agent_instance_id: Agent instance ID.
            user_data: User context data.
            subreddit: Target subreddit.
            priority: Job priority (1-10, lower is higher priority).

        Returns:
            Job ID string.
        """
        job_id = f"job_{uuid.uuid4().hex[:12]}"

        job_doc = {
            "agentInstanceId": agent_instance_id,
            "titolo": "",
            "corpo": "",
            "stato": "draft",
            "datiContestoUsati": {
                "livelliAnonimizzazione": {
                    "kAnonimo": Config.K_ANONYMITY_MIN,
                    "deltaDivulga": 0.15,
                },
                "userData": user_data,
                "subreddit": subreddit,
            },
            "timestampPubblicazione": None,
            "qualitaScore": None,
            "feedback": {},
            "jobId": job_id,
            "priority": priority,
            "created_at": datetime.now(timezone.utc),
        }

        self.content_coll.insert_one(job_doc)
        return job_id

    def process_feedback(self, post_id: str) -> None:
        """Process feedback for a post and update agent metrics.

        Args:
            post_id: ID of the post document.
        """
        from bson import ObjectId

        post_doc = self.content_coll.find_one({"_id": ObjectId(post_id)})
        if post_doc is None:
            log.warning("Post not found for feedback: %s", post_id)
            return

        agent_instance_id = post_doc.get("agentInstanceId")
        if not agent_instance_id:
            log.warning("No agent instance ID on post %s", post_id)
            return

        # Update metrics
        metrics = {
            "qualitaScore": post_doc.get("qualitaScore", 0.0),
            "stato": post_doc.get("stato", "draft"),
        }
        self._update_agent_metrics(agent_instance_id, metrics)

        # Extract lessons
        lessons = self._extract_lessons_from_post(post_doc)
        for lesson in lessons:
            self._update_knowledge_base(lesson, str(post_doc["_id"]))

        # Recalculate weights
        self._recalculate_selection_weights(agent_instance_id)

        log.info(
            "Processed feedback for post %s: %d lessons extracted",
            post_id, len(lessons),
        )

    def _update_agent_metrics(
        self, agent_instance_id: str, metrics: dict
    ) -> None:
        """Update agent instance metrics.

        Args:
            agent_instance_id: Agent instance ID.
            metrics: New metrics to merge.
        """
        instance = self.instances_coll.find_one(
            {"instanceId": agent_instance_id}
        )
        if instance is None:
            return

        current = instance.get("metriche", {})
        posts_generated = current.get("postsGenerati", 0) + 1
        score = metrics.get("qualitaScore", 0.0)
        is_approved = metrics.get("stato") == "pubblicato"
        posts_approved = current.get("postsApprovati", 0) + (1 if is_approved else 0)

        # Running average score
        old_avg = current.get("scoreMedio", 0.0)
        new_avg = ((old_avg * (posts_generated - 1)) + score) / posts_generated

        # Performance score: blend of approval rate and quality
        approval_rate = posts_approved / max(1, posts_generated)
        performance_score = (approval_rate * 0.6) + (new_avg * 0.4)

        self.instances_coll.update_one(
            {"instanceId": agent_instance_id},
            {"$set": {
                "metriche.postsGenerati": posts_generated,
                "metriche.postsApprovati": posts_approved,
                "metriche.scoreMedio": round(new_avg, 3),
                "metriche.performanceScore": round(performance_score, 3),
            }},
        )

    def _extract_lessons_from_post(self, post_doc: dict) -> list:
        """Extract learnable lessons from a completed post.

        Args:
            post_doc: Post document.

        Returns:
            List of lesson dicts.
        """
        lessons = []
        titolo = post_doc.get("titolo", "")
        corpo = post_doc.get("corpo", "")
        score = post_doc.get("qualitaScore", 0.0)
        feedback = post_doc.get("feedback", {})

        # High-performing titles become lessons
        if score >= 0.8 and titolo:
            lessons.append({
                "tipoLezione": "titolo_efficace",
                "contenuto": titolo,
                "fiducia": min(1.0, score),
                "tag": ["high_score", "title"],
            })

        # Extract from feedback notes
        notes = feedback.get("notes", [])
        for note in notes:
            if "autentica" in note.lower() or "authentic" in note.lower():
                lessons.append({
                    "tipoLezione": "frase_autentica",
                    "contenuto": note,
                    "fiducia": 0.6,
                    "tag": ["authenticity", "feedback"],
                })

        return lessons

    def _update_knowledge_base(self, lesson: dict, post_id: str) -> None:
        """Insert a lesson into the knowledge base.

        Args:
            lesson: Lesson dict with tipoLezione, contenuto, fiducia, tag.
            post_id: Source post ID.
        """
        kb_doc = {
            "tipoLezione": lesson.get("tipoLezione", "template_variation"),
            "featureRiferimento": "general",
            "lingua": "en",
            "contenuto": lesson.get("contenuto", ""),
            "fiducia": lesson.get("fiducia", 0.5),
            "tag": lesson.get("tag", []),
            "postOrigine": post_id,
            "dataCreazione": datetime.now(timezone.utc),
        }

        self.knowledge_coll.insert_one(kb_doc)
        log.debug("Inserted lesson: %s", lesson.get("tipoLezione"))

    def _recalculate_selection_weights(self, agent_instance_id: str) -> None:
        """Recalculate selection weights for an agent instance.

        Adjusts the definition pesiSelezione based on performance.

        Args:
            agent_instance_id: Agent instance ID.
        """
        instance = self.instances_coll.find_one(
            {"instanceId": agent_instance_id}
        )
        if instance is None:
            return

        metrics = instance.get("metriche", {})
        perf_score = metrics.get("performanceScore", 0.5)

        # If performing well, increase performance weight
        # If performing poorly, increase freshness weight for rotation
        if perf_score >= 0.7:
            new_perf = 0.5
            new_fresh = 0.25
            new_angolo = 0.25
        elif perf_score < 0.4:
            new_perf = 0.3
            new_fresh = 0.45
            new_angolo = 0.25
        else:
            new_perf = 0.4
            new_fresh = 0.3
            new_angolo = 0.3

        # Update the definition
        def_id = instance.get("agentDefinitionId")
        self.definitions_coll.update_one(
            {"agentType": def_id},
            {"$set": {
                "pesiSelezione.performanceScore": new_perf,
                "pesiSelezione.freshnessScore": new_fresh,
                "pesiSelezione.angoloBalance": new_angolo,
            }},
        )
