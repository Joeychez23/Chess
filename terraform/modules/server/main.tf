# ---------------------------------------------------------------- #
# Server Module
# THE CHESS SERVER'S DNS RECORDS AND ITS IAM ROLE (THE INSTANCE ITSELF WAS MADE IN THE CONSOLE)
# ---------------------------------------------------------------- #

provider "aws" {
  region = "us-east-1" # IAM AND ROUTE 53 ARE GLOBAL
}

data "aws_route53_zone" "route53_domain" {
  name = var.root_domain_name
}

# ---------------------------------------------------------------- #
# DNS (chess + engine -> the EC2 instance's Elastic IP)
# ---------------------------------------------------------------- #
# THE CHESS SERVER AND chess-engine-api RUN ON THE SAME INSTANCE
resource "aws_route53_record" "server_A_records" {
  for_each        = toset(var.server_domain_names)
  allow_overwrite = true # THE ENGINE'S RECORD WAS MADE IN THE CONSOLE, TERRAFORM TAKES IT OVER
  zone_id         = data.aws_route53_zone.route53_domain.zone_id
  name            = each.value
  type            = "A"
  ttl             = 300
  records         = [var.server_ip]
}

# ---------------------------------------------------------------- #
# IAM Role (Chess-Stockfish's, with no DynamoDB access since #250)
# ---------------------------------------------------------------- #
# THE ROLE AND PROFILE WERE MADE IN THE CONSOLE, IMPORT THEM BEFORE THE FIRST apply (README -> Terraform).
# ITS DYNAMODB POLICY IS GONE: THE CHESS SERVER CALLS THE DATA SERVICE (#249), THE ONLY INSTANCE THAT CAN USE THE TABLES (modules/data_service).
# THE ROLE & PROFILE STAY, SO NOTHING CHANGES ON THE INSTANCE
resource "aws_iam_role" "server_role" {
  name        = var.role_name
  description = "Allows EC2 instances to call AWS services on your behalf." # THE CONSOLE'S DEFAULT, KEPT SO plan SHOWS NO CHANGE
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# WHAT EC2 ATTACHES TO THE INSTANCE (SAME NAME AS THE ROLE)
resource "aws_iam_instance_profile" "server_profile" {
  name = var.role_name
  role = aws_iam_role.server_role.name
}
