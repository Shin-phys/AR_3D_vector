/* =====================================================================
   tools/make-ar-test.js — ar-test/ の実ファイル（GLB・USDZ・見本の絵）を作る

     node tools/make-ar-test.js

   ar-test.html の方式1・2（実ファイル）で使う。中身は方式3・4（その場で作る）と
   まったく同じモデルにしてある（ar-test.html の __makeArFiles を呼ぶだけ）。
   同じモデルでないと、通った・通らないの差が方式の差なのか中身の差なのか分からない。
   ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { launch, serve, ROOT } = require('./test/pw.js');

(async () => {
  const srv = await serve(ROOT);
  const b = await launch();
  const pg = await b.newPage({ viewport: { width: 640, height: 900 } });
  pg.on('pageerror', e => console.error('pageerror', e.message));
  await pg.goto(srv.url + 'ar-test.html');
  await pg.waitForFunction(() => window.__makeArFiles && window.HG && HG.viewer.content());
  await pg.waitForTimeout(500);
  const r = await pg.evaluate(() => window.__makeArFiles());
  const out = path.join(ROOT, 'ar-test');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'test.glb'), Buffer.from(r.glb, 'base64'));
  fs.writeFileSync(path.join(out, 'test.usdz'), Buffer.from(r.usdz, 'base64'));
  fs.writeFileSync(path.join(out, 'thumb.png'), Buffer.from(r.thumb.split(',')[1], 'base64'));
  ['test.glb', 'test.usdz', 'thumb.png'].forEach(f =>
    console.log(f, (fs.statSync(path.join(out, f)).size / 1024).toFixed(0) + ' KB'));
  await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
