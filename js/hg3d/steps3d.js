/* =====================================================================
   hg3d/steps3d.js — 3D のステップ帯（1〜6）

   2D の ui/steps.js と同じ作り（同じ API：attach / render / goTo / current / done）。
   共有の track-controls.js が HG.steps.render() / goTo() を呼ぶので、名前を合わせてある。
   2D の steps.js を書き換えずに済むよう、3D 用を別に持つ（3D仕様.md §2
   「ステップの線が分岐する」）。

     1 トリム → 2 紙の四隅 → 3 追う色 → 4 座標 → 5 使うコマ → 6 3D

   ★ 進み具合は state から毎回求める（2D と同じ）。★
   ★ ✓ は「生徒が見て決めた」ことにだけ付ける（2D の罠を繰り返さない）。★
   ===================================================================== */
(function (HG) {
  'use strict';

  const $ = HG.$;

  const STEPS = [
    { n: 1, label: 'トリム',   lead: '解析に使う区間を決める', card: '#trimCard'   },
    { n: 2, label: '四隅',     lead: '紙の四隅を押す',         card: '#cornerCard' },
    { n: 3, label: '追う色',   lead: '追う色を決める',         card: '#markCard'   },
    { n: 4, label: '座標',     lead: '座標を取る',             card: '#trackCard'  },
    { n: 5, label: '使うコマ', lead: '使うコマを決める',       card: '#selectCard' },
    { n: 6, label: '3D',       lead: '3D で見る',              card: '#viewCard'   }
  ];

  /* ★ 2台のカメラ（ステレオ）は 7 段。★ 2番は「基準の6点」、5番に「2台目と合わせる」が入る。
     カメラ①のあいだは 5番（カメラ①を記録）から先へは進めない（6・7 は ✓ にならない） */
  const STEREO = [
    { n: 1, label: 'トリム',   lead: '解析に使う区間を決める', card: '#trimCard'   },
    { n: 2, label: '基準',     lead: '基準の6点を押す',        card: '#refCard'    },
    { n: 3, label: '追う色',   lead: '追う色を決める',         card: '#markCard'   },
    { n: 4, label: '座標',     lead: '座標を取る',             card: '#trackCard'  },
    { n: 5, label: '2台',      lead: '2台目と合わせる',        card: '#stereoCard' },
    { n: 6, label: '使うコマ', lead: '使うコマを決める',       card: '#selectCard' },
    { n: 7, label: '3D',       lead: '3D で見る',              card: '#viewCard'   }
  ];
  function stereo() { return !!(HG.stereo && HG.stereo.active()); }
  function steps() { return stereo() ? STEREO : STEPS; }

  /** 生徒が「3D で見る」を押したか（アプリが勝手に開いたときは付けない） */
  let viewed = false;

  function done(n) {
    const st = HG.state;
    if (!st.frames.length) return false;
    if (stereo()) return doneStereo(n);
    if (n === 1) return !!st.trim.userSet;
    /* 四隅は生徒が押して決めるもの。射影変換が解けていれば済み */
    if (n === 2) return HG.recon.ready();
    if (n === 3) return !!st.tracking.seed || !!HG.points.list().length;
    if (n === 4) {
      if (HG.points.list().length < 3) return false;
      return st.tracking.report ? !!st.tracking.verified : true;
    }
    if (n === 5) {
      if (!HG.selection.isActive()) return false;
      return HG.selection.list().filter(f => f.found).length >= 3;
    }
    if (n === 6) return viewed && HG.recon.ready();
    return false;
  }

  function doneStereo(n) {
    const st = HG.state;
    if (n === 1) return !!st.trim.userSet;
    if (n === 2) return HG.stereo.calibOk();
    if (n === 3) return !!st.tracking.seed || !!HG.points.list().length;
    if (n === 4) {
      if (HG.points.list().length < 3) return false;
      return st.tracking.report ? !!st.tracking.verified : true;
    }
    if (n === 5) return HG.stereo.ready();
    if (n === 6) {
      if (!HG.stereo.ready() || !HG.selection.isActive()) return false;
      return HG.selection.list().filter(f => f.found).length >= 3;
    }
    if (n === 7) return viewed && HG.stereo.ready();
    return false;
  }

  function current() {
    const L = steps();
    for (const s of L) if (!done(s.n)) return s.n;
    return L[L.length - 1].n;
  }

  function render() {
    const el = $('#stepNav');
    if (!el) return;
    const cur = current();
    const L = steps();
    const now = L.filter(s => s.n === cur && !done(s.n))[0];
    /* ステレオでは、いまどちらのカメラの動画を処理しているかを帯の先頭に出す */
    const tag = stereo() ? '<span class="cam-tag">カメラ' + (HG.stereo.camNo() === 2 ? '②' : '①') + '</span>' : '';
    HG.dom.html('#stepNav', tag + L.map(s => {
      const isNow = now && s.n === now.n;
      const cls = done(s.n) ? 'step ok' : isNow ? 'step now' : 'step';
      return '<button class="' + cls + '" data-card="' + s.card + '" title="' + s.lead + '">' +
             '<b>' + s.n + '</b>' + (isNow ? '<span class="step-lead">' + s.label + '</span>' : '') +
             '</button>';
    }).join(''));
  }

  /**
   * そのカードへ飛ぶ。scrollIntoView を直に使わない（2D の罠：
   * 狭い画面では貼り付いたキャンバスの下に潜る）。貼り付いている高さぶん手前で止める。
   */
  function goTo(sel) {
    /* 共有の track-controls.js は追跡のあと「使うコマ」へ送る。ステレオでは先に「2台目と合わせる」 */
    if (sel === '#selectCard' && stereo() && !HG.stereo.ready()) sel = '#stereoCard';
    const card = document.querySelector(sel);
    if (!card) return;
    if (card.tagName === 'DETAILS') card.open = true;
    const main = document.querySelector('.col-main');
    const stuck = (window.innerWidth < 900 && main) ? main.getBoundingClientRect().height : 0;
    const y = card.getBoundingClientRect().top + window.pageYOffset - stuck - 12;
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  }

  function attach() {
    $('#stepNav').onclick = e => {
      const b = e.target.closest('[data-card]');
      if (b) goTo(b.dataset.card);
    };
    ['trim:changed', 'points:changed', 'selection:changed', 'selection:committed',
     'frames:scanned', 'corners:changed', 'view3d:opened'].forEach(ev => HG.bus.on(ev, render));
    HG.bus.on('view3d:opened', () => { viewed = true; render(); });
    render();
  }

  HG.steps = { attach, render, goTo, current, done };
})(window.HG = window.HG || {});
