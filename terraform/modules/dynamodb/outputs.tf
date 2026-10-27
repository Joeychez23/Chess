output "table_arns" {
  value = [aws_dynamodb_table.chess_table.arn, aws_dynamodb_table.user_table.arn] # THE SERVER MODULE'S IAM POLICY IS LIMITED TO THESE
}
