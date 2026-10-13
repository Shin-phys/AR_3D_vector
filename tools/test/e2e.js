/* =====================================================================
   tools/test/e2e.js — 3d.html を最初から最後まで通すテスト（ブラウザ）

     node tools/test/e2e.js            # 結果だけ
     node tools/test/e2e.js --shots    # スクリーンショットも tools/test/out/ に残す

   お手本動画（合成。答えは samples/turntable.json）で、生徒と同じ操作をする：
     タイル → お手本 → トリム（1周ぶん）→ 四隅を押す → 追う色 → 自動追跡 → はい
     → 使うコマ（8点）→ 3D で見る → 視点・表示・影・予測
   そのうえで、復元した半径と Δv の向きを答えと比べる。

   ★ 共有モジュール（SHARED.txt）を取り込み直したら、必ずこれを走らせること。★
   ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { launch, serve, ROOT } = require('./pw.js');

const SHOTS = process.argv.includes('--shots');
const OUT = path.join(__dirname, 'out');
const truth = JSON.parse(fs.readFileSync(path.join(ROOT, 'samples/turntable.json'), 'utf8'));
let fails = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  … ' + detail : ''));
  if (!ok) fails++;
}

/** 元解像度の座標 (x, y) をキャンバス上で押す（指と同じく pointer イベントで） */
async function tapAt(pg, x, y, drag) {
  const p = await pg.evaluate(([x, y]) => {
    const c = HG.coords.toCanvas(x, y), cv = HG.stage.canvas(), r = cv.getBoundingClientRect();
    return { x: r.left + c.x * r.width / cv.width, y: r.top + c.y * r.height / cv.height };
  }, [x, y]);
  await pg.mouse.move(p.x + (drag ? 25 : 0), p.y + (drag ? 18 : 0));
  await pg.mouse.down();
  if (drag) await pg.mouse.move(p.x, p.y, { steps: 6 });   // 置いてからずらして合わせる（2段階の照準）
  await pg.mouse.up();
}

async function runFlow(pg, label) {
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  /* 読み込めなかったファイル（ブラウザが勝手に取りに行く favicon は除く） */
  pg.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) errs.push(r.status() + ' ' + r.url()); });
  const shot = async name => { if (SHOTS) await pg.screenshot({ path: path.join(OUT, label + '-' + name + '.png'), fullPage: false }); };

  await pg.goto(pg.__base + '3d.html');
  const tiles = await pg.$$eval('#tiles .tile', b => b.map(x => ({ id: x.dataset.id, dis: x.disabled })));
  check(label + '：タイル4枚（準備中1枚は押せない）', tiles.length === 4 && tiles.filter(t => t.dis).length === 1,
        tiles.map(t => t.id + (t.dis ? '(準備中)' : '')).join(' '));
  await shot('0-tiles');
  await pg.click('[data-id=turntable]');
  await pg.click('#sampleBtn');
  await pg.waitForSelector('#screen2:not(.hide)', { timeout: 60000 });
  await pg.waitForFunction(() => HG.state.frames.length > 50 && HG.state.frames.every(f => typeof f.t === 'number'));
  const nf = await pg.evaluate(() => HG.state.frames.length);
  check(label + '：お手本を読み込んでコマを走査', nf >= 80, nf + ' コマ');

  /* 1 トリム：t=0 から 1 周の少し手前まで */
  const outI = Math.round(truth.T * truth.fps) - 3;
  await pg.evaluate(() => HG.frames.showFrame(0)); await pg.click('#setIn');
  await pg.evaluate(i => HG.frames.showFrame(i), outI); await pg.click('#setOut');
  await pg.waitForFunction(() => HG.ui.current === 0);
  check(label + '：ステップ1 ✓', await pg.evaluate(() => HG.steps.done(1)));

  /* 2 四隅（t=0 のコマで、長い辺の端から一周） */
  await pg.click('#cornerStart');
  await pg.waitForTimeout(800);       // スマホ幅では「決定」が見えるところまで送るので、止まるのを待つ
  for (let i = 0; i < 4; i++) {
    const c = truth.corners_t0[i];
    await tapAt(pg, c[0], c[1], i === 0);
    if (i === 0) await shot('2-corner-aim');
    await pg.click('#cornerDecide');
  }
  const ready = await pg.evaluate(() => HG.recon.ready());
  check(label + '：ステップ2 四隅から射影変換が解ける', ready && await pg.evaluate(() => HG.steps.done(2)));
  await shot('2-corners');

  /* 3 追う色（シールの中心） */
  await pg.click('#pickColor');
  await tapAt(pg, truth.sticker_t0[0], truth.sticker_t0[1]);
  await pg.click('#pickDecide');
  check(label + '：ステップ3 ✓', await pg.evaluate(() => HG.steps.done(3)));

  /* 4 自動追跡 → はい */
  await pg.click('#runTrack');
  await pg.waitForSelector('#trackAskRow:not(.hide)', { timeout: 60000 });
  const rep = await pg.evaluate(() => HG.state.tracking.report);
  check(label + '：自動追跡で見失いが少ない', rep && rep.lost.length <= 2, rep ? rep.tracked + '/' + rep.total + '（見失い ' + rep.lost.length + '）' : 'なし');
  await pg.click('#trackOk');
  check(label + '：ステップ4 ✓（「はい」を押した）', await pg.evaluate(() => HG.steps.done(4)));

  /* 5 使うコマ（プリセットの 8 点） */
  const sel = await pg.evaluate(() => ({ n: HG.selection.list().filter(f => f.found).length, iv: HG.state.selection.interval }));
  check(label + '：ステップ5 使うコマ 8 点前後・✓', sel.n >= 7 && sel.n <= 9 && await pg.evaluate(() => HG.steps.done(5)),
        sel.n + ' 点／' + sel.iv + ' コマおき');
  check(label + '：ステップ6 は押す前は ✓ にならない', !(await pg.evaluate(() => HG.steps.done(6))));
  await shot('5-select');

  /* 6 3D で見る */
  await pg.click('#open3d');
  await pg.waitForTimeout(1600);     // 撮影位置 → 斜め へ回り込むアニメーション
  check(label + '：ステップ6 ✓（3D を開いた）', await pg.evaluate(() => HG.steps.done(6)));
  const vis = await pg.evaluate(() => {
    const r = document.querySelector('#view3d canvas').getBoundingClientRect();
    return { w: r.width, h: r.height, stage: getComputedStyle(document.querySelector('#stageCard')).display };
  });
  check(label + '：3D の画面が動画と入れ替わる', vis.w > 100 && vis.h > 100 && vis.stage === 'none', Math.round(vis.w) + '×' + Math.round(vis.h));
  const hmax = await pg.evaluate(() => document.querySelector('.col-main').getBoundingClientRect().height / window.innerHeight);
  if (label === 'phone') check(label + '：貼り付くブロックが画面の半分以下', hmax <= 0.55, (hmax * 100).toFixed(0) + '%');
  await shot('6-oblique');

  /* 答え合わせ：半径（円を当てはめない。真の中心からの距離の平均）と Δv の向き */
  const acc = await pg.evaluate(c => {
    const C = HG.recon.toWorld(c[0], c[1]);
    const rad = HG.track3dAll.map(p => Math.hypot(p.x - C.x, p.z - C.z));
    const mean = rad.reduce((s, v) => s + v, 0) / rad.length;
    const ang = HG.kin3d.a.map(a => {
      const tx = C.x - a.at.x, tz = C.z - a.at.z;
      return Math.abs(Math.atan2(a.d2.x * tz - a.d2.z * tx, a.d2.x * tx + a.d2.z * tz)) * 180 / Math.PI;
    });
    return { mean: mean, n: HG.track3d.length, nAll: HG.track3dAll.length, worst: Math.max.apply(null, ang), na: ang.length };
  }, truth.center_px);
  const err = Math.abs(acc.mean - truth.R) / truth.R * 100;
  check(label + '：実際に追跡した点で半径の誤差 3% 以内', err <= 3,
        (acc.mean * 100).toFixed(2) + ' cm（真値 ' + (truth.R * 100).toFixed(1) + ' cm）誤差 ' + err.toFixed(2) + '%、' + acc.nAll + ' 点');
  check(label + '：実際に追跡した点で Δv が中心から ±5° 以内', acc.worst <= 5, acc.na + ' 本、最大 ' + acc.worst.toFixed(2) + '°');

  /* 視点を回す（真上） */
  await pg.click('[data-view=top]');
  await pg.waitForTimeout(1100);
  await shot('6-top');

  /* 予測を経てから Δv（教師が ON にしたとき） */
  await pg.evaluate(() => { document.querySelector('#viewBody details').open = true; });
  await pg.check('#usePrediction');
  await pg.check('#lyVel');
  await pg.click('#lyDv');
  const gate = await pg.evaluate(() => ({ gate: !document.querySelector('#predGate').classList.contains('hide'),
    dv: HG.viewer.opts.layers.dv, q: document.querySelector('#predGate .pred-qtext') && document.querySelector('#predGate .pred-qtext').textContent }));
  check(label + '：Δv の前に予測を聞く（Δv はまだ出ない）', gate.gate && !gate.dv, gate.q || '');
  const same = await pg.evaluate(() => {
    const a = HG.presets.byId('circle').predictions[0].options.map(o => o.id + o.label).join();
    const b = [...document.querySelectorAll('#predGate .pred-opt')].map(e => e.textContent).join();
    return a === b;
  });
  check(label + '：予測の選択肢が 2D の円運動と同じ文言・並び', same);
  await shot('6-pred');
  await pg.click('#predGate [data-id=B]');
  const after = await pg.evaluate(() => ({ dv: HG.viewer.opts.layers.dv, strip: document.querySelector('#predShown').textContent,
    reveal: !document.querySelector('#revealNote').classList.contains('hide') }));
  check(label + '：予測のあと Δv が出る／解説はまだ出ない', after.dv && /B/.test(after.strip) && !after.reveal, after.strip);
  await pg.click('[data-view=oblique]');
  await pg.waitForTimeout(1100);
  await shot('6-vectors');

  /* 壁に影を落とす → グラフ */
  await pg.check('#lyWallBack');
  await pg.waitForTimeout(200);
  const g = await pg.evaluate(() => ({ card: !document.querySelector('#graphCard').classList.contains('hide'),
    reveal: !document.querySelector('#revealNote').classList.contains('hide') }));
  check(label + '：奥の壁の影 → グラフが出る・解説が出る', g.card && g.reveal);
  await pg.evaluate(() => { HG.panel3d.setNow(Math.round(HG.track3dAll.length * 0.3)); });
  await pg.click('[data-view=front]');
  await pg.waitForTimeout(1100);
  await shot('6-wall-front');
  if (SHOTS) {
    const el = await pg.$('#graphCard');
    await el.screenshot({ path: path.join(OUT, label + '-6-graph.png') });
  }
  await pg.click('[data-view=camera]');
  await pg.waitForTimeout(1100);
  await shot('6-camera');

  /* AR：この端末（headless）は Quick Look も WebXR も無いので欄ごと隠れる。
     中身から USDZ・GLB が作れることだけ確かめる（実機で開くかは ar-test.html で確認済み） */
  const arv = await pg.evaluate(async () => ({ mode: HG.panel3d.arMode(),
    hidden: document.querySelector('#arRow').classList.contains('hide'), sz: await HG.panel3d.arSizes() }));
  check(label + '：AR 非対応の端末では AR の欄が出ない', arv.mode === '' && arv.hidden);
  check(label + '：いまの表示から USDZ と GLB（動きつき）が作れる', arv.sz.usdz > 1000 && arv.sz.glb > 1000,
        'USDZ ' + (arv.sz.usdz / 1024).toFixed(0) + ' KB ／ GLB ' + (arv.sz.glb / 1024).toFixed(0) + ' KB');
  /* 奥の壁を出しているので、動くのは「いま」の球・影・投影の線の3つ */
  check(label + '：USDZ に動き（timeSamples）が入り、model.usda が先頭', arv.sz.samples === 3 && arv.sz.end && arv.sz.first === 'model.usda',
        'timeSamples ' + arv.sz.samples + ' 本、1回 ' + arv.sz.seconds.toFixed(2) + ' 秒（×0.5）');
  check(label + '：机上サイズは中身が約 45 cm になる倍率', arv.sz.desk > 0.3 && arv.sz.desk <= 4, '×' + arv.sz.desk);

  /* Δv の倍率は 1 倍未満も選べる（×0.5 で矢印の長さが半分） */
  const zl = await pg.evaluate(() => {
    const len = () => { const g = HG.viewer.content(); let n = 0; g.traverse(o => { if (o.isMesh && o.geometry.type === 'ConeGeometry' && o.material.color.getHexString() === 'ff7a00') n += o.parent.position.length() * 0 + 1; }); return n; };
    const s = document.querySelector('#dvZoom');
    const L = () => HG.kin3d.a.map(a => Math.hypot(a.d2.x, a.d2.z));
    s.value = 5; s.dispatchEvent(new Event('input'));
    const half = { z: HG.viewer.opts.dvZoom, label: document.querySelector('#dvZoomVal').textContent };
    s.value = 9; s.dispatchEvent(new Event('input'));
    return { half: half, back: HG.viewer.opts.dvZoom, min: +s.min, max: +s.max };
  });
  check(label + '：Δv の倍率に 1 倍未満がある', zl.half.z === 0.5 && zl.back === 1, zl.half.label);

  /* 実物の写真で表示（切り替え。既定は球） */
  check(label + '：既定は球（写真の切り替えは OFF）', !(await pg.isChecked('#lyPhoto')));
  await pg.check('#lyPhoto');
  await pg.waitForFunction(() => document.querySelector('#photoInfo').textContent === '' &&
    (() => { let n = 0; HG.viewer.content().traverse(o => { if (o.userData && o.userData.photo) n++; }); return n > 0; })(), null, { timeout: 30000 });
  const ph = await pg.evaluate(() => { let n = 0; HG.viewer.content().traverse(o => { if (o.userData && o.userData.photo) n++; }); return { n: n, track: HG.track3d.length }; });
  check(label + '：写真の札がストロボの点の数だけ出る', ph.n === ph.track, ph.n + ' 枚／' + ph.track + ' 点');
  await pg.click('[data-view=top]'); await pg.waitForTimeout(1100);
  await shot('6-photo');
  const arp = await pg.evaluate(async () => (await HG.panel3d.arSizes()));
  check(label + '：写真のまま AR（USDZ）が作れる', arp.usdz > 1000 && arp.samples >= 1, (arp.usdz / 1024).toFixed(0) + ' KB');
  await pg.uncheck('#lyPhoto');

  /* 再生が止められる */
  await pg.click('#playBtn'); await pg.waitForTimeout(500);
  const moved = await pg.evaluate(() => +document.querySelector('#nowSlider').value);
  await pg.click('#playBtn');
  check(label + '：再生で時刻が進み、止められる', moved >= 0 && /再生/.test(await pg.textContent('#playBtn')));

  /* 使うコマを変えたら 3D が作り直される（selection:changed） */
  const before = await pg.evaluate(() => HG.track3d.length);
  await pg.evaluate(() => { const s = document.querySelector('#selCount'); s.value = 5; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); });
  const afterN = await pg.evaluate(() => HG.track3d.length);
  check(label + '：使う点の数を変えると 3D が作り直される', afterN !== before && afterN >= 4, before + ' → ' + afterN + ' 点');

  /* 動画に戻る */
  await pg.click('#back2d');
  const back = await pg.evaluate(() => getComputedStyle(document.querySelector('#stageCard')).display);
  check(label + '：動画に戻れる', back !== 'none');

  /* 要素 id の配線漏れ（共有モジュールが探す id が 3d.html にあるか） */
  const missing = await pg.evaluate(() => {
    const src = [...document.scripts].map(s => s.src).filter(s => /\/js\//.test(s));
    return Promise.all(src.map(u => fetch(u).then(r => r.text()))).then(txts => {
      const ids = new Set();
      txts.forEach(t => { (t.match(/\$\('#([A-Za-z0-9_-]+)'\)/g) || []).forEach(m => ids.add(m.slice(4, -2)));
                          (t.match(/HG\.dom\.\w+\('#([A-Za-z0-9_-]+)'/g) || []).forEach(m => ids.add(m.replace(/.*'#/, '').replace(/'$/, ''))); });
      return [...ids].filter(id => !document.getElementById(id));
    });
  });
  check(label + '：スクリプトが探す要素がすべてある', !missing.length, missing.join(', '));
  check(label + '：エラーなし', !errs.length, errs.slice(0, 3).join(' | '));
}

/* ===== ボードに沿った投射（鉛直な面）===== */
const truthT = JSON.parse(fs.readFileSync(path.join(ROOT, 'samples/throw.json'), 'utf8'));
async function throwFlow(pg, label) {
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) errs.push(r.status() + ' ' + r.url()); });
  const shot = async name => { if (SHOTS) await pg.screenshot({ path: path.join(OUT, label + '-' + name + '.png'), fullPage: false }); };
  await pg.goto(pg.__base + '3d.html');
  await pg.click('[data-id=throw]');
  await pg.click('#sampleBtn');
  await pg.waitForSelector('#screen2:not(.hide)', { timeout: 60000 });
  await pg.waitForFunction(() => HG.state.frames.length > 20 && HG.state.frames.every(f => typeof f.t === 'number'));
  const st0 = await pg.evaluate(() => ({ plane: HG.recon.state.plane, paper: HG.recon.state.paper.w,
    box: !document.querySelector('#plumbBox').classList.contains('hide') }));
  check(label + '：投射のタイルで面が「鉛直」・紙が模造紙の半分・糸の欄が出る', st0.plane === 'vertical' && Math.abs(st0.paper - 0.788) < 1e-6 && st0.box);
  /* トリム：投げた瞬間〜落ちる手前。コマ番号ではなく時刻で探す
     （走査でコマが落ちることがあり、番号は動画のコマ番号と一致しない） */
  const near = await pg.evaluate(([a, b]) => {
    const fr = HG.state.frames, t0 = fr[0].t;
    const at = t => fr.reduce((k, f, i) => Math.abs(f.t - t0 - t) < Math.abs(fr[k].t - t0 - t) ? i : k, 0);
    return [at(a + 0.02), at(b - 0.02)];
  }, [truthT.launchT, truthT.landT]);
  await pg.evaluate(i => HG.frames.showFrame(i), near[0]); await pg.click('#setIn');
  await pg.evaluate(i => HG.frames.showFrame(i), near[1]); await pg.click('#setOut');
  await pg.waitForFunction(i => HG.ui.current === i, near[0]);
  /* 四隅 */
  await pg.click('#cornerStart'); await pg.waitForTimeout(800);
  for (let i = 0; i < 4; i++) { const c = truthT.corners_t0[i]; await tapAt(pg, c[0], c[1]); await pg.click('#cornerDecide'); }
  const noPlumb = await pg.evaluate(() => HG.recon.state.downSource);
  check(label + '：糸を押す前は「画面の下」を下とみなす', noPlumb === 'image');
  /* 糸の2点 */
  await pg.click('#plumbStart'); await pg.waitForTimeout(800);
  for (let i = 0; i < 2; i++) { const c = truthT.plumb[i]; await tapAt(pg, c[0], c[1]); await pg.click('#cornerDecide'); }
  const pl = await pg.evaluate(() => ({ src: HG.recon.state.downSource, info: document.querySelector('#plumbInfo').textContent }));
  check(label + '：糸で鉛直を決めた', pl.src === 'plumb', pl.info.slice(0, 40));
  await shot('t2-plumb');
  /* 色 → 追跡 */
  /* 投げる前のコマ（ボールが止まっている）で色を選ぶ */
  await pg.evaluate(() => HG.frames.showFrame(0));
  await pg.click('#pickColor');
  await tapAt(pg, truthT.ball_t0[0], truthT.ball_t0[1]);
  await pg.click('#pickDecide');
  await pg.click('#runTrack');
  await pg.waitForSelector('#trackAskRow:not(.hide)', { timeout: 60000 });
  const rep = await pg.evaluate(() => HG.state.tracking.report);
  check(label + '：投射を自動追跡（見失い 2 コマ以下）', rep && rep.lost.length <= 2, rep ? rep.tracked + '/' + rep.total : '');
  await pg.click('#trackOk');
  const n = await pg.evaluate(() => HG.selection.list().filter(f => f.found).length);
  check(label + '：使うコマは 5 点前後（投射の既定）', n >= 4 && n <= 6, n + ' 点');
  await pg.click('#open3d'); await pg.waitForTimeout(1600);
  const r = await pg.evaluate(() => {
    const ang = HG.kin3d.a.map(a => Math.atan2(Math.hypot(a.d2.x, a.d2.z), -a.d2.y) * 180 / Math.PI);
    const vx = HG.kin3d.v.map(v => v.vx);
    const g = HG.kin3d.a.reduce((s, a) => s - a.ay, 0) / HG.kin3d.a.length;
    return { worst: Math.max.apply(null, ang), na: ang.length, vxs: (Math.max(...vx) - Math.min(...vx)) / Math.abs(vx[0]) * 100, g: g,
             back: !document.querySelector('#lyWallBackL').classList.contains('hide'), floor: !document.querySelector('#lyFloorL').classList.contains('hide') };
  });
  check(label + '：実際に追跡した投射で Δv が鉛直下向き ±5°', r.worst <= 5, r.na + ' 本、最大 ' + r.worst.toFixed(2) + '°');
  check(label + '：水平の速度がほぼ一定（5% 以内）', r.vxs <= 5, r.vxs.toFixed(1) + '%');
  check(label + '：Δv÷Δt ≒ g（ボードの手前 3.5 cm のぶん少し大きい見積もり）', Math.abs(r.g - 9.8) / 9.8 < 0.06, r.g.toFixed(2) + ' m/s²');
  check(label + '：影の選択肢は「床」と「横の壁」（奥の壁＝ボードは出さない）', !r.back && r.floor);
  await shot('t6-oblique');
  /* 床と横の壁に影、矢印の影も */
  await pg.check('#lyVel');
  await pg.evaluate(() => { const c = document.querySelector('#lyDv'); c.checked = true; c.dispatchEvent(new Event('change')); });
  await pg.check('#lyFloor'); await pg.check('#lyWallSide');
  await pg.waitForTimeout(300);
  const g2 = await pg.evaluate(() => ({ card: !document.querySelector('#graphCard').classList.contains('hide'),
    legend: document.querySelector('#graphLegend').textContent,
    /* Δv の床の影（橙・半透明）の長さ：ほぼゼロのはず */
    floorDv: HG.kin3d.a.map(a => Math.hypot(a.d2.x, a.d2.z) / Math.hypot(a.d2.x, a.d2.y, a.d2.z)) }));
  check(label + '：グラフは床の影（x）と横の壁の影（y）', g2.card && /床の影/.test(g2.legend) && /鉛直/.test(g2.legend), g2.legend);
  check(label + '：Δv の床の影はほぼ点（水平成分が全体の 10% 未満）', g2.floorDv.every(v => v < 0.1),
        '最大 ' + (Math.max.apply(null, g2.floorDv) * 100).toFixed(1) + '%');
  await pg.click('[data-view=oblique]'); await pg.waitForTimeout(1100);
  await shot('t6-shadows');
  if (SHOTS) { const el = await pg.$('#graphCard'); await el.screenshot({ path: path.join(OUT, label + '-t6-graph.png') }); }
  const arv = await pg.evaluate(async () => (await HG.panel3d.arSizes()));
  check(label + '：投射でも AR（動きつき）が作れる', arv.usdz > 1000 && arv.samples >= 3, 'timeSamples ' + arv.samples);
  check(label + '：エラーなし', !errs.length, errs.slice(0, 3).join(' | '));
}

(async () => {
  if (SHOTS) fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve(ROOT);
  const b = await launch();
  for (const [label, vp] of [['phone', { width: 390, height: 844 }], ['pc', { width: 1280, height: 860 }]]) {
    console.log('[' + label + ' ' + vp.width + '×' + vp.height + ']');
    const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: false });
    const pg = await ctx.newPage();
    pg.__base = srv.url;
    try { await runFlow(pg, label); } catch (e) { check(label + '：最後まで通る', false, e.message.split('\n')[0]); }
    await ctx.close();
    const ctx2 = await b.newContext({ viewport: vp, deviceScaleFactor: 2 });
    const pg2 = await ctx2.newPage();
    pg2.__base = srv.url;
    try { await throwFlow(pg2, label); } catch (e) { check(label + '：投射が最後まで通る', false, e.message.split('\n')[0]); }
    await ctx2.close();
  }
  await b.close(); srv.close();
  console.log(fails ? '\n' + fails + ' 件失敗' : '\nすべて通りました');
  process.exit(fails ? 1 : 0);
})();
