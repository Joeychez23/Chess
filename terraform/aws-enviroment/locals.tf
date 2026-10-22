locals {
	s3_name = "aws-prac-chess-s3"
	root_domain_name = "aws-prac-route53.com"
	domain_name = "assets.chess.aws-prac-route53.com"
	chess_table_name = "chess_db"
	user_table_name = "user_db"

	# EC2 INSTANCE THAT RUNS THE CHESS SERVER AND chess-engine-api
	server_ip = "52.11.177.148" # ITS ELASTIC IP
	server_domain_names = ["chess.aws-prac-route53.com", "engine.aws-prac-route53.com"]
	server_role_name = "chess-server"
}