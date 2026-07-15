# Fleetlens AWS Terraform Module

Deploys the Fleetlens team server on ECS Fargate with RDS PostgreSQL and an Application Load Balancer.

Fleetlens including Team Edition is MIT-licensed open source — no license keys, no seat gating.

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

Then open `https://fleetlens.example.com/signup`. **The first account to sign up becomes the admin** (there is no pre-seeded admin email). Keep the service network-restricted (security groups / private access) until that first signup is complete so a stranger cannot claim the server.

## Variables

| Name | Description | Default |
|------|-------------|---------|
| `hostname` | Domain name for the server | required |
| `encryption_key` | `FLEETLENS_ENCRYPTION_KEY` — 64 hex characters (32 bytes) for AES-256-GCM. Generate with `openssl rand -hex 32` | required |
| `vpc_id` | VPC ID | required |
| `subnet_ids` | Private subnet IDs (ECS + RDS) | required |
| `public_subnet_ids` | Public subnet IDs (ALB) | `[]` |
| `postgres_version` | PostgreSQL engine version | `"17"` |
| `database_url` | External DATABASE_URL — skips RDS creation | `""` |
| `image_tag` | Docker image tag (`ghcr.io/cowcow02/fleetlens-team-server:<tag>`) | `"latest"` |
| `cpu` | Fargate task CPU units | `512` |
| `memory` | Fargate task memory (MiB) | `1024` |
| `desired_count` | Number of ECS tasks | `1` |
| `certificate_arn` | ACM cert ARN for HTTPS | `""` |

### Image tag pinning

`:latest` tracks master HEAD and can move without a formal release. For production, pin `image_tag` to a published version from a `server-vX.Y.Z` release (GHCR tags the image as `:X.Y.Z`, without the `server-v` prefix) — for example `image_tag = "0.5.0"`.

### Encryption key

Required to store GitHub / Linear / Jira / email integration credentials at rest. The app expects a 64-character hex string (`openssl rand -hex 32`). Store it in your secrets manager or tfvars (sensitive); Terraform writes it to SSM as a SecureString and injects it into the task as `FLEETLENS_ENCRYPTION_KEY`.

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
  source = "path/to/module"
  # ...
  database_url   = "postgresql://user:pass@host:5432/fleetlens"
  encryption_key = "..." # openssl rand -hex 32
}
```

## After deployment

1. Add the CNAME record pointing your domain to `alb_dns_name`
2. Wait for DNS propagation (typically a few minutes)
3. Open your `hostname` URL at `/signup`
4. Create the first account — that signup is promoted to staff/admin
5. Only then open network access more broadly and invite members
