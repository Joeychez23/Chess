provider "aws" {
  region = var.aws_region
}

# ---------------------------------------------------------------- #
# What's Already There (Chess-Stockfish, made in the console)
# ---------------------------------------------------------------- #
data "aws_vpc" "default" {
  default = true # Chess-Stockfish IS IN THE DEFAULT VPC
}

data "aws_subnet" "server" { # Chess-Stockfish'S SUBNET (THE DEFAULT ONE IN ITS ZONE), THE UPKEEP NAT GATEWAY GOES IN IT
  vpc_id               = data.aws_vpc.default.id
  availability_zone_id = var.availability_zone_id
  default_for_az       = true
}

data "aws_security_group" "server" { # Chess-Stockfish'S SECURITY GROUP, ONLY IT CAN REACH THE DATA SERVICE
  id = var.server_security_group_id
}

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # CANONICAL
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"] # UBUNTU 24.04, x86 LIKE Chess-Stockfish
  }
}

# ---------------------------------------------------------------- #
# Private Subnet (no route to the internet)
# ---------------------------------------------------------------- #
resource "aws_subnet" "data_service" {
  vpc_id                  = data.aws_vpc.default.id
  cidr_block              = var.subnet_cidr
  availability_zone_id    = var.availability_zone_id # SAME ZONE AS Chess-Stockfish, NO CROSS-ZONE TRAFFIC
  map_public_ip_on_launch = false
  tags                    = { Name = "data-service-private" }
}

resource "aws_route_table" "data_service" {
  vpc_id = data.aws_vpc.default.id # ONLY THE VPC'S OWN ROUTE, PLUS THE DYNAMODB ENDPOINT (AND THE UPKEEP NAT WHILE maintenance IS ON)
  tags   = { Name = "data-service-private" }
}

resource "aws_route_table_association" "data_service" {
  subnet_id      = aws_subnet.data_service.id
  route_table_id = aws_route_table.data_service.id
}

# ---------------------------------------------------------------- #
# DynamoDB Endpoint (free, the tables are in this region)
# ---------------------------------------------------------------- #
# A GATEWAY ENDPOINT IS A ROUTE IN THE PRIVATE ROUTE TABLE, SO THE DATA SERVICE REACHES DYNAMODB WITHOUT THE INTERNET.
# ITS POLICY ONLY ALLOWS THE CALLS data-service/dynamoDB.js MAKES ON THE TWO TABLES
resource "aws_vpc_endpoint" "dynamodb" {
  vpc_id            = data.aws_vpc.default.id
  service_name      = "com.amazonaws.${var.aws_region}.dynamodb"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.data_service.id]
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = "*"
      Action    = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:BatchGetItem", "dynamodb:DeleteItem"] # TransactWriteItems IS CHECKED AS ITS PUTS, UPDATES & DELETES
      Resource  = var.table_arns
    }]
  })
  tags = { Name = "data-service-dynamodb" }
}

# ---------------------------------------------------------------- #
# Security Group (only Chess-Stockfish gets in)
# ---------------------------------------------------------------- #
resource "aws_security_group" "data_service" {
  name        = "data_service_sg"
  description = "Data service: only Chess-Stockfish can reach it"
  vpc_id      = data.aws_vpc.default.id
}

resource "aws_vpc_security_group_ingress_rule" "api" {
  security_group_id            = aws_security_group.data_service.id
  referenced_security_group_id = data.aws_security_group.server.id # BY GROUP, NOT IP: ONLY INSTANCES IN Chess-Stockfish'S GROUP
  ip_protocol                  = "tcp"
  from_port                    = var.port
  to_port                      = var.port
  description                  = "Chess server to the data service"
}

resource "aws_vpc_security_group_ingress_rule" "ssh" {
  security_group_id            = aws_security_group.data_service.id
  referenced_security_group_id = data.aws_security_group.server.id # SSH ONLY THROUGH Chess-Stockfish (ssh -J)
  ip_protocol                  = "tcp"
  from_port                    = 22
  to_port                      = 22
  description                  = "SSH through Chess-Stockfish"
}

resource "aws_vpc_security_group_egress_rule" "dynamodb" {
  security_group_id = aws_security_group.data_service.id
  prefix_list_id    = aws_vpc_endpoint.dynamodb.prefix_list_id # ONLY DYNAMODB'S ADDRESSES, THROUGH THE ENDPOINT
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  description       = "DynamoDB through the endpoint"
}

resource "aws_vpc_security_group_egress_rule" "upkeep" { # apt, nvm & npm WHILE maintenance IS ON (HTTP FOR apt, HTTPS FOR THE REST)
  for_each          = var.maintenance ? toset(["80", "443"]) : toset([])
  security_group_id = aws_security_group.data_service.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = tonumber(each.value)
  to_port           = tonumber(each.value)
  description       = "Upkeep: the internet through the NAT gateway"
}

# ---------------------------------------------------------------- #
# Upkeep NAT (only while maintenance is on)
# ---------------------------------------------------------------- #
# terraform apply -var maintenance=true TURNS IT ON TO INSTALL OR UPDATE (ABOUT 4.5 CENTS AN HOUR PLUS DATA),
# terraform apply TURNS IT OFF AGAIN. THE REST OF THE TIME THE DATA SERVICE HAS NO WAY OUT
resource "aws_eip" "upkeep" {
  count  = var.maintenance ? 1 : 0
  domain = "vpc"
  tags   = { Name = "data-service-upkeep" }
}

resource "aws_nat_gateway" "upkeep" {
  count         = var.maintenance ? 1 : 0
  allocation_id = aws_eip.upkeep[0].id
  subnet_id     = data.aws_subnet.server.id # A PUBLIC SUBNET, ITS ROUTE TABLE HAS THE INTERNET GATEWAY
  tags          = { Name = "data-service-upkeep" }
}

resource "aws_route" "upkeep" {
  count                  = var.maintenance ? 1 : 0
  route_table_id         = aws_route_table.data_service.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.upkeep[0].id
}

# ---------------------------------------------------------------- #
# IAM Role (only the data service reads and writes DynamoDB)
# ---------------------------------------------------------------- #
resource "aws_iam_role" "data_service" {
  name        = var.role_name
  description = "The data service: the only instance with DynamoDB access (#245)"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# ONLY THE CALLS data-service/dynamoDB.js MAKES, ONLY ON chess_db AND user_db (THE SAME LIST AS modules/server, WHICH #250 EMPTIES)
resource "aws_iam_role_policy" "dynamodb" {
  name = "${var.role_name}Policy"
  role = aws_iam_role.data_service.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:BatchGetItem", "dynamodb:DeleteItem"]
      Resource = var.table_arns
    }]
  })
}

resource "aws_iam_instance_profile" "data_service" {
  name = var.role_name
  role = aws_iam_role.data_service.name
}

# ---------------------------------------------------------------- #
# The Data Service Instance
# ---------------------------------------------------------------- #
resource "aws_instance" "data_service" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type # t3.micro, ABOUT $7.60 A MONTH
  subnet_id                   = aws_subnet.data_service.id
  private_ip                  = var.private_ip # FIXED, SO DATA_SERVICE_URL IN server/.env NEVER CHANGES
  associate_public_ip_address = false
  vpc_security_group_ids      = [aws_security_group.data_service.id]
  iam_instance_profile        = aws_iam_instance_profile.data_service.name
  key_name                    = var.key_name

  metadata_options {
    http_tokens                 = "required" # IMDSv2 ONLY
    http_endpoint               = "enabled"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = 8
    encrypted   = true
  }

  tags = { Name = "Chess-DataService" }

  lifecycle {
    ignore_changes = [ami] # A NEWER UBUNTU IMAGE NEVER REPLACES THE INSTANCE, apt UPGRADES IT IN AN UPKEEP WINDOW
  }
}
