variable "aws_region" {
  default = "us-west-2" # Chess-Stockfish & THE TABLES
}
variable "server_security_group_id" {
  type = string # Chess-Stockfish'S GROUP, THE ONLY ONE LET IN
}
variable "availability_zone_id" {
  type = string # Chess-Stockfish'S ZONE (A ZONE ID LIKE usw2-az2, THE SAME ZONE IN EVERY ACCOUNT)
}
variable "subnet_cidr" {
  type = string # A FREE RANGE IN THE DEFAULT VPC (aws ec2 describe-subnets)
}
variable "private_ip" {
  type = string # INSIDE subnet_cidr, NOT ITS FIRST 4 OR LAST ADDRESS (AWS KEEPS THOSE)
}
variable "key_name" {
  type = string # THE EC2 KEY PAIR FOR SSH (THROUGH Chess-Stockfish)
}
variable "role_name" {
  default = "EC2_Chess_DataService"
}
variable "instance_type" {
  default = "t3.micro"
}
variable "port" {
  default = 8090 # DATA_SERVICE_PORT
}
variable "table_arns" {
  type = list(string) # chess_db & user_db, THE ROLE & THE ENDPOINT ARE LIMITED TO THEM
}
variable "maintenance" {
  type    = bool
  default = false # true ADDS THE UPKEEP NAT GATEWAY (README -> Data service instance)
}
