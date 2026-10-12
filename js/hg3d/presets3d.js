/* =====================================================================
   hg3d/presets3d.js — 3D のプリセット（3D仕様.md §7）

   各プリセットは「復元方式・初期視点・既定の点数・撮影ガイド」を持つ。
   プリセットの正体は初期値（2D と同じ）。

   ★ 予測の選択肢は 2D と共通にする（3D仕様.md §5）。★
   文言を書き写さず、2D のプリセット（js/presets/presets.js）から借りる。
   同じ問いに同じ記号でないと、2D と 3D で答えが変わったときに比べられない。
   集計アプリとの整合もこれで自動的に保たれる。

   ★ shootTips は解析の前に出る。答え（どちらを向くか）を書かないこと。★
   note（解説）は Δv を出したあとにだけ出す。
   ===================================================================== */
(function (HG) {
  'use strict';

  const LIST = [
    {
      id: 'turntable', name: 'ターンテーブル上の円運動', method: '4A',
      sub: '盤の上に紙を置き、斜め上から撮る',
      count: 8, hue: 330, cutoutRadius: 16, intervalSec: 0.07,
      initialView: 'oblique',
      predFrom: 'circle',          // 2D の「円運動」の問いをそのまま使う
      sampleKey: 'turntable', sampleNote: '合成（動作確認用）',
      shootTips: [
        '盤の上に <b>A4 のコピー用紙</b>を置き、シールは<b>紙と同じ面</b>に貼ります（厚みのある物の上だと、高さのぶん位置がずれます）。',
        'カメラは固定して、<b>30〜45° 斜め上</b>から。<b>紙の四隅が全部写る</b>ようにします。',
        '<b>標準のカメラ（1×）</b>で撮ります。ズームしないでください。',
        '1周より長めに撮り、あとでトリムで1周ぶん（少し短め）に切り出します。'
      ],
      note: 'Δv はどの点でも円の中心を向きます（「真上」から見ると分かりやすい）。' +
            '奥の壁の影は左右に往復し、その位置のグラフはばねの単振動と同じ形になります。' +
            '「等速円運動を真横から見ると単振動」という単振動の導入を、そのまま目で確かめられます。'
    },
    {
      id: 'conical', name: '円錐振り子', method: '4A', soon: true,
      sub: '真上から撮る（おもりと同じ高さに紙を吊るす構成を実験で確かめてから）',
      count: 8, hue: 330, cutoutRadius: 16
    },
    {
      id: 'throw3d', name: '奥行きのある投射', method: '4B', soon: true,
      sub: '見かけの大きさから奥行きを出す（4-A の手応えを確かめてから）',
      count: 4, hue: 330, cutoutRadius: 18
    }
  ];

  function byId(id) { return LIST.filter(p => p.id === id)[0] || null; }

  /** 予測の問い（2D から借りる） */
  function predictions(p) {
    if (!p || !p.predFrom || !HG.presets) return [];
    const src = HG.presets.byId(p.predFrom);
    return src ? src.predictions : [];
  }

  HG.presets3d = { list: LIST, byId, predictions };
})(window.HG = window.HG || {});
