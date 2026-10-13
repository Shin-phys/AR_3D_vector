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
    let right = n(cr(fw, upW));
    let down = n(cr(fw, right));
    /* 傾けて構えた（ロール）。糸が無いとき「画面の下」がずれることを確かめるため */
    if (o.roll) {
      const r = o.roll * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
      const R2 = right.map((v, i) => c * v + s * down[i]), D2 = down.map((v, i) => -s * right[i] + c * v);
      right = R2; down = D2;
    }
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

  /**
   * ボード（鉛直な面 z = 0）に沿った斜方投射。紙は A4 横向きでボードに貼る。
   * @param o {v0:{x,y}, g, fps, offset（ボールがボードの手前に出ている距離 m）, noise, tapNoise,
   *           plumbNoise, cam:{dist, elev, azim, roll}, seed}
   * 世界座標：x 右、y 上、z ボードから手前。紙の角 A は左上（長い辺の端）。
   */
  function projectile(o) {
    o = o || {};
    const g = rng(o.seed || 3);
    const G = o.g || 9.8, fps = o.fps || 60;
    const v0 = o.v0 || { x: 1.5, y: 2.6 };
    const p0 = o.p0 || { x: -0.40, y: -0.05 };
    const zoff = o.offset === undefined ? 0 : o.offset;
    const noise = o.noise === undefined ? 1 : o.noise;
    const tapNoise = o.tapNoise === undefined ? 2 : o.tapNoise;
    const plumbNoise = o.plumbNoise === undefined ? 2 : o.plumbNoise;
    const T = 2 * v0.y / G;
    const cam = camera(Object.assign({ target: { x: 0, y: 0.05, z: 0 }, elev: 8, dist: 1.6 }, o.cam || {}));
    const PW = (o.paper && o.paper.w) || 0.297, PH = (o.paper && o.paper.h) || 0.210, cx = 0, cy = 0.05;
    const corners = [[cx - PW / 2, cy + PH / 2], [cx + PW / 2, cy + PH / 2], [cx + PW / 2, cy - PH / 2], [cx - PW / 2, cy - PH / 2]]
      .map(q => { const p = cam.project({ x: q[0], y: q[1], z: 0 }); return { x: p.x + tapNoise * g.gauss(), y: p.y + tapNoise * g.gauss() }; });
    /* 糸：紙の右、ボードから 1 cm 手前に吊るす */
    const plumb = [{ x: 0.30, y: 0.35, z: 0.01 }, { x: 0.30, y: -0.20, z: 0.01 }]
      .map(q => { const p = cam.project(q); return { x: p.x + plumbNoise * g.gauss(), y: p.y + plumbNoise * g.gauss() }; });
    const frames = [], truth = [];
    const n = Math.floor(T * fps);
    for (let i = 0; i <= n; i++) {
      const t = i / fps;
      const w = { x: p0.x + v0.x * t, y: p0.y + v0.y * t - G * t * t / 2, z: zoff };
      const p = cam.project(w);
      const x = p.x + noise * g.gauss(), y = p.y + noise * g.gauss();
      frames.push({ index: i, t: t, x: x, y: y, rawX: x, rawY: y, found: true, manual: false });
      truth.push(w);
    }
    return { W: cam.W, H: cam.H, camera: cam, corners: corners, plumb: plumb, frames: frames, truth: truth,
             g: G, v0: v0, paper: { w: PW, h: PH } };
  }

  /**
   * 2台のカメラで撮った円錐振り子（stereo.js の確かめ用）。
   * 世界座標は stereo.js と同じ（L字の基準：折り目の左端が原点、y 上、z 手前）。
   * @param o {ref:{w,d,h}, tilt（立てた紙が奥へ倒れている角 度）, R, Ls（糸の長さ）, c:{x,y,z}（回る中心）,
   *           dur, cam1:{...camera, fps, start}, cam2:{...}, clap（手拍子の時刻 s）, lag2（カメラ②の音の遅れ s）,
   *           noise, tapNoise, seed}
   *   cam.start … その動画の 0 秒が、実時刻の何秒か（2台は別々に録画を始める）
   */
  function stereoConical(o) {
    o = o || {};
    const g = rng(o.seed || 21);
    const ref = o.ref || { w: 0.297, d: 0.210, h: 0.210 };
    const tilt = (o.tilt || 0) * Math.PI / 180;
    const R = o.R || 0.15, Ls = o.Ls || 0.5, G = 9.8;
    const c = o.c || { x: 0.15, y: 0.20, z: 0.25 };
    const cosT = Math.sqrt(Math.max(0, 1 - (R / Ls) * (R / Ls)));
    const w = Math.sqrt(G / (Ls * cosT));
    const dur = o.dur || 3.2;
    const noise = o.noise === undefined ? 1 : o.noise;
    const tapNoise = o.tapNoise === undefined ? 2 : o.tapNoise;
    const pos = tau => ({ x: c.x + R * Math.cos(w * tau), y: c.y, z: c.z + R * Math.sin(w * tau) });
    /* 実際の6点（立てた紙が tilt だけ奥へ倒れている） */
    const real6 = [
      { x: 0, y: ref.h * Math.cos(tilt), z: -ref.h * Math.sin(tilt) },
      { x: ref.w, y: ref.h * Math.cos(tilt), z: -ref.h * Math.sin(tilt) },
      { x: ref.w, y: 0, z: 0 }, { x: ref.w, y: 0, z: ref.d }, { x: 0, y: 0, z: ref.d }, { x: 0, y: 0, z: 0 }
    ];
    const tgt = { x: (c.x + ref.w / 2) / 2, y: c.y * 0.6, z: (c.z + ref.d / 2) / 2 };
    const rate = 8000, clap = o.clap === undefined ? 0.35 : o.clap;
    function one(co, lag) {
      const cam = camera(Object.assign({ target: tgt }, co));
      const fps = co.fps || 30, start = co.start || 0;
      const taps = real6.map(p => { const q = cam.project(p); return { x: q.x + tapNoise * g.gauss(), y: q.y + tapNoise * g.gauss() }; });
      const frames = [];
      const n = Math.round(dur * fps);
      for (let i = 0; i <= n; i++) {
        const t = i / fps + (co.vfr === false ? 0 : (g.u() - 0.5) * 0.004);
        const p = cam.project(pos(t + start));
        const x = p.x + noise * g.gauss(), y = p.y + noise * g.gauss();
        frames.push({ index: i, t: t, x: x, y: y, rawX: x, rawY: y, found: true, manual: false });
      }
      /* 音：小さな雑音と、手拍子（立ち上がりの鋭い、減衰する雑音） */
      const N = Math.round((dur + 0.2) * rate), audio = new Float32Array(N);
      for (let i = 0; i < N; i++) audio[i] = 0.01 * g.gauss() + 0.02 * Math.sin(2 * Math.PI * 120 * i / rate);
      const at = clap - start + (lag || 0);          // この動画の時刻で、手拍子の音が入る時刻
      const i0 = Math.round(at * rate);
      for (let i = 0; i < Math.round(0.08 * rate); i++) {
        if (i0 + i >= 0 && i0 + i < N) audio[i0 + i] += 0.8 * Math.exp(-i / (0.012 * rate)) * g.gauss();
      }
      return { W: cam.W, H: cam.H, camera: cam, taps: taps, frames: frames, audio: audio, rate: rate, start: start,
               clapVideoT: clap - start };
    }
    const c1 = one(o.cam1 || { dist: 1.1, elev: 30, azim: -35 }, 0);
    const c2 = one(o.cam2 || { dist: 1.2, elev: 25, azim: 40 }, o.lag2 === undefined ? 0.025 : o.lag2);
    /* カメラ①の時刻 = カメラ②の時刻 + off（stereo.js の約束） */
    const off = c2.start - c1.start;
    return { cam1: c1, cam2: c2, ref: ref, off: off, truth: pos, axis: { x: c.x, z: c.z }, R: R, T: 2 * Math.PI / w, c: c };
  }

  HG.testdata = { rng, camera, circle, projectile, stereoConical };
})(typeof window !== 'undefined' ? (window.HG = window.HG || {}) : (globalThis.HG = globalThis.HG || {}));
