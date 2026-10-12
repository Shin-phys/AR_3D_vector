/* =====================================================================
   video/loader.js — 動画ファイルの受け取りとメタデータ確定

   サーバー送信は一切しない。ブラウザ内で完結する。
   ===================================================================== */
(function (HG) {
  'use strict';

  /**
   * @returns {Promise<{ok:boolean, reason?:string}>}
   *   reason: 'decode'（開けない） / 'draw'（HEVC 等で画像化できない）
   *           / 'taint'（file:// で画素が読めない）
   */
  async function load(file, videoEl) {
    /* 同梱のお手本動画は URL 文字列で渡す。file:// でも <video src> なら開ける
       （fetch は file:// で弾かれるので使わないこと）。 */
    videoEl.playsInline = true;
    videoEl.muted = true;
    /* 'auto' にすると読み込んだ時点で全部を抱え込もうとする。
       iPhone のスロー撮影は数百 MB になることがあり、タブごと落ちる。
       走査のときにどのみち通しで再生するので、ここでは metadata で足りる。 */
    videoEl.preload = 'metadata';

    /* ハンドラを先に付けてから src を入れる。逆にすると、
       読み込みの速い素材（同梱のお手本動画）で loadedmetadata を
       取りこぼし、タイムアウトまで固まることがある。 */
    const ready = new Promise((res, rej) => {
      videoEl.onloadedmetadata = res;
      videoEl.onerror = () => rej(new Error('decode'));
      /* 大きなファイルはメタデータが出るまで時間が掛かる */
      setTimeout(() => rej(new Error('timeout')), 60000);
    });
    videoEl.src = (typeof file === 'string') ? file : URL.createObjectURL(file);

    try {
      await ready;
    } catch (e) {
      return { ok: false, reason: 'decode' };
    }

    HG.state.video.element = videoEl;
    HG.state.video.duration = videoEl.duration || 0;
    HG.state.video.rotation = 0;
    HG.frames.setVideoSize();

    // 回転メタデータ：多くのブラウザは videoWidth/Height に反映済みだが、
    // 横倒しになる端末があるので手動で回せるようにしてある（frames.rotate90）。
    const t = await HG.frames.testDraw();
    if (t !== 'ok') return { ok: false, reason: t };

    HG.bus.emit('video:loaded');
    return { ok: true };
  }

  HG.loader = { load };
})(window.HG = window.HG || {});
