"""
Iron Kinetic Reddit Swarm - Quality Reviewer
Dual-layer quality review: DNA checklist + LLM subjective scoring.
"""

import re

from src.config import Config, log
from src import llm


# Vulgar words (shared with swarm_agent for consistency)
_VULGAR_EN = [
    "fuck", "shit", "damn", "ass", "bitch", "crap", "dick", "bastard",
]
_VULGAR_IT = [
    "cazzo", "merda", "stronzo", "vaffanculo", "porca", "troia", "culo",
]
_VULGAR_ALL = _VULGAR_EN + _VULGAR_IT


class QualityReviewer:
    """Reviews generated posts against DNA rules and subjective quality."""

    def __init__(self):
        """Initialize with quality threshold from Config."""
        self.threshold = Config.QUALITY_THRESHOLD
        log.info(
            "QualityReviewer initialized with threshold=%.2f",
            self.threshold,
        )

    def review(self, post: dict) -> dict:
        """Run full quality review on a post.

        Args:
            post: Dictionary with 'titolo' and 'corpo' keys.

        Returns:
            Dictionary with approved (bool), score (float), notes (list).
        """
        titolo = post.get("titolo", "")
        corpo = post.get("corpo", "")

        # Layer 1: Programmatic DNA review
        dna_violations = self._dna_review(titolo, corpo)

        # Layer 2: LLM subjective quality scoring
        llm_result = self._llm_review(titolo, corpo)
        llm_score = llm_result.get("score", 0.0)
        llm_notes = llm_result.get("notes", [])

        # Combine results
        all_notes = []
        if dna_violations:
            all_notes.extend([f"[DNA] {v}" for v in dna_violations])
        all_notes.extend([f"[LLM] {n}" for n in llm_notes])

        # Calculate final score: DNA violations reduce score
        penalty = len(dna_violations) * 0.15
        final_score = max(0.0, llm_score - penalty)

        # Determine approval
        approved = final_score >= self.threshold and len(dna_violations) == 0

        log.info(
            "Quality review: score=%.2f (llm=%.2f, penalty=%.2f) violations=%d approved=%s",
            final_score, llm_score, penalty, len(dna_violations), approved,
        )

        return {
            "approved": approved,
            "score": round(final_score, 3),
            "notes": all_notes,
        }

    def _dna_review(self, titolo: str, corpo: str) -> list:
        """Programmatic DNA checklist validation.

        Args:
            titolo: Post title.
            corpo: Post body.

        Returns:
            List of violation strings.
        """
        violations = []
        titolo_lower = titolo.lower()
        corpo_lower = corpo.lower()

        # Check 1: No app name in title
        for forbidden in ["iron kinetic", "app"]:
            if forbidden in titolo_lower:
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

        return violations

    def _llm_review(self, titolo: str, corpo: str) -> dict:
        """LLM-based subjective quality scoring.

        Args:
            titolo: Post title.
            corpo: Post body.

        Returns:
            Dictionary with score (0-1) and notes (list).
        """
        system_prompt = (
            "Sei un revisore di qualità per post Reddit. "
            "Valuta il post su autenticità, coinvolgimento, e naturalezza. "
            "Rispondi SOLO in JSON con chiavi 'score' (0.0-1.0) e 'notes' (lista di stringhe)."
        )
        user_message = (
            f"Valuta questo post Reddit:\n\n"
            f"TITOLO: {titolo}\n\n"
            f"CORPO: {corpo}\n\n"
            f"Rispondi in JSON: {{\"score\": 0.85, \"notes\": [\"nota1\", \"nota2\"]}}"
        )

        try:
            result = llm.chat_json(system_prompt, user_message)
            score = float(result.get("score", 0.5))
            notes = result.get("notes", [])
            # Clamp score to 0-1
            score = max(0.0, min(1.0, score))
            return {"score": score, "notes": notes}
        except (RuntimeError, ValueError, TypeError) as e:
            log.warning("LLM review failed, using default score: %s", e)
            return {
                "score": 0.5,
                "notes": [f"LLM review fallback: {str(e)}"],
            }
