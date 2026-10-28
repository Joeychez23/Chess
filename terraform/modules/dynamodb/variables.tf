# DYNAMODB MODULE VARIABLES: WHAT THE ROOT MODULE PASSES IN

variable "aws_region" {
  default = "us-west-2"
}
variable "chess_table_name" {
  type = string
}
variable "user_table_name" {
  type = string
}
