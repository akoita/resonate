import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SQL_DIR = ROOT / "sql"
DATAFORM_DIR = ROOT / "dataform"
DATAFORM_DEFINITIONS = DATAFORM_DIR / "definitions" / "agent_taste"
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

    def test_dataform_template_maps_agent_taste_dag(self):
        expected_files = [
            DATAFORM_DIR / "workflow_settings.yaml.example",
            DATAFORM_DIR / "includes" / "agent_taste_config.js",
            DATAFORM_DEFINITIONS / "track_intelligence_features.sqlx",
            DATAFORM_DEFINITIONS / "user_track_signal_training.sqlx",
            DATAFORM_DEFINITIONS / "user_track_recommendation_scores.sqlx",
            DATAFORM_DEFINITIONS / "agent_taste_materialization_report.sqlx",
            DATAFORM_DEFINITIONS / "assert_agent_taste_required_fields.sqlx",
            DATAFORM_DEFINITIONS / "assert_agent_taste_score_bounds.sqlx",
            DATAFORM_DEFINITIONS / "assert_agent_taste_freshness.sqlx",
        ]

        for file_path in expected_files:
            with self.subTest(file_path=file_path):
                self.assertTrue(file_path.exists(), f"missing {file_path}")

        scores_sqlx = (DATAFORM_DEFINITIONS / "user_track_recommendation_scores.sqlx").read_text()
        self.assertIn('tags: ["agent_taste", "baseline", "serving"]', scores_sqlx)
        self.assertIn('ref(cfg.trainingTableName(dataform.projectConfig))', scores_sqlx)
        self.assertIn('ref("track_intelligence_features")', scores_sqlx)

    def test_dataform_template_uses_compilation_variables_not_environment_literals(self):
        all_dataform_text = "\n".join(path.read_text() for path in DATAFORM_DIR.rglob("*") if path.is_file())

        self.assertNotIn("resonate-project", all_dataform_text)
        self.assertNotIn("analytics_dev", all_dataform_text)
        self.assertIn("YOUR_ANALYTICS_PROJECT", all_dataform_text)
        self.assertIn("YOUR_ANALYTICS_DATASET", all_dataform_text)
        self.assertIn("analytics_project", all_dataform_text)
        self.assertIn("analytics_dataset", all_dataform_text)

    def test_dataform_assertions_cover_serving_contract_and_freshness(self):
        required_fields = (DATAFORM_DEFINITIONS / "assert_agent_taste_required_fields.sqlx").read_text()
        score_bounds = (DATAFORM_DEFINITIONS / "assert_agent_taste_score_bounds.sqlx").read_text()
        freshness = (DATAFORM_DEFINITIONS / "assert_agent_taste_freshness.sqlx").read_text()

        for column in ["user_id", "track_id", "recommendation_score", "updated_at"]:
            with self.subTest(column=column):
                self.assertIn(f"{column} IS NULL", required_fields)

        self.assertIn("recommendation_score < 0", score_bounds)
        self.assertIn("recommendation_score > 1", score_bounds)
        self.assertIn("confidence < 0", score_bounds)
        self.assertIn("confidence > 1", score_bounds)
        self.assertIn("rank < 1", score_bounds)
        self.assertIn("empty_score_table", freshness)
        self.assertIn("stale_score_table", freshness)
        self.assertIn("freshnessHours", freshness)


if __name__ == "__main__":
    unittest.main()
