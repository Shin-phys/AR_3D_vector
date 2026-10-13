/* =====================================================================
   hg3d/viewer.js — 3D ビューア（3D仕様.md §5）

   主役は「空間に固定した3Dストロボ＋ベクトル」。生徒は視点を動かし、
   影を落として観察する。描くもの自体は content.js が組み立てる（AR と共通）。

   ★ 視点の切り替えは瞬間移動にしない。★（3D仕様.md §5）
   どこから見ているかを失わないよう、注視点のまわりを連続的に回して移る。
   2D の「アニメーションを省かない」と同じ考え方。

   ★ 文字は HTML で重ねる。★ 3D の中に文字を入れると AR に持ち込めない
   （USDZ に文字は載らない）し、小さい画面で潰れる。
   ===================================================================== */
(function (HG) {
  'use strict';

  let host = null, renderer = null, scene = null, camera = null, controls = null;
  let labelsEl = null, labels = [];
  let built = null;           // content.build の戻り値
  let data = null;            // {track, trackAll, kin, paper}
  let nowObjs = null;         // 「いま」の球と影
  let running = false, anim = null;
  const opts = { layers: { balls: true, paper: true, grid: true, axes: true,
                           pos: false, vel: false, dv: false, wallBack: false, wallSide: false },
                 dvZoom: 1, now: 0 };
  const FOV = 45;

  function attach(el) {
    host = el;
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(new THREE.Color('#f3f5f8'));
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';

    labelsEl = document.createElement('div');
    labelsEl.className = 'v3-labels';
    host.appendChild(labelsEl);

    scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a93a0, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(0.6, 1.4, 0.9);
    scene.add(sun);

    camera = new THREE.PerspectiveCamera(FOV, 1, 0.005, 50);
    camera.position.set(0.6, 0.6, 1.0);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.rotateSpeed = 0.8;
    /* 指で触ったら、走っている視点のアニメーションは止める（取り合いになる） */
    controls.addEventListener('start', () => { anim = null; });
    fit();
  }

  /**
   * 大きさ。stage.js の fit() と同じ方針にそろえる：
   * スマホでは貼り付くブロックの中に置くので、高さは画面の 42% まで。
   * PC は横幅いっぱい・4:3、画面の 78% まで。
   */
  function fit() {
    if (!renderer) return;
    const w = host.clientWidth || 300;
    const narrow = window.innerWidth < 900;
    const maxH = Math.max(200, window.innerHeight * (narrow ? 0.42 : 0.78));
    const h = Math.round(Math.min(maxH, w * 3 / 4));
    renderer.setSize(w, h, true);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  /* ---------- 中身 ---------- */

  function clearContent() {
    if (built && built.group) { scene.remove(built.group); HG.mesh.dispose(built.group); }
    if (nowObjs) { scene.remove(nowObjs.group); HG.mesh.dispose(nowObjs.group); nowObjs = null; }
    built = null;
  }

  function setData(d) {
    data = d;
    rebuild();
  }

  function rebuild() {
    if (!scene) return;
    clearContent();
    if (!data) return;
    built = HG.content.build(data, opts);
    if (!built.ext) return;
    scene.add(built.group);
    makeNow();
    makeLabels();
    setNow(opts.now);
  }

  /** 「いま」の球と、壁へ落ちる影・投影の線（位置だけ動かす。部品は content.js） */
  function makeNow() {
    nowObjs = HG.content.makeNow(built, opts.layers);
    scene.add(nowObjs.group);
  }

  /** 時刻スライダー。i は trackAll（区間内の全コマ）の番号 */
  function setNow(i) {
    opts.now = i;
    if (!nowObjs || !data || !data.trackAll || !data.trackAll.length) return;
    const all = data.trackAll;
    HG.content.placeNow(nowObjs, all[Math.max(0, Math.min(all.length - 1, i))], built.stage);
  }

  /* ---------- 文字（HTML で重ねる） ---------- */
  function makeLabels() {
    labelsEl.innerHTML = '';
    labels = [];
    if (!built || opts.layers.axes === false) return;
    const a = HG.content.axisLen(built.ext) * 1.04;
    const add = (txt, p, cls) => {
      const el = document.createElement('div');
      el.className = 'v3-label ' + (cls || '');
      el.textContent = txt;
      labelsEl.appendChild(el);
      labels.push({ el: el, p: new THREE.Vector3(p.x, p.y, p.z) });
    };
    /* 軸ラベルは記号と言葉を併記する（3D仕様.md §5） */
    const O = HG.content.axisOrigin(built.stage);
    add('x 水平（右）', { x: O.x + a, y: O.y, z: O.z }, 'ax-x');
    add('y 鉛直（上）', { x: O.x, y: O.y + a, z: O.z }, 'ax-y');
    add('z 水平（手前）', { x: O.x, y: O.y, z: O.z + a }, 'ax-z');
    if (opts.layers.pos) add('A（基準点）', { x: 0, y: 0, z: 0 }, 'origin');
    const st = built.stage;
    if (opts.layers.wallBack && built.plane !== 'vertical') add('奥の壁', { x: (st.x0 + st.x1) / 2, y: st.top, z: st.wallBack }, 'wall');
    if (opts.layers.wallSide) add('横の壁', { x: st.wallSide, y: st.top, z: (st.z0 + st.z1) / 2 }, 'wall');
  }

  function placeLabels() {
    if (!labels.length) return;
    const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
    labels.forEach(l => {
      const v = l.p.clone().project(camera);
      const vis = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      l.el.style.display = vis ? 'block' : 'none';
      if (vis) l.el.style.transform = 'translate(' + ((v.x + 1) / 2 * w).toFixed(1) + 'px,' +
                                      ((1 - v.y) / 2 * h).toFixed(1) + 'px)';
    });
  }

  /* ---------- 視点 ---------- */

  /** 注視点からの球座標（polar：真上から測った角、azim：+z から +x へ回る角） */
  function sph(pos, tgt) {
    const d = new THREE.Vector3().subVectors(pos, tgt);
    const r = d.length() || 1;
    return { r: r, polar: Math.acos(Math.max(-1, Math.min(1, d.y / r))), azim: Math.atan2(d.x, d.z) };
  }
  function fromSph(s, tgt) {
    return new THREE.Vector3(
      tgt.x + s.r * Math.sin(s.polar) * Math.sin(s.azim),
      tgt.y + s.r * Math.cos(s.polar),
      tgt.z + s.r * Math.sin(s.polar) * Math.cos(s.azim));
  }

  function fitDistance(fov) {
    const S = built ? built.ext.S : 0.4;
    return S * 0.78 / Math.tan((fov || FOV) / 2 * Math.PI / 180);
  }

  const DEG = Math.PI / 180;
  /** 名前つきの視点。ボタン名に結論を書かないこと（3D仕様.md §5） */
  function target(name) {
    const c = built ? built.ext.center : { x: 0, y: 0, z: 0 };
    const tgt = new THREE.Vector3(c.x, c.y, c.z);
    const r = fitDistance(FOV);
    if (name === 'top')   return { tgt: tgt, s: { r: r, polar: 0.0005, azim: 0 }, fov: FOV };
    if (name === 'side')  return { tgt: tgt, s: { r: r, polar: 90 * DEG, azim: 90 * DEG }, fov: FOV };
    if (name === 'front') return { tgt: tgt, s: { r: r, polar: 90 * DEG, azim: 0 }, fov: FOV };
    if (name === 'camera') {
      const cw = HG.recon && HG.recon.cameraWorld && HG.recon.cameraWorld();
      if (cw) {
        /* 撮影したカメラの向きの線が運動の高さの面と交わる点を注視点にする */
        const P = new THREE.Vector3(cw.pos.x, cw.pos.y, cw.pos.z);
        const F = new THREE.Vector3(cw.forward.x, cw.forward.y, cw.forward.z).normalize();
        let T = tgt;
        if (Math.abs(F.y) > 1e-3) {
          const k = (c.y - P.y) / F.y;
          if (k > 0) T = P.clone().add(F.multiplyScalar(k));
        }
        return { tgt: T, s: sph(P, T), fov: cw.fovY };
      }
    }
    /* 斜め（既定）。鉛直な面（ボード）は低めから見たほうが放物線の形が分かる */
    if (built && built.plane === 'vertical') return { tgt: tgt, s: { r: r * 1.25, polar: 70 * DEG, azim: 35 * DEG }, fov: FOV };
    return { tgt: tgt, s: { r: r * 1.2, polar: 55 * DEG, azim: 28 * DEG }, fov: FOV };
  }

  function view(name, instant) {
    if (!camera) return;
    const to = target(name);
    if (instant) {
      controls.target.copy(to.tgt);
      camera.position.copy(fromSph(to.s, to.tgt));
      camera.fov = to.fov; camera.updateProjectionMatrix();
      controls.update();
      anim = null;
      return;
    }
    const from = { tgt: controls.target.clone(), s: sph(camera.position, controls.target), fov: camera.fov };
    /* 方位は近いほうへ回る */
    let da = to.s.azim - from.s.azim;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    anim = { t0: performance.now(), dur: 900, from: from, to: to, da: da };
  }

  function stepAnim(now) {
    if (!anim) return;
    let u = (now - anim.t0) / anim.dur;
    if (u >= 1) u = 1;
    const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;   // ゆっくり出てゆっくり止まる
    const f = anim.from, t = anim.to;
    const tg = f.tgt.clone().lerp(t.tgt, e);
    const s = { r: f.s.r + (t.s.r - f.s.r) * e,
                polar: f.s.polar + (t.s.polar - f.s.polar) * e,
                azim: f.s.azim + anim.da * e };
    controls.target.copy(tg);
    camera.position.copy(fromSph(s, tg));
    camera.fov = f.fov + (t.fov - f.fov) * e;
    camera.updateProjectionMatrix();
    if (u >= 1) anim = null;
  }

  /* ---------- 描画ループ（見えているあいだだけ回す） ---------- */
  function loop(now) {
    if (!running) return;
    stepAnim(now);
    controls.update();
    renderer.render(scene, camera);
    placeLabels();
    requestAnimationFrame(loop);
  }
  function start() {
    if (running) return;
    running = true;
    fit();
    requestAnimationFrame(loop);
  }
  function stop() { running = false; }

  function setLayers(l) { Object.assign(opts.layers, l); rebuild(); }
  function setZoom(z) { opts.dvZoom = z; rebuild(); }

  /** テスト・書き出し用：いま表示している中身 */
  function content() { return built && built.group; }

  /** AR の書き出し用：いまの中身・寸法・データ（動きを作るのに要る） */
  function exportInfo() { return built && built.ext ? { group: built.group, built: built, data: data, layers: opts.layers } : null; }

  HG.viewer = { attach, fit, setData, setLayers, setZoom, setNow, view, start, stop, exportInfo,
                rebuild, content, opts: opts,
                _internals: () => ({ renderer, scene, camera, controls, built }) };
})(window.HG = window.HG || {});
