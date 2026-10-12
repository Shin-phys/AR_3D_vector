/* =====================================================================
   ui/stage.js — メインキャンバス（動画のコマ＋その上の描き物）

   フレームを描いたあと、登録された painter を順に呼ぶ。
   フェーズ4の矢印描画は stage.js を触らずに painter を足すだけでよい。
     例）HG.stage.register(HG.arrows.draw)
   ===================================================================== */
(function (HG) {
  'use strict';

  const painters = [];
  let cv = null, ctx = null;
  let source = null;      // null なら動画のコマ。ストロボ画像を出すときはその canvas
  let sourceScale = 1;    // その画像が元解像度の何倍か

  function attach(canvas) {
    cv = canvas;
    ctx = cv.getContext('2d');
  }

  function register(fn) { painters.push(fn); }

  /**
   * キャンバスの大きさを映像の縦横比に合わせ、表示縮尺を決める。
   *
   * 高さの上限を設けているのは、縦長の動画（バネの単振動など）で
   * キャンバスが画面を丸ごと占め、操作ボタンが画面外に出てしまうため。
   * スマホではキャンバスを上に貼り付けたまま下の操作をスクロールする
   * 設計なので、上限がないと下が見えない。
   */
  function fit() {
    if (!cv || !HG.state.video.width) return;
    const a = HG.coords.area();                 // いま表示する範囲（クロップ）
    const avail = cv.parentElement.clientWidth;
    const narrow = window.innerWidth < 900;
    const tall = (a.w / a.h) < 0.8;             // 縦に細い範囲（一次元運動など）
    /* 縦に細いときは高さの予算を増やす。自由落下のように軌道が縦一直線だと、
       横幅をいくら使っても倍率が上がらず、高さだけが効くため。 */
    const maxH = Math.max(180, window.innerHeight * (narrow ? (tall ? 0.60 : 0.42) : 0.78));
    let cssW = avail;
    let cssH = cssW * a.h / a.w;
    if (cssH > maxH) { cssH = maxH; cssW = cssH * a.w / a.h; }
    cssW = Math.max(60, Math.round(cssW)); cssH = Math.max(60, Math.round(cssH));

    HG.view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(cssW * HG.view.dpr), h = Math.round(cssH * HG.view.dpr);
    if (cv.width !== w || cv.height !== h) {
      cv.width = w; cv.height = h;
      cv.style.width = cssW + 'px';
      cv.style.height = cssH + 'px';
    }
    HG.view.scale = cv.width / a.w;   // 表示範囲 → キャンバス実ピクセル
    HG.view.ox = a.x; HG.view.oy = a.y;
  }

  /**
   * 背景を差し替える。null で動画のコマに戻る。
   * ストロボ画像は元解像度と同じ画角なので、表示縮尺はそのまま使える。
   */
  /**
   * @param canvas 背景に使う画像（null で動画のコマ）
   * @param srcScale その画像が元解像度の何倍か（ストロボ画像は縮小してある）
   */
  function setSource(canvas, srcScale) {
    source = canvas || null;
    sourceScale = srcScale || 1;
  }
  function mode() { return source ? 'strobe' : 'video'; }

  function render() {
    if (!cv || !HG.state.frames.length) return;
    fit();
    ctx.clearRect(0, 0, cv.width, cv.height);
    const a = HG.coords.area();
    /* 描き先は **HG.view.scale から作る**。キャンバスいっぱいに引き伸ばしては
       いけない。点や矢印は toCanvas()＝横方向の縮尺だけで置かれるのに、画像を
       キャンバスの高さいっぱいに伸ばすと、縦横比が一致しないときに背景だけが
       縦に伸びて、黒点と青丸がずれる。
       fit() は cssW / cssH を別々に丸め、さらに下限（60px）で切り上げるので、
       横に細長い表示範囲（軌道に合わせた一次元運動など）では縦横比が実際に
       壊れる。ここを view.scale から作っておけば、その場合も背景と点は必ず
       一致し、余った領域は単に背景色のまま残る。
       実測：1050x90 のクロップで、直すまで縦に 9px ずれていた。 */
    let img, k;
    if (source) { img = source; k = sourceScale; }
    else { HG.frames.drawToOffscreen(); img = HG.frames.offscreen; k = 1; }

    /* **元画像からはみ出した範囲は自前で切り、描き先もそのぶんずらす。**
       はみ出した範囲をそのまま drawImage へ渡すと、元と描き先を比例して切る
       ブラウザと、元だけ切って描き先いっぱいに伸ばすブラウザがあり、後者では
       背景だけがずれる。iPhone の Safari で実際に起きた（③④で表示範囲を
       広げたとき、その範囲が動画の外へ出ていた）。
       ルーペでも同じ種類の不具合を踏んでいる。範囲を渡す前に自分で切ること。 */
    const sx = a.x * k, sy = a.y * k, sw = a.w * k, sh = a.h * k;
    const ax = Math.max(0, sx), ay = Math.max(0, sy);
    const bx = Math.min(img.width, sx + sw), by = Math.min(img.height, sy + sh);
    if (bx > ax && by > ay) {
      const r = HG.view.scale / k;        // 元画像の1px → キャンバスの何px
      ctx.drawImage(img, ax, ay, bx - ax, by - ay,
        (ax - sx) * r, (ay - sy) * r, (bx - ax) * r, (by - ay) * r);
    }
    painters.forEach(p => {
      try { p(ctx); } catch (e) { console.error('[painter]', e); }
    });
  }

  HG.stage = { attach, register, render, setSource, mode, canvas: () => cv, ctx: () => ctx };
})(window.HG = window.HG || {});
