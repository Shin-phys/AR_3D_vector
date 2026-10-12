/* =====================================================================
   ui/overlay.js — 点の描画（stage の painter として登録する）

   番号は消せないようにしてある。振り子のように往復する運動では、
   点の並びを見ただけでは時間順が分からず、順序が分からなければ
   速度ベクトルの向きが決められないため。

   表示する座標は画面の状態で変わる：
     動画の上   → rawX/rawY（画像上の実位置。映像とずれない）
     ストロボ上 → x/y（ぶれ補正後。ストロボ画像も補正して合成してある）
   ===================================================================== */
(function (HG) {
  'use strict';

  const options = { showAll: true, showNum: true };

  function drawPoints(ctx) {
    if (HG.draw && HG.draw.isHodo()) return;   // 別枠の表示中は軌道の点を描かない
    const strobe = HG.stage.mode() === 'strobe';
    const dpr = HG.view.dpr;
    const inI = HG.state.trim.inIndex;
    const outI = (HG.state.trim.outIndex === null ? HG.state.frames.length - 1 : HG.state.trim.outIndex);

    const sel = (HG.selection && HG.selection.isActive()) ? HG.selection.list() : null;
    const order = new Map();
    if (sel) sel.forEach((f, i) => order.set(f.index, i));

    let running = 0;
    for (const f of HG.state.frames) {
      if (!f.found) continue;
      const label = order.has(f.index) ? order.get(f.index) : running++;
      const isSel = order.has(f.index);
      const isCur = (f.index === HG.ui.current);

      if (strobe && !isSel) continue;                       // ストロボ上は選んだコマだけ
      if (!options.showAll && !isCur && !isSel) continue;

      const inRange = f.index >= inI && f.index <= outI;
      const c = HG.coords.toCanvas(strobe ? f.x : f.rawX, strobe ? f.y : f.rawY);
      const x = c.x, y = c.y;
      const R = Math.max(5, (isSel ? 7 : 5) * dpr) * (isCur ? 1.4 : 1);

      const color = !inRange ? 'rgba(150,150,150,.55)'
                  : (sel && !isSel) ? 'rgba(120,140,160,.45)'
                  : f.manual ? 'rgba(255,45,111,.9)'       // 手動打点
                             : 'rgba(0,190,255,.9)';       // 自動追跡
      ctx.beginPath();
      ctx.arc(x, y, R, 0, Math.PI * 2);
      if (strobe) {
        // ストロボ画像の上では中抜きにする。下にあるシールの黒点を隠すと
        // フェーズ4で「どこを指せばいいか」が分からなくなる
        ctx.lineWidth = Math.max(2, 2.2 * dpr);
        ctx.strokeStyle = color;
        ctx.stroke();
      } else {
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = Math.max(1.5, dpr);
        ctx.strokeStyle = '#fff';
        ctx.stroke();
      }

      // 選ばれたコマの番号は必ず出す（順序が分からないと矢印が引けない）
      if (options.showNum || isSel) {
        if (sel && !isSel) continue;
        ctx.font = (isSel ? 14 : 12) * dpr + 'px ui-monospace,monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3 * dpr;
        ctx.strokeStyle = 'rgba(0,0,0,.75)';
        ctx.strokeText(String(label), x + R * 1.7, y);
        ctx.fillStyle = '#fff';
        ctx.fillText(String(label), x + R * 1.7, y);
      }
    }
  }

  /** 固定マーカー（現在のコマ）を四角で示す */
  function drawMarker(ctx) {
    if (HG.stage.mode() === 'strobe') return;
    const m = (HG.state.refMarker || [])[HG.ui.current];
    const start = HG.state.tracking.markerStart;
    const p = m || start;
    if (!p) return;
    const r = Math.max(8, 9 * HG.view.dpr);
    const c = HG.coords.toCanvas(p.x, p.y);
    ctx.strokeStyle = m ? 'rgba(255,210,0,.95)' : 'rgba(255,210,0,.5)';
    ctx.lineWidth = Math.max(2, 2 * HG.view.dpr);
    ctx.strokeRect(c.x - r, c.y - r, r * 2, r * 2);
  }

  HG.overlay = { options, drawPoints, drawMarker };
})(window.HG = window.HG || {});
