# ---------------------------------------------------------------- #
# Monitoring Module (#194)
# THE UPTIME CHECK, THE CHESS SERVER'S LOGS, THE ALARMS AND THE EMAILS THEY SEND
# ---------------------------------------------------------------- #

provider "aws" {
  region = var.aws_region
}

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1" # ROUTE 53'S HEALTH CHECK METRICS ONLY EXIST HERE
}

locals {
  metric_namespace = "Chess"
  # EVERY KIND OF CALL data-service/dynamoDB.js MAKES. ThrottledRequests IS ONLY REPORTED PER OPERATION
  dynamodb_operations = ["GetItem", "PutItem", "UpdateItem", "DeleteItem", "BatchGetItem", "TransactWriteItems"]
}

# ---------------------------------------------------------------- #
# Emails (one topic per region, an alarm can only use its own region's)
# ---------------------------------------------------------------- #
# EACH SUBSCRIPTION SENDS AN EMAIL THAT MUST BE CONFIRMED, NOTHING IS DELIVERED UNTIL THEN
resource "aws_sns_topic" "alerts" {
  name = "chess-alerts"
}

resource "aws_sns_topic_subscription" "alerts" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_sns_topic" "uptime_alerts" {
  provider = aws.us_east_1
  name     = "chess-uptime-alerts"
}

resource "aws_sns_topic_subscription" "uptime_alerts" {
  provider  = aws.us_east_1
  topic_arn = aws_sns_topic.uptime_alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ---------------------------------------------------------------- #
# Uptime (GET /api/health)
# ---------------------------------------------------------------- #
# A 503 (DYNAMODB OR THE ENGINE IS DOWN), A 502 (nginx: THE SERVER IS DOWN) OR NO ANSWER ALL FAIL IT.
# THE ALERT COMES ABOUT 3 MINUTES IN: 1 MINUTE OF FAILED CHECKS, THEN 2 MINUTES OF THE ALARM
resource "aws_route53_health_check" "site" {
  provider          = aws.us_east_1
  fqdn              = var.site_domain_name
  port              = 443
  type              = "HTTPS"
  resource_path     = "/api/health"
  request_interval  = 30
  failure_threshold = 2
  tags              = { Name = "chess-site" }
}

resource "aws_cloudwatch_metric_alarm" "site_down" {
  provider            = aws.us_east_1
  alarm_name          = "chess-site-down"
  alarm_description   = "GET /api/health is failing: the site, the engine, the data service or DynamoDB is down. SETUP.md -> Alerts"
  namespace           = "AWS/Route53"
  metric_name         = "HealthCheckStatus"
  dimensions          = { HealthCheckId = aws_route53_health_check.site.id }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 2
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.uptime_alerts.arn]
  ok_actions          = [aws_sns_topic.uptime_alerts.arn]
}

# ---------------------------------------------------------------- #
# The Chess Server's Logs
# ---------------------------------------------------------------- #
resource "aws_cloudwatch_log_group" "server" {
  name              = var.log_group_name
  retention_in_days = 30
}

# ONLY WHAT THE CLOUDWATCH AGENT NEEDS, ONLY ON THIS LOG GROUP. THE ROLE STILL HAS NO DYNAMODB ACCESS (#250)
resource "aws_iam_role_policy" "server_logs" {
  name = "ChessServerLogs"
  role = var.server_role_name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
      Resource = "${aws_cloudwatch_log_group.server.arn}:*"
    }]
  })
}

# ^ ONLY MATCHES AT THE START OF A LINE: BROWSER ERROR REPORTS & URLS ARE LOGGED, AND ANYONE CAN PUT THESE WORDS IN THEM
resource "aws_cloudwatch_log_metric_filter" "stockfish_failed" {
  name           = "stockfish-failed"
  log_group_name = aws_cloudwatch_log_group.server.name
  pattern        = "%^STOCKFISH FAILED%" # server/utils/ai.js
  metric_transformation {
    name      = "StockfishFailed"
    namespace = local.metric_namespace
    value     = "1"
  }
}

resource "aws_cloudwatch_log_metric_filter" "server_errors" {
  name           = "server-5xx"
  log_group_name = aws_cloudwatch_log_group.server.name
  pattern        = "%^HTTP 5[0-9][0-9] %" # server/middleware/logServerErrors.js
  metric_transformation {
    name      = "Server5xx"
    namespace = local.metric_namespace
    value     = "1"
  }
}

# ---------------------------------------------------------------- #
# Alarms on the Logs
# ---------------------------------------------------------------- #
resource "aws_cloudwatch_metric_alarm" "stockfish_failed" {
  alarm_name          = "chess-stockfish-failed"
  alarm_description   = "The AI played a js-chess-engine move because Stockfish failed. SETUP.md -> Alerts"
  namespace           = local.metric_namespace
  metric_name         = "StockfishFailed"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  treat_missing_data  = "notBreaching" # NO LINES IS GOOD NEWS
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  depends_on          = [aws_cloudwatch_log_metric_filter.stockfish_failed]
}

resource "aws_cloudwatch_metric_alarm" "server_errors" {
  alarm_name          = "chess-server-5xx"
  alarm_description   = "The chess server answered 5 or more 5xx in 5 minutes. SETUP.md -> Alerts"
  namespace           = local.metric_namespace
  metric_name         = "Server5xx"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 5 # NOT 1: A DEPLOY'S RESTART OF THE DATA SERVICE CAN CAUSE A FEW 503s
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  depends_on          = [aws_cloudwatch_log_metric_filter.server_errors]
}

# ---------------------------------------------------------------- #
# DynamoDB Throttling (one alarm per table, its operations added up)
# ---------------------------------------------------------------- #
resource "aws_cloudwatch_metric_alarm" "dynamodb_throttled" {
  for_each            = toset(var.table_names)
  alarm_name          = "chess-dynamodb-throttled-${each.value}"
  alarm_description   = "DynamoDB throttled requests on ${each.value}. SETUP.md -> Alerts"
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  metric_query {
    id          = "throttled"
    expression  = "SUM(METRICS())"
    label       = "Throttled requests"
    return_data = true
  }

  dynamic "metric_query" {
    for_each = local.dynamodb_operations
    content {
      id = "op${metric_query.key}"
      metric {
        namespace   = "AWS/DynamoDB"
        metric_name = "ThrottledRequests"
        dimensions  = { TableName = each.value, Operation = metric_query.value }
        period      = 300
        stat        = "Sum"
      }
    }
  }
}
