/* =====================================================================
   ui/loupe.js — ルーペ（指先で隠れる位置を正確に指すための拡大表示）

   指先は画面を隠すため、縦画面でストロボ画像上の黒点を正確に指すのは
   困難。触ると指の近くに拡大表示が出て、正確な位置を確認してから離せる。
   この機能の有無でスマホでの作図が実用になるかが決まる。

   ★ キャンバスの中に置けないことがある。★
   スマホではキャンバスの高さを画面の 42% に抑えている（stage.js）ので、
   キャンバスが 300px 程度しかない。ルーペは 130px 角。はみ出さないよう
   位置を丸め込むと、下半分を触ったときにルーペが指の位置まで降りてくる。
   上端では指の下へ逃がしていたので、そこでも重なっていた。
   **これは数値の調整では直らない。置ける隙間が無いというだけ。**
   そこで、指を隠さない置き場所が見つからなければキャンバスの下の帯
   （#loupeBand）へ逃がす。色選択では常に帯を使い、拾っている色を
   並べて見せる（確定前に当たり外れが分かるようにする）。
   ===================================================================== */
(function (HG) {
  'use strict';

  const D = 260;      // ルーペの内部解像度
  const ZOOM = 2.6;
  const CSS = D / 2;  // 画面上の大きさ
  let el = null, ctx = null, docked = false;

  function attach(canvas) {
    el = canvas;
    ctx = el.getContext('2d');
  }

  /**
   * 指を隠さない置き場所を探す。上・下・左・右の順。
   * 見つからなければ null（＝帯へ逃がす）。
   */
  function place(x, y, host) {
    const M = 6, GAP = 22, PAD = 18;
    if (host.width < CSS + 2 * M || host.height < CSS + 2 * M) return null;
    const cands = [
      { x: x - CSS / 2, y: y - CSS - GAP },
      { x: x - CSS / 2, y: y + GAP },
      { x: x - CSS - GAP, y: y - CSS / 2 },
      { x: x + GAP, y: y - CSS / 2 }
    ];
    for (let i = 0; i < cands.length; i++) {
      const cx = Math.max(M, Math.min(host.width - CSS - M, cands[i].x));
      const cy = Math.max(M, Math.min(host.height - CSS - M, cands[i].y));
      /* 丸め込みで指のところまで寄ってきたら、その候補は使えない */
      if (x > cx - PAD && x < cx + CSS + PAD && y > cy - PAD && y < cy + CSS + PAD) continue;
      return { x: cx, y: cy };
    }
    return null;
  }

  /** 帯の開け閉め。中身（ルーペ）とは独立に開けられる（説明だけ出したいとき用） */
  function band(on) {
    const b = document.getElementById('loupeBand');
    if (b) b.classList.toggle('hide', !on);
  }

  /** ルーペ本体を帯に入れる／キャンバスの上へ戻す（DOM の移動だけ） */
  function dock(on) {
    if (!el || docked === on) return;
    docked = on;
    const slot = document.getElementById('loupeSlot');
    if (on && slot) { slot.appendChild(el); el.classList.add('docked'); }
    else {
      const stage = HG.stage.canvas() && HG.stage.canvas().parentElement;
      if (stage) stage.appendChild(el);
      el.classList.remove('docked');
    }
  }

  /**
   * @param p    {cx, cy} キャンバス実ピクセルでの注目点
   * @param opts {dock:true で必ず帯に出す, sampleR:元解像度での半径（点線の円）,
   *              cross:false で十字を描かない}
   */
  function show(p, opts) {
    const o = opts || {};
    const cv = HG.stage.canvas();
    if (!cv || !el) return;
    const r = cv.getBoundingClientRect();
    const host = cv.parentElement.getBoundingClientRect();
    const cssX = (r.left - host.left) + p.cx / (cv.width / r.width);
    const cssY = (r.top - host.top) + p.cy / (cv.height / r.height);

    const pos = o.dock ? null : place(cssX, cssY, host);
    dock(!pos);
    /* 帯の開け閉めは show() のたびに必ず付け直す。dock() は DOM が
       すでに帯にあると何もしないので、そこに任せると閉じたままになる。 */
    if (!pos) band(true);
    else if (!o.keepBand) band(false);
    el.style.display = 'block';
    el.style.width = CSS + 'px';
    el.style.height = CSS + 'px';
    if (pos) { el.style.left = pos.x + 'px'; el.style.top = pos.y + 'px'; }

    ctx.save();
    ctx.clearRect(0, 0, D, D);
    ctx.beginPath();
    ctx.arc(D / 2, D / 2, D / 2 - 4, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, D, D);
    /* 取り込む範囲がキャンバスの外へ出たら、出たぶんだけ描く先もずらす。
       範囲をそのまま drawImage へ渡すと、ブラウザが元と先を比例して切るため、
       拡大像が円の中で片側へ寄り、たとえば画面の下側を触ったときにルーペの
       下半分が空になる（実機で指摘された）。
       こうしておけば、中心の十字は常に指している点そのものを指す。 */
    const s = D / ZOOM;
    const sx = p.cx - s / 2, sy = p.cy - s / 2;
    const ax = Math.max(0, sx), ay = Math.max(0, sy);
    const bx = Math.min(cv.width, sx + s), by = Math.min(cv.height, sy + s);
    if (bx > ax && by > ay) {
      ctx.drawImage(cv, ax, ay, bx - ax, by - ay,
        (ax - sx) * ZOOM, (ay - sy) * ZOOM, (bx - ax) * ZOOM, (by - ay) * ZOOM);
    }
    /* 色を拾う範囲を点線で見せる。1画素ではなくこの円の色相平均を使うので、
       数ピクセルの精度は要らないことが目で分かる。 */
    if (o.sampleR) {
      const rr = Math.max(8, o.sampleR * HG.view.scale * ZOOM);
      ctx.save();
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = 'rgba(255,255,255,.95)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(D / 2, D / 2, rr, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    if (o.cross !== false) {
      ctx.strokeStyle = 'rgba(255,255,255,.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(D / 2 - 18, D / 2); ctx.lineTo(D / 2 - 4, D / 2);
      ctx.moveTo(D / 2 + 4, D / 2);  ctx.lineTo(D / 2 + 18, D / 2);
      ctx.moveTo(D / 2, D / 2 - 18); ctx.lineTo(D / 2, D / 2 - 4);
      ctx.moveTo(D / 2, D / 2 + 4);  ctx.lineTo(D / 2, D / 2 + 18);
      ctx.stroke();
    }
    ctx.restore();

    ctx.beginPath();
    ctx.arc(D / 2, D / 2, D / 2 - 4, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 5; ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 2; ctx.stroke();
  }

  /** @param keepBand 帯は開けたまま（色選択の最中など） */
  function hide(keepBand) {
    if (!el) return;
    el.style.display = 'none';
    if (!keepBand) band(false);
  }

  HG.loupe = { attach, show, hide, band, isDocked: () => docked };
})(window.HG = window.HG || {});
