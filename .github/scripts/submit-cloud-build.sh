#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF' >&2
Usage: submit-cloud-build.sh \
  --image <image-ref> \
  --context <context-dir> \
  --dockerfile <dockerfile-relative-to-context> \
  --metadata-output <path> \
  [--build-args-file <path>] \
  [--content-tag <tag>] \
  [--force-rebuild] \
  [--git-source-url <https-repo-url>] \
  [--git-source-revision <git-revision>] \
  [--service-account <service-account-email>] \
  [--project <gcp-project-id>] \
  [--billing-project <gcp-project-id>] \
  [--gcs-source-staging-dir <gs://bucket/prefix>] \
  [--polling-interval <seconds>] \
  [--timeout <duration>]

--content-tag makes the build content-addressed. The caller supplies a tag that
is a complete key for the build inputs (for the self-contained context
directories used by CI this is the git tree hash of the context). When that tag
already exists in the target repository the existing image is reused: the
requested tag is pointed at the cached digest, the same outputs and metadata are
emitted, and no Cloud Build is submitted. When it does not exist the image is
built and pushed under both the requested tag and the content tag.

Set --force-rebuild, or the CI_FORCE_IMAGE_REBUILD environment variable to
1/true/yes, to bypass a poisoned or otherwise unwanted cache entry without
changing any source file.
EOF
  exit 1
}

is_truthy() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1 | true | yes | on) return 0 ;;
    *) return 1 ;;
  esac
}

image=""
context_dir=""
dockerfile=""
metadata_output=""
build_args_file=""
content_tag=""
force_rebuild="false"
if is_truthy "${CI_FORCE_IMAGE_REBUILD:-}"; then
  force_rebuild="true"
fi
git_source_url=""
git_source_revision=""
service_account=""
project_id="${GCP_PROJECT_ID:-}"
billing_project="${GCP_BILLING_QUOTA_PROJECT:-}"
gcs_source_staging_dir="${GCP_CLOUD_BUILD_SOURCE_STAGING_DIR:-}"
polling_interval="${GCP_CLOUD_BUILD_POLLING_INTERVAL_SECONDS:-10}"
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
    --metadata-output)
      metadata_output="${2:-}"
      shift 2
      ;;
    --build-args-file)
      build_args_file="${2:-}"
      shift 2
      ;;
    --content-tag)
      content_tag="${2:-}"
      shift 2
      ;;
    --force-rebuild)
      force_rebuild="true"
      shift
      ;;
    --git-source-url)
      git_source_url="${2:-}"
      shift 2
      ;;
    --git-source-revision)
      git_source_revision="${2:-}"
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
    --billing-project)
      billing_project="${2:-}"
      shift 2
      ;;
    --gcs-source-staging-dir)
      gcs_source_staging_dir="${2:-}"
      shift 2
      ;;
    --polling-interval)
      polling_interval="${2:-}"
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

if [[ -z "${image}" || -z "${context_dir}" || -z "${dockerfile}" || -z "${metadata_output}" || -z "${project_id}" ]]; then
  usage
fi

billing_project="${billing_project:-${project_id}}"
gcs_source_staging_dir="${gcs_source_staging_dir:-gs://${project_id}_cloudbuild/source}"

remote_source=false
if [[ -n "${git_source_url}" || -n "${git_source_revision}" ]]; then
  remote_source=true
fi

if [[ "${remote_source}" == "true" && ( -z "${git_source_url}" || -z "${git_source_revision}" ) ]]; then
  echo "Both --git-source-url and --git-source-revision are required together." >&2
  exit 1
fi

if [[ "${remote_source}" == "false" && ! -d "${context_dir}" ]]; then
  echo "Build context directory does not exist: ${context_dir}" >&2
  exit 1
fi

if [[ "${remote_source}" == "false" && ! -f "${context_dir}/${dockerfile}" ]]; then
  echo "Dockerfile does not exist relative to context: ${context_dir}/${dockerfile}" >&2
  exit 1
fi

if [[ -n "${build_args_file}" && ! -f "${build_args_file}" ]]; then
  echo "Build args file does not exist: ${build_args_file}" >&2
  exit 1
fi

image_leaf="${image##*/}"
if [[ "${image_leaf}" != *:* || "${image_leaf}" == *@* ]]; then
  echo "Expected an explicitly tagged image reference, got: ${image}" >&2
  exit 1
fi
image_repository="${image%:*}"

content_image=""
if [[ -n "${content_tag}" ]]; then
  if [[ ! "${content_tag}" =~ ^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$ ]]; then
    echo "Invalid content tag (must be a valid Docker tag): ${content_tag}" >&2
    exit 1
  fi
  content_image="${image_repository}:${content_tag}"
fi

normalized_service_account=""
if [[ -n "${service_account}" ]]; then
  if [[ "${service_account}" == projects/*/serviceAccounts/* ]]; then
    normalized_service_account="${service_account}"
  else
    normalized_service_account="projects/${project_id}/serviceAccounts/${service_account}"
  fi
fi

config_file="$(mktemp)"
build_result_file="$(mktemp)"
describe_error_file="$(mktemp)"
cleanup() {
  rm -f "${config_file}" "${build_result_file}" "${describe_error_file}"
}
trap cleanup EXIT

# Resolve the sha256 digest an Artifact Registry reference currently points at.
# Prints the digest and returns 0 on success; returns 1 when the reference does
# not resolve (missing tag, permission problem, transient registry error). A
# failure is always safe to treat as "not cached": it only costs a rebuild.
resolve_image_digest() {
  local reference="$1"
  local attempts="$2"
  local attempt
  local value

  for ((attempt = 1; attempt <= attempts; attempt++)); do
    value="$(gcloud artifacts docker images describe "${reference}" \
      --project "${project_id}" \
      --format='value(image_summary.digest)' 2>"${describe_error_file}" || true)"
    value="${value//$'\r'/}"
    value="${value//$'\n'/}"
    if [[ "${value}" =~ ^sha256:[0-9a-f]{64}$ ]]; then
      printf '%s' "${value}"
      return 0
    fi
    if ((attempt < attempts)); then
      sleep 5
    fi
  done

  return 1
}

# Write the build evidence file and the step outputs. Used by both the build
# path and the content-addressed reuse path so they stay byte-for-byte
# compatible for every field publish-image-evidence validates.
write_build_metadata() {
  local digest="$1"
  local build_id="$2"
  local reused_from="$3"

  IMAGE="${image}" \
  DIGEST="${digest}" \
  BUILD_ID="${build_id}" \
  SOURCE_SHA="${git_source_revision:-${GITHUB_SHA:-}}" \
  METADATA_OUTPUT="${metadata_output}" \
  CONTENT_TAG="${content_tag}" \
  REUSED_FROM="${reused_from}" \
  python3 - <<'PY'
import json
import os
from pathlib import Path

image = os.environ["IMAGE"]
digest = os.environ["DIGEST"]
content_tag = os.environ.get("CONTENT_TAG", "")
reused_from = os.environ.get("REUSED_FROM", "")
repository, separator, tag = image.rpartition(":")
if not separator or not repository or not tag or "@" in image.rsplit("/", 1)[-1]:
    raise SystemExit(f"Expected an explicitly tagged image reference, got: {image}")

metadata = {
    "cloud_build_id": os.environ["BUILD_ID"],
    "digest": digest,
    "immutable_ref": f"{repository}@{digest}",
    "source_sha": os.environ["SOURCE_SHA"],
    "tag": image,
}
if content_tag:
    metadata["content_tag"] = content_tag
    metadata["content_ref"] = f"{repository}:{content_tag}"
    metadata["reused"] = bool(reused_from)
    if reused_from:
        metadata["reused_from"] = reused_from
output = Path(os.environ["METADATA_OUTPUT"])
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")

github_output = os.environ.get("GITHUB_OUTPUT")
if github_output:
    with open(github_output, "a", encoding="utf-8") as handle:
        handle.write(f"image_digest={digest}\n")
        handle.write(f"image_ref={metadata['immutable_ref']}\n")
        handle.write(f"build_id={metadata['cloud_build_id']}\n")
        handle.write(f"evidence_path={output}\n")
PY
}

if [[ -n "${content_image}" ]]; then
  if [[ "${force_rebuild}" == "true" ]]; then
    echo "Content-addressed reuse DISABLED (force rebuild requested); rebuilding ${image}."
  else
    echo "Content-addressed reuse: looking up ${content_image}"
    cached_digest=""
    if cached_digest="$(resolve_image_digest "${content_image}" 1)"; then
      echo "Content-addressed reuse HIT: ${content_image} -> ${cached_digest}"
      echo "Build inputs are unchanged, so no Cloud Build is submitted."

      current_target_digest=""
      if current_target_digest="$(resolve_image_digest "${image}" 1)" && [[ "${current_target_digest}" == "${cached_digest}" ]]; then
        echo "Target tag ${image} already points to ${cached_digest}; skipping tag addition."
      else
        gcloud artifacts docker tags add "${content_image}" "${image}" \
          --project "${project_id}" \
          --quiet
      fi

      confirmed_digest=""
      if ! confirmed_digest="$(resolve_image_digest "${image}" 6)"; then
        echo "Artifact Registry did not return one valid sha256 digest for ${image}." >&2
        exit 1
      fi
      if [[ "${confirmed_digest}" != "${cached_digest}" ]]; then
        echo "Tag ${image} resolves to ${confirmed_digest}, expected ${cached_digest}." >&2
        exit 1
      fi

      write_build_metadata \
        "${cached_digest}" \
        "reused-content-tag:${content_tag}" \
        "${content_image}"
      exit 0
    fi

    echo "Content-addressed reuse MISS: ${content_image} did not resolve; building."
    if [[ -s "${describe_error_file}" ]]; then
      echo "Registry lookup output for ${content_image}:" >&2
      cat "${describe_error_file}" >&2
    fi
  fi
fi

IMAGE="${image}" \
CONTENT_IMAGE="${content_image}" \
DOCKERFILE="${dockerfile}" \
BUILD_ARGS_FILE="${build_args_file}" \
CONTEXT_DIR="${context_dir}" \
REMOTE_SOURCE="${remote_source}" \
SERVICE_ACCOUNT="${normalized_service_account}" \
python3 - <<'PY' > "${config_file}"
import json
import os

image = os.environ["IMAGE"]
content_image = os.environ.get("CONTENT_IMAGE", "")
dockerfile = os.environ["DOCKERFILE"]
build_args_file = os.environ.get("BUILD_ARGS_FILE", "")
context_dir = os.environ["CONTEXT_DIR"]
remote_source = os.environ["REMOTE_SOURCE"] == "true"
service_account = os.environ.get("SERVICE_ACCOUNT", "")

if remote_source:
    dockerfile_path = f"{context_dir}/{dockerfile}"
    build_context = context_dir
else:
    dockerfile_path = dockerfile
    build_context = "."

args = ["build", "-f", dockerfile_path, "-t", image]

if content_image:
    args.extend(["-t", content_image])

if build_args_file:
    with open(build_args_file, "r", encoding="utf-8") as fh:
        for raw_line in fh:
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            args.extend(["--build-arg", line])

args.append(build_context)

config = {
    "steps": [
        {
            "name": "gcr.io/cloud-builders/docker",
            "args": args,
        }
    ],
    "images": [image] + ([content_image] if content_image else []),
    "options": {
        "logging": "CLOUD_LOGGING_ONLY",
    },
}

if service_account:
    config["serviceAccount"] = service_account

print(json.dumps(config))
PY

if [[ "${remote_source}" == "true" ]]; then
  submit_args=(
    builds
    submit
    "${git_source_url}"
    --git-source-revision "${git_source_revision}"
    --project "${project_id}"
    --billing-project "${billing_project}"
    --config "${config_file}"
    --gcs-source-staging-dir "${gcs_source_staging_dir}"
    --polling-interval "${polling_interval}"
    --timeout "${timeout}"
  )
else
  submit_args=(
    builds
    submit
    "${context_dir}"
    --project "${project_id}"
    --billing-project "${billing_project}"
    --config "${config_file}"
    --gcs-source-staging-dir "${gcs_source_staging_dir}"
    --polling-interval "${polling_interval}"
    --timeout "${timeout}"
  )
fi

if [[ -n "${normalized_service_account}" ]]; then
  submit_args+=(--service-account "${normalized_service_account}")
fi

gcloud "${submit_args[@]}" --format=json | tee "${build_result_file}"

build_id="$({ BUILD_RESULT_FILE="${build_result_file}" python3 - <<'PY'
import json
import os
import sys

with open(os.environ["BUILD_RESULT_FILE"], "r", encoding="utf-8") as handle:
    result = json.load(handle)

build_id = result.get("id", "")
status = result.get("status", "")
if not build_id:
    raise SystemExit("Cloud Build result did not include a build id")
if status != "SUCCESS":
    raise SystemExit(f"Cloud Build did not finish successfully: {status or 'missing status'}")
print(build_id)
PY
})"

digest=""
if ! digest="$(resolve_image_digest "${image}" 6)"; then
  if [[ -s "${describe_error_file}" ]]; then
    cat "${describe_error_file}" >&2
  fi
  echo "Artifact Registry did not return one valid sha256 digest for ${image}." >&2
  exit 1
fi

write_build_metadata "${digest}" "${build_id}" ""
