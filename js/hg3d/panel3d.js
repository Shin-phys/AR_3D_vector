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
             paper: HG.recon.ready() ? HG.recon.paperWorld() : null,
             plane: HG.recon.state.plane, plumb: HG.recon.plumbWorld() };
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
    arDetect();
    deskLabel();
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
    planeOptions();
    quality();
    HG.viewer.opts.layers.wallBack = $('#lyWallBack').checked;
    HG.viewer.opts.layers.floor = $('#lyFloor').checked;
    const d = data();
    HG.viewer.setData(d);
    const s = $('#nowSlider');
    s.max = Math.max(0, d.trackAll.length - 1);
    if (+s.value > +s.max) s.value = s.max;
    setNow(+s.value);
    scaleNote();
    deskLabel();
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
    const vert = HG.recon.state.plane === 'vertical';
    const which = vert ? { floor: !!L.floor, side: !!L.wallSide } : { back: !!L.wallBack, side: !!L.wallSide };
    const on = Object.keys(which).some(k => which[k]);
    $('#graphCard').classList.toggle('hide', !on || !open);
    if (!on || !open) return;
    HG.graph.setPlane(HG.recon.state.plane);
    HG.dom.html('#graphLegend', HG.graph.legend(which));
    HG.graph.draw(HG.track3dAll, HG.track3d, which, +$('#nowSlider').value);
  }

  /**
   * 軌道が基準の紙よりずっと広いと、紙の外で誤差がふくらむ（四隅の数 px のずれが引き伸ばされる）。
   * 合成データで測った：ボードの投射を A4 で測ると、5点で Δv の向きのずれが中央値 5.0°、
   * 模造紙の半分なら 1.5°（tools/test/unit.js）。広がりが紙の 1.8 倍を超えたら知らせる。
   */
  function quality() {
    const all = HG.track3dAll || [], pw = HG.recon.ready() ? HG.recon.paperWorld() : null;
    let msg = '';
    if (pw && all.length > 2) {
      const span = pts => { let m = 0; pts.forEach(a => pts.forEach(b => { m = Math.max(m, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)); })); return m; };
      const step = Math.max(1, Math.floor(all.length / 40));
      const ratio = span(all.filter((p, i) => i % step === 0)) / span(pw);
      if (ratio > 1.8) {
        msg = '<span class="warn">軌道が基準の紙の約 ' + ratio.toFixed(1) + ' 倍に広がっています。</span>' +
          '紙の外ほど誤差が大きくなります（合成データの見積もり：ボードの投射を A4 で測ると、5点で Δv の向きのずれが中央値 5°。' +
          '模造紙の半分なら 1.5°）。矢印の向きが乱れて見えたら、大きな紙で撮り直すか、点の数を減らしてください。';
      }
    }
    $('#qualityNote').classList.toggle('hide', !msg);
    HG.dom.html('#qualityNote', msg);
  }

  /** 面の向きで、出す影の選択肢を入れ替える（ボードの運動では奥の壁＝ボードなので出さない） */
  function planeOptions() {
    const vert = HG.recon.state.plane === 'vertical';
    $('#lyWallBackL').classList.toggle('hide', vert);
    $('#lyFloorL').classList.toggle('hide', !vert);
    if (vert) $('#lyWallBack').checked = false; else $('#lyFloor').checked = false;
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
      wallBack: $('#lyWallBack').checked, wallSide: $('#lyWallSide').checked,
      floor: $('#lyFloor').checked, arrowSh: $('#lyArrowSh').checked
    };
    HG.viewer.setLayers(L);
    $('#dvZoomRow').classList.toggle('hide', !L.dv);
    if (L.dv) seen.dv = true;
    if (L.wallBack || L.wallSide || L.floor) seen.wall = true;
    scaleNote();
    setNow(+$('#nowSlider').value);
    deskLabel();          // 壁を出すと中身が広がるので、机上サイズの倍率も変わる
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

  /* ---------- 再生（区間を繰り返す。速さは ×1〜×0.1。AR の動きも同じ速さ） ---------- */
  function speed() { return +$('#speedSel').value || 1; }
  function startPlay() {
    const all = HG.track3dAll || [];
    if (all.length < 2) return;
    let i = +$('#nowSlider').value;
    if (i >= all.length - 1) i = 0;
    const tStart = all[i].t, wall0 = performance.now(), sp = speed();
    play = { raf: 0 };
    $('#playBtn').textContent = '■ 停止';
    const tick = now => {
      if (!play) return;
      let t = tStart + (now - wall0) / 1000 * sp;
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

  /* ---------- AR（3D仕様.md §6） ----------
     ★ 方式は ar-test.html の実機の結果で決めた（README「AR の確認結果」）。★
       iPhone  … その場で USDZ を作り、blob URL のまま AR Quick Look へ（方式3）。
                 model-viewer（1 MB）は読まない。
       Android … model-viewer の WebXR（方式4）。Scene Viewer は公開 URL しか受けないので使えない。
                 AR を始めるには指で押す必要があるので、1回目は model-viewer を出すところまで。
                 生徒はその右下の AR ボタンを押す。
       どちらも無い端末では、AR の欄ごと出さない。
     中身はビューアがいま表示しているもの（content.js が組み立てた同じ Group）。
     「いま」の球と影は、動かす（実機で「静止画では人によって見えるものが違う」と分かったため。
     速さは書き出すときに決める。ar.js の「動き」の節）。 */
  const ar = { mode: null, url: null, key: '' };

  async function arDetect() {
    if (ar.mode !== null) return ar.mode;
    ar.mode = HG.ar.quickLookSupported() ? 'quicklook' : (await HG.ar.webxrSupported()) ? 'webxr' : '';
    $('#arRow').classList.toggle('hide', !ar.mode);
    return ar.mode;
  }

  /** 机上サイズは中身の大きさから決める（ar.js deskScale）。実寸は 1 */
  function arScale() {
    const r = document.querySelector('input[name=arScale]:checked');
    if (r && r.value === '1') return { k: 1, desk: false };
    return { k: HG.viewer.content() ? HG.ar.deskScale(HG.viewer.content()) : 1, desk: true };
  }
  function deskLabel() {
    if (!HG.viewer.content()) return;
    HG.dom.text('#deskVal', '（この運動では ×' + HG.ar.deskScale(HG.viewer.content()) + '）');
  }
  function arOpts(kind) {
    const s = arScale();
    return { scale: s.k, desk: s.desk, kind: kind, speed: $('#arMove').checked ? speed() : 0 };
  }

  async function arOpen() {
    const btn = $('#arBtn');
    if (!HG.viewer.content()) return;
    btn.disabled = true;
    HG.dom.text('#arInfo', 'AR 用のモデルを作っています…');
    try {
      const info = HG.viewer.exportInfo();
      if (ar.mode === 'quicklook') {
        const o = arOpts('usdz');
        const t0 = performance.now();
        const r = await HG.ar.fromViewer(info, o);
        if (ar.url) URL.revokeObjectURL(ar.url);
        ar.url = URL.createObjectURL(r.blob);
        const what = (o.desk ? '机上サイズ（×' + o.scale + '）' : '実寸') +
          (r.seconds ? '・動きつき（1回 ' + r.seconds.toFixed(1) + ' 秒、×' + o.speed + '）' : '');
        /* ★ 作るのに時間がかかったら、自動では開かない。★
           Safari は「指で押した直後」でないと Quick Look を開かないことがある。
           ar-test.html（方式3）は数百 ms で作れて通ったが、壁や矢印を全部出すと重くなる。
           間に合わなかったときは、本物の <a rel="ar"> を出して、もう一度押してもらう。 */
        if (performance.now() - t0 < 900) {
          HG.ar.openQuickLook(ar.url, o.desk);
          HG.dom.text('#arInfo', what + 'で開きました。表示や速さを変えたら、もう一度押すとその表示で開き直します。');
        } else {
          HG.dom.html('#arInfo', what + 'の準備ができました。<a rel="ar" class="ar-link spaced-sm" href="' + ar.url +
            '#allowsContentScaling=' + (o.desk ? 1 : 0) + '"><img src="ar-test/thumb.png" alt="" width="48" height="36"><span>ここを押して AR で開く</span></a>');
        }
      } else {
        const o = arOpts('glb');
        const r = await HG.ar.fromViewer(info, o);
        if (ar.url) URL.revokeObjectURL(ar.url);
        ar.url = URL.createObjectURL(r.blob);
        await HG.ar.modelViewer($('#arHost'), ar.url, { height: '260px', autoplay: r.seconds > 0 });
        HG.dom.html('#arInfo', '下の枠の<b>右下の AR ボタン</b>を押すと、カメラの映像に置けます。' +
          '表示や速さを変えたら「AR で見る」を押し直してください。');
      }
    } catch (e) {
      HG.dom.text('#arInfo', 'AR のモデルを作れませんでした：' + e.message);
    }
    btn.disabled = false;
  }

  /** テスト用：いまの表示から作った USDZ と GLB（動きつき）の大きさと、USDZ の中身の確認 */
  async function arSizes() {
    const info = HG.viewer.exportInfo();
    const u = await HG.ar.fromViewer(info, Object.assign(arOpts('usdz'), { speed: 0.5 }));
    const g = await HG.ar.fromViewer(info, Object.assign(arOpts('glb'), { speed: 0.5 }));
    const files = THREE.fflate.unzipSync(new Uint8Array(await u.blob.arrayBuffer()));
    const usda = THREE.fflate.strFromU8(files['model.usda']);
    return { usdz: u.blob.size, glb: g.blob.size, seconds: u.seconds, desk: arScale().k,
             samples: (usda.match(/timeSamples/g) || []).length, end: /endTimeCode = [0-9.]+/.test(usda),
             first: Object.keys(files)[0] };
  }

  /* Δv の倍率の段。**1倍未満も選べる**（実機の指摘：お手本の円運動では実寸の Δv が
     長すぎて中心を越えそうになる。点の間隔が広いと Δv は間隔の2乗で伸びるため）。
     倍率は全体で1つ（2D の README「Δv の倍率はアプリ全体で1つ」と同じ考え方） */
  const ZOOMS = [0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.75, 0.9, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8];

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
    ['#lyBalls', '#lyPaper', '#lyPos', '#lyVel', '#lyWallBack', '#lyWallSide', '#lyFloor', '#lyArrowSh'].forEach(s => { $(s).onchange = layers; });
    $('#lyDv').onchange = onDv;
    $('#predGate').onclick = e => { const b = e.target.closest('[data-id]'); if (b) answer(b.dataset.id); };
    $('#dvZoom').oninput = e => {
      const z = ZOOMS[+e.target.value] || 1;
      HG.dom.text('#dvZoomVal', '×' + z + (z === 1 ? '（実寸）' : z < 1 ? '（縮小）' : '（拡大）'));
      HG.viewer.setZoom(z);
      setNow(+$('#nowSlider').value);
      scaleNote();
    };
    $('#nowSlider').oninput = e => { stopPlay(); setNow(+e.target.value); };
    $('#playBtn').onclick = () => (play ? stopPlay() : startPlay());
    $('#csv3d').onclick = csv3d;
    $('#arBtn').onclick = arOpen;
    $('#speedSel').onchange = () => { if (play) { stopPlay(); startPlay(); } };
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
                 isOpen: () => open, arSizes, arMode: () => ar.mode };
})(window.HG = window.HG || {});
