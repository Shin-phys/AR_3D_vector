/* =====================================================================
   video/scanner.js — 全コマの実タイムスタンプ走査（第一パス）

   スマホの動画は「30fps」と表示されていても実際のコマ間隔は一定で
   ないこと（可変フレームレート、VFR）が多い。公称 fps から時刻を
   計算してはいけない。Δt が不揃いだと、等速運動なのに加速度が出る
   という致命的な誤りが生じる。

   第一パスでは座標と時刻だけを保存し、画像は保存しない
   （1000コマでも数十KB）。画像合成はフェーズ3の第二パスで行う。
   ===================================================================== */
(function (HG) {
  'use strict';

  function newFrame(index, t) {
    return { index: index, t: t, x: null, y: null, found: false, manual: false };
  }

  /** requestVideoFrameCallback で1回通し再生し、mediaTime を実測する */
  function scanRVFC(video, onProgress) {
    return new Promise(resolve => {
      const frames = [];
      let last = -1, idx = 0, done = false;
      const finish = () => {
        if (done) return;
        done = true;
        try { video.pause(); } catch (e) {}
        resolve(frames);
      };
      const cb = (now, meta) => {
        const t = (typeof meta.mediaTime === 'number') ? meta.mediaTime : video.currentTime;
        if (t > last + 1e-6) { frames.push(newFrame(idx++, t)); last = t; }
        if (video.duration) onProgress(t / video.duration);
        if (!video.ended && !done) video.requestVideoFrameCallback(cb);
        else finish();
      };
      video.addEventListener('ended', () => setTimeout(finish, 200), { once: true });
      video.currentTime = 0;
      video.playbackRate = 1;      // 早送りするとコマが落ちるので等倍で通す
      // play() より先に登録する。あとから登録すると 0 コマ目を取りこぼす
      video.requestVideoFrameCallback(cb);
      const p = video.play();
      if (p && p.catch) p.catch(finish);
      setTimeout(finish, 5 * 60 * 1000);
    });
  }

  /** rVFC が使えない環境向け：currentTime を細かく進める（精度は落ちる） */
  async function scanBySeek(video, onProgress) {
    const frames = [];
    const dt = 1 / 30, dur = video.duration || 0;
    let t = 0, i = 0;
    while (t < dur - 1e-3 && i < 3000) {
      await HG.frames.seekTo(t);
      frames.push(newFrame(i++, video.currentTime));
      onProgress(t / dur);
      t += dt;
    }
    return frames;
  }

  /**
   * 全コマを走査して state.frames を作る。
   * @returns {Promise<number>} 取得できたコマ数
   */
  async function scan(onProgress) {
    const video = HG.state.video.element;
    HG.ui.scanning = true;
    let frames = [];

    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
      HG.ui.timebase = 'rvfc';
      frames = await scanRVFC(video, onProgress);
    }
    if (frames.length < 2) {
      HG.ui.timebase = 'seek';
      frames = await scanBySeek(video, onProgress);
    }

    HG.state.frames = frames;
    HG.state.trim.inIndex = 0;
    HG.state.trim.outIndex = frames.length - 1;
    /* ここで入れる outIndex は「まだ決めていない」の初期値。
       生徒が決めたという記録は消す（ステップ1の ✓ が先に付かないように） */
    HG.state.trim.userSet = false;
    HG.state.tracking.verified = false;
    HG.ui.scanning = false;
    HG.bus.emit('frames:scanned', frames.length);
    return frames.length;
  }

  HG.scanner = { scan };
})(window.HG = window.HG || {});
