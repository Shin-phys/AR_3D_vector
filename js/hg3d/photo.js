/* =====================================================================
   hg3d/photo.js — 実物の写真（切り抜き）で球の代わりに描く

   ★ 既定は黄色・ピンクの球のまま。これは切り替え（「実物の写真で表示」）。★
   球のほうが、どの向きから見ても同じに見え、測った点がはっきりし、
   写真の出来（背景の混ざり・ブレ）に左右されない（2026-10-14 に決めた）。

   写真はそのコマの動画から、追跡した点のまわりを丸く切り抜く。
   置き方は「紙の面に沿った札」。カメラは1方向からしか撮っていないので、
   真横から見ると札は線になる（ごまかさない。球に戻せば点は消えない）。

   ★ AR（USDZ）に持ち込むための約束 ★
   - 両面の材質は USDZ に載らない → 表と裏の2枚を背中合わせにする
   - 半透明は並べ替えで崩れやすい → 切り抜きは alphaTest（しきい値で穴を開ける）
   - 横から光が当たると暗く沈む → 写真そのものを少し自分で光らせる（emissiveMap）
   ===================================================================== */
(function (HG) {
  'use strict';

  const SIZE = 128;            // 切り抜きの解像度（px）。札1枚あたり数 KB
  const cache = new Map();     // コマ番号 → {canvas, rpx}

  /** 動画のいまのコマ（offscreen）から、(cx, cy) のまわり半径 r を丸く切り抜く */
  function cropFrom(src, cx, cy, r) {
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const g = c.getContext('2d');
    g.save();
    g.beginPath(); g.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 1, 0, Math.PI * 2); g.clip();
    /* はみ出した矩形を drawImage に渡さない（2D の README の罠）。切ってから描く */
    const sx = cx - r, sy = cy - r, sw = 2 * r, sh = 2 * r;
    const ax = Math.max(0, sx), ay = Math.max(0, sy);
    const bx = Math.min(src.width, sx + sw), by = Math.min(src.height, sy + sh);
    if (bx > ax && by > ay) {
      const k = SIZE / sw;
      g.drawImage(src, ax, ay, bx - ax, by - ay, (ax - sx) * k, (ay - sy) * k, (bx - ax) * k, (by - ay) * k);
    }
    g.restore();
    return c;
  }

  /** 切り抜く半径（px）。シールの面積から。測れなければ画面の幅の 2.5% */
  function radiusAt(x, y) {
    let r = 0;
    try { const a = HG.tracker.measureAreaAt(x, y); if (a) r = Math.sqrt(a / Math.PI) * 1.7; } catch (e) { /* 測れない */ }
    return Math.max(10, r || HG.state.video.width * 0.025);
  }

  /**
   * 指定したコマの切り抜きを集める（コマを順に表示して描き写す。終わったら元のコマへ戻す）。
   * @param frames [{index, rawX, rawY}]
   */
  async function collect(frames, onProgress) {
    const back = HG.ui.current;
    let n = 0;
    for (const f of frames) {
      if (cache.has(f.index) || f.rawX === null || f.rawX === undefined) { n++; continue; }
      await HG.frames.showFrame(f.index);
      HG.frames.drawToOffscreen();
      const r = radiusAt(f.rawX, f.rawY);
      cache.set(f.index, { canvas: cropFrom(HG.frames.offscreen, f.rawX, f.rawY, r), rpx: r, at: { x: f.rawX, y: f.rawY },
                           corr: { dx: (f.x || f.rawX) - f.rawX, dy: (f.y || f.rawY) - f.rawY } });
      if (onProgress) onProgress(++n / frames.length);
    }
    await HG.frames.showFrame(back);
    return frames.map(f => cache.get(f.index)).filter(Boolean);
  }

  function clear() { cache.clear(); }
  function get(index) { return cache.get(index) || null; }

  /**
   * 札の向きと大きさ。紙の上で「画面の右」「画面の上」に当たる向きを軸にする。
   * こうすると切り抜きが、カメラから見えたとおりの向きで紙の面に貼られる。
   * @param ph  {at:{x,y}（画像上）, rpx}
   */
  function frameOf(ph) {
    const u = ph.at.x, v = ph.at.y, d = ph.rpx;
    /* 四隅と同じく、カメラぶれ補正後の座標で 3D に直す（追跡点と同じ道） */
    const dx = ph.corr ? ph.corr.dx : 0, dy = ph.corr ? ph.corr.dy : 0;
    const W = (a, b) => HG.recon.toWorld(a + dx, b + dy);
    const c = W(u, v), r = W(u + d, v), up = W(u, v - d);
    const sub = (p, q) => ({ x: p.x - q.x, y: p.y - q.y, z: p.z - q.z });
    const len = p => Math.hypot(p.x, p.y, p.z) || 1;
    const R = sub(r, c), U = sub(up, c);
    return { right: R, up: U, size: (len(R) + len(U)) / 2 };
  }

  /**
   * 札（表と裏の2枚）。中心 p、軸 right / up（長さ＝半径）。
   * 中心には小さな黒い点（測った点。矢印の根元）を残す。
   */
  function card(canvas, p, fr, opt) {
    const g = new THREE.Group();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({
      map: tex, alphaTest: 0.5, roughness: 0.8, metalness: 0,
      emissive: new THREE.Color('#ffffff'), emissiveMap: tex, emissiveIntensity: 0.55
    });
    const R = new THREE.Vector3(fr.right.x, fr.right.y, fr.right.z);
    const U = new THREE.Vector3(fr.up.x, fr.up.y, fr.up.z);
    const s = fr.size;
    R.normalize(); U.sub(R.clone().multiplyScalar(U.dot(R))).normalize();
    const N = new THREE.Vector3().crossVectors(R, U);
    const basis = new THREE.Matrix4().makeBasis(R, U, N);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(2 * s, 2 * s), mat);
    const backM = new THREE.Mesh(new THREE.PlaneGeometry(2 * s, 2 * s), mat);
    backM.rotation.y = Math.PI;              // 背中合わせ（両面の材質は USDZ に載らない）
    const inner = new THREE.Group();
    inner.add(front, backM);
    /* 「いま」の札には黄色の輪（ストロボの札と重なっても、どれが「いま」か分かるように） */
    if (opt && opt.ring) {
      const rm = HG.mesh.mat(opt.ring);
      const r1 = new THREE.Mesh(new THREE.RingGeometry(s * 0.92, s * 1.18, 32), rm);
      const r2 = new THREE.Mesh(new THREE.RingGeometry(s * 0.92, s * 1.18, 32), rm);
      r1.position.z = s * 0.02; r2.position.z = -s * 0.02; r2.rotation.y = Math.PI;
      inner.add(r1, r2);
    }
    if (!opt || opt.dot !== false) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(s * 0.12, 10, 8), HG.mesh.mat('#12161c'));
      inner.add(dot);
    }
    inner.quaternion.setFromRotationMatrix(basis);
    g.add(inner);
    g.position.set(p.x, p.y, p.z);
    g.userData.photo = true;
    return g;
  }

  HG.photo = { collect, clear, get, frameOf, card, cropFrom, SIZE };
})(window.HG = window.HG || {});
