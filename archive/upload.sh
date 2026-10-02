#!/usr/bin/env bash
set -euo pipefail
DIR="${1:?usage: upload.sh <directory of image files>}"
PIN="${FILECOIN_PIN_CLI:-$(dirname "$0")/../node_modules/.bin/filecoin-pin}"
for f in "$DIR"/*.jpg; do
  name="$(basename "$f")"
  echo "=== $name"
  "$PIN" add "$f" --network calibration --copies 1 --provider-id 9 \
    --data-set-metadata archive=apollo-11 --metadata "name=$name"
done
