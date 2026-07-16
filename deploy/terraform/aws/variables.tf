variable "hostname" {
  description = "Domain name for the Fleetlens team server"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID for the deployment"
  type        = string
}

variable "subnet_ids" {
  description = "List of subnet IDs (private subnets recommended)"
  type        = list(string)
}

variable "public_subnet_ids" {
  description = "List of public subnet IDs for the ALB"
  type        = list(string)
  default     = []
}

variable "postgres_version" {
  description = "PostgreSQL engine version"
  type        = string
  default     = "17"
}

variable "database_url" {
  description = "External DATABASE_URL (skips RDS creation if set)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "encryption_key" {
  description = "FLEETLENS_ENCRYPTION_KEY — 64 hex characters (32 bytes) for AES-256-GCM at-rest encryption of integration credentials. Generate with: openssl rand -hex 32"
  type        = string
  sensitive   = true
}

variable "image_tag" {
  description = "Docker image tag for the team server (GHCR publishes :latest on master and :X.Y.Z on server-vX.Y.Z releases — pin a release tag for production)"
  type        = string
  default     = "latest"
}

variable "cpu" {
  description = "Fargate task CPU units"
  type        = number
  default     = 512
}

variable "memory" {
  description = "Fargate task memory (MiB)"
  type        = number
  default     = 1024
}

variable "desired_count" {
  description = "Number of ECS tasks"
  type        = number
  default     = 1
}

variable "certificate_arn" {
  description = "ACM certificate ARN for HTTPS (if not provided, uses HTTP only)"
  type        = string
  default     = ""
}
