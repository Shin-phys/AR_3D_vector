/* =====================================================================
   tools/test/run.js — テストをまとめて走らせる

     node tools/test/run.js            # 計算のテスト＋ブラウザのテスト
     node tools/test/run.js --shots    # スクリーンショットも tools/test/out/ に残す

   ★ 共有モジュールを取り込み直したら（tools/sync-shared.sh）必ず走らせる。★
   ===================================================================== */
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const args = process.argv.slice(2);
let bad = 0;
for (const f of ['unit.js', 'e2e.js', 'ar.js']) {
  console.log('\n===== ' + f + ' =====');
  const r = spawnSync(process.execPath, [path.join(__dirname, f)].concat(args), { stdio: 'inherit' });
  if (r.status !== 0) bad++;
}
console.log(bad ? '\n失敗したファイル：' + bad : '\nすべてのテストが通りました');
process.exit(bad ? 1 : 0);
