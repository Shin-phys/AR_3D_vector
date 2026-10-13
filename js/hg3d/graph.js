/* =====================================================================
   hg3d/graph.js — 壁の影の横の位置を、時刻に対して描く（3D仕様.md §5「射影（核）」）

   ★ 曲線を当てはめないこと。★ 正弦波を重ねれば「単振動です」と言えるが、
   それは答えを仮定して答えを見せることになる（3D仕様.md §4「モデルを当てはめない」）。
   描くのは測った点と、それを順に結んだ細い線だけ。形を読むのは生徒。

   点は区間内の全コマ（小さい点）と、使うコマ（輪）。使うコマはストロボの球と同じ点。
   グラフを指でなぞると、3D の「いま」の球が動く（時刻スライダーと同じ）。
   ===================================================================== */
(function (HG) {
  'use strict';

  let cv = null, ctx = null, onScrub = null, last = null;
  /* どの影の、どの座標を描くか。面の向きで変わる（動いて見える座標を描く）。
     机の上の運動：奥の壁の影は x、横の壁の影は z（どちらも水平）
     ボードの運動：床の影は x（水平）、横の壁の影は y（鉛直） */
  const SERIES_BY_PLANE = {
    horizontal: {
      back: { key: 'x', color: '#12161c', name: '奥の壁の影（x：水平・右）' },
      side: { key: 'z', color: '#7c3aed', name: '横の壁の影（z：水平・手前）' }
    },
    vertical: {
      floor: { key: 'x', color: '#12161c', name: '床の影（x：水平・右）' },
      side:  { key: 'y', color: '#7c3aed', name: '横の壁の影（y：鉛直・上）' }
    }
  };
  let SERIES = SERIES_BY_PLANE.horizontal;
  function setPlane(p) { SERIES = SERIES_BY_PLANE[p === 'vertical' ? 'vertical' : 'horizontal']; }
  const PAD = { l: 46, r: 12, t: 12, b: 30 };

  function attach(canvas, scrub) {
    cv = canvas; ctx = cv.getContext('2d'); onScrub = scrub;
    let down = false;
    const at = e => {
      if (!last || !last.all.length) return;
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left;
      const t = last.t0 + (x - PAD.l) / (r.width - PAD.l - PAD.r) * (last.t1 - last.t0);
      let best = 0;
      last.all.forEach((p, i) => { if (Math.abs(p.t - t) < Math.abs(last.all[best].t - t)) best = i; });
      if (onScrub) onScrub(best);
    };
    cv.addEventListener('pointerdown', e => { down = true; cv.setPointerCapture(e.pointerId); at(e); });
    cv.addEventListener('pointermove', e => { if (down) at(e); });
    cv.addEventListener('pointerup', () => { down = false; });
    cv.addEventListener('pointercancel', () => { down = false; });
  }

  /**
   * @param all    区間内の全コマ（3D）
   * @param sel    使うコマ（3D）
   * @param which  {back:bool, side:bool}
   * @param now    all の番号
   */
  function draw(all, sel, which, now) {
    if (!cv) return;
    const cssW = cv.parentElement.clientWidth, cssH = 200;
    const d = Math.min(window.devicePixelRatio || 1, 2);
    if (cv.width !== Math.round(cssW * d)) {
      cv.width = Math.round(cssW * d); cv.height = Math.round(cssH * d);
      cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px';
    }
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const keys = Object.keys(SERIES).filter(k => which[k]);
    if (!all || all.length < 2 || !keys.length) { last = null; return; }

    const t0 = all[0].t, t1 = all[all.length - 1].t;
    let lo = Infinity, hi = -Infinity;
    keys.forEach(k => all.forEach(p => { const v = p[SERIES[k].key] * 100; lo = Math.min(lo, v); hi = Math.max(hi, v); }));
    const pad = Math.max(1, (hi - lo) * 0.12);
    lo -= pad; hi += pad;
    const W = cssW - PAD.l - PAD.r, H = cssH - PAD.t - PAD.b;
    const X = t => PAD.l + (t - t0) / (t1 - t0 || 1) * W;
    const Y = v => PAD.t + (1 - (v - lo) / (hi - lo || 1)) * H;
    last = { t0: t0, t1: t1, all: all };

    /* 目盛り */
    ctx.font = '11px ui-monospace,monospace';
    ctx.fillStyle = '#5b6572'; ctx.strokeStyle = '#e6e9ee'; ctx.lineWidth = 1;
    const step = nice((hi - lo) / 4);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      ctx.beginPath(); ctx.moveTo(PAD.l, Y(v)); ctx.lineTo(PAD.l + W, Y(v)); ctx.stroke();
      ctx.fillText(fmt(v, step), PAD.l - 5, Y(v));
    }
    const ts = nice((t1 - t0) / 5);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let t = Math.ceil(t0 / ts) * ts; t <= t1 + 1e-9; t += ts) {
      ctx.beginPath(); ctx.moveTo(X(t), PAD.t); ctx.lineTo(X(t), PAD.t + H); ctx.stroke();
      ctx.fillText(fmt(t, ts), X(t), PAD.t + H + 4);
    }
    ctx.fillStyle = '#5b6572'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText('t [s]', PAD.l + W, cssH - 1);
    ctx.save(); ctx.translate(11, PAD.t + H / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('影の位置 [cm]', 0, 0); ctx.restore();

    /* 測った点を順に結ぶ（当てはめはしない） */
    const selIdx = new Set((sel || []).map(p => p.index));
    keys.forEach(k => {
      const s = SERIES[k];
      ctx.strokeStyle = s.color; ctx.globalAlpha = 0.45; ctx.lineWidth = 1.2;
      ctx.beginPath();
      all.forEach((p, i) => { const x = X(p.t), y = Y(p[s.key] * 100); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = s.color;
      all.forEach(p => { ctx.beginPath(); ctx.arc(X(p.t), Y(p[s.key] * 100), 1.8, 0, Math.PI * 2); ctx.fill(); });
      ctx.lineWidth = 2; ctx.strokeStyle = s.color;
      all.forEach(p => {
        if (!selIdx.has(p.index)) return;
        ctx.beginPath(); ctx.arc(X(p.t), Y(p[s.key] * 100), 4.5, 0, Math.PI * 2); ctx.stroke();
      });
    });

    /* いま */
    const p = all[Math.max(0, Math.min(all.length - 1, now || 0))];
    ctx.strokeStyle = '#0b6bcb'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(X(p.t), PAD.t); ctx.lineTo(X(p.t), PAD.t + H); ctx.stroke();
    keys.forEach(k => {
      ctx.fillStyle = '#ffd400'; ctx.strokeStyle = '#12161c'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(X(p.t), Y(p[SERIES[k].key] * 100), 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });
  }

  function nice(x) {
    const e = Math.pow(10, Math.floor(Math.log10(x || 1)));
    const m = x / e;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * e;
  }
  function fmt(v, step) { return step >= 1 ? v.toFixed(0) : v.toFixed(step >= 0.1 ? 1 : 2); }

  /** 凡例（HTML）。グラフの上に出す */
  function legend(which) {
    return Object.keys(SERIES).filter(k => which[k]).map(k =>
      '<span class="sw" style="background:' + SERIES[k].color + '"></span> ' + SERIES[k].name).join('　');
  }

  HG.graph = { attach, draw, legend, setPlane };
})(window.HG = window.HG || {});
