#!/usr/bin/env bash
#
#  upload-assets.sh  --  chess frontend
#	Uploads client/src/images & client/src/audio to the root of s3://<bucket>/ (images/, audio/) with a one-day Cache-Control,
#	then clears CloudFront's copies. A changed file keeps its url, so browsers that already have it show the old one
#	for up to a day (client/README.md). Nothing is deleted from the bucket
#
#	deploy/upload-assets.sh              (from the repo root)
#	BUCKET=other-bucket ASSETS_HOST=assets.example.com deploy/upload-assets.sh
#

set -euo pipefail

BUCKET="${BUCKET:-aws-prac-chess-s3}"
ASSETS_HOST="${ASSETS_HOST:-assets.chess.aws-prac-route53.com}"
CACHE="public, max-age=86400"

if [[ $# -gt 0 ]]; then
	echo "usage: $0 (no arguments: the assets go to the bucket's root, version folders are no longer used)" >&2
	exit 1
fi

cd "$(dirname "$0")/../client/src"
for dir in images audio; do
	[[ -d "$dir" ]] || { echo "client/src/$dir is missing (copy the assets back first)" >&2; exit 1; }
done

for dir in images audio; do
	aws s3 sync "$dir" "s3://$BUCKET/$dir" --exclude "*.DS_Store" --cache-control "$CACHE"
done

# A WILDCARD PATH COUNTS AS ONE INVALIDATION
dist=$(aws cloudfront list-distributions --query "DistributionList.Items[?Aliases.Items[0]=='$ASSETS_HOST'].Id | [0]" --output text)
if [[ -z "$dist" || "$dist" == "None" ]]; then
	echo "Uploaded, but no CloudFront distribution answers for $ASSETS_HOST: invalidate /images/* and /audio/* by hand." >&2
	exit 1
fi
aws cloudfront create-invalidation --distribution-id "$dist" --paths "/images/*" "/audio/*" --query 'Invalidation.Status' --output text

echo "Uploaded to s3://$BUCKET/. CHESS_ASSETS_URL stays https://$ASSETS_HOST, no rebuild needed."
