/* =====================================================================
   core/state.js — コアデータ構造（フェーズ1〜6で共有。勝手に変えない）

   ここに定義した state の形は、フェーズをまたいで共有する契約です。
   フィールドを増やすのは構いませんが、既存フィールドの意味・単位・
   名前を変えると後続フェーズが壊れます。変更するときは README の
   「コアデータ構造」も同時に直すこと。
   ===================================================================== */
(function (HG) {
  'use strict';

  const state = {
    video: {
      element: null,      // <video>
      width: 0,           // 元解像度（回転補正後）
      height: 0,
      duration: 0,
      rotation: 0         // 表示補正のために回した角度（0/90/180/270）
    },

    // フェーズ1〜2で作る。全コマ分。
    //   {index, t, x, y, found, manual, rawX, rawY}
    //   x, y   … カメラぶれ補正を掛けたあとの座標。下流（作図・ストロボ）はこちらを使う
    //   rawX,rawY … 画像上の実位置。表示（点を映像に重ねる）に使う
    //   補正を使わない場合は x === rawX
    frames: [],

    // 固定マーカー（カメラぶれ補正用）。コマ番号で引ける配列。
    //   [{index, t, x, y, found}] 見つからなかったコマは undefined
    refMarker: [],

    // 追跡の設定と結果（フェーズ2）
    tracking: {
      target: { h: 330, s: 0.60, v: 0.60 },   // 既定は蛍光ピンク
      hueTol: 25,          // 色相の許容幅（度）
      satMin: 0.35,        // 彩度の下限
      valMin: 0.20,        // 明るさの下限
      minArea: 12,         // 解析解像度でのブロブ最小面積（画素）
      analysisWidth: 480,  // 解析用に縮小する幅
      seed: null,          // 追跡の出発点 {x, y}（色を指定したときのタップ位置）
      markerStart: null,   // 固定マーカーの初期位置 {x, y}（元解像度）
      markerWindow: 60,    // マーカーを探す半径（元解像度ピクセル）
      useMarker: true,     // カメラぶれ補正を使うか
      /* 追跡のあと「うまくいきましたか？」に「はい」と答えたか。
         点が3つあるだけでは ✓ を付けない（外れた追跡でも点は並ぶ）。 */
      verified: false,
      /* 2コマ指定の結果。これがあるあいだ、追跡は「次の位置を予測して
         その周りだけを探す」に切り替わる（null なら従来どおり全画面から探す）。
           at       … 1コマ目の位置 {x, y}（元解像度）
           index    … 1コマ目のコマ番号
           vel      … 初速 {x, y}（元解像度 px / 秒。コマ数ではなく秒で持つ。
                      スマホ動画は VFR で Δt が不揃いなため）
           step     … 2点間の変位の大きさ（探索窓の基準）
           sizeHint … ブロブの面積の見当（元解像度 px²）。窓に複数あるときの決め手 */
      twoFrame: null,
      report: null         // 直近の追跡結果（診断が読む）
    },

    /* フェーズ1で決める。追跡・背景推定より前に確定させる。
       ★ userSet は「生徒が自分で区間を決めたか」。★
       outIndex は走査が終わった時点でアプリが末尾に入れてしまうので、
       それを「トリック済み」の判定に使うと、動画を読み込んだ直後に
       ステップ1の ✓ が付く（実機で指摘された）。
       ✓ は「見て決めた」という生徒の行為だけに付けること。 */
    trim: { inIndex: 0, outIndex: null, userSet: false },

    /* フェーズ3で決める。つまみは interval（何コマおきに使うか）だけ。
         startIndex … 最初に使うコマ（トリムのイン点 + offset。派生値）
         offset     … 開始をずらす量（0〜interval-1）。末尾の端数を前に出すため
         interval   … 何コマおきに使うか
         count      … 点の数の**上限**（区間が長いとき打ち切る）。点数そのものではない
       点の数は「区間 ÷ interval」で決まり、末尾の端数は捨てる。
       最後の1区間だけ短くすると Δt が不揃いになり、その1点のために
       前後3本の Δv が壊れるため。 */
    /* count は「使う点の数の上限」。24 はストロボ画像を作るための値だった。
       逐次方式で作図するようになってからは点が多すぎて、1本あたりの矢印も
       短くなる（実寸で描くので矢印の長さ＝点の間隔）。作図向けに 8 を既定とし、
       運動ごとの目安はプリセットが上書きする。 */
    selection: { startIndex: 0, offset: 0, interval: 3, count: 8 },

    // 生徒の作図。フェーズ4で使う
    drawing: {
      origin: null,           // 基準点 {x, y}
      positionVectors: [],    // [{dx, dy}] 基準点からの位置ベクトル
      velocityVectors: [],    // [{dx, dy}] 手書き速度ベクトル
      deltaVVectors: [],      // [{dx, dy}] 手書きΔv
      prediction: null        // 予測の矢印 {dx, dy} または選択肢ID
    },

    // ストロボ画像の設定（フェーズ3）
    strobe: {
      method: 'diff',        // 'diff'（既定）/ 'cutout'（退避先）/ 'lighten'（オプション）
      workWidth: 960,        // 合成に使う横幅（元解像度がこれより小さければそのまま）
      threshold: null,       // 実際に使う閾値（大津の自動値 × thresholdScale）
      autoThreshold: null,   // 大津の判別分析法で求めた自動値
      thresholdScale: 1,     // スライダの倍率（物体が欠ける ←→ ゴミが写る）
      fadeOld: true,         // 古いコマを薄くする（同じ場所を通る運動で必要）
      cutoutRadius: 18       // 切り抜き半径（元解像度ピクセル）
    },

    preset: null          // 運動タイルのプリセット（フェーズ6）
  };

  /* UI の一時状態。コアデータ構造とは分けて持つ（保存対象にしない） */
  const ui = {
    current: 0,           // 表示中のコマ
    limitToTrim: false,   // コマ送りとタイムラインをイン〜アウトに閉じ込める
    scanning: false,
    timebase: 'rvfc'      // 'rvfc' = 実測 / 'seek' = 推定
  };

  /* 打点の取り消し履歴 */
  const history = [];

  HG.state = state;
  HG.ui = ui;
  HG.history = history;
  window.state = state;   // コンソールでの確認用
})(window.HG = window.HG || {});
