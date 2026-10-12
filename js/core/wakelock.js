/* core/wakelock.js — 作図中に画面が消えると作業が飛ぶので抑止する */
(function (HG) {
  'use strict';
  let lock = null;

  async function request() {
    try {
      if ('wakeLock' in navigator) {
        lock = await navigator.wakeLock.request('screen');
        lock.addEventListener('release', () => { lock = null; });
      }
    } catch (e) { /* 非対応環境では黙って続行 */ }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !lock) request();
  });

  HG.wakelock = { request };
})(window.HG = window.HG || {});
