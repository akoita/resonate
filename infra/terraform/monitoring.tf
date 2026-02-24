# =============================================================================
# Cloud Monitoring — Uptime checks, alerting, dashboards
# =============================================================================

# Notification channel (email-based for dev)
resource "google_monitoring_notification_channel" "email" {
  count = length(var.iap_authorized_members) > 0 ? 1 : 0

  display_name = "Resonate ${var.environment} alerts"
  type         = "email"

  labels = {
    email_address = replace(var.iap_authorized_members[0], "user:", "")
  }
}

# --- Uptime Checks ---

resource "google_monitoring_uptime_check_config" "backend_health" {
  display_name = "resonate-${var.environment}-backend-health"
  timeout      = "10s"
  period       = "300s" # Every 5 minutes

  http_check {
    path         = "/health"
    port         = 443
    use_ssl      = true
  }

  monitored_resource {
    type = "cloud_run_revision"
    labels = {
      project_id         = var.project_id
      service_name       = google_cloud_run_v2_service.backend.name
      location           = var.region
      configuration_name = ""
      revision_name      = ""
    }
  }
}

# --- Alert Policies ---

# Alert on Cloud Run 5xx errors
resource "google_monitoring_alert_policy" "backend_errors" {
  display_name = "Resonate Backend — High Error Rate"
  combiner     = "OR"

  conditions {
    display_name = "5xx error rate > 5%"

    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_v2_service.backend.name}\" AND metric.type=\"run.googleapis.com/request_count\" AND metric.labels.response_code_class=\"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = 5
      duration        = "300s"

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }

  notification_channels = length(google_monitoring_notification_channel.email) > 0 ? [google_monitoring_notification_channel.email[0].id] : []

  alert_strategy {
    auto_close = "1800s" # Auto-close after 30 minutes
  }

  depends_on = [google_project_service.apis["monitoring.googleapis.com"]]
}

# Alert on Cloud SQL high CPU
resource "google_monitoring_alert_policy" "db_cpu" {
  display_name = "Resonate DB — High CPU"
  combiner     = "OR"

  conditions {
    display_name = "CPU utilization > 80%"

    condition_threshold {
      filter          = "resource.type=\"cloudsql_database\" AND resource.labels.database_id=\"${var.project_id}:${google_sql_database_instance.postgres.name}\" AND metric.type=\"cloudsql.googleapis.com/database/cpu/utilization\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8
      duration        = "300s"

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = length(google_monitoring_notification_channel.email) > 0 ? [google_monitoring_notification_channel.email[0].id] : []

  alert_strategy {
    auto_close = "1800s"
  }

  depends_on = [google_project_service.apis["monitoring.googleapis.com"]]
}
