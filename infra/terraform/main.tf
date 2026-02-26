# =============================================================================
# Resonate — GCP Infrastructure (Terraform)
# =============================================================================
# Provisions all GCP resources for the Resonate dev environment.
# Usage:
#   cd infra/terraform
#   terraform init
#   terraform plan -var-file="terraform.tfvars"
#   terraform apply -var-file="terraform.tfvars"
#
# ⚠️  terraform.tfvars is gitignored — copy from terraform.tfvars.example
# =============================================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.0"
    }
  }

  # Remote state in GCS (uncomment after first apply creates the bucket)
  # backend "gcs" {
  #   bucket = "resonate-terraform-state"
  #   prefix = "dev"
  # }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

# =============================================================================
# Enable Required GCP APIs
# =============================================================================

locals {
  required_apis = [
    "run.googleapis.com",              # Cloud Run
    "sqladmin.googleapis.com",         # Cloud SQL Admin
    "redis.googleapis.com",            # Memorystore Redis
    "secretmanager.googleapis.com",    # Secret Manager
    "artifactregistry.googleapis.com", # Artifact Registry
    "compute.googleapis.com",          # Compute (VPC, firewall)
    "vpcaccess.googleapis.com",        # Serverless VPC Access
    "iap.googleapis.com",              # Identity-Aware Proxy
    "monitoring.googleapis.com",       # Cloud Monitoring
    "logging.googleapis.com",          # Cloud Logging
    "cloudbuild.googleapis.com",       # Cloud Build (CI/CD)
    "iam.googleapis.com",              # IAM
    "servicenetworking.googleapis.com", # Service Networking (VPC peering)
    "pubsub.googleapis.com",           # Pub/Sub (event-driven stem separation)
  ]
}

resource "google_project_service" "apis" {
  for_each = toset(local.required_apis)

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
