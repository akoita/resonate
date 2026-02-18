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
