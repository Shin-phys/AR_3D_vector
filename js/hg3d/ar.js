/* =====================================================================
   hg3d/ar.js — 3D の中身を AR 用のファイルにする（GLB / USDZ）と、開き方

   ARでは「回り込んで見る」ことだけをする（3D仕様.md §6）。
   アニメーションは入れない（端末間の互換性を優先）。

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
   * @param scale   1 = 実寸、0.2 = 机上サイズ（1/5）
   */
  function exportScene(content, scale) {
    const root = new THREE.Scene();
    const holder = new THREE.Group();
    const c = content.clone(true);
    holder.add(c);
    const box = new THREE.Box3().setFromObject(c);
    const ctr = box.getCenter(new THREE.Vector3());
    c.position.sub(new THREE.Vector3(ctr.x, box.min.y, ctr.z));
    holder.scale.setScalar(scale || 1);
    root.add(holder);
    root.updateMatrixWorld(true);
    return root;
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
  function openQuickLook(url) {
    const a = document.createElement('a');
    a.rel = 'ar';
    a.href = url + (url.indexOf('#') < 0 ? '#allowsContentScaling=0' : '');
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
    if (opts && opts.usdzUrl) mv.setAttribute('ios-src', opts.usdzUrl);
    else mv.removeAttribute('ios-src');
    mv.setAttribute('src', glbUrl);
    return mv;
  }

  HG.ar = { exportScene, toGLB, toUSDZ, quickLookSupported, webxrSupported,
            openQuickLook, openSceneViewer, loadModelViewer, modelViewer };
})(window.HG = window.HG || {});
