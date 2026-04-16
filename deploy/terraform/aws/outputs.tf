output "fleetlens_url" {
  description = "URL of the Fleetlens team server"
  value       = "https://${var.hostname}"
}

output "alb_dns_name" {
  description = "ALB DNS name (point your domain here)"
  value       = aws_lb.main.dns_name
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "rds_endpoint" {
  value       = var.database_url == "" ? aws_db_instance.main[0].endpoint : "external"
  description = "RDS endpoint (if managed)"
}
