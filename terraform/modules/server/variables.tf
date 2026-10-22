variable "root_domain_name" {
  type = string
}
variable "server_ip" {
  type = string
}
variable "server_domain_names" {
  type = list(string)
}
variable "role_name" {
  type = string
}
variable "table_arns" {
  type = list(string)
}
