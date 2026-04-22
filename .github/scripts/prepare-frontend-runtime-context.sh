#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF' >&2
Usage: prepare-frontend-runtime-context.sh \
  --artifact-dir <downloaded-artifact-dir> \
  --dockerfile-source <repo-dockerfile-path> \
  --output-dir <runtime-context-dir>
EOF
  exit 1
}

artifact_dir=""
dockerfile_source=""
output_dir=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --artifact-dir)
      artifact_dir="${2:-}"
      shift 2
      ;;
    --dockerfile-source)
      dockerfile_source="${2:-}"
      shift 2
      ;;
    --output-dir)
      output_dir="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      ;;
  esac
done

if [[ -z "${artifact_dir}" || -z "${dockerfile_source}" || -z "${output_dir}" ]]; then
  usage
fi

if [[ ! -d "${artifact_dir}/.next/standalone" ]]; then
  echo "Missing standalone build output in artifact directory: ${artifact_dir}/.next/standalone" >&2
  exit 1
fi

if [[ ! -d "${artifact_dir}/.next/static" ]]; then
  echo "Missing static build output in artifact directory: ${artifact_dir}/.next/static" >&2
  exit 1
fi

if [[ ! -d "${artifact_dir}/public" ]]; then
  echo "Missing public assets in artifact directory: ${artifact_dir}/public" >&2
  exit 1
fi

if [[ ! -f "${dockerfile_source}" ]]; then
  echo "Missing runtime Dockerfile: ${dockerfile_source}" >&2
  exit 1
fi

rm -rf "${output_dir}"
mkdir -p "${output_dir}/.next"

cp "${dockerfile_source}" "${output_dir}/Dockerfile"
cp -R "${artifact_dir}/.next/standalone" "${output_dir}/.next/standalone"
cp -R "${artifact_dir}/.next/static" "${output_dir}/.next/static"
cp -R "${artifact_dir}/public" "${output_dir}/public"
