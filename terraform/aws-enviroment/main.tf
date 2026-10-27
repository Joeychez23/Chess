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

output "instance_profile_name" {
  value = module.server_module.instance_profile_name
}






