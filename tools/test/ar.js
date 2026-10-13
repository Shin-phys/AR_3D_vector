/* =====================================================================
   tools/test/ar.js — ar-test.html が開き、AR 用のファイルが作れるか

   実機の AR が開くかはここでは確かめられない（それを確かめるのが ar-test.html）。
   ここで見るのは「同じ中身から GLB と USDZ がエラーなく作れる」「ページにエラーが無い」
   「実ファイル（ar-test/）が置いてある」まで。
   ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { launch, serve, ROOT } = require('./pw.js');
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? '  ok   ' : '  FAIL ') + n + (d ? '  … ' + d : '')); if (!ok) fails++; };
(async () => {
  const srv = await serve(ROOT); const b = await launch();
  const pg = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) errs.push(r.status() + ' ' + r.url()); });
  await pg.goto(srv.url + 'ar-test.html');
  await pg.waitForFunction(() => window.__makeArFiles && HG.viewer.content());
  const r = await pg.evaluate(async () => { const x = await window.__makeArFiles(); return { glb: x.glb.length, usdz: x.usdz.length }; });
  check('GLB と USDZ が作れる', r.glb > 1000 && r.usdz > 1000, 'GLB ' + (r.glb * 0.75 / 1024).toFixed(0) + ' KB ／ USDZ ' + (r.usdz * 0.75 / 1024).toFixed(0) + ' KB');
  /* 方式5：写真の札。USDZ の中に写真（png）と切り抜きのしきい値と動きが入っているか */
  const ph = await pg.evaluate(() => window.__photoUsdz());
  const buf = Buffer.from(ph, 'base64');
  fs.writeFileSync(path.join(__dirname, 'out-photo.usdz'), buf);
  const F = require(ROOT + '/tools/test/unzip.js');
  const files = F.list(buf);
  const usda = F.read(buf, 'model.usda').toString('utf8');
  const pngs = files.filter(f => /\.png$/.test(f)).length;
  check('方式5：写真（png）が入っている', pngs >= 9, pngs + ' 枚');
  check('方式5：切り抜き（opacityThreshold）', /opacityThreshold/.test(usda));
  check('方式5：「いま」の札が動く（timeSamples）', /HGANIM_ball[\s\S]*timeSamples/.test(usda));
  ['test.glb', 'test.usdz', 'thumb.png'].forEach(f => check('ar-test/' + f + ' がある', fs.existsSync(path.join(ROOT, 'ar-test', f))));
  check('エラーなし', !errs.length, errs.join(' | '));
  await b.close(); srv.close();
  process.exit(fails ? 1 : 0);
})();
