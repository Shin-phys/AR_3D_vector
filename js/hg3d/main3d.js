/* =====================================================================
   hg3d/main3d.js — 3d.html の起動と、イベント → 再描画の配線

   2D の main.js と同じ役割。前半（読み込み・走査・トリム・追跡・使うコマ）は
   共有モジュールをそのまま呼ぶ。ストロボ画像・作図・ホドグラフは無い。
   「誰がいつ再描画するか」はここだけを見れば分かるようにしてある。
   ===================================================================== */
(function (HG) {
  'use strict';

  const $ = HG.$;

  function refresh() {
    HG.stage.render();
    HG.timeline.draw();
    HG.controls.updateLabels();
  }
  HG.refresh = refresh;

  function say(msg, cls) {
    HG.dom.html('#loadState', cls ? '<span class="' + cls + '">' + msg + '</span>' : msg);
  }

  /* ---------- 運動のタイル（3D のプリセット） ---------- */
  function renderTiles() {
    HG.dom.html('#tiles', HG.presets3d.list.map(p =>
      '<button class="tile" data-id="' + p.id + '"' + (p.soon ? ' disabled' : '') + '>' +
        '<span class="tile-name">' + p.name + (p.soon ? '<span class="soon">準備中</span>' : '') + '</span>' +
        '<span class="tile-sub">' + (p.sub || '') + '</span>' +
      '</button>').join(''));
  }

  function choose(id) {
    const p = HG.presets3d.byId(id);
    if (!p || p.soon) return;
    HG.state.preset = p;
    const t = HG.state.tracking;
    t.target = { h: p.hue, s: 0.6, v: 0.6 };
    t.markerStart = null;
    if (p.count) HG.state.selection.count = p.count;
    $('#selCount').value = HG.state.selection.count;
    /* 紙を置いた面。自由測定は生徒が選ぶ（いまの選択のまま） */
    if (p.plane) HG.corners.setPlane(p.plane);
    else if (HG.recon.state.plane === 'stereo') HG.corners.setPlane('horizontal');
    /* 2台のカメラ（ステレオ）は画面の流れごと変わる（stereo-ui.js） */
    HG.stereo.activate(p.plane === 'stereo');
    HG.panel3d.reset();
    /* preset.note（解説）はここでは出さない。shootTips だけ */
    HG.dom.html('#presetNote', '<div class="lead">' + p.name + '</div>' +
      '<div class="sub spaced-sm">' + (p.shootTips || []).map(s => '<div class="spaced-sm">' + s + '</div>').join('') + '</div>');
    /* 2台のお手本は大きいので、押したときに読み込む（まだ無くてもボタンは出す） */
    const smp = sample(p) || (p.plane === 'stereo' && p.sampleKey);
    $('#sampleRow').classList.toggle('hide', !smp);
    if (smp) HG.dom.html('#sampleBtn', 'お手本を試す' + (p.sampleNote ? '<span class="sub"> ' + p.sampleNote + '</span>' : ''));
    HG.dom.hide('#screen0'); HG.dom.show('#screen1'); HG.dom.show('#goHome');
    window.scrollTo(0, 0);
  }

  /**
   * お手本動画（data: URI）。iPhone の Safari は WebM を読めないことがあるので
   * MP4（H.264）を先に試す。headless の Chromium は H.264 を持たないので WebM。
   */
  function sample(p) {
    const key = (HG.stereo.active() && p.sampleKey) ? HG.stereo.sampleKey() : p.sampleKey;
    const s = HG.samples3d && key && HG.samples3d[key];
    if (!s) return null;
    const v = document.createElement('video');
    if (s.mp4 && v.canPlayType('video/mp4; codecs="avc1.42E01E"')) return s.mp4;
    return s.webm || s.mp4 || null;
  }

  /* ---------- 動画の受け取り（2D の main.js と同じ流れ） ---------- */
  function wireUpload() {
    const drop = $('#drop');
    $('#pick').onclick = () => $('#file').click();
    $('#file').onchange = e => { if (e.target.files[0]) start(e.target.files[0]); };
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('hot'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('hot'); }));
    drop.addEventListener('drop', e => { const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) start(f); });
    $('#sampleBtn').onclick = async () => {
      const p = HG.state.preset;
      if (HG.stereo.active() && !(HG.samples3d && HG.samples3d.stereo1)) {
        say('お手本を読み込んでいます…');
        try { await loadScript('js/hg3d/samples3d-stereo.js'); } catch (e) { say('お手本を読み込めませんでした。', 'warn'); return; }
      }
      const s = sample(p);
      if (!s) return;
      /* お手本は答えの寸法の紙で撮ってある */
      if (p.samplePaper) HG.corners.setPaperBy(p.samplePaper);
      start(s);
    };
    $('#goHome').onclick = () => {
      const dirty = HG.state.frames.length > 0;
      if ((dirty || (HG.stereo.active() && HG.stereo.camNo() === 2)) &&
          !confirm('最初の画面（運動を選ぶ）に戻ります。\n読み込んだ動画と、追跡・四隅の結果は消えます。よろしいですか？')) return;
      location.reload();
    };
    $('#tiles').onclick = e => { const el = e.target.closest('[data-id]'); if (el) choose(el.dataset.id); };
    $('#backToTiles').onclick = () => {
      HG.dom.show('#screen0'); HG.dom.hide('#screen1'); HG.dom.hide('#goHome');
      window.scrollTo(0, 0);
    };
  }

  /** スクリプトをあとから読む（2台のお手本。file:// でも <script src> なら読める） */
  function loadScript(src) {
    return new Promise((res, rej) => {
      const el = document.createElement('script');
      el.src = src; el.onload = res; el.onerror = () => rej(new Error(src));
      document.head.appendChild(el);
    });
  }

  async function start(file) {
    const vid = $('#vid');
    say('読み込み中…');
    /* ステレオ：手拍子を探すため、音も読む（待たない。走査と並行して進む） */
    if (HG.stereo.active()) HG.stereo.onLoad(file);
    HG.dom.show('#vid'); HG.dom.hide('#cv');
    const res = await HG.loader.load(file, vid);
    if (!res.ok) {
      const pr = HG.state.video.probe;
      const detail = pr && pr.log && pr.log.length
        ? '<br><span class="mono sub">調べた結果：' + pr.log.join(' ／ ') + '</span>' : '';
      const msg =
        res.reason === 'taint' ? 'この開き方（file://）では、この動画の画素を読み取れません。「動画を選ぶ」から読み込むか、GitHub Pages などサーバー経由で開いてください。'
        : res.reason === 'black' ? '動画は開けましたが、調べた3か所がどれも真っ黒でした。明るいところが写っている部分を含めて撮り直すと通ります。'
        : res.reason === 'draw' ? '動画は開けましたが、コマを画像として取り出せませんでした。ページを再読み込みしてもう一度お試しください。'
        : 'この動画を開けませんでした。ファイルが大きすぎるか、対応していない形式の可能性があります。';
      say(msg + detail, 'warn');
      return;
    }
    HG.wakelock.request();
    const bar = $('#scanBar');
    HG.dom.show('#scanBar');
    say('コマの実時刻を記録しています…（動画を1回通しで再生します）');
    const n = await HG.scanner.scan(p => {
      bar.firstElementChild.style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%';
    });
    HG.dom.hide('#scanBar');
    if (n < 2) { say('コマを取得できませんでした。別の動画で試してください。', 'warn'); return; }
    vid.pause();
    HG.dom.hide('#vid'); HG.dom.show('#cv');
    HG.dom.hide('#screen1'); HG.dom.show('#screen2');
    HG.frames.showFrame(0);
    window.scrollTo(0, 0);
  }

  /* ---------- 配線 ---------- */
  function boot() {
    HG.stage.attach($('#cv'));
    HG.loupe.attach($('#loupe'));
    HG.timeline.attach($('#tl'));
    HG.pointer.attach($('#cv'));
    /* painter の登録順＝描く順 */
    HG.stage.register(HG.selection.drawPreview);
    HG.stage.register(HG.overlay.drawPoints);
    HG.stage.register(HG.overlay.drawMarker);
    HG.stage.register(HG.corners.paint);            // 紙の四隅
    HG.stage.register(HG.stereo.paint);             // 2台のカメラの基準（6点と描き戻した L字）
    HG.stage.register(HG.trackControls.paintAim);   // 色・マーカーの照準（最前面）
    HG.controls.attach();
    HG.trackControls.attach();
    HG.selection.attach();
    HG.steps.attach();
    HG.corners.attach();
    HG.stereo.attach();
    HG.panel3d.attach();
    renderTiles();
    wireUpload();

    HG.bus.on('frame:changed', refresh);
    HG.bus.on('points:changed', () => {
      refresh();
      if (HG.points.list().length) $('#hint').classList.add('fade');
    });
    HG.bus.on('view:changed', refresh);
    HG.bus.on('trim:changed', () => { refresh(); HG.diagnostics.render(); });
    HG.bus.on('frames:scanned', () => HG.diagnostics.render());

    let rz;
    window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(refresh, 150); });
    window.addEventListener('orientationchange', () => setTimeout(refresh, 300));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.HG = window.HG || {});
