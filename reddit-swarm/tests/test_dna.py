"""
Iron Kinetic Reddit Swarm - DNA Checklist Tests
Test DNA guardrail enforcement on generated posts.
"""

import unittest
from unittest.mock import MagicMock

from src.swarm_agent import IronKineticRedditAgent


class TestDNAChecklist(unittest.TestCase):
    """Test DNA checklist enforcement."""

    def setUp(self):
        """Set up mocked agent for DNA testing."""
        self.mock_client = MagicMock()
        self.mock_db = MagicMock()
        self.mock_client.__getitem__ = MagicMock(return_value=self.mock_db)

        # Minimal agent definition with dnaRulesOverride
        self.agent_def = {
            "agentType": "test_agent",
            "feature": "referral",
            "lingua": "en",
            "subredditTarget": "r/loseit",
            "angolo": "A",
            "tonoPreferito": "pratico",
            "dnaRulesOverride": {
                "strutturaPost": {
                    "titolo": "[placeholder] - referral (variable angle)",
                    "corpo": "Paragraph 1-4 structure.",
                },
                "vietaNelTitolo": ["iron kinetic", "app"],
                "frasiObbligatorie": [
                    "It made a real difference for me",
                ],
            },
        }

        self.instance_doc = {
            "instanceId": "test_instance",
            "agentDefinitionId": "test_agent",
        }

        # Setup mock collections
        def_coll = MagicMock()
        def_coll.find_one = MagicMock(return_value=self.agent_def)
        inst_coll = MagicMock()
        inst_coll.find_one = MagicMock(return_value=self.instance_doc)

        self.mock_db.__getitem__ = MagicMock(
            side_effect=lambda name: {
                "swarm_agent_definitions": def_coll,
                "swarm_agent_instances": inst_coll,
                "swarm_generated_content": MagicMock(),
                "swarm_knowledge_base": MagicMock(),
            }.get(name, MagicMock())
        )

        self.agent = IronKineticRedditAgent("test_instance", self.mock_client)
        self.agent.agent_def = self.agent_def
        self.agent.instance_doc = self.instance_doc

    def test_app_name_in_title_detected(self):
        """App name in title should be flagged as violation."""
        titolo = "Iron kinetic changed my life in 30 days"
        corpo = "This is a normal post body with some content."
        violations = self.agent._run_dna_checklist(titolo, corpo)
        self.assertTrue(
            any("iron kinetic" in v.lower() or "app" in v.lower() for v in violations),
            f"Expected 'iron kinetic' violation, got: {violations}",
        )

    def test_bullet_points_detected(self):
        """Bullet points in body should be flagged as violation."""
        titolo = "My 12 week journey"
        corpo = "Here is my progress.\n- Lost weight\n- Got stronger\n- Feel great"
        violations = self.agent._run_dna_checklist(titolo, corpo)
        self.assertTrue(
            any("bullet" in v.lower() for v in violations),
            f"Expected bullet point violation, got: {violations}",
        )

    def test_valid_post_no_violations(self):
        """A valid post should produce no DNA violations."""
        titolo = "Lost 15 kg in 14 weeks with a practical approach"
        corpo = (
            "I started my journey about 3 months ago. "
            "It was not easy but the results speak for themselves. "
            "The key was consistency and meal planning. "
            "Really glad I made the change."
        )
        violations = self.agent._run_dna_checklist(titolo, corpo)
        self.assertEqual(
            violations, [],
            f"Expected no violations for valid post, got: {violations}",
        )

    def test_paragraph_too_long_detected(self):
        """Paragraphs over 40 words should be flagged."""
        titolo = "My 8 week progress update"
        long_para = " ".join(["word"] * 50)
        corpo = long_para
        violations = self.agent._run_dna_checklist(titolo, corpo)
        self.assertTrue(
            any("paragrafo" in v.lower() or "parole" in v.lower() for v in violations),
            f"Expected paragraph length violation, got: {violations}",
        )

    def test_missing_number_in_title_detected(self):
        """Title without a number should be flagged."""
        titolo = "My fitness journey so far"
        corpo = "This is my story about getting fit and healthy."
        violations = self.agent._run_dna_checklist(titolo, corpo)
        self.assertTrue(
            any("numero" in v.lower() for v in violations),
            f"Expected missing number violation, got: {violations}",
        )

    def test_hashtag_detected(self):
        """Hashtags should be flagged as violation."""
        titolo = "My 10 week transformation"
        corpo = "Check out my progress #fitness #motivation"
        violations = self.agent._run_dna_checklist(titolo, corpo)
        self.assertTrue(
            any("hashtag" in v.lower() for v in violations),
            f"Expected hashtag violation, got: {violations}",
        )

    def test_vulgar_language_en_detected(self):
        """English vulgar language should be flagged."""
        titolo = "My 6 week results"
        corpo = "This is fucking incredible. I feel amazing."
        violations = self.agent._run_dna_checklist(titolo, corpo)
        self.assertTrue(
            any("volgare" in v.lower() or "vulgar" in v.lower() or "fuck" in v.lower() for v in violations),
            f"Expected vulgar language violation, got: {violations}",
        )

    def test_vulgar_language_it_detected(self):
        """Italian vulgar language should be flagged."""
        titolo = "I miei risultati in 8 settimane"
        corpo = "E cazzo se sono contento del risultato. Mi ha cambiato la vita."
        violations = self.agent._run_dna_checklist(titolo, corpo)
        self.assertTrue(
            any("volgare" in v.lower() or "vulgar" in v.lower() or "cazzo" in v.lower() for v in violations),
            f"Expected vulgar language violation, got: {violations}",
        )

    def test_direct_link_detected(self):
        """Direct links in body should be flagged."""
        titolo = "My 12 week meal plan results"
        corpo = "Check out this link https://example.com for more info."
        violations = self.agent._run_dna_checklist(titolo, corpo)
        self.assertTrue(
            any("link" in v.lower() for v in violations),
            f"Expected link violation, got: {violations}",
        )

    def test_too_many_iron_kinetic_mentions(self):
        """More than 1 mention of 'iron kinetic' in body should be flagged."""
        titolo = "My 10 week progress with coaching"
        corpo = (
            "I tried iron kinetic and it was great. "
            "Iron kinetic really helped me stay on track. "
            "Would recommend to anyone."
        )
        violations = self.agent._run_dna_checklist(titolo, corpo)
        self.assertTrue(
            any("iron kinetic" in v.lower() and "volte" in v.lower() for v in violations),
            f"Expected multiple mention violation, got: {violations}",
        )


class TestQualityReviewerDNA(unittest.TestCase):
    """Test QualityReviewer DNA review layer."""

    def test_reviewer_detects_app_name(self):
        """QualityReviewer DNA check should catch app name in title."""
        from src.quality_reviewer import QualityReviewer
        reviewer = QualityReviewer()
        violations = reviewer._dna_review(
            "Iron kinetic app review",
            "Normal body text here.",
        )
        self.assertTrue(len(violations) > 0)

    def test_reviewer_passes_clean_post(self):
        """QualityReviewer DNA check should pass a clean post."""
        from src.quality_reviewer import QualityReviewer
        reviewer = QualityReviewer()
        violations = reviewer._dna_review(
            "Lost 10 kg in 12 weeks",
            "Simple clean post body with no issues at all.",
        )
        self.assertEqual(violations, [])


if __name__ == "__main__":
    unittest.main()
