# =============================================================================
# Demucs Worker — AI Stem Separation (CPU on Cloud Run or GPU on GCE)
# =============================================================================
# Two deployment modes:
#   - demucs_cpu_enabled: Cloud Run with high CPU (no GPU quota needed, ~5-10 min/track)
#   - demucs_gpu_enabled: GCE with NVIDIA T4 GPU (~30 sec/track, needs GPU quota)

locals {
  demucs_enabled = var.demucs_cpu_enabled || var.demucs_gpu_enabled
  demucs_cpu_image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.docker.repository_id}/demucs-worker:latest"
}

# GCS bucket for stem storage (shared between worker and backend)
resource "google_storage_bucket" "stems" {
  count = local.demucs_enabled ? 1 : 0

  name          = var.gcs_stems_bucket
  location      = var.region
  force_destroy = true

  uniform_bucket_level_access = true

  lifecycle_rule {
    condition {
      age = 30 # Auto-delete stems after 30 days
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.apis["compute.googleapis.com"]]
}

# Service account for the Demucs worker
resource "google_service_account" "demucs_worker" {
  count = local.demucs_enabled ? 1 : 0

  account_id   = "resonate-demucs-${var.environment}"
  display_name = "Resonate Demucs Worker (${var.environment})"
}

# Grant GCS write access to worker SA
resource "google_storage_bucket_iam_member" "demucs_gcs_writer" {
  count = local.demucs_enabled ? 1 : 0

  bucket = google_storage_bucket.stems[0].name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.demucs_worker[0].email}"
}

# Allow public read access to stems bucket (backend downloads via HTTPS URLs)
# Stems are temporary (30-day auto-delete) and used only in the internal pipeline
resource "google_storage_bucket_iam_member" "stems_public_reader" {
  count = local.demucs_enabled ? 1 : 0

  bucket = google_storage_bucket.stems[0].name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# Grant backend Cloud Run SA objectAdmin on stems bucket
# (backend uploads originals to GCS before stem separation)
resource "google_storage_bucket_iam_member" "backend_gcs_writer" {
  count = local.demucs_enabled ? 1 : 0

  bucket = google_storage_bucket.stems[0].name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.cloud_run.email}"
}

# Grant Artifact Registry read access (to pull Docker images)
resource "google_artifact_registry_repository_iam_member" "demucs_reader" {
  count = local.demucs_enabled ? 1 : 0

  location   = google_artifact_registry_repository.docker.location
  repository = google_artifact_registry_repository.docker.repository_id
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.demucs_worker[0].email}"
}

# =============================================================================
# Option A: Cloud Run CPU Worker (demucs_cpu_enabled)
# =============================================================================

resource "google_cloud_run_v2_service" "demucs_cpu" {
  count = var.demucs_cpu_enabled ? 1 : 0

  name     = "resonate-${var.environment}-demucs"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.demucs_worker[0].email

    # Long timeout for CPU-based separation (up to 30 minutes)
    timeout = "1800s"

    scaling {
      min_instance_count = 1
      max_instance_count = 2
    }

    vpc_access {
      connector = google_vpc_access_connector.connector.id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = local.demucs_cpu_image

      ports {
        container_port = 8000
      }

      resources {
        limits = {
          cpu    = "4"
          memory = "8Gi"
        }
        cpu_idle = false  # Keep CPU allocated during request processing
      }

      env {
        name  = "STORAGE_MODE"
        value = "gcs"
      }

      env {
        name  = "GCS_BUCKET"
        value = var.gcs_stems_bucket
      }

      env {
        name  = "OUTPUT_DIR"
        value = "/outputs"
      }

      startup_probe {
        http_get {
          path = "/health"
          port = 8000
        }
        initial_delay_seconds = 30
        period_seconds        = 10
        failure_threshold     = 12
      }

      liveness_probe {
        http_get {
          path = "/health"
          port = 8000
        }
        period_seconds    = 60
        failure_threshold = 3
      }
    }
  }

  depends_on = [
    google_project_service.apis["run.googleapis.com"],
    google_storage_bucket.stems,
  ]
}

# Allow backend to invoke the CPU worker
resource "google_cloud_run_v2_service_iam_member" "demucs_cpu_invoker" {
  count = var.demucs_cpu_enabled ? 1 : 0

  name     = google_cloud_run_v2_service.demucs_cpu[0].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.cloud_run.email}"
}

# Allow unauthenticated access for testing
resource "google_cloud_run_v2_service_iam_member" "demucs_cpu_public" {
  count = var.demucs_cpu_enabled ? 1 : 0

  name     = google_cloud_run_v2_service.demucs_cpu[0].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# =============================================================================
# Option B: GCE GPU Worker (demucs_gpu_enabled)
# =============================================================================

# Static internal IP for stable backend → worker connectivity
resource "google_compute_address" "demucs_internal" {
  count = var.demucs_gpu_enabled ? 1 : 0

  name         = "resonate-${var.environment}-demucs-ip"
  subnetwork   = google_compute_subnetwork.main.id
  address_type = "INTERNAL"
  region       = var.region
}

# GCE instance with GPU
resource "google_compute_instance" "demucs_worker" {
  count = var.demucs_gpu_enabled ? 1 : 0

  name         = "resonate-${var.environment}-demucs"
  machine_type = var.demucs_machine_type
  zone         = "${var.region}-b"

  scheduling {
    preemptible       = true
    automatic_restart = false
  }

  boot_disk {
    initialize_params {
      image = "cos-cloud/cos-stable"
      size  = 50
      type  = "pd-ssd"
    }
  }

  guest_accelerator {
    type  = "nvidia-tesla-t4"
    count = 1
  }

  network_interface {
    subnetwork = google_compute_subnetwork.main.id
    network_ip = google_compute_address.demucs_internal[0].address
  }

  service_account {
    email  = google_service_account.demucs_worker[0].email
    scopes = ["cloud-platform"]
  }

  metadata = {
    gce-container-declaration = yamlencode({
      spec = {
        containers = [{
          image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.docker.repository_id}/demucs-worker:latest"
          env = [
            { name = "STORAGE_MODE", value = "gcs" },
            { name = "GCS_BUCKET", value = var.gcs_stems_bucket },
            { name = "OUTPUT_DIR", value = "/outputs" },
          ]
          volumeMounts = [{
            name      = "model-cache"
            mountPath = "/root/.cache/torch"
          }]
        }]
        volumes = [{
          name = "model-cache"
          hostPath = {
            path = "/var/lib/demucs-cache"
          }
        }]
      }
    })

    cos-nvidia-installer-enabled = "true"
  }

  tags = ["demucs-worker"]

  labels = {
    app         = "resonate"
    component   = "demucs"
    environment = var.environment
  }

  depends_on = [
    google_project_service.apis["compute.googleapis.com"],
    google_storage_bucket.stems,
  ]
}

# Firewall: allow backend (via VPC connector) to reach Demucs on port 8000
resource "google_compute_firewall" "allow_demucs" {
  count = var.demucs_gpu_enabled ? 1 : 0

  name    = "resonate-${var.environment}-allow-demucs"
  network = google_compute_network.vpc.name

  priority  = 900
  direction = "INGRESS"

  allow {
    protocol = "tcp"
    ports    = ["8000"]
  }

  source_ranges = ["10.0.0.0/20", "10.8.0.0/28"]
  target_tags   = ["demucs-worker"]
}
