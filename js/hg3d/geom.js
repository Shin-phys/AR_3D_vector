/* =====================================================================
   hg3d/geom.js — 射影変換（ホモグラフィ）とカメラの姿勢

   ★ 画面にも state にも触らない、計算だけのファイル。★
   テスト（tools/test/）が node から直接読むので、DOM を使わないこと。

   用語
     画像座標 (u, v)   … 元解像度ピクセル。u は右、v は下（2D と同じ規約）
     紙の座標 (X, Y)   … m。角 A を原点に、A→B が X、A→D が Y
     H                 … 紙の座標 → 画像座標 の射影変換（3×3、h33 = 1）
   ===================================================================== */
(function (HG) {
  'use strict';

  /* ---------- 3×3 の小道具 ---------- */
  function mul3(A, B) {
    const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      C[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
    }
    return C;
  }
  function inv3(M) {
    const [a, b, c] = M[0], [d, e, f] = M[1], [g, h, i] = M[2];
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C;
    if (!det) return null;
    return [
      [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
      [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
      [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]
    ];
  }
  function apply(H, x, y) {
    const w = H[2][0] * x + H[2][1] * y + H[2][2];
    return { x: (H[0][0] * x + H[0][1] * y + H[0][2]) / w,
             y: (H[1][0] * x + H[1][1] * y + H[1][2]) / w };
  }

  /** 8元連立一次方程式（部分ピボット付きの消去法） */
  function solve(A, b) {
    const n = b.length;
    const M = A.map((r, i) => r.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const k = M[r][c] / M[c][c];
        for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
      }
    }
    return M.map((r, i) => r[n] / r[i]);
  }

  /**
   * 4組の対応から射影変換を求める（src → dst）。
   * 点の数がちょうど4なので最小二乗は要らない。
   * 数値を安定させるため、両側を重心中心・平均距離 √2 に正規化してから解く。
   */
  function homography(src, dst) {
    const norm = pts => {
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      const d = pts.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / pts.length || 1;
      const k = Math.SQRT2 / d;
      return { T: [[k, 0, -k * cx], [0, k, -k * cy], [0, 0, 1]],
               p: pts.map(q => ({ x: (q.x - cx) * k, y: (q.y - cy) * k })) };
    };
    const ns = norm(src), nd = norm(dst);
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const { x, y } = ns.p[i], { x: u, y: v } = nd.p[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    const h = solve(A, b);
    if (!h) return null;
    const Hn = [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
    const Tdi = inv3(nd.T);
    if (!Tdi) return null;
    let H = mul3(Tdi, mul3(Hn, ns.T));
    const s = H[2][2];
    H = H.map(r => r.map(v => v / s));
    return H;
  }

  /* ---------- 四角形の検査 ---------- */

  /** 一周する順に並んでいるか（凸で、自己交差していないか） */
  function isConvexQuad(q) {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
      const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(z) < 1e-9) return false;
      const s = Math.sign(z);
      if (!sign) sign = s; else if (s !== sign) return false;
    }
    return true;
  }

  /**
   * 画像の上で A→B→C→D が時計回りに見えるか。
   * 画像座標は v が下向きなので、(B−A)×(D−A) > 0 が「時計回りに見える」。
   * 紙を上から撮っているとき、これが 3D での向き（z の符号）を決める。
   */
  function clockwise(q) {
    const a = q[0], b = q[1], d = q[3];
    return (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x) > 0;
  }

  /* ---------- カメラの姿勢 ----------
     H = λ K [r1 r2 t]、K = [[f,0,cx],[0,f,cy],[0,0,1]]（画素は正方形、主点は画像中心）。

     ★ 焦点距離 f は四隅から推定しない。★
     理屈の上では r1 ⟂ r2 と |r1| = |r2| から f が出るが、四隅のタップが
     σ = 2 px ずれるだけで、推定した f が真値の 0.57〜3.4 倍に散った
     （合成データ 40 通り、1.5 m・仰角 40°。tools/test/unit.js の条件）。
     そこで撮影ガイドの「標準カメラ（1×）で撮る」を前提に、標準カメラの画角で置く。
     同じ条件で、撮影位置の向きの誤差は中央値 8°・距離の誤差は 1 割以内だった。
     長い辺と短い辺の取り違えを f から見抜く案も、同じ理由で落とした
     （押す順を言葉と図で指定し、押したあと辺に寸法を書いて見せる）。

     この姿勢は「撮影した位置から見る」視点にだけ使う。
     **3D 座標そのものは H だけで決まり、f にも姿勢にも依存しない。** */
  function fallbackF(W, Hh) {
    /* iPhone の標準（広角）カメラは横の画角がおよそ 69°（35mm 換算 26mm）。
       f = (長辺/2) / tan(34.5°) ≒ 0.73 × 長辺 */
    return 0.73 * Math.max(W, Hh);
  }

  function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

  /**
   * @returns {f, R:[r1,r2,r3]（紙の軸をカメラ座標で表したもの）, t, C}
   *   C … カメラの位置（紙の座標。第3成分は紙の法線 X×Y 方向の高さ）
   */
  function pose(H, W, Hh, fGiven) {
    const f = fGiven || fallbackF(W, Hh);
    const cx = W / 2, cy = Hh / 2;
    const Ki = v => [(v[0] - cx * v[2]) / f, (v[1] - cy * v[2]) / f, v[2]];
    const c = j => [H[0][j], H[1][j], H[2][j]];
    let k1 = Ki(c(0)), k2 = Ki(c(1)), k3 = Ki(c(2));
    let lam = 2 / (Math.hypot(...k1) + Math.hypot(...k2));
    /* 紙はカメラの前（z > 0）にある */
    if (k3[2] * lam < 0) lam = -lam;
    let r1 = k1.map(v => v * lam), r2 = k2.map(v => v * lam);
    const t = k3.map(v => v * lam);
    /* 直交化（r1 と r2 の真ん中を取って直交させる） */
    r1 = norm3(r1); r2 = norm3(r2);
    const m = norm3([r1[0] + r2[0], r1[1] + r2[1], r1[2] + r2[2]]);
    const n = norm3(cross(r1, r2));
    const p = norm3(cross(m, n));      // m から r1 の側へ90°（cross(n, m) だと r2 の側）
    r1 = norm3([(m[0] + p[0]), (m[1] + p[1]), (m[2] + p[2])]);
    r2 = norm3([(m[0] - p[0]), (m[1] - p[1]), (m[2] - p[2])]);
    const r3 = cross(r1, r2);
    /* C = −Rᵀ t（R の列が r1, r2, r3） */
    const C = [-dot(r1, t), -dot(r2, t), -dot(r3, t)];
    return { f: f, R: [r1, r2, r3], t: t, C: C,
             fovY: 2 * Math.atan(Hh / 2 / f) * 180 / Math.PI };
  }

  HG.geom = { homography, apply, inv3, mul3, isConvexQuad, clockwise, pose,
              fallbackF, cross, dot, norm3 };
})(typeof window !== 'undefined' ? (window.HG = window.HG || {}) : (globalThis.HG = globalThis.HG || {}));
