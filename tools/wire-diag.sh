#!/usr/bin/env bash
# tools/wire-diag.sh
# Bulk insert <script src="/games/common/diag-autowire.js" defer></script>
# into every /games/<slug>/index.html just before </body>.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SNIP='<script src="/games/common/diag-autowire.js" defer></script>'

updated=0; skipped=0; missing=0
while IFS= read -r -d '' f; do
  if grep -q 'common/diag-autowire.js' "$f"; then
    ((skipped++)); continue
  fi
  if grep -q '</body>' "$f"; then
    tmp="${f}.tmp.$$"
    awk -v snip="$SNIP" '
      BEGIN{last=-1}
      {line[NR]=$0}
      END{
        for(i=NR;i>=1;i--) if(line[i] ~ /<\/body>/){last=i; break}
        for(i=1;i<last;i++) print line[i]
        print "  " snip
        for(i=last;i<=NR;i++) print line[i]
      }
    ' "$f" > "$tmp" && mv "$tmp" "$f"
    echo "[wire-diag] wired: $f"
    ((updated++))
  else
    echo "[wire-diag] WARN: no </body> in $f"
    ((missing++))
  fi
done < <(find "$ROOT/games" -mindepth 2 -maxdepth 2 -type f -name index.html -print0)

echo "[wire-diag] done: $updated updated, $skipped skipped, $missing missing </body>"
