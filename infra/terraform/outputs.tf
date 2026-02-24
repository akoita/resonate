# =============================================================================
# Outputs — URLs, connection strings, useful references
# =============================================================================
# ⚠️  Sensitive outputs are marked — they won't appear in `terraform output`
#     unless explicitly requested with `terraform output -json`

output "backend_url" {
  description = "Cloud Run backend service URL"
  value       = google_cloud_run_v2_service.backend.uri
}

output "frontend_url" {
  description = "Cloud Run frontend service URL"
  value       = google_cloud_run_v2_service.frontend.uri
}

output "docker_registry" {
  description = "Artifact Registry URL for docker push"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.docker.repository_id}"
}

output "database_connection_name" {
  description = "Cloud SQL connection name (for Cloud SQL Proxy)"
  value       = google_sql_database_instance.postgres.connection_name
}

output "database_private_ip" {
  description = "Cloud SQL private IP address"
  value       = google_sql_database_instance.postgres.private_ip_address
  sensitive   = true
}

output "redis_host" {
  description = "Memorystore Redis host"
  value       = google_redis_instance.redis.host
  sensitive   = true
}

output "redis_port" {
  description = "Memorystore Redis port"
  value       = google_redis_instance.redis.port
}

output "cloud_run_service_account" {
  description = "Cloud Run service account email"
  value       = google_service_account.cloud_run.email
}

output "vpc_connector_name" {
  description = "VPC Access Connector name"
  value       = google_vpc_access_connector.connector.name
}

# Demucs Worker
output "demucs_worker_url" {
  description = "Demucs worker URL (Cloud Run or GCE internal IP)"
  value = (
    var.demucs_cpu_enabled
      ? google_cloud_run_v2_service.demucs_cpu[0].uri
      : var.demucs_gpu_enabled
        ? "http://${google_compute_address.demucs_internal[0].address}:8000"
        : null
  )
}

output "gcs_stems_bucket_url" {
  description = "GCS bucket URL for stem storage"
  value       = (var.demucs_cpu_enabled || var.demucs_gpu_enabled) ? "gs://${google_storage_bucket.stems[0].name}" : null
}
