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
    max_delivery_attempts = 3
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
