from __future__ import annotations

import argparse
import logging
from typing import Iterable

import apache_beam as beam
from apache_beam.io import ReadFromPubSub, WriteToBigQuery
from apache_beam.options.pipeline_options import PipelineOptions, StandardOptions
from apache_beam.transforms import window

from analytics_transform import idempotency_key, parse_supported_versions, tagged_rows


LAYER_TO_PARAMETER = {
    "events_raw": "rawTable",
    "events_clean": "cleanTable",
    "analytics_facts": "factsTable",
    "analytics_views": "viewsTable",
    "analytics_quarantine": "quarantineTable",
}


def table_ref(project_id: str, dataset: str, table: str) -> str:
    return f"{project_id}:{dataset}.{table}"


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
            | "Window for idempotency" >> beam.WindowInto(window.FixedWindows(known_args.dedupeWindowSeconds))
            | "Key by event id" >> beam.Map(lambda payload: (idempotency_key(payload), payload))
            | "Dedupe within window" >> beam.CombinePerKey(first_payload)
            | "Drop dedupe key" >> beam.Values()
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
            rows | f"Write {layer_name}" >> WriteToBigQuery(
                table=table_ref(known_args.outputProjectId, known_args.outputDataset, table_name),
                create_disposition=beam.io.BigQueryDisposition.CREATE_NEVER,
                write_disposition=beam.io.BigQueryDisposition.WRITE_APPEND,
                method=WriteToBigQuery.Method.STREAMING_INSERTS,
            )


def first_payload(values: Iterable[bytes]) -> bytes:
    for value in values:
        return value
    raise ValueError("Cannot dedupe an empty payload group")


if __name__ == "__main__":
    logging.getLogger().setLevel(logging.INFO)
    build_pipeline()
