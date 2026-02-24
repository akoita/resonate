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
  ingress  = "INGRESS_TRAFFIC_ALL"  # TODO: restrict to INTERNAL_LOAD_BALANCER once LB + IAP is configured

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
          memory = "1Gi"
        }
      }

      # Non-sensitive environment variables
      env {
        name  = "NODE_ENV"
        value = "production"
      }

      env {
        name  = "CORS_ORIGIN"
        value = var.frontend_url
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
        name  = "AA_BUNDLER"
        value = "https://api.pimlico.io/v2/11155111/rpc?apikey=${var.pimlico_api_key}"
      }

      env {
        name  = "BLOCK_EXPLORER_URL"
        value = "https://sepolia.etherscan.io"
      }

      env {
        name  = "AGENT_RUNTIME"
        value = "adk"
      }

      # Demucs worker URL (CPU on Cloud Run or GPU on GCE)
      env {
        name  = "DEMUCS_WORKER_URL"
        value = (
          var.demucs_cpu_enabled
            ? google_cloud_run_v2_service.demucs_cpu[0].uri
            : var.demucs_gpu_enabled
              ? "http://${google_compute_address.demucs_internal[0].address}:8000"
              : ""
        )
      }

      # Backend's own URL — passed to Demucs worker for progress callbacks & used for metadata URIs
      env {
        name  = "BACKEND_URL"
        value = "https://resonate-${var.environment}-backend-${data.google_project.project.number}.${var.region}.run.app"
      }

      env {
        name  = "FRONTEND_URL"
        value = var.frontend_url
      }

      # GCS storage for original stems (avoids ephemeral disk loss on Cloud Run)
      env {
        name  = "STORAGE_PROVIDER"
        value = local.demucs_enabled ? "gcs" : "local"
      }

      env {
        name  = "GCS_STEMS_BUCKET"
        value = var.gcs_stems_bucket
      }

      # Phase 2: Event-driven stem processing via Pub/Sub
      env {
        name  = "STEM_PROCESSING_MODE"
        value = "pubsub"
      }

      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }

      # Admin addresses (comma-separated) — auto-promoted to admin role on login
      env {
        name  = "ADMIN_ADDRESSES"
        value = var.admin_addresses
      }

      # Safety gate for DELETE /admin/wipe-releases (dev/staging only)
      env {
        name  = "ENABLE_DEV_WIPE"
        value = var.enable_dev_wipe ? "true" : "false"
      }

      # Database URL (connection via private VPC — not exposed externally)
      env {
        name  = "DATABASE_URL"
        value = local.database_url
      }

      # Redis URL
      env {
        name  = "REDIS_URL"
        value = "redis://${google_redis_instance.redis.host}:${google_redis_instance.redis.port}"
      }

      env {
        name  = "REDIS_HOST"
        value = google_redis_instance.redis.host
      }

      env {
        name  = "REDIS_PORT"
        value = "${google_redis_instance.redis.port}"
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
        initial_delay_seconds = 15
        period_seconds        = 10
        failure_threshold     = 12
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
