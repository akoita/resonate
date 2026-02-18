# =============================================================================
# Workload Identity Federation — GitHub Actions → GCP (keyless auth)
# =============================================================================
# This allows GitHub Actions to authenticate to GCP without storing
# service account keys. Uses OIDC tokens from GitHub's identity provider.

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "resonate-github-pool"
  display_name              = "GitHub Actions"
  description               = "Workload Identity Pool for GitHub Actions CI/CD"
  project                   = var.project_id

  depends_on = [google_project_service.apis["iam.googleapis.com"]]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-provider"
  display_name                       = "GitHub"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.actor"      = "assertion.actor"
    "attribute.repository" = "assertion.repository"
  }

  attribute_condition = "assertion.repository == 'akoita/resonate'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# Service account for GitHub Actions
resource "google_service_account" "github_actions" {
  account_id   = "resonate-${var.environment}-github"
  display_name = "Resonate ${var.environment} GitHub Actions"
  project      = var.project_id
}

# Allow GitHub Actions to impersonate the SA
resource "google_service_account_iam_member" "github_wif" {
  service_account_id = google_service_account.github_actions.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/akoita/resonate"
}

# Grant GitHub Actions SA permissions
resource "google_project_iam_member" "github_ar_writer" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

resource "google_project_iam_member" "github_run_developer" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

resource "google_service_account_iam_member" "github_act_as_cloudrun" {
  service_account_id = google_service_account.cloud_run.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.github_actions.email}"
}
