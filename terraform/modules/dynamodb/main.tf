provider "aws" {
  region = var.aws_region
}

# ---------------------------------------------------------------- #
# Chess Table (one item per game)
# ---------------------------------------------------------------- #
# MADE BY TERRAFORM IN us-west-2 (README -> Moving the tables)
resource "aws_dynamodb_table" "chess_table" {
  name           = var.chess_table_name
  billing_mode   = "PROVISIONED"
  read_capacity  = 5
  write_capacity = 5
  hash_key       = "game_id" # SEARCH KEY

  attribute {
    name = "game_id"
    type = "S"
  }

  ttl {
    attribute_name = "expireAt" # SET BY THE CHESS LAMBDA, 25 DAYS AFTER THE LAST MOVE (EPOCH SECONDS)
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true # CAN BE RESTORED TO ANY SECOND IN THE LAST 35 DAYS (README -> Restoring a table)
  }

  lifecycle {
    prevent_destroy = true # HOLDS LIVE GAMES, TERRAFORM WILL REFUSE TO DELETE OR REPLACE IT
  }
}

# ---------------------------------------------------------------- #
# User Table (one item per user)
# ---------------------------------------------------------------- #
# MADE BY TERRAFORM IN us-west-2 (README -> Moving the tables)
resource "aws_dynamodb_table" "user_table" {
  name           = var.user_table_name
  billing_mode   = "PROVISIONED"
  read_capacity  = 5
  write_capacity = 5
  hash_key       = "user_id" # SEARCH KEY (AUTH0 USER ID)

  attribute {
    name = "user_id"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true # CAN BE RESTORED TO ANY SECOND IN THE LAST 35 DAYS (README -> Restoring a table)
  }

  lifecycle {
    prevent_destroy = true # HOLDS LIVE USERS, TERRAFORM WILL REFUSE TO DELETE OR REPLACE IT
  }
}
