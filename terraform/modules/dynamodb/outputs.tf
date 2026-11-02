# DYNAMODB MODULE OUTPUTS: WHAT THE ROOT MODULE CAN READ BACK

output "username_index_arn" {
  value = "${aws_dynamodb_table.user_table.arn}/index/username-search" # THE SERVER MODULE CAN ONLY Query THIS
}

output "table_arns" {
  value = [aws_dynamodb_table.chess_table.arn, aws_dynamodb_table.user_table.arn] # THE SERVER MODULE'S IAM POLICY IS LIMITED TO THESE
}
