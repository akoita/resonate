# =============================================================================
# Secret Manager — Centralized secrets for all services
# =============================================================================
# Secrets are referenced by Cloud Run services via secret volume mounts
# or environment variable references. Never stored as plain env vars.

locals {
  secrets = {
    "jwt-secret"        = var.jwt_secret
    "db-password"       = var.db_password
    "google-ai-api-key" = var.google_ai_api_key
    "sepolia-rpc-url"   = var.sepolia_rpc_url
    "deployer-key"      = var.deployer_private_key
  }
}

resource "google_secret_manager_secret" "secrets" {
  for_each = local.secrets

  secret_id = "resonate-${var.environment}-${each.key}"
  project   = var.project_id

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret_version" "secret_values" {
  for_each = local.secrets

  secret      = google_secret_manager_secret.secrets[each.key].id
  secret_data = each.value
}

# Grant Cloud Run service account access to secrets
resource "google_secret_manager_secret_iam_member" "cloud_run_access" {
  for_each = local.secrets

  secret_id = google_secret_manager_secret.secrets[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

# Dedicated service account for Cloud Run services
resource "google_service_account" "cloud_run" {
  account_id   = "resonate-${var.environment}-cloudrun"
  display_name = "Resonate ${var.environment} Cloud Run"
  project      = var.project_id
}

# Grant Cloud Run SA permission to connect to Cloud SQL
resource "google_project_iam_member" "cloud_run_sql" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}
