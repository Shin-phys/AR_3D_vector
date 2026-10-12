/* =====================================================================
   analysis/blob.js — 閾値マスクと連結成分（ブロブ）

   閾値を超えた画素の塊の重心を座標とする。
   楕円率（長軸/短軸）も一緒に返す。著しく細長いブロブは、露光時間が
   長くて物体が尾を引いている＝ブレているサインで、診断に使う。
   ===================================================================== */
(function (HG) {
  'use strict';

  /**
   * 目標色に近い画素を 1 にしたマスクを作る
   * @param {ImageData} img
   * @param {{h,s,v}} target
   * @param {{hueTol:number, satMin:number, valMin:number}} tol
   */
  function buildMask(img, target, tol) {
    const d = img.data, n = img.width * img.height;
    const mask = new Uint8Array(n);
    let count = 0;
    for (let i = 0, k = 0; i < n; i++, k += 4) {
      const c = HG.color.rgbToHsv(d[k], d[k + 1], d[k + 2]);
      if (c.s >= tol.satMin && c.v >= tol.valMin &&
          HG.color.hueDiff(c.h, target.h) <= tol.hueTol) {
        mask[i] = 1; count++;
      }
    }
    return { mask: mask, count: count, width: img.width, height: img.height };
  }

  /**
   * 連結成分を数え上げ、面積・重心・外接矩形・楕円率を返す（4近傍・非再帰）
   * @returns {Array<{area,cx,cy,x0,y0,x1,y1,elongation}>} 面積の降順
   */
  function findBlobs(m, minArea) {
    const { mask, width: w, height: h } = m;
    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    const blobs = [];

    for (let start = 0; start < w * h; start++) {
      if (!mask[start] || seen[start]) continue;
      let sp = 0;
      stack[sp++] = start;
      seen[start] = 1;
      let area = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
      let x0 = w, y0 = h, x1 = 0, y1 = 0;

      while (sp > 0) {
        const p = stack[--sp];
        const x = p % w, y = (p - x) / w;
        area++; sx += x; sy += y;
        sxx += x * x; syy += y * y; sxy += x * y;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0     && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
        if (x < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
        if (y > 0     && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[sp++] = p - w; }
        if (y < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[sp++] = p + w; }
      }
      if (area < minArea) continue;

      const cx = sx / area, cy = sy / area;
      // 二次中心モーメントから長軸・短軸を出す
      const mu20 = sxx / area - cx * cx;
      const mu02 = syy / area - cy * cy;
      const mu11 = sxy / area - cx * cy;
      const t = Math.sqrt(4 * mu11 * mu11 + (mu20 - mu02) * (mu20 - mu02));
      const l1 = (mu20 + mu02 + t) / 2, l2 = (mu20 + mu02 - t) / 2;
      const elongation = (l2 > 0.01) ? Math.sqrt(l1 / l2) : (l1 > 0.01 ? 99 : 1);

      blobs.push({ area, cx, cy, x0, y0, x1, y1, elongation });
    }
    blobs.sort((a, b) => b.area - a.area);
    return blobs;
  }

  HG.blob = { buildMask, findBlobs };
})(window.HG = window.HG || {});
