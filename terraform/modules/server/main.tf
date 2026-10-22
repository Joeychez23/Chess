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
# IAM Role (the chess server reads and writes DynamoDB with it)
# ---------------------------------------------------------------- #
resource "aws_iam_role" "server_role" {
  name = var.role_name
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# ONLY THE CALLS server/dynamoDB.js MAKES, ONLY ON chess_db AND user_db
resource "aws_iam_role_policy" "dynamodb_policy" {
  name = "${var.role_name}-dynamodb"
  role = aws_iam_role.server_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:BatchGetItem"]
      Resource = var.table_arns
    }]
  })
}

# WHAT EC2 ATTACHES TO THE INSTANCE (SAME NAME AS THE ROLE)
resource "aws_iam_instance_profile" "server_profile" {
  name = var.role_name
  role = aws_iam_role.server_role.name
}
