/* =====================================================================
   hg3d/meshes.js — 3D の部品（球・矢印・床の目盛り・紙）

   ★ 線（Line）を使わず、全部を面（Mesh）で作ること。★
   iOS の AR Quick Look に渡す USDZ は面しか運べない（USDZExporter が
   Line を書き出さない）。ビューアと AR で別の部品を作ると、AR でだけ
   目盛りや矢印が消える。ここで作ったものを両方がそのまま使う。

   ★ 色は1つの材質に1色。★ 頂点色は Quick Look で落ちることがある
   （3D仕様.md §6）。色ごとに材質を分けている。

   配色は 2D と同じ（位置＝青、速度＝緑、Δv＝橙）。3D仕様.md §3。
   ===================================================================== */
(function (HG) {
  'use strict';

  const COLORS = {
    pos: '#0b6bcb', vel: '#12a150', dv: '#ff7a00',
    ball: '#ff2d6f', ballNow: '#ffd400',
    grid: '#c9ced6', gridMain: '#9aa3ae', paper: '#ffffff', paperEdge: '#5b6572',
    /* ★ 軸は色を付けない（濃い灰色）。★ 赤の x 軸が AR の光の下で Δv の橙と見分けられず、
       緑の y 軸も速度の緑と同じだった（実機）。色は矢印（位置・速度・Δv）だけに使う */
    axisX: '#4a5260', axisY: '#4a5260', axisZ: '#4a5260',
    shadow: '#3b4250', wall: '#e9edf2'
  };

  const matCache = new Map();
  /** 色ごとに材質を1つ（使い回す）。opacity を付けたいときは別の鍵になる */
  function mat(color, opacity) {
    const key = color + '|' + (opacity === undefined ? 1 : opacity);
    if (matCache.has(key)) return matCache.get(key);
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color), roughness: 0.55, metalness: 0.0,
      transparent: opacity !== undefined && opacity < 1, opacity: opacity === undefined ? 1 : opacity
    });
    matCache.set(key, m);
    return m;
  }

  const V = p => new THREE.Vector3(p.x, p.y, p.z);

  function ball(p, r, color, opacity) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), mat(color, opacity));
    m.position.copy(V(p));
    return m;
  }

  /**
   * 矢印。from から vec だけ伸ばす。
   * 頭の大きさは軸の太さで決め、短い矢印では頭を縮める（頭だけの矢印にしない）。
   * 長さがほぼゼロなら点（小さな球）にする。2D の arrows.dot と同じ扱い
   * （ゼロベクトルもベクトルである、という話ができるように消さない）。
   */
  function arrow(from, vec, color, radius, opacity) {
    const g = new THREE.Group();
    const L = Math.hypot(vec.x, vec.y, vec.z);
    const r = radius;
    if (L < r * 1.5) {
      g.add(ball(from, r * 1.6, color, opacity));
      return g;
    }
    const headL = Math.min(L * 0.45, r * 6), headR = r * 2.6;
    const shaftL = L - headL;
    const dir = new THREE.Vector3(vec.x, vec.y, vec.z).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r, r, shaftL, 12), mat(color, opacity));
    shaft.position.set(0, shaftL / 2, 0);
    const head = new THREE.Mesh(new THREE.ConeGeometry(headR, headL, 16), mat(color, opacity));
    head.position.set(0, shaftL + headL / 2, 0);
    g.add(shaft, head);
    g.quaternion.copy(q);
    g.position.copy(V(from));
    return g;
  }

  /** 細い棒（目盛り線・軸の代わり）。a から b まで */
  function rod(a, b, r, color, opacity) {
    const v = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const L = Math.hypot(v.x, v.y, v.z);
    const m = new THREE.Mesh(new THREE.BoxGeometry(r * 2, L, r * 2), mat(color, opacity));
    const dir = new THREE.Vector3(v.x, v.y, v.z).normalize();
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    return m;
  }

  /**
   * 床の目盛り（1目盛 10 cm、3D仕様.md §5）。y の高さに、x・z の範囲で。
   * 50 cm ごとに少し濃い線。
   */
  function grid(x0, x1, z0, z1, y, step, thick) {
    const g = new THREE.Group();
    step = step || 0.1;
    const r = thick || 0.0012;
    const sx = Math.floor(x0 / step) * step, ex = Math.ceil(x1 / step) * step;
    const sz = Math.floor(z0 / step) * step, ez = Math.ceil(z1 / step) * step;
    const major = v => Math.abs(v / 0.5 - Math.round(v / 0.5)) < 1e-6;
    for (let x = sx; x <= ex + 1e-9; x += step) {
      g.add(rod({ x: x, y: y, z: sz }, { x: x, y: y, z: ez }, major(x) ? r * 1.6 : r,
                major(x) ? COLORS.gridMain : COLORS.grid));
    }
    for (let z = sz; z <= ez + 1e-9; z += step) {
      g.add(rod({ x: sx, y: y, z: z }, { x: ex, y: y, z: z }, major(z) ? r * 1.6 : r,
                major(z) ? COLORS.gridMain : COLORS.grid));
    }
    g.userData.extent = { x0: sx, x1: ex, z0: sz, z1: ez, y: y };
    return g;
  }

  /** 紙（白い面と縁）。四隅は 3D の点 [A, B, C, D] */
  function paper(c, edge) {
    const g = new THREE.Group();
    const geo = new THREE.BufferGeometry();
    const lift = 0.0004;     // 目盛りと重なってちらつかないよう、ほんの少し浮かせる
    const P = c.map(p => [p.x, p.y + lift, p.z]);
    geo.setAttribute('position', new THREE.Float32BufferAttribute(
      [].concat(P[0], P[1], P[2], P[0], P[2], P[3]), 3));
    geo.computeVertexNormals();
    const m = mat(COLORS.paper);
    const face = new THREE.Mesh(geo, m);
    /* 上から見ても下から見ても見えるように（法線の向きは押す順で変わる） */
    face.material = m.clone(); face.material.side = THREE.DoubleSide;
    /* 立てた紙（ボード）は光が横から当たって灰色に沈み、ボードと見分けられなかった。少し自分で光らせる */
    face.material.emissive = new THREE.Color('#5a5a5a');
    g.add(face);
    const r = edge || 0.0016;
    for (let i = 0; i < 4; i++) {
      const a = c[i], b = c[(i + 1) % 4];
      g.add(rod({ x: a.x, y: a.y + lift, z: a.z }, { x: b.x, y: b.y + lift, z: b.z }, r, COLORS.paperEdge));
    }
    return g;
  }

  /** 縦の壁（影を落とす面）。axis = 'z'（奥の壁：z 一定）／'x'（横の壁：x 一定） */
  function wall(axis, at, a0, a1, y0, y1) {
    const geo = new THREE.BufferGeometry();
    let P;
    if (axis === 'z') P = [[a0, y0, at], [a1, y0, at], [a1, y1, at], [a0, y1, at]];
    else P = [[at, y0, a0], [at, y0, a1], [at, y1, a1], [at, y1, a0]];
    geo.setAttribute('position', new THREE.Float32BufferAttribute(
      [].concat(P[0], P[1], P[2], P[0], P[2], P[3]), 3));
    geo.computeVertexNormals();
    const m = mat(COLORS.wall, 0.55).clone();
    m.side = THREE.DoubleSide;
    m.depthWrite = false;
    return new THREE.Mesh(geo, m);
  }

  /** 平たい円盤（影の点）。axis は円盤の法線の向き */
  function disc(p, r, axis, color, opacity) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, r * 0.12, 20), mat(color, opacity));
    if (axis === 'z') m.rotation.x = Math.PI / 2;
    else if (axis === 'x') m.rotation.z = Math.PI / 2;
    m.position.copy(V(p));
    return m;
  }

  /** 中身ごと捨てる（材質は使い回しているので捨てない） */
  function dispose(obj) {
    obj.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  }

  HG.mesh = { COLORS, mat, ball, arrow, rod, grid, paper, wall, disc, dispose };
})(window.HG = window.HG || {});
