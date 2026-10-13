/* =====================================================================
   hg3d/stereo-ui.js — 2台のカメラで撮る（ステレオ）の画面の流れ

   計算は stereo.js（HG.stereoMath）。ここは「1本ずつ読み込む」流れと、
   reconstruct.js・panel3d.js との受け渡しを持つ。

   ★ 2本の動画は1本ずつ、同じ画面で処理する。★
   前半（トリム・追う色・追跡）の共有モジュールは動画1本を前提にしている（state が1つ）。
   共有モジュールを書き換えずに済むよう、カメラ①を最後まで処理したら、
   要るもの（6点で決めたカメラ・区間内の点の列・手拍子の時刻）だけを「記録」して、
   同じ画面にカメラ②を読み込む。3D はカメラ②の時刻・コマで作る
   （使うコマ・写真・時刻スライダーはカメラ②の動画のもの）。

     1 区間 → 2 基準の6点 → 3 追う色 → 4 座標 → 5 カメラ①を記録
                                                     ↓ カメラ②を読み込む
     1 区間 → 2 基準の6点 → 3 追う色 → 4 座標 → 5 2台を合わせる → 6 使うコマ → 7 3D

   ★ 同期は「手拍子の音」→「線のすれ違い」の順。★
   音は2台で録音の遅れが違う（機種ごとに数十 ms）。音で大まかに合わせ、
   2台の線が最もよく交わる時刻へ細かく合わせる（stereo.js refinePair）。
   音が取れない動画では、線のすれ違いだけで探す。
   ===================================================================== */
(function (HG) {
  'use strict';

  const $ = HG.$;
  const SM = HG.stereoMath;

  const st = {
    active: false,
    refKey: 'A4',
    cam: 1,              // いま読み込んでいるのはカメラ① か ②
    taps: [], tapFrame: null,
    calib: null,         // いまの動画のカメラ（6点から）
    clap: null, clapState: '',    // いまの動画の手拍子の時刻（s）。'busy' | 'ok' | 'none' | 'fail'
    fileName: '',
    rec1: null,          // 記録したカメラ① { cam, taps, track:[{t,x,y}], clap, W, H, name, dt }
    pair: null,          // 合わせた結果 { cam1, cam2, off, from, src, gap, n, angle }
    gap: null
  };

  function ref() { return SM.REFS[st.refKey] || SM.REFS.A4; }
  function active() { return st.active; }
  function camNo() { return st.cam; }

  /* ---------- 画面の切り替え ---------- */
  function activate(on) {
    st.active = !!on;
    document.body.classList.toggle('stereo', st.active);
    $('#cornerCard').classList.toggle('hide', st.active);
    $('#refCard').classList.toggle('hide', !st.active);
    $('#stereoCard').classList.toggle('hide', !st.active);
    /* 「決定／やめる」の行は四隅のカードにある。ステレオのあいだは基準のカードへ移す */
    const row = $('#cornerPickRow');
    (st.active ? $('#refPickSlot') : $('#cornerPickSlot')).appendChild(row);
    /* カードの番号（ステレオでは「2台目と合わせる」が5番に入る） */
    HG.dom.text('#selectTitle', (st.active ? '6' : '5') + '. 使うコマを決める（等間隔）');
    HG.dom.text('#viewTitle', (st.active ? '7' : '6') + '. 3D で見る');
    HG.dom.text('#lyPosText', st.active ? '位置（折り目の左端から）' : '位置（紙の角 A から）');
    loadLabels();
    info();
  }

  /** 読み込み画面の文言（カメラ②のときはそう書く） */
  function loadLabels() {
    const two = st.active && st.cam === 2;
    HG.dom.text('#dropTitle', !st.active ? '運動を撮影した動画を読み込む'
      : two ? 'カメラ②の動画を読み込む' : 'カメラ①の動画を読み込む');
    $('#stereoLoadNote').classList.toggle('hide', !st.active);
    /* カメラ②を読み込む画面では「運動を選び直す」を出さない（カメラ①の記録が宙に浮く。やり直しは ← ホーム） */
    $('#backToTiles').classList.toggle('hide', two);
    if (st.active) {
      HG.dom.html('#stereoLoadNote', two
        ? '<span class="ok">カメラ①を記録しました</span>（' + st.rec1.track.length + ' 点、' + esc(st.rec1.name) + '）。' +
          '<div class="spaced-sm">続けて、<b>同じ運動をもう1台で撮った動画</b>を読み込みます。どちらを①にしても構いません。</div>'
        : '2台のうち、<b>どちらか1本</b>から読み込みます（これをカメラ①と呼びます）。もう1本はあとで読み込みます。');
    }
  }
  function esc(s) { return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  /** お手本：カメラ①／②で別の動画 */
  function sampleKey() { return st.cam === 2 ? 'stereo2' : 'stereo1'; }

  /* ---------- 読み込み（手拍子の音を探す） ---------- */
  async function onLoad(file) {
    st.fileName = typeof file === 'string' ? 'お手本（カメラ' + (st.cam === 2 ? '②' : '①') + '）' : (file.name || '動画');
    st.clap = null; st.clapState = 'busy';
    info();
    try {
      let buf;
      if (typeof file === 'string') buf = await (await fetch(file)).arrayBuffer();
      else {
        /* 大きな動画を丸ごと読むと、スマホではタブが落ちることがある（2D の README の罠と同じ） */
        if (file.size > 250e6) throw new Error('big');
        buf = await file.arrayBuffer();
      }
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const ac = new OAC(1, 2, 44100);
      const ab = await new Promise((res, rej) => {
        const p = ac.decodeAudioData(buf, res, rej);
        if (p && p.then) p.then(res, rej);
      });
      /* 左右を足して1本に */
      let ch = ab.getChannelData(0);
      if (ab.numberOfChannels > 1) {
        const b = ab.getChannelData(1), m = new Float32Array(ch.length);
        for (let i = 0; i < ch.length; i++) m[i] = (ch[i] + b[i]) / 2;
        ch = m;
      }
      const r = SM.clapTime(ch, ab.sampleRate);
      st.clap = r && r.t !== null ? r.t : null;
      st.clapState = st.clap === null ? 'none' : 'ok';
    } catch (e) {
      st.clapState = e && e.message === 'big' ? 'big' : 'fail';
    }
    info();
  }

  /** 新しい動画を走査したら、そのカメラの基準と結果を捨てる */
  function onScanned() {
    if (!st.active) return;
    st.taps = []; st.tapFrame = null; st.calib = null; st.pair = null;
    info();
  }

  /* ---------- 基準の6点 ---------- */
  /** カメラぶれ補正を、6点にも点と同じだけ掛ける（reconstruct.js corrected と同じ式） */
  function corrected(list, frame) {
    let dx = 0, dy = 0;
    const s = HG.state;
    if (s.tracking && s.tracking.useMarker && s.refMarker && frame !== null) {
      const base = s.refMarker.find(m => m && m.found);
      const m = s.refMarker[frame];
      if (base && m && m.found) { dx = m.x - base.x; dy = m.y - base.y; }
    }
    return list.map(c => ({ x: c.x - dx, y: c.y - dy }));
  }

  function setTaps(pts, frame) {
    st.taps = pts.map(p => ({ x: p.x, y: p.y }));
    st.tapFrame = frame;
    calibrate();
  }
  function calibrate() {
    st.pair = null;
    st.calib = st.taps.length === 6
      ? SM.calibrate(corrected(st.taps, st.tapFrame), ref(), HG.state.video.width, HG.state.video.height) : null;
    info();
    HG.bus.emit('corners:changed');
  }
  function calibOk() { return !!(st.calib && st.calib.ok); }
  function clearTaps() { st.taps = []; st.tapFrame = null; st.calib = null; st.pair = null; info(); HG.bus.emit('corners:changed'); HG.stage.render(); }

  /* ---------- カメラ①を記録して、カメラ②へ ---------- */
  function track() {
    return HG.points.listInTrim().filter(f => f.x !== null && f.x !== undefined)
      .map(f => ({ index: f.index, t: f.t, x: f.x, y: f.y }));
  }
  function medianDt(tr) {
    const d = [];
    for (let i = 1; i < tr.length; i++) d.push(tr[i].t - tr[i - 1].t);
    return SM.median(d);
  }

  function commit1() {
    const tr = track();
    if (!calibOk()) { HG.dom.html('#stInfo', '<span class="warn">先にステップ2で基準の6点を押してください。</span>'); return; }
    if (tr.length < 8) { HG.dom.html('#stInfo', '<span class="warn">先にステップ4で座標を取ってください（8 点以上）。</span>'); return; }
    st.rec1 = { cam: st.calib, taps: corrected(st.taps, st.tapFrame), track: tr, clap: st.clap, clapState: st.clapState,
                W: HG.state.video.width, H: HG.state.video.height, name: st.fileName, dt: medianDt(tr) };
    st.cam = 2;
    st.taps = []; st.tapFrame = null; st.calib = null; st.clap = null; st.clapState = ''; st.pair = null;
    /* 追跡の設定のうち、位置に結びつくものは捨てる（色はそのまま：同じシールを追う） */
    const t = HG.state.tracking;
    t.seed = null; t.markerStart = null; t.twoFrame = null; t.report = null; t.verified = false;
    HG.state.refMarker = [];
    HG.history.length = 0;
    HG.photo.clear();
    HG.dom.text('#trackResult', '先に「追う色を指定」をしてから実行してください。追跡できなかったコマは手動で打てます。');
    ['#trackAskRow', '#trackAdvice', '#twoRow', '#twoRunRow', '#gotoLost'].forEach(s => HG.dom.hide(s));
    if (HG.panel3d.isOpen()) HG.panel3d.back();
    loadLabels();
    HG.dom.html('#loadState', '');
    HG.dom.hide('#screen2'); HG.dom.show('#screen1');
    window.scrollTo(0, 0);
    info();
  }

  /* ---------- 2台を合わせる ---------- */
  function maxGap() { return Math.max(0.05, 2.6 * (st.rec1 ? st.rec1.dt : 0.034)); }

  function sync(nudge) {
    const r1 = st.rec1;
    if (!r1 || !calibOk()) return;
    const tr2 = track();
    if (tr2.length < 8) { HG.dom.html('#stSyncInfo', '<span class="warn">先にステップ4で座標を取ってください（8 点以上）。</span>'); return; }
    let from, range, src;
    if (r1.clap !== null && st.clap !== null) { from = r1.clap - st.clap; range = 0.15; src = 'audio'; }
    else {
      /* 音が無い：2本の区間が半分以上重なる範囲を全部探す */
      const a0 = r1.track[0].t, a1 = r1.track[r1.track.length - 1].t, b0 = tr2[0].t, b1 = tr2[tr2.length - 1].t;
      const lo = a0 - b1, hi = a1 - b0;
      from = (lo + hi) / 2; range = Math.max(0.2, (hi - lo) / 2); src = 'geometry';
    }
    const g = SM.syncByGeometry(r1.cam, r1.track, st.calib, tr2, from, range, maxGap());
    if (!isFinite(g.gap)) {
      HG.dom.html('#stSyncInfo', '<span class="warn">2本の動画の、同じ時刻の点が見つかりませんでした。</span>' +
        '2台で同じ運動を撮っているか、トリムの区間が重なっているか確かめてください。');
      return;
    }
    const p = SM.refinePair(r1.cam, st.calib, ref(), r1.taps, corrected(st.taps, st.tapFrame), r1.track, tr2, g.off,
                            { withOff: true, maxGap: maxGap() });
    st.pair = { cam1: p.cam1, cam2: p.cam2, off: p.off, from: from, src: src, rms: p.rms };
    measure(tr2);
    HG.bus.emit('corners:changed');
    if (HG.steps) { HG.steps.render(); HG.steps.goTo('#stereoCard'); }
  }

  /** 手で少しずらす（ずらしたら線のすれ違いを測り直すだけ。カメラは動かさない） */
  function nudge(d) {
    if (!st.pair) return;
    st.pair.off += d;
    st.pair.src = 'manual';
    measure(track());
    HG.bus.emit('corners:changed');
  }

  function measure(tr2) {
    const p = st.pair;
    const g = SM.gapAt(p.cam1, st.rec1.track, p.cam2, tr2, p.off, maxGap());
    p.gap = g.gap; p.n = g.n;
    /* 2台の線のなす角（運動の真ん中で） */
    const pts = [];
    tr2.forEach(q => {
      const a = SM.interp(st.rec1.track, q.t + p.off, maxGap());
      if (a) { const c = SM.triangulate(p.cam1, a, p.cam2, q); if (c) pts.push(c); }
    });
    if (pts.length) {
      const m = pts.reduce((s, q) => ({ x: s.x + q.x / pts.length, y: s.y + q.y / pts.length, z: s.z + q.z / pts.length }), { x: 0, y: 0, z: 0 });
      p.angle = SM.baseAngle(p.cam1, p.cam2, m);
      let span = 0;
      pts.forEach(a => { span = Math.max(span, Math.hypot(a.x - m.x, a.y - m.y, a.z - m.z)); });
      p.span = span;
    }
    info();
  }

  function ready() { return !!(st.active && st.rec1 && st.pair && st.cam === 2); }

  /** 3D を作る（reconstruct.js の compute から呼ばれる） */
  function compute() {
    HG.track3d = []; HG.track3dAll = []; HG.kin3d = { v: [], a: [] };
    if (!ready()) return false;
    const sel = HG.selection.list().filter(f => f.found && f.x !== null);
    const all = HG.points.listInTrim().filter(f => f.x !== null);
    const r = SM.computeFrom(sel, all, st.pair.cam1, st.rec1.track, st.pair.cam2, st.pair.off, maxGap());
    HG.track3d = r.track; HG.track3dAll = r.trackAll; HG.kin3d = r.kin;
    st.gap = r.gap;
    st.dropped = sel.length - r.track.length;
    return true;
  }

  /** カメラ①が写っている時刻を、カメラ②の時刻で（この外の点は 3D にできない） */
  function overlap() {
    if (!st.rec1 || !st.pair) return null;
    const tr = st.rec1.track;
    return { t0: tr[0].t - st.pair.off, t1: tr[tr.length - 1].t - st.pair.off, dropped: st.dropped || 0 };
  }

  /** 撮影位置から見る：カメラ②（いま画面にある動画）の位置 */
  function cameraWorld() {
    const c = st.pair ? st.pair.cam2 : st.calib;
    return c ? SM.cameraWorld(c) : null;
  }
  function papers() { const q = SM.refQuads(ref()); return [q.desk, q.wall]; }

  /** 写真の札：カメラ②の画面に平行な板（カメラ②から見えたとおりの大きさ） */
  function cardFrame(ph, p) {
    const c = st.pair ? st.pair.cam2 : st.calib;
    if (!c || !p) return null;
    const cw = SM.cameraWorld(c);
    const dep = (p.x - cw.pos.x) * cw.forward.x + (p.y - cw.pos.y) * cw.forward.y + (p.z - cw.pos.z) * cw.forward.z;
    const s = ph.rpx * dep / c.f;
    return { right: { x: cw.right.x * s, y: cw.right.y * s, z: cw.right.z * s },
             up: { x: cw.up.x * s, y: cw.up.y * s, z: cw.up.z * s }, size: s };
  }

  /* ---------- 文言 ---------- */
  function clapText(state, t) {
    return state === 'busy' ? '音を調べています…'
      : state === 'ok' ? '手拍子 ' + t.toFixed(3) + ' s'
      : state === 'none' ? '<span class="warn">手拍子が見つかりません</span>'
      : state === 'big' ? '<span class="warn">大きな動画なので音は調べません</span>'
      : state === 'fail' ? '<span class="warn">音を読めませんでした</span>' : '';
  }

  function info() {
    if (!$('#stereoCard')) return;
    /* ステップ2：基準 */
    const c = st.calib;
    $('#refRedo').classList.toggle('hide', !st.taps.length);
    HG.dom.text('#refStart', st.taps.length === 6 ? '6点を押し直す' : '6点を押す');
    if (!c) HG.dom.html('#refInfo', st.taps.length ? '' : '');
    else if (!c.ok) {
      HG.dom.html('#refInfo', '<span class="warn">6点がカメラの写り方と合いません（写し戻しのずれ ' + c.err.toFixed(1) + ' px）。</span>' +
        '押す順（<b>立てた紙の左上から時計回り</b>）と、紙の大きさの選択を確かめて、押し直してください。');
    } else {
      HG.dom.html('#refInfo', '<span class="ok">カメラの位置と向きが決まりました。</span>' +
        '<div class="spaced-sm">画面の水色の線（6点から決めたカメラで、L字を描き戻したもの）が、紙の縁に重なっているか確かめてください。</div>' +
        '<div class="sub spaced-sm">写し戻しのずれ ' + c.err.toFixed(1) + ' px ／ 横の画角 ' + c.fovX.toFixed(0) +
        '°（スマホの標準カメラはおよそ 69°。ここは6点だけの見積もりで、2台を合わせるときに直します）</div>');
    }
    /* ステップ5 */
    const one = st.cam === 1;
    $('#stStage1').classList.toggle('hide', !one);
    $('#stStage2').classList.toggle('hide', one);
    const tr = HG.state.frames.length ? track() : [];
    const mark = ok => ok ? '<span class="ok">✓</span>' : '<span class="sub">—</span>';
    let cams;
    if (one) {
      cams = '<div><b>カメラ①</b>（' + esc(st.fileName) + '）：基準 ' + mark(calibOk()) + '　座標 ' + tr.length + ' 点　' + clapText(st.clapState, st.clap) + '</div>' +
             '<div class="sub">カメラ②：まだ</div>';
      $('#stCommit').disabled = !(calibOk() && tr.length >= 8);
    } else {
      const r1 = st.rec1;
      cams = '<div><b>カメラ①</b>（' + esc(r1.name) + '）：記録済み　' + r1.track.length + ' 点　' + clapText(r1.clapState, r1.clap) + '</div>' +
             '<div><b>カメラ②</b>（' + esc(st.fileName) + '）：基準 ' + mark(calibOk()) + '　座標 ' + tr.length + ' 点　' + clapText(st.clapState, st.clap) + '</div>';
      $('#stSync').disabled = !(calibOk() && tr.length >= 8);
      HG.dom.text('#stSync', st.pair ? '2台を合わせ直す' : '2台を合わせる');
      $('#stNudge').classList.toggle('hide', !st.pair);
      syncInfo();
    }
    HG.dom.html('#stCams', cams);
  }

  function syncInfo() {
    const p = st.pair;
    if (!p) { HG.dom.html('#stSyncInfo', ''); return; }
    const mm = p.gap * 1000;
    /* すれ違いは運動の大きさと比べる（ボールの大きさ程度なら、2台はそろっていない） */
    const bad = !isFinite(mm) || mm > Math.max(6, (p.span || 0.2) * 1000 * 0.04);
    const src = p.src === 'audio' ? '手拍子の音で ' + p.from.toFixed(3) + ' s と見積もり、線のすれ違いで ' + ((p.off - p.from) * 1000).toFixed(0) + ' ms 直しました'
      : p.src === 'geometry' ? '音が使えないので、線のすれ違いだけで探しました'
      : '手でずらしました';
    HG.dom.html('#stSyncInfo',
      (bad ? '<span class="warn">2台の線がうまく交わりません。</span>' : '<span class="ok">2台を合わせました。</span>') +
      '<div class="spaced-sm">2本の線のすれ違い（中央値）：<b>' + mm.toFixed(1) + ' mm</b>' +
      '<span class="sub">（2台のカメラから同じ点へ引いた線が、どれだけ離れてすれ違うか。小さいほど2台がそろっています）</span></div>' +
      '<div class="sub spaced-sm">時刻のずれ：カメラ① ＝ カメラ② ＋ ' + p.off.toFixed(3) + ' s（' + src + '）</div>' +
      (() => { const o = overlap(); return o ? '<div class="sub spaced-sm">カメラ①に写っているのは、この動画の t = ' + Math.max(0, o.t0).toFixed(2) + '〜' + o.t1.toFixed(2) +
        ' s。区間（ステップ1）はこの中に取ってください。</div>' : ''; })() +
      (p.angle ? '<div class="sub spaced-sm">2台の向きの差：約 ' + p.angle.toFixed(0) + '°' +
        (p.angle < 35 ? '<span class="warn">（狭いと奥行きの誤差が大きくなります。60〜90° が目安）</span>' : '') + '</div>' : '') +
      '<div class="sub spaced-sm">横の画角：カメラ① ' + p.cam1.fovX.toFixed(0) + '° ／ カメラ② ' + p.cam2.fovX.toFixed(0) + '°</div>' +
      (bad ? '<div class="spaced-sm">6点の押し方（順番・紙の大きさ）、2本の動画が同じ運動か、を確かめてください。' +
             '時刻が合っていないだけなら、下のボタンで少しずつずらすと小さくなるところがあります。</div>' : ''));
  }

  /* ---------- 画面に6点と、6点から決めたカメラで描き戻した L字（stage の painter） ---------- */
  function paint(ctx) {
    if (!st.active || (HG.corners.picking && HG.corners.picking())) return;
    const dpr = HG.view.dpr;
    const here = st.tapFrame === HG.ui.current;
    ctx.save();
    const c = st.pair ? st.pair.cam2 : st.calib;
    if (c && st.taps.length === 6) {
      /* 描き戻した L字（水色）。カメラぶれ補正を使っているときは、補正の分だけずれて見えることがある */
      const q = SM.refQuads(ref());
      ctx.strokeStyle = 'rgba(0,200,255,.9)'; ctx.lineWidth = 1.6 * dpr;
      [q.desk, q.wall].forEach(quad => {
        ctx.beginPath();
        quad.forEach((p, i) => {
          const u = SM.project(c, p), cc = HG.coords.toCanvas(u.x, u.y);
          i ? ctx.lineTo(cc.x, cc.y) : ctx.moveTo(cc.x, cc.y);
        });
        ctx.closePath(); ctx.stroke();
      });
    }
    st.taps.forEach((p, i) => {
      const cc = HG.coords.toCanvas(p.x, p.y);
      ctx.fillStyle = here ? 'rgba(255,212,0,.95)' : 'rgba(255,212,0,.5)';
      ctx.beginPath(); ctx.arc(cc.x, cc.y, 4 * dpr, 0, Math.PI * 2); ctx.fill();
      ctx.font = 'bold ' + (12 * dpr) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const w = 16 * dpr;
      ctx.fillStyle = 'rgba(0,0,0,.62)'; ctx.fillRect(cc.x + 12 * dpr - w / 2, cc.y - 12 * dpr - w / 2, w, w);
      ctx.fillStyle = '#fff'; ctx.fillText(String(i + 1), cc.x + 12 * dpr, cc.y - 12 * dpr);
    });
    ctx.restore();
  }

  function attach() {
    $('#refStart').onclick = () => HG.corners.start('ref6');
    $('#refRedo').onclick = clearTaps;
    $('#refSel').onchange = () => { st.refKey = $('#refSel').value; if (st.taps.length === 6) calibrate(); HG.stage.render(); };
    $('#stCommit').onclick = commit1;
    $('#stSync').onclick = () => sync();
    $('#stNudge').onclick = e => {
      const b = e.target.closest('[data-nudge]');
      if (b) nudge(+b.dataset.nudge * (b.dataset.frame ? (st.rec1 ? st.rec1.dt : 1 / 30) : 1));
    };
    HG.bus.on('frames:scanned', onScanned);
    /* 座標が増えたら、カメラ①の「記録」ボタンを押せるようにする */
    HG.bus.on('points:changed', () => { if (st.active) info(); });
    HG.bus.on('trim:changed', () => { if (st.active) info(); });
  }

  HG.stereo = { attach, activate, active, camNo, sampleKey, onLoad, setTaps, calibOk, ready, compute,
                cameraWorld, papers, cardFrame, paint, overlap, ORDER: SM.ORDER, state: st,
                /* テスト用 */ _sync: sync, _commit: commit1 };
})(window.HG = window.HG || {});
