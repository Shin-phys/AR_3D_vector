/* =====================================================================
   ui/pointer.js — 共通入力層（タップ／ドラッグの自動判定＋ルーペ）

   タッチ開始と終了の距離が閾値以下ならタップ、それ以上ならドラッグと
   自動判定し、どちらの操作でも同じ結果（離した位置で確定）になる。
   生徒に操作方式を選ばせない。

   フェーズ4では、ステップごとに setHandler() を差し替えるだけで
   「基準点を置く」「矢印を引く」を切り替えられる。
   ===================================================================== */
(function (HG) {
  'use strict';

  /* これを超えたらドラッグ扱い（CSS ピクセル。dpr 倍して使う）。
     大きすぎると、短い矢印（ホドグラフ上の Δv）を引いたつもりが
     タップ扱いになり、始点だけが残って次の操作とつながってしまう。 */
  const MOVE_THRESHOLD = 3;
  const LONG_PRESS_MS = 280;

  let cv = null;
  let press = null;
  /* 短い調整を繰り返すステップ（④の Δv）では、長押しを待たずに拡大鏡を出す。
     長押しが要ると、数ピクセルの追い込みには使えない。 */
  let eagerLoupe = false;
  /* 色選択の最中は、指を離してもルーペの帯を閉じない（確定前に見比べる） */
  let keepBand = false;
  let handler = null;         // ({ox, oy, cx, cy, dragged}) => void
  let preview = null;         // ドラッグ中の描き先（フェーズ4で使う）
  /* 触れた瞬間に呼ぶ。色選択では、指を置いた時点で拡大像と色を出したい
     （離すまで何も出ないと、結局「見ないままタップ」に戻ってしまう）。
     ④の Δv で preview を流用しないこと：触れただけでハンドルが動いてしまい、
     「初期の Δv は長さゼロ（向きを示唆しない）」という設計が崩れる。 */
  let downHandler = null;

  function toPoint(ev) {
    const r = cv.getBoundingClientRect();
    const cx = (ev.clientX - r.left) * (cv.width / r.width);   // キャンバス実ピクセル
    const cy = (ev.clientY - r.top) * (cv.height / r.height);
    const o = HG.coords.toOriginal(cx, cy);
    return { cx: cx, cy: cy, ox: o.x, oy: o.y };
  }

  function attach(canvas) {
    cv = canvas;

    cv.addEventListener('pointerdown', e => {
      if (!HG.state.frames.length) return;
      e.preventDefault();
      cv.setPointerCapture(e.pointerId);
      const p = toPoint(e);
      press = { start: p, p: p, moved: 0, loupe: false, t0: performance.now() };
      if (downHandler) { downHandler(p); return; }
      if (eagerLoupe) { press.loupe = true; HG.loupe.show(p); }
      else press.timer = setTimeout(() => { press.loupe = true; HG.loupe.show(press.p); }, LONG_PRESS_MS);
    });

    cv.addEventListener('pointermove', e => {
      if (!press) return;
      e.preventDefault();
      const p = toPoint(e);
      press.moved = Math.hypot(p.cx - press.start.cx, p.cy - press.start.cy);
      press.p = p;
      if (press.moved > MOVE_THRESHOLD * HG.view.dpr) {
        press.loupe = true;
        clearTimeout(press.timer);
      }
      if (press.loupe && !downHandler) HG.loupe.show(p);
      if (preview) preview(press.start, p);
    });

    const end = () => {
      if (!press) return;
      clearTimeout(press.timer);
      if (!downHandler) HG.loupe.hide(keepBand);
      const cur = press;
      press = null;
      if (handler) {
        handler({
          ox: cur.p.ox, oy: cur.p.oy, cx: cur.p.cx, cy: cur.p.cy,
          from: cur.start,
          dragged: cur.moved > MOVE_THRESHOLD * HG.view.dpr
        });
      }
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', () => {
      if (!press) return;
      clearTimeout(press.timer);
      HG.loupe.hide();
      press = null;
    });
  }

  HG.pointer = {
    attach,
    setHandler(fn) { handler = fn; },
    setPreview(fn) { preview = fn; },
    setEagerLoupe(on) { eagerLoupe = !!on; },
    setKeepBand(on) { keepBand = !!on; },
    setDownHandler(fn) { downHandler = fn || null; }
  };
})(window.HG = window.HG || {});
