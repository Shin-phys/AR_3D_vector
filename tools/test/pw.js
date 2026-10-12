/* =====================================================================
   tools/test/pw.js — Playwright とブラウザの用意（テストと道具で共通）

   Playwright はリポジトリに入れない（依存ゼロの方針）。見つけ方：
     1) ふつうの require('playwright')（npm i -D playwright したとき）
     2) 環境変数 PLAYWRIGHT_PATH
     3) Claude の作業環境の既定の場所
   ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

function loadPlaywright() {
  const tries = ['playwright', process.env.PLAYWRIGHT_PATH,
    '/opt/npm-tools/node_modules/playwright', '/opt/node-tools/node_modules/playwright'].filter(Boolean);
  for (const t of tries) { try { return require(t); } catch (e) { /* 次へ */ } }
  throw new Error('Playwright が見つかりません。npm i -D playwright を実行してください。');
}

async function launch() {
  const { chromium } = loadPlaywright();
  const exe = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  return chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
}

/** リポジトリを http で配る（file:// では動画の画素が読めない場面があるため。GitHub Pages と同じ条件） */
function serve(root) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.glb': 'model/gltf-binary',
    '.usdz': 'model/vnd.usdz+zip', '.mp4': 'video/mp4', '.webm': 'video/webm', '.json': 'application/json' };
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      const f = path.join(root, p === '/' ? '/3d.html' : p);
      if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); rsp.end(); return; }
      rsp.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rsp);
    });
    srv.listen(0, '127.0.0.1', () => res({ url: 'http://127.0.0.1:' + srv.address().port + '/', close: () => srv.close() }));
  });
}

module.exports = { launch, serve, ROOT: path.resolve(__dirname, '../..') };
