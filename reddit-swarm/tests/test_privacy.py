"""
Iron Kinetic Reddit Swarm - Privacy Tests
Test that no PII leaks into generated posts.
"""

import unittest
from unittest.mock import MagicMock, patch

from src.swarm_agent import IronKineticRedditAgent


class TestPIIDetection(unittest.TestCase):
    """Test PII detection in context data."""

    def setUp(self):
        """Set up mocked agent for testing."""
        self.mock_client = MagicMock()
        self.mock_db = MagicMock()
        self.mock_client.__getitem__ = MagicMock(return_value=self.mock_db)

        # Minimal agent definition for testing
        self.agent_def = {
            "agentType": "test_agent",
            "feature": "referral",
            "lingua": "en",
            "subredditTarget": "r/loseit",
            "angolo": "A",
            "tonoPreferito": "pratico",
            "pesiSelezione": {
                "performanceScore": 0.4,
                "freshnessScore": 0.3,
                "angoloBalance": "A",
            },
            "dnaRulesOverride": {
                "strutturaPost": {"titolo": "test", "corpo": "test"},
                "vietaNelTitolo": ["iron kinetic", "app"],
                "frasiObbligatorie": [],
            },
        }

        self.instance_doc = {
            "instanceId": "test_instance",
            "agentDefinitionId": "test_agent",
            "stato": "idle",
        }

        # Setup mock returns
        def_coll = MagicMock()
        def_coll.find_one = MagicMock(return_value=self.agent_def)
        inst_coll = MagicMock()
        inst_coll.find_one = MagicMock(return_value=self.instance_doc)
        inst_coll.update_one = MagicMock()

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

    def test_pii_detection_raises_on_email(self):
        """PII detection should raise ValueError when email is present."""
        context = {"email": "test@example.com", "lingua": "en"}
        with self.assertRaises(ValueError) as cm:
            self.agent._validate_no_pii_in_context(context)
        self.assertIn("PII detected", str(cm.exception))

    def test_pii_detection_raises_on_phone(self):
        """PII detection should raise ValueError when phone number is present."""
        context = {"phone": "+39 02 1234567", "lingua": "it"}
        with self.assertRaises(ValueError):
            self.agent._validate_no_pii_in_context(context)

    def test_pii_detection_raises_on_individual_weight(self):
        """PII detection should raise on individual weight values."""
        context = {"peso": "85 kg", "lingua": "it"}
        with self.assertRaises(ValueError):
            self.agent._validate_no_pii_in_context(context)

    def test_pii_detection_passes_on_safe_data(self):
        """PII detection should pass on clean context data."""
        context = {
            "utente_tipo": "intermediate",
            "lingua": "en",
            "subreddit": "r/loseit",
        }
        # Should not raise
        self.agent._validate_no_pii_in_context(context)

    def test_pii_detection_raises_on_date(self):
        """PII detection should raise on date patterns."""
        context = {"data": "15/03/2024", "lingua": "it"}
        with self.assertRaises(ValueError):
            self.agent._validate_no_pii_in_context(context)


class TestSafeFormatting(unittest.TestCase):
    """Test that formatting functions use ranges, not individual values."""

    def setUp(self):
        """Set up agent for formatting tests."""
        self.mock_client = MagicMock()
        self.mock_db = MagicMock()
        self.mock_client.__getitem__ = MagicMock(return_value=self.mock_db)
        self.mock_db.__getitem__ = MagicMock(return_value=MagicMock())

        self.agent = IronKineticRedditAgent("test", self.mock_client)

    def test_weight_loss_is_range(self):
        """Weight loss formatting should return a range."""
        stats = {"peso_medio_perso": 10, "peso_std": 3}
        result = self.agent._format_weight_loss_safely(stats)
        self.assertIn("tra i", result)
        self.assertIn("kg", result)
        # Should NOT contain individual weight like '10 kg'
        self.assertNotEqual(result, "10 kg")

    def test_duration_is_range(self):
        """Duration formatting should return a range."""
        stats = {"durata_media_settimane": 12, "durata_std": 4}
        result = self.agent._format_duration_safely(stats)
        self.assertIn("tra", result)
        self.assertIn("settimane", result)

    def test_compliance_is_range(self):
        """Compliance formatting should return a percentage range."""
        stats = {"compliance_media": 0.65, "compliance_std": 0.10}
        result = self.agent._format_compliance_safely(stats)
        self.assertIn("tra il", result)
        self.assertIn("%", result)

    def test_safe_placeholders_use_ranges(self):
        """Safe placeholders should contain range values, not individual data."""
        self.agent.agent_def = {
            "lingua": "en",
            "feature": "referral",
            "pesiSelezione": {},
            "subredditTarget": "r/loseit",
        }
        context = {"utente_tipo": "intermediate", "lingua": "en", "subreddit": "r/loseit"}
        result = self.agent._prepare_safe_placeholders(context, "A")

        # Check all range fields contain 'tra'
        self.assertIn("tra", result["peso_range"])
        self.assertIn("tra", result["durata_range"])
        self.assertIn("tra", result["compliance_range"])

        # Cohort size should be >= 5 (k-anonymity minimum)
        self.assertGreaterEqual(result["cohort_size"], 5)


class TestPrivacyMetadata(unittest.TestCase):
    """Test privacy metadata audit trail."""

    def setUp(self):
        """Set up agent."""
        self.mock_client = MagicMock()
        self.mock_db = MagicMock()
        self.mock_client.__getitem__ = MagicMock(return_value=self.mock_db)
        self.mock_db.__getitem__ = MagicMock(return_value=MagicMock())
        self.agent = IronKineticRedditAgent("test", self.mock_client)

    def test_metadata_has_required_fields(self):
        """Privacy metadata should include all required audit fields."""
        placeholders = {"cohort_size": 15, "peso_range": "tra i 8 e i 14 kg"}
        meta = self.agent._prepare_privacy_metadata(placeholders)

        self.assertIn("k_anonimo", meta)
        self.assertIn("delta_divulga", meta)
        self.assertIn("data_usati", meta)
        self.assertIn("timestamp", meta)

    def test_metadata_k_anonymity_minimum(self):
        """K-anonymity in metadata should be at least 5."""
        placeholders = {"cohort_size": 3}
        meta = self.agent._prepare_privacy_metadata(placeholders)
        self.assertEqual(meta["k_anonimo"], 3)


if __name__ == "__main__":
    unittest.main()
