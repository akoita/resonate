# =============================================================================
# Input Variables
# =============================================================================

variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for all resources"
  type        = string
  default     = "europe-west1"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "dev"
}

# --- Database ---

variable "db_tier" {
  description = "Cloud SQL machine tier"
  type        = string
  default     = "db-f1-micro"
}

variable "db_password" {
  description = "PostgreSQL password for the resonate user"
  type        = string
  sensitive   = true
}

# --- Redis ---

variable "redis_memory_gb" {
  description = "Memorystore Redis memory in GB"
  type        = number
  default     = 1
}

# --- Application Secrets ---

variable "jwt_secret" {
  description = "JWT signing secret for backend auth"
  type        = string
  sensitive   = true
}

variable "google_ai_api_key" {
  description = "Google AI Studio API key for agent runtime"
  type        = string
  sensitive   = true
  default     = ""
}

variable "deployer_private_key" {
  description = "Sepolia deployer wallet private key (for contract indexer)"
  type        = string
  sensitive   = true
  default     = ""
}

# --- Contract Addresses (from Sepolia deployment) ---

variable "stem_nft_address" {
  description = "Deployed StemNFT contract address on Sepolia"
  type        = string
  default     = ""
}

variable "marketplace_address" {
  description = "Deployed StemMarketplaceV2 contract address on Sepolia"
  type        = string
  default     = ""
}

variable "transfer_validator_address" {
  description = "Deployed TransferValidator contract address on Sepolia"
  type        = string
  default     = ""
}

variable "sepolia_rpc_url" {
  description = "Sepolia RPC URL (e.g. Alchemy)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "pimlico_api_key" {
  description = "Pimlico API key for ERC-4337 bundler"
  type        = string
  sensitive   = true
  default     = ""
}

# --- IAP ---

variable "iap_authorized_members" {
  description = "List of members authorized to access via IAP (e.g. user:you@gmail.com)"
  type        = list(string)
  default     = []
}

# --- Cloud Run ---

variable "backend_min_instances" {
  description = "Minimum Cloud Run instances for backend (1 for WebSocket/indexer)"
  type        = number
  default     = 1
}

variable "frontend_min_instances" {
  description = "Minimum Cloud Run instances for frontend"
  type        = number
  default     = 0
}

# --- Demucs Worker ---

variable "demucs_cpu_enabled" {
  description = "Enable Demucs worker on Cloud Run with CPU (no GPU quota needed, slower)"
  type        = bool
  default     = false
}

variable "demucs_gpu_enabled" {
  description = "Enable GCE GPU instance for Demucs worker (opt-in to avoid costs)"
  type        = bool
  default     = false
}

variable "demucs_machine_type" {
  description = "GCE machine type for Demucs worker"
  type        = string
  default     = "n1-standard-4"
}

variable "gcs_stems_bucket" {
  description = "GCS bucket name for temporary stem storage"
  type        = string
  default     = "resonate-stems-dev"
}

# --- Admin / Maintenance ---

variable "admin_addresses" {
  description = "Comma-separated wallet addresses auto-promoted to admin role"
  type        = string
  default     = ""
}

variable "enable_dev_wipe" {
  description = "Enable the DELETE /admin/wipe-releases endpoint (dev/staging only)"
  type        = bool
  default     = false
}

# --- Frontend ---

variable "zerodev_project_id" {
  description = "ZeroDev project ID for passkey/smart wallet auth"
  type        = string
  default     = ""
}

variable "passkey_server_url" {
  description = "ZeroDev Passkey Server URL for WebAuthn RP_ID matching"
  type        = string
  default     = ""
}

variable "frontend_url" {
  description = "Frontend Cloud Run URL for CORS (set after first deploy)"
  type        = string
  default     = ""
}
