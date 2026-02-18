# =============================================================================
# Artifact Registry — Private Docker image repository
# =============================================================================

resource "google_artifact_registry_repository" "docker" {
  location      = var.region
  repository_id = "resonate-${var.environment}"
  format        = "DOCKER"
  description   = "Resonate ${var.environment} Docker images"

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"

    most_recent_versions {
      keep_count = 10
    }
  }

  depends_on = [google_project_service.apis["artifactregistry.googleapis.com"]]
}

# Grant Cloud Run SA permission to pull images
resource "google_artifact_registry_repository_iam_member" "cloud_run_reader" {
  location   = google_artifact_registry_repository.docker.location
  repository = google_artifact_registry_repository.docker.repository_id
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.cloud_run.email}"
}
