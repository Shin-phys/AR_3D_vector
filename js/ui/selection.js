/* =====================================================================
   ui/selection.js — 使うコマの選択（等間隔を強制する）

   自由なコマ選択にはしない。Δt が不揃いになった瞬間に速度も加速度も
   すべて破綻するため。

   ★ つまみは「何コマおきに使うか」の1本だけ ★
   使う範囲はトリムで決まっているので、残る自由度は間隔だけでよい。
   点の数は「区間 ÷ 間隔」で決まる（上限あり）。
     間隔を狭める → 点が増える
     間隔を広げる → 点が減る
   以前は「間隔 × 個数 = 使う時間の長さ」という掛け算だったため、
   間隔を1にしても点が増えず、同じ点数が狭い範囲に密集していた。
   直感と逆で、実際に使ってもらって分からないと言われた設計。

   区間の末尾に出る端数は**捨てる**。最後の1区間だけ短くすると Δt が
   不揃いになり、その1点のために前後3本の Δv が壊れる。捨てたことは
   「余り◯コマは使いません」と必ず表示する（黙って切ると不具合に見える）。
   端数を前に出したいときは「開始をずらす」で 0〜間隔-1 の範囲で動かす。
   ===================================================================== */
(function (HG) {
  'use strict';

  const $ = HG.$;
  let active = false;

  function sel() { return HG.state.selection; }
  function trimRange() {
    const fr = HG.state.frames;
    const inI = HG.state.trim.inIndex;
    const outI = (HG.state.trim.outIndex === null ? fr.length - 1 : HG.state.trim.outIndex);
    return { lo: inI, hi: Math.max(inI, outI) };
  }

  /**
   * 選ばれたコマ。
   * 座標が1つも無いときは座標なしのまま返す。ストロボ画像（中央値背景＋差分）は
   * 「動いた」という事実だけで作れるので、追跡できない対象でも通せるようにする。
   */
  function list() {
    const s = sel(), fr = HG.state.frames;
    if (!fr.length) return [];
    const anyFound = fr.some(f => f.found);
    const g = trimRange();
    const out = [];
    for (let i = s.startIndex; i <= g.hi; i += s.interval) {
      if (i < 0 || i >= fr.length) break;
      if (out.length >= s.count) break;          // 点が多すぎるとストロボが潰れる
      const f = fr[i];
      if (f && (f.found || !anyFound)) out.push(f);
    }
    return out;
  }

  /** 末尾に余ったコマ数（使われない分） */
  function leftover() {
    const s = sel(), g = trimRange();
    const pts = list();
    if (!pts.length) return 0;
    const last = s.startIndex + (Math.max(1, pts.length) - 1) * s.interval;
    return Math.max(0, g.hi - last);
  }

  function isActive() { return active; }

  /**
   * 座標のばらつき（ジッタ）の目安。
   * 間隔1コマの二階差分は、なめらかな運動ならほぼノイズなので、
   * その分布をジッタの代わりに使う。
   *
   * ★ 中央値だけでは足りない ★
   * 実際の授業動画では、モーションブラーで重心が数コマだけ大きく飛ぶ。
   * 中央値はその外れ値を無視するので「±9°」と出るのに、現場では
   * 矢印が2本ほど逆を向く、ということが起きた（自由落下の実測）。
   * 矢印の向きを壊すのは典型値ではなく**外れ値**なので、
   * 上側の裾（90 パーセンタイル）も併せて持ち、推奨間隔はそちらで決める。
   *   typ  … ふだんのばらつき。表示用
   *   high … 荒れるコマのばらつき。推奨間隔を決めるのはこちら
   */
  function jitterStats() {
    const f = HG.points.listInTrim();
    if (f.length < 3) return { typ: 0.3, high: 0.3 };
    const v = [];
    for (let i = 1; i < f.length - 1; i++) {
      v.push(Math.hypot(f[i + 1].x - 2 * f[i].x + f[i - 1].x,
                        f[i + 1].y - 2 * f[i].y + f[i - 1].y));
    }
    v.sort((a, b) => a - b);
    const q = r => v[Math.min(v.length - 1, Math.floor(r * v.length))] || 0;
    const typ = Math.max(0.2, q(0.5) / 2);
    /* high は「荒れるコマが Δv を何 px ずらすか」。
       二階差分そのものが既に √6σ ≒ 2.4σ 相当なので、2.4 で割っておくと
       angleUncertainty() の中で 2.4 を掛け直したときに実寸に戻る。 */
    return { typ: typ, high: Math.max(typ, q(0.9) / 2.4) };
  }

  function jitter() { return jitterStats().typ; }

  /**
   * Δv の向きの不確かさ（度）。
   * Δv は二階差分なので、座標の誤差 σ に対して Δv の誤差はおよそ √6σ ≒ 2.4σ。
   * その横ずれが角度の誤差になるので atan(2.4σ / |Δv|)。
   * この角度こそ、このアプリで生徒が見る量（矢印の向き）の精度そのもの。
   */
  function angleUncertainty(dvLen, j) {
    if (!dvLen) return 90;
    return Math.atan2(2.4 * j, dvLen) * 180 / Math.PI;
  }

  const TARGET_ANGLE = 12;   // 典型値でこれ以下
  const WORST_ANGLE  = 20;   // 荒れるコマでもこれ以下（矢印が逆を向かないための条件）
  const MIN_ARROWS   = 5;    // Δv の本数の下限。これを割るほど広げてはいけない

  /**
   * 推奨間隔。条件は3つあり、いちばん厳しいものを採る。
   *  (1) コマ間の変位がジッタの 10 倍以上       … 速度が読めるための条件
   *  (2) Δv の向きの不確かさが 12°以下          … 加速度の向きが読めるための条件
   *  (3) 荒れるコマでも 20°以下                 … 矢印が逆を向かないための条件
   *
   * 間隔を n 倍に広げると Δv は n² 倍になるのに、ジッタは変わらない。
   * つまり間隔を2倍にするだけで向きの精度は4倍良くなる。ここが効く。
   */
  function suggest() {
    const f = HG.points.listInTrim();
    const st = jitterStats();
    const j = st.typ, jh = st.high;
    if (f.length < 4) {
      return { interval: 1, ratio: 0, accRatio: 0, jitter: j, jitterHigh: jh,
               angle: 90, angleWorst: 90 };
    }
    const median = a => { a.sort((x, y) => x - y); return a[Math.floor(a.length / 2)] || 0; };

    /* 広げれば広げるほど向きは正確になるが、矢印が2本では授業にならない。
       Δv を MIN_ARROWS 本は残せる範囲でしか広げない。 */
    const mMax = Math.max(1, Math.floor((f.length - 1) / (MIN_ARROWS + 1)));
    let firstOk1 = null, bestSoFar = null;
    for (let m = 1; m <= Math.min(120, mMax); m++) {
      const disp = [], acc = [];
      for (let i = 0; i + m < f.length; i++) {
        disp.push(Math.hypot(f[i + m].x - f[i].x, f[i + m].y - f[i].y));
      }
      for (let i = m; i + m < f.length; i++) {
        acc.push(Math.hypot(f[i + m].x - 2 * f[i].x + f[i - m].x,
                            f[i + m].y - 2 * f[i].y + f[i - m].y));
      }
      const dMed = median(disp), aMed = median(acc);
      const interval = (f[m].index - f[0].index) || m;
      const r = {
        interval: interval, ratio: dMed / j, accRatio: aMed / j,
        jitter: j, jitterHigh: jh,
        angle: angleUncertainty(aMed, j),
        angleWorst: angleUncertainty(aMed, jh),
        accWeak: false
      };
      if (dMed >= 10 * j && !firstOk1) firstOk1 = r;
      if (!bestSoFar || r.angleWorst < bestSoFar.angleWorst) bestSoFar = r;
      if (dMed >= 10 * j && r.angle <= TARGET_ANGLE && r.angleWorst <= WORST_ANGLE) return r;
    }
    /* どの間隔でも条件を満たさないときは、いちばんマシな間隔を返す。
       1コマおきに落とすと、いちばん荒れる間隔を勧めることになってしまう。 */
    const fb = bestSoFar || firstOk1;
    if (fb) { fb.accWeak = true; return fb; }
    return { interval: 1, ratio: 0, accRatio: 0, jitter: j, jitterHigh: jh,
             angle: 90, angleWorst: 90, accWeak: true };
  }

  /** いま選んでいる間隔での Δv の大きさと角度不確かさ */
  function current() {
    const p = list().filter(f => f.found);
    const st = jitterStats();
    if (p.length < 3) return { dv: 0, angle: 90, angleWorst: 90, jitter: st.typ, jitterHigh: st.high };
    const a = [];
    for (let i = 1; i < p.length - 1; i++) {
      a.push(Math.hypot(p[i + 1].x - 2 * p[i].x + p[i - 1].x,
                        p[i + 1].y - 2 * p[i].y + p[i - 1].y));
    }
    a.sort((x, y) => x - y);
    const med = a[Math.floor(a.length / 2)] || 0;
    return {
      dv: med, jitter: st.typ, jitterHigh: st.high,
      angle: angleUncertainty(med, st.typ),
      angleWorst: angleUncertainty(med, st.high)
    };
  }

  /* ---------- 加速度プレビュー（stage の painter） ---------- */
  /* 既定で切ってある。教師が授業前に間隔を決めるための表示で、
     生徒に見せると作図の前に答えが出てしまう。 */
  let preview = false;

  function drawPreview(ctx) {
    if (!active || !preview) return;
    if (HG.draw && HG.draw.active()) return;
    const s = list().filter(f => f.found);
    if (s.length < 3) return;
    const strobe = HG.stage.mode() === 'strobe';
    const at = f => strobe ? { x: f.x, y: f.y } : { x: f.rawX, y: f.rawY };
    const pos = f => { const q = at(f); return HG.coords.toCanvas(q.x, q.y); };

    const dv = [];
    for (let i = 1; i < s.length - 1; i++) {
      dv.push({
        at: s[i],
        dx: (s[i + 1].x - s[i].x) - (s[i].x - s[i - 1].x),
        dy: (s[i + 1].y - s[i].y) - (s[i].y - s[i - 1].y)
      });
    }
    const lens = dv.map(d => Math.hypot(d.dx, d.dy)).sort((a, b) => a - b);
    const med = lens[Math.floor(lens.length / 2)] || 0;
    const j = jitter();

    if (med < 3 * j) {
      dv.forEach(d => { const p = pos(d.at); HG.arrows.dot(ctx, p.x, p.y, { color: '#ff7a00' }); });
      const p0 = pos(dv[0].at);
      ctx.save();
      ctx.font = (13 * HG.view.dpr) + 'px sans-serif';
      ctx.lineWidth = 3 * HG.view.dpr;
      ctx.strokeStyle = 'rgba(0,0,0,.75)';
      ctx.fillStyle = '#ff9a3c';
      const txt = 'Δv ≒ 0（ばらつき ±' + med.toFixed(1) + ' px）';
      ctx.strokeText(txt, p0.x, p0.y - 18 * HG.view.dpr);
      ctx.fillText(txt, p0.x, p0.y - 18 * HG.view.dpr);
      ctx.restore();
      return;
    }

    const target = HG.state.video.width * 0.10;
    const k = target / med;
    dv.forEach(d => {
      const q = at(d.at);
      const a = HG.coords.toCanvas(q.x, q.y);
      const b = HG.coords.toCanvas(q.x + d.dx * k, q.y + d.dy * k);
      HG.arrows.draw(ctx, a.x, a.y, b.x, b.y,
        { color: '#ff7a00', width: 2.5, head: 10, alpha: 0.95 });
    });
  }

  /* ---------- UI ---------- */
  function clampToTrim() {
    const s = sel(), g = trimRange();
    if (s.interval < 1) s.interval = 1;
    if (s.offset === undefined) s.offset = 0;
    s.offset = Math.max(0, Math.min(s.interval - 1, s.offset));
    s.startIndex = g.lo + s.offset;

    /* 間隔スライダの上限は区間の長さから決める。
       固定の 30 だと、iPhone のスロー撮影（240fps で 1000 コマ超）のときに
       いちばん粗くしても点が密すぎた。

       以前は「区間 ÷ 6」＝最低7点を残す設定だったが、逐次方式で作図するように
       なってからは Δv が5本も要らない（一次元なら3本で「Δv が一定」は言える）。
       しかも実寸で描くようになったので、**点を減らすほど1本あたりの矢印が
       長くなって描きやすい**。29コマの素材で上限が4コマおきに張り付いて
       身動きが取れなかったため、区間 ÷ 3（最低4点＝2組）まで緩める。 */
    const span = g.hi - g.lo + 1;
    const imax = Math.max(2, Math.min(120, Math.floor(span / 3)));
    $('#selInterval').max = imax;
    if (s.interval > imax) s.interval = imax;

    $('#selInterval').value = s.interval;
    const off = $('#selOffset');
    off.min = 0; off.max = Math.max(0, s.interval - 1); off.value = s.offset;
    off.disabled = (s.interval <= 1);
    $('#selCount').value = s.count;
    /* 「打つ点の数」とステップ4の「使う点の数」は同じ数。別々に持たせると、
       2コマおきに打った点が4コマおきの選択で半分捨てられる（以前そうだった） */
    { const pc = $('#punchCount'); if (pc) pc.value = s.count; }
    HG.dom.text('#punchCountVal', s.count + ' 点');
  }

  function refreshLabels() {
    const s = sel(), g = trimRange();
    HG.dom.text('#selIntervalVal', s.interval + ' コマおき');
    HG.dom.text('#selOffsetVal', s.offset + ' コマ');
    HG.dom.text('#selCountVal', s.count + ' 点');

    const p = list();
    const span = g.hi - g.lo + 1;
    const rest = leftover();
    const dt = p.length > 1 ? (p[1].t - p[0].t) : 0;
    const capped = (p.length >= s.count);
    /* 「点が区間の最初から最後まで行き渡っているか」をここで言う。
       ステップ4で生徒に確かめてほしいのはこれ。 */
    const reach = rest <= Math.max(1, s.interval * 0.6);
    HG.dom.html('#selInfo', p.length
      ? '区間 ' + span + ' コマ／' + s.interval + ' コマおき → <b>' + p.length + ' 点</b>' +
        '／点の間隔 ' + (dt * 1000).toFixed(0) + ' ms<br>' +
        (reach ? '<span class="ok">最後の点が区間の終わりまで来ています。</span>'
               : '<span class="warn">終わりの ' + rest + ' コマが余っています。' +
                 '点の数を変えるか、トリムし直してください。</span>')
      : '座標のあるコマがありません。先に追跡か手動打点をしてください。');
  }

  function apply() {
    clampToTrim();
    refreshLabels();
    active = true;
    if (userTouched) showSuggestion();
    HG.refresh();
    HG.bus.emit('selection:changed');
  }

  /** スライダから指を離したとき（ここでストロボを作り直す） */
  function commit() {
    apply();
    HG.bus.emit('selection:committed');
  }

  let userTouched = false;
  function showSuggestion() {
    const f = HG.points.listInTrim();
    if (f.length < 4) { HG.dom.text('#selSuggest', ''); return; }
    const g = suggest();
    /* **「推奨の間隔」は出さない。** 点の数から間隔を逆算するようになったので、
       別の間隔を勧めても押せないし、推奨は精度だけを見ていて「点が運動の
       途中で終わる」ことを気にしていなかった。残すのは精度の数字だけ。 */
    if (!userTouched) {
      setCount(sel().count);
      apply();
    }
    /* ★ 平常時は何も出さない。★ 以前は「いまの7点：±2°／荒れるコマで ±9°」を
       常時出していたが、読み方の説明が要る数字を生徒の導線に置いても使われない。
       **矢印が逆を向く素材だけ**を止めたいので、荒れるコマで ±45°を超えたときと、
       素材そのものが苦しいときだけに絞る。平常時の数字は診断カードにある。 */
    const cur = current();
    let warn = '';
    if (cur.angleWorst > 45) {
      warn += '<span class="warn">荒れるコマでのばらつきが ±' + cur.angleWorst.toFixed(0) +
              '° あります。このままだと、ブレたコマの矢印が逆を向くことがあります。' +
              '<b>点の数を減らしてください。</b></span>';
    }
    if (g.accWeak) {
      warn += (warn ? '<br>' : '') +
              '<span class="warn">この素材では、どの間隔でも Δv がジッタと同じくらいの' +
              '大きさにとどまります。間隔を変えても改善しない場合は、素材の側の性質です。</span>';
    }
    HG.dom.html('#selSuggest', warn);
    HG.bus.emit('quality:changed');
  }

  /**
   * 同じ場所を通り直しているか（振り子・バネ・円運動のような往復・周期運動）。
   *
   * 1周期ぶんをそのまま選ぶと、往路と復路の点が重なり、矢印が同じ位置に
   * 2本ずつ描かれて読めなくなる。単振り子で実際にそうなった。
   * 「端から端まで（半周期）」に切ってもらうための判定。
   *
   * @returns {{revisit:number, ratio:number}} 通り直した点の数と割合
   */
  function revisits() {
    const p = list().filter(f => f.found);
    if (p.length < 6) return { revisit: 0, ratio: 0 };
    const gaps = [];
    for (let i = 0; i < p.length - 1; i++) {
      gaps.push(Math.hypot(p[i + 1].x - p[i].x, p[i + 1].y - p[i].y));
    }
    gaps.sort((a, b) => a - b);
    const gap = gaps[Math.floor(gaps.length / 2)] || 1;
    const near = gap * 0.7;
    let hit = 0;
    for (let i = 0; i < p.length; i++) {
      for (let k = i + 3; k < p.length; k++) {      // 隣接は当然近いので飛ばす
        if (Math.hypot(p[k].x - p[i].x, p[k].y - p[i].y) < near) { hit++; break; }
      }
    }
    return { revisit: hit, ratio: hit / p.length };
  }

  /** 各点の速さ（前後差分。端は片側差分） */
  function speeds(p) {
    return p.map((f, i) => {
      const lo = Math.max(0, i - 1), hi = Math.min(p.length - 1, i + 1);
      const n = hi - lo;
      return n ? Math.hypot(p[hi].x - p[lo].x, p[hi].y - p[lo].y) / n : 0;
    });
  }

  /**
   * 折り返し点（速さが最小の点）がどこにあるか。
   *
   * ★ このアプリでいちばん見せたい1点 ★
   * 単振り子やバネの端では「速度はほぼゼロなのに Δv は最大」になる。
   * 「速度がゼロなら加速度もゼロ」という思い込みを壊すのはこの1点。
   *
   * ところが Δv は前後の速度が要るので、**区間の両端には作れない**。
   * 端から端まできっちりトリムすると、折り返し点がちょうど区間の端に来て、
   * いちばん見せたい矢印だけが消える。合成した振り子で実際にそうなった。
   *   端ぴったり  … 折り返しの点そのものが無い
   *   少し外まで  … 速さ 0.4px／|Δv| 25.6px（その区間で最大）の点が出る
   *
   * ただし「端が遅い」だけでは自由落下と見分けがつかない。
   * 自由落下も静止から始まるので最初の点がいちばん遅いが、あれは折り返しでは
   * なく、手前まで伸ばしても（手に持っている間の a=0 が入るだけで）意味が無い。
   * 見分けるのは**両端とも遅いか**。端から端までの往復を切り取ると、
   * 速さは真ん中で最大・両端で最小になる。自由落下は片側だけが遅い。
   * 振り子・バネのプリセットを選んでいるときは、片側だけでも知らせる。
   *
   * @returns {{index:number, speed:number, medSpeed:number, atEdge:boolean,
   *            bothEdgesSlow:boolean}|null}
   */
  function turningPoint() {
    const p = list().filter(f => f.found);
    if (p.length < 4) return null;
    const sp = speeds(p);
    const sorted = sp.slice().sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)] || 1;
    let mi = 0;
    for (let i = 1; i < sp.length; i++) if (sp[i] < sp[mi]) mi = i;
    if (sp[mi] >= med * 0.5) return null;

    const both = sp[0] < med * 0.5 && sp[sp.length - 1] < med * 0.5;
    const pre = HG.state.preset;
    const oscillatory = !!(pre && (pre.id === 'pendulum' || pre.id === 'spring'));
    const atEdge = (mi === 0 || mi === p.length - 1) && (both || oscillatory);
    return { index: mi, speed: sp[mi], medSpeed: med,
             atEdge: atEdge, bothEdgesSlow: both };
  }

  /** 外から間隔を決める。手動で触ったのと同じ扱いにする */
  function setIntervalTo(n) {
    userTouched = true;
    sel().interval = Math.max(1, Math.round(n));
    sel().offset = 0;
    commit();
  }

  /**
   * **点の数が主、間隔は従。**
   *
   * 作図で決めたいのは「何点使うか」であって「何コマおきか」ではない。
   * しかも実寸で描くので、**点の間隔がそのまま矢印の長さ**になる。
   * 点の数から間隔を逆算すれば、点は必ずトリム区間の最初から最後までに
   * 行き渡り、最後の点が運動の終わりに来る。微調整が要らなくなる。
   *
   * 以前は間隔が主で、点の数は「上限」だった。その設計だと、推奨された間隔が
   * 運動の途中で終わってしまい、生徒が自分で間隔を詰め直すことになっていた。
   */
  function setCount(n) {
    const g = trimRange();
    const want = Math.max(3, Math.round(n));
    const span = Math.max(1, g.hi - g.lo);

    /* 間隔は整数コマなので、span / (want-1) をそのまま丸めると端数が出て、
       最後の点が区間の終わりまで届かない（29コマで7点にすると、間隔5で
       6点・3コマ余り、という実測）。
       そこで候補の間隔を総当たりし、**余りを最優先、次に希望の点数との差**で
       選ぶ。希望が7点でも、8点なら余り0で収まるならそちらを採る。
       点の数は結果の値に合わせて書き戻すので、表示は実際の点数になる。 */
    let best = null;
    for (let m = 1; m <= span; m++) {
      const cnt = Math.floor(span / m) + 1;
      if (cnt < 3) break;
      if (Math.abs(cnt - want) > 1) continue;
      const rest = span - m * (cnt - 1);
      const score = rest + 2 * Math.abs(cnt - want);
      if (!best || score < best.score) best = { m: m, cnt: cnt, score: score };
    }
    if (!best) {
      const m = Math.max(1, Math.round(span / (want - 1)));
      best = { m: m, cnt: Math.min(want, Math.floor(span / m) + 1) };
    }
    sel().interval = best.m;
    sel().count = best.cnt;
    sel().offset = 0;
    return sel().interval;
  }

  function setCountTo(n) { userTouched = true; setCount(n); commit(); }

  function attach() {
    $('#selInterval').oninput = e => { userTouched = true; sel().interval = +e.target.value; apply(); };
    $('#selInterval').onchange = commit;
    $('#selOffset').oninput = e => { userTouched = true; sel().offset = +e.target.value; apply(); };
    $('#selOffset').onchange = commit;
    $('#selCount').oninput = e => { userTouched = true; setCount(+e.target.value); apply(); };
    $('#selCount').onchange = commit;
    $('#showPreview').onchange = e => { preview = e.target.checked; HG.refresh(); };

    HG.bus.on('points:changed', showSuggestion);
    /* ★ 区間が変われば、使うコマは必ず取り直すこと。★
       以前は「点が4つ以上あるとき」しか取り直していなかった。点を打つ前に
       区間を決める導線（手で打つ）では、使うコマが区間の外に残ったままになり、
       案内付き打点が区間外のコマへ連れて行っていた。 */
    HG.bus.on('trim:changed', () => {
      if (!userTouched) setCount(sel().count);
      apply();
    });
  }

  HG.selection = { attach, list, isActive, suggest, current, jitterStats, revisits, turningPoint,
                   leftover, drawPreview, apply, commit, refreshLabels,
                   setInterval: setIntervalTo, setCount: setCountTo };
})(window.HG = window.HG || {});
