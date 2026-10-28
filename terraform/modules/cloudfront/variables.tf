# CLOUDFRONT MODULE VARIABLES: WHAT THE ROOT MODULE PASSES IN

variable "aws_region" {
  default = "us-east-1"
}
variable "s3_name" {
  type = string
}
variable "root_domain_name" {
  type = string
}

variable "domain_name" {
  type = string
}