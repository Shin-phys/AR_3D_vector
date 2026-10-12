#!/bin/sh
# =====================================================================
# tools/sync-shared.sh — ホドグラフ（2D）から共有モジュールを取り込み直す
#
#   sh tools/sync-shared.sh ~/Webアプリ開発/ホドグラフ
#
# ★ ここに並んだファイルは、このリポジトリでは編集しないこと。★
# 直したいときはホドグラフ側で直してから、このスクリプトで取り込む。
# こちらで直すと、2つの追跡が別々に育つ（3D仕様.md の「同じリポジトリに
# する理由」がそのまま当てはまる）。取り込んだら必ずテストを走らせる：
#   node tools/test/run.js
# =====================================================================
set -e
SRC="${1:?ホドグラフのフォルダを指定してください}"
DST="$(cd "$(dirname "$0")/.." && pwd)"

FILES="
css/base.css
css/app.css
js/core/state.js
js/core/bus.js
js/core/coords.js
js/core/points.js
js/core/wakelock.js
js/ui/dom.js
js/presets/presets.js
js/analysis/color.js
js/analysis/blob.js
js/analysis/diagnostics.js
js/video/frames.js
js/video/scanner.js
js/video/loader.js
js/video/tracker.js
js/ui/stage.js
js/ui/arrows.js
js/ui/overlay.js
js/ui/timeline.js
js/ui/loupe.js
js/ui/pointer.js
js/ui/controls.js
js/ui/track-controls.js
js/ui/selection.js
js/io/exporter.js
"

for f in $FILES; do
  mkdir -p "$DST/$(dirname "$f")"
  cp "$SRC/$f" "$DST/$f"
done

# どのコミットから取ったかを残す（差分を追うときの手がかり）
REV=$(git -C "$SRC" log -1 --format='%h %s' 2>/dev/null || echo unknown)
{
  echo "# 共有モジュールの出所（tools/sync-shared.sh が書く。手で直さない）"
  echo "source: Hodograph"
  echo "commit: $REV"
  echo "synced: $(date '+%Y-%m-%d %H:%M')"
  echo "files:"
  for f in $FILES; do
    if command -v md5sum >/dev/null 2>&1; then h=$(md5sum "$DST/$f" | cut -c1-12)
    else h=$(md5 -q "$DST/$f" | cut -c1-12); fi        # macOS
    echo "  $f  $h"
  done
} > "$DST/SHARED.txt"
echo "取り込みました：$REV"
