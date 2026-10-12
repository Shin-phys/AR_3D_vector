/* =====================================================================
   ui/controls.js — ボタンの配線とラベル更新

   ここは「操作 → HG.xxx の呼び出し」の対応表。ロジックは持たせない。
   ===================================================================== */
(function (HG) {
  'use strict';

  const $ = HG.$;

  function attach() {
    /* --- コマ送り --- */
    $('#prev').onclick   = () => HG.frames.showFrame(HG.ui.current - 1);
    $('#next').onclick   = () => HG.frames.showFrame(HG.ui.current + 1);
    $('#prev10').onclick = () => HG.frames.showFrame(HG.ui.current - 10);
    $('#next10').onclick = () => HG.frames.showFrame(HG.ui.current + 10);

    /* --- トリム --- */
    /* この3つを押すことが「区間を自分で決めた」の記録になる（ステップ1の ✓）。
       全体に戻すのも、見て決めた結果なので ✓ を付ける。 */
    $('#setIn').onclick = () => {
      const out = (HG.state.trim.outIndex === null ? HG.state.frames.length - 1 : HG.state.trim.outIndex);
      HG.state.trim.inIndex = Math.min(HG.ui.current, out);
      HG.state.trim.userSet = true;
      HG.bus.emit('trim:changed');
    };
    $('#setOut').onclick = () => {
      HG.state.trim.outIndex = Math.max(HG.ui.current, HG.state.trim.inIndex);
      HG.state.trim.userSet = true;
      HG.bus.emit('trim:changed');
      /* 区間が決まったら t=0 へ戻す。次は「追う色を指定」で、そのとき見たい
         コマは終点ではなく t=0（物体が写り始めるコマ）だから。 */
      HG.frames.showFrame(HG.state.trim.inIndex);
    };
    $('#resetTrim').onclick = () => {
      HG.state.trim.inIndex = 0;
      HG.state.trim.outIndex = HG.state.frames.length - 1;
      HG.state.trim.userSet = true;
      HG.bus.emit('trim:changed');
    };

    /* --- 表示範囲。1つのボタンで交互に切り替える ---
       2つ並べると、すぐ下のトリムの「全区間に戻す」と「全体」が同じ言葉で
       2つ並び、意味が違うのに見分けがつかない（実機で並んでいた）。 */
    $('#fitToggle').onclick = () => {
      if (HG.view.crop) { HG.coords.setCrop(null); HG.refresh(); }
      else fitToTrack();
      updateFitLabel();
    };

    /* --- t=0・終点へ戻る --- */
    $('#gotoIn').onclick = () => HG.frames.showFrame(HG.state.trim.inIndex);
    $('#gotoOut').onclick = () => HG.frames.showFrame(
      HG.state.trim.outIndex === null ? HG.state.frames.length - 1 : HG.state.trim.outIndex);

    /* --- 打点 --- */
    $('#halveStep').onclick = startFill;
    $('#cancelFill').onclick = cancelFill;
    $('#delCur').onclick = () => HG.points.removeCurrent();
    HG.bus.on('points:changed', updateFitLabel);
    HG.bus.on('view:changed', updateFitLabel);
    $('#undo').onclick = () => {
      const i = HG.points.undo();
      if (i !== null) HG.frames.showFrame(i);
    };
    $('#clearAll').onclick = () => {
      if (confirm('打点をすべて消します。よろしいですか？')) HG.points.clearAll();
    };
    $('#showAll').onchange = e => { HG.overlay.options.showAll = e.target.checked; HG.stage.render(); };
    $('#showNum').onchange = e => { HG.overlay.options.showNum = e.target.checked; HG.stage.render(); };

    /* --- 書き出し・その他 --- */
    $('#csv').onclick = () => HG.exporter.csv();
    $('#dump').onclick = () => HG.exporter.dump();
    $('#rot').onclick = () => HG.frames.rotate90();
    $('#reload').onclick = () => location.reload();

    usePointHandler();
  }

  /**
   * 「間を埋める」で回るコマの待ち行列。
   *
   * 手動打点では、打ったコマの間隔がそのまま Δt になる。粗く打ってしまうと
   * あとから細かくできない——というのが手動打点の一番つらいところだった。
   * 打点済みのコマの**中間コマへ順に連れて行く**ことで、撮り直しも打ち直しも
   * せずに点を倍にできる。等間隔も保たれる。
   */
  let fillQueue = [];

  function startFill() {
    const p = HG.points.listInTrim();
    if (p.length < 2) { alert('先に2点以上打ってください。'); return; }
    fillQueue = [];
    for (let i = 0; i < p.length - 1; i++) {
      const mid = Math.round((p[i].index + p[i + 1].index) / 2);
      const f = HG.state.frames[mid];
      if (f && !f.found && mid !== p[i].index && mid !== p[i + 1].index) fillQueue.push(mid);
    }
    if (!fillQueue.length) {
      HG.dom.text('#fillInfo', 'これ以上は埋められません（すでに1コマおきです）。');
      return;
    }
    $('#cancelFill').classList.remove('hide');
    nextInFill();
  }

  function nextInFill() {
    if (!fillQueue.length) {
      HG.dom.text('#fillInfo', '間を埋め終わりました。点の間隔が半分になっています。');
      $('#cancelFill').classList.add('hide');
      return;
    }
    HG.dom.text('#fillInfo', '間を埋めています：残り ' + fillQueue.length +
      ' コマ。いま表示されているコマの黒点をタップしてください。');
    HG.frames.showFrame(fillQueue[0]);
  }

  function cancelFill() {
    fillQueue = [];
    $('#cancelFill').classList.add('hide');
    HG.dom.text('#fillInfo', '間を埋めるのをやめました。');
  }

  /**
   * タップ＝打点（手直し用）。
   *
   * ★ 等間隔は、もうここでは守らない。★
   * 以前は「打点したら N コマ進む」というチェックボックスが等間隔を支えていて、
   * 生徒が切ると Δt が不揃いになった。**不変条件をチェックボックスに預けるのは弱い。**
   * いまは案内付き打点（track-controls の B）が、使うコマそのものを順に
   * 連れて行く。打てるコマが選ばれたコマだけになるので、等間隔は設計で決まる。
   * ここに残っているのは、打ち終わったあとの手直しと「間を埋める」だけ。
   */
  function usePointHandler() {
    HG.pointer.setHandler(p => {
      const at = HG.ui.current;
      HG.points.put(p.ox, p.oy);
      /* 「間を埋める」の最中は、その行列を進める */
      if (fillQueue.length && fillQueue[0] === at) {
        fillQueue.shift();
        nextInFill();
      }
    });
  }

  /**
   * 表示を軌道に合わせる（クロップ）。
   *
   * 自由落下のように軌道が縦一直線だと、動画の縦横比のままでは
   * 画面のほとんどが余白になり、物体が数ピクセルにしかならない。
   * 「余白を切る」だけでは足りず、**キャンバスの形も縦長に変える**ことで
   * 初めて高さの予算を使い切れる（実測で約2〜3倍）。
   *
   * ただし細くしすぎると、基準点を軌道の横に置く余地が無くなるので、
   * 縦横比に下限を設けて左右に余地を残す。
   */
  const MIN_ASPECT = 0.38;      // これより細いクロップは横に広げる
  const MARGIN = 0.14;          // 軌道の外側に取る余白（長い方の辺に対する割合）

  function fitToTrack() {
    const p = HG.points.listInTrim();
    if (p.length < 2) { alert('先に追跡か手動打点をしてください。'); return; }
    const W = HG.state.video.width, H = HG.state.video.height;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    p.forEach(f => {
      x0 = Math.min(x0, f.x); x1 = Math.max(x1, f.x);
      y0 = Math.min(y0, f.y); y1 = Math.max(y1, f.y);
    });
    let w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
    const m = Math.max(w, h) * MARGIN;
    x0 -= m; y0 -= m; w += 2 * m; h += 2 * m;

    /* 細すぎる／平たすぎるときは短い方を広げる */
    if (w / h < MIN_ASPECT) { const nw = h * MIN_ASPECT; x0 -= (nw - w) / 2; w = nw; }
    if (h / w < MIN_ASPECT) { const nh = w * MIN_ASPECT; y0 -= (nh - h) / 2; h = nh; }

    /* 画面の外にはみ出さないように寄せる（切れないよう幅・高さを先に丸める） */
    w = Math.min(w, W); h = Math.min(h, H);
    x0 = Math.max(0, Math.min(W - w, x0));
    y0 = Math.max(0, Math.min(H - h, y0));

    HG.coords.setCrop({ x: x0, y: y0, w: w, h: h });
    HG.refresh();
    updateFitLabel();
  }

  /**
   * 表示切り替えボタンの文字と出し入れ。
   * 倍率などの数字はここに出さない（生徒は「倍率 0.46」で何もできない）。
   * 診断カードへ回してある。
   */
  function updateFitLabel() {
    const el = $('#fitToggle');
    if (!el) return;
    /* 点が2つ無いと押しても怒られるだけなので、そのあいだは出さない。
       ついでに、トリム中にうっかりクロップできなくなる（トリムは全画面で判断する） */
    el.classList.toggle('hide', HG.points.listInTrim().length < 2);
    HG.dom.text('#fitToggle', HG.view.crop ? '全体に戻す' : '軌道に寄せる');
  }

  function updateLabels() {
    const fr = HG.state.frames;
    if (!fr.length) return;
    const f = fr[HG.ui.current];
    const inI = HG.state.trim.inIndex;
    const outI = (HG.state.trim.outIndex === null ? fr.length - 1 : HG.state.trim.outIndex);

    /* コマ番号は画面に重ねる。独立した行にすると貼り付くブロックが厚くなる */
    HG.dom.text('#frameTag',
      'コマ ' + HG.ui.current + ' / ' + (fr.length - 1) +
      '　t = ' + (f ? f.t.toFixed(3) : '0.000') + ' s');
    HG.dom.text('#trimLabel',
      'コマ ' + inI + ' 〜 ' + outI + '（' + (outI - inI + 1) + ' コマ／' +
      (fr[outI].t - fr[inI].t).toFixed(3) + ' s）');

    const inTrim = HG.points.listInTrim();
    const man = inTrim.filter(p => p.manual).length;
    HG.dom.text('#ptLabel',
      '区間内 ' + inTrim.length + ' 点（自動 ' + (inTrim.length - man) + ' ／ 手動 ' + man + '）' +
      (inTrim.length && inTrim.length <= 20 ? '／コマ ' + inTrim.map(p => p.index).join(', ') : ''));
  }

  HG.controls = { attach, updateLabels, usePointHandler, fitToTrack, updateFitLabel };
})(window.HG = window.HG || {});
