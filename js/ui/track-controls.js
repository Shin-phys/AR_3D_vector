/* =====================================================================
   ui/track-controls.js — 自動追跡の操作まわり（ステップ2と3）

   ポインタのモード（打点／色を指定／マーカーを指定）はここで切り替える。
   切り替えは HG.pointer.setHandler() の差し替えだけ。

   ★ 色選択は2段階にすること。★
   以前はタップ1回で確定していた。ルーペは長押し 280ms で出るので、
   素早くタップすると一度も出ず、**生徒は指で隠れた場所を見ないまま
   確定していた**。外したことが分かるのは追跡が失敗したとき。
   そこで④の Δv と同じ形にした：タップで照準を置く → 指でずらして
   微調整 → 「この色で決定」。ルーペはキャンバスの下の帯に出し、
   拾っている色のチップと色相・彩度を並べる（確定前に当たり外れが分かる）。

   色そのものは半径 1.2%（横1920なら23px）の円の色相平均で、灰色に近い
   画素は捨てている。**数ピクセルの精度は要らない。**
   問題は精度ではなく「何を拾ったか見えないまま確定する」ことだった。
   ===================================================================== */
(function (HG) {
  'use strict';

  const $ = HG.$;

  /* 色／マーカーを選んでいる最中の照準。{x, y, kind, color} 元解像度座標 */
  let aim = null;
  let picking = null;      // PICK のキー、または null
  /* 2コマ指定の進行。{p1, p2} 元解像度座標＋コマ番号＋色＋面積 */
  let two = null;

  /** 位置を選ばせる場面の違いは、この表だけに持たせる */
  const PICK = {
    color:  { btn: 'この色で決定',   color: true,
              hint: '追いたいシールをタップ（そのあと指でずらして微調整できます）' },
    marker: { btn: 'この位置で決定', color: false,
              hint: '動かない場所に貼ったシールをタップ（そのあとずらして微調整できます）' },
    two1:   { btn: '1コマ目を決定',  color: true,
              hint: '【1コマ目】物体をタップ（そのあとずらして微調整できます）' },
    two2:   { btn: '2コマ目を決定',  color: true,
              hint: '【2コマ目】動いた先の同じ物体をタップ' }
  };

  function hint(text) {
    const h = $('#hint');
    h.textContent = text;
    h.classList.remove('fade');
  }
  function hintDefault() {
    hint('画面をタップで打点／長押しでルーペ');
    if (HG.points.list().length) $('#hint').classList.add('fade');
  }

  function showColor() {
    const c = HG.state.tracking.target;
    $('#colorChip').style.background = HG.color.hsvToCss(c);
    HG.dom.text('#colorLabel', '色相 ' + c.h.toFixed(0) + '° ／ 彩度 ' + c.s.toFixed(2));
  }

  /* ---------- 2段階の位置選び（色／固定マーカー） ---------- */

  function startPick(kind) {
    const cf = PICK[kind];
    if (!cf) return;
    aim = null;
    picking = kind;
    /* 色は動画の画素から読む。ストロボを出していると古いコマが残るので描き直す */
    try { HG.frames.drawToOffscreen(); } catch (e) { /* 動画が無ければ何もしない */ }
    HG.dom.show('#pickRow');
    HG.dom.text('#pickDecide', cf.btn);
    hint(cf.hint);
    HG.pointer.setKeepBand(true);
    HG.pointer.setDownHandler(p => moveAim(p.ox, p.oy));   // 触れた瞬間から見える
    HG.pointer.setHandler(p => moveAim(p.ox, p.oy));
    HG.pointer.setPreview((from, p) => moveAim(p.ox, p.oy));
    HG.loupe.band(true);
    paintInfo();
  }

  function moveAim(ox, oy) {
    if (!picking) return;
    aim = { x: ox, y: oy, kind: picking };
    if (PICK[picking].color) aim.color = HG.tracker.sampleColorAt(ox, oy);
    /* 照準を描いてからルーペに写す。順序を逆にすると拡大像に照準が入らない */
    HG.stage.render();
    const c = HG.coords.toCanvas(ox, oy);
    HG.loupe.show({ cx: c.x, cy: c.y },
      { dock: true, keepBand: true, sampleR: HG.tracker.sampleRadius(), cross: false });
    paintInfo();
  }

  /** 帯の文字。確定前に当たり外れが分かることがこの機能の全部 */
  function paintInfo() {
    if (!picking) { HG.dom.html('#loupeInfo', ''); return; }
    if (!aim) {
      HG.dom.html('#loupeInfo', '<div class="sub">画面のシールをタップしてください。' +
        'ここに拡大して出るので、指で隠れません。</div>');
      return;
    }
    if (PICK[aim.kind].color) {
      HG.dom.html('#loupeInfo', aim.color
        ? '<span class="chip" style="background:' + HG.color.hsvToCss(aim.color) + '"></span> ' +
          '<span class="mono">色相 ' + aim.color.h.toFixed(0) + '° ／ 彩度 ' + aim.color.s.toFixed(2) + '</span>' +
          '<div class="sub">' + (aim.kind === 'color'
            ? 'シールの色と合っていれば「この色で決定」。違えばずらしてください。'
            : '物体の中心に来ていれば「' + PICK[aim.kind].btn + '」。') + '</div>'
        : '<span class="warn">ここからは色が読めません（灰色に近すぎます）。</span>' +
          '<div class="sub">物体の中心へ寄せてください。</div>');
    } else {
      HG.dom.html('#loupeInfo',
        '<span class="mono">x ' + Math.round(aim.x) + ' ／ y ' + Math.round(aim.y) + '</span>' +
        '<div class="sub">動かないシールの中心に来ていれば「この位置で決定」。</div>');
    }
  }

  function endPick(commit) {
    if (commit && aim && (aim.kind === 'two1' || aim.kind === 'two2')) {
      if (!aim.color) {
        HG.dom.html('#loupeInfo', '<span class="warn">この位置では色が読めません。' +
          '物体の中心へ寄せてください。</span>');
        return;                                      // 選び直させる。閉じない
      }
      const pt = { x: aim.x, y: aim.y, index: HG.ui.current,
                   color: aim.color, area: HG.tracker.measureAreaAt(aim.x, aim.y) };
      if (aim.kind === 'two1') { twoGotFirst(pt); return; }
      twoGotSecond(pt);
      return;
    }
    if (commit && aim) {
      if (aim.kind === 'color') {
        const c = HG.tracker.pickColorAt(aim.x, aim.y);
        if (!c) {
          HG.dom.html('#loupeInfo', '<span class="warn">この位置では色を決められません。' +
            'シールの中心へ寄せてください。</span>');
          return;                                  // 選び直させる。閉じない
        }
        showColor();
        HG.dom.text('#trackResult', '色を指定しました。「自動追跡を実行」を押してください。');
      } else {
        HG.state.tracking.markerStart = { x: aim.x, y: aim.y };
        HG.dom.text('#trackResult', '固定マーカーを指定しました。追跡すると、このマーカーの変位を差し引きます。');
      }
    }
    aim = null; picking = null; two = null;
    HG.dom.hide('#pickRow');
    HG.pointer.setKeepBand(false);
    HG.pointer.setDownHandler(null);
    HG.pointer.setPreview(null);
    HG.loupe.hide();
    HG.controls.usePointHandler();
    hintDefault();
    if (HG.steps) HG.steps.render();
    HG.stage.render();
  }

  /** 照準（stage の painter として登録する） */
  function paintAim(ctx) {
    const dpr = HG.view.dpr;
    /* 2コマ目を選んでいるあいだ、1コマ目の位置を薄く残す。
       これが見えないと「どれだけ動いたか」を目で確かめられない。 */
    if (two && two.p1 && picking === 'two2') {
      const a = HG.coords.toCanvas(two.p1.x, two.p1.y);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,122,0,.55)';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.arc(a.x, a.y, 9 * dpr, 0, Math.PI * 2); ctx.stroke();
      if (aim) {
        const b = HG.coords.toCanvas(aim.x, aim.y);
        ctx.setLineDash([4 * dpr, 4 * dpr]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.restore();
    }
    if (!aim) return;
    const c = HG.coords.toCanvas(aim.x, aim.y);
    const col = aim.kind === 'color' ? 'rgba(255,122,0,.95)' : 'rgba(255,210,0,.95)';
    ctx.save();
    /* 十字。中心は空けて、拾っている画素を隠さない */
    ctx.strokeStyle = 'rgba(0,0,0,.65)';
    ctx.lineWidth = 4 * dpr;
    for (let pass = 0; pass < 2; pass++) {
      if (pass) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * dpr; }
      ctx.beginPath();
      ctx.moveTo(c.x - 20 * dpr, c.y); ctx.lineTo(c.x - 6 * dpr, c.y);
      ctx.moveTo(c.x + 6 * dpr, c.y);  ctx.lineTo(c.x + 20 * dpr, c.y);
      ctx.moveTo(c.x, c.y - 20 * dpr); ctx.lineTo(c.x, c.y - 6 * dpr);
      ctx.moveTo(c.x, c.y + 6 * dpr);  ctx.lineTo(c.x, c.y + 20 * dpr);
      ctx.stroke();
    }
    /* 色を拾う円。1画素ではないことを見せる */
    const r = Math.max(6 * dpr, HG.tracker.sampleRadius() * HG.view.scale);
    ctx.setLineDash([5 * dpr, 5 * dpr]);
    ctx.strokeStyle = col;
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  /* ---------- B：案内付き打点（手で打つ） ----------
     ★ 手で打つは「自動追跡の保険」ではない。★
     シールを貼れない対象（落ちる紙、水の流れ、人の動き）では、7回タップの
     ほうが追跡の設定より速い。Aと対等に並べてある。

     ★ 打つコマは、ステップ4が選ぶコマそのものにすること。★
     以前は「打点したら N コマ進む」という別の数で送っていたので、2コマおきに
     打った生徒の点が、ステップ4で4コマおきが選ばれると**半分捨てられていた**。
     誰も気づかない。同じ数にすれば、打ち終わった時点で「打った点＝使う点」が
     定義上一致し、ステップ4も同時に済む。

     ★ 素直に「区間÷n」で割らないこと。★
     31コマ（span 30）で7点なら 30÷7≒4.3→4コマおきとなり、7点で24コマぶん、
     7コマ余って最後の点が運動の途中で終わる。selection.setCount() は余りを
     最優先に間隔を選ぶので、同じ条件で5コマおき・7点・余り0になる。 */

  let punch = null;        // { queue:[コマ番号...], i:0 }
  let punchBusy = false;   // コマの移動中。ここで打たせると1つ前のコマに入る

  function punchCount() { return Math.max(3, Math.min(20, +$('#punchCount').value || 7)); }

  /** スライダーを動かしたとき。打つ前の下見 */
  function punchPlanned() {
    if (punch) return;
    HG.selection.setCount(punchCount());
    showPlan();
  }

  function showPlan() {
    const sel = HG.state.selection;
    const list = HG.selection.list();
    const g = HG.state.trim;
    const out = (g.outIndex === null ? HG.state.frames.length - 1 : g.outIndex);
    if (!HG.state.frames.length) { HG.dom.html('#punchPlan', ''); return; }
    if (list.length < 3) {
      HG.dom.html('#punchPlan', '<span class="warn">区間が短すぎます。トリムを広げてください。</span>');
      return;
    }
    const last = list[list.length - 1].index;
    HG.dom.html('#punchPlan',
      sel.interval + ' コマおき／コマ ' + list[0].index + ' → ' + last +
      (last >= out - Math.max(1, sel.interval * 0.6)
        ? '<span class="ok">（終点まで届きます）</span>'
        : '<span class="warn">（終点の手前で終わります）</span>'));
  }

  function punchBegin() {
    const list = HG.selection.list();
    if (list.length < 3) { alert('打つコマが3つ以上必要です。トリムを広げてください。'); return; }
    /* 自動追跡の結果が残っていると「打った点＝使う点」が崩れる。先に片付ける */
    if (HG.state.tracking.report) {
      if (!confirm('自動追跡の結果を消してから手で打ちます。よろしいですか？')) return;
      HG.tracker.clearAuto();
      HG.state.tracking.verified = false;
      HG.dom.hide('#trackAskRow'); HG.dom.hide('#trackAdvice');
      HG.dom.hide('#twoRow'); HG.dom.hide('#twoRunRow');
    }
    punch = { queue: list.map(f => f.index), i: 0 };
    $('#punchCount').disabled = true;
    HG.dom.hide('#punchStart');
    HG.dom.show('#punchStop');
    HG.dom.show('#punchBack');
    HG.pointer.setHandler(onPunch);
    gotoPunch();
  }

  async function gotoPunch() {
    if (!punch) return;
    if (punch.i >= punch.queue.length) { punchDone(); return; }
    punchBusy = true;
    await HG.frames.showFrame(punch.queue[punch.i]);
    punchBusy = false;
    const n = punch.queue.length;
    hint('物体をタップしてください（' + (punch.i + 1) + ' / ' + n + ' 点目）');
    HG.dom.html('#punchInfo',
      '<b>' + (punch.i + 1) + ' / ' + n + ' 点目</b>（コマ ' + punch.queue[punch.i] + '）' +
      '<div class="sub">打つと次のコマへ自動で進みます。</div>');
  }

  function onPunch(p) {
    if (!punch || punchBusy) return;
    HG.points.put(p.ox, p.oy);
    punch.i++;
    gotoPunch();
  }

  async function punchBack() {
    if (!punch) return;
    if (punch.i > 0) punch.i--;
    punchBusy = true;
    await HG.frames.showFrame(punch.queue[punch.i]);
    punchBusy = false;
    HG.points.removeCurrent();          // 打ち直しになるよう、その点は消す
    gotoPunch();
  }

  function punchDone() {
    const n = punch ? punch.queue.length : 0;
    endPunch();
    HG.dom.html('#punchInfo', '<span class="ok">' + n + ' 点すべて打ちました。</span>' +
      '<div class="sub">打ったコマがそのまま「使うコマ」です（ステップ4は済んでいます）。</div>');
    if (HG.steps) { HG.steps.render(); HG.steps.goTo('#strobeCard'); }
  }

  function endPunch() {
    punch = null; punchBusy = false;
    $('#punchCount').disabled = false;
    HG.dom.show('#punchStart');
    HG.dom.hide('#punchStop');
    HG.dom.hide('#punchBack');
    HG.controls.usePointHandler();
    hintDefault();
  }

  function punchCancel() {
    endPunch();
    HG.dom.html('#punchInfo', '手で打つのをやめました。打った点は残っています。');
  }

  /* ---------- 2コマ指定（ステップ3の「いいえ」から） ----------
     うまくいく素材では手順を増やさず、困った人だけが追加の1手を払う形。
     1コマ目 → 数コマ送る → 2コマ目、の3手で初速・色・大きさが決まる。 */

  /** 2コマ目へ送るコマ数。変位が見えないと初速が取れないので、1コマでは足りない */
  function twoGap() {
    const iv = HG.state.selection.interval || 3;
    return Math.max(2, Math.min(6, iv));
  }

  async function startTwo() {
    two = { p1: null, p2: null };
    HG.dom.hide('#twoRow');
    HG.dom.hide('#twoRunRow');
    HG.dom.show('#twoInfo');
    HG.dom.html('#twoInfo', '<b>1コマ目</b>：いま表示しているコマで、追いたい物体をタップしてください。' +
      'コマ送りで別のコマにしても構いません。');
    await HG.frames.showFrame(HG.state.trim.inIndex);
    startPick('two1');
  }

  async function twoGotFirst(pt) {
    two.p1 = pt;
    const to = Math.min(
      (HG.state.trim.outIndex === null ? HG.state.frames.length - 1 : HG.state.trim.outIndex),
      pt.index + twoGap());
    HG.dom.html('#twoInfo',
      '1コマ目：コマ ' + pt.index + ' <span class="ok">記録しました</span><br>' +
      '<b>2コマ目</b>：' + (to - pt.index) + ' コマ進めました。' +
      '<b>物体がはっきり動いているか確かめて</b>、同じ物体をタップしてください。' +
      '動きが小さければコマ送りでもっと先へ送ってください。');
    await HG.frames.showFrame(to);
    startPick('two2');
  }

  function twoGotSecond(pt) {
    const p1 = two.p1;
    const r = HG.tracker.setTwoFrames(p1, pt);
    /* 照準の後始末だけして、2コマ指定の内容は残す */
    aim = null; picking = null;
    HG.dom.hide('#pickRow');
    HG.pointer.setKeepBand(false);
    HG.pointer.setDownHandler(null);
    HG.pointer.setPreview(null);
    HG.loupe.hide();
    HG.controls.usePointHandler();
    hintDefault();
    HG.stage.render();

    if (!r) {
      HG.dom.html('#twoInfo', '<span class="warn">同じコマを2回指定しているようです。</span>' +
        'コマ送りで別のコマへ進めてから、もう一度やり直してください。');
      HG.dom.show('#twoRow');
      two = null;
      return;
    }
    const c = HG.state.tracking;
    const sec = r.dt;
    HG.dom.html('#twoInfo',
      '<b>決まりました。</b>' +
      '<span class="chip" style="background:' + HG.color.hsvToCss(c.target) + '"></span> ' +
      '<span class="mono">色相 ' + c.target.h.toFixed(0) + '° ±' + c.hueTol +
      '° ／ 彩度 ' + c.satMin.toFixed(2) + ' 以上</span>' +
      '<div class="sub">' + r.frames + ' コマ（' + (sec * 1000).toFixed(0) + ' ms）で ' +
      r.step.toFixed(0) + ' px 動いています。' +
      'この初速から<b>次のコマで物体が居る場所を予測して、その周りだけを探します。</b>' +
      '同じ色の別のものを拾う事故が減ります。</div>');
    HG.dom.show('#twoRunRow');
    two = null;
  }

  function clearTwo() {
    HG.tracker.clearTwoFrames();
    HG.dom.hide('#twoInfo');
    HG.dom.hide('#twoRunRow');
    HG.dom.show('#twoRow');
    two = null;
    HG.stage.render();
  }

  /* ---------- ステップ3：追跡がうまくいったか ---------- */

  /**
   * 「いいえ」のときの助言。
   * **一律に「スライダーを低くしてください」とは言えない。**
   * 背景まで拾っている場合は逆（狭める・上げる）が正しく、
   * 下げろと言うと悪化する。report の中身で分ける。
   */
  function retryAdvice(r) {
    if (!r) return '追跡の記録がありません。もう一度「自動追跡を実行」を押してください。';
    /* すでに2コマ指定で走って失敗しているなら、同じ手をもう一度勧めない */
    if (r.twoFrame) {
      if (r.maxMaskRatio > 0.5) {
        return '<b>まだ背景まで拾っています。</b>「色相の幅」を狭めてください。' +
               '背景に似た色があるときは、別の色のシールに貼り替えるのが確実です。';
      }
      return '<b>2コマ指定でも合いませんでした。</b>「彩度の下限」を少し下げてから、' +
             'もう一度実行してください。それでも駄目なら、下の「手で打つ」で直接打てます' +
             '（自動と手動は混ぜられます）。';
    }
    if (r.maxMaskRatio > 0.5) {
      return '<b>色の範囲が広すぎて、背景まで拾っています。</b>' +
             '「色相の幅」を狭めるか、「彩度の下限」を上げてください。';
    }
    if (r.tracked === 0 || r.lost.length > r.total * 0.5) {
      return '<b>シールを見つけられていません。</b>「彩度の下限」を下げ、「色相の幅」を広げてみてください。' +
             'それでも合わなければ「追う色を指定」でシールの中心をもう一度選んでください。';
    }
    if (r.elongated > Math.max(1, r.total * 0.2)) {
      return '<b>シールが細長く写っています</b>（ブレているか、同じ色の背景とつながっています）。' +
             '「色相の幅」を狭めてください。直らなければスロー（120fps 以上）で撮り直すのが確実です。';
    }
    return '<b>「彩度の下限」を下げ、「色相の幅」を広げてみてください。</b>' +
           'それでも合わなければ「追う色を指定」でシールの中心をもう一度選んでください。';
  }

  function attach() {
    /* --- ステップ2：追う色と固定マーカー --- */
    $('#pickColor').onclick = () => startPick('color');
    $('#pickMarker').onclick = () => startPick('marker');
    $('#pickDecide').onclick = () => endPick(true);
    $('#pickCancel').onclick = () => endPick(false);

    /* --- 閾値 --- */
    $('#hueTol').oninput = e => {
      HG.state.tracking.hueTol = +e.target.value;
      HG.dom.text('#hueTolVal', e.target.value + '°');
    };
    $('#satMin').oninput = e => {
      HG.state.tracking.satMin = +e.target.value / 100;
      HG.dom.text('#satMinVal', (e.target.value / 100).toFixed(2));
    };

    /* --- カメラぶれ補正の ON/OFF --- */
    $('#useMarker').onchange = e => {
      HG.state.tracking.useMarker = e.target.checked;
      HG.points.applyCorrection();
      HG.bus.emit('points:changed');
    };

    /* --- ステップ3：実行 --- */
    $('#runTrack').onclick = run;
    $('#clearTrack').onclick = () => {
      HG.tracker.clearAuto();
      HG.state.tracking.verified = false;
      HG.dom.text('#trackResult', '追跡結果を消しました（手動打点は残っています）。');
      HG.dom.hide('#gotoLost');
      HG.dom.hide('#trackAskRow');
      HG.dom.hide('#trackAdvice');
      HG.dom.hide('#twoRow');
      HG.diagnostics.render();
    };

    /* --- うまくいきましたか？ --- */
    $('#trackOk').onclick = () => {
      /* ✓ は「点が3つある」ではなく、生徒が目で見て「はい」と答えたこと。
         外れた追跡でも点は並ぶので、点の数では判定できない。 */
      HG.state.tracking.verified = true;
      HG.dom.hide('#trackAskRow');
      HG.dom.hide('#trackAdvice');
      HG.dom.hide('#twoRow');
      HG.dom.hide('#twoRunRow');
      if (HG.steps) { HG.steps.render(); HG.steps.goTo('#selectCard'); }
    };
    $('#twoStart').onclick = startTwo;
    $('#twoClear').onclick = clearTwo;
    $('#twoRun').onclick = () => { HG.dom.hide('#twoRunRow'); run(); };

    $('#trackNg').onclick = () => {
      const r = HG.state.tracking.report;
      const advice = retryAdvice(r);
      /* **先に取り消すこと。** 失敗した点が残っていると、生徒はそれを
         直そうとして手で打ち始め、自動と手動が混ざった中途半端な結果になる。 */
      HG.tracker.clearAuto();
      HG.state.tracking.verified = false;
      HG.dom.hide('#trackAskRow');
      HG.dom.hide('#gotoLost');
      HG.dom.text('#trackResult', '追跡結果を取り消しました。設定を変えてもう一度実行してください。');
      HG.dom.html('#trackAdvice', advice);
      HG.dom.show('#trackAdvice');
      /* 2コマ指定の導線。すでに2コマ指定で走って失敗しているなら出さない
         （同じ手を2回勧めることになる） */
      $('#twoRow').classList.toggle('hide', !!(r && r.twoFrame));
      HG.dom.hide('#twoInfo');
      HG.dom.hide('#twoRunRow');
      HG.diagnostics.render();
    };

    /* --- 見失ったコマへ --- */
    let lostAt = 0;
    $('#gotoLost').onclick = () => {
      const r = HG.state.tracking.report;
      if (!r || !r.lost.length) return;
      lostAt = lostAt % r.lost.length;
      HG.frames.showFrame(r.lost[lostAt++]);
    };

    /* --- B：案内付き打点 --- */
    $('#punchCount').oninput = e => {
      HG.dom.text('#punchCountVal', e.target.value + ' 点');
      punchPlanned();
    };
    $('#punchStart').onclick = punchBegin;
    $('#punchStop').onclick = punchCancel;
    $('#punchBack').onclick = punchBack;
    HG.bus.on('trim:changed', () => { if (!punch) showPlan(); });
    HG.bus.on('frames:scanned', () => { if (!punch) showPlan(); });
    HG.bus.on('selection:changed', () => { if (!punch) showPlan(); });

    /* --- 手で打つカードを開いたら、そこへ連れて行く ---
       ★ scrollIntoView を直に呼ばないこと。★ 狭い画面では貼り付いた
       キャンバスの下に見出しが潜る。さらに、帯から飛んだときは
       HG.steps.goTo() が開く → この toggle が発火 → 直の scrollIntoView が
       計算し直した位置を上書きする、という二重スクロールになっていた
       （帯を押すとズレたところへ飛ばされる、という指摘の原因）。 */
    const pc = $('#pointCard');
    if (pc) pc.addEventListener('toggle', () => {
      if (pc.open && HG.steps) HG.steps.goTo('#pointCard');
    });

    showColor();
  }

  async function run() {
    const btn = $('#runTrack');
    btn.disabled = true;
    HG.dom.hide('#trackAskRow');
    HG.dom.hide('#trackAdvice');
    HG.state.tracking.verified = false;      // 走らせ直したら答え直してもらう
    HG.dom.show('#trackBar');
    HG.dom.text('#trackResult', '追跡しています…');

    const bar = $('#trackBar').firstElementChild;
    let report = null;
    try {
      report = await HG.tracker.trackAll(p => {
        bar.style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%';
      });
    } catch (e) {
      console.error(e);
      HG.dom.text('#trackResult', '追跡中にエラーが起きました。コンソールを確認してください。');
    }

    HG.dom.hide('#trackBar');
    btn.disabled = false;
    await HG.frames.showFrame(HG.ui.current);   // 再生で動いた表示位置を戻す
    HG.diagnostics.render();

    if (!report) {
      HG.dom.text('#trackResult', '追跡するコマがありません（すべて手動打点済みか、区間が空です）。');
      return;
    }
    const lost = report.lost.length;
    HG.dom.text('#trackResult',
      (report.twoFrame ? '［2コマ指定］' : '') +
      report.total + ' コマ中 ' + report.tracked + ' コマを追跡しました' +
      (lost ? '（見失い ' + lost + ' コマ：' + report.lost.slice(0, 8).join(', ') + (lost > 8 ? ' …' : '') + '）'
            : '（見失いなし）') +
      (report.markerUsed ? '／マーカーのぶれ 最大 ' + report.markerDrift.toFixed(1) + ' px' : ''));
    $('#gotoLost').classList.toggle('hide', lost === 0);
    /* 数字では判断できない。**青丸が物体に乗っているかを見るのは生徒。**
       自動の見立て（見失い何コマ）を添えて、最後は目で決めてもらう。 */
    HG.dom.show('#trackAskRow');
    if (HG.steps) HG.steps.render();
  }

  HG.trackControls = { attach, hintDefault, paintAim, punching: () => !!punch };
})(window.HG = window.HG || {});
