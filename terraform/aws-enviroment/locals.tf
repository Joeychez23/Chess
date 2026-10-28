# ---------------------------------------------------------------- #
# Locals
# THE NAMES, IDS AND ADDRESSES THE MODULES ARE GIVEN (main.tf)
# ---------------------------------------------------------------- #

locals {
	s3_name = "aws-prac-chess-s3"
	root_domain_name = "aws-prac-route53.com"
	domain_name = "assets.chess.aws-prac-route53.com"
	chess_table_name = "chess_db"
	user_table_name = "user_db"

	# EC2 INSTANCE THAT RUNS THE CHESS SERVER AND chess-engine-api
	server_ip = "52.11.177.148" # ITS ELASTIC IP
	server_domain_names = ["chess.aws-prac-route53.com", "engine.aws-prac-route53.com"]
	server_role_name = "EC2_Chess_DynamoDB" # ROLE + INSTANCE PROFILE, MADE IN THE CONSOLE AND IMPORTED
	server_security_group_id = "sg-0d8d278a8d2092fdb" # ITS SECURITY GROUP, THE ONLY ONE LET INTO THE DATA SERVICE
	server_zone_id = "usw2-az2" # ITS AVAILABILITY ZONE (us-west-2a IN THIS ACCOUNT)
	key_name = "key-10-14-26" # THE EC2 KEY PAIR

	# THE DATA SERVICE (#245), A PRIVATE INSTANCE ONLY Chess-Stockfish CAN REACH
	data_service_subnet_cidr = "172.31.64.0/28" # FREE IN THE DEFAULT VPC (ITS DEFAULT SUBNETS ARE 172.31.0.0/20 - 172.31.48.0/20), CHECK WITH aws ec2 describe-subnets
	data_service_ip = "172.31.64.10" # FIXED, DATA_SERVICE_URL IN server/.env IS http://172.31.64.10:8090
}