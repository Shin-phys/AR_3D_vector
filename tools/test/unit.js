/* =====================================================================
   tools/test/unit.js — 計算だけの受け入れテスト（ブラウザ不要）

     node tools/test/unit.js

   3D仕様.md §9 の受け入れ条件のうち、計算で決まるものをここで確かめる。
   ・等速円運動（R=20cm, T=1.8s）を斜めから撮った合成データで
       4-A の復元半径の誤差 3% 以内、Δv の向きが中心から ±5° 以内
   ・同じデータで、壁の影の周期が元の周期と一致する
   ・撮影位置（カメラの位置）が復元できる（「撮影位置から見る」の土台）
   ===================================================================== */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
globalThis.HG = {};
require(ROOT + '/js/hg3d/geom.js');
require(ROOT + '/js/hg3d/testdata.js');
require(ROOT + '/js/hg3d/reconstruct.js');
const HG = globalThis.HG;

let fails = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  … ' + detail : ''));
  if (!ok) fails++;
}

/** 区間（1周ぶん）から n 点を等間隔に選ぶ（selection.setCount と同じ考え方の簡略版） */
function pick(frames, lo, hi, n) {
  const m = Math.max(1, Math.floor((hi - lo) / (n - 1)));
  const out = [];
  for (let i = lo; i <= hi && out.length < n; i += m) out.push(frames[i]);
  return out;
}

function run(label, opt, n) {
  const d = HG.testdata.circle(opt);
  HG.recon.clearCorners();
  HG.recon.setCorners(d.corners, 0);
  const s = HG.recon.solve(d.W, d.H);
  if (!s.ok) { check(label + '：射影変換が解ける', false, s.reason); return; }
  const lo = 0, hi = Math.round(opt.T ? opt.T * 30 : 54);
  const sel = pick(d.frames, lo, hi, n);
  const r = HG.recon.computeFrom(sel, d.frames.slice(lo, hi + 1));

  /* 復元半径：3D の点と真の中心の距離の平均（円を当てはめない）。
     3D の x はカメラの右に合わせて回してあるので、真の中心も同じ道で
     （ノイズなしで画像に写してから）3D に戻して比べる */
  const pc = d.camera.project(d.center);
  const c = HG.recon.toWorld(pc.x, pc.y);
  const rad = r.trackAll.map(p => Math.hypot(p.x - c.x, p.z - c.z));
  const mean = rad.reduce((s, v) => s + v, 0) / rad.length;
  const err = Math.abs(mean - d.R) / d.R * 100;
  check(label + '：復元半径の誤差 3% 以内', err <= 3,
        '平均 ' + (mean * 100).toFixed(2) + ' cm（真値 ' + (d.R * 100).toFixed(1) + ' cm）誤差 ' + err.toFixed(2) + '%');

  /* Δv の向き：r_{k+1} から真の中心への向きとの角度差 */
  let worst = 0;
  r.kin.a.forEach(a => {
    const tx = c.x - a.at.x, tz = c.z - a.at.z;
    const ang = Math.abs(Math.atan2(a.d2.x * tz - a.d2.z * tx, a.d2.x * tx + a.d2.z * tz)) * 180 / Math.PI;
    worst = Math.max(worst, ang);
  });
  check(label + '：Δv の向きが中心から ±5° 以内', worst <= 5,
        r.kin.a.length + ' 本、最大 ' + worst.toFixed(2) + '°');

  /* 壁の影（奥の壁 = x を見る）の周期。0 を上向きに横切る時刻の間隔 */
  const xs = r.trackAll.map(p => p.x);
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const ups = [];
  for (let i = 1; i < r.trackAll.length; i++) {
    const a = xs[i - 1] - mx, b = xs[i] - mx;
    if (a < 0 && b >= 0) {
      const t0 = r.trackAll[i - 1].t, t1 = r.trackAll[i].t;
      ups.push(t0 + (t1 - t0) * (-a) / (b - a));
    }
  }
  return { d: d, r: r, ups: ups };
}

console.log('[合成データ] 等速円運動 R=20cm, T=1.8s, 1.5m・仰角40°, 追跡ノイズ σ=1px, 四隅 σ=2px');
const base = { R: 0.20, T: 1.8, fps: 30, dur: 4.0, cam: { dist: 1.5, elev: 40 }, seed: 11 };
run('斜め40°・8点', base, 8);
run('斜め40°・8点・VFR', Object.assign({}, base, { vfr: true, seed: 5 }), 8);
run('斜め30°・横から20°回り込み・8点', Object.assign({}, base, { cam: { dist: 1.5, elev: 30, azim: 20 }, seed: 3 }), 8);
run('真上・8点', Object.assign({}, base, { cam: { dist: 1.2, elev: 90 }, seed: 9 }), 8);

/* 周期：4秒ぶん（2周以上）の全コマで測る */
{
  const d = HG.testdata.circle(base);
  HG.recon.clearCorners(); HG.recon.setCorners(d.corners, 0); HG.recon.solve(d.W, d.H);
  const r = HG.recon.computeFrom([], d.frames);
  const xs = r.trackAll.map(p => p.x), mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const ups = [];
  for (let i = 1; i < xs.length; i++) {
    const a = xs[i - 1] - mx, b = xs[i] - mx;
    if (a < 0 && b >= 0) { const t0 = r.trackAll[i - 1].t, t1 = r.trackAll[i].t; ups.push(t0 + (t1 - t0) * (-a) / (b - a)); }
  }
  const per = (ups[ups.length - 1] - ups[0]) / (ups.length - 1);
  check('壁の影の周期が元の周期と一致（±2%）', Math.abs(per - 1.8) / 1.8 < 0.02,
        '影 ' + per.toFixed(3) + ' s（真値 1.800 s、上向きの交差 ' + ups.length + ' 回）');
}

/* 撮影位置の復元（「撮影位置から見る」の土台。3D 座標そのものには使わない） */
{
  const d = HG.testdata.circle(Object.assign({}, base, { tapNoise: 0 }));
  HG.recon.clearCorners(); HG.recon.setCorners(d.corners, 0); HG.recon.solve(d.W, d.H);
  const cw = HG.recon.cameraWorld();
  const e = Math.hypot(cw.pos.x - d.camera.pos.x, cw.pos.y - d.camera.pos.y, cw.pos.z - d.camera.pos.z);
  check('撮影位置の復元（四隅ずれ0）誤差 2cm 以内', e < 0.02,
        '誤差 ' + (e * 100).toFixed(2) + ' cm（合成カメラは標準カメラと同じ画角）');
  const d2 = HG.testdata.circle(base);
  HG.recon.clearCorners(); HG.recon.setCorners(d2.corners, 0); HG.recon.solve(d2.W, d2.H);
  const c2 = HG.recon.cameraWorld();
  const e2 = Math.hypot(c2.pos.x - d2.camera.pos.x, c2.pos.y - d2.camera.pos.y, c2.pos.z - d2.camera.pos.z);
  /* 四隅が 2px ずれると見る向きが数度ずれる（中央値 8°、90% で 12°。40通りで測った）。
     「撮影位置から見る」はおおよその視点なので、15° 以内を条件にする */
  const dir = (p, q) => { const v = [p.x - q.x, p.y - q.y, p.z - q.z]; const l = Math.hypot(...v); return v.map(x => x / l); };
  /* 3D は鉛直軸まわりに回してあるので、真の位置も同じだけ回して比べる。
     比べやすいよう、仰角（鉛直からの向き）と中心までの距離で見る */
  const cc = (() => { const p = d2.camera.project(d2.center); return HG.recon.toWorld(p.x, p.y); })();
  const u = dir(c2.pos, cc);
  const w0 = dir(d2.camera.pos, d2.center);
  const w = [0, w0[1], 0]; w[0] = Math.hypot(w0[0], w0[2]) * (u[0] / (Math.hypot(u[0], u[2]) || 1));
  w[2] = Math.hypot(w0[0], w0[2]) * (u[2] / (Math.hypot(u[0], u[2]) || 1));
  const ang = Math.acos(Math.min(1, u[0] * w[0] + u[1] * w[1] + u[2] * w[2])) * 180 / Math.PI;
  check('撮影位置の向き（四隅 σ=2px）誤差 15° 以内', ang < 15,
        '向き ' + ang.toFixed(1) + '°／距離の誤差 ' + (e2 * 100).toFixed(1) + ' cm（参考）');
  check('カメラは紙より上にある（y > 0）', c2.pos.y > 0, 'y = ' + c2.pos.y.toFixed(2) + ' m');
}

/* x は画面の右、z はカメラ側（3D仕様.md §3）。どの角から押し始めても同じ */
{
  const d = HG.testdata.circle(Object.assign({}, base, { cam: { dist: 1.5, elev: 35, azim: 50 }, tapNoise: 0 }));
  const res = [];
  for (let k = 0; k < 4; k++) {
    const q = [0, 1, 2, 3].map(i => d.corners[(i + k) % 4]);
    // 押し始める角を変えると長い辺／短い辺も入れ替わるので、紙の寸法も合わせる
    HG.recon.clearCorners(); HG.recon.state.paper = k % 2 ? { w: 0.210, h: 0.297 } : { w: 0.297, h: 0.210 };
    HG.recon.setCorners(q, 0); HG.recon.solve(d.W, d.H);
    const cam = HG.recon.cameraWorld();
    const pc = d.camera.project(d.center), c = HG.recon.toWorld(pc.x, pc.y);
    res.push(Math.atan2(cam.pos.x - c.x, cam.pos.z - c.z) * 180 / Math.PI);
  }
  HG.recon.state.paper = { w: 0.297, h: 0.210 };
  check('カメラが +z 側（手前）にある：押し始める角4通りとも ±3°', res.every(a => Math.abs(a) < 3),
        res.map(a => a.toFixed(1) + '°').join(' / '));
}

/* 反時計回りに押しても鏡像にならない（同じ円が同じ向きに回る） */
{
  const d = HG.testdata.circle(Object.assign({}, base, { tapNoise: 0, noise: 0 }));
  const cw = [d.corners[0], d.corners[1], d.corners[2], d.corners[3]];
  // A→D→C→B の順（反時計回り）＝ 長い辺の向きは変わらないよう A を D に置き換えて回る
  const ccw = [d.corners[3], d.corners[2], d.corners[1], d.corners[0]];
  HG.recon.clearCorners(); HG.recon.setCorners(cw, 0); HG.recon.solve(d.W, d.H);
  const a = HG.recon.computeFrom([], d.frames.slice(0, 10)).trackAll;
  HG.recon.clearCorners(); HG.recon.setCorners(ccw, 0); HG.recon.solve(d.W, d.H);
  const b = HG.recon.computeFrom([], d.frames.slice(0, 10)).trackAll;
  const turn = t => { // 上から見た回転の向き（y 成分の外積の符号）
    const u = [t[1].x - t[0].x, t[1].z - t[0].z], v = [t[2].x - t[1].x, t[2].z - t[1].z];
    return Math.sign(u[0] * v[1] - u[1] * v[0]);
  };
  check('押す向き（時計／反時計）で回転の向きが変わらない', turn(a) === turn(b) && turn(a) !== 0,
        '時計回りに押す ' + turn(a) + ' ／ 反時計回り ' + turn(b));
}

console.log(fails ? '\n' + fails + ' 件失敗' : '\nすべて通りました');
process.exit(fails ? 1 : 0);
