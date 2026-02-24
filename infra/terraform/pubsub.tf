# ─── Pub/Sub Topics & Subscriptions for Demucs event-driven architecture ───
# Phase 2 of issue #357

resource "google_pubsub_topic" "stem_separate" {
  name    = "stem-separate"
  project = var.project_id
}

resource "google_pubsub_topic" "stem_results" {
  name    = "stem-results"
  project = var.project_id
}

resource "google_pubsub_topic" "stem_dlq" {
  name    = "stem-dlq"
  project = var.project_id
}

# Worker subscription — pulls separation jobs
resource "google_pubsub_subscription" "stem_separate_worker" {
  name    = "stem-separate-worker"
  topic   = google_pubsub_topic.stem_separate.id
  project = var.project_id

  # 10 min ack deadline for long-running separations
  ack_deadline_seconds = 600

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.stem_dlq.id
    max_delivery_attempts = 5
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "300s"
  }
}

# Backend subscription — consumes separation results
resource "google_pubsub_subscription" "stem_results_backend" {
  name    = "stem-results-backend"
  topic   = google_pubsub_topic.stem_results.id
  project = var.project_id

  ack_deadline_seconds = 120
}

# DLQ subscription — for manual inspection of permanently failed jobs
resource "google_pubsub_subscription" "stem_dlq_inspect" {
  name    = "stem-dlq-inspect"
  topic   = google_pubsub_topic.stem_dlq.id
  project = var.project_id

  ack_deadline_seconds = 60
}

# ─── IAM: Backend SA (Cloud Run) ───

# Backend publishes separation jobs
resource "google_pubsub_topic_iam_member" "backend_publish_separate" {
  topic  = google_pubsub_topic.stem_separate.name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:${google_service_account.cloud_run.email}"
}

# Backend subscribes to results
resource "google_pubsub_subscription_iam_member" "backend_subscribe_results" {
  subscription = google_pubsub_subscription.stem_results_backend.name
  role         = "roles/pubsub.subscriber"
  member       = "serviceAccount:${google_service_account.cloud_run.email}"
}

# ─── IAM: Demucs Worker SA ───

# Worker subscribes to separation jobs
resource "google_pubsub_subscription_iam_member" "worker_subscribe_separate" {
  count = local.demucs_enabled ? 1 : 0

  subscription = google_pubsub_subscription.stem_separate_worker.name
  role         = "roles/pubsub.subscriber"
  member       = "serviceAccount:${google_service_account.demucs_worker[0].email}"
}

# Worker publishes results
resource "google_pubsub_topic_iam_member" "worker_publish_results" {
  count = local.demucs_enabled ? 1 : 0

  topic  = google_pubsub_topic.stem_results.name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:${google_service_account.demucs_worker[0].email}"
}

# ─── IAM: DLQ forwarding ───
# Pub/Sub needs permission to publish to DLQ topic and acknowledge from source sub
resource "google_pubsub_topic_iam_member" "pubsub_dlq_publisher" {
  topic  = google_pubsub_topic.stem_dlq.name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:service-${data.google_project.project.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

resource "google_pubsub_subscription_iam_member" "pubsub_dlq_subscriber" {
  subscription = google_pubsub_subscription.stem_separate_worker.name
  role         = "roles/pubsub.subscriber"
  member       = "serviceAccount:service-${data.google_project.project.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}
