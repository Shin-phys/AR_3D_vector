/* =====================================================================
   hg3d/stereo.js — 2台のカメラで撮る（3D仕様.md §4-C）の計算

   ★ 画面にも state にも触らない、計算だけのファイル。★
   tools/test/unit.js が node から直接読む。DOM を使わないこと。
   画面との受け渡しは stereo-ui.js が持つ。

   ★ 端末どうしはつながない。★
   2台のスマホで別々に撮った2本の動画を、あとから1本ずつ読み込む。
   授業で「2台を同時に操作する」「通信がつながらない」を起こさないため。

   流れ
     1. 基準：机に置いた紙と、その奥の辺に立てた紙（L字）。角は6つ。
        6点の 3D の位置は分かっているので、各カメラの位置・向き・焦点距離が決まる
        （紙1枚＝同じ平面の4点だけでは焦点距離が決まらない。geom.js の「カメラの姿勢」）。
     2. 同期：手拍子の音で大まかに合わせ、2本の線のすれ違いが最も小さくなるよう細かく合わせる。
     3. 交点：カメラ①の点とカメラ②の点を通る2本の線の、いちばん近づくところ。
        2台のコマの時刻はそろわないので、カメラ①の点はカメラ②の時刻に合わせて補間する。

   ★ 世界座標（L字の基準で決まる）★
     y＝上（机の法線）、x＝折り目に沿って右（正面から見て）、z＝手前（立てた紙から離れる向き）。
     原点は折り目の左端。机の紙は y = 0、立てた紙は z = 0 の面にある。
     立てた紙が机に垂直でないと、そのぶん世界が斜めにゆがむ（2台で同じだけゆがむので
     食い違いは出ない。ゆがむのは「上」の向き。紙を 5° 傾けて立てると「上」が 5° 傾く）。

   ★ 押す順（6点）★ 正面の斜め上から見て、立てた紙の左上から時計回り。
       1 立てた紙の左上  2 立てた紙の右上  3 折り目の右  4 手前の右  5 手前の左  6 折り目の左
   ===================================================================== */
(function (HG) {
  'use strict';

  /* L字の基準。w＝折り目の長さ、d＝机の紙の奥行き、h＝立てた紙の高さ（m） */
  const REFS = {
    A4: { w: 0.297, d: 0.210, h: 0.210, name: 'A4 横 2枚' },
    A3: { w: 0.420, d: 0.297, h: 0.297, name: 'A3 横 2枚' }
  };
  const ORDER = ['立てた紙の左上', '立てた紙の右上', '折り目の右', '手前の右', '手前の左', '折り目の左'];

  function refPoints(r) {
    return [
      { x: 0,   y: r.h, z: 0 },
      { x: r.w, y: r.h, z: 0 },
      { x: r.w, y: 0,   z: 0 },
      { x: r.w, y: 0,   z: r.d },
      { x: 0,   y: 0,   z: r.d },
      { x: 0,   y: 0,   z: 0 }
    ];
  }
  /** 描く用：机の紙と立てた紙の四隅 */
  function refQuads(r) {
    return {
      desk: [{ x: 0, y: 0, z: 0 }, { x: r.w, y: 0, z: 0 }, { x: r.w, y: 0, z: r.d }, { x: 0, y: 0, z: r.d }],
      wall: [{ x: 0, y: 0, z: 0 }, { x: r.w, y: 0, z: 0 }, { x: r.w, y: r.h, z: 0 }, { x: 0, y: r.h, z: 0 }]
    };
  }

  /* ---------- 小道具 ---------- */
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = a => Math.hypot(a[0], a[1], a[2]);
  const unit = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const P3 = p => [p.x, p.y, p.z];

  /** 回転ベクトル → 回転行列（ロドリゲス） */
  function rodrigues(w) {
    const th = len(w);
    if (th < 1e-12) return [[1, -w[2], w[1]], [w[2], 1, -w[0]], [-w[1], w[0], 1]];
    const k = w.map(v => v / th), c = Math.cos(th), s = Math.sin(th), C = 1 - c;
    return [
      [c + k[0] * k[0] * C, k[0] * k[1] * C - k[2] * s, k[0] * k[2] * C + k[1] * s],
      [k[1] * k[0] * C + k[2] * s, c + k[1] * k[1] * C, k[1] * k[2] * C - k[0] * s],
      [k[2] * k[0] * C - k[1] * s, k[2] * k[1] * C + k[0] * s, c + k[2] * k[2] * C]
    ];
  }
  function matMul(A, B) {
    return A.map((r, i) => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
  }
  const mv = (M, v) => [dot(M[0], v), dot(M[1], v), dot(M[2], v)];
  const T = M => [[M[0][0], M[1][0], M[2][0]], [M[0][1], M[1][1], M[2][1]], [M[0][2], M[1][2], M[2][2]]];

  /** n 元連立一次方程式（部分ピボット付き） */
  function solveN(A, b) {
    const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-15) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const k = M[r][c] / M[c][c];
        for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
      }
    }
    return M.map((r, i) => r[n] / r[i]);
  }

  /* ---------- カメラ ----------
     cam = { f, cx, cy, R（世界 → カメラ）, t, W, H }
     カメラ座標：x 右、y 下、z 前（画像座標と同じ向き）。 */
  function project(cam, p) {
    const c = mv(cam.R, P3(p));
    const x = c[0] + cam.t[0], y = c[1] + cam.t[1], z = c[2] + cam.t[2];
    return { x: cam.f * x / z + cam.cx, y: cam.f * y / z + cam.cy, depth: z };
  }
  function center(cam) { const Rt = T(cam.R); const c = mv(Rt, cam.t); return [-c[0], -c[1], -c[2]]; }

  /** 画像の点 (u, v) を通る線（世界座標）。o はカメラの位置、d は単位ベクトル */
  function ray(cam, u, v) {
    const dc = [(u - cam.cx) / cam.f, (v - cam.cy) / cam.f, 1];
    return { o: center(cam), d: unit(mv(T(cam.R), dc)) };
  }

  /* 平面の4点の射影変換から、最初の見当（標準カメラの画角で置く）。
     e1, e2 は平面の座標の軸（世界）、O は原点（世界） */
  function initFromPlane(img4, plane4, e1, e2, O, W, H) {
    const Hm = HG.geom.homography(plane4, img4);
    if (!Hm) return null;
    const ps = HG.geom.pose(Hm, W, H);
    const r1 = ps.R[0], r2 = ps.R[1], r3 = ps.R[2];
    /* 世界の軸 X, Y, Z をカメラ座標で書いたもの＝ R の列。平面の軸から組み立てる */
    const e3 = cross(e1, e2);
    /* カメラ座標での世界の軸：A = [r1 r2 r3]·[e1 e2 e3]ᵀ */
    const Pc = [r1, r2, r3];               // 平面の軸（e1, e2, e3）のカメラ座標
    const E = [e1, e2, e3];
    const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      R[i][j] = Pc[0][i] * E[0][j] + Pc[1][i] * E[1][j] + Pc[2][i] * E[2][j];
    }
    /* t：世界の原点のカメラ座標。平面の原点 O の位置 ps.t から引き戻す */
    const RO = mv(R, O);
    return { f: ps.f, cx: W / 2, cy: H / 2, R: R, t: [ps.t[0] - RO[0], ps.t[1] - RO[1], ps.t[2] - RO[2]], W: W, H: H };
  }

  function residuals(cam, X, x) {
    const r = [];
    for (let i = 0; i < X.length; i++) {
      const p = project(cam, X[i]);
      r.push(p.x - x[i].x, p.y - x[i].y);
      if (p.depth <= 0) { r[r.length - 1] += 1e4; }
    }
    return r;
  }
  const rms = r => Math.sqrt(r.reduce((s, v) => s + v * v, 0) / (r.length / 2));

  /**
   * 再投影の誤差が最小になるよう、焦点距離・向き・位置を合わせる（レーベンバーグ・マーカート）。
   * 主点は画像の中心、画素は正方形に固定する（スマホの動画ではほぼ成り立つ。
   * 自由にすると 6 点では決まらない）。
   */
  function refine(cam0, X, x, opt) {
    const fixF = opt && opt.fixF;
    let cam = Object.assign({}, cam0, { R: cam0.R.map(r => r.slice()), t: cam0.t.slice() });
    const apply = (c, d) => {
      const n = Object.assign({}, c);
      n.R = matMul(rodrigues([d[0], d[1], d[2]]), c.R);
      n.t = [c.t[0] + d[3], c.t[1] + d[4], c.t[2] + d[5]];
      n.f = fixF ? c.f : c.f * Math.exp(d[6]);
      return n;
    };
    const np = fixF ? 6 : 7;
    let r = residuals(cam, X, x), e = r.reduce((s, v) => s + v * v, 0), lam = 1e-3;
    for (let it = 0; it < 100; it++) {
      /* 数値微分のヤコビアン */
      const J = [];
      for (let k = 0; k < np; k++) {
        const d = [0, 0, 0, 0, 0, 0, 0];
        const h = k < 3 ? 1e-6 : k < 6 ? 1e-6 * Math.max(0.1, len(cam.t)) : 1e-6;
        d[k] = h;
        const rp = residuals(apply(cam, d), X, x);
        J.push(rp.map((v, i) => (v - r[i]) / h));
      }
      const A = [], g = [];
      for (let i = 0; i < np; i++) {
        A.push([]);
        for (let j = 0; j < np; j++) { let s = 0; for (let m = 0; m < r.length; m++) s += J[i][m] * J[j][m]; A[i].push(s); }
        let s = 0; for (let m = 0; m < r.length; m++) s += J[i][m] * r[m]; g.push(-s);
      }
      let improved = false;
      for (let tries = 0; tries < 10; tries++) {
        const Ad = A.map((row, i) => row.map((v, j) => i === j ? v * (1 + lam) + 1e-12 : v));
        const dx = solveN(Ad, g);
        if (!dx) { lam *= 10; continue; }
        const d = [0, 0, 0, 0, 0, 0, 0]; dx.forEach((v, i) => { d[i] = v; });
        const c2 = apply(cam, d), r2 = residuals(c2, X, x), e2 = r2.reduce((s, v) => s + v * v, 0);
        if (e2 < e) {
          cam = c2; r = r2; lam = Math.max(1e-9, lam / 5);
          improved = e - e2 > 1e-12 * e;
          e = e2;
          break;
        }
        lam *= 10;
      }
      if (!improved) break;
    }
    cam.err = rms(r);
    cam.res = r;
    return cam;
  }

  /**
   * L字の6点から、カメラを決める。
   * @param img6  押した6点（画像座標。押した順）
   * @param ref   {w, d, h}
   * @param opt   {fixF: 焦点距離を標準カメラの画角に固定する}
   * @returns     cam（err＝再投影の誤差 px の二乗平均）または null
   */
  function calibrate(img6, ref, W, H, opt) {
    if (!img6 || img6.length !== 6) return null;
    const X = refPoints(ref);
    /* 見当は2通り（机の紙／立てた紙の射影変換）。合わせたあと誤差の小さいほう */
    const inits = [];
    const desk = initFromPlane([img6[5], img6[2], img6[3], img6[4]],
      [{ x: 0, y: 0 }, { x: ref.w, y: 0 }, { x: ref.w, y: ref.d }, { x: 0, y: ref.d }],
      [1, 0, 0], [0, 0, 1], [0, 0, 0], W, H);
    if (desk) inits.push(desk);
    const wall = initFromPlane([img6[5], img6[2], img6[1], img6[0]],
      [{ x: 0, y: 0 }, { x: ref.w, y: 0 }, { x: ref.w, y: ref.h }, { x: 0, y: ref.h }],
      [1, 0, 0], [0, 1, 0], [0, 0, 0], W, H);
    if (wall) inits.push(wall);
    let best = null;
    inits.forEach(c0 => {
      /* まず焦点距離を固定して向きと位置を合わせ、それから焦点距離も動かす（いきなり全部動かすと迷う） */
      let c = refine(c0, X, img6, { fixF: true });
      if (!(opt && opt.fixF)) c = refine(c, X, img6, {});
      if (!best || c.err < best.err) best = c;
    });
    if (!best) return null;
    /* カメラは机より上、立てた紙より手前にあるはず（押す順を逆にすると、鏡に映した位置に合ってしまう） */
    const C = center(best);
    best.C = { x: C[0], y: C[1], z: C[2] };
    best.fovY = 2 * Math.atan(H / 2 / best.f) * 180 / Math.PI;
    best.fovX = 2 * Math.atan(W / 2 / best.f) * 180 / Math.PI;
    best.ok = best.err < Math.max(4, 0.006 * Math.max(W, H)) && C[1] > 0 && C[2] > 0;
    return best;
  }

  /** 世界の点 → カメラの向き（描く・撮影位置から見る用） */
  function cameraWorld(cam) {
    const Rt = T(cam.R);
    const col = v => { const w = mv(Rt, v); return { x: w[0], y: w[1], z: w[2] }; };
    const down = col([0, 1, 0]);
    return { pos: cam.C, forward: col([0, 0, 1]), right: col([1, 0, 0]), up: { x: -down.x, y: -down.y, z: -down.z }, fovY: cam.fovY };
  }

  /**
   * 2本の線のいちばん近づくところ（中点）と、そのすれ違いの距離（gap）。
   * 2本が平行に近いと決まらない（cos が 1 に近い）ので null。
   */
  function closest(r1, r2) {
    const w0 = sub(r1.o, r2.o), b = dot(r1.d, r2.d), d = dot(r1.d, w0), e = dot(r2.d, w0);
    const den = 1 - b * b;
    if (den < 1e-6) return null;
    const s = (b * e - d) / den, t = (e - b * d) / den;
    const p1 = [r1.o[0] + s * r1.d[0], r1.o[1] + s * r1.d[1], r1.o[2] + s * r1.d[2]];
    const p2 = [r2.o[0] + t * r2.d[0], r2.o[1] + t * r2.d[1], r2.o[2] + t * r2.d[2]];
    return { x: (p1[0] + p2[0]) / 2, y: (p1[1] + p2[1]) / 2, z: (p1[2] + p2[2]) / 2,
             gap: len(sub(p1, p2)), s: s, t: t };
  }
  function triangulate(cam1, a, cam2, b) {
    return closest(ray(cam1, a.x, a.y), ray(cam2, b.x, b.y));
  }

  /** 2台の線のなす角（度）。小さいと奥行きが決まりにくい */
  function baseAngle(cam1, cam2, p) {
    const a = unit(sub(P3(cam1.C), P3(p))), b = unit(sub(P3(cam2.C), P3(p)));
    return Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180 / Math.PI;
  }

  /**
   * 追跡した点の列（時刻順）を、時刻 t で補間する（画像座標）。
   * 両側の点が maxGap 秒より離れていたら（見失ったコマをまたぐなら）null。
   */
  function interp(track, t, maxGap) {
    const n = track.length;
    if (!n || t < track[0].t - 1e-9 || t > track[n - 1].t + 1e-9) return null;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (track[m].t <= t) lo = m; else hi = m; }
    const a = track[lo], b = track[hi];
    if (b.t - a.t > (maxGap || 0.1)) return null;
    const u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
  }

  /** 中央値 */
  function median(a) { if (!a.length) return Infinity; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; }

  /**
   * 時刻のずれ off（カメラ①の時刻 = カメラ②の時刻 + off）で、2本の線のすれ違い（中央値、m）。
   * track2 の点ごとに、track1 を補間して交点を求める。
   */
  function gapAt(cam1, track1, cam2, track2, off, maxGap) {
    const g = [];
    track2.forEach(q => {
      const p = interp(track1, q.t + off, maxGap);
      if (!p) return;
      const c = triangulate(cam1, p, cam2, q);
      if (c) g.push(c.gap);
    });
    return { gap: median(g), n: g.length };
  }

  /**
   * 線のすれ違いが最も小さくなる時刻のずれを探す。
   * from を中心に ±range 秒を粗く → 細かく。点が半分も重ならないずれは候補にしない。
   */
  function syncByGeometry(cam1, track1, cam2, track2, from, range, maxGap) {
    /* カメラ①の区間がカメラ②より短いときは、重なり得るぶんの半分 */
    const d1 = track1[track1.length - 1].t - track1[0].t, d2 = track2[track2.length - 1].t - track2[0].t;
    const need = Math.max(5, Math.floor(track2.length * 0.5 * Math.min(1, d2 > 0 ? d1 / d2 : 1)));
    let best = { off: from, gap: Infinity, n: 0 };
    const scan = (c, r, step) => {
      for (let o = c - r; o <= c + r + 1e-12; o += step) {
        const g = gapAt(cam1, track1, cam2, track2, o, maxGap);
        if (g.n >= need && g.gap < best.gap) best = { off: o, gap: g.gap, n: g.n };
      }
    };
    /* 線のすれ違いは、ずれに比例して大きくなる（V 字の谷）。粗い刻みでも谷の近くに必ず点が落ちる */
    scan(from, range, Math.min(0.015, Math.max(0.004, range / 150)));
    scan(best.off, 0.02, 0.002);
    scan(best.off, 0.003, 0.0002);
    return best;
  }

  /* ---------- 音（手拍子） ----------
     動画の音声から、いちばん大きな「立ち上がり」の時刻を探す。
     ★ 2台のスマホは録音と録画のずれ（音と映像のずれ）が機種ごとに違う。★
     手拍子だけでは数十 ms ずれることがあるので、そのあと線のすれ違いで細かく合わせる。 */
  function clapTime(samples, rate) {
    const win = Math.max(16, Math.round(rate * 0.002));     // 2 ms ごとの強さ
    const n = Math.floor(samples.length / win);
    if (n < 10) return null;
    const env = new Float32Array(n);
    let prev = 0;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = i * win; j < (i + 1) * win; j++) {
        const d = samples[j] - prev; prev = samples[j];     // 差分（低い音を弱め、ぱんという音を残す）
        s += d * d;
      }
      env[i] = s / win;
    }
    let pk = 0;
    for (let i = 1; i < n; i++) if (env[i] > env[pk]) pk = i;
    const bg = median(Array.from(env));
    if (!(env[pk] > bg * 30)) return { t: null, peak: env[pk], bg: bg, ratio: env[pk] / (bg || 1e-12) };
    /* 立ち上がり：ピークの手前 60 ms 以内で、ピークの 20% を超えた最初の窓 */
    let on = pk;
    const back = Math.round(0.06 / (win / rate));
    for (let i = pk; i >= Math.max(0, pk - back); i--) if (env[i] >= env[pk] * 0.2) on = i;
    return { t: on * win / rate, peak: env[pk], bg: bg, ratio: env[pk] / (bg || 1e-12) };
  }

  /**
   * 2台をいっしょに合わせ直す（基準の6点＋追跡した点）。
   * ★ 基準の6点だけだと、焦点距離が決まりにくい（A4 を 1 m 先から撮ると、四隅の 2 px のずれで
   *    焦点距離が 1 割前後ぶれた。tools/test/unit.js）。★
   * 追跡した点は1本の動画に何十もあり、「2台の線が交わる」という条件が2台の向きと焦点距離を強く縛る。
   * 残差は、交点を各カメラに写し戻したときのずれ（px）。基準の6点のずれも同じ重みで入れる。
   * 時刻のずれ off も一緒に合わせる（withOff）。
   */
  function refinePair(cam1, cam2, ref, taps1, taps2, track1, track2, off, opt) {
    opt = opt || {};
    const X = refPoints(ref), maxGap = opt.maxGap || 0.1;
    const step = Math.max(1, Math.floor(track2.length / (opt.maxPts || 120)));
    const tr2 = track2.filter((q, i) => i % step === 0);
    const withOff = !!opt.withOff;
    const apply = (c, d) => {
      const n = Object.assign({}, c);
      n.R = matMul(rodrigues([d[0], d[1], d[2]]), c.R);
      n.t = [c.t[0] + d[3], c.t[1] + d[4], c.t[2] + d[5]];
      n.f = c.f * Math.exp(d[6]);
      return n;
    };
    /* 交点の写し戻しのずれ。補間できない点は、どの候補でも同じ数になるよう 0 にする（点の出入りで残差が跳ねない） */
    const res = (a, b, o) => {
      const r = residuals(a, X, taps1).concat(residuals(b, X, taps2));
      tr2.forEach(q => {
        const p = interp(track1, q.t + o, maxGap);
        if (!p) { r.push(0, 0, 0, 0); return; }
        const c = triangulate(a, p, b, q);
        if (!c) { r.push(0, 0, 0, 0); return; }
        const u = project(a, c), v = project(b, c);
        r.push(u.x - p.x, u.y - p.y, v.x - q.x, v.y - q.y);
      });
      return r;
    };
    const np = withOff ? 15 : 14;
    const split = d => [apply(cam1, d.slice(0, 7)), apply(cam2, d.slice(7, 14)), off + (withOff ? d[14] : 0)];
    let r = res(cam1, cam2, off), e = r.reduce((s, v) => s + v * v, 0), lam = 1e-3;
    for (let it = 0; it < 60; it++) {
      const J = [];
      for (let k = 0; k < np; k++) {
        const d = new Array(15).fill(0);
        const kk = k % 7;
        const h = k === 14 ? 1e-4 : kk < 3 ? 1e-6 : kk < 6 ? 1e-6 * Math.max(0.1, len((k < 7 ? cam1 : cam2).t)) : 1e-6;
        d[k] = h;
        const s = split(d), rp = res(s[0], s[1], s[2]);
        J.push(rp.map((v, i) => (v - r[i]) / h));
      }
      const A = [], g = [];
      for (let i = 0; i < np; i++) {
        A.push([]);
        for (let j = 0; j < np; j++) { let s = 0; for (let m = 0; m < r.length; m++) s += J[i][m] * J[j][m]; A[i].push(s); }
        let s = 0; for (let m = 0; m < r.length; m++) s += J[i][m] * r[m]; g.push(-s);
      }
      let improved = false;
      for (let tries = 0; tries < 10; tries++) {
        const Ad = A.map((row, i) => row.map((v, j) => i === j ? v * (1 + lam) + 1e-12 : v));
        const dx = solveN(Ad, g);
        if (!dx) { lam *= 10; continue; }
        const d = new Array(15).fill(0); dx.forEach((v, i) => { d[i] = v; });
        const s = split(d), r2 = res(s[0], s[1], s[2]), e2 = r2.reduce((q, v) => q + v * v, 0);
        if (e2 < e) {
          cam1 = s[0]; cam2 = s[1]; off = s[2]; r = r2; lam = Math.max(1e-9, lam / 5);
          improved = e - e2 > 1e-9 * e;
          e = e2;
          break;
        }
        lam *= 10;
      }
      if (!improved) break;
    }
    const fin = c => {
      const C = center(c);
      c.C = { x: C[0], y: C[1], z: C[2] };
      c.fovY = 2 * Math.atan(c.H / 2 / c.f) * 180 / Math.PI;
      c.fovX = 2 * Math.atan(c.W / 2 / c.f) * 180 / Math.PI;
      return c;
    };
    cam1 = fin(cam1); cam2 = fin(cam2);
    cam1.err = rms(residuals(cam1, X, taps1)); cam2.err = rms(residuals(cam2, X, taps2));
    return { cam1: cam1, cam2: cam2, off: off, rms: rms(r) };
  }

  /* ---------- 3D の列を作る ----------
     @param sel   カメラ②の使うコマ（時間順）[{index, t, x, y}]（補正後の画像座標）
     @param all   カメラ②の区間内の全コマ
     @param cam1, track1  カメラ①（track1 は [{t, x, y}] 時刻順）
     @param cam2  カメラ②
     @param off   カメラ①の時刻 = カメラ②の時刻 + off
     kin は reconstruct.js と同じ半コマずれの約束で作る（HG.recon.kinematics）。 */
  function computeFrom(sel, all, cam1, track1, cam2, off, maxGap) {
    const P = f => {
      const p = interp(track1, f.t + off, maxGap);
      if (!p) return null;
      const c = triangulate(cam1, p, cam2, f);
      return c ? { index: f.index, t: f.t, x: c.x, y: c.y, z: c.z, gap: c.gap } : null;
    };
    const track = sel.map(P).filter(Boolean);
    const trackAll = all.map(P).filter(Boolean);
    return { track: track, trackAll: trackAll, kin: HG.recon.kinematics(track),
             gap: median(trackAll.map(p => p.gap)) };
  }

  HG.stereoMath = { REFS, ORDER, refPoints, refQuads, project, ray, center, calibrate, refine, cameraWorld,
                    closest, triangulate, baseAngle, interp, gapAt, syncByGeometry, refinePair, clapTime, computeFrom, median };
})(typeof window !== 'undefined' ? (window.HG = window.HG || {}) : (globalThis.HG = globalThis.HG || {}));
