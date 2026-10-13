/* tools/test/unzip.js — USDZ（無圧縮の zip）の中身を読む小道具（テスト用。依存なし） */
'use strict';
function entries(buf) {
  const out = [];
  let p = 0;
  while (p + 30 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const size = buf.readUInt32LE(p + 18), nlen = buf.readUInt16LE(p + 26), elen = buf.readUInt16LE(p + 28);
    const name = buf.slice(p + 30, p + 30 + nlen).toString('utf8');
    const start = p + 30 + nlen + elen;
    out.push({ name: name, start: start, size: size });
    p = start + size;
  }
  return out;
}
module.exports = {
  list: buf => entries(buf).map(e => e.name),
  read: (buf, name) => { const e = entries(buf).find(x => x.name === name); return e ? buf.slice(e.start, e.start + e.size) : null; }
};
