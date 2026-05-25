from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterable

SUPPORTED_EVENT_FAMILIES = {
    "identity",
    "catalog",
    "ingestion",
    "stems",
    "ipnft",
    "onboarding",
    "session",
    "playback",
    "playlist",
    "search",
    "artist",
    "library",
    "commerce",
    "license",
    "payment",
    "contract",
    "wallet",
    "rights",
    "release_rights",
    "agent",
    "recommendation",
    "curator",
    "remix",
    "marketplace",
    "generation",
    "notification",
    "realtime",
    "x402",
    "experiment",
    "system",
}

ANALYTICS_ENVIRONMENTS = {"local", "dev", "staging", "prod"}
ANALYTICS_PRIVACY_TIERS = {"anonymous", "pseudonymous", "personal", "sensitive"}
EVENT_NAME_PATTERN = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$")


@dataclass
class AnalyticsLayers:
    events_raw: list[dict[str, Any]] = field(default_factory=list)
    events_clean: list[dict[str, Any]] = field(default_factory=list)
    analytics_facts: list[dict[str, Any]] = field(default_factory=list)
    analytics_views: list[dict[str, Any]] = field(default_factory=list)
    analytics_quarantine: list[dict[str, Any]] = field(default_factory=list)

    def extend(self, other: "AnalyticsLayers") -> None:
        self.events_raw.extend(other.events_raw)
        self.events_clean.extend(other.events_clean)
        self.analytics_facts.extend(other.analytics_facts)
        self.analytics_views.extend(other.analytics_views)
        self.analytics_quarantine.extend(other.analytics_quarantine)


def process_batch(
    payloads: Iterable[bytes | str | dict[str, Any]],
    *,
    received_at: str | None = None,
    supported_event_versions: Iterable[int] = (1,),
) -> AnalyticsLayers:
    seen_event_ids: set[str] = set()
    layers = AnalyticsLayers()
    for payload in payloads:
        layers.extend(
            process_payload(
                payload,
                received_at=received_at,
                supported_event_versions=supported_event_versions,
                seen_event_ids=seen_event_ids,
            )
        )
    return layers


def process_payload(
    payload: bytes | str | dict[str, Any],
    *,
    received_at: str | None = None,
    supported_event_versions: Iterable[int] = (1,),
    seen_event_ids: set[str] | None = None,
) -> AnalyticsLayers:
    quarantine_received_at = received_at or now_iso()
    supported_versions = set(supported_event_versions)
    layers = AnalyticsLayers()

    try:
        event = parse_payload(payload)
        validate_event(event)
    except ValueError as error:
        raw = decode_payload_for_quarantine(payload)
        layers.analytics_quarantine.append(
            {
                "eventId": object_string(raw, "eventId"),
                "eventName": object_string(raw, "eventName"),
                "reason": str(error),
                "receivedAt": quarantine_received_at,
                "raw": json_field(raw),
            }
        )
        return layers

    if seen_event_ids is not None:
        event_id = event["eventId"]
        if event_id in seen_event_ids:
            return layers
        seen_event_ids.add(event_id)

    layers.events_raw.append(to_raw_row(event))

    if event["eventVersion"] not in supported_versions:
        layers.analytics_quarantine.append(
            {
                "eventId": event["eventId"],
                "eventName": event["eventName"],
                "reason": f"unsupported event version: {event['eventVersion']}",
                "receivedAt": quarantine_received_at,
                "raw": json_field(event),
            }
        )
        return layers

    event_family = event["eventName"].split(".")[0]
    if event_family not in SUPPORTED_EVENT_FAMILIES:
        layers.analytics_quarantine.append(
            {
                "eventId": event["eventId"],
                "eventName": event["eventName"],
                "reason": f"unsupported event family: {event_family}",
                "receivedAt": quarantine_received_at,
                "raw": json_field(event),
            }
        )
        return layers

    clean = to_clean_row(event)
    layers.events_clean.append(serialize_json_fields(clean, "payload"))
    layers.analytics_facts.append(to_fact_row(clean))
    layers.analytics_views.append(to_view_row(clean))
    return layers


def parse_payload(payload: bytes | str | dict[str, Any]) -> dict[str, Any]:
    if isinstance(payload, dict):
        event = payload
    else:
        if isinstance(payload, bytes):
            payload = payload.decode("utf-8")
        try:
            event = json.loads(payload)
        except json.JSONDecodeError as error:
            raise ValueError(f"invalid JSON: {error.msg}") from error

    if not isinstance(event, dict):
        raise ValueError("payload must be a JSON object")

    return normalize_event_keys(event)


def validate_event(event: dict[str, Any]) -> None:
    required = [
        "eventId",
        "eventName",
        "eventVersion",
        "occurredAt",
        "receivedAt",
        "producer",
        "environment",
        "privacyTier",
        "payload",
    ]
    issues: list[str] = []

    for field_name in required:
        if field_name not in event:
            issues.append(f"{field_name}: required")

    if not isinstance(event.get("eventId"), str) or not event.get("eventId"):
        issues.append("eventId: must be a non-empty string")

    event_name = event.get("eventName")
    if not isinstance(event_name, str) or not EVENT_NAME_PATTERN.match(event_name):
        issues.append("eventName: must use dotted lowercase names such as playback.completed")

    event_version = event.get("eventVersion")
    if not isinstance(event_version, int) or isinstance(event_version, bool) or event_version <= 0:
        issues.append("eventVersion: must be a positive integer")

    for timestamp_field in ("occurredAt", "receivedAt"):
        value = event.get(timestamp_field)
        if not isinstance(value, str) or not is_iso_datetime(value):
            issues.append(f"{timestamp_field}: must be an ISO datetime")

    if not isinstance(event.get("producer"), str) or not event.get("producer"):
        issues.append("producer: must be a non-empty string")

    if event.get("environment") not in ANALYTICS_ENVIRONMENTS:
        issues.append("environment: unsupported value")

    privacy_tier = event.get("privacyTier")
    if privacy_tier not in ANALYTICS_PRIVACY_TIERS:
        issues.append("privacyTier: unsupported value")

    if privacy_tier in {"personal", "sensitive"} and not event.get("consentBasis"):
        issues.append("consentBasis: personal and sensitive analytics events require consentBasis")

    if ("subjectType" in event) != ("subjectId" in event):
        issues.append("subjectType and subjectId must be provided together")

    if not isinstance(event.get("payload"), dict):
        issues.append("payload: must be an object")

    source_refs = event.get("sourceRefs")
    if source_refs is not None and (
        not isinstance(source_refs, dict)
        or any(not isinstance(key, str) or not isinstance(value, str) for key, value in source_refs.items())
    ):
        issues.append("sourceRefs: must be an object of string values")

    if issues:
        raise ValueError("; ".join(issues))


def to_raw_row(event: dict[str, Any]) -> dict[str, Any]:
    return compact(
        {
            "eventId": event["eventId"],
            "eventName": event["eventName"],
            "eventVersion": event["eventVersion"],
            "occurredAt": event["occurredAt"],
            "receivedAt": event["receivedAt"],
            "producer": event["producer"],
            "environment": event["environment"],
            "privacyTier": event["privacyTier"],
            "payload": json_field(event["payload"]),
            "sourceRefs": json_field(event.get("sourceRefs")),
            "envelope": json_field(event),
        }
    )


def to_clean_row(event: dict[str, Any]) -> dict[str, Any]:
    event_family, *event_action = event["eventName"].split(".")
    payload = event["payload"]
    return compact(
        {
            "eventId": event["eventId"],
            "eventName": event["eventName"],
            "eventFamily": event_family,
            "eventAction": ".".join(event_action),
            "eventVersion": event["eventVersion"],
            "occurredAt": event["occurredAt"],
            "occurredDate": event["occurredAt"][:10],
            "producer": event["producer"],
            "environment": event["environment"],
            "privacyTier": event["privacyTier"],
            "subjectType": event.get("subjectType"),
            "subjectId": event.get("subjectId"),
            "actorId": event.get("actorId"),
            "sessionId": event.get("sessionId") or string_payload(payload, "sessionId"),
            "artistId": string_payload(payload, "artistId"),
            "trackId": string_payload(payload, "trackId"),
            "releaseId": string_payload(payload, "releaseId"),
            "canonicalAmountUsd": first_present(
                number_payload(payload, "canonicalAmountUsd"),
                number_payload(payload, "amountUsd"),
            ),
            "source": string_payload(payload, "source"),
            "payload": payload,
        }
    )


def to_fact_row(clean: dict[str, Any]) -> dict[str, Any]:
    payload = clean["payload"]
    return compact(
        {
            "factId": f"fact_{clean['eventId']}",
            "factType": f"{clean['eventFamily']}_event",
            "eventId": clean["eventId"],
            "occurredAt": clean["occurredAt"],
            "occurredDate": clean["occurredDate"],
            "artistId": clean.get("artistId"),
            "trackId": clean.get("trackId"),
            "releaseId": clean.get("releaseId"),
            "subjectType": clean.get("subjectType"),
            "subjectId": clean.get("subjectId"),
            "canonicalAmountUsd": clean.get("canonicalAmountUsd"),
            "count": 1,
            "dimensions": json_field(
                compact(
                    {
                        "eventName": clean["eventName"],
                        "producer": clean["producer"],
                        "privacyTier": clean["privacyTier"],
                        "actorId": clean.get("actorId"),
                        "source": clean.get("source"),
                        "sessionId": clean.get("sessionId"),
                        "releaseId": clean.get("releaseId"),
                        "playlistId": string_payload(payload, "playlistId"),
                        "step": string_payload(payload, "step"),
                        "phase": string_payload(payload, "phase"),
                        "status": string_payload(payload, "status"),
                        "licenseType": string_payload(payload, "licenseType"),
                        "strategy": string_payload(payload, "strategy"),
                        "playbackInstanceId": string_payload(payload, "playbackInstanceId"),
                        "action": string_payload(payload, "action"),
                        "positionMs": number_payload(payload, "positionMs"),
                        "durationMs": number_payload(payload, "durationMs"),
                        "heartbeatIntervalMs": number_payload(payload, "heartbeatIntervalMs"),
                        "completionRatio": number_payload(payload, "completionRatio"),
                        "queueIndex": number_payload(payload, "queueIndex"),
                        "queueLength": number_payload(payload, "queueLength"),
                        "repeatMode": string_payload(payload, "repeatMode"),
                        "shuffle": bool_payload(payload, "shuffle"),
                        "title": string_payload(payload, "title"),
                        "paymentToken": string_payload(payload, "paymentToken"),
                        "paymentAssetId": string_payload(payload, "paymentAssetId"),
                        "paymentAssetSymbol": string_payload(payload, "paymentAssetSymbol"),
                        "paymentAssetDecimals": number_payload(payload, "paymentAssetDecimals"),
                        "settlementAmount": string_payload(payload, "settlementAmount"),
                        "settlementAmountUnits": string_payload(payload, "settlementAmountUnits"),
                        "amount": string_payload(payload, "amount"),
                        "amountUnits": string_payload(payload, "amountUnits"),
                        "currency": string_payload(payload, "currency"),
                        "amountUsd": number_payload(payload, "amountUsd"),
                        "route": string_payload(payload, "route"),
                        "evidenceTypes": list_payload(payload, "evidenceTypes"),
                        "decisionReason": string_payload(payload, "decisionReason"),
                    }
                )
            ),
        }
    )


def to_view_row(clean: dict[str, Any]) -> dict[str, Any]:
    payout_usd = 0.0
    play_count = 0

    if clean["eventName"] in {"license.granted", "playback.completed"}:
        play_count = 1
    if clean["eventName"] in {"payment.settled", "commerce.settled"}:
        payout_usd = clean.get("canonicalAmountUsd") or 0.0

    return {
        "viewName": "daily_event_artist_track",
        "grain": "day_event_artist_track",
        "date": clean["occurredDate"],
        "eventName": clean["eventName"],
        "artistId": clean.get("artistId") or "unknown",
        "trackId": clean.get("trackId") or "unknown",
        "eventCount": 1,
        "playCount": play_count,
        "payoutUsd": payout_usd,
    }


def tagged_rows(payload: bytes | str | dict[str, Any], supported_versions: Iterable[int]) -> Iterable[tuple[str, dict[str, Any]]]:
    layers = process_payload(payload, supported_event_versions=supported_versions)
    for row in layers.events_raw:
        yield "events_raw", row
    for row in layers.events_clean:
        yield "events_clean", row
    for row in layers.analytics_facts:
        yield "analytics_facts", row
    for row in layers.analytics_views:
        yield "analytics_views", row
    for row in layers.analytics_quarantine:
        yield "analytics_quarantine", row


def idempotency_key(payload: bytes | str | dict[str, Any]) -> str:
    try:
        event = parse_payload(payload)
        event_id = event.get("eventId")
        if isinstance(event_id, str) and event_id:
            return event_id
    except ValueError:
        pass

    if isinstance(payload, dict):
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    elif isinstance(payload, bytes):
        canonical = payload.decode("utf-8", errors="replace")
    else:
        canonical = payload

    return f"invalid_{hashlib.sha256(canonical.encode('utf-8')).hexdigest()}"


def parse_supported_versions(raw: str | None) -> list[int]:
    if not raw:
        return [1]
    versions: list[int] = []
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        try:
            version = int(item)
        except ValueError:
            continue
        if version > 0:
            versions.append(version)
    return versions or [1]


def normalize_event_keys(event: dict[str, Any]) -> dict[str, Any]:
    aliases = {
        "event_id": "eventId",
        "event_name": "eventName",
        "event_version": "eventVersion",
        "occurred_at": "occurredAt",
        "received_at": "receivedAt",
        "privacy_tier": "privacyTier",
        "subject_type": "subjectType",
        "subject_id": "subjectId",
        "actor_id": "actorId",
        "session_id": "sessionId",
        "trace_id": "traceId",
        "schema_uri": "schemaUri",
        "consent_basis": "consentBasis",
        "source_refs": "sourceRefs",
    }
    normalized = dict(event)
    for old_key, new_key in aliases.items():
        if old_key in normalized and new_key not in normalized:
            normalized[new_key] = normalized[old_key]
    return normalized


def decode_payload_for_quarantine(payload: bytes | str | dict[str, Any]) -> Any:
    if isinstance(payload, dict):
        return normalize_event_keys(payload)
    if isinstance(payload, bytes):
        payload = payload.decode("utf-8", errors="replace")
    try:
        parsed = json.loads(payload)
    except json.JSONDecodeError:
        return {"message": payload}
    return normalize_event_keys(parsed) if isinstance(parsed, dict) else parsed


def compact(row: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in row.items() if value is not None}


def serialize_json_fields(row: dict[str, Any], *field_names: str) -> dict[str, Any]:
    serialized = dict(row)
    for field_name in field_names:
        serialized[field_name] = json_field(serialized.get(field_name))
    return compact(serialized)


def json_field(value: Any) -> str | None:
    if value is None:
        return None
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def string_payload(payload: dict[str, Any], key: str) -> str | None:
    value = payload.get(key)
    return value if isinstance(value, str) else None


def number_payload(payload: dict[str, Any], key: str) -> float | int | None:
    value = payload.get(key)
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def bool_payload(payload: dict[str, Any], key: str) -> bool | None:
    value = payload.get(key)
    return value if isinstance(value, bool) else None


def list_payload(payload: dict[str, Any], key: str) -> list[Any] | None:
    value = payload.get(key)
    return value if isinstance(value, list) else None


def first_present(*values: Any) -> Any:
    for value in values:
        if value is not None:
            return value
    return None


def object_string(raw: Any, key: str) -> str | None:
    if isinstance(raw, dict):
        value = raw.get(key)
        return value if isinstance(value, str) else None
    return None


def is_iso_datetime(value: str) -> bool:
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
