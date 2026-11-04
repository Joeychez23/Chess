# ---------------------------------------------------------------- #
# DynamoDB Module
# THE TWO TABLES, chess_db (GAMES) AND user_db (PLAYERS)
# ---------------------------------------------------------------- #

provider "aws" {
  region = var.aws_region
}

# ---------------------------------------------------------------- #
# Chess Table (one item per game)
# ---------------------------------------------------------------- #
# MADE BY TERRAFORM IN us-west-2 (terraform/README.md -> Moving the tables to us-west-2)
resource "aws_dynamodb_table" "chess_table" {
  name         = var.chess_table_name
  billing_mode = "PAY_PER_REQUEST" # NOTHING TO RUN OUT OF, BUT NO CAP ON THE BILL (#361). THE BUDGET IS IN modules/monitoring
  hash_key     = "game_id"         # SEARCH KEY

  attribute {
    name = "game_id"
    type = "S"
  }

  ttl {
    attribute_name = "expireAt" # SET BY THE CHESS LAMBDA, 25 DAYS AFTER THE LAST MOVE (EPOCH SECONDS)
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true # CAN BE RESTORED TO ANY SECOND IN THE LAST 35 DAYS (terraform/README.md -> Restoring a table)
  }

  lifecycle {
    prevent_destroy = true # HOLDS LIVE GAMES, TERRAFORM WILL REFUSE TO DELETE OR REPLACE IT
  }
}

# ---------------------------------------------------------------- #
# User Table (one item per user)
# ---------------------------------------------------------------- #
# MADE BY TERRAFORM IN us-west-2 (terraform/README.md -> Moving the tables to us-west-2)
resource "aws_dynamodb_table" "user_table" {
  name         = var.user_table_name
  billing_mode = "PAY_PER_REQUEST" # NOTHING TO RUN OUT OF, BUT NO CAP ON THE BILL (#361). THE BUDGET IS IN modules/monitoring
  hash_key     = "user_id"         # SEARCH KEY (AUTH0 USER ID)

  attribute {
    name = "user_id"
    type = "S"
  }

  attribute {
    name = "search_group"
    type = "S"
  }

  attribute {
    name = "search_name"
    type = "S"
  }

  # PLAYER SEARCH (#120): ONLY THE username#<name> ITEMS HAVE THESE KEYS, BEGINS_WITH ON THE NAME IN LOWERCASE.
  # IT HOLDS THE NAMES BUT NOT owner_id, SO A SEARCH CAN'T RETURN AN AUTH0 ID
  global_secondary_index {
    name               = "username-search"
    hash_key           = "search_group" # ALWAYS "all"
    range_key          = "search_name"
    projection_type    = "INCLUDE"
    non_key_attributes = ["username"]
  }

  point_in_time_recovery {
    enabled = true # CAN BE RESTORED TO ANY SECOND IN THE LAST 35 DAYS (terraform/README.md -> Restoring a table)
  }

  lifecycle {
    prevent_destroy = true # HOLDS LIVE USERS, TERRAFORM WILL REFUSE TO DELETE OR REPLACE IT
  }
}
