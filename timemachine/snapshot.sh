#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${TIMEMACHINE_WORK:-$HOME/focify-timemachine}"
CLONE="${FOCIFY_CLONE_CLI:-$ROOT/focify-clone/dist/cli.js}"
PIN="${FILECOIN_PIN_CLI:-$ROOT/node_modules/.bin/filecoin-pin}"
MAX_PAGES="${TIMEMACHINE_MAX_PAGES:-100}"
PIN_OPTS=(--network calibration --copies 1 --provider-id 9)
mkdir -p "$WORK/work"

while read -r url; do
  [[ -z "$url" || "$url" == \#* ]] && continue
  host="$(printf '%s' "$url" | sed -E 's#^https?://##; s#/.*$##')"
  ts="$(date -u +%Y-%m-%dT%H:%MZ)"
  out="$WORK/work/$host-$(date -u +%Y%m%dT%H%M)"
  echo "=== $host $ts"
  node "$CLONE" "$url" --out "$out" --max-pages "$MAX_PAGES" 2>"$WORK/$host.crawl.log" | tail -1
  meta=(--data-set-metadata "timemachine=$host")
  cid="$("$PIN" add "$out" --dry-run "${PIN_OPTS[@]}" "${meta[@]}" 2>&1 | awk '/Root CID/ {print $3; exit}')"
  if [[ -z "$cid" ]]; then echo "no CID from dry run, skipping"; rm -rf "$out"; continue; fi
  if [[ -f "$WORK/$host.last" && "$(cat "$WORK/$host.last")" == "$cid" ]]; then
    echo "unchanged since last snapshot ($cid), nothing stored"
    rm -rf "$out"
    continue
  fi
  "$PIN" add "$out" "${PIN_OPTS[@]}" "${meta[@]}" --metadata "name=$host@$ts" 2>&1 | grep -E "Root CID|Data Set ID|Piece ID|completed|✗|rror"
  echo "$cid" > "$WORK/$host.last"
  rm -rf "$out"
done < "$ROOT/timemachine/sites.txt"
