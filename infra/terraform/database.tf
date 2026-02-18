# =============================================================================
# Cloud SQL — PostgreSQL 16 (Private IP only)
# =============================================================================

resource "google_sql_database_instance" "postgres" {
  name             = "resonate-${var.environment}-db"
  database_version = "POSTGRES_16"
  region           = var.region

  settings {
    tier              = var.db_tier
    availability_type = "ZONAL" # Use REGIONAL for prod
    disk_autoresize   = true
    disk_size         = 10
    disk_type         = "PD_SSD"

    ip_configuration {
      ipv4_enabled                                  = false # No public IP
      private_network                               = google_compute_network.vpc.id
      enable_private_path_for_google_cloud_services  = true
    }

    backup_configuration {
      enabled                        = true
      start_time                     = "03:00"
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7

      backup_retention_settings {
        retained_backups = 7
      }
    }

    maintenance_window {
      day          = 7 # Sunday
      hour         = 4
      update_track = "stable"
    }

    database_flags {
      name  = "log_statement"
      value = "all"
    }
  }

  deletion_protection = false # Set to true for production

  depends_on = [
    google_service_networking_connection.private_vpc_connection,
    google_project_service.apis["sqladmin.googleapis.com"],
  ]
}

resource "google_sql_database" "resonate" {
  name     = "resonate"
  instance = google_sql_database_instance.postgres.name
}

resource "google_sql_user" "resonate" {
  name     = "resonate"
  instance = google_sql_database_instance.postgres.name
  password = var.db_password
}
