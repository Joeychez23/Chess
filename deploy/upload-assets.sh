#!/usr/bin/env bash
#
#  upload-assets.sh  --  chess frontend
#	Uploads client/src/images & client/src/audio to s3://<bucket>/<version>/ with a one-year immutable Cache-Control,
#	so browsers keep them between visits. A changed image goes up under a NEW version (v1 -> v2) and CHESS_ASSETS_URL
#	in client/.env moves to it, so the new path shows at once without an invalidation (client/README.md)
#
#	deploy/upload-assets.sh v2              (from the repo root)
#	BUCKET=other-bucket deploy/upload-assets.sh v2
#

set -euo pipefail

VERSION="${1:-}"
BUCKET="${BUCKET:-aws-prac-chess-s3}"
CACHE="public, max-age=31536000, immutable"

if [[ ! "$VERSION" =~ ^v[0-9]+$ ]]; then
	echo "usage: $0 <version, e.g. v2>" >&2
	exit 1
fi

cd "$(dirname "$0")/../client/src"
for dir in images audio; do
	[[ -d "$dir" ]] || { echo "client/src/$dir is missing (copy the assets back first)" >&2; exit 1; }
done

for dir in images audio; do
	aws s3 sync "$dir" "s3://$BUCKET/$VERSION/$dir" --exclude "*.DS_Store" --cache-control "$CACHE"
done

echo "Uploaded to s3://$BUCKET/$VERSION/. Set CHESS_ASSETS_URL=https://assets.chess.aws-prac-route53.com/$VERSION in client/.env, then rebuild the client."
