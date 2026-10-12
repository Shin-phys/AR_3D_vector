/* =====================================================================
   hg3d/content.js — 3D の中身を組み立てる（ビューアと AR が同じものを使う）

   ここで作る Group が「空間に固定した3Dストロボ＋ベクトル」そのもの。
   ビューアはこれを表示し、AR はこれを書き出す。**別々に組み立てないこと。**
   AR とビューアで矢印の位置や倍率が食い違う余地を作らないため
   （2D の「別系統の描画を作らない」と同じ理由）。

   動くもの（時刻スライダーの「いま」の球と、その影）はここに入れない。
   ビューアが別に持って位置だけ動かす（AR にはアニメーションを入れない）。

   ★ 表示の都合でずらしているもの（測った値は変えていない）★
   床（目盛りと紙）は球の半径だけ下げて描く。紙の面 y = 0 にそのまま描くと、
   球の下半分が紙に埋まって見えるため。測った座標は y = 0 のまま。
   ===================================================================== */
(function (HG) {
  'use strict';

  /** 軸の長さ（ビューアのラベル位置も同じ値を使う） */
  function axisLen(ext) { return Math.max(0.08, 0.33 * ext.S); }

  /** 大きさの目安（球の半径や矢印の太さを、運動の大きさに合わせる） */
  function extent(data) {
    const pts = [].concat(data.track || [], data.trackAll || [], data.paper || []);
    if (!pts.length) return null;
    const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
    pts.forEach(p => {
      b.x0 = Math.min(b.x0, p.x); b.x1 = Math.max(b.x1, p.x);
      b.y0 = Math.min(b.y0, p.y); b.y1 = Math.max(b.y1, p.y);
      b.z0 = Math.min(b.z0, p.z); b.z1 = Math.max(b.z1, p.z);
    });
    const S = Math.max(0.2, b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0);
    /* 見る中心は運動の真ん中（紙ではない）。運動が無ければ紙の真ん中 */
    const mv = (data.trackAll && data.trackAll.length) ? data.trackAll : pts;
    const c = mv.reduce((s, p) => ({ x: s.x + p.x, y: s.y + p.y, z: s.z + p.z }), { x: 0, y: 0, z: 0 });
    const n = mv.length;
    return { box: b, S: S, center: { x: c.x / n, y: c.y / n, z: c.z / n } };
  }

  /** 部品の寸法。全部 S（運動の大きさ）から決める */
  function sizes(S) {
    const ball = Math.min(0.03, Math.max(0.004, 0.022 * S));
    return { ball: ball, arrow: ball * 0.28, grid: Math.max(0.0008, 0.0025 * S) };
  }

  /**
   * 床・壁の置き場所。
   * 奥の壁はカメラと反対側（z の小さい側）、横の壁は左（x の小さい側）。
   * 3D の x を画面の右、z をカメラ側に合わせてあるので（reconstruct.js）、
   * 「斜め」から見るとこの2枚が奥と左に立つ。
   */
  function stage(ext) {
    const s = sizes(ext.S);
    const m = 0.15 * ext.S;
    const floorY = Math.min(0, ext.box.y0) - s.ball;
    const step = 0.1;
    const x0 = Math.floor((ext.box.x0 - m) / step) * step, x1 = Math.ceil((ext.box.x1 + m) / step) * step;
    const z0 = Math.floor((ext.box.z0 - m) / step) * step, z1 = Math.ceil((ext.box.z1 + m) / step) * step;
    const top = Math.max(ext.box.y1, 0) + Math.max(0.12, 0.35 * ext.S);
    return { floorY: floorY, x0: x0, x1: x1, z0: z0, z1: z1, top: top, step: step,
             wallBack: z0, wallSide: x0 };
  }

  /**
   * @param data  {track, trackAll, kin:{v,a}, paper:[A,B,C,D]}
   * @param opt   {layers:{balls,paper,grid,pos,vel,dv,wallBack,wallSide,axes}, dvZoom}
   * @returns     {group, ext, stage, sizes}
   */
  function build(data, opt) {
    const M = HG.mesh, C = M.COLORS;
    const L = (opt && opt.layers) || {};
    const zoom = (opt && opt.dvZoom) || 1;
    const g = new THREE.Group();
    const ext = extent(data);
    if (!ext) return { group: g, ext: null };
    const s = sizes(ext.S), st = stage(ext);

    /* 床（目盛りと紙）。球の半径だけ下げて描く（このファイルの冒頭を参照） */
    const floor = new THREE.Group();
    if (L.grid !== false) floor.add(M.grid(st.x0, st.x1, st.z0, st.z1, 0, st.step, s.grid));
    if (L.paper !== false && data.paper) floor.add(M.paper(data.paper, s.grid * 1.3));
    floor.position.y = st.floorY;
    g.add(floor);

    /* 軸（原点＝紙の角 A）。ラベルはビューアが HTML で重ねる（AR には文字を入れない） */
    if (L.axes !== false) {
      const a = axisLen(ext), r = s.arrow * 0.8;
      g.add(M.arrow({ x: 0, y: 0, z: 0 }, { x: a, y: 0, z: 0 }, C.axisX, r));
      g.add(M.arrow({ x: 0, y: 0, z: 0 }, { x: 0, y: a, z: 0 }, C.axisY, r));
      g.add(M.arrow({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: a }, C.axisZ, r));
    }

    const tr = data.track || [];
    /* ストロボ（使うコマの位置に球） */
    if (L.balls !== false) tr.forEach(p => g.add(M.ball(p, s.ball, C.ball)));

    /* 位置ベクトル（基準点＝原点から） */
    if (L.pos) tr.forEach(p => g.add(M.arrow({ x: 0, y: 0, z: 0 }, p, C.pos, s.arrow * 0.8, 0.85)));

    /* 速度（隣り合う位置の先端どうしを結ぶ＝変位。実寸） */
    const kin = data.kin || { v: [], a: [] };
    if (L.vel) kin.v.forEach(v => g.add(M.arrow(v.from, v.d, C.vel, s.arrow)));

    /* Δv（位置 r_{k+1} に置く。倍率は全体で1つ） */
    if (L.dv) kin.a.forEach(a => g.add(M.arrow(a.at,
      { x: a.d2.x * zoom, y: a.d2.y * zoom, z: a.d2.z * zoom }, C.dv, s.arrow * 1.1)));

    /* 壁と影。影は「使うコマ」の球だけ（ストロボと同じ点） */
    const hW = st.top - st.floorY;
    if (L.wallBack) {
      g.add(M.wall('z', st.wallBack, st.x0, st.x1, st.floorY, st.top));
      tr.forEach(p => g.add(M.disc({ x: p.x, y: p.y, z: st.wallBack + 0.002 }, s.ball * 0.9, 'z', C.shadow, 0.75)));
    }
    if (L.wallSide) {
      g.add(M.wall('x', st.wallSide, st.z0, st.z1, st.floorY, st.top));
      tr.forEach(p => g.add(M.disc({ x: st.wallSide + 0.002, y: p.y, z: p.z }, s.ball * 0.9, 'x', C.shadow, 0.75)));
    }
    g.userData = { hW: hW };
    return { group: g, ext: ext, stage: st, sizes: s };
  }

  /** 矢印の尺度（画面に書く。3D仕様.md §5「矢印の尺度を画面に表示する」） */
  function scaleText(kin, zoom) {
    if (!kin || !kin.v.length) return '';
    const dts = kin.v.map(v => v.dt).sort((a, b) => a - b);
    const dt = dts[Math.floor(dts.length / 2)];
    const vcm = dt * 100;                    // 1 m/s が何 cm の矢印か
    const acm = dt * dt * (zoom || 1) * 100; // 1 m/s² が何 cm の矢印か
    const f = x => x >= 10 ? x.toFixed(0) : x >= 1 ? x.toFixed(1) : x.toFixed(2);
    return '矢印の尺度：速度 1 m/s ＝ ' + f(vcm) + ' cm ／ Δv（加速度）1 m/s² ＝ ' + f(acm) + ' cm' +
           '（点の間隔 ' + (dt * 1000).toFixed(0) + ' ms' + (zoom > 1 ? '、Δv は ×' + zoom.toFixed(1) : '') + '）';
  }

  HG.content = { build, extent, sizes, stage, scaleText, axisLen };
})(window.HG = window.HG || {});
