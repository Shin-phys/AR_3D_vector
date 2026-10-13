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
    A3: { w: 0.420, h: 0.297, name: 'A3' },
    /* ボードの投射は軌道が A4 の3倍に広がり、紙の外で誤差がふくらむ（tools/test/unit.js）。
       大きな基準として、模造紙（788×1091 mm）を半分に切ったもの */
    HALF: { w: 0.788, h: 0.545, name: '模造紙の半分' }
  };

  const S = {
    paper: Object.assign({}, PAPERS.A4),
    corners: [],          // 画像座標（rawX/rawY と同じ「画像上の実位置」）。A, B, C, D の順
    cornerFrame: null,    // 四隅を押したコマ
    H: null,              // 紙の座標 → 画像座標（補正後の座標系）
    Hinv: null,
    s: 1,                 // 時計回りなら +1（z = +Y）
    ex: null,             // 画面の右に当たる水平の向き（回す前の 3D で）
    pose: null,
    /* ★ 紙を置いた面。'horizontal'（机・床）／'vertical'（壁・ボード）★
       鉛直な面では、紙の面の中のどちらが「下」かを決める必要がある。
       おもりを吊るした糸の上と下を押してもらう（plumb）。糸が無ければ
       「画面の下」を下とみなす（スマホが傾いていればそのぶんずれる）。
       糸は本物の鉛直なので、アプリが「下」を仮定せずに済む。 */
    plane: 'horizontal',
    plumb: [],            // 糸の2点（画像上の実位置。上→下）
    plumbFrame: null,
    down: null,           // 紙の座標で、鉛直下向きの単位ベクトル {x, y}
    right: null,          // 紙の座標で、水平・画面右向きの単位ベクトル {x, y}
    downSource: ''        // 'plumb' | 'image'
  };

  /* ---------- 四隅 ---------- */

  /** カメラぶれ補正を、四隅（や糸）にも点と同じだけ掛ける（points.applyCorrection と同じ式） */
  function corrected(list, frame) {
    let dx = 0, dy = 0;
    const st = HG.state;
    if (st && st.tracking && st.tracking.useMarker && st.refMarker && frame !== null) {
      const base = st.refMarker.find(m => m && m.found);
      const m = st.refMarker[frame];
      if (base && m && m.found) { dx = m.x - base.x; dy = m.y - base.y; }
    }
    return list.map(c => ({ x: c.x - dx, y: c.y - dy }));
  }
  function correctedCorners() {
    if (S.corners.length !== 4) return null;
    return corrected(S.corners, S.cornerFrame);
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

    /* 鉛直な面：紙の座標での「下」と「右」 */
    S.down = S.right = null; S.downSource = '';
    const P = (u, v) => HG.geom.apply(S.Hinv, u, v);
    const unit = (p, q) => { const L = Math.hypot(q.x - p.x, q.y - p.y) || 1; return { x: (q.x - p.x) / L, y: (q.y - p.y) / L }; };
    if (S.plane === 'vertical') {
      if (S.plumb.length === 2) {
        const pl = corrected(S.plumb, S.plumbFrame);
        S.down = unit(P(pl[0].x, pl[0].y), P(pl[1].x, pl[1].y));
        S.downSource = 'plumb';
      } else {
        S.down = unit(P(c0.x, c0.y), P(c0.x, c0.y + step));
        S.downSource = 'image';
      }
      const r = unit(P(c0.x, c0.y), P(c0.x + step, c0.y));
      const k = r.x * S.down.x + r.y * S.down.y;
      S.right = (() => { const v = { x: r.x - k * S.down.x, y: r.y - k * S.down.y }; const L = Math.hypot(v.x, v.y) || 1; return { x: v.x / L, y: v.y / L }; })();
    }
    if (W && Hh) S.pose = HG.geom.pose(H, W, Hh);
    return { ok: true };
  }

  /* 'stereo'（2台のカメラ）のときは、このファイルの計算は使わず stereo-ui.js に任せる
     （ready / compute / cameraWorld は下で受け渡す）。紙の四隅も糸も使わない */
  function setPlane(p) { S.plane = p === 'vertical' ? 'vertical' : p === 'stereo' ? 'stereo' : 'horizontal'; }
  function stereo() { return S.plane === 'stereo' && HG.stereo; }
  function setPlumb(list, frameIndex) {
    S.plumb = (list || []).map(p => ({ x: p.x, y: p.y }));
    S.plumbFrame = list && list.length ? frameIndex : null;
  }

  function setCorners(list, frameIndex) {
    S.corners = list.map(p => ({ x: p.x, y: p.y }));
    S.cornerFrame = frameIndex;
  }
  function clearCorners() {
    S.corners = []; S.cornerFrame = null; S.H = S.Hinv = S.pose = null; S.down = S.right = null;
  }
  function ready() { return stereo() ? HG.stereo.ready() : !!S.Hinv; }

  /** 回す前の 3D：x = X、z = s·Y、y = 法線方向の高さ（カメラ側が上） */
  function raw0(a, b, c) { return { x: a, y: -S.s * c, z: S.s * b }; }
  function raw(u, v) { const p = HG.geom.apply(S.Hinv, u, v); return raw0(p.x, p.y, 0); }
  /** 鉛直軸まわりに回して、x を画面の右に合わせる（ez = ex × 上） */
  function turn(p) {
    const e = S.ex || { x: 1, z: 0 };
    return { x: p.x * e.x + p.z * e.z, y: p.y, z: -p.x * e.z + p.z * e.x };
  }

  /**
   * 鉛直な面：紙の座標 (X, Y, 法線方向の高さ) → 3D。
   * x = 右向きの成分、y = 上向きの成分（下の逆）、z = カメラ側への高さ。
   * 画面の右と上は鏡に映っていない組なので、x × y は必ずカメラの側を向く。
   * 時計回りに押したとき紙の法線 X×Y はカメラから遠ざかる向き（水平の面と同じ理屈）なので、
   * カメラ側への高さは −s·c。
   */
  function vert(a, b, c) {
    const r = S.right, d = S.down;
    return { x: a * r.x + b * r.y, y: -(a * d.x + b * d.y), z: -S.s * c };
  }

  /** 画像座標（補正後）→ 3D（m） */
  function toWorld(u, v) {
    if (S.plane === 'vertical' && S.down) { const p = HG.geom.apply(S.Hinv, u, v); return vert(p.x, p.y, 0); }
    return turn(raw(u, v));
  }
  /** 紙の座標 (X, Y, 法線方向の高さ) → 3D */
  function planeToWorld(a, b, c) {
    if (S.plane === 'vertical' && S.down) return vert(a, b, c);
    return turn(raw0(a, b, c));
  }

  /** 糸の2点（3D）。描くため */
  function plumbWorld() {
    if (stereo() || S.plumb.length !== 2 || !S.Hinv) return null;
    return corrected(S.plumb, S.plumbFrame).map(p => toWorld(p.x, p.y));
  }

  /** 紙の四隅（3D） */
  function paperWorld() {
    if (stereo()) return null;
    const w = S.paper.w, h = S.paper.h;
    return [[0, 0], [w, 0], [w, h], [0, h]].map(p => planeToWorld(p[0], p[1], 0));
  }

  /**
   * 撮影したカメラの位置と向き（3D）。「撮影位置から見る」に使う。
   * f は標準カメラの画角で置いている（geom.js の「カメラの姿勢」）。おおよその視点。
   */
  function cameraWorld() {
    if (stereo()) return HG.stereo.cameraWorld();
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
    return { track: track, trackAll: trackAll, kin: kinematics(track) };
  }

  /** 位置の列（時間順）→ 速度と Δv。2台のカメラ（stereo.js）も同じものを使う */
  function kinematics(track) {
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
    return { v: v, a: a };
  }

  /** state から作り直す。ビューアを描く前に呼ぶ */
  function compute() {
    if (stereo()) return HG.stereo.compute();
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

  HG.recon = { state: S, PAPERS, setCorners, clearCorners, solve, setPlane, setPlumb, plumbWorld, ready, toWorld,
               planeToWorld, paperWorld, cameraWorld, computeFrom, kinematics, compute,
               correctedCorners, precision };
})(typeof window !== 'undefined' ? (window.HG = window.HG || {}) : (globalThis.HG = globalThis.HG || {}));
