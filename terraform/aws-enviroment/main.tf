terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.18.0"
    }
  }
}



module "cloudfront_module" {
  source           = "../modules/cloudfront"
  aws_region 	   	 = "us-west-2"
  s3_name          = local.s3_name
  root_domain_name = local.root_domain_name
  domain_name      = local.domain_name
}

module "dynamodb_module" {
  source           = "../modules/dynamodb"
  aws_region       = "us-west-2" # NEXT TO Chess-Stockfish (NEW TABLES, THE us-east-1 ONES WERE LEFT BEHIND, README -> Moving the tables)
  chess_table_name = local.chess_table_name
  user_table_name  = local.user_table_name
}

module "server_module" {
  source              = "../modules/server"
  root_domain_name    = local.root_domain_name
  server_ip           = local.server_ip
  server_domain_names = local.server_domain_names
  role_name           = local.server_role_name
  table_arns          = module.dynamodb_module.table_arns
}

module "data_service_module" {
  source                   = "../modules/data_service"
  server_security_group_id = local.server_security_group_id
  availability_zone_id     = local.server_zone_id
  subnet_cidr              = local.data_service_subnet_cidr
  private_ip               = local.data_service_ip
  key_name                 = local.key_name
  table_arns               = module.dynamodb_module.table_arns
  maintenance              = var.maintenance
}

# terraform apply -var maintenance=true: THE DATA SERVICE CAN REACH THE INTERNET (THROUGH A NAT GATEWAY) TO INSTALL OR UPDATE.
# A PLAIN terraform apply TURNS IT OFF AGAIN (README -> Data service instance)
variable "maintenance" {
  type    = bool
  default = false
}

output "instance_profile_name" {
  value = module.server_module.instance_profile_name
}

output "data_service_private_ip" {
  value = module.data_service_module.private_ip
}

output "data_service_endpoint_id" {
  value = module.data_service_module.vpc_endpoint_id
}






