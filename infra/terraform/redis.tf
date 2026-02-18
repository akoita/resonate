# =============================================================================
# Memorystore Redis 7 (Private network only)
# =============================================================================

resource "google_redis_instance" "redis" {
  name           = "resonate-${var.environment}-redis"
  tier           = "BASIC" # Use STANDARD_HA for prod
  memory_size_gb = var.redis_memory_gb
  region         = var.region
  redis_version  = "REDIS_7_0"

  authorized_network = google_compute_network.vpc.id
  connect_mode       = "PRIVATE_SERVICE_ACCESS"

  redis_configs = {
    maxmemory-policy = "allkeys-lru"
  }

  maintenance_policy {
    weekly_maintenance_window {
      day = "SUNDAY"
      start_time {
        hours   = 4
        minutes = 0
      }
    }
  }

  depends_on = [
    google_service_networking_connection.private_vpc_connection,
    google_project_service.apis["redis.googleapis.com"],
  ]
}
