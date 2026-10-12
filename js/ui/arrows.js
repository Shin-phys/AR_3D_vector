/* =====================================================================
   ui/arrows.js — 矢印の描画（キャンバス実ピクセルで受け取る）

   フェーズ3のプレビューとフェーズ4の作図で共通に使う。
   ===================================================================== */
(function (HG) {
  'use strict';

  /**
   * @param opt {color, width, head, dash, alpha}
   */
  function draw(ctx, x0, y0, x1, y1, opt) {
    opt = opt || {};
    const d = HG.view.dpr;
    const w = (opt.width || 2) * d;
    const head = (opt.head || 9) * d;
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) { dot(ctx, x0, y0, opt); return; }
    const ux = dx / len, uy = dy / len;
    const back = Math.min(head, len * 0.9);

    ctx.save();
    ctx.globalAlpha = opt.alpha === undefined ? 1 : opt.alpha;
    ctx.strokeStyle = opt.color || '#0b6bcb';
    ctx.fillStyle = opt.color || '#0b6bcb';
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    if (opt.dash) ctx.setLineDash([6 * d, 5 * d]);

    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1 - ux * back * 0.7, y1 - uy * back * 0.7);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - ux * back - uy * back * 0.42, y1 - uy * back + ux * back * 0.42);
    ctx.lineTo(x1 - ux * back + uy * back * 0.42, y1 - uy * back - ux * back * 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** ゼロベクトルは消さずに点で示す（ゼロベクトルもベクトルである） */
  function dot(ctx, x, y, opt) {
    const d = HG.view.dpr;
    ctx.save();
    ctx.fillStyle = (opt && opt.color) || '#0b6bcb';
    ctx.beginPath();
    ctx.arc(x, y, 3 * d, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  HG.arrows = { draw, dot };
})(window.HG = window.HG || {});
