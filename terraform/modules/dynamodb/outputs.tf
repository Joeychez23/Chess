output "table_arns" {
  value = concat( # THE SERVER MODULE'S IAM POLICY IS LIMITED TO THESE, AND TO THE REPLICAS WHILE THERE ARE ANY
    [aws_dynamodb_table.chess_table.arn, aws_dynamodb_table.user_table.arn],
    aws_dynamodb_table.chess_table.replica[*].arn,
    aws_dynamodb_table.user_table.replica[*].arn
  )
}
