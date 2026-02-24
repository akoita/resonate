# =============================================================================
# VPC Networking — Private network for all services
# =============================================================================

resource "google_compute_network" "vpc" {
  name                    = "resonate-${var.environment}-vpc"
  auto_create_subnetworks = false
  project                 = var.project_id

  depends_on = [google_project_service.apis["compute.googleapis.com"]]
}

resource "google_compute_subnetwork" "main" {
  name          = "resonate-${var.environment}-subnet"
  ip_cidr_range = "10.0.0.0/20"
  region        = var.region
  network       = google_compute_network.vpc.id

  private_ip_google_access = true
}

# VPC Connector — allows Cloud Run to reach private resources (Cloud SQL, Redis)
resource "google_vpc_access_connector" "connector" {
  name          = "resonate-${var.environment}-vpc"
  region        = var.region
  ip_cidr_range = "10.8.0.0/28"
  network       = google_compute_network.vpc.name

  min_instances = 2
  max_instances = 3

  depends_on = [google_project_service.apis["vpcaccess.googleapis.com"]]
}

# Firewall — deny all ingress by default, allow internal only
resource "google_compute_firewall" "deny_all_ingress" {
  name    = "resonate-${var.environment}-deny-all"
  network = google_compute_network.vpc.name

  priority  = 65534
  direction = "INGRESS"

  deny {
    protocol = "all"
  }

  source_ranges = ["0.0.0.0/0"]
}

resource "google_compute_firewall" "allow_internal" {
  name    = "resonate-${var.environment}-allow-internal"
  network = google_compute_network.vpc.name

  priority  = 1000
  direction = "INGRESS"

  allow {
    protocol = "tcp"
  }

  allow {
    protocol = "udp"
  }

  allow {
    protocol = "icmp"
  }

  source_ranges = ["10.0.0.0/20", "10.8.0.0/28"]
}

# Allocate private IP range for Cloud SQL
resource "google_compute_global_address" "private_ip_range" {
  name          = "resonate-${var.environment}-private-ip"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "private_vpc_connection" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip_range.name]

  depends_on = [google_project_service.apis["servicenetworking.googleapis.com"]]
}
