import json
import unittest

from analytics_transform import (
    idempotency_key,
    parse_supported_versions,
    process_batch,
    process_payload,
)


class AnalyticsTransformTest(unittest.TestCase):
    def test_valid_event_promotes_to_all_layers(self):
        layers = process_payload(json.dumps(event("evt_play", "playback.completed")))

        self.assertEqual(len(layers.events_raw), 1)
        self.assertEqual(len(layers.events_clean), 1)
        self.assertEqual(len(layers.analytics_facts), 1)
        self.assertEqual(len(layers.analytics_views), 1)
        self.assertEqual(layers.analytics_quarantine, [])
        self.assertEqual(layers.events_clean[0]["eventFamily"], "playback")
        self.assertEqual(layers.analytics_facts[0]["factId"], "fact_evt_play")
        self.assertEqual(layers.analytics_views[0]["playCount"], 1)

    def test_invalid_payload_is_quarantined(self):
        layers = process_payload("{not json")

        self.assertEqual(layers.events_raw, [])
        self.assertEqual(layers.events_clean, [])
        self.assertEqual(len(layers.analytics_quarantine), 1)
        self.assertIn("invalid JSON", layers.analytics_quarantine[0]["reason"])

    def test_unsupported_version_is_raw_and_quarantined(self):
        layers = process_payload(event("evt_v2", "playback.completed", eventVersion=2))

        self.assertEqual(len(layers.events_raw), 1)
        self.assertEqual(layers.events_clean, [])
        self.assertEqual(layers.analytics_quarantine[0]["reason"], "unsupported event version: 2")

    def test_unsupported_family_is_raw_and_quarantined(self):
        layers = process_payload(event("evt_unknown", "future.created"))

        self.assertEqual(len(layers.events_raw), 1)
        self.assertEqual(layers.events_clean, [])
        self.assertEqual(layers.analytics_quarantine[0]["reason"], "unsupported event family: future")

    def test_domain_event_families_promote_without_quarantine(self):
        events = [
            ("evt_stems", "stems.processed"),
            ("evt_contract", "contract.stem_sold"),
            ("evt_wallet", "wallet.funded"),
            ("evt_curator", "curator.staked"),
            ("evt_recommendation", "recommendation.generated"),
            ("evt_remix", "remix.created"),
            ("evt_marketplace", "marketplace.listing_sold"),
            ("evt_notification", "notification.sent"),
            ("evt_release_rights", "release_rights.request_updated"),
            ("evt_realtime", "realtime.audio"),
            ("evt_x402", "x402.payment_settled"),
            ("evt_session", "session.started"),
        ]

        layers = process_batch(event(event_id, event_name) for event_id, event_name in events)

        self.assertEqual(layers.analytics_quarantine, [])
        self.assertEqual(
            [row["eventFamily"] for row in layers.events_clean],
            [
                "stems",
                "contract",
                "wallet",
                "curator",
                "recommendation",
                "remix",
                "marketplace",
                "notification",
                "release_rights",
                "realtime",
                "x402",
                "session",
            ],
        )
        self.assertEqual(len(layers.analytics_facts), len(events))

    def test_batch_dedupes_by_event_id(self):
        layers = process_batch(
            [
                event("evt_dupe", "payment.settled", payload={"artistId": "artist-1", "amountUsd": 1.25}),
                event("evt_dupe", "payment.settled", payload={"artistId": "artist-1", "amountUsd": 1.25}),
            ]
        )

        self.assertEqual(len(layers.events_raw), 1)
        self.assertEqual(len(layers.events_clean), 1)
        self.assertEqual(layers.analytics_views[0]["payoutUsd"], 1.25)

    def test_snake_case_envelopes_are_supported(self):
        payload = {
            "event_id": "evt_snake",
            "event_name": "commerce.settled",
            "event_version": 1,
            "occurred_at": "2026-05-22T10:00:00.000Z",
            "received_at": "2026-05-22T10:00:01.000Z",
            "producer": "payments-service",
            "environment": "prod",
            "privacy_tier": "pseudonymous",
            "payload": {"artistId": "artist-1", "trackId": "track-1", "canonicalAmountUsd": 2.5},
        }

        layers = process_payload(payload)

        self.assertEqual(layers.events_clean[0]["eventId"], "evt_snake")
        self.assertEqual(layers.events_clean[0]["canonicalAmountUsd"], 2.5)

    def test_zero_canonical_amount_is_preserved(self):
        layers = process_payload(
            event(
                "evt_zero_amount",
                "commerce.settled",
                payload={"artistId": "artist-1", "trackId": "track-1", "canonicalAmountUsd": 0},
            )
        )

        self.assertEqual(layers.events_clean[0]["canonicalAmountUsd"], 0)
        self.assertEqual(layers.analytics_facts[0]["canonicalAmountUsd"], 0)
        self.assertEqual(layers.analytics_views[0]["payoutUsd"], 0.0)

    def test_rights_route_dimensions_are_preserved(self):
        layers = process_payload(
            event(
                "evt_rights",
                "rights.route_decided",
                payload={
                    "artistId": "artist-1",
                    "releaseId": "release-1",
                    "route": "STANDARD_ESCROW",
                    "evidenceTypes": ["rights_metadata"],
                    "decisionReason": "verified uploader",
                },
            )
        )

        self.assertEqual(layers.analytics_facts[0]["factType"], "rights_event")
        self.assertEqual(layers.analytics_facts[0]["releaseId"], "release-1")
        self.assertEqual(layers.analytics_facts[0]["dimensions"]["route"], "STANDARD_ESCROW")
        self.assertEqual(layers.analytics_facts[0]["dimensions"]["evidenceTypes"], ["rights_metadata"])
        self.assertEqual(layers.analytics_facts[0]["dimensions"]["decisionReason"], "verified uploader")

    def test_idempotency_key_prefers_event_id(self):
        payload = json.dumps(event("evt_key", "playback.completed"))

        self.assertEqual(idempotency_key(payload), "evt_key")
        self.assertTrue(idempotency_key("not json").startswith("invalid_"))

    def test_supported_versions_parser_defaults_safely(self):
        self.assertEqual(parse_supported_versions("1,2, bad, 4"), [1, 2, 4])
        self.assertEqual(parse_supported_versions("bad"), [1])


def event(event_id, event_name, eventVersion=1, payload=None):
    return {
        "eventId": event_id,
        "eventName": event_name,
        "eventVersion": eventVersion,
        "occurredAt": "2026-05-22T10:00:00.000Z",
        "receivedAt": "2026-05-22T10:00:01.000Z",
        "producer": "analytics-test",
        "environment": "local",
        "privacyTier": "pseudonymous",
        "payload": payload or {"artistId": "artist-1", "trackId": "track-1"},
    }


if __name__ == "__main__":
    unittest.main()
