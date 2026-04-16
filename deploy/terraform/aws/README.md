# Fleetlens AWS Terraform Module

Deploys the Fleetlens team server on ECS Fargate with RDS PostgreSQL and an Application Load Balancer.

## Prerequisites

- AWS account with permissions to create ECS, RDS, ALB, IAM, and SSM resources
- Existing VPC with private subnets (for ECS + RDS) and public subnets (for ALB)
- Domain name with DNS you can manage
- ACM certificate for your domain (recommended — HTTP-only deployments skip this)

Request a certificate:
```bash
aws acm request-certificate \
  --domain-name fleetlens.example.com \
  --validation-method DNS \
  --region us-east-1
```

## Quick start

```bash
cd examples/basic
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars with your values

terraform init
terraform plan
terraform apply
```

After `apply`, point your domain's DNS to the ALB:

```
fleetlens.example.com  CNAME  <alb_dns output>
```

Then open `https://fleetlens.example.com` and claim the server with your admin email.

## Variables

| Name | Description | Default |
|------|-------------|---------|
| `hostname` | Domain name for the server | required |
| `admin_email` | Initial admin email | `""` |
| `vpc_id` | VPC ID | required |
| `subnet_ids` | Private subnet IDs (ECS + RDS) | required |
| `public_subnet_ids` | Public subnet IDs (ALB) | `[]` |
| `postgres_version` | PostgreSQL engine version | `"17"` |
| `database_url` | External DATABASE_URL — skips RDS creation | `""` |
| `image_tag` | Docker image tag | `"latest"` |
| `cpu` | Fargate task CPU units | `512` |
| `memory` | Fargate task memory (MiB) | `1024` |
| `desired_count` | Number of ECS tasks | `1` |
| `certificate_arn` | ACM cert ARN for HTTPS | `""` |

## Outputs

| Name | Description |
|------|-------------|
| `fleetlens_url` | Full URL of your deployment |
| `alb_dns_name` | ALB DNS — use this for your CNAME record |
| `ecs_cluster_name` | ECS cluster name |
| `rds_endpoint` | RDS endpoint (or `"external"` if you provided `database_url`) |

## Bringing your own database

Set `database_url` to skip RDS creation entirely:

```hcl
module "fleetlens" {
  source       = "path/to/module"
  # ...
  database_url = "postgresql://user:pass@host:5432/fleetlens"
}
```

## After deployment

1. Add the CNAME record pointing your domain to `alb_dns_name`
2. Wait for DNS propagation (typically a few minutes)
3. Open your `hostname` URL
4. Sign in with your `admin_email` to claim the server
