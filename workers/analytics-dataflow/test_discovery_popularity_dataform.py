import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DATAFORM = ROOT / "dataform"
DISCOVERY = DATAFORM / "definitions" / "discovery"


class DiscoveryPopularityDataformTest(unittest.TestCase):
    def test_eligible_view_bounds_sources_and_requires_trusted_server_metadata(self):
        sql = (DISCOVERY / "discovery_popularity_eligible_events.sqlx").read_text()

        self.assertIn('FROM ${require("includes/discovery_popularity_config").rawTableRef(dataform.projectConfig)}', sql)
        self.assertIn('FROM ${require("includes/discovery_popularity_config").cleanTableRef(dataform.projectConfig)}', sql)
        self.assertIn("occurredAt >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)", sql)
        self.assertIn("occurredDate >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)", sql)
        self.assertIn("TIMESTAMP(c.occurredAt) <= CURRENT_TIMESTAMP()", sql)
        self.assertIn("r'^user_[0-9a-fA-F]{32}$'", sql)
        self.assertIn("self_engagement IS FALSE", sql)
        self.assertIn("ai_disclosure_level IN ('NONE', 'PARTLY', 'UNDECLARED')", sql)
        self.assertIn("consent_basis = 'consent'", sql)
        self.assertIn("consent_basis IN ('contract', 'performance_of_contract')", sql)
        self.assertIn("'x402.purchase'", sql)
        self.assertIn("'agent.purchase_completed'", sql)

    def test_credited_artist_fallback_never_uses_owner_identity(self):
        sql = (DISCOVERY / "discovery_popularity_eligible_events.sqlx").read_text()

        self.assertIn("COALESCE(ARRAY_LENGTH(credited_artist_ids), 0) > 0", sql)
        self.assertIn("[clean_credited_artist_id]", sql)
        self.assertNotIn("payload_artist_id", sql)
        self.assertNotIn("clean_artist_id", sql)

    def test_marts_cover_windows_counts_assertions_and_honest_cost_limits(self):
        track_sql = (DISCOVERY / "track_popularity.sqlx").read_text()
        artist_sql = (DISCOVERY / "artist_engagement.sqlx").read_text()
        snapshot_sql = (DISCOVERY / "discovery_popularity_snapshot.sqlx").read_text()
        track_assertion = (DISCOVERY / "assert_track_popularity_contract.sqlx").read_text()
        artist_assertion = (DISCOVERY / "assert_artist_engagement_contract.sqlx").read_text()
        trust_assertion = (DISCOVERY / "assert_discovery_popularity_eligible_event_trust.sqlx").read_text()
        snapshot_assertion = (DISCOVERY / "assert_discovery_popularity_snapshot_contract.sqlx").read_text()

        for sql in (track_sql, artist_sql):
            for window in ("'24h'", "'7d'", "'30d'"):
                self.assertIn(window, sql)
            for field in ("plays", "saves", "purchases", "unique_listeners", "score"):
                self.assertIn(field, sql)
            self.assertIn("occurredDate", sql)
            self.assertIn("occurredAt", sql)
            self.assertIn("dry-run bytes", sql)

        for sql in (track_assertion, artist_assertion):
            self.assertIn("HAVING COUNT(*) > 1", sql)
            self.assertIn("unique_listeners IS NULL", sql)
            self.assertIn("score < 0", sql)
            self.assertIn("purchases < 0", sql)
            self.assertIn("unique_listeners <", sql)

        self.assertIn("REGEXP_CONTAINS(TRIM(actor_id), r'^user_[0-9a-fA-F]{32}$')", trust_assertion)
        self.assertIn("self_engagement IS NOT FALSE", trust_assertion)
        self.assertIn("track_rows", snapshot_sql)
        self.assertIn("artist_rows", snapshot_sql)
        self.assertIn("CURRENT_TIMESTAMP() AS computed_at", snapshot_sql)
        self.assertIn("snapshot_rows != 1", snapshot_assertion)
        self.assertIn("track_rows != (SELECT COUNT(*)", snapshot_assertion)
        self.assertIn("artist_rows != (SELECT COUNT(*)", snapshot_assertion)
        self.assertIn("TIMESTAMP_ADD(computed_at", snapshot_assertion)

    def test_dataform_config_uses_strict_numeric_validation_and_external_table_config(self):
        config = (DATAFORM / "includes" / "discovery_popularity_config.js").read_text()
        eligible = (DISCOVERY / "discovery_popularity_eligible_events.sqlx").read_text()

        self.assertIn("Number(value)", config)
        self.assertNotIn("Number.parseInt", config)
        self.assertIn('quotedTableRef(projectConfig, "raw_table", "events_raw")', config)
        self.assertIn('quotedTableRef(projectConfig, "clean_table", "events_clean")', config)
        self.assertIn("partitioned by occurredAt", eligible)
        self.assertIn('"discovery_snapshot_max_age_minutes", "120"', config)


if __name__ == "__main__":
    unittest.main()
