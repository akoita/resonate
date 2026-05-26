import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SQL_DIR = ROOT / "sql"
BASELINE_SQL = SQL_DIR / "agent_taste_intelligence_baseline.sql"
BQML_SQL = SQL_DIR / "agent_taste_intelligence_bqml.sql"
VERIFY_SQL = SQL_DIR / "agent_taste_intelligence_verification.sql"
RUNNER = ROOT / "run-agent-taste-materialization.sh"


class AgentTasteSqlTest(unittest.TestCase):
    def test_baseline_uses_query_parameters_for_environment_values(self):
        sql = BASELINE_SQL.read_text()

        self.assertNotIn("resonate-project", sql)
        self.assertNotIn("analytics_dev", sql)
        self.assertIn("DECLARE target_project STRING DEFAULT @target_project", sql)
        self.assertIn("DECLARE target_dataset STRING DEFAULT @target_dataset", sql)
        self.assertIn("DECLARE clean_table STRING DEFAULT @clean_table", sql)
        self.assertIn("DECLARE training_table STRING DEFAULT @training_table", sql)
        self.assertIn("DECLARE scores_table STRING DEFAULT @scores_table", sql)
        self.assertIn("DECLARE model_version STRING DEFAULT @model_version", sql)

    def test_bqml_template_uses_query_parameters_for_environment_values(self):
        sql = BQML_SQL.read_text()

        self.assertNotIn("resonate-project", sql)
        self.assertNotIn("analytics_dev", sql)
        self.assertIn("DECLARE target_project STRING DEFAULT @target_project", sql)
        self.assertIn("DECLARE target_dataset STRING DEFAULT @target_dataset", sql)
        self.assertIn("DECLARE training_table STRING DEFAULT @training_table", sql)
        self.assertIn("DECLARE scores_table STRING DEFAULT @scores_table", sql)

    def test_baseline_materializes_required_serving_contract(self):
        sql = BASELINE_SQL.read_text()

        for column in [
            "user_id",
            "track_id",
            "recommendation_score",
            "confidence",
            "rank",
            "explanation",
            "model_version",
            "updated_at",
        ]:
            with self.subTest(column=column):
                self.assertIn(column, sql)

    def test_baseline_includes_agent_taste_signal_families(self):
        sql = BASELINE_SQL.read_text()

        for event_name in [
            "playback.completed",
            "library.saved",
            "playlist.track_added",
            "commerce.settled",
            "payment.settled",
            "x402.purchase",
            "agent.purchase_completed",
            "agent.track_selected",
            "agent.decision_made",
            "agent.session_started",
            "agent.intent_selected",
        ]:
            with self.subTest(event_name=event_name):
                self.assertIn(event_name, sql)

        self.assertIn("signal_type = 'skip'", sql)
        self.assertIn("replay_count", sql)
        self.assertIn("intent_context_count", sql)

    def test_verification_queries_cover_freshness_signals_and_training_mix(self):
        sql = VERIFY_SQL.read_text()

        self.assertIn("newest_score_age_hours", sql)
        self.assertIn("COUNT(DISTINCT user_id)", sql)
        self.assertIn("COUNT(DISTINCT track_id)", sql)
        self.assertIn("GROUP BY signal_type", sql)
        self.assertIn("session_intent", sql)

    def test_runner_documents_environment_and_dry_run(self):
        result = subprocess.run(
            ["bash", str(RUNNER), "--help"],
            check=True,
            capture_output=True,
            text=True,
        )

        self.assertIn("--dry-run", result.stdout)
        self.assertIn("--verify", result.stdout)
        self.assertIn("AGENT_TASTE_MATERIALIZATION_PROJECT_ID", result.stdout)
        self.assertIn("AGENT_TASTE_BIGQUERY_DATASET", result.stdout)
        self.assertIn("AGENT_TASTE_BIGQUERY_CLEAN_TABLE", result.stdout)
        self.assertIn("AGENT_TASTE_BIGQUERY_TRAINING_TABLE", result.stdout)


if __name__ == "__main__":
    unittest.main()
