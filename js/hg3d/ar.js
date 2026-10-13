/* =====================================================================
   hg3d/ar.js — 3D の中身を AR 用のファイルにする（GLB / USDZ）と、開き方

   ARでは「回り込んで見る」（3D仕様.md §6）。
   ★ 仕様書は「アニメーションを入れない」だったが、2026-10-13 に変えた。★
   実機で「奥の壁の影は、静止画だと何を読み取るかが人それぞれ」と分かったため。
   動くのは「いま」の球と影だけ（下の「動き」の節）。速さは書き出すときに決める。

   開き方は端末で3通りある。どれが通るかは ar-test.html で実機で確かめる。
     iPhone  … <a rel="ar" href="〜.usdz"><img></a> を押す（AR Quick Look）
     Android … model-viewer の WebXR（その場で作ったファイルでも開ける）
               Scene Viewer は公開 URL が要る（blob URL は渡せない）
     共通    … model-viewer に GLB を渡す（iPhone では model-viewer が USDZ に変換）

   ★ 確かめたいこと（3D仕様.md §6「ここを最初に試すこと」）★
   iOS の AR Quick Look に、その場で作ったモデル（blob URL）を渡せるか。
   歴史的に実ファイルを求めてきた経緯がある。通らなければ、書き出した
   USDZ を一度保存させるなどの別の道を考える。
   ===================================================================== */
(function (HG) {
  'use strict';

  /**
   * 書き出し用の場面を作る。AR はモデルの原点を床（机）に置くので、
   * 中身の底を y = 0、真ん中を x = z = 0 に寄せる。
   * @param content THREE.Object3D（ビューアが表示しているもの）
   * @param scale   1 = 実寸。机上サイズは deskScale() で決める
   * @param extra   中身と同じ座標で足すもの（動く「いま」の球と影）。寄せる量は中身だけで決める
   */
  function exportScene(content, scale, extra) {
    const root = new THREE.Scene();
    const holder = new THREE.Group();
    const c = content.clone(true);
    const box = new THREE.Box3().setFromObject(c);
    const ctr = box.getCenter(new THREE.Vector3());
    if (extra) c.add(extra);
    holder.add(c);
    c.position.sub(new THREE.Vector3(ctr.x, box.min.y, ctr.z));
    holder.scale.setScalar(scale || 1);
    root.add(holder);
    root.updateMatrixWorld(true);
    return root;
  }

  /**
   * 机上サイズの倍率。**中身の横の広がりが約 45 cm になる倍率**（0.1〜4 倍）。
   * 以前は一律 1/5 だったが、ターンテーブル（実寸で 60 cm ほど）では 12 cm になり
   * 「小さめ」と言われた（実機）。投射のように数 m ある運動では、これが 1/5 前後になる。
   */
  function deskScale(content) {
    const b = new THREE.Box3().setFromObject(content);
    const w = Math.max(b.max.x - b.min.x, b.max.z - b.min.z, 0.05);
    const k = Math.max(0.1, Math.min(4, 0.45 / w));
    return Math.round(k * 20) / 20;           // 0.05 刻み（表示を読みやすく）
  }

  /* ---------- 動き（「いま」の球と影が測った軌跡をたどる） ----------
     3D仕様.md §6 は「AR にアニメーションを入れない」だったが、実機で
     「静止画では何を認識するかが人それぞれ」「AR で動けばはっきりする」と分かり、
     入れることにした（2026-10-13）。速さは書き出すときに決める
     （Quick Look には再生速度のつまみが無いので、時間軸ごと伸ばして書き出す）。

     動くのは content.makeNow() の部品だけ。測った点を順にたどる（間は直線でつなぐ）。
     当てはめた曲線で動かさない。 */

  /** 各コマでの各部品の行列（親＝「いま」のグループから見た行列） */
  function sampleAnim(now, trackAll, stage, speed) {
    const t0 = trackAll[0].t;
    const frames = trackAll.map(p => {
      HG.content.placeNow(now, p, stage);
      return now.parts.map(m => m.matrix.clone());
    });
    HG.content.placeNow(now, trackAll[0], stage);
    return { times: trackAll.map(p => (p.t - t0) / (speed || 1)), frames: frames };
  }

  const TCPS = 60;      // USD の timeCodesPerSecond

  /** USDZ に動きを書き足す（エクスポーターは動きを書かないので、出てきた model.usda を直す） */
  function addUsdAnimation(buf, now, anim) {
    const F = THREE.fflate;
    const files = F.unzipSync(new Uint8Array(buf));
    let usda = F.strFromU8(files['model.usda']);
    const tc = anim.times.map(t => Math.round(t * TCPS * 1000) / 1000);
    const row = (e, o) => '(' + e[o] + ', ' + e[o + 1] + ', ' + e[o + 2] + ', ' + e[o + 3] + ')';
    const mat = m => { const e = m.elements; return '( ' + row(e, 0) + ', ' + row(e, 4) + ', ' + row(e, 8) + ', ' + row(e, 12) + ' )'; };
    now.parts.forEach((m, j) => {
      const at = usda.indexOf('def Xform "' + m.name + '"');
      if (at < 0) throw new Error('USDZ の中に ' + m.name + ' が見つかりません');
      const k = usda.indexOf('matrix4d xformOp:transform = ', at);
      const end = usda.indexOf('\n', k);
      const samples = tc.map((c, i) => c + ': ' + mat(anim.frames[i][j])).join(', ');
      usda = usda.slice(0, k) + 'matrix4d xformOp:transform.timeSamples = { ' + samples + ' }' + usda.slice(end);
    });
    /* 再生する範囲（層のメタデータ） */
    usda = usda.replace('upAxis = "Y"', 'upAxis = "Y"\n\tstartTimeCode = 0\n\tendTimeCode = ' +
      tc[tc.length - 1] + '\n\ttimeCodesPerSecond = ' + TCPS);
    files['model.usda'] = F.strToU8(usda);
    /* 64 バイト境界にそろえて詰め直す（USDZExporter と同じ手順。model.usda を先頭に） */
    const order = ['model.usda'].concat(Object.keys(files).filter(f => f !== 'model.usda'));
    const out = {};
    let offset = 0;
    order.forEach(name => {
      const file = files[name];
      offset += 34 + name.length;
      const mod = offset & 63;
      out[name] = mod !== 4 ? [file, { extra: { 12345: new Uint8Array(64 - mod) } }] : file;
      offset = file.length;
    });
    return F.zipSync(out, { level: 0 });
  }

  /** GLB 用の動き（AnimationClip）。model-viewer が autoplay で回す */
  function glbClip(now, anim) {
    const tracks = [];
    now.parts.forEach((m, j) => {
      const P = [], Q = [], S = [];
      anim.frames.forEach(f => {
        const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
        f[j].decompose(p, q, s);
        P.push(p.x, p.y, p.z); Q.push(q.x, q.y, q.z, q.w); S.push(s.x, s.y, s.z);
      });
      tracks.push(new THREE.VectorKeyframeTrack(m.name + '.position', anim.times, P));
      tracks.push(new THREE.QuaternionKeyframeTrack(m.name + '.quaternion', anim.times, Q));
      tracks.push(new THREE.VectorKeyframeTrack(m.name + '.scale', anim.times, S));
    });
    return new THREE.AnimationClip('いま', anim.times[anim.times.length - 1], tracks);
  }

  /**
   * ビューアの表示から、AR 用のファイルを作る。
   * @param info   HG.viewer.exportInfo()
   * @param opt    {scale, speed（0 なら動きなし）, kind:'usdz'|'glb'}
   */
  async function fromViewer(info, opt) {
    const all = info.data.trackAll || [];
    const moving = opt.speed > 0 && all.length > 1;
    const now = moving ? HG.content.makeNow(info.built, info.layers) : null;
    if (now) HG.content.placeNow(now, all[0], info.built.stage);
    const sc = exportScene(info.group, opt.scale, now ? now.group : null);
    const anim = now ? sampleAnim(now, all, info.built.stage, opt.speed) : null;
    if (opt.kind === 'glb') {
      const ex = new THREE.GLTFExporter();
      const buf = await ex.parseAsync(sc, { binary: true, onlyVisible: true, animations: anim ? [glbClip(now, anim)] : [] });
      return { blob: new Blob([buf], { type: 'model/gltf-binary' }), seconds: anim ? anim.times[anim.times.length - 1] : 0 };
    }
    const ex = new THREE.USDZExporter();
    let buf = await ex.parseAsync(sc, { quickLookCompatible: true });
    if (anim) buf = addUsdAnimation(buf, now, anim);
    return { blob: new Blob([buf], { type: 'model/vnd.usdz+zip' }), seconds: anim ? anim.times[anim.times.length - 1] : 0 };
  }

  async function toGLB(scene) {
    const ex = new THREE.GLTFExporter();
    const buf = await ex.parseAsync(scene, { binary: true, onlyVisible: true });
    return new Blob([buf], { type: 'model/gltf-binary' });
  }

  async function toUSDZ(scene) {
    const ex = new THREE.USDZExporter();
    const buf = await ex.parseAsync(scene, { quickLookCompatible: true });
    return new Blob([buf], { type: 'model/vnd.usdz+zip' });
  }

  /** iPhone / iPad の AR Quick Look が使えるか（Safari が教えてくれる） */
  function quickLookSupported() {
    const a = document.createElement('a');
    return !!(a.relList && a.relList.supports && a.relList.supports('ar'));
  }

  /** Android Chrome の WebXR（immersive-ar）が使えるか */
  async function webxrSupported() {
    try {
      return !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar'));
    } catch (e) { return false; }
  }

  /**
   * AR Quick Look で開く。
   * ★ <a> の子に <img> が要る。★ 無いと Safari は AR ではなく
   * ファイルのダウンロード（または別画面のプレビュー）として扱う。
   */
  function openQuickLook(url, allowScaling) {
    const a = document.createElement('a');
    a.rel = 'ar';
    /* 実寸のときは指で拡大縮小させない（寸法の意味が消える）。机上サイズは許す */
    a.href = url + (url.indexOf('#') < 0 ? '#allowsContentScaling=' + (allowScaling ? 1 : 0) : '');
    const img = document.createElement('img');
    img.alt = '';
    img.width = 1; img.height = 1;
    a.appendChild(img);
    a.style.position = 'absolute'; a.style.left = '-9999px';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 4000);
  }

  /** Android の Scene Viewer で開く（公開 URL が要る。blob URL は不可） */
  function openSceneViewer(absUrl, title) {
    const fallback = location.href;
    const intent = 'intent://arvr.google.com/scene-viewer/1.2?file=' + encodeURIComponent(absUrl) +
      '&mode=ar_preferred&resizable=false' + (title ? '&title=' + encodeURIComponent(title) : '') +
      '#Intent;scheme=https;package=com.google.android.googlequicksearchbox;' +
      'action=android.intent.action.VIEW;S.browser_fallback_url=' + encodeURIComponent(fallback) + ';end;';
    location.href = intent;
  }

  /* ---------- model-viewer（必要になったときだけ読む。1 MB あるため） ---------- */
  let mvLoading = null;
  function loadModelViewer(base) {
    if (window.customElements && customElements.get('model-viewer')) return Promise.resolve();
    if (mvLoading) return mvLoading;
    mvLoading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = (base || '') + 'vendor/model-viewer-umd.min.js';
      s.onload = () => res();
      s.onerror = () => { mvLoading = null; rej(new Error('model-viewer を読み込めませんでした')); };
      document.head.appendChild(s);
    });
    return mvLoading;
  }

  /**
   * model-viewer を host の中に作る（無ければ）。src を差し替えて返す。
   * ar-modes は 3D仕様.md §6 のとおり。
   */
  async function modelViewer(host, glbUrl, opts) {
    await loadModelViewer(opts && opts.base);
    let mv = host.querySelector('model-viewer');
    if (!mv) {
      mv = document.createElement('model-viewer');
      mv.setAttribute('ar', '');
      mv.setAttribute('ar-modes', 'webxr scene-viewer quick-look');
      mv.setAttribute('ar-scale', 'fixed');          // 実寸／机上サイズはこちらで決める
      mv.setAttribute('camera-controls', '');
      mv.setAttribute('shadow-intensity', '0.6');
      mv.style.width = '100%';
      mv.style.height = (opts && opts.height) || '320px';
      mv.style.background = '#f6f7f9';
      host.appendChild(mv);
    }
    if (opts && opts.autoplay) mv.setAttribute('autoplay', ''); else mv.removeAttribute('autoplay');
    if (opts && opts.usdzUrl) mv.setAttribute('ios-src', opts.usdzUrl);
    else mv.removeAttribute('ios-src');
    mv.setAttribute('src', glbUrl);
    return mv;
  }

  HG.ar = { exportScene, deskScale, fromViewer, addUsdAnimation, toGLB, toUSDZ, quickLookSupported, webxrSupported,
            openQuickLook, openSceneViewer, loadModelViewer, modelViewer };
})(window.HG = window.HG || {});
