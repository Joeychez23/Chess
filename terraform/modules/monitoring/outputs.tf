# MONITORING MODULE OUTPUTS: WHAT THE ROOT MODULE CAN READ BACK

output "log_group_name" {
  value = aws_cloudwatch_log_group.server.name
}
