# =============================================================================
# Identity-Aware Proxy (IAP) — Access control for dev environment
# =============================================================================
# IAP authenticates users with their Google account before they can access
# the Cloud Run services. Only whitelisted members are allowed through.
# This replaces the need for a VPN — simpler, more secure, cloud-native.

# Allow unauthenticated access for testing (no load balancer/IAP yet)
# TODO: Remove these two resources and switch ingress back to
# INTERNAL_LOAD_BALANCER once a load balancer + IAP is configured.
resource "google_cloud_run_v2_service_iam_member" "backend_public" {
  name     = google_cloud_run_v2_service.backend.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "frontend_public" {
  name     = google_cloud_run_v2_service.frontend.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Backend service account invoker
resource "google_cloud_run_v2_service_iam_member" "backend_invoker" {
  name     = google_cloud_run_v2_service.backend.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.cloud_run.email}"
}

# Frontend service account invoker
resource "google_cloud_run_v2_service_iam_member" "frontend_invoker" {
  name     = google_cloud_run_v2_service.frontend.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.cloud_run.email}"
}

# Allow authorized users to invoke services via IAP
resource "google_cloud_run_v2_service_iam_member" "backend_authorized_users" {
  for_each = toset(var.iap_authorized_members)

  name     = google_cloud_run_v2_service.backend.name
  location = var.region
  role     = "roles/run.invoker"
  member   = each.value
}

resource "google_cloud_run_v2_service_iam_member" "frontend_authorized_users" {
  for_each = toset(var.iap_authorized_members)

  name     = google_cloud_run_v2_service.frontend.name
  location = var.region
  role     = "roles/run.invoker"
  member   = each.value
}
