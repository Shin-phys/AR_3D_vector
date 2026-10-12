/* =====================================================================
   core/coords.js — 座標系の規約（フェーズをまたいで固定。変更しないこと）

   1) 内部処理はすべて「画面座標」で行う。x は右向き、y は下向き。
      物理の議論で y を上向きにしたい場合は、表示・出力の直前にだけ
      符号を反転する（toPhysicsY）。
      → 内部と物理座標を混在させると、ベクトルの向きが場所によって
        上下反転する。ここは実装ミスが起きやすいので必ず統一する。

   2) frames[].x / y は「回転補正後の元解像度ピクセル」で保持する。
      表示は縮小するが、表示用の縮尺（view.scale）と解析用の座標は
      完全に分離する。ここを混ぜると後で定量計算の精度を失う。

   3) 時刻 t は requestVideoFrameCallback の mediaTime（実測値）。
      公称 fps からは絶対に計算しない（スマホ動画は VFR が多い）。
   ===================================================================== */
(function (HG) {
  'use strict';

  /**
   * 表示の状態。
   *   scale … 元解像度ピクセル → キャンバス実ピクセル の倍率
   *   ox,oy … 表示している範囲の左上（元解像度座標）。「軌道に合わせる」で動く
   *   crop  … 表示範囲（元解像度座標）。null なら全体
   *
   * 座標変換はこの2つの関数だけを通すこと。
   * 直接 x * view.scale と書くと、クロップしたときにずれる。
   */
  const view = { scale: 1, dpr: 1, ox: 0, oy: 0, crop: null };

  HG.view = view;
  HG.coords = {
    /** キャンバス実ピクセル → 元解像度座標 */
    toOriginal(cx, cy) { return { x: cx / view.scale + view.ox, y: cy / view.scale + view.oy }; },
    /** 元解像度座標 → キャンバス実ピクセル */
    toCanvas(x, y) { return { x: (x - view.ox) * view.scale, y: (y - view.oy) * view.scale }; },
    /** 画面座標の y → 物理座標の y（上向き正）。表示・出力の直前だけで使う */
    toPhysicsY(y) { return HG.state.video.height - y; },

    /** 表示範囲（元解像度座標）。クロップしていなければ全体 */
    area() {
      return view.crop || { x: 0, y: 0, w: HG.state.video.width, h: HG.state.video.height };
    },
    setCrop(c) { view.crop = c; }
  };
})(window.HG = window.HG || {});
