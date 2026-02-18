# =============================================================================
# Cloud Run — Backend (NestJS + Prisma)
# =============================================================================

locals {
  backend_image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.docker.repository_id}/backend:latest"

  # Build the DATABASE_URL from Cloud SQL components
  database_url = "postgresql://resonate:${var.db_password}@${google_sql_database_instance.postgres.private_ip_address}:5432/resonate"
}

resource "google_cloud_run_v2_service" "backend" {
  name     = "resonate-${var.environment}-backend"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"

  template {
    service_account = google_service_account.cloud_run.email

    scaling {
      min_instance_count = var.backend_min_instances
      max_instance_count = 4
    }

    vpc_access {
      connector = google_vpc_access_connector.connector.id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = local.backend_image

      ports {
        container_port = 3000
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      # Non-sensitive environment variables
      env {
        name  = "NODE_ENV"
        value = "production"
      }

      env {
        name  = "PORT"
        value = "3000"
      }

      env {
        name  = "ENABLE_CONTRACT_INDEXER"
        value = var.stem_nft_address != "" ? "true" : "false"
      }

      env {
        name  = "STEM_NFT_ADDRESS"
        value = var.stem_nft_address
      }

      env {
        name  = "MARKETPLACE_ADDRESS"
        value = var.marketplace_address
      }

      env {
        name  = "TRANSFER_VALIDATOR_ADDRESS"
        value = var.transfer_validator_address
      }

      env {
        name  = "AA_CHAIN_ID"
        value = "11155111"
      }

      env {
        name  = "BLOCK_EXPLORER_URL"
        value = "https://sepolia.etherscan.io"
      }

      env {
        name  = "AGENT_RUNTIME"
        value = "adk"
      }

      # Database URL (contains password — from Secret Manager)
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.secrets["db-password"].secret_id
            version = "latest"
          }
        }
      }

      # Redis URL
      env {
        name  = "REDIS_URL"
        value = "redis://${google_redis_instance.redis.host}:${google_redis_instance.redis.port}"
      }

      # Secrets from Secret Manager
      env {
        name = "JWT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.secrets["jwt-secret"].secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "RPC_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.secrets["sepolia-rpc-url"].secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "GOOGLE_AI_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.secrets["google-ai-api-key"].secret_id
            version = "latest"
          }
        }
      }

      startup_probe {
        http_get {
          path = "/health"
        }
        initial_delay_seconds = 10
        period_seconds        = 5
        failure_threshold     = 10
      }

      liveness_probe {
        http_get {
          path = "/health"
        }
        period_seconds    = 30
        failure_threshold = 3
      }
    }
  }

  depends_on = [
    google_project_service.apis["run.googleapis.com"],
    google_secret_manager_secret_version.secret_values,
  ]
}
