/* =====================================================================
   analysis/color.js — 色の扱い

   RGB のまま距離を測ると、照明が明るくなっただけで別の色と判定される。
   HSV に変換し、色相（H）と彩度（S）で閾値処理する。明るさ（V）は
   下限だけを見る。これで教室の照明ムラにかなり強くなる。
   ===================================================================== */
(function (HG) {
  'use strict';

  /** @returns {{h:number(0..360), s:number(0..1), v:number(0..1)}} */
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d > 0) {
      if (max === r)      h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else                h = 60 * ((r - g) / d + 4);
      if (h < 0) h += 360;
    }
    return { h: h, s: max === 0 ? 0 : d / max, v: max };
  }

  /** 色相の差（0〜180）。0°と359°が近いことを正しく扱う */
  function hueDiff(a, b) {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  /**
   * 画像の (cx, cy) 周辺の平均色を取る。生徒が画面上のシールをタップして
   * 「この色を追う」と指定するときに使う。
   * 色相は角度なので単純平均せず、単位ベクトルの平均から求める。
   */
  function sampleAround(imgData, cx, cy, radius) {
    const w = imgData.width, ih = imgData.height, d = imgData.data;
    let sx = 0, sy = 0, ss = 0, sv = 0, n = 0;
    const x0 = Math.max(0, Math.round(cx - radius)), x1 = Math.min(w - 1, Math.round(cx + radius));
    const y0 = Math.max(0, Math.round(cy - radius)), y1 = Math.min(ih - 1, Math.round(cy + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > radius * radius) continue;
        const k = (y * w + x) * 4;
        const c = rgbToHsv(d[k], d[k + 1], d[k + 2]);
        if (c.s < 0.15) continue;            // 灰色に近い画素は色相が当てにならない
        const rad = c.h * Math.PI / 180;
        sx += Math.cos(rad); sy += Math.sin(rad);
        ss += c.s; sv += c.v; n++;
      }
    }
    if (!n) return null;
    let h = Math.atan2(sy / n, sx / n) * 180 / Math.PI;
    if (h < 0) h += 360;
    return { h: h, s: ss / n, v: sv / n };
  }

  /** HSV を CSS の色に（UI の色チップ用） */
  function hsvToCss(c) {
    const f = n => {
      const k = (n + c.h / 60) % 6;
      return Math.round(255 * (c.v - c.v * c.s * Math.max(0, Math.min(k, 4 - k, 1))));
    };
    return 'rgb(' + f(5) + ',' + f(3) + ',' + f(1) + ')';
  }

  HG.color = { rgbToHsv, hueDiff, sampleAround, hsvToCss };
})(window.HG = window.HG || {});
