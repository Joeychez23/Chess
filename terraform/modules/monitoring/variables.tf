# MONITORING MODULE VARIABLES: WHAT THE ROOT MODULE PASSES IN

variable "aws_region" {
  type    = string
  default = "us-west-2" # WHERE THE INSTANCE AND THE TABLES ARE
}
variable "alert_email" {
  type = string
}
variable "site_domain_name" {
  type = string
}
variable "table_names" {
  type = list(string)
}
variable "server_role_name" {
  type = string
}
variable "dynamodb_monthly_budget" {
  type    = string
  default = "5.0" # USD A MONTH, THE BUDGET ON THE TABLES (#361)
}
variable "log_group_name" {
  type    = string
  default = "/chess/server" # THE SAME NAME AS deploy/cloudwatch-agent.json
}
