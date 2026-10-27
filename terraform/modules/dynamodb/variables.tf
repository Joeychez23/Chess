variable "aws_region" {
  default = "us-west-2"
}
variable "chess_table_name" {
  type = string
}
variable "user_table_name" {
  type = string
}
variable "replica_regions" {
  type    = list(string)
  default = [] # EXTRA REGIONS THE TABLES ARE COPIED TO (GLOBAL TABLE REPLICAS)
}
