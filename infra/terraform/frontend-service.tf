# =============================================================================
# Cloud Run — Frontend (Next.js Standalone)
# =============================================================================

locals {
  frontend_image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.docker.repository_id}/frontend:latest"
}

resource "google_cloud_run_v2_service" "frontend" {
  name     = "resonate-${var.environment}-frontend"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"  # TODO: restrict to INTERNAL_LOAD_BALANCER once LB + IAP is configured

  template {
    service_account = google_service_account.cloud_run.email

    scaling {
      min_instance_count = var.frontend_min_instances
      max_instance_count = 4
    }

    vpc_access {
      connector = google_vpc_access_connector.connector.id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = local.frontend_image

      ports {
        container_port = 3000
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      env {
        name  = "HOSTNAME"
        value = "0.0.0.0"
      }

      # Point frontend rewrites to the backend Cloud Run service (internal URL)
      env {
        name  = "NEXT_PUBLIC_API_URL"
        value = "https://resonate-${var.environment}-backend-${data.google_project.project.number}.${var.region}.run.app"
      }

      env {
        name  = "NEXT_PUBLIC_CHAIN_ID"
        value = "11155111"
      }

      env {
        name  = "NEXT_PUBLIC_STEM_NFT_ADDRESS"
        value = var.stem_nft_address
      }

      env {
        name  = "NEXT_PUBLIC_MARKETPLACE_ADDRESS"
        value = var.marketplace_address
      }

      env {
        name  = "NEXT_PUBLIC_ZERODEV_PROJECT_ID"
        value = var.zerodev_project_id
      }

      env {
        name  = "NEXT_PUBLIC_PASSKEY_SERVER_URL"
        value = var.passkey_server_url
      }

      startup_probe {
        http_get {
          path = "/"
        }
        initial_delay_seconds = 5
        period_seconds        = 5
        failure_threshold     = 10
      }

      liveness_probe {
        http_get {
          path = "/"
        }
        period_seconds    = 30
        failure_threshold = 3
      }
    }
  }

  depends_on = [
    google_project_service.apis["run.googleapis.com"],
    google_cloud_run_v2_service.backend,
  ]
}

# Data source for project number (used in Cloud Run URLs)
data "google_project" "project" {
  project_id = var.project_id
}
