"""
Iron Kinetic Reddit Swarm - Core Agent
Main agent class for generating privacy-safe Reddit posts.
"""

import re
import random
from datetime import datetime, timezone
from typing import Optional

from src.config import Config, log
from src import llm


# PII detection patterns
_PII_PATTERNS = [
    # Dates (various formats)
    re.compile(r'\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b'),
    re.compile(r'\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b'),
    # Email addresses
    re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'),
    # Phone numbers (various international formats)
    re.compile(r'\b(\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b'),
    # IP addresses
    re.compile(r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b'),
    # Individual weight values (30-250 kg or lbs)
    re.compile(r'\b(\d{2,3})(?:\s*)(kg|lbs?|chili|libbre)\b', re.IGNORECASE),
    # Full names (two or more capitalized words in sequence)
    re.compile(r'\b[A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b'),
]

# Vulgar words lists
_VULGAR_EN = [
    "fuck", "shit", "damn", "ass", "bitch", "crap", "dick", "bastard",
]
_VULGAR_IT = [
    "cazzo", "merda", "stronzo", "vaffanculo", "porca", "troia", "culo",
]
_VULGAR_ALL = _VULGAR_EN + _VULGAR_IT


class IronKineticRedditAgent:
    """Core agent for generating privacy-safe Reddit posts."""

    def __init__(self, instance_id: str, mongo_client):
        """Initialize agent with database references.

        Args:
            instance_id: Unique identifier for this agent instance.
            mongo_client: pymongo MongoClient instance.
        """
        self.instance_id = instance_id
        self.mongo_client = mongo_client
        self.db = mongo_client[Config.DB_NAME]
        self.definitions_coll = self.db[Config.COLLECTION_DEFINITIONS]
        self.instances_coll = self.db[Config.COLLECTION_INSTANCES]
        self.content_coll = self.db[Config.COLLECTION_CONTENT]
        self.knowledge_coll = self.db[Config.COLLECTION_KNOWLEDGE]

        self.agent_def: Optional[dict] = None
        self.instance_doc: Optional[dict] = None

    def load_configuration(self) -> None:
        """Load agent definition and config from MongoDB."""
        # Load instance document
        self.instance_doc = self.instances_coll.find_one(
            {"instanceId": self.instance_id}
        )
        if self.instance_doc is None:
            raise ValueError(f"Agent instance not found: {self.instance_id}")

        # Load agent definition
        def_id = self.instance_doc.get("agentDefinitionId")
        self.agent_def = self.definitions_coll.find_one({"agentType": def_id})
        if self.agent_def is None:
            # Try by _id as fallback
            from bson import ObjectId
            try:
                self.agent_def = self.definitions_coll.find_one(
                    {"_id": ObjectId(def_id)}
                )
            except Exception:
                pass
        if self.agent_def is None:
            raise ValueError(
                f"Agent definition not found: {def_id}"
            )

        log.info(
            "Loaded config for agent %s: feature=%s lingua=%s",
            self.instance_id,
            self.agent_def.get("feature"),
            self.agent_def.get("lingua"),
        )

    def generate_post(self, context: dict) -> dict:
        """Generate a Reddit post using the agent's configuration.

        Args:
            context: Dictionary with user data, subreddit, preferences.
                Expected keys: utente_tipo, lingua, subreddit, angolo_preferito,
                and optional user_data dict.

        Returns:
            Dictionary with status, titolo, corpo, and metadata.
        """
        if self.agent_def is None:
            self.load_configuration()

        # Validate no PII in context
        self._validate_no_pii_in_context(context)

        # Select angle
        angolo_preferito = context.get("angolo_preferito")
        angolo = self._select_angle(angolo_preferito)

        # Prepare safe placeholders
        placeholders = self._prepare_safe_placeholders(context, angolo)

        # Apply learned lessons
        self._apply_learned_lessons(placeholders)

        # Build prompts
        system_prompt = self._build_system_prompt()
        user_prompt = self._build_user_prompt(placeholders, angolo)

        # Generate via LLM
        try:
            result = llm.chat_json(system_prompt, user_prompt)
        except RuntimeError as e:
            log.error("LLM generation failed for agent %s: %s", self.instance_id, e)
            return {
                "status": "error",
                "titolo": "",
                "corpo": "",
                "metadata": {"error": str(e)},
            }

        titolo = result.get("titolo", "")
        corpo = result.get("corpo", "")

        # Run DNA checklist
        violations = self._run_dna_checklist(titolo, corpo)

        # Insert referral naturally if applicable
        feature = self.agent_def.get("feature", "")
        if feature == "referral":
            corpo = self._insert_referral_natural(corpo, context)

        # Prepare privacy metadata
        privacy_meta = self._prepare_privacy_metadata(placeholders)

        # Update instance last used
        self.instances_coll.update_one(
            {"instanceId": self.instance_id},
            {"$set": {
                "ultimoUtilizzo": datetime.now(timezone.utc),
                "stato": "idle",
            }},
        )

        return {
            "status": "draft" if not violations else "needs_review",
            "titolo": titolo,
            "corpo": corpo,
            "metadata": {
                "angolo": angolo,
                "violations": violations,
                "privacy": privacy_meta,
                "agent_type": self.agent_def.get("agentType", ""),
                "feature": feature,
                "lingua": self.agent_def.get("lingua", ""),
            },
        }

    def _validate_no_pii_in_context(self, context: dict) -> None:
        """Validate that no PII is present in the context data.

        Args:
            context: Context dictionary to validate.

        Raises:
            ValueError: If PII patterns are detected.
        """
        context_str = str(context)
        detected = []
        for pattern in _PII_PATTERNS:
            matches = pattern.findall(context_str)
            if matches:
                detected.append(pattern.pattern)

        if detected:
            log.warning(
                "PII detected in context for agent %s: %s patterns",
                self.instance_id,
                len(detected),
            )
            raise ValueError(
                f"PII detected in context ({len(detected)} pattern(s) matched). "
                f"Aborting generation for safety."
            )

    def _select_angle(self, preferred: Optional[str] = None) -> str:
        """Select an angle (A/B/C) for the post.

        Args:
            preferred: Optional preferred angle.

        Returns:
            Selected angle string (A, B, or C).
        """
        if preferred and preferred in ("A", "B", "C"):
            return preferred

        # Weight selection based on agent definition
        pesi = self.agent_def.get("pesiSelezione", {})
        angolo_balance = pesi.get("angoloBalance", None)
        if angolo_balance and angolo_balance in ("A", "B", "C"):
            # 50% chance of using balanced angle, 50% random
            if random.random() < 0.5:
                return angolo_balance

        return random.choice(["A", "B", "C"])

    def _prepare_safe_placeholders(self, context: dict, angolo: str) -> dict:
        """Prepare privacy-safe placeholder values from cohort statistics.

        Args:
            context: User context with utente_tipo.
            angolo: Selected angle.

        Returns:
            Dictionary of safe placeholder values.
        """
        utente_tipo = context.get("utente_tipo", "intermediate")
        lingua = context.get("lingua", self.agent_def.get("lingua", "en"))
        stats = self._get_cohort_statistics(utente_tipo)

        placeholders = {
            "lingua": lingua,
            "utente_tipo": utente_tipo,
            "angolo": angolo,
            "peso_range": self._format_weight_loss_safely(stats),
            "durata_range": self._format_duration_safely(stats),
            "compliance_range": self._format_compliance_safely(stats),
            "guadagno_referral": self._format_referral_earnings_safely(stats),
            "predizione": self._format_prediction_safely(stats, lingua),
            "subreddit": context.get("subreddit", self.agent_def.get("subredditTarget", "")),
            "cohort_size": stats.get("cohort_size", 15),
        }

        return placeholders

    def _get_cohort_statistics(self, utente_tipo: str) -> dict:
        """Return realistic mock cohort statistics.

        Args:
            utente_tipo: User type (beginner/intermediate/experienced).

        Returns:
            Dictionary with cohort statistics.
        """
        base_stats = {
            "beginner": {
                "peso_medio_perso": 6.5,
                "peso_std": 3.2,
                "durata_media_settimane": 12,
                "durata_std": 4,
                "compliance_media": 0.65,
                "compliance_std": 0.10,
                "guadagno_referral_medio": 45,
                "guadagno_referral_std": 20,
                "cohort_size": 22,
                "predizione_accuracy": 0.72,
            },
            "intermediate": {
                "peso_medio_perso": 10.2,
                "peso_std": 4.1,
                "durata_media_settimane": 16,
                "durata_std": 5,
                "compliance_media": 0.68,
                "compliance_std": 0.08,
                "guadagno_referral_medio": 78,
                "guadagno_referral_std": 35,
                "cohort_size": 18,
                "predizione_accuracy": 0.78,
            },
            "experienced": {
                "peso_medio_perso": 14.8,
                "peso_std": 5.0,
                "durata_media_settimane": 20,
                "durata_std": 6,
                "compliance_media": 0.72,
                "compliance_std": 0.07,
                "guadagno_referral_medio": 120,
                "guadagno_referral_std": 50,
                "cohort_size": 12,
                "predizione_accuracy": 0.83,
            },
        }
        return base_stats.get(utente_tipo, base_stats["intermediate"])

    def _format_weight_loss_safely(self, stats: dict) -> str:
        """Format weight loss as a safe range.

        Args:
            stats: Cohort statistics dict.

        Returns:
            Range string like 'tra i 8 e i 14 kg'.
        """
        media = stats.get("peso_medio_perso", 10)
        std = stats.get("peso_std", 3)
        low = max(2, round(media - std))
        high = round(media + std)
        return f"tra i {low} e i {high} kg"

    def _format_duration_safely(self, stats: dict) -> str:
        """Format duration as a safe range.

        Args:
            stats: Cohort statistics dict.

        Returns:
            Range string like 'tra 8 e 16 settimane'.
        """
        media = stats.get("durata_media_settimane", 12)
        std = stats.get("durata_std", 4)
        low = max(4, round(media - std))
        high = round(media + std)
        return f"tra {low} e {high} settimane"

    def _format_compliance_safely(self, stats: dict) -> str:
        """Format compliance rate as a safe percentage range.

        Args:
            stats: Cohort statistics dict.

        Returns:
            Range string like 'tra il 55% e il 75%'.
        """
        media = stats.get("compliance_media", 0.65)
        std = stats.get("compliance_std", 0.10)
        low_pct = max(30, round((media - std) * 100))
        high_pct = min(95, round((media + std) * 100))
        return f"tra il {low_pct}% e il {high_pct}%"

    def _format_referral_earnings_safely(self, stats: dict) -> str:
        """Format referral earnings as a hypothetical example.

        Args:
            stats: Cohort statistics dict.

        Returns:
            Hypothetical earnings example string.
        """
        media = stats.get("guadagno_referral_medio", 60)
        std = stats.get("guadagno_referral_std", 25)
        low = max(10, round(media - std))
        high = round(media + std)
        return f"ipoteticamente tra {low} e {high} crediti"

    def _format_prediction_safely(self, stats: dict, lingua: str) -> str:
        """Format a safe prediction description.

        Args:
            stats: Cohort statistics dict.
            lingua: Language code (it/en).

        Returns:
            Safe prediction description string.
        """
        accuracy = stats.get("predizione_accuracy", 0.75)
        pct = round(accuracy * 100)
        if lingua == "it":
            return (
                f"Secondo i modelli di previsione, circa il {pct}% degli utenti "
                f"con profilo simile raggiunge il proprio obiettivo"
            )
        else:
            return (
                f"Based on predictive models, about {pct}% of users "
                f"with a similar profile reach their goal"
            )

    def _apply_learned_lessons(self, placeholders: dict) -> None:
        """Inject knowledge base phrases into placeholders.

        Queries the knowledge base for high-confidence lessons
        relevant to this agent's feature and language, and adds
        them as additional context in the placeholders dict.

        Args:
            placeholders: Placeholder dict to modify in-place.
        """
        if self.agent_def is None:
            return

        feature = self.agent_def.get("feature", "")
        lingua = self.agent_def.get("lingua", "en")

        lessons = list(self.knowledge_coll.find(
            {
                "featureRiferimento": feature,
                "lingua": lingua,
                "fiducia": {"$gte": 0.6},
            },
            {"contenuto": 1, "tipoLezione": 1, "_id": 0},
        ).sort("fiducia", -1).limit(5))

        if lessons:
            frasi_apprese = [l["contenuto"] for l in lessons]
            placeholders["lezioni_apprese"] = frasi_apprese
            log.debug(
                "Applied %d learned lessons for %s/%s",
                len(frasi_apprese), feature, lingua,
            )
        else:
            placeholders["lezioni_apprese"] = []

    def _run_dna_checklist(self, titolo: str, corpo: str) -> list:
        """Validate post against DNA guardrails.

        Args:
            titolo: Post title.
            corpo: Post body.

        Returns:
            List of violation strings (empty if all checks pass).
        """
        violations = []
        titolo_lower = titolo.lower()
        corpo_lower = corpo.lower()

        # Check 1: No app name in title
        for forbidden in ["iron kinetic", "app"]:
            pattern = re.compile(r'\b' + re.escape(forbidden) + r'\b', re.IGNORECASE)
            if pattern.search(titolo):
                violations.append(
                    f"Titolo contiene '{forbidden}' (non ammesso)"
                )

        # Check 2: No medical claims without science context
        medical_terms = ["cura", "guarire", "tratta", "cure", "heal", "treat", "disease"]
        science_context = ["studio", "ricerca", "study", "research", "evidence"]
        has_medical = any(t in corpo_lower for t in medical_terms)
        has_science = any(t in corpo_lower for t in science_context)
        if has_medical and not has_science:
            violations.append("Claim medici senza contesto scientifico")

        # Check 3: No bullet points in body
        if "\n-" in corpo or "\n*" in corpo:
            violations.append("Corpo contiene bullet points")

        # Check 4: No direct links
        link_pattern = re.compile(r'https?://\S+')
        if link_pattern.search(corpo):
            violations.append("Corpo contiene link diretti")

        # Check 5: No hashtags
        hashtag_pattern = re.compile(r'#\w+')
        if hashtag_pattern.search(corpo) or hashtag_pattern.search(titolo):
            violations.append("Post contiene hashtag")

        # Check 6: Title must have specific number
        if not re.search(r'\d+', titolo):
            violations.append("Titolo non contiene un numero specifico")

        # Check 7: Max 1 mention of 'iron kinetic' in body
        ik_count = corpo_lower.count("iron kinetic")
        if ik_count > 1:
            violations.append(
                f"Corpo menziona 'iron kinetic' {ik_count} volte (max 1)"
            )

        # Check 8: Paragraphs max 40 words each
        paragraphs = corpo.split("\n\n")
        for i, para in enumerate(paragraphs):
            word_count = len(para.split())
            if word_count > 40:
                violations.append(
                    f"Paragrafo {i + 1} ha {word_count} parole (max 40)"
                )

        # Check 9: No vulgar language
        for word in _VULGAR_ALL:
            if word in corpo_lower or word in titolo_lower:
                violations.append(f"Linguaggio volgare rilevato: '{word}'")

        if violations:
            log.warning(
                "DNA violations for agent %s: %s",
                self.instance_id, violations,
            )

        return violations

    def _insert_referral_natural(self, corpo: str, context: dict) -> str:
        """Insert referral mention naturally into the post body.

        The referral mention is woven into the narrative flow,
        NEVER as a call-to-action.

        Args:
            corpo: Original post body.
            context: User context dict.

        Returns:
            Modified body with natural referral mention.
        """
        lingua = context.get("lingua", self.agent_def.get("lingua", "en"))

        referral_phrases_it = [
            "Tra le varie cose che ho provato, ho anche scoperto che alcuni coach nutritionali offrono programmi personalizzati — se interessa posso condividere la mia esperienza.",
            "Un dettaglio che mi ha sorpreso: esistono piattaforme che ti seguono con piani su misura. Nel mio caso ha fatto la differenza.",
            "Non saprei dire cosa pesi di più, ma il supporto personalizzato che ho trovato online è stato un bel incentivo.",
        ]

        referral_phrases_en = [
            "Among the various things I tried, I also found some nutrition coaches offering personalized plans — if anyone's curious I can share more about my experience.",
            "One detail that surprised me: there are platforms that follow you with tailored plans. In my case it made a real difference.",
            "Hard to say what mattered most, but the personalized online support I found was a great motivator.",
        ]

        if lingua == "it":
            phrase = random.choice(referral_phrases_it)
        else:
            phrase = random.choice(referral_phrases_en)

        # Insert before the last paragraph
        paragraphs = corpo.split("\n\n")
        if len(paragraphs) >= 2:
            paragraphs.insert(-1, phrase)
        else:
            paragraphs.append(phrase)

        return "\n\n".join(paragraphs)

    def _build_system_prompt(self) -> str:
        """Build system prompt from agent definition.

        Returns:
            Complete system prompt string for the LLM.
        """
        if self.agent_def is None:
            return ""

        feature = self.agent_def.get("feature", "generic_progress")
        lingua = self.agent_def.get("lingua", "en")
        tono = self.agent_def.get("tonoPreferito", "pratico")
        subreddit = self.agent_def.get("subredditTarget", "")
        dna_rules = self.agent_def.get("dnaRulesOverride", {})

        # Language-appropriate system header
        if lingua == "it":
            header = (
                f"Sei un utente autentico di Reddit che scrive in italiano. "
                f"Scrivi un post per {subreddit} con tono {tono}. "
                f"Il post riguarda la feature '{feature}' della tua esperienza fitness."
            )
        else:
            header = (
                f"You are an authentic Reddit user writing in English. "
                f"Write a post for {subreddit} with a {tono} tone. "
                f"The post is about the '{feature}' aspect of your fitness journey."
            )

        # DNA rules section
        rules_text = "\nDNA RULES:\n"
        vietati = dna_rules.get("vietaNelTitolo", [])
        if vietati:
            rules_text += f"- Non usare nel titolo: {', '.join(vietati)}\n"

        frasi = dna_rules.get("frasiObbligatorie", [])
        if frasi:
            rules_text += f"- Includi almeno una di queste frasi: {'; '.join(frasi)}\n"

        struttura = dna_rules.get("strutturaPost", {})
        if struttura:
            titolo_tpl = struttura.get("titolo", "")
            corpo_tpl = struttura.get("corpo", "")
            if titolo_tpl:
                rules_text += f"- Struttura titolo: {titolo_tpl}\n"
            if corpo_tpl:
                rules_text += f"- Struttura corpo: {corpo_tpl}\n"

        rules_text += (
            "- NO bullet points nel corpo\n"
            "- NO link diretti\n"
            "- NO hashtag\n"
            "- Il titolo deve contenere un numero specifico\n"
            "- Massimo 1 menzione di 'iron kinetic' nel corpo\n"
            "- Ogni paragrafo massimo 40 parole\n"
            "- Nessun linguaggio volgare\n"
        )

        return header + "\n" + rules_text

    def _build_user_prompt(self, placeholders: dict, angolo: str) -> str:
        """Build user prompt with placeholders.

        Args:
            placeholders: Safe placeholder values.
            angolo: Selected angle (A/B/C).

        Returns:
            JSON-formatted user prompt string.
        """
        prompt_data = {
            "istruzione": (
                "Genera un post Reddit autentico basato sui seguenti dati. "
                "Rispondi SOLO in formato JSON con chiavi 'titolo' e 'corpo'."
            ),
            "angolo": angolo,
            "contesto": {
                "lingua": placeholders.get("lingua", "en"),
                "utente_tipo": placeholders.get("utente_tipo", "intermediate"),
                "subreddit": placeholders.get("subreddit", ""),
            },
            "dati_sicuri": {
                "peso_range": placeholders.get("peso_range", ""),
                "durata_range": placeholders.get("durata_range", ""),
                "compliance_range": placeholders.get("compliance_range", ""),
                "guadagno_referral": placeholders.get("guadagno_referral", ""),
                "predizione": placeholders.get("predizione", ""),
            },
            "lezioni_apprese": placeholders.get("lezioni_apprese", []),
            "formato_risposta": {
                "titolo": "string",
                "corpo": "string",
            },
        }

        import json
        return json.dumps(prompt_data, ensure_ascii=False, indent=2)

    def _prepare_privacy_metadata(self, placeholders: dict) -> dict:
        """Prepare privacy audit trail metadata.

        Args:
            placeholders: Safe placeholder values used.

        Returns:
            Dictionary with privacy audit information.
        """
        cohort_size = placeholders.get("cohort_size", Config.K_ANONYMITY_MIN)
        data_keys = [
            k for k in placeholders.keys()
            if k not in ("lezioni_apprese",)
        ]
        return {
            "k_anonimo": cohort_size,
            "delta_divulga": 0.15,
            "data_usati": data_keys,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
