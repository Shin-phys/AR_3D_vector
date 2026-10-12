/* =====================================================================
   analysis/diagnostics.js — 診断

   「解析できませんでした」だけで終わらせないこと。生徒は必ず失敗した
   動画を持ってくる。何が悪いかを言えるかどうかで、教室で使える道具か
   どうかが決まる。

   フェーズ2で追跡の診断（マーカーが動いた／見失った／ブレている 等）を
   ここに足す。追加するときは check 関数を増やして checks[] に並べる。
   ===================================================================== */
(function (HG) {
  'use strict';

  /** トリム区間のコマ間隔を集計する */
  function dtStats() {
    const fr = HG.state.frames;
    if (fr.length < 2) return null;
    const inI = HG.state.trim.inIndex;
    const outI = (HG.state.trim.outIndex === null ? fr.length - 1 : HG.state.trim.outIndex);
    const dts = [];
    for (let i = inI + 1; i <= outI; i++) dts.push(fr[i].t - fr[i - 1].t);
    if (!dts.length) return null;
    dts.sort((a, b) => a - b);
    const median = dts[Math.floor(dts.length / 2)];
    const min = dts[0], max = dts[dts.length - 1];
    return {
      count: dts.length + 1,
      min: min, max: max, median: median,
      jitter: median ? (max - min) / median : 0,
      fps: median ? 1 / median : 0
    };
  }

  /* --- 個々のチェック。true を返したらメッセージを出す --- */
  const checks = [
    {
      test: s => s.jitter > 0.25,
      msg: s => 'コマ間隔が一定になっていません（不揃い率 ' + (s.jitter * 100).toFixed(0) +
        '%）。撮影モードを変えて撮り直すと安定します。<br>' +
        '※ このアプリは公称 fps ではなく実測時刻を使うので、解析自体は続けられます。'
    },
    {
      test: () => HG.ui.timebase !== 'rvfc',
      msg: () => 'この環境ではコマの実時刻を実測できていません。時刻は推定値です。'
    },
    {
      test: s => s.fps > 0 && s.fps < 50,
      msg: s => 'フレームレートが ' + s.fps.toFixed(0) + ' fps です。速い運動では' +
        'スローモーション（120fps 以上）で撮り直すと、物体の尾引きが減って中心が定まります。'
    }
  ];

  /* --- 追跡の診断。フェーズ2で追加した分 --- */
  const trackChecks = [
    {
      test: r => r.markerUsed && r.markerDrift >= 3,
      msg: r => 'カメラが動いています（固定マーカーが最大 ' + r.markerDrift.toFixed(1) +
        ' px 動きました）。三脚を固定して撮り直してください。' +
        '<br>※ 補正は掛かっているので、この動画のまま進めることもできます。'
    },
    {
      test: r => r.lost.length > 0,
      msg: r => r.lost.slice(0, 5).join(', ') + ' コマ目で見失いました' +
        (r.lost.length > 5 ? '（ほか ' + (r.lost.length - 5) + ' コマ）' : '') +
        '。照明を明るくするか、シールの色を指定し直してください。手動で点を打って埋めることもできます。'
    },
    {
      test: r => r.maxElongation > 2.2,
      msg: r => 'ブレています（ブロブの楕円率が最大 ' + r.maxElongation.toFixed(1) +
        '）。スローモーション（120fps 以上）で撮り直してください。'
    },
    {
      test: r => r.noBlob > 0,
      msg: r => r.noBlob + ' コマでシールが写っていません。色を指定し直すか、手動で点を打ってください。'
    },
    {
      // 本来は「全画面の 90% 以上が背景と異なる」判定。背景差分はフェーズ3なので、
      // ここでは色マスクの占有率で代用している。フェーズ3で本来の判定に差し替えること。
      test: r => r.maxMaskRatio > 0.9,
      msg: () => '画面のほぼ全体が指定した色と判定されています。明るさが変化しているか、' +
        '色の許容幅が広すぎます。AE をロックして撮り直すか、色相の幅を狭めてください。'
    },
    {
      test: r => r.markerUsed && r.markerLost > 0,
      msg: r => r.markerLost + ' コマで固定マーカーを見失いました。その区間はぶれ補正が効いていません。'
    }
  ];

  function render() {
    const s = dtStats();
    if (!s) return;
    const v = HG.state.video;
    const r = HG.state.tracking.report;

    HG.dom.html('#stats',
      row('総コマ数', HG.state.frames.length + ' コマ／' + (v.duration || 0).toFixed(2) + ' s') +
      row('解像度', v.width + ' × ' + v.height + (v.rotation ? '（' + v.rotation + '° 回転）' : '')) +
      row('実効フレームレート', s.fps.toFixed(1) + ' fps（中央値）') +
      row('Δt 中央値', (s.median * 1000).toFixed(2) + ' ms') +
      row('Δt 最小／最大', (s.min * 1000).toFixed(2) + ' ／ ' + (s.max * 1000).toFixed(2) + ' ms') +
      row('不揃い率', (s.jitter * 100).toFixed(1) + ' %') +
      row('時刻の取得方法', HG.ui.timebase === 'rvfc' ? 'requestVideoFrameCallback（実測）' : 'currentTime 送り（推定）') +
      /* 表示倍率。生徒の導線には置かない（「倍率 0.46」で打つ手が無い）が、
         矢印が小さすぎる原因を教師が調べるときに要る */
      row('表示', fitInfo()) +
      (r ? row('自動追跡', r.tracked + ' / ' + r.total + ' コマ（見失い ' + r.lost.length + '）') +
           row('ブロブの楕円率', '最大 ' + r.maxElongation.toFixed(2)) +
           row('カメラぶれ', r.markerUsed ? '最大 ' + r.markerDrift.toFixed(1) + ' px（補正' +
                (HG.state.tracking.useMarker ? 'あり' : 'なし') + '）' : '固定マーカー未指定（補正なし）')
         : '')
    );

    const msgs = checks.filter(c => c.test(s)).map(c => c.msg(s));
    if (r) trackChecks.filter(c => c.test(r)).forEach(c => msgs.push(c.msg(r)));
    /* 「解析できませんでした」だけで終わらせない。何が悪いかを必ず言う */
    HG.dom.html('#warnBox', msgs.length
      ? msgs.map(t => '<div class="warn spaced-sm">' + t + '</div>').join('')
      : '<div class="ok">' + (r ? '問題は見つかりませんでした。' : 'コマ間隔は十分そろっています。') + '</div>');
  }

  function row(k, v) {
    return '<tr><td>' + k + '</td><td class="mono">' + v + '</td></tr>';
  }

  function fitInfo() {
    if (!HG.view.crop) return '全体';
    const a = HG.coords.area();
    const cv = HG.stage.canvas();
    const px = cv ? (cv.width / HG.view.dpr) / a.w : 0;
    return Math.round(a.w) + '×' + Math.round(a.h) + ' を拡大（倍率 ' + px.toFixed(2) + '）';
  }

  HG.diagnostics = { dtStats, render };
})(window.HG = window.HG || {});
