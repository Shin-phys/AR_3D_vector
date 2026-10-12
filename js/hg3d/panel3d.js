/* =====================================================================
   hg3d/panel3d.js — ステップ6「3D で見る」の操作

   ここは「操作 → HG.viewer / HG.graph の呼び出し」の対応表。計算は
   reconstruct.js、組み立ては content.js、表示は viewer.js が持つ。

   ★ ボタン名・ガイド文に結論を書かない（3D仕様.md §5）。★
   「影は単振動」ではなく「壁に影を落とす」。解説（preset.note）は、
   Δv と壁の影の両方を自分で出したあとにだけ出す。

   ★ 最初に開いたときは「撮影位置」から始めて「斜め」へ回り込む。★
   動画と同じ見え方から連続的に回るので、3D の点が動画のどの点なのかを
   見失わない（視点を瞬間移動させない、と同じ理由）。
   ===================================================================== */
(function (HG) {
  'use strict';

  const $ = HG.$;
  let open = false, attached3d = false, opened = false;
  let pred = { answers: [], asking: false };
  let seen = { dv: false, wall: false };
  let play = null;

  function data() {
    return { track: HG.track3d || [], trackAll: HG.track3dAll || [], kin: HG.kin3d || { v: [], a: [] },
             paper: HG.recon.ready() ? HG.recon.paperWorld() : null };
  }

  /** 3D を開ける状態か。開けないなら理由 */
  function blocker() {
    if (!HG.recon.ready()) return '先にステップ2で<b>紙の四隅</b>を押してください。';
    const n = HG.selection.isActive() ? HG.selection.list().filter(f => f.found).length : 0;
    if (n < 3) return '先にステップ4・5で<b>座標</b>を取り、使うコマを決めてください（座標のあるコマが 3 つ以上要ります）。';
    return '';
  }

  function show3d() {
    const why = blocker();
    if (why) { HG.dom.html('#viewHint', '<span class="warn">' + why + '</span>'); return; }
    if (!attached3d) { HG.viewer.attach($('#view3d')); attached3d = true; }
    document.body.classList.add('view3d');
    open = true;
    HG.dom.hide('#open3d'); HG.dom.show('#back2d'); HG.dom.show('#viewBody');
    HG.dom.html('#viewHint', '');
    HG.viewer.start();
    HG.viewer.fit();
    recompute();
    if (!opened) {
      opened = true;
      /* 動画と同じ見え方から、斜めへ回り込む */
      HG.viewer.view('camera', true);
      setTimeout(() => setView('oblique'), 450);
      HG.dom.html('#viewGuide', 'まず<b>「真上」</b>から見て、点がどう並んでいるか確かめてください。' +
        '点がきれいに並んでいなければ、矢印も読めません。');
    }
    HG.bus.emit('view3d:opened');
    if (window.innerWidth < 900) HG.steps.goTo('#viewCard');
  }

  function back2d() {
    document.body.classList.remove('view3d');
    open = false;
    stopPlay();
    HG.viewer.stop();
    HG.dom.show('#open3d'); HG.dom.hide('#back2d');
    $('#open3d').textContent = '3D に戻る';
    HG.refresh();
  }

  /** state から 3D を作り直して、ビューアとグラフに渡す（視点は動かさない） */
  function recompute() {
    if (!open) return;
    if (blocker()) { back2d(); HG.dom.html('#viewHint', '<span class="warn">' + blocker() + '</span>'); return; }
    HG.recon.compute();
    const d = data();
    HG.viewer.setData(d);
    const s = $('#nowSlider');
    s.max = Math.max(0, d.trackAll.length - 1);
    if (+s.value > +s.max) s.value = s.max;
    setNow(+s.value);
    scaleNote();
  }

  function setNow(i) {
    const all = HG.track3dAll || [];
    if (!all.length) return;
    i = Math.max(0, Math.min(all.length - 1, i | 0));
    $('#nowSlider').value = i;
    HG.viewer.setNow(i);
    const t = (all[i].t - all[0].t).toFixed(3);
    HG.dom.text('#nowVal', 't = ' + t + ' s');
    HG.dom.text('#v3Tag', 't = ' + t + ' s');
    drawGraph();
  }

  function drawGraph() {
    const L = HG.viewer.opts.layers;
    const on = !!(L.wallBack || L.wallSide);
    $('#graphCard').classList.toggle('hide', !on || !open);
    if (!on || !open) return;
    HG.dom.html('#graphLegend', HG.graph.legend({ back: L.wallBack, side: L.wallSide }));
    HG.graph.draw(HG.track3dAll, HG.track3d, { back: L.wallBack, side: L.wallSide }, +$('#nowSlider').value);
  }

  function scaleNote() {
    const L = HG.viewer.opts.layers;
    HG.dom.text('#scaleNote', (L.vel || L.dv) ? HG.content.scaleText(HG.kin3d, HG.viewer.opts.dvZoom) : '');
  }

  function setView(name) {
    HG.viewer.view(name);
    document.querySelectorAll('#viewBtns button').forEach(b => b.classList.toggle('on', b.dataset.view === name));
  }

  /* ---------- 表示の切り替え ---------- */
  function layers() {
    const L = {
      balls: $('#lyBalls').checked, paper: $('#lyPaper').checked, grid: $('#lyPaper').checked,
      pos: $('#lyPos').checked, vel: $('#lyVel').checked, dv: $('#lyDv').checked,
      wallBack: $('#lyWallBack').checked, wallSide: $('#lyWallSide').checked
    };
    HG.viewer.setLayers(L);
    $('#dvZoomRow').classList.toggle('hide', !L.dv);
    if (L.dv) seen.dv = true;
    if (L.wallBack || L.wallSide) seen.wall = true;
    scaleNote();
    setNow(+$('#nowSlider').value);
    reveal();
  }

  /** 解説は、Δv と壁の影の両方を自分で出したあとだけ（先に読ませない） */
  function reveal() {
    const p = HG.state.preset;
    const ok = seen.dv && seen.wall && p && p.note;
    $('#revealNote').classList.toggle('hide', !ok);
    if (ok) HG.dom.html('#revealNote', '<div class="reveal-title">解説</div>' + p.note);
  }

  /* ---------- 予測（Δv を出す前に聞く） ---------- */
  function questions() { return HG.presets3d.predictions(HG.state.preset); }

  function onDv() {
    const want = $('#lyDv').checked;
    const qs = questions();
    if (want && $('#usePrediction').checked && qs.length && pred.answers.length < qs.length) {
      $('#lyDv').checked = false;
      ask();
      return;
    }
    layers();
  }

  function ask() {
    const qs = questions();
    const q = qs[pred.answers.length];
    pred.asking = true;
    HG.dom.show('#predGate');
    HG.dom.html('#predGate',
      '<div class="reveal-title">表示する前に予想してください（' + (pred.answers.length + 1) + ' / ' + qs.length + '）</div>' +
      '<div class="pred-qtext">' + q.q + '</div>' +
      q.options.map(o => '<button class="pred-opt" data-id="' + o.id + '"><b>' + o.id + '</b>' + o.label + '</button>').join(''));
  }

  function answer(id) {
    const qs = questions();
    const q = qs[pred.answers.length];
    const o = q.options.filter(x => x.id === id)[0];
    pred.answers.push({ id: id, label: o ? o.label : '' });
    if (pred.answers.length < qs.length) { ask(); return; }
    pred.asking = false;
    HG.dom.hide('#predGate');
    HG.dom.show('#predShown');
    HG.dom.html('#predShown', '<span>予測</span><span class="pred-strip-big">' +
      pred.answers.map(a => a.id).join(' ') + '</span><span>' + pred.answers.map(a => a.label).join('／') + '</span>');
    $('#lyDv').checked = true;
    layers();
  }

  /* ---------- 再生（実時間。区間を繰り返す） ---------- */
  function startPlay() {
    const all = HG.track3dAll || [];
    if (all.length < 2) return;
    let i = +$('#nowSlider').value;
    if (i >= all.length - 1) i = 0;
    const tStart = all[i].t, wall0 = performance.now();
    play = { raf: 0 };
    $('#playBtn').textContent = '■ 停止';
    const tick = now => {
      if (!play) return;
      let t = tStart + (now - wall0) / 1000;
      const span = all[all.length - 1].t - all[0].t;
      if (t > all[all.length - 1].t) t = all[0].t + ((t - all[0].t) % span);
      let k = 0;
      while (k + 1 < all.length && all[k + 1].t <= t) k++;
      setNow(k);
      play.raf = requestAnimationFrame(tick);
    };
    play.raf = requestAnimationFrame(tick);
  }
  function stopPlay() {
    if (play) cancelAnimationFrame(play.raf);
    play = null;
    $('#playBtn').textContent = '▶ 再生';
  }

  /* ---------- 書き出し ---------- */
  function csv3d() {
    if (!HG.recon.ready()) { alert('先に紙の四隅を押してください。'); return; }
    HG.recon.compute();
    const sel = new Set((HG.track3d || []).map(p => p.index));
    const rows = ['index,t_s,x_m,y_m,z_m,used'];
    (HG.track3dAll || []).forEach(p => rows.push([p.index, p.t.toFixed(4), p.x.toFixed(5), p.y.toFixed(5),
      p.z.toFixed(5), sel.has(p.index) ? 1 : 0].join(',')));
    rows.push('', '# 速度（使うコマの隣どうし。時刻は2点の中間）', 'k,t_s,vx,vy,vz');
    (HG.kin3d.v || []).forEach(v => rows.push([v.k, v.t.toFixed(4), v.vx.toFixed(4), v.vy.toFixed(4), v.vz.toFixed(4)].join(',')));
    rows.push('', '# 加速度（Δv÷Δt。時刻は r_{k+1}）', 'k,t_s,ax,ay,az');
    (HG.kin3d.a || []).forEach(a => rows.push([a.k, a.t.toFixed(4), a.ax.toFixed(4), a.ay.toFixed(4), a.az.toFixed(4)].join(',')));
    const blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'track3d.csv';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function attach() {
    $('#open3d').onclick = show3d;
    $('#back2d').onclick = back2d;
    $('#viewBtns').onclick = e => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); };
    ['#lyBalls', '#lyPaper', '#lyPos', '#lyVel', '#lyWallBack', '#lyWallSide'].forEach(s => { $(s).onchange = layers; });
    $('#lyDv').onchange = onDv;
    $('#predGate').onclick = e => { const b = e.target.closest('[data-id]'); if (b) answer(b.dataset.id); };
    $('#dvZoom').oninput = e => {
      const z = +e.target.value / 10;
      HG.dom.text('#dvZoomVal', '×' + z.toFixed(1) + (z === 1 ? '（実寸）' : ''));
      HG.viewer.setZoom(z);
      setNow(+$('#nowSlider').value);
      scaleNote();
    };
    $('#nowSlider').oninput = e => { stopPlay(); setNow(+e.target.value); };
    $('#playBtn').onclick = () => (play ? stopPlay() : startPlay());
    $('#csv3d').onclick = csv3d;
    HG.graph.attach($('#graph'), i => { stopPlay(); setNow(i); });

    /* 前半を触り直したら作り直す（開いているときだけ） */
    ['selection:changed', 'points:changed', 'corners:changed', 'trim:changed'].forEach(ev =>
      HG.bus.on(ev, () => { if (open) recompute(); }));

    let rz;
    window.addEventListener('resize', () => {
      clearTimeout(rz);
      rz = setTimeout(() => { if (open) { HG.viewer.fit(); drawGraph(); } }, 150);
    });
  }

  /** プリセットを選び直したとき（予測と「見た」記録を消す） */
  function reset() {
    pred = { answers: [], asking: false };
    seen = { dv: false, wall: false };
    HG.dom.hide('#predGate'); HG.dom.hide('#predShown'); HG.dom.hide('#revealNote');
  }

  HG.panel3d = { attach, reset, show: show3d, back: back2d, recompute, setView, setNow,
                 isOpen: () => open };
})(window.HG = window.HG || {});
