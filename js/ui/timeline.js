/* =====================================================================
   ui/timeline.js — タイムライン（コマ位置・トリム区間・打点済みコマ）

   打点済みのコマとまだ打っていないコマが一目で分かるようにしてある。
   ===================================================================== */
(function (HG) {
  'use strict';

  let tl = null, ctx = null, dragging = false;

  function attach(canvas) {
    tl = canvas;
    ctx = tl.getContext('2d');
    tl.addEventListener('pointerdown', e => { dragging = true; tl.setPointerCapture(e.pointerId); seek(e); });
    tl.addEventListener('pointermove', e => { if (dragging) seek(e); });
    tl.addEventListener('pointerup', () => { dragging = false; });
    tl.addEventListener('pointercancel', () => { dragging = false; });
  }

  /**
   * 棒に表示する範囲。
   *
   * ★ 全コマを端から端まで描かないこと。★
   * 338 コマの動画から 31 コマを切り出すと、区間は棒の幅の 9% に潰れて
   * 1ピクセル1コマ以下になる。t=0 を1コマ単位で決める作業には使えない
   * （実機のスクリーンショットで判明。生徒は結局 +10 ボタンを使っていた）。
   * 区間が決まったら、その前後に余裕を付けた窓だけを引き伸ばして描く。
   * 余裕があるので、決めたあとに端を少し伸ばす調整もできる。
   */
  function viewRange() {
    const fr = HG.state.frames, last = Math.max(0, fr.length - 1);
    const t = HG.state.trim;
    if (!t.userSet) return { lo: 0, hi: last };
    const out = (t.outIndex === null ? last : t.outIndex);
    const m = Math.max(5, Math.round((out - t.inIndex) * 0.5));
    return { lo: Math.max(0, t.inIndex - m), hi: Math.min(last, out + m) };
  }

  function seek(ev) {
    const r = tl.getBoundingClientRect();
    const g = viewRange();
    const p = (ev.clientX - r.left) / r.width;
    HG.frames.showFrame(Math.round(g.lo + Math.max(0, Math.min(1, p)) * (g.hi - g.lo)));
  }

  function draw() {
    if (!tl || !HG.state.frames.length) return;
    const cssW = tl.parentElement.clientWidth, cssH = 52;
    const d = Math.min(window.devicePixelRatio || 1, 2);
    if (tl.width !== Math.round(cssW * d)) {
      tl.width = Math.round(cssW * d);
      tl.height = Math.round(cssH * d);
      tl.style.width = cssW + 'px';
      tl.style.height = cssH + 'px';
    }
    const W = tl.width, H = tl.height;
    const N = HG.state.frames.length - 1 || 1;
    /* 「イン〜アウトだけを表示する」なら、タイムラインもその区間だけを引き伸ばす。
       端のコマを合わせ込みたいとき（単振り子など）に効く。 */
    const g = viewRange();
    const span = Math.max(1, g.hi - g.lo);
    const px = i => ((i - g.lo) / span) * (W - 4 * d) + 2 * d;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#e6e9ee';
    ctx.fillRect(0, H * 0.35, W, H * 0.30);

    const inI = HG.state.trim.inIndex;
    const outI = (HG.state.trim.outIndex === null ? N : HG.state.trim.outIndex);
    ctx.fillStyle = '#cfe2f8';
    ctx.fillRect(px(inI), H * 0.35, px(outI) - px(inI), H * 0.30);

    ctx.fillStyle = '#0b6bcb';
    [inI, outI].forEach(i => ctx.fillRect(px(i) - 2 * d, H * 0.22, 4 * d, H * 0.56));

    ctx.fillStyle = '#ff2d6f';
    for (const f of HG.state.frames) {
      if (!f.found) continue;
      ctx.fillRect(px(f.index) - 1.5 * d, H * 0.08, 3 * d, H * 0.22);
    }

    ctx.fillStyle = '#12161c';
    ctx.fillRect(px(HG.ui.current) - 1 * d, H * 0.14, 2 * d, H * 0.72);
    ctx.beginPath();
    ctx.arc(px(HG.ui.current), H * 0.90, 5 * d, 0, Math.PI * 2);
    ctx.fill();
  }

  HG.timeline = { attach, draw };
})(window.HG = window.HG || {});
