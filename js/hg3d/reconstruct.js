/* =====================================================================
   hg3d/reconstruct.js — 3D 復元（4-A 平面拘束モード）

   紙の四隅から射影変換を求め、追跡した各コマの画像座標を紙の平面上の
   座標（m）に直して 3D に置く。

   ★ 座標系（3D仕様.md §3）★
     右手系。y＝鉛直上向き、x＝画面の右、z＝カメラ側（手前）。単位は m。
     原点は角 A。紙の面は y = 0（水平に置いた紙を想定）。

     x を紙の辺（A→B）ではなく「画面の右」に合わせているのは、どの角から
     押し始めても 3D の向きが動画と揃うようにするため。紙の上で画面の右に
     当たる向きは、射影変換だけで決まる（焦点距離にも姿勢にも依らない）。
     鉛直軸まわりに回すだけなので、水平・鉛直は変わらず、物理は何も変わらない。

     裏返し（鏡像）にしないため、紙の座標 (X, Y) → 3D の段階で
     「四隅を画像の上で時計回りに押したか」で Y の符号を決める（geom.clockwise）。
     上から撮っているかぎり、これで鏡像にならない。

   ★ 半コマずれ（2D の README「変えてはいけない約束」6 と同じ）★
     位置    r₀      r₁      r₂      r₃
     速度       v₀.₅    v₁.₅    v₂.₅
     Δv             a₁      a₂
     速度 v[k] は r_k → r_{k+1}、Δv a[k] は位置 r_{k+1} に属する。
     2D と同じ対応にしておかないと、同じ動画で 2D と 3D の矢印が1コマずれる。

   ★ モデルを当てはめない（3D仕様.md §4）★
     円も放物線も当てはめない。平滑化もしない（既定は生データ）。
     ここで出るのは、生徒が 2D で作図したのと同じ「隣り合う差」だけ。

   出力（ビューアと AR はこれだけを読む）
     HG.track3d    … 使うコマの位置 [{index, t, x, y, z}]
     HG.track3dAll … 区間内の座標のある全コマ（壁の影のグラフ用）
     HG.kin3d      … { v:[{k, t, from, to, vx,vy,vz, d}], a:[{k, t, at, ax,ay,az, d2}] }
       仕様書では1本の配列 {t, vx..az} だったが、速度と加速度は属する時刻が
       半コマずれるので、同じ行に並べると必ずどちらかが嘘になる。2本に分けた。
   ===================================================================== */
(function (HG) {
  'use strict';

  const PAPERS = {
    A4: { w: 0.297, h: 0.210, name: 'A4' },
    B5: { w: 0.257, h: 0.182, name: 'B5' },
    A3: { w: 0.420, h: 0.297, name: 'A3' }
  };

  const S = {
    paper: Object.assign({}, PAPERS.A4),
    corners: [],          // 画像座標（rawX/rawY と同じ「画像上の実位置」）。A, B, C, D の順
    cornerFrame: null,    // 四隅を押したコマ
    H: null,              // 紙の座標 → 画像座標（補正後の座標系）
    Hinv: null,
    s: 1,                 // 時計回りなら +1（z = +Y）
    ex: null,             // 画面の右に当たる水平の向き（回す前の 3D で）
    pose: null
  };

  /* ---------- 四隅 ---------- */

  /** カメラぶれ補正を、四隅にも点と同じだけ掛ける（points.applyCorrection と同じ式） */
  function correctedCorners() {
    if (S.corners.length !== 4) return null;
    let dx = 0, dy = 0;
    const st = HG.state;
    if (st && st.tracking && st.tracking.useMarker && st.refMarker && S.cornerFrame !== null) {
      const base = st.refMarker.find(m => m && m.found);
      const m = st.refMarker[S.cornerFrame];
      if (base && m && m.found) { dx = m.x - base.x; dy = m.y - base.y; }
    }
    return S.corners.map(c => ({ x: c.x - dx, y: c.y - dy }));
  }

  /** 四隅と紙の寸法から射影変換を作り直す。失敗したら理由を返す */
  function solve(W, Hh) {
    S.H = S.Hinv = S.pose = null;
    const q = correctedCorners();
    if (!q) return { ok: false, reason: 'count' };
    if (!HG.geom.isConvexQuad(q)) return { ok: false, reason: 'order' };
    const w = S.paper.w, h = S.paper.h;
    const H = HG.geom.homography(
      [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], q);
    if (!H) return { ok: false, reason: 'degenerate' };
    S.H = H;
    S.Hinv = HG.geom.inv3(H);
    S.s = HG.geom.clockwise(q) ? 1 : -1;
    /* 紙の真ん中で、画面の右へ少し進んだ点が紙の上でどちらにあるか */
    S.ex = null;
    const c0 = HG.geom.apply(H, w / 2, h / 2);
    const step = Math.max(4, Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y) * 0.1);
    const a = raw(c0.x, c0.y), b = raw(c0.x + step, c0.y);
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    S.ex = l > 0 ? { x: (b.x - a.x) / l, z: (b.z - a.z) / l } : { x: 1, z: 0 };
    if (W && Hh) S.pose = HG.geom.pose(H, W, Hh);
    return { ok: true };
  }

  function setCorners(list, frameIndex) {
    S.corners = list.map(p => ({ x: p.x, y: p.y }));
    S.cornerFrame = frameIndex;
  }
  function clearCorners() {
    S.corners = []; S.cornerFrame = null; S.H = S.Hinv = S.pose = null;
  }
  function ready() { return !!S.Hinv; }

  /** 回す前の 3D：x = X、z = s·Y、y = 法線方向の高さ（カメラ側が上） */
  function raw0(a, b, c) { return { x: a, y: -S.s * c, z: S.s * b }; }
  function raw(u, v) { const p = HG.geom.apply(S.Hinv, u, v); return raw0(p.x, p.y, 0); }
  /** 鉛直軸まわりに回して、x を画面の右に合わせる（ez = ex × 上） */
  function turn(p) {
    const e = S.ex || { x: 1, z: 0 };
    return { x: p.x * e.x + p.z * e.z, y: p.y, z: -p.x * e.z + p.z * e.x };
  }

  /** 画像座標（補正後）→ 3D（m） */
  function toWorld(u, v) { return turn(raw(u, v)); }
  /** 紙の座標 (X, Y, 法線方向の高さ) → 3D */
  function planeToWorld(a, b, c) { return turn(raw0(a, b, c)); }

  /** 紙の四隅（3D） */
  function paperWorld() {
    const w = S.paper.w, h = S.paper.h;
    return [[0, 0], [w, 0], [w, h], [0, h]].map(p => planeToWorld(p[0], p[1], 0));
  }

  /**
   * 撮影したカメラの位置と向き（3D）。「撮影位置から見る」に使う。
   * f は標準カメラの画角で置いている（geom.js の「カメラの姿勢」）。おおよその視点。
   */
  function cameraWorld() {
    if (!S.pose) return null;
    const P = S.pose, R = P.R;
    const row = i => [R[0][i], R[1][i], R[2][i]];      // カメラの軸を紙の座標で
    const toW = v => planeToWorld(v[0], v[1], v[2]);
    return {
      pos: toW(P.C),
      forward: toW(row(2)),
      up: (() => { const y = toW(row(1)); return { x: -y.x, y: -y.y, z: -y.z }; })(),
      fovY: P.fovY
    };
  }

  /* ---------- 運動量の計算（ここは純粋な計算） ---------- */

  /**
   * @param sel  使うコマ（時間順）[{index, t, x, y}]（x, y は補正後の画像座標）
   * @param all  区間内の座標のある全コマ
   */
  function computeFrom(sel, all) {
    const P = f => { const w = toWorld(f.x, f.y); return { index: f.index, t: f.t, x: w.x, y: w.y, z: w.z }; };
    const track = sel.map(P);
    const trackAll = all.map(P);
    const v = [], a = [];
    for (let k = 0; k + 1 < track.length; k++) {
      const p = track[k], q = track[k + 1], dt = q.t - p.t;
      const d = { x: q.x - p.x, y: q.y - p.y, z: q.z - p.z };     // 変位（矢印そのもの）
      v.push({ k: k, t: (p.t + q.t) / 2, from: p, to: q, d: d, dt: dt,
               vx: d.x / dt, vy: d.y / dt, vz: d.z / dt });
    }
    for (let k = 0; k + 1 < v.length; k++) {
      /* Δv は「速度の差」、a は Δv を時間で割ったもの。
         Δv が属する時刻は r_{k+1}、割る時間は v[k] と v[k+1] の時刻の差 */
      const dv = { x: v[k + 1].vx - v[k].vx, y: v[k + 1].vy - v[k].vy, z: v[k + 1].vz - v[k].vz };
      const dt = v[k + 1].t - v[k].t;
      /* 矢印として描く長さ（m）。速度の矢印（変位）と同じ尺度にするため Δt を掛ける。
         ★ 変位の差（r₂−r₁）−（r₁−r₀）をそのまま使わないこと。★
         スマホの動画は VFR で、同じコマ数おきでも Δt が揃わない。変位の差は
         Δt の不揃いぶん接線方向へ傾く（VFR の合成データで最大のずれが 4.85° → 4.00°）。
         Δt が揃っていれば2つは一致する。 */
      const dtm = (v[k].dt + v[k + 1].dt) / 2;
      const d2 = { x: dv.x * dtm, y: dv.y * dtm, z: dv.z * dtm };
      a.push({ k: k, t: track[k + 1].t, at: track[k + 1], d2: d2, dv: dv, dt: dt,
               ax: dv.x / dt, ay: dv.y / dt, az: dv.z / dt });
    }
    return { track: track, trackAll: trackAll, kin: { v: v, a: a } };
  }

  /** state から作り直す。ビューアを描く前に呼ぶ */
  function compute() {
    HG.track3d = []; HG.track3dAll = []; HG.kin3d = { v: [], a: [] };
    if (!ready()) return false;
    const sel = HG.selection.list().filter(f => f.found);
    const all = HG.points.listInTrim();
    const r = computeFrom(sel, all);
    HG.track3d = r.track; HG.track3dAll = r.trackAll; HG.kin3d = r.kin;
    return true;
  }

  /**
   * 精度の見積もり（3D仕様.md §4-A）。
   * 系統誤差は全体を一様に拡大縮小するだけで向きには効かない。数字は
   * 「紙の長い辺が画面上で何 px か」と「四隅を 2 px ずれて押したら何 % か」。
   */
  function precision() {
    const q = correctedCorners();
    if (!q) return null;
    const ab = Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y);
    const dc = Math.hypot(q[2].x - q[3].x, q[2].y - q[3].y);
    const ad = Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y);
    const bc = Math.hypot(q[2].x - q[1].x, q[2].y - q[1].y);
    const longPx = Math.max((ab + dc) / 2, (ad + bc) / 2);
    const shortPx = Math.min((ab + dc) / 2, (ad + bc) / 2);
    /* 2 px のずれが、短いほうの辺に対して何 % か（悪いほうで見積もる） */
    return { longPx: longPx, shortPx: shortPx, errPct: 2 / shortPx * 100 };
  }

  HG.recon = { state: S, PAPERS, setCorners, clearCorners, solve, ready, toWorld,
               planeToWorld, paperWorld, cameraWorld, computeFrom, compute,
               correctedCorners, precision };
})(typeof window !== 'undefined' ? (window.HG = window.HG || {}) : (globalThis.HG = globalThis.HG || {}));
