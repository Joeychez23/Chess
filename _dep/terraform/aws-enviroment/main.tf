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
  aws_region       = "us-east-1"
  chess_table_name = local.chess_table_name
  user_table_name  = local.user_table_name
}






