#!/usr/bin/env bash
set -euo pipefail

: "${IMAGE_URI:?Set IMAGE_URI to the Artifact Registry image URI for the analytics Dataflow container.}"
: "${TEMPLATE_GCS_PATH:?Set TEMPLATE_GCS_PATH to the gs:// path for the Flex Template container spec JSON.}"

gcloud dataflow flex-template build "${TEMPLATE_GCS_PATH}" \
  --image "${IMAGE_URI}" \
  --sdk-language PYTHON \
  --metadata-file metadata.json
