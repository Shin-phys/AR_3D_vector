/* =====================================================================
   core/bus.js — モジュール間の連絡（極小のイベントバス）

   UI モジュールが互いを直接呼ばずに済むようにするための仕組み。
   フェーズが増えても「誰がいつ再描画するか」を1か所で見渡せる。

   使うイベント名（増やしたら README に追記すること）
     video:loaded    動画のメタデータが確定した
     frames:scanned  全コマの実時刻を取得し終えた
     frame:changed   表示コマが変わった（シーク完了後）
     points:changed  打点が増減した
     trim:changed    イン点／アウト点が変わった
     view:changed    回転・リサイズなど表示条件が変わった
   ===================================================================== */
(function (HG) {
  'use strict';
  const handlers = new Map();

  HG.bus = {
    on(name, fn) {
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(fn);
      return () => HG.bus.off(name, fn);
    },
    off(name, fn) {
      const a = handlers.get(name);
      if (!a) return;
      const i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    },
    emit(name, payload) {
      const a = handlers.get(name);
      if (!a) return;
      a.slice().forEach(fn => {
        try { fn(payload); } catch (e) { console.error('[bus] ' + name, e); }
      });
    }
  };
})(window.HG = window.HG || {});
