# ---------------------------------------------------------------- #
# CloudFront Module
# THE ASSETS CDN: THE S3 WEBSITE BUCKET BEHIND CLOUDFRONT, ITS HTTPS CERTIFICATE AND ITS DNS RECORD
# ---------------------------------------------------------------- #

locals {
  s3_origin_id   = "${var.s3_name}-origin"
  s3_domain_name = "${var.s3_name}.s3-website.${var.aws_region}.amazonaws.com"
}

provider "aws" {
  region = "us-east-1"
}

# AWS MANAGED POLICIES: CACHE ASSETS AT THE EDGE (1 DAY DEFAULT, UP TO 1 YEAR) AND ADD HSTS / NOSNIFF / FRAME / REFERRER HEADERS
data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_response_headers_policy" "security_headers" {
  name = "Managed-SecurityHeadersPolicy"
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
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }
  aliases = ["${var.domain_name}"]
  default_cache_behavior {
    target_origin_id           = local.s3_origin_id
    allowed_methods            = ["GET", "HEAD", "OPTIONS"] # STATIC ORIGIN: READ-ONLY
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security_headers.id
    compress                   = true
    viewer_protocol_policy     = "redirect-to-https"
  }
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate.cert.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

resource "aws_route53_record" "cloudfront_A_record" {
  depends_on = [data.aws_route53_zone.route53_domain, aws_cloudfront_distribution.cloudfront_dist]
  zone_id    = data.aws_route53_zone.route53_domain.zone_id
  name       = var.domain_name
  type       = "A"
  alias {
    name                   = aws_cloudfront_distribution.cloudfront_dist.domain_name
    zone_id                = aws_cloudfront_distribution.cloudfront_dist.hosted_zone_id
    evaluate_target_health = false
  }
}