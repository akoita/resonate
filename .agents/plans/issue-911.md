# Issue #911: Analytics Dataflow Flex Template Artifact

## Goal

Publish the `workers/analytics-dataflow` processor as a reusable Dataflow Flex
Template artifact so `resonate-iac` can launch the staging analytics Dataflow
job.

## Implementation Plan

1. Add a GitHub Actions workflow that authenticates with GCP through existing
   Workload Identity Federation secrets.
2. Build and push `workers/analytics-dataflow/Dockerfile` to the target
   environment Artifact Registry repository.
3. Publish `template.json` to a stable GCS path using the existing
   `build-flex-template.sh` script.
4. Emit the resolved image URI, template path, staging location, temp location,
   and bucket names in the workflow summary for `resonate-iac` operators.
5. Document the default staging bucket/path convention and the exact
   `resonate-iac` workflow inputs.
6. Verify YAML syntax, worker tests, shell script syntax, and security scans.

## Default Staging Convention

```text
IMAGE_URI=<region>-docker.pkg.dev/<project>/resonate-staging/analytics-dataflow:<sha>
TEMPLATE_GCS_PATH=gs://<project>-analytics-dataflow/templates/staging/analytics-dataflow/template.json
analytics_dataflow_staging_location=gs://<project>-analytics-dataflow/staging/staging/analytics-dataflow
analytics_dataflow_temp_location=gs://<project>-analytics-dataflow/temp/staging/analytics-dataflow
```

## Verification

- `ruby -e 'require "yaml"; YAML.load_file(".github/workflows/publish-analytics-dataflow-flex-template.yml")'`
- `bash -n workers/analytics-dataflow/build-flex-template.sh`
- `cd workers/analytics-dataflow && python -m unittest test_analytics_transform.py`
- `git diff --check`
