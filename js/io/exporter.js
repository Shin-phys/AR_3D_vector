/* io/exporter.js — 座標の書き出しと確認用の出力 */
(function (HG) {
  'use strict';

  function csv() {
    const rows = [['index', 't_sec', 'x_px', 'y_px_screen', 'y_px_physics', 'manual']];
    HG.points.listInTrim().forEach(f => {
      rows.push([f.index, f.t.toFixed(6), f.x, f.y, HG.coords.toPhysicsY(f.y), f.manual ? 1 : 0]);
    });
    const text = '﻿' + rows.map(r => r.join(',')).join('\n');   // Excel 用に BOM 付き
    const blob = new Blob([text], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'points.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  function dump() {
    const pts = HG.points.list().map(f => ({
      index: f.index, t: f.t, dt_ms: null, x: f.x, y: f.y, manual: f.manual
    }));
    for (let i = 1; i < pts.length; i++) {
      pts[i].dt_ms = ((pts[i].t - pts[i - 1].t) * 1000).toFixed(2);
    }
    console.log('%c state.frames（全コマ）', 'font-weight:bold');
    console.log(HG.state.frames);
    console.log('%c 打点したコマ', 'font-weight:bold');
    console.table(pts);
    alert('コンソールに出力しました（打点 ' + pts.length + ' 点）。');
  }

  HG.exporter = { csv, dump };
})(window.HG = window.HG || {});
