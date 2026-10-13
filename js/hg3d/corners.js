/* =====================================================================
   hg3d/corners.js — ステップ2「紙の四隅を押す」（4-A の基準）

   四隅のタップには、2D で作った**2段階の照準＋ルーペの帯**をそのまま使う
   （3D仕様.md §4-A）。タップで照準を置く → 指でずらして微調整 → 決定。
   ルーペは常にキャンバスの下の帯に出す（指で隠れない）。
   2D の色選択でタップ1回で確定させていたら、生徒は指で隠れた場所を
   見ないまま確定していた。同じ失敗をしないため。

   ★ 押す順は「長い辺の端から一周」。★
   長い辺と短い辺の取り違えを画像から見抜く案は、四隅が 2 px ずれるだけで
   当たらなくなったので落とした（geom.js の「カメラの姿勢」）。代わりに、
   押し終わったら各辺に寸法を書いて見せ、生徒の目で確かめてもらう。
   違っていたら「入れ替える」1回で直る。

   ★ 四隅は1つのコマで押す。★ ターンテーブルでは紙が盤と一緒に回るので、
   途中でコマを送ると別の位置の角が混ざる。コマが変わったら最初からやり直す。
   （平面そのものは動かないので、どのコマで押しても射影変換は同じになる）
   ===================================================================== */
(function (HG) {
  'use strict';

  const $ = HG.$;
  let pick = null;      // { kind:'corners'|'plumb', pts:[{x,y}], frame }
  let aim = null;       // { x, y } 元解像度（画像上の実位置）
  const ORD = ['1つ目', '2つ目', '3つ目', '4つ目'];

  function S() { return HG.recon.state; }

  function hint(t) {
    const h = $('#hint');
    h.textContent = t;
    h.classList.remove('fade');
  }

  function start(kind) {
    if (!HG.state.frames.length) return;
    kind = kind === 'plumb' ? 'plumb' : kind === 'ref6' ? 'ref6' : 'corners';
    if (kind === 'plumb' && !HG.recon.ready()) {
      HG.dom.html('#plumbInfo', '<span class="warn">先に紙の四隅を押してください。</span>');
      return;
    }
    /* 動画のコマの上で押す（色選択と同じく、描き直してから） */
    try { HG.frames.drawToOffscreen(); } catch (e) { /* 動画が無ければ何もしない */ }
    pick = { kind: kind, pts: [], frame: HG.ui.current };
    aim = null;
    HG.dom.show('#cornerPickRow');
    HG.dom.hide('#cornerStart');
    HG.dom.hide('#refStart');
    HG.pointer.setKeepBand(true);
    HG.pointer.setDownHandler(p => moveAim(p.ox, p.oy));
    HG.pointer.setHandler(p => moveAim(p.ox, p.oy));
    HG.pointer.setPreview((from, p) => moveAim(p.ox, p.oy));
    HG.loupe.band(true);
    prompt();
    HG.stage.render();
    /* 帯が出て貼り付くブロックが厚くなるので、「決定」が隠れないところまで送る */
    /* PC（2カラム）では画面は動かさない。押している最中に画面が流れると、狙った角がずれる */
    if (window.innerWidth < 900) setTimeout(() => { if (HG.steps) HG.steps.goTo('#cornerPickRow'); }, 60);
    HG.dom.hide('#plumbStart');
  }

  function prompt() {
    const i = pick.pts.length;
    if (pick.kind === 'plumb') {
      HG.dom.text('#cornerDecide', (i === 0 ? '糸の上の点' : '糸の下の点') + 'を決定');
      hint(i === 0 ? '糸の上のほうの点を押してください' : '同じ糸の、下のほう（おもりの近く）を押してください');
      HG.dom.html('#loupeInfo', '<div class="sub"><b>' + (i === 0 ? '糸の上' : '糸の下') + '</b>：' +
        '糸の真ん中に合わせます。2点は離れているほど正確です。</div>');
      return;
    }
    if (pick.kind === 'ref6') {
      /* 2台のカメラ（ステレオ）の基準：L字の角6つ。立てた紙の左上から時計回り（stereo.js） */
      const name = HG.stereo.ORDER[i];
      HG.dom.text('#cornerDecide', (i + 1) + '. ' + name + 'を決定');
      hint((i + 1) + ' / 6：' + name + 'の角を押してください');
      HG.dom.html('#loupeInfo', '<div class="sub"><b>' + (i + 1) + '. ' + name + '</b>' +
        (i === 0 ? '：立てた紙の左上の角。ここから時計回りに6つ。' : i === 2 || i === 5 ? '：机の紙と立てた紙の境目（折り目）の端。' : '') + '</div>');
      return;
    }
    HG.dom.text('#cornerDecide', ORD[i] + 'の角を決定');
    hint(i === 0 ? '紙の角を押してください（長い辺の端から）'
       : i === 1 ? '同じ長い辺の、反対の端の角を押してください'
       : '続けて、一周する順に次の角を押してください');
    HG.dom.html('#loupeInfo', '<div class="sub"><b>' + ORD[i] + 'の角</b>' +
      (i === 0 ? '：長い辺の端の角をタップ。指でずらして角に合わせます。'
       : i === 1 ? '：<b>同じ長い辺</b>の反対の端。' : '：一周する順に。') + '</div>');
  }

  function moveAim(ox, oy) {
    if (!pick) return;
    aim = { x: ox, y: oy };
    HG.stage.render();
    const c = HG.coords.toCanvas(ox, oy);
    HG.loupe.show({ cx: c.x, cy: c.y }, { dock: true, keepBand: true, cross: true });   // 中心の細い十字はルーペが描く
  }

  function decide() {
    if (!pick) return;
    if (!aim) { HG.dom.html('#loupeInfo', '<span class="warn">先に画面をタップしてください。</span>'); return; }
    if (HG.ui.current !== pick.frame) {
      /* 紙が回っていると、別のコマの角が混ざる */
      pick.pts = []; pick.frame = HG.ui.current; aim = null;
      HG.dom.html(pick.kind === 'ref6' ? '#refInfo' : '#cornerInfo', '<span class="warn">途中でコマが変わったので、このコマで最初から押し直します。</span>');
      prompt(); HG.stage.render();
      return;
    }
    pick.pts.push({ x: aim.x, y: aim.y });
    aim = null;
    const need = pick.kind === 'plumb' ? 2 : pick.kind === 'ref6' ? 6 : 4;
    if (pick.pts.length < need) { prompt(); HG.stage.render(); return; }
    if (pick.kind === 'plumb') finishPlumb();
    else if (pick.kind === 'ref6') finishRef6();
    else finish();
  }

  function finishRef6() {
    const pts = pick.pts, frame = pick.frame;
    end();
    HG.stereo.setTaps(pts, frame);
    HG.stage.render();
    if (HG.steps) { HG.steps.render(); HG.steps.goTo('#refCard'); }
  }

  function finishPlumb() {
    const pts = pick.pts, frame = pick.frame;
    end();
    if (Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) < 20) {
      HG.dom.html('#plumbInfo', '<span class="warn">2点が近すぎます。糸の上と下を離して押してください。</span>');
      return;
    }
    HG.recon.setPlumb(pts, frame);
    solve();
    HG.stage.render();
  }

  function finish() {
    const pts = pick.pts, frame = pick.frame;
    end();
    HG.recon.setCorners(pts, frame);
    const r = solve();
    if (!r.ok) {
      HG.recon.clearCorners();
      HG.dom.html('#cornerInfo', '<span class="warn">' +
        (r.reason === 'order' ? '四隅が一周する順になっていません（対角の角を続けて押したようです）。'
                              : '四隅から紙の向きを決められませんでした。') +
        '</span>もう一度「四隅を押す」からやり直してください。');
    }
    HG.stage.render();
    if (HG.steps) { HG.steps.render(); if (r.ok) HG.steps.goTo('#cornerCard'); }
  }

  function end() {
    pick = null; aim = null;
    HG.dom.hide('#cornerPickRow');
    HG.dom.show('#cornerStart');
    HG.dom.show('#refStart');
    HG.dom.show('#plumbStart');
    HG.pointer.setKeepBand(false);
    HG.pointer.setDownHandler(null);
    HG.pointer.setPreview(null);
    HG.loupe.hide();
    HG.controls.usePointHandler();
    if (HG.trackControls) HG.trackControls.hintDefault();
    HG.stage.render();
  }

  /** 射影変換を作り直して、結果を書く。紙の寸法や補正を変えたときも呼ぶ */
  function solve() {
    if (S().corners.length !== 4) { info(); return { ok: false, reason: 'count' }; }
    const r = HG.recon.solve(HG.state.video.width, HG.state.video.height);
    info();
    HG.bus.emit('corners:changed');
    return r;
  }

  function plumbInfo() {
    const st = S();
    $('#plumbBox').classList.toggle('hide', st.plane !== 'vertical');
    $('#plumbClear').classList.toggle('hide', st.plumb.length !== 2);
    $('#plumbStart').textContent = st.plumb.length === 2 ? '糸の2点を押し直す' : '糸の2点を押す';
    if (st.plane !== 'vertical') return;
    if (!HG.recon.ready()) { HG.dom.html('#plumbInfo', ''); return; }
    if (st.downSource === 'plumb') {
      /* 糸が画面の真下からどれだけ傾いて写っているか（スマホの傾きの目安） */
      const pl = st.plumb, ang = Math.atan2(pl[1].x - pl[0].x, pl[1].y - pl[0].y) * 180 / Math.PI;
      HG.dom.html('#plumbInfo', '<span class="ok">糸で鉛直を決めました。</span>' +
        '<span class="sub">（画面の上では、真下から ' + Math.abs(ang).toFixed(1) + '° 傾いて写っています）</span>');
    } else {
      HG.dom.html('#plumbInfo', '<span class="warn">糸がまだ無いので、画面の下を鉛直下向きとみなしています。</span>' +
        '<div class="sub">スマホを傾けて構えていると、そのぶん「下」がずれます（合成データで、4° 傾けると Δv の向きが約 4° ずれた）。</div>');
    }
  }

  function info() {
    plumbInfo();
    const st = S();
    $('#cornerRedo').classList.toggle('hide', st.corners.length !== 4);
    $('#cornerSwap').classList.toggle('hide', st.corners.length !== 4);
    $('#cornerStart').textContent = st.corners.length === 4 ? '四隅を押し直す' : '四隅を押す';
    if (st.corners.length !== 4 || !HG.recon.ready()) { if (!pick) HG.dom.html('#cornerInfo', ''); return; }
    const p = HG.recon.precision();
    /* 見積もりであることを数字の前に書く（測った値と混ぜない） */
    HG.dom.html('#cornerInfo',
      '<span class="ok">四隅を決めました（コマ ' + st.cornerFrame + '）。</span>' +
      '<div class="spaced-sm"><b>画面の紙の縁に書いた寸法が、実際の辺と合っているか</b>確かめてください。' +
      '長い辺に ' + (st.paper.w * 100).toFixed(1) + ' cm と出ていれば合っています。</div>' +
      '<div class="sub spaced-sm">見積もり：紙は画面上で長い辺 ' + p.longPx.toFixed(0) + ' px ／ 短い辺 ' +
      p.shortPx.toFixed(0) + ' px。四隅を 2 px ずれて押すと、大きさが最大 ' + p.errPct.toFixed(1) +
      '% ずれます（向きへの影響は ' + (p.errPct * 0.57).toFixed(1) + '° 程度）。</div>');
  }

  /** 画面に四隅と寸法を描く（stage の painter） */
  function paint(ctx) {
    const st = S(), dpr = HG.view.dpr;
    const pts = pick ? pick.pts : st.corners;
    const here = pick ? true : (st.cornerFrame === HG.ui.current);
    ctx.save();
    if (pts.length) {
      ctx.lineWidth = 2.5 * dpr;
      ctx.strokeStyle = here ? 'rgba(255,212,0,.95)' : 'rgba(255,212,0,.45)';
      if (!here) ctx.setLineDash([6 * dpr, 6 * dpr]);
      ctx.beginPath();
      pts.forEach((p, i) => { const c = HG.coords.toCanvas(p.x, p.y); i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y); });
      if (!pick && pts.length === 4) ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      /* 辺の寸法（押し終わったときだけ）。長い辺と短い辺を生徒の目で確かめる */
      if (!pick && pts.length === 4 && here) {
        const L = [st.paper.w, st.paper.h, st.paper.w, st.paper.h];
        for (let i = 0; i < 4; i++) {
          const a = HG.coords.toCanvas(pts[i].x, pts[i].y), b = HG.coords.toCanvas(pts[(i + 1) % 4].x, pts[(i + 1) % 4].y);
          tag(ctx, (a.x + b.x) / 2, (a.y + b.y) / 2, (L[i] * 100).toFixed(1) + ' cm', i % 2 === 0);
        }
      }
      pts.forEach((p, i) => {
        const c = HG.coords.toCanvas(p.x, p.y);
        ctx.fillStyle = 'rgba(255,212,0,.95)';
        ctx.beginPath(); ctx.arc(c.x, c.y, 4 * dpr, 0, Math.PI * 2); ctx.fill();
        tag(ctx, c.x + 12 * dpr, c.y - 12 * dpr, String(i + 1), false);
      });
    }
    /* 糸（鉛直の基準）。押している最中は押した点、決めたあとは下向きの矢印と「下」 */
    const pl = (pick && pick.kind === 'plumb') ? pick.pts : (st.plane === 'vertical' ? st.plumb : []);
    if (pl.length) {
      ctx.fillStyle = 'rgba(0,200,255,.95)';
      const a = HG.coords.toCanvas(pl[0].x, pl[0].y);
      ctx.beginPath(); ctx.arc(a.x, a.y, 4 * dpr, 0, Math.PI * 2); ctx.fill();
      if (pl.length === 2) {
        const b = HG.coords.toCanvas(pl[1].x, pl[1].y);
        HG.arrows.draw(ctx, a.x, a.y, b.x, b.y, { color: 'rgba(0,200,255,.95)', width: 2.5, head: 10 });
        tag(ctx, b.x + 18 * dpr, b.y + 18 * dpr, '下', true);
      }
    }
    if (pick && aim) {
      const c = HG.coords.toCanvas(aim.x, aim.y);
      /* 中心を大きく空ける。ルーペはこの絵ごと拡大するので、十字が太いと
         拡大像の中で角そのものを隠してしまう（実際にそうなった） */
      const g0 = 11 * dpr, g1 = 30 * dpr;
      ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 3 * dpr;
      for (let pass = 0; pass < 2; pass++) {
        if (pass) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4 * dpr; }
        ctx.beginPath();
        ctx.moveTo(c.x - g1, c.y); ctx.lineTo(c.x - g0, c.y);
        ctx.moveTo(c.x + g0, c.y); ctx.lineTo(c.x + g1, c.y);
        ctx.moveTo(c.x, c.y - g1); ctx.lineTo(c.x, c.y - g0);
        ctx.moveTo(c.x, c.y + g0); ctx.lineTo(c.x, c.y + g1);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function tag(ctx, x, y, text, strong) {
    const dpr = HG.view.dpr;
    ctx.font = (strong ? 'bold ' : '') + (12 * dpr) + 'px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 8 * dpr, h = 17 * dpr;
    ctx.fillStyle = strong ? 'rgba(255,212,0,.92)' : 'rgba(0,0,0,.62)';
    ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.fillStyle = strong ? '#12161c' : '#fff';
    ctx.fillText(text, x, y);
  }

  /* ---------- 紙の寸法 ---------- */
  function setPaper() {
    const v = $('#paperSel').value;
    const st = S();
    let w, h;
    if (v === 'custom') {
      w = (+$('#paperW').value || 297) / 1000; h = (+$('#paperH').value || 210) / 1000;
    } else { w = HG.recon.PAPERS[v].w; h = HG.recon.PAPERS[v].h; }
    $('#paperCustom').classList.toggle('hide', v !== 'custom');
    /* 「長い辺から押す」と言っているので、w を長いほうにそろえる */
    st.paper = { w: Math.max(w, h), h: Math.min(w, h), name: v };
    st.swapped = false;
    solve();
    HG.stage.render();
  }

  /** 短い辺から押してしまったとき。押し直さずに、寸法の割り当てを入れ替える */
  function swap() {
    const st = S();
    st.paper = { w: st.paper.h, h: st.paper.w, name: st.paper.name };
    st.swapped = !st.swapped;
    solve();
    HG.stage.render();
  }

  function attach() {
    $('#cornerStart').onclick = () => start('corners');
    $('#plumbStart').onclick = () => start('plumb');
    $('#plumbClear').onclick = () => { HG.recon.setPlumb([], null); solve(); HG.stage.render(); };
    document.querySelectorAll('input[name=plane]').forEach(r => { r.onchange = () => setPlane(r.value); });
    $('#cornerDecide').onclick = decide;
    $('#cornerCancel').onclick = () => {
      const was = pick && pick.kind;
      end();
      if (was === 'ref6') { HG.dom.html('#refInfo', '6点を押すのをやめました。'); return; }
      HG.dom.html('#cornerInfo', '四隅を押すのをやめました。');
      info();
    };
    $('#cornerRedo').onclick = () => {
      HG.recon.clearCorners();
      HG.dom.html('#cornerInfo', '');
      info(); HG.bus.emit('corners:changed'); HG.stage.render();
      if (HG.steps) HG.steps.render();
    };
    $('#cornerSwap').onclick = swap;
    $('#paperSel').onchange = setPaper;
    $('#paperW').onchange = setPaper;
    $('#paperH').onchange = setPaper;
    /* 固定マーカーの補正が変わると、四隅の補正も変わる */
    HG.bus.on('points:changed', () => { if (S().corners.length === 4) solve(); });
    info();
  }

  /** 紙を置いた面（プリセットからも呼ぶ） */
  function setPlane(p) {
    HG.recon.setPlane(p);
    document.querySelectorAll('input[name=plane]').forEach(r => { r.checked = (r.value === HG.recon.state.plane); });
    solve();
    HG.stage.render();
  }

  /** 紙の寸法を外から決める（お手本動画は答えの寸法で撮ってある） */
  function setPaperBy(key) {
    $('#paperSel').value = key;
    setPaper();
  }

  HG.corners = { attach, paint, start, picking: () => !!pick, solve, setPlane, setPaperBy };
})(window.HG = window.HG || {});
