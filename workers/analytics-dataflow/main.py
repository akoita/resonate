from __future__ import annotations

import argparse
import logging
from typing import Iterable
from urllib.parse import quote

import apache_beam as beam
from apache_beam.coders import BooleanCoder
from apache_beam.io import ReadFromPubSub
from apache_beam.options.pipeline_options import PipelineOptions, StandardOptions
from apache_beam.transforms import userstate
from apache_beam.transforms.timeutil import TimeDomain
from apache_beam.utils.timestamp import Duration, Timestamp

from analytics_transform import idempotency_key, parse_supported_versions, tagged_rows


LAYER_TO_PARAMETER = {
    "events_raw": "rawTable",
    "events_clean": "cleanTable",
    "analytics_facts": "factsTable",
    "analytics_views": "viewsTable",
    "analytics_quarantine": "quarantineTable",
}


def table_ref(project_id: str, dataset: str, table: str) -> str:
    return f"{project_id}.{dataset}.{table}"


def build_pipeline(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inputSubscription", required=True)
    parser.add_argument("--deadLetterTopic", required=False)
    parser.add_argument("--outputProjectId", required=True)
    parser.add_argument("--outputDataset", required=True)
    parser.add_argument("--rawTable", required=True)
    parser.add_argument("--cleanTable", required=True)
    parser.add_argument("--factsTable", required=True)
    parser.add_argument("--viewsTable", required=True)
    parser.add_argument("--quarantineTable", required=True)
    parser.add_argument("--environment", required=False, default="")
    parser.add_argument("--supportedEventVersions", required=False, default="1")
    parser.add_argument("--dedupeWindowSeconds", required=False, type=int, default=900)

    known_args, pipeline_args = parser.parse_known_args(argv)
    supported_versions = parse_supported_versions(known_args.supportedEventVersions)

    options = PipelineOptions(pipeline_args, save_main_session=True)
    options.view_as(StandardOptions).streaming = True

    logging.info(
        "Starting analytics Dataflow processor for %s with subscription %s",
        known_args.environment or "unknown environment",
        known_args.inputSubscription,
    )

    table_parameters = {
        "events_raw": known_args.rawTable,
        "events_clean": known_args.cleanTable,
        "analytics_facts": known_args.factsTable,
        "analytics_views": known_args.viewsTable,
        "analytics_quarantine": known_args.quarantineTable,
    }

    with beam.Pipeline(options=options) as pipeline:
        messages = pipeline | "Read analytics Pub/Sub events" >> ReadFromPubSub(
            subscription=known_args.inputSubscription,
            with_attributes=False,
        )

        unique_messages = (
            messages
            | "Key by event id" >> beam.Map(lambda payload: (idempotency_key(payload), payload))
            | "Dedupe within TTL" >> beam.ParDo(DedupeWithinTtlDoFn(known_args.dedupeWindowSeconds))
        )

        tagged = unique_messages | "Build warehouse layer rows" >> beam.FlatMap(
            lambda payload: tagged_rows(payload, supported_versions)
        )

        for layer_name, table_name in table_parameters.items():
            rows = (
                tagged
                | f"Filter {layer_name}" >> beam.Filter(lambda item, target=layer_name: item[0] == target)
                | f"Rows {layer_name}" >> beam.Map(lambda item: item[1])
            )
            rows | f"Insert {layer_name}" >> beam.ParDo(
                BigQueryInsertAllDoFn(
                    table=table_ref(known_args.outputProjectId, known_args.outputDataset, table_name),
                    layer_name=layer_name,
                )
            )


class DedupeWithinTtlDoFn(beam.DoFn):
    seen = userstate.ReadModifyWriteStateSpec("seen", BooleanCoder())
    expiry = userstate.TimerSpec("expiry", TimeDomain.REAL_TIME)

    def __init__(self, ttl_seconds: int):
        self.ttl_seconds = ttl_seconds

    def process(
        self,
        element: tuple[str, bytes],
        seen_state=beam.DoFn.StateParam(seen),
        expiry_timer=beam.DoFn.TimerParam(expiry),
    ) -> Iterable[bytes]:
        if seen_state.read():
            return

        seen_state.write(True)
        expiry_timer.set(Timestamp.now() + Duration(seconds=self.ttl_seconds))
        yield element[1]

    @userstate.on_timer(expiry)
    def clear_seen(self, seen_state=beam.DoFn.StateParam(seen)) -> None:
        seen_state.clear()


class BigQueryInsertAllDoFn(beam.DoFn):
    def __init__(self, table: str, layer_name: str):
        self.table = table
        self.layer_name = layer_name
        self.session = None
        self.url = ""

    def setup(self) -> None:
        import google.auth
        from google.auth.transport.requests import AuthorizedSession

        credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/bigquery.insertdata"])
        self.session = AuthorizedSession(credentials)
        project_id, dataset_id, table_id = parse_table_ref(self.table)
        self.url = (
            "https://bigquery.googleapis.com/bigquery/v2/projects/"
            f"{quote(project_id, safe='')}/datasets/{quote(dataset_id, safe='')}/tables/{quote(table_id, safe='')}/insertAll"
        )

    def process(self, row: dict) -> Iterable[int]:
        if self.session is None:
            raise RuntimeError("BigQuery session was not initialized")

        response = self.session.post(
            self.url,
            json={
                "kind": "bigquery#tableDataInsertAllRequest",
                "skipInvalidRows": False,
                "ignoreUnknownValues": False,
                "rows": [
                    {
                        "insertId": row_insert_id(self.layer_name, row),
                        "json": row,
                    }
                ],
            },
        )
        response.raise_for_status()
        body = response.json()
        if body.get("insertErrors"):
            raise RuntimeError(f"BigQuery insertAll failed for {self.table}: {body['insertErrors'][:5]}")
        yield 1


def parse_table_ref(table: str) -> tuple[str, str, str]:
    parts = table.split(".")
    if len(parts) != 3 or any(not part for part in parts):
        raise ValueError(f"Invalid BigQuery table reference: {table}")
    return parts[0], parts[1], parts[2]


def row_insert_id(layer_name: str, row: dict) -> str:
    if layer_name in {"events_raw", "events_clean"}:
        return str(row.get("eventId", "unknown"))
    if layer_name == "analytics_facts":
        return str(row.get("factId", "unknown"))
    if layer_name == "analytics_views":
        return "|".join(
            str(row.get(key, "unknown"))
            for key in ("viewName", "grain", "date", "eventName", "artistId", "trackId")
        )
    if layer_name == "analytics_quarantine":
        return "|".join(str(row.get(key, "unknown")) for key in ("eventId", "eventName", "reason"))
    return str(row.get("eventId") or row.get("factId") or "unknown")


if __name__ == "__main__":
    logging.getLogger().setLevel(logging.INFO)
    build_pipeline()
