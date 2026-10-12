/* =====================================================================
   core/points.js — 打点データの操作（描画も UI も持たない）

   打点は「自動追跡が失敗したときの保険」ではなく基礎機能。
   フェーズ2の自動追跡は同じ frames[] に found=true, manual=false で
   書き込むので、自動と手動が混在してよい。
   ===================================================================== */
(function (HG) {
  'use strict';

  function snapshot(f) {
    return { index: f.index, x: f.x, y: f.y, rawX: f.rawX, rawY: f.rawY, found: f.found, manual: f.manual };
  }
  function restore(f, s) {
    f.x = s.x; f.y = s.y; f.rawX = s.rawX; f.rawY = s.rawY; f.found = s.found; f.manual = s.manual;
  }
  function clear(f) {
    f.x = null; f.y = null; f.rawX = null; f.rawY = null; f.found = false; f.manual = false;
  }

  HG.points = {
    /** 現在のコマに手動打点する。座標は元解像度のまま保持する */
    put(ox, oy) {
      const f = HG.state.frames[HG.ui.current];
      if (!f) return;
      HG.history.push(snapshot(f));
      if (HG.history.length > 200) HG.history.shift();
      f.rawX = Math.round(ox * 10) / 10;   // 画像上の実位置（0.1px 単位）
      f.rawY = Math.round(oy * 10) / 10;
      f.found = true;
      f.manual = true;
      HG.points.applyCorrection();
      HG.bus.emit('points:changed');
    },

    removeCurrent() {
      const f = HG.state.frames[HG.ui.current];
      if (!f || !f.found) return;
      HG.history.push(snapshot(f));
      clear(f);
      HG.bus.emit('points:changed');
    },

    undo() {
      const s = HG.history.pop();
      if (!s) return null;
      restore(HG.state.frames[s.index], s);
      HG.bus.emit('points:changed');
      return s.index;
    },

    clearAll() {
      HG.state.frames.forEach(clear);
      HG.state.refMarker = [];
      HG.history.length = 0;
      HG.bus.emit('points:changed');
    },

    /** 打点済みのコマ（時間順） */
    list() { return HG.state.frames.filter(f => f.found); },

    /** トリム区間内の打点だけ */
    listInTrim() {
      const { inIndex, outIndex } = HG.state.trim;
      const out = (outIndex === null ? HG.state.frames.length - 1 : outIndex);
      return HG.state.frames.filter(f => f.found && f.index >= inIndex && f.index <= out);
    },

    /** 回転時に既存の打点を移し替える（座標を失わないため） */
    rotate90(oldWidth, oldHeight) {
      const turn = (x, y) => ({ x: oldHeight - y, y: x });   // 90°時計回り
      HG.state.frames.forEach(f => {
        if (!f.found) return;
        const r = turn(f.rawX, f.rawY);
        f.rawX = r.x; f.rawY = r.y;
      });
      HG.state.refMarker.forEach(m => {
        if (!m) return;
        const r = turn(m.x, m.y);
        m.x = r.x; m.y = r.y;
      });
      const ms = HG.state.tracking.markerStart;
      if (ms) { const r = turn(ms.x, ms.y); ms.x = r.x; ms.y = r.y; }
      HG.points.applyCorrection();
    },

    /**
     * カメラぶれ補正を掛け直して x, y を作る。
     * 固定マーカーの変位を運動物体の座標から差し引くだけ。
     * マーカーが無い／補正 OFF のときは x = rawX（素通し）。
     */
    applyCorrection() {
      const t = HG.state.tracking;
      const marker = HG.state.refMarker || [];
      const base = (t.useMarker ? marker.find(m => m && m.found) : null) || null;
      HG.state.frames.forEach(f => {
        if (f.rawX === null || f.rawX === undefined) { f.x = null; f.y = null; return; }
        let dx = 0, dy = 0;
        if (base) {
          const m = marker[f.index];
          if (m && m.found) { dx = m.x - base.x; dy = m.y - base.y; }
        }
        f.x = Math.round((f.rawX - dx) * 10) / 10;
        f.y = Math.round((f.rawY - dy) * 10) / 10;
      });
    }
  };
})(window.HG = window.HG || {});
