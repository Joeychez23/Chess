output "private_ip" {
  value = aws_instance.data_service.private_ip # DATA_SERVICE_HOST ON THE INSTANCE, AND DATA_SERVICE_URL IN server/.env (http://<it>:8090)
}
output "instance_id" {
  value = aws_instance.data_service.id
}
output "vpc_endpoint_id" {
  value = aws_vpc_endpoint.dynamodb.id # #250 LIMITS THE ROLE TO CALLS THROUGH IT (aws:SourceVpce)
}
