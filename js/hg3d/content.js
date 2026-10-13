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

  /** 軸を置く場所：部屋の隅（奥の壁と横の壁が出会う床の角） */
  function axisOrigin(st) { return { x: st.wallSide, y: st.floorY, z: st.wallBack }; }

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
  function stage(ext, plane) {
    const s = sizes(ext.S);
    const m = 0.15 * ext.S;
    const floorY = Math.min(0, ext.box.y0) - s.ball;
    const step = 0.1;
    const x0 = Math.floor((ext.box.x0 - m) / step) * step, x1 = Math.ceil((ext.box.x1 + m) / step) * step;
    let z0 = Math.floor((ext.box.z0 - m) / step) * step, z1 = Math.ceil((ext.box.z1 + m) / step) * step;
    /* 鉛直な面（ボード）では、運動は z = 0 の面の中だけ。床をカメラ側へ広げ、ボードを奥に立てる */
    if (plane === 'vertical') { z0 = -step; z1 = Math.max(z1, Math.ceil(0.45 * ext.S / step) * step); }
    const top = Math.max(ext.box.y1, 0) + Math.max(0.12, 0.35 * ext.S);
    return { floorY: floorY, x0: x0, x1: x1, z0: z0, z1: z1, top: top, step: step,
             wallBack: z0, wallSide: x0 };
  }

  /**
   * @param data  {track, trackAll, kin:{v,a}, paper:[A,B,C,D], plane, plumb:[上,下]}
   * @param opt   {layers:{balls,paper,grid,pos,vel,dv,wallBack,wallSide,floor,arrowSh,axes}, dvZoom}
   * @returns     {group, ext, stage, sizes}
   */
  function build(data, opt) {
    const M = HG.mesh, C = M.COLORS;
    const L = (opt && opt.layers) || {};
    const zoom = (opt && opt.dvZoom) || 1;
    const g = new THREE.Group();
    const ext = extent(data);
    if (!ext) return { group: g, ext: null };
    const vertical = data.plane === 'vertical';
    const s = sizes(ext.S), st = stage(ext, data.plane);

    /* 床（目盛りと紙）。球の半径だけ下げて描く（このファイルの冒頭を参照） */
    const floor = new THREE.Group();
    if (L.grid !== false) floor.add(M.grid(st.x0, st.x1, st.z0, st.z1, 0, st.step, s.grid));
    if (!vertical && L.paper !== false && data.paper) floor.add(M.paper(data.paper, s.grid * 1.3));
    floor.position.y = st.floorY;
    g.add(floor);
    /* 鉛直な面：紙はボードに貼ってあるので床ではなく奥に立てる。球が埋まらないよう球の半径だけ奥へ。
       ボードそのものも薄く描く（奥の壁の代わり。運動はこの面の中なので、ここに影は落とさない） */
    if (vertical && L.paper !== false) {
      const back = new THREE.Group();
      back.add(M.wall('z', -0.002, st.x0, st.x1, st.floorY, st.top));
      /* ボードとの間を 5 mm 空ける（1 mm だと遠くから見たとき奥行きの精度が足りず、紙がボードの色に沈んだ） */
      if (data.paper) back.add(M.paper(data.paper.map(p => ({ x: p.x, y: p.y, z: p.z + 0.005 })), s.grid * 1.3));
      back.position.z = -s.ball;
      g.add(back);
    }
    /* 糸（鉛直の基準）。測った鉛直そのものなので、そのまま描く */
    if (vertical && data.plumb && L.paper !== false) {
      g.add(M.rod(data.plumb[0], data.plumb[1], s.grid * 0.8, '#12161c', 0.8));
      g.add(M.ball(data.plumb[1], s.ball * 0.8, '#5b6572'));
    }

    /* 軸は「向きの印」として部屋の隅（奥の壁と横の壁が出会う床の角）に置く。
       ★ 紙の角 A に置かないこと。★ 運動のすぐそばに来て、Δv の矢印と重なった（実機）。
       ★ 円の中心にも置かないこと。★ 中心を出すには円を当てはめることになり（答えの仮定）、
       しかも Δv が全部軸の原点を向く絵になって、生徒が読む前に答えが見える。
       位置ベクトルの基準（原点）は角 A のまま。そちらは小さな印で示す。
       ラベルはビューアが HTML で重ねる（AR には文字を入れない） */
    if (L.axes !== false) {
      const O = axisOrigin(st), a = axisLen(ext), r = s.arrow * 0.55;   // ベクトルより細く（主役は矢印）
      g.add(M.arrow(O, { x: a, y: 0, z: 0 }, C.axisX, r));
      g.add(M.arrow(O, { x: 0, y: a, z: 0 }, C.axisY, r));
      g.add(M.arrow(O, { x: 0, y: 0, z: a }, C.axisZ, r));
    }

    const tr = data.track || [];
    /* ストロボ（使うコマの位置に球）。「実物の写真で表示」のときは、そのコマの切り抜きの札 */
    if (L.balls !== false) tr.forEach((p, i) => {
      const pc = L.photo && data.photoCards && data.photoCards[i];
      g.add(pc ? HG.photo.card(pc.canvas, p, pc.fr) : M.ball(p, s.ball, C.ball));
    });

    /* 位置ベクトル（基準点＝紙の角 A から）。基準点には小さな印 */
    if (L.pos) {
      g.add(M.ball({ x: 0, y: 0, z: 0 }, s.ball * 0.7, '#12161c'));
      tr.forEach(p => g.add(M.arrow({ x: 0, y: 0, z: 0 }, p, C.pos, s.arrow * 0.8, 0.85)));
    }

    /* 速度（隣り合う位置の先端どうしを結ぶ＝変位。実寸） */
    const kin = data.kin || { v: [], a: [] };
    if (L.vel) kin.v.forEach(v => g.add(M.arrow(v.from, v.d, C.vel, s.arrow)));

    /* Δv（位置 r_{k+1} に置く。倍率は全体で1つ） */
    if (L.dv) kin.a.forEach(a => g.add(M.arrow(a.at,
      { x: a.d2.x * zoom, y: a.d2.y * zoom, z: a.d2.z * zoom }, C.dv, s.arrow * 1.1)));

    /* 壁と影。影は「使うコマ」の球だけ（ストロボと同じ点） */
    const hW = st.top - st.floorY;
    const surf = [];      // 影を落とす面：{ put(p) → 面の上の点, flat(v) → 面に沿った成分 }
    if (L.wallBack && !vertical) {
      g.add(M.wall('z', st.wallBack, st.x0, st.x1, st.floorY, st.top));
      tr.forEach(p => g.add(M.disc({ x: p.x, y: p.y, z: st.wallBack + 0.002 }, s.ball * 0.9, 'z', C.shadow, 0.75)));
      surf.push({ put: p => ({ x: p.x, y: p.y, z: st.wallBack + 0.004 }), flat: v => ({ x: v.x, y: v.y, z: 0 }) });
    }
    if (L.wallSide) {
      g.add(M.wall('x', st.wallSide, st.z0, st.z1, st.floorY, st.top));
      tr.forEach(p => g.add(M.disc({ x: st.wallSide + 0.002, y: p.y, z: p.z }, s.ball * 0.9, 'x', C.shadow, 0.75)));
      surf.push({ put: p => ({ x: st.wallSide + 0.004, y: p.y, z: p.z }), flat: v => ({ x: 0, y: v.y, z: v.z }) });
    }
    /* 床の影（真上からの光）。机の上の運動では運動そのものと重なるので、鉛直な面のときだけ */
    if (L.floor && vertical) {
      tr.forEach(p => g.add(M.disc({ x: p.x, y: st.floorY + 0.002, z: p.z }, s.ball * 0.9, 'y', C.shadow, 0.75)));
      surf.push({ put: p => ({ x: p.x, y: st.floorY + 0.004, z: p.z }), flat: v => ({ x: v.x, y: 0, z: v.z }) });
    }
    /* ★ 矢印の影（成分分解の代わり）★
       速度と Δv の矢印も同じ光で壁や床に落とす。成分の矢印を別に描くより、
       「影」という1つの言葉で位置も速度も加速度も読める（2026-10-13 に決めた）。
       斜方投射なら Δv の床の影はほぼ点（水平成分ゼロ）、横の壁の影は下向きになる。 */
    if (L.arrowSh !== false && surf.length) {
      const sh = (from, v, color, r) => surf.forEach(f => g.add(M.arrow(f.put(from), f.flat(v), color, r, 0.5)));
      if (L.vel) kin.v.forEach(v => sh(v.from, v.d, C.vel, s.arrow * 0.7));
      if (L.dv) kin.a.forEach(a => sh(a.at, { x: a.d2.x * zoom, y: a.d2.y * zoom, z: a.d2.z * zoom }, C.dv, s.arrow * 0.8));
    }
    g.userData = { hW: hW };
    return { group: g, ext: ext, stage: st, sizes: s, plane: data.plane || 'horizontal',
             photoNow: L.photo ? data.photoNow || null : null };
  }

  /* ---------- 「いま」の球と影（動くもの） ----------
     ビューアの時刻スライダーと、AR の動き（timeSamples）が同じものを使う。
     別々に作ると、AR でだけ影の位置がずれる余地ができる。
     名前は AR の書き出しで目印にする（ar.js が USDZ の中でこの名前を探す）。 */
  function makeNow(built, layers) {
    const M = HG.mesh, C = M.COLORS, s = built.sizes;
    const g = new THREE.Group();
    const named = (m, n) => { m.name = n; g.add(m); return m; };
    const o = { group: g, r: s.arrow * 0.35, parts: [] };
    /* 「いま」も、写真のときは切り抜きの札（枠の色で「いま」と分かるよう、黄色の輪を添える） */
    if (built.photoNow) {
      const c = HG.photo.card(built.photoNow.canvas, { x: 0, y: 0, z: 0 }, built.photoNow.fr, { ring: C.ballNow });
      o.ball = named(c, 'HGANIM_ball');
    } else {
      o.ball = named(M.ball({ x: 0, y: 0, z: 0 }, s.ball * 1.25, C.ballNow), 'HGANIM_ball');
    }
    o.parts.push(o.ball);
    const unitRod = () => new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8), M.mat('#12161c', 0.35));
    if (layers.wallBack) {
      o.shB = named(M.disc({ x: 0, y: 0, z: 0 }, s.ball * 1.1, 'z', '#12161c', 0.95), 'HGANIM_shB');
      o.rayB = named(unitRod(), 'HGANIM_rayB');
      o.parts.push(o.shB, o.rayB);
    }
    if (layers.wallSide) {
      o.shS = named(M.disc({ x: 0, y: 0, z: 0 }, s.ball * 1.1, 'x', '#12161c', 0.95), 'HGANIM_shS');
      o.rayS = named(unitRod(), 'HGANIM_rayS');
      o.parts.push(o.shS, o.rayS);
    }
    if (layers.floor && built.plane === 'vertical') {
      o.shF = named(M.disc({ x: 0, y: 0, z: 0 }, s.ball * 1.1, 'y', '#12161c', 0.95), 'HGANIM_shF');
      o.rayF = named(unitRod(), 'HGANIM_rayF');
      o.parts.push(o.shF, o.rayF);
    }
    /* 鉛直な面のときは奥の壁（＝ボード）に影を落とさない */
    if (built.plane === 'vertical' && o.shB) {
      g.remove(o.shB); g.remove(o.rayB);
      o.parts = o.parts.filter(m => m !== o.shB && m !== o.rayB);
      o.shB = o.rayB = null;
    }
    return o;
  }

  function setRod(m, a, b, r) {
    const v = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
    const L = Math.max(1e-5, v.length());
    m.scale.set(r, L, r);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize());
    m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  }

  /** 「いま」を点 p に置く（影と投影の線も） */
  function placeNow(o, p, st) {
    o.ball.position.set(p.x, p.y, p.z);
    if (o.shB) {
      const q = { x: p.x, y: p.y, z: st.wallBack + 0.003 };
      o.shB.position.set(q.x, q.y, q.z);
      setRod(o.rayB, p, q, o.r);
    }
    if (o.shS) {
      const q = { x: st.wallSide + 0.003, y: p.y, z: p.z };
      o.shS.position.set(q.x, q.y, q.z);
      setRod(o.rayS, p, q, o.r);
    }
    if (o.shF) {
      const q = { x: p.x, y: st.floorY + 0.003, z: p.z };
      o.shF.position.set(q.x, q.y, q.z);
      setRod(o.rayF, p, q, o.r);
    }
    o.parts.forEach(m => m.updateMatrix());
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

  HG.content = { build, extent, sizes, stage, scaleText, axisLen, axisOrigin, makeNow, placeNow };
})(window.HG = window.HG || {});
