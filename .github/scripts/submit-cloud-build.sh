#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF' >&2
Usage: submit-cloud-build.sh \
  --image <image-ref> \
  --context <context-dir> \
  --dockerfile <dockerfile-relative-to-context> \
  [--build-args-file <path>] \
  [--service-account <service-account-email>] \
  [--project <gcp-project-id>] \
  [--timeout <duration>]
EOF
  exit 1
}

image=""
context_dir=""
dockerfile=""
build_args_file=""
service_account=""
project_id="${GCP_PROJECT_ID:-}"
timeout="1800s"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image)
      image="${2:-}"
      shift 2
      ;;
    --context)
      context_dir="${2:-}"
      shift 2
      ;;
    --dockerfile)
      dockerfile="${2:-}"
      shift 2
      ;;
    --build-args-file)
      build_args_file="${2:-}"
      shift 2
      ;;
    --service-account)
      service_account="${2:-}"
      shift 2
      ;;
    --project)
      project_id="${2:-}"
      shift 2
      ;;
    --timeout)
      timeout="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      ;;
  esac
done

if [[ -z "${image}" || -z "${context_dir}" || -z "${dockerfile}" || -z "${project_id}" ]]; then
  usage
fi

if [[ ! -d "${context_dir}" ]]; then
  echo "Build context directory does not exist: ${context_dir}" >&2
  exit 1
fi

if [[ ! -f "${context_dir}/${dockerfile}" ]]; then
  echo "Dockerfile does not exist relative to context: ${context_dir}/${dockerfile}" >&2
  exit 1
fi

if [[ -n "${build_args_file}" && ! -f "${build_args_file}" ]]; then
  echo "Build args file does not exist: ${build_args_file}" >&2
  exit 1
fi

config_file="$(mktemp)"
cleanup() {
  rm -f "${config_file}"
}
trap cleanup EXIT

IMAGE="${image}" \
DOCKERFILE="${dockerfile}" \
BUILD_ARGS_FILE="${build_args_file}" \
SERVICE_ACCOUNT="${service_account}" \
python3 - <<'PY' > "${config_file}"
import json
import os

image = os.environ["IMAGE"]
dockerfile = os.environ["DOCKERFILE"]
build_args_file = os.environ.get("BUILD_ARGS_FILE", "")
service_account = os.environ.get("SERVICE_ACCOUNT", "")

args = ["build", "-f", dockerfile, "-t", image]

if build_args_file:
    with open(build_args_file, "r", encoding="utf-8") as fh:
        for raw_line in fh:
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            args.extend(["--build-arg", line])

args.append(".")

config = {
    "steps": [
        {
            "name": "gcr.io/cloud-builders/docker",
            "args": args,
        }
    ],
    "images": [image],
    "options": {
        "logging": "CLOUD_LOGGING_ONLY",
    },
}

if service_account:
    config["serviceAccount"] = service_account

print(json.dumps(config))
PY

submit_args=(
  builds
  submit
  "${context_dir}"
  --project "${project_id}"
  --config "${config_file}"
  --timeout "${timeout}"
)

if [[ -n "${service_account}" ]]; then
  submit_args+=(--service-account "${service_account}")
fi

gcloud "${submit_args[@]}"
