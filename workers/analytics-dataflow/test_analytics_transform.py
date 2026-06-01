import json
from pathlib import Path
import unittest

from analytics_transform import (
    idempotency_key,
    parse_supported_versions,
    process_batch,
    process_payload,
)


class AnalyticsTransformTest(unittest.TestCase):
    def test_valid_event_promotes_to_all_layers(self):
        playback_event = event("evt_play", "playback.completed")
        playback_event["actorId"] = "listener_hash"
        playback_event["sessionId"] = "session-1"
        playback_event["payload"] = {
            "artistId": "artist-1",
            "releaseId": "release-1",
            "trackId": "track-1",
            "completionRatio": 0.9,
            "playbackInstanceId": "instance-1",
        }
        playback_event["geo"] = {
            "countryCode": "FR",
            "regionCode": "IDF",
            "citySlug": "paris",
            "source": "user_declared",
            "precision": "city",
        }
        layers = process_payload(json.dumps(playback_event))

        self.assertEqual(len(layers.events_raw), 1)
        self.assertEqual(len(layers.events_clean), 1)
        self.assertEqual(len(layers.analytics_facts), 1)
        self.assertEqual(len(layers.analytics_views), 1)
        self.assertEqual(layers.analytics_quarantine, [])
        self.assertEqual(layers.events_clean[0]["eventFamily"], "playback")
        self.assertEqual(layers.events_clean[0]["geoCountryCode"], "FR")
        self.assertEqual(layers.events_clean[0]["geoCitySlug"], "paris")
        self.assertEqual(layers.analytics_facts[0]["factId"], "fact_evt_play")
        self.assertEqual(layers.analytics_views[0]["playCount"], 1)
        self.assertEqual(json.loads(layers.events_raw[0]["payload"])["artistId"], "artist-1")
        self.assertEqual(json.loads(layers.events_clean[0]["payload"])["trackId"], "track-1")
        dimensions = json.loads(layers.analytics_facts[0]["dimensions"])
        self.assertEqual(dimensions["eventName"], "playback.completed")
        self.assertEqual(dimensions["actorId"], "listener_hash")
        self.assertEqual(dimensions["sessionId"], "session-1")
        self.assertEqual(dimensions["releaseId"], "release-1")
        self.assertEqual(dimensions["completionRatio"], 0.9)
        self.assertEqual(dimensions["playbackInstanceId"], "instance-1")
        self.assertEqual(dimensions["geoCountryCode"], "FR")
        self.assertEqual(dimensions["geoRegionCode"], "IDF")
        self.assertEqual(dimensions["geoCitySlug"], "paris")
        self.assertEqual(dimensions["geoSource"], "user_declared")
        self.assertEqual(dimensions["geoPrecision"], "city")

    def test_invalid_geo_dimension_is_quarantined(self):
        payload = event("evt_bad_geo", "shows.pledge_intent_created")
        payload["geo"] = {
            "countryCode": "FR",
            "source": "campaign_target",
            "precision": "city",
            "rawIp": "203.0.113.1",
        }

        layers = process_payload(payload)

        self.assertEqual(layers.events_clean, [])
        self.assertEqual(len(layers.analytics_quarantine), 1)
        self.assertIn("geo.citySlug", layers.analytics_quarantine[0]["reason"])
        self.assertIn("geo: unsupported fields", layers.analytics_quarantine[0]["reason"])

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
            ("evt_onboarding", "onboarding.step_completed"),
            ("evt_playlist", "playlist.track_added"),
            ("evt_search", "search.submitted"),
            ("evt_artist", "artist.upload_step_completed"),
            ("evt_shows", "shows.pledge_intent_created"),
            ("evt_community", "community.campaign_update_viewed"),
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
                "onboarding",
                "playlist",
                "search",
                "artist",
                "shows",
                "community",
            ],
        )
        self.assertEqual(len(layers.analytics_facts), len(events))

    def test_expected_analytics_events_promote_to_all_layers(self):
        expected_events = load_expected_events()

        layers = process_batch(
            event(
                f"evt_expected_{index}_{event_case['eventName'].replace('.', '_')}",
                event_case["eventName"],
                payload=event_case["payload"],
                privacyTier=event_case.get("privacyTier", "pseudonymous"),
                consentBasis=event_case.get("consentBasis"),
            )
            for index, event_case in enumerate(expected_events)
        )
        event_names = [event_case["eventName"] for event_case in expected_events]

        self.assertEqual(layers.analytics_quarantine, [])
        self.assertEqual([row["eventName"] for row in layers.events_raw], event_names)
        self.assertEqual([row["eventName"] for row in layers.events_clean], event_names)
        self.assertEqual([json.loads(row["dimensions"])["eventName"] for row in layers.analytics_facts], event_names)
        self.assertEqual([row["eventName"] for row in layers.analytics_views], event_names)
        self.assertEqual(len(layers.events_raw), len(event_names))
        self.assertEqual(len(layers.events_clean), len(event_names))
        self.assertEqual(len(layers.analytics_facts), len(event_names))
        self.assertEqual(len(layers.analytics_views), len(event_names))

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
        dimensions = json.loads(layers.analytics_facts[0]["dimensions"])

        self.assertEqual(dimensions["route"], "STANDARD_ESCROW")
        self.assertEqual(dimensions["evidenceTypes"], ["rights_metadata"])
        self.assertEqual(dimensions["decisionReason"], "verified uploader")

    def test_idempotency_key_prefers_event_id(self):
        payload = json.dumps(event("evt_key", "playback.completed"))

        self.assertEqual(idempotency_key(payload), "evt_key")
        self.assertTrue(idempotency_key("not json").startswith("invalid_"))

    def test_supported_versions_parser_defaults_safely(self):
        self.assertEqual(parse_supported_versions("1,2, bad, 4"), [1, 2, 4])
        self.assertEqual(parse_supported_versions("bad"), [1])


def event(event_id, event_name, eventVersion=1, payload=None, privacyTier="pseudonymous", consentBasis=None):
    envelope = {
        "eventId": event_id,
        "eventName": event_name,
        "eventVersion": eventVersion,
        "occurredAt": "2026-05-22T10:00:00.000Z",
        "receivedAt": "2026-05-22T10:00:01.000Z",
        "producer": "analytics-test",
        "environment": "local",
        "privacyTier": privacyTier,
        "payload": payload or {"artistId": "artist-1", "trackId": "track-1"},
    }
    if consentBasis:
        envelope["consentBasis"] = consentBasis
    return envelope


def load_expected_events():
    fixture_path = Path(__file__).resolve().parents[2] / "test-fixtures" / "analytics_expected_events.json"
    return json.loads(fixture_path.read_text())


if __name__ == "__main__":
    unittest.main()
