locals {
  s3_origin_id   = "${var.s3_name}-origin"
  s3_domain_name = "${var.s3_name}.s3-website.${var.aws_region}.amazonaws.com"
}

provider "aws" {
  region = "us-east-1"
}

data "aws_route53_zone" "route53_domain" {
  name = var.root_domain_name
}

resource "aws_acm_certificate" "cert" {
  domain_name       = var.domain_name
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_dns" {
  depends_on      = [aws_acm_certificate.cert, data.aws_route53_zone.route53_domain]
  allow_overwrite = true
  name            = tolist(aws_acm_certificate.cert.domain_validation_options)[0].resource_record_name
  records         = [tolist(aws_acm_certificate.cert.domain_validation_options)[0].resource_record_value]
  type            = tolist(aws_acm_certificate.cert.domain_validation_options)[0].resource_record_type
  zone_id         = data.aws_route53_zone.route53_domain.zone_id
  ttl             = 60
}

resource "aws_acm_certificate_validation" "cert_validate" {
  depends_on              = [aws_acm_certificate.cert, aws_route53_record.cert_dns]
  certificate_arn         = aws_acm_certificate.cert.arn
  validation_record_fqdns = [aws_route53_record.cert_dns.fqdn]
}


resource "aws_cloudfront_distribution" "cloudfront_dist" {
  depends_on = [aws_acm_certificate.cert, aws_route53_record.cert_dns, aws_acm_certificate_validation.cert_validate]
  enabled    = true
  origin {
    origin_id   = local.s3_origin_id
    domain_name = local.s3_domain_name
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1"]
    }
  }
  aliases = ["${var.domain_name}"]
  default_cache_behavior {
    target_origin_id = local.s3_origin_id
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD"]
    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 0
    max_ttl                = 0
  }
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
  viewer_certificate {
    acm_certificate_arn = aws_acm_certificate.cert.arn
    ssl_support_method  = "sni-only"
  }
}

resource "aws_route53_record" "cloudfront_A_record" {
	depends_on = [data.aws_route53_zone.route53_domain, aws_cloudfront_distribution.cloudfront_dist]
  zone_id = data.aws_route53_zone.route53_domain.zone_id
  name    = var.domain_name
  type    = "A"
  alias {
    name                   = aws_cloudfront_distribution.cloudfront_dist.domain_name
    zone_id                = aws_cloudfront_distribution.cloudfront_dist.hosted_zone_id
    evaluate_target_health = false
  }
}