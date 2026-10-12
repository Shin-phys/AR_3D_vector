#!/bin/sh
# =====================================================================
# tools/vendor/build-three.sh — vendor/ の3Dライブラリを作り直す
#
# ★ ふだんは使わない。vendor/ のファイルはリポジトリに入れてあり、
#   GitHub Pages がそのまま配る（CDN から読まない。学校のネットワークが
#   CDN を塞いでいると3Dが開かないため。3D仕様.md §2）。
#
# three.js の r160 以降は ES Modules しか配っていない。ES Modules は
# file:// でダブルクリックしたときに CORS で弾かれるので、このアプリの
# 「ダブルクリックで開ける」を守るため、名前空間 THREE に載せる IIFE に
# 一度だけまとめておく（2D の HG と同じ考え方）。
#
#   sh tools/vendor/build-three.sh
# =====================================================================
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WORK="$(mktemp -d)"
cd "$WORK"
npm init -y >/dev/null
# バージョンは固定。model-viewer 4.3.1 は three ^0.183 を前提にしているので揃える
npm i three@0.183.2 @google/model-viewer@4.3.1 esbuild@0.25.10 >/dev/null
cp "$HERE/three-entry.js" entry.js
npx esbuild entry.js --bundle --format=iife --minify --legal-comments=none \
  --target=es2019 --outfile="$ROOT/vendor/three-bundle.js"
cp node_modules/@google/model-viewer/dist/model-viewer-umd.min.js "$ROOT/vendor/"
cp node_modules/three/LICENSE "$ROOT/vendor/LICENSE-three.txt"
cp node_modules/@google/model-viewer/LICENSE "$ROOT/vendor/LICENSE-model-viewer.txt"
echo "vendor/ を作り直しました（three 0.183.2 / model-viewer 4.3.1）"
