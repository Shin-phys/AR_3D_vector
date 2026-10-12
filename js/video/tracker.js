/* =====================================================================
   video/tracker.js — 自動追跡（色 + 固定マーカーによるカメラぶれ補正）

   前提：運動する物体に蛍光色の丸シール（中心に黒点）を貼って撮影する。
   さらに、動かない場所にもう1枚同じシールを貼ってもらうと、その変位を
   差し引くことで三脚のずれ・手ぶれ・電子式手ぶれ補正（EIS）の影響が
   まとめて補正できる。EIS は機種によって切れないので、これが現実解。

   処理の順序（速さのため2パス）
     パスA：トリム区間を1回通し再生し、届いたコマをその場で解析する。
            シークしないので速い。ただし解析が間に合わないと
            コマが飛ぶことがある。
     パスB：パスAで取りこぼしたコマだけをシークして解析する。
   手動打点したコマは上書きしない（自動と手動が混在してよい）。

   解析は縮小画像（既定 480px 幅）で行い、見つけたブロブの近傍だけを
   元解像度で測り直す。速さと座標精度を両立させるため。
   ===================================================================== */
(function (HG) {
  'use strict';

  const an = document.createElement('canvas');       // 解析用の縮小キャンバス
  const actx = an.getContext('2d', { willReadFrequently: true });
  let scale = 1;                                     // 元解像度 → 解析解像度

  function conf() { return HG.state.tracking; }
  function tol() {
    const c = conf();
    return { hueTol: c.hueTol, satMin: c.satMin, valMin: c.valMin };
  }

  function prepare() {
    const w = HG.state.video.width, h = HG.state.video.height;
    const aw = Math.min(w, conf().analysisWidth);
    scale = aw / w;
    an.width = Math.round(aw);
    an.height = Math.round(h * scale);
  }

  /** 現在 offscreen にあるコマを解析解像度に落として画素を得る */
  function analysisImage() {
    actx.drawImage(HG.frames.offscreen, 0, 0, an.width, an.height);
    return actx.getImageData(0, 0, an.width, an.height);
  }

  /**
   * ブロブを元解像度で測り直す。
   * @returns {{x,y,elongation,area}|null} 元解像度の重心
   */
  function refine(blob) {
    const pad = 6;
    const o = HG.frames.offscreen;
    const x0 = Math.max(0, Math.floor(blob.x0 / scale) - pad);
    const y0 = Math.max(0, Math.floor(blob.y0 / scale) - pad);
    const x1 = Math.min(o.width - 1, Math.ceil(blob.x1 / scale) + pad);
    const y1 = Math.min(o.height - 1, Math.ceil(blob.y1 / scale) + pad);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (w < 2 || h < 2) return null;

    const img = o.getContext('2d').getImageData(x0, y0, w, h);
    const m = HG.blob.buildMask(img, conf().target, tol());
    const found = HG.blob.findBlobs(m, 3);
    if (!found.length) return null;
    const b = found[0];
    return { x: x0 + b.cx, y: y0 + b.cy, elongation: b.elongation, area: b.area };
  }

  /**
   * 追跡の出発点。同じ色のシールが2枚（運動体と固定マーカー）写っている
   * ので、「どちらが運動体か」を最初に決めておかないと固定マーカーに
   * 貼り付いてしまう。優先順位は
   *   1. 区間の先頭付近にある手動打点
   *   2. 色を指定するためにタップした位置（＝そのとき見えていた運動体）
   */
  function seed(inI) {
    const fr = HG.state.frames;
    for (let i = inI; i < Math.min(fr.length, inI + 10); i++) {
      if (fr[i].manual && fr[i].rawX !== null) return { x: fr[i].rawX, y: fr[i].rawY };
    }
    const s = conf().seed;
    return s ? { x: s.x, y: s.y } : null;
  }

  /**
   * 候補のブロブから1つ選ぶ。
   *
   * @param aim  狙う位置（元解像度）。2コマ指定があれば「予測した次の位置」、
   *             無ければ従来どおり「前のコマの位置」
   * @param win  探索窓の半径（元解像度）。null なら窓なし（従来の挙動）
   * @param hint ブロブの面積の見当（元解像度 px²）。null なら使わない
   *
   * ★ 窓の中に何も無ければ null を返すこと（見失い扱い）。★
   * 窓を無視して遠くの最寄りを拾うと、2コマ指定の目的（同じ色の別の物体や
   * 背景を拾わない）がそのまま消える。見失ったコマは手で打てる。
   */
  function nearest(blobs, aim, win, hint) {
    if (!aim) return blobs[0];                       // 最初は最大のブロブ
    let best = null, bs = Infinity;
    for (const b of blobs) {
      const d = Math.hypot(b.cx / scale - aim.x, b.cy / scale - aim.y);
      if (win && d > win) continue;
      /* 大きさが見当から桁違いのブロブは後回しにする。窓の中に複数あるときの
         決め手にするだけで、他に無ければ結局これを採る（罰則を足すだけ）。 */
      let pen = 0;
      if (hint && b.area) {
        const a = b.area / (scale * scale);
        const rel = a > hint ? a / hint : hint / a;
        if (rel > 4) pen = (win || 0) * 0.5 + 1;
      }
      if (d + pen < bs) { bs = d + pen; best = b; }
    }
    return best;
  }

  /* ---------- 2コマ指定（ステップ3の「いいえ」から） ----------
     1コマ目と2コマ目で物体を指定してもらうと、3つが決まる。

       ・初速 → 次のコマの位置を予測できる。**これが本体。**
         画面全体から色の合うブロブを探すのをやめ、予測の周りだけを見る。
         同じ色の別の物体や背景を拾う事故がほぼ消える。
       ・色のサンプルが2つ → 両方を含む色相の幅・彩度の下限を自動で決める。
         スライダーを手で合わせる場面が減る。
       ・大きさの見当 → 窓の中に複数あるときの決め手。

     窓は前の変位の3倍に取る。**2倍では足りない。** 減速や折り返しでは
     変位が縮むのではなく、次の変位が前より大きくなる向きに転じることが
     あるため（振り子の端を通り過ぎた直後など）。
     見失ったコマが続くときは、その数だけ窓を広げて取り戻す。

     入口をここ（「いいえ」のあと）に置いたのは、うまくいく素材では手順を
     増やさないため。全員に2コマ指定させると、事故が減るぶん「いいえ」自体は
     減るが、**全員が1手多く払う**ことになる。 */

  /** 2つの色サンプルから、両方を含む色の範囲を決める */
  function fitColor(c1, c2) {
    if (!c1 && !c2) return null;
    if (!c1 || !c2) return { target: c1 || c2, hueTol: null, satMin: null };
    let diff = c2.h - c1.h;                          // 色相は円環なので符号付きで取る
    while (diff > 180) diff -= 360;
    while (diff < -180) diff += 360;
    let h = c1.h + diff / 2;
    if (h < 0) h += 360;
    if (h >= 360) h -= 360;
    return {
      target: { h: h, s: (c1.s + c2.s) / 2, v: (c1.v + c2.v) / 2 },
      /* 2点がほぼ同色なら狭く（12°程度）、開いていればその分広げる */
      hueTol: Math.max(10, Math.min(60, Math.round(Math.abs(diff) * 1.6 + 10))),
      satMin: Math.max(0.05, Math.min(0.9, Math.min(c1.s, c2.s) * 0.7))
    };
  }

  /**
   * その点にあるブロブの面積（元解像度 px²）。大きさの見当に使うだけなので、
   * いまの色設定のまま、点の周りの狭い範囲だけを見る。
   */
  function measureAreaAt(ox, oy) {
    const o = HG.frames.offscreen;
    if (!o || !o.width) return null;
    const r = Math.max(10, sampleRadius() * 3);
    const x0 = Math.max(0, Math.round(ox - r)), y0 = Math.max(0, Math.round(oy - r));
    const w = Math.min(o.width - x0, r * 2 + 1), h = Math.min(o.height - y0, r * 2 + 1);
    if (w < 3 || h < 3) return null;
    const img = o.getContext('2d').getImageData(x0, y0, w, h);
    const m = HG.blob.buildMask(img, conf().target, tol());
    const found = HG.blob.findBlobs(m, 3);
    return found.length ? found[0].area : null;
  }

  /**
   * 2コマ指定を確定する。
   * @param p1 {x, y, index, color, area} 1コマ目
   * @param p2 {x, y, index, color, area} 2コマ目
   * @returns 決まった内容（UI がそのまま表示する）／組めなければ null
   */
  function setTwoFrames(p1, p2) {
    const fr = HG.state.frames, c = conf();
    if (!p1 || !p2 || p1.index === p2.index) return null;
    const dt = fr[p2.index].t - fr[p1.index].t;
    if (!(dt > 0)) return null;
    const fit = fitColor(p1.color, p2.color);
    if (fit) {
      c.target = fit.target;
      if (fit.hueTol !== null) c.hueTol = fit.hueTol;
      if (fit.satMin !== null) c.satMin = fit.satMin;
    }
    const step = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const areas = [p1.area, p2.area].filter(a => a > 0);
    c.seed = { x: p1.x, y: p1.y };
    c.twoFrame = {
      at: { x: p1.x, y: p1.y }, index: p1.index,
      /* 秒あたりで持つ。コマあたりにすると VFR の動画で予測がずれる */
      vel: { x: (p2.x - p1.x) / dt, y: (p2.y - p1.y) / dt },
      step: step, frames: p2.index - p1.index, dt: dt,
      sizeHint: areas.length ? Math.min.apply(null, areas) / (scale * scale || 1) : null
    };
    return c.twoFrame;
  }

  function clearTwoFrames() { conf().twoFrame = null; }

  /** 次のコマで物体が居るはずの位置 */
  function predict(ctxState, index) {
    if (!ctxState.prev) return null;
    if (!ctxState.vel || ctxState.prevIndex === null || ctxState.prevIndex === undefined) {
      return ctxState.prev;
    }
    const fr = HG.state.frames;
    const dt = fr[index].t - fr[ctxState.prevIndex].t;
    /* 逆行や飛びすぎでは予測しない（パスBはコマ順に走らないことがある） */
    if (!(dt > 0) || dt > 0.5) return ctxState.prev;
    return { x: ctxState.prev.x + ctxState.vel.x * dt,
             y: ctxState.prev.y + ctxState.vel.y * dt };
  }

  /** 探索窓の半径。見失いが続いたらその数だけ広げて取り戻す */
  function searchWindow(ctxState) {
    if (!ctxState.vel) return null;                  // 2コマ指定が無ければ窓なし
    const W = HG.state.video.width;
    const base = (ctxState.step || 0) * 3 + sampleRadius() * 2;
    const win = Math.max(W * 0.04, Math.min(W * 0.45, base));
    return win * (1 + Math.min(4, ctxState.miss || 0));
  }

  /* --- 1コマぶんの解析。offscreen に描かれている前提 --- */
  function analyseFrame(ctxState, index) {
    const img = analysisImage();
    const m = HG.blob.buildMask(img, conf().target, tol());
    const blobs = HG.blob.findBlobs(m, conf().minArea);
    const maskRatio = m.count / (m.width * m.height);

    /* 固定マーカー：前回位置の近くだけを探す（動く物体と取り違えないため） */
    let marker = null;
    const mk = ctxState.markerPrev;
    if (mk) {
      const win = conf().markerWindow;             // 元解像度でのおおよその半径
      const cand = blobs.filter(b =>
        Math.hypot(b.cx / scale - mk.x, b.cy / scale - mk.y) < win);
      if (cand.length) marker = refine(cand[0]);
    }

    /* 運動する物体：マーカーの近傍は除外して探す */
    let moving = null;
    const others = blobs.filter(b => {
      if (!mk) return true;
      return Math.hypot(b.cx / scale - mk.x, b.cy / scale - mk.y) >= conf().markerWindow;
    });
    if (others.length) {
      /* 2コマ指定があれば「予測した位置の周りだけ」、無ければ従来どおり
         「前のコマの位置に最も近いもの」 */
      const aim = predict(ctxState, index);
      const pick = nearest(others, aim, searchWindow(ctxState), ctxState.sizeHint);
      if (pick) moving = refine(pick);
    }

    return { moving, marker, maskRatio, blobCount: blobs.length };
  }

  function store(index, res, ctxState, report) {
    const f = HG.state.frames[index];
    if (res.marker) {
      HG.state.refMarker[index] = { index: index, t: f.t, x: res.marker.x, y: res.marker.y, found: true };
      ctxState.markerPrev = { x: res.marker.x, y: res.marker.y };
    }
    if (res.moving) {
      f.rawX = Math.round(res.moving.x * 10) / 10;   // 手動打点と同じ 0.1px 単位にそろえる
      f.rawY = Math.round(res.moving.y * 10) / 10;
      f.found = true;
      f.manual = false;
      /* 速度を取り直して次の予測に使う。**生の差分で置き換えないこと。**
         1コマぶんのブレがそのまま次の予測を飛ばすので、少し前の値を混ぜる。
         混ぜすぎると等加速度運動で予測が遅れるため 0.35 にとどめている。 */
      if (ctxState.vel && ctxState.prev && ctxState.prevIndex !== null &&
          ctxState.prevIndex !== undefined) {
        const dt = f.t - HG.state.frames[ctxState.prevIndex].t;
        if (dt > 0 && dt < 0.5) {
          const vx = (res.moving.x - ctxState.prev.x) / dt;
          const vy = (res.moving.y - ctxState.prev.y) / dt;
          ctxState.vel = { x: ctxState.vel.x * 0.35 + vx * 0.65,
                           y: ctxState.vel.y * 0.35 + vy * 0.65 };
          ctxState.step = Math.hypot(res.moving.x - ctxState.prev.x,
                                     res.moving.y - ctxState.prev.y);
        }
      }
      ctxState.prev = { x: res.moving.x, y: res.moving.y };
      ctxState.prevIndex = index;
      ctxState.miss = 0;
      report.tracked++;
      if (res.moving.elongation > report.maxElongation) report.maxElongation = res.moving.elongation;
      if (res.moving.elongation > 2.2) report.elongated++;
    } else {
      f.rawX = null; f.rawY = null; f.found = false;
      /* 見失ったコマでは prev を動かさない（予測の足場を失わないため）。
         代わりに回数を数え、次のコマで窓を広げて取り戻す。 */
      ctxState.miss = (ctxState.miss || 0) + 1;
      report.lost.push(index);
      if (!res.blobCount) report.noBlob++;
    }
    if (res.maskRatio > report.maxMaskRatio) report.maxMaskRatio = res.maskRatio;
  }

  /* --- パスA：通し再生しながら解析 --- */
  function playbackPass(indices, ctxState, report, onProgress) {
    return new Promise(resolve => {
      const v = HG.state.video.element;
      const fr = HG.state.frames;
      const last = indices[indices.length - 1];
      const todo = new Set(indices);
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(watchdog);
        try { v.pause(); } catch (e) {}
        resolve(todo);
      };

      const nearestIndex = t => {                    // mediaTime → コマ番号
        let lo = 0, hi = fr.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (fr[mid].t < t) lo = mid + 1; else hi = mid;
        }
        if (lo > 0 && Math.abs(fr[lo - 1].t - t) < Math.abs(fr[lo].t - t)) lo--;
        return lo;
      };

      /* コマが届かなくなったら打ち切る見張り。
         再生が終わってもコールバックが1回来ないことがあり、
         これが無いと待ち続けてしまう（実際に踏んだ） */
      let watchdog = null;
      const kick = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(finish, 3000);
      };

      const cb = (now, meta) => {
        kick();
        const t = (typeof meta.mediaTime === 'number') ? meta.mediaTime : v.currentTime;
        const i = nearestIndex(t);
        if (todo.has(i)) {
          HG.frames.drawToOffscreen();
          store(i, analyseFrame(ctxState, i), ctxState, report);
          todo.delete(i);
          onProgress((indices.length - todo.size) / indices.length * 0.9);
        }
        if (i >= last || v.ended || done) { finish(); return; }
        v.requestVideoFrameCallback(cb);
      };

      v.addEventListener('ended', () => setTimeout(finish, 200), { once: true });
      v.playbackRate = 1;
      v.currentTime = fr[indices[0]].t;
      v.requestVideoFrameCallback(cb);
      kick();
      const p = v.play();
      if (p && p.catch) p.catch(finish);
    });
  }

  /**
   * パスBで使う「直前の位置」。パスAの走り終わりの位置をそのまま使うと、
   * 動画の終端の座標を基準に最寄りブロブを選んでしまい、固定マーカーに
   * 飛び移る（実際に踏んだ不具合）。前後の追跡済みコマから取り直す。
   */
  function neighbourSeed(i) {
    const fr = HG.state.frames;
    for (let d = 1; d <= 8; d++) {
      const a = fr[i - d], b = fr[i + d];
      if (a && a.found && a.rawX !== null) return { x: a.rawX, y: a.rawY };
      if (b && b.found && b.rawX !== null) return { x: b.rawX, y: b.rawY };
    }
    return seed(HG.state.trim.inIndex);
  }
  /** neighbourSeed() が返した位置のコマ番号。予測の Δt に使う */
  function neighbourIndex(i) {
    const fr = HG.state.frames;
    for (let d = 1; d <= 8; d++) {
      if (fr[i - d] && fr[i - d].found && fr[i - d].rawX !== null) return i - d;
      if (fr[i + d] && fr[i + d].found && fr[i + d].rawX !== null) return i + d;
    }
    return null;
  }
  function neighbourMarker(i) {
    const m = HG.state.refMarker || [];
    for (let d = 1; d <= 8; d++) {
      if (m[i - d] && m[i - d].found) return { x: m[i - d].x, y: m[i - d].y };
      if (m[i + d] && m[i + d].found) return { x: m[i + d].x, y: m[i + d].y };
    }
    const ms = conf().markerStart;
    return ms ? { x: ms.x, y: ms.y } : null;
  }

  /* --- パスB：取りこぼしたコマをシークして解析 --- */
  async function seekPass(rest, ctxState, report, onProgress) {
    const fr = HG.state.frames;
    let n = 0;
    for (const i of rest) {
      const nx = fr[i + 1];
      const eps = nx ? Math.min(0.004, (nx.t - fr[i].t) * 0.4) : 0.004;
      await HG.frames.seekTo(fr[i].t + eps);
      HG.frames.drawToOffscreen();
      ctxState.prev = neighbourSeed(i);
      ctxState.prevIndex = neighbourIndex(i);
      ctxState.markerPrev = neighbourMarker(i);
      store(i, analyseFrame(ctxState, i), ctxState, report);
      onProgress(0.9 + (++n / rest.length) * 0.1);
    }
  }

  /**
   * トリム区間の全コマを追跡する。手動打点したコマは触らない。
   * @returns {Promise<object>} 診断用のレポート
   */
  async function trackAll(onProgress) {
    prepare();
    const fr = HG.state.frames;
    const inI = HG.state.trim.inIndex;
    const outI = (HG.state.trim.outIndex === null ? fr.length - 1 : HG.state.trim.outIndex);

    const indices = [];
    for (let i = inI; i <= outI; i++) if (!fr[i].manual) indices.push(i);
    if (!indices.length) return null;

    HG.state.refMarker = [];
    const ctxState = {
      prev: seed(inI),
      prevIndex: null,
      vel: null, step: 0, miss: 0, sizeHint: null,
      markerPrev: conf().markerStart ? { x: conf().markerStart.x, y: conf().markerStart.y } : null
    };
    /* 2コマ指定があれば、初速と探索窓の基準をそこから作る。
       無ければ vel が null のまま＝窓なしの従来どおりの探索になる。 */
    const tf = conf().twoFrame;
    if (tf) {
      ctxState.prev = { x: tf.at.x, y: tf.at.y };
      ctxState.prevIndex = tf.index;
      ctxState.vel = { x: tf.vel.x, y: tf.vel.y };
      ctxState.step = tf.step;
      ctxState.sizeHint = tf.sizeHint;
    }
    const markerBase = ctxState.markerPrev ? { x: ctxState.markerPrev.x, y: ctxState.markerPrev.y } : null;

    const report = {
      ran: true, total: indices.length, tracked: 0, lost: [],
      maxElongation: 1, elongated: 0, noBlob: 0, maxMaskRatio: 0,
      markerDrift: 0, markerUsed: !!markerBase, markerLost: 0,
      twoFrame: !!tf                         // 2コマ指定で走ったか（助言の分岐に使う）
    };

    const rest = await playbackPass(indices, ctxState, report, onProgress || (() => {}));
    if (rest.size) await seekPass(Array.from(rest).sort((a, b) => a - b), ctxState, report, onProgress || (() => {}));

    /* マーカーのぶれ量（最大変位）を集計 */
    if (markerBase) {
      HG.state.refMarker.forEach(m => {
        if (!m) { report.markerLost++; return; }
        const d = Math.hypot(m.x - markerBase.x, m.y - markerBase.y);
        if (d > report.markerDrift) report.markerDrift = d;
      });
    }

    report.lost.sort((a, b) => a - b);
    HG.state.tracking.report = report;
    HG.points.applyCorrection();
    HG.bus.emit('points:changed');
    return report;
  }

  /** 追跡結果だけ消す（手動打点は残す） */
  function clearAuto() {
    HG.state.frames.forEach(f => {
      if (f.manual) return;
      f.rawX = null; f.rawY = null; f.x = null; f.y = null; f.found = false;
    });
    HG.state.refMarker = [];
    HG.state.tracking.report = null;
    HG.bus.emit('points:changed');
  }

  /** 色を拾う円の半径（元解像度ピクセル）。1画素ではなくこの円の色相平均を使う */
  function sampleRadius() {
    const o = HG.frames.offscreen;
    return Math.max(4, Math.round((o ? o.width : HG.state.video.width) * 0.012));
  }

  /**
   * その位置の色を読むだけ（state は変えない）。
   * 色選択を「タップ → ずらして微調整 → 決定」の2段階にしたので、
   * 確定前に何度も読み直す必要がある。
   */
  function sampleColorAt(ox, oy) {
    const o = HG.frames.offscreen;
    if (!o || !o.width) return null;
    const r = sampleRadius();
    const x0 = Math.max(0, Math.round(ox - r)), y0 = Math.max(0, Math.round(oy - r));
    const w = Math.min(o.width - x0, r * 2 + 1), h = Math.min(o.height - y0, r * 2 + 1);
    if (w <= 0 || h <= 0) return null;
    const img = o.getContext('2d').getImageData(x0, y0, w, h);
    return HG.color.sampleAround(img, ox - x0, oy - y0, r);
  }

  /** 画面上のシールをタップして「この色を追う」を確定する */
  function pickColorAt(ox, oy) {
    const c = sampleColorAt(ox, oy);
    if (c) {
      HG.state.tracking.target = c;
      // タップした位置＝そのとき運動体があった場所。追跡の出発点として覚えておく
      HG.state.tracking.seed = { x: ox, y: oy };
      /* 色を1点で選び直したら、前の2コマ指定の初速は捨てる。
         別の物体を選んだのに古い予測で探すと、必ず見失う。 */
      clearTwoFrames();
    }
    return c;
  }

  HG.tracker = {
    trackAll, clearAuto, pickColorAt, sampleColorAt, sampleRadius, prepare,
    setTwoFrames, clearTwoFrames, measureAreaAt
  };
})(window.HG = window.HG || {});
