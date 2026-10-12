/* =====================================================================
   hg3d/testdata.js — 答えが分かっている合成データ（3D仕様.md §9）

   「3D 軌跡を作る → 仮想カメラで画像座標に投影する → ノイズを加える」。
   受け入れ条件はこのデータで確かめてから次へ進む。

   ★ ノイズを甘くしないこと。★ 仕様書の受け入れ条件には
   「満たしてしまったらノイズの入れ方が甘い」という確認も入っている。
   追跡のノイズは ±1 px（σ）、四隅のタップのずれは ±2 px（σ）を既定にする。

   カメラ座標：x 右、y 下、z 前（画像座標と同じ向き）。
   世界座標：reconstruct.js と同じ（y 上、紙は y = 0、角 A が原点、A→B が +x）。
   ===================================================================== */
(function (HG) {
  'use strict';

  /** 再現できる乱数（テストの結果が毎回変わらないように） */
  function rng(seed) {
    let s = seed >>> 0 || 1;
    const u = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    return {
      u: u,
      gauss() { let a = 0; while (!a) a = u(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * u()); }
    };
  }

  /**
   * 仮想カメラ。target を見る位置に置く。
   * @param o {W, H, hfov(度), dist(m), elev(度：水平からの仰角), azim(度：+z 側から時計回り), target}
   */
  function camera(o) {
    const W = o.W || 1920, H = o.H || 1080;
    const f = (W / 2) / Math.tan((o.hfov || 69) / 2 * Math.PI / 180);
    const e = (o.elev === undefined ? 40 : o.elev) * Math.PI / 180;
    const a = (o.azim || 0) * Math.PI / 180;
    const tg = o.target || { x: 0, y: 0, z: 0 };
    const d = o.dist || 1.5;
    const pos = { x: tg.x + d * Math.cos(e) * Math.sin(a), y: tg.y + d * Math.sin(e),
                  z: tg.z + d * Math.cos(e) * Math.cos(a) };
    /* 前方 = target へ、右 = 前 × 上（世界の上 (0,1,0)）、下 = 前 × 右 */
    let fw = [tg.x - pos.x, tg.y - pos.y, tg.z - pos.z];
    const n = v => { const l = Math.hypot(v[0], v[1], v[2]); return v.map(x => x / l); };
    const cr = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
    fw = n(fw);
    /* 真上から（elev = 90°）は上方向が決まらないので、そのときは −z を画面の上にする */
    const upW = Math.abs(fw[1]) > 0.999 ? [0, 0, -1] : [0, 1, 0];
    const right = n(cr(fw, upW));
    const down = n(cr(fw, right));
    function project(p) {
      const r = [p.x - pos.x, p.y - pos.y, p.z - pos.z];
      const xc = r[0] * right[0] + r[1] * right[1] + r[2] * right[2];
      const yc = r[0] * down[0] + r[1] * down[1] + r[2] * down[2];
      const zc = r[0] * fw[0] + r[1] * fw[1] + r[2] * fw[2];
      return { x: f * xc / zc + W / 2, y: f * yc / zc + H / 2, depth: zc };
    }
    return { W: W, H: H, f: f, pos: pos, project: project };
  }

  /**
   * 紙の上の等速円運動を斜めから撮った合成データ。
   * @param o {R, T, fps, dur, noise(px), tapNoise(px), paper:{w,h}, center:{x,z}, cam:{...}, seed}
   */
  function circle(o) {
    o = o || {};
    const R = o.R || 0.20, T = o.T || 1.8, fps = o.fps || 30, dur = o.dur || 2.4;
    const paper = o.paper || { w: 0.297, h: 0.210 };
    const c = o.center || { x: paper.w / 2, z: paper.h / 2 };
    const g = rng(o.seed || 7);
    const noise = o.noise === undefined ? 1 : o.noise;
    const tapNoise = o.tapNoise === undefined ? 2 : o.tapNoise;
    const cam = camera(Object.assign({ target: { x: c.x, y: 0, z: c.z } }, o.cam || {}));

    const corners = [[0, 0], [paper.w, 0], [paper.w, paper.h], [0, paper.h]].map(q => {
      const p = cam.project({ x: q[0], y: 0, z: q[1] });
      return { x: p.x + tapNoise * g.gauss(), y: p.y + tapNoise * g.gauss() };
    });
    const frames = [], truth = [];
    const n = Math.round(dur * fps);
    for (let i = 0; i <= n; i++) {
      /* VFR を真似て時刻をわずかに揺らす（Δt は実測値を使う、という約束の確認） */
      const t = i / fps + (o.vfr ? (g.u() - 0.5) * 0.004 : 0);
      const th = 2 * Math.PI * t / T + (o.phase || 0);
      const w = { x: c.x + R * Math.cos(th), y: 0, z: c.z + R * Math.sin(th) };
      const p = cam.project(w);
      const x = p.x + noise * g.gauss(), y = p.y + noise * g.gauss();
      frames.push({ index: i, t: t, x: x, y: y, rawX: x, rawY: y, found: true, manual: false });
      truth.push(w);
    }
    return { W: cam.W, H: cam.H, camera: cam, corners: corners, frames: frames, truth: truth,
             center: { x: c.x, y: 0, z: c.z }, R: R, T: T, paper: paper };
  }

  HG.testdata = { rng, camera, circle };
})(typeof window !== 'undefined' ? (window.HG = window.HG || {}) : (globalThis.HG = globalThis.HG || {}));
