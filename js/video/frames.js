/* =====================================================================
   video/frames.js — 1コマの取り出し（シーク・回転補正・オフスクリーン描画）

   ここが「動画 → 1枚の画像」の唯一の入口。フェーズ2の色追跡も
   フェーズ3の背景差分も、この offscreen キャンバスの画素を読む。
   ===================================================================== */
(function (HG) {
  'use strict';

  const offscreen = document.createElement('canvas');
  const octx = offscreen.getContext('2d', { willReadFrequently: true });
  let seekToken = 0;

  function video() { return HG.state.video.element; }

  /** 回転を考慮して「元解像度」を決め直す */
  function setVideoSize() {
    const v = video();
    const vw = v.videoWidth, vh = v.videoHeight;
    const r = HG.state.video.rotation;
    HG.state.video.width = (r % 180 === 0) ? vw : vh;
    HG.state.video.height = (r % 180 === 0) ? vh : vw;
    offscreen.width = HG.state.video.width;
    offscreen.height = HG.state.video.height;
  }

  /**
   * 指定時刻へシークする。
   * @param {number} t 秒
   * @param {number} [timeout] ミリ秒。大きな動画（iPhone のスロー撮影など）は
   *   シークに時間が掛かるので、読み込み判定のときだけ長くする。
   *
   * 以前はタイムアウトで res() を呼ぶだけで seeked のリスナを外していなかった。
   * 大きなファイルでタイムアウトが先に来ると、シークが終わっていないコマを
   * そのまま描いてしまい、真っ黒の画像になっていた。
   */
  function seekTo(t, timeout) {
    const v = video();
    return new Promise(res => {
      if (Math.abs(v.currentTime - t) < 1e-6) { res(); return; }
      let done = false;
      const fin = () => {
        if (done) return;
        done = true;
        v.removeEventListener('seeked', h);
        res();
      };
      const h = () => fin();
      v.addEventListener('seeked', h);
      v.currentTime = t;
      setTimeout(fin, timeout || 2500);
    });
  }

  /**
   * シーク後、実際にコマが「描ける状態」になるまで待つ。
   *
   * iOS Safari では seeked が来た時点ではまだデコードが終わっておらず、
   * すぐ drawImage すると真っ黒になる。requestVideoFrameCallback は
   * コマが実際に提示されたときに呼ばれるので、それを待つ。
   */
  function framePainted() {
    const v = video();
    return new Promise(res => {
      let done = false;
      const fin = () => { if (!done) { done = true; res(); } };
      if (typeof v.requestVideoFrameCallback === 'function') {
        v.requestVideoFrameCallback(fin);
        setTimeout(fin, 500);
      } else {
        requestAnimationFrame(() => requestAnimationFrame(fin));
      }
    });
  }

  /** 現在の再生位置のコマを、回転補正して offscreen に描く */
  function drawToOffscreen() {
    const v = video();
    const r = HG.state.video.rotation, vw = v.videoWidth, vh = v.videoHeight;
    octx.save();
    octx.clearRect(0, 0, offscreen.width, offscreen.height);
    if (r === 90)       { octx.translate(offscreen.width, 0);  octx.rotate(Math.PI / 2); }
    else if (r === 180) { octx.translate(offscreen.width, offscreen.height); octx.rotate(Math.PI); }
    else if (r === 270) { octx.translate(0, offscreen.height); octx.rotate(-Math.PI / 2); }
    octx.drawImage(v, 0, 0, vw, vh);
    octx.restore();
  }

  /* --- 読み込み判定のための小さな検査キャンバス --- */
  const PROBE = 48;
  const probeCv = document.createElement('canvas');
  probeCv.width = PROBE; probeCv.height = PROBE;
  const pctx = probeCv.getContext('2d', { willReadFrequently: true });

  /**
   * いま offscreen にある絵を縮小して調べる。
   *
   * ★ 先にマゼンタで塗りつぶしてから重ねる ★
   * 「何も描かれなかった」と「真っ黒なコマが描かれた」は、
   * 黒を数えるだけでは区別できない。下地を置いておけば、
   * 残っていれば前者、消えていれば後者と分かる。
   * この2つは原因も対処もまったく違う（デコードできないのか、
   * ただ暗い場面なのか）ので、混ぜてはいけない。
   *
   * @returns {{mean:number, max:number, base:number}}
   *   mean … 明るさの平均（0〜765）
   *   max  … いちばん明るい画素
   *   base … 下地が残っている割合（1 に近い＝1枚も描けていない）
   * @throws SecurityError  canvas が汚染されているとき
   */
  function probeFrame() {
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.fillStyle = '#ff00ff';
    pctx.fillRect(0, 0, PROBE, PROBE);
    pctx.drawImage(offscreen, 0, 0, PROBE, PROBE);
    const d = pctx.getImageData(0, 0, PROBE, PROBE).data;   // 汚染時はここで例外
    const n = PROBE * PROBE;
    let sum = 0, max = 0, base = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], bl = d[i + 2];
      const v = r + g + bl;
      sum += v;
      if (v > max) max = v;
      if (r > 240 && g < 16 && bl > 240) base++;
    }
    return { mean: sum / n, max: max, base: base / n };
  }

  /**
   * コマを取り出せるかを確かめる。
   * @returns {Promise<'ok'|'draw'|'black'|'taint'>}
   *   'draw'  … 1枚も描けない（デコードできていない）
   *   'black' … 描けてはいるが、調べた場所がどれも真っ黒
   *   'taint' … canvas が汚染されて画素を読めない（file:// のとき）
   *
   * 以前は「先頭 0.1 秒の左上 64×64 の合計が 0 なら失敗」という判定だった。
   * これが iPhone で誤判定する。理由は3つ。
   *   ・左上の隅だけを見ている（暗い壁や天井、レターボックスの黒帯で 0 になる）
   *   ・1か所しか見ていない（iPhone の動画は先頭が暗いことが多い）
   *   ・シーク直後に描いている（iOS はまだコマを用意できておらず黒が返る）
   * いまは「全体を縮小して」「3か所で」「コマが提示されるのを待ってから」見る。
   */
  async function testDraw() {
    const v = video();
    const dur = v.duration || 1;
    const spots = [0.10, 0.35, 0.60].map(r => Math.min(Math.max(dur * r, 0), Math.max(0, dur - 0.05)));
    const log = [];
    let best = null, tainted = false;

    for (const t of spots) {
      try {
        await seekTo(t, 8000);      // 大きなスロー動画はシークが遅い
        await framePainted();
        drawToOffscreen();
      } catch (e) { log.push(t.toFixed(2) + 's:seek失敗'); continue; }

      let r;
      try { r = probeFrame(); }
      catch (e) {
        if (e && e.name === 'SecurityError') { tainted = true; break; }
        log.push(t.toFixed(2) + 's:読み取り失敗'); continue;
      }
      log.push(t.toFixed(2) + 's:明るさ' + r.mean.toFixed(0) + '/下地' + Math.round(r.base * 100) + '%');
      if (!best || r.mean > best.mean) best = r;
      /* 下地が消えていて（＝実際に描けた）、真っ黒ではない */
      if (r.base < 0.5 && r.max > 8) { HG.state.video.probe = { best: r, log: log }; return 'ok'; }
    }

    HG.state.video.probe = { best: best, log: log };
    if (tainted) return 'taint';
    if (best && best.base < 0.5) return 'black';   // 描けてはいる
    return 'draw';
  }

  /** i 番目のコマを表示する（シーク完了後に frame:changed を発火） */
  async function showFrame(i) {
    const fr = HG.state.frames;
    if (!fr.length) return;
    /* 「イン〜アウトだけを表示する」が入っていれば、コマ送りは区間の外へ出ない。
       トリムしたあとに端まで戻ってしまうのを防ぐ。 */
    const r = HG.frames.range();
    i = Math.max(r.lo, Math.min(r.hi, i));
    HG.ui.current = i;
    const f = fr[i], nx = fr[i + 1];
    // コマの内側に確実に着地させるため、わずかに後ろへずらしてシークする
    const eps = nx ? Math.min(0.004, (nx.t - f.t) * 0.4) : 0.004;
    const my = ++seekToken;
    await seekTo(f.t + eps);
    if (my !== seekToken) return;   // 追い越されたら描かない
    HG.bus.emit('frame:changed', i);
  }

  function rotate90() {
    const old = { w: HG.state.video.width, h: HG.state.video.height };
    HG.state.video.rotation = (HG.state.video.rotation + 90) % 360;
    setVideoSize();
    HG.points.rotate90(old.w, old.h);
    HG.bus.emit('view:changed');
  }

  /**
   * コマ送りやタイムラインが動ける範囲。
   * HG.ui.limitToTrim が立っていればイン点〜アウト点、そうでなければ全体。
   */
  function range() {
    const fr = HG.state.frames;
    const last = Math.max(0, fr.length - 1);
    if (!HG.ui.limitToTrim) return { lo: 0, hi: last };
    const out = (HG.state.trim.outIndex === null ? last : HG.state.trim.outIndex);
    return { lo: HG.state.trim.inIndex, hi: Math.max(HG.state.trim.inIndex, out) };
  }

  HG.frames = { offscreen, setVideoSize, seekTo, drawToOffscreen, testDraw, showFrame, rotate90, range };
})(window.HG = window.HG || {});
