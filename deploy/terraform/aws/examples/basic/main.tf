terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "hostname" {
  description = "Domain name for the Fleetlens team server"
  type        = string
}

variable "admin_email" {
  description = "Email address for the initial admin"
  type        = string
  default     = ""
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "subnet_ids" {
  description = "Private subnet IDs for ECS tasks and RDS"
  type        = list(string)
}

variable "public_subnet_ids" {
  description = "Public subnet IDs for the ALB"
  type        = list(string)
}

variable "certificate_arn" {
  description = "ACM certificate ARN for HTTPS"
  type        = string
  default     = ""
}

module "fleetlens" {
  source = "../../"

  hostname          = var.hostname
  admin_email       = var.admin_email
  vpc_id            = var.vpc_id
  subnet_ids        = var.subnet_ids
  public_subnet_ids = var.public_subnet_ids
  certificate_arn   = var.certificate_arn
}

output "url" {
  value = module.fleetlens.fleetlens_url
}

output "alb_dns" {
  value = module.fleetlens.alb_dns_name
}
