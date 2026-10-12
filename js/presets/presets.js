/* =====================================================================
   presets/presets.js — 運動ごとのプリセット

   プリセットの正体は初期値。タイルを選んだ時点で流し込むだけで、
   生徒はすべて後から動かせる。自由測定モードは「プリセット選択の
   スキップ」であって、別の実装ではない。

   ★ 予測の選択肢について ★
   選択肢の**文言と並び順は、集計アプリ側と完全に一致させること**。
   A/B/C/D の記号で転記するので、片方だけ直すと集計が壊れる。
   直すときはこのファイルの options だけを触れば済むようにしてある。

   dir は、⑤⑥で予測の矢印を描くための向きの種類。
     down / up      … 画面の下向き・上向き
     tangent        … その点の速度の向き（進行方向・接線方向）
     back           … 進行方向と逆向き
     center         … 軌道の曲がる中心へ向かう向き（3点から求める）
     outward        … center の逆
     equilibrium    … 点の平均位置（つり合いの位置）へ向かう向き
     zero           … 加速度はゼロ（矢印は描かず点で示す）
   ===================================================================== */
(function (HG) {
  'use strict';

  /* 斜方投射は「加速度の向きは？」と1回聞くと「重力だから下」と知識で
     正解されてしまい、理解が確認できない。上昇中・頂点・下降中を
     別々に3回聞く。誤答が集中するのは頂点。 */
  const PROJECTILE_OPTIONS = [
    { id: 'A', label: '真上', dir: 'up' },
    { id: 'B', label: '真下', dir: 'down' },
    { id: 'C', label: '進行方向', dir: 'tangent' },
    { id: 'D', label: '加速度はゼロ', dir: 'zero' }
  ];

  const PRESETS = [
    {
      id: 'cart',
      name: '一次元運動',
      /* note は「解説」。結果が出るまで画面に出さない（⑤以降で開く） */
      note: 'Δv がゼロでもベクトルであることに注目。斜面なら Δv は斜面に平行になり、' +
            '「重力は下向きなのに加速度は斜面方向」という分力の話に、ホドグラフから入れます。',
      sub: '台車の運動や自由落下など、直線の軌道を描く運動。ばね振動は専用のモードがあります',
      dim: 1, orientation: 'landscape', hodoMode: 'stair',
      /* count は作図で使う点の数の目安。一次元は少なくてよい——規則性は
         3組で見え、点を減らすほど矢印が長くなって描きやすい。 */
      intervalSec: 0.10, count: 6, cutoutRadius: 18, hue: 330,
      shootTips: ['机の縁で走らせて、背景を壁にすると影が落ちにくくなります。'],
      predictions: [{
        q: '台車の加速度はどちらを向くと思いますか？',
        options: [
          { id: 'A', label: '進行方向', dir: 'tangent' },
          { id: 'B', label: '進行方向と逆向き', dir: 'back' },
          { id: 'C', label: '真下', dir: 'down' },
          { id: 'D', label: '加速度はゼロ', dir: 'zero' }
        ]
      }]
    },
    {
      id: 'projectile',
      name: '二次元運動',
      note: '全コマで真下を向き、長さが同じになります。斜面の台車と対比させる価値があります。' +
            'どちらも加速度一定ですが、Δv の向きが鉛直下向きか斜面平行かで異なります。',
      sub: '斜方投射や2物体の衝突など、x軸とy軸がある運動。振り子は専用のモードがあります',
      dim: 2, orientation: 'landscape', hodoMode: 'all',
      intervalSec: 0.08, count: 7, cutoutRadius: 18, hue: 330,
      sampleKey: 'projectile', sample: 'samples/projectile.webm', sampleNote: '合成（動作確認用）',
      shootTips: ['バウンドの前後は加速度が桁違いに大きくなります。' +
                  '**トリムで放物線を一つだけ切り出してください。**'],
      predictions: [
        { q: '① 上がっているとき、加速度はどちらを向く？', phase: 'up', options: PROJECTILE_OPTIONS },
        { q: '② いちばん高いところで、加速度はどちらを向く？', phase: 'top', options: PROJECTILE_OPTIONS },
        { q: '③ 下がっているとき、加速度はどちらを向く？', phase: 'down', options: PROJECTILE_OPTIONS }
      ]
    },
    {
      id: 'pendulum',
      name: '単振り子',
      note: '端では速度がゼロでも Δv は残り、接線方向を向きます。ホドグラフは原点を通る弧になります。',
      sub: '糸につるして振らせる運動',
      dim: 2, orientation: 'landscape', hodoMode: 'pair',
      /* 振り子は折り返しの前後を入れたいので、少なすぎると肝心の点が落ちる */
      intervalSec: 0.10, count: 8, cutoutRadius: 18, hue: 330,
      shootTips: ['端では動きが遅く、コマ間隔を小さくすると変位が 1mm 程度になって' +
                  'ノイズに埋もれます。開始コマを少しずつずらして、' +
                  '**端のコマがサンプル点に一致するように**合わせてください。',
                  'トリムは**端の少し手前から、反対の端の少し先まで**。' +
                  '端から端でぴったり切ると、いちばん見たい端の点に矢印が出ません' +
                  '（Δv は前後の速度から作るため、区間の端には作れません）。',
                  '1往復まるごとだと、行きと帰りの矢印が同じ位置に重なって読めません。' +
                  '**片道ぶん**にしてください。',
                  '振れ角は大きめ（30°以上）のほうが弧が深くなり、矢印が読みやすくなります。'],
      predictions: [{
        q: 'いちばん高いところ（端）で、加速度はどちらを向く？',
        options: [
          { id: 'A', label: '支点へ向かう向き', dir: 'center' },
          { id: 'B', label: '運動の接線方向', dir: 'tangent' },
          { id: 'C', label: '真下', dir: 'down' },
          { id: 'D', label: '速度がゼロだから加速度もゼロ', dir: 'zero' }
        ]
      }]
    },
    {
      id: 'spring',
      name: 'バネの単振動',
      note: '常につり合いの位置を向き、変位に比例して長くなります。ホドグラフは線分を往復します。',
      sub: '上下に振動する運動',
      dim: 1, orientation: 'portrait', hodoMode: 'stair',
      intervalSec: 0.06, count: 8, cutoutRadius: 18, hue: 330,
      shootTips: ['縦画面で撮ってください。',
                  'トリムは**端の少し手前から、反対の端の少し先まで**。' +
                  '端から端でぴったり切ると、いちばん見たい端の点に矢印が出ません' +
                  '（Δv は前後の速度から作るため、区間の端には作れません）。',
                  '1往復まるごとだと、行きと帰りの矢印が同じ位置に重なります。' +
                  '**片道ぶん**にしてください。'],
      predictions: [{
        q: 'いちばん伸びたところで、加速度はどちらを向く？',
        options: [
          { id: 'A', label: 'つり合いの位置へ向かう向き', dir: 'equilibrium' },
          { id: 'B', label: '運動の向き', dir: 'tangent' },
          { id: 'C', label: '運動と逆向き', dir: 'back' },
          { id: 'D', label: '速度がゼロだから加速度もゼロ', dir: 'zero' }
        ]
      }]
    },
    {
      id: 'circle',
      name: '円運動',
      note: '常に中心向きです。ホドグラフが円になる＝速度もまた円運動している、という関係も見どころです。',
      sub: 'ターンテーブルなど、加速度が向きを変え続ける運動',
      dim: 2, orientation: 'landscape', hodoMode: 'pair',
      /* 円運動は回転が見えないと「中心を向く」が偶然に見える。少し多めに取る */
      intervalSec: 0.07, count: 8, cutoutRadius: 16, hue: 330,
      sampleKey: 'circle', sample: 'samples/circle.webm', sampleNote: '合成（動作確認用）',
      /* shootTips は解析の前に出る。答え（どちらを向くか）は書かないこと */
      shootTips: ['撮影面が平行でないと軌道が楕円に写り、加速度の向きが正しく出ません。' +
                  '真上から撮るのは難しいので、**円盤を縦に立てて横から撮る**構成をおすすめします。'],
      predictions: [{
        q: '円運動している物体の加速度はどちらを向く？',
        options: [
          { id: 'A', label: '中心向き', dir: 'center' },
          { id: 'B', label: '接線方向', dir: 'tangent' },
          { id: 'C', label: '進行方向', dir: 'tangent' },
          { id: 'D', label: '外向き', dir: 'outward' }
        ]
      }]
    },
    {
      id: 'free',
      name: 'その他の運動（自由測定）',
      note: '自分でお題を選んだ場合、予測が外れる確率はプリセットより高くなります。',
      sub: 'プリセットなし。何でも測れます',
      dim: 2, orientation: 'landscape', hodoMode: 'pair',
      intervalSec: 0.10, count: 8, cutoutRadius: 18, hue: 330,
      freeDraw: true,          // 四択ではなく、矢印を1本描かせる
      shootTips: ['守るルールは一つだけ：**カメラを固定して、運動面と平行に撮る。**'],
      /* 自由モードでは固定の四択は作れない。それでも予測は残す。
         自分でお題を選んだ場合、予測が外れる確率はプリセットより高い。 */
      predictions: [{
        q: '解析する前に、加速度がどちらを向くと思うか選んでください。',
        options: [
          { id: 'A', label: '進行方向', dir: 'tangent' },
          { id: 'B', label: '進行方向と逆向き', dir: 'back' },
          { id: 'C', label: '曲がる内側（中心向き）', dir: 'center' },
          { id: 'D', label: '真下', dir: 'down' }
        ]
      }]
    }
  ];

  /* 加速度ベクトルの自動描写だけをする道具。生徒に作図はさせない。
     「どの運動でも加速度ベクトルは出る」を手早く何本も見るための入口で、
     1本を自力で作図する本筋（運動別のタイル）の前にも後にも置ける。
     想定している授業の形は「本筋で1つ作図 → 他の運動はどうなる？」の後者。

     ★ 使う点の数だけが生きたつまみになる。★
     ここでは予測を聞かない（運動を取り替えて試す道具なので、1つの正解が
     決まらない）。予測と検証をさせたいときは運動別のタイルを使う。 */
  const EXPLORE = {
    id: 'explore', name: '加速度探究モード',
    sub: '様々な運動の加速度ベクトルを自動描写します',
    explore: true,
    note: '使う点の数を変えると、矢印の長さと向きの精度が同時に変わります。' +
          '点を減らすほど矢印は長く・向きは正確になりますが、1本が表す時間も長くなります。',
    dim: 2, orientation: 'landscape', hodoMode: 'pair',
    intervalSec: 0.08, count: 7, cutoutRadius: 18, hue: 330,
    shootTips: ['カメラを固定して、運動面と平行に撮ってください。',
                '**トリムで、見たい運動だけを切り出してください。**' +
                'バウンドや手で押している区間が混ざると、そこだけ加速度が桁違いになり、' +
                '他の矢印が読めなくなります。'],
    predictions: []
  };

  /* ベクトル作図なしの独立機能。追跡も座標も要らない。
     シールを貼れない対象がすべて使えるので、アプリの中で最も
     使用回数が多い機能になる可能性がある。 */
  const STROBE_ONLY = {
    id: 'strobe', name: 'ストロボ画像をつくる',
    sub: 'ベクトル作図なし。動画から1枚の画像にするだけ',
    strobeOnly: true,
    note: '落下する紙、衝突する球、波の伝わり、回転するコマ、跳ねる縄跳び。物理以外にも使えます。',
    dim: 2, orientation: 'landscape', hodoMode: 'all',
    intervalSec: 0.10, count: 10, cutoutRadius: 18, hue: 330,
    shootTips: ['カメラを固定して、運動面と平行に撮ってください。'],
    predictions: []
  };

  /* 「自由にどうぞ」より「これ測れる？」の方が手が動く。
     空のアップロード画面を出すと、ほとんどの生徒は何も上げない。 */
  const IDEAS = [
    '自転車のペダルの一点', 'エスカレーターの手すり', '落ちる紙と丸めた紙',
    'ブランコ', 'シャボン玉', '自販機から落ちる缶', '坂を転がるペットボトル（中身入りと空）',
    '回転いす', 'ヨーヨー', 'バスケのシュート', '扇風機の羽根の先端', '砂時計の砂面',
    'エレベーターの中で落とした消しゴム', 'water bottle flip（ボトルフリップ）',
    'ドミノが倒れる速さ', '振り下ろすバドミントンのラケット',
    'すべり台をすべる人', 'カーテンの揺れ', '洗濯機の中の衣類', 'メトロノームの先端'
  ];

  HG.presets = {
    list: PRESETS,
    explore: EXPLORE,
    strobeOnly: STROBE_ONLY,
    ideas: IDEAS,
    byId(id) { return PRESETS.filter(p => p.id === id)[0] || null; }
  };
})(window.HG = window.HG || {});
