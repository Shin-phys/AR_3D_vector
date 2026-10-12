/* ui/dom.js — DOM の小道具 */
(function (HG) {
  'use strict';
  HG.$ = s => document.querySelector(s);
  HG.dom = {
    show(sel) { HG.$(sel).classList.remove('hide'); },
    hide(sel) { HG.$(sel).classList.add('hide'); },
    text(sel, s) { HG.$(sel).textContent = s; },
    html(sel, s) { HG.$(sel).innerHTML = s; }
  };
})(window.HG = window.HG || {});
