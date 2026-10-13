#!/usr/bin/env python3
"""
tools/make_sample3d.py — お手本動画（合成）を作って js/hg3d/samples3d.js に埋め込む

  python3 tools/make_sample3d.py            # 両方
  python3 tools/make_sample3d.py throw      # 投射だけ作り直す

ターンテーブルの上の A4 の紙と、紙に貼ったピンクのシール（中心に黒点）を、
標準カメラ（横の画角 69°）で 0.55 m・仰角 40° の斜め上から撮った絵を描く。
紙は盤と一緒に回る（実際の授業の撮り方と同じ）。33⅓ 回転（周期 1.8 s）、時計回り。

答え（半径・周期・四隅の画像座標）は samples/turntable.json に書く。
自動テスト（tools/test/e2e.js）が、四隅をこの座標で押して、復元した半径と
Δv の向きを確かめる。

なぜ埋め込むのか（2D の tools/make_samples.py と同じ理由）：
  file:// で開いたページから <video src="..."> を読むと canvas が汚染され、
  画素が読めなくなる（追跡できない）。data: URI なら汚染されない。
iPhone の Safari 向けに MP4（H.264）、テストの Chromium 向けに WebM（VP9）の2本を入れる。
"""
import json, math, base64, pathlib, subprocess, tempfile
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
W, H, FPS, DUR = 960, 540, 30, 3.0
HFOV, DIST, ELEV = 69.0, 0.55, 40.0
PW, PH = 0.297, 0.210          # A4
R_STICK, T = 0.12, 1.8         # シールの半径・周期
R_PLAT = 0.15                  # 盤の半径
SS = 2                          # 縦横2倍で描いて縮める（ふちのギザギザ対策）

f = (W / 2) / math.tan(math.radians(HFOV / 2))
C = np.array([PW / 2, 0.0, PH / 2])               # 回転の中心＝紙の中心（世界座標、角 A が原点）
e = math.radians(ELEV)
pos = C + np.array([0.0, DIST * math.sin(e), DIST * math.cos(e)])
fw = (C - pos) / np.linalg.norm(C - pos)
right = np.cross(fw, [0, 1, 0]); right /= np.linalg.norm(right)
down = np.cross(fw, right); down /= np.linalg.norm(down)

def project(p):
    r = np.asarray(p) - pos
    xc, yc, zc = r @ right, r @ down, r @ fw
    return [float(f * xc / zc + W / 2), float(f * yc / zc + H / 2)]

# 各画素の光線が床（y=0）に当たる点（カメラは固定なので1回だけ求める）
ys, xs = np.mgrid[0:H * SS, 0:W * SS]
u = (xs + 0.5) / SS - W / 2
v = (ys + 0.5) / SS - H / 2
d = (u[..., None] * right + v[..., None] * down + f * fw)
k = -pos[1] / d[..., 1]
hit = k > 0
X = pos[0] + k * d[..., 0] - C[0]
Z = pos[2] + k * d[..., 2] - C[2]
dist_px = k * np.linalg.norm(d, axis=-1)

def frame(t):
    th = -2 * math.pi * t / T                # 上から見て時計回り
    c, s = math.cos(th), math.sin(th)
    # 紙（回っている）の座標へ
    a = c * X + s * Z
    b = -s * X + c * Z
    img = np.zeros((H * SS, W * SS, 3), np.float32)
    img[:] = (0.80, 0.80, 0.78)                                   # 奥の壁
    table = hit & (dist_px < 4)
    shade = np.clip(1.05 - 0.12 * dist_px, 0.6, 1)[..., None]
    img[table] = (np.array([0.62, 0.55, 0.47]) * shade)[table]     # 机
    plat = table & (X ** 2 + Z ** 2 < R_PLAT ** 2)
    img[plat] = (0.17, 0.18, 0.20)                                # 盤
    paper = table & (np.abs(a) < PW / 2) & (np.abs(b) < PH / 2)
    img[paper] = (0.96, 0.96, 0.94)                               # 紙
    sx, sz = R_STICK, 0.0                                         # シールは紙の長い軸の上
    rr = (a - sx) ** 2 + (b - sz) ** 2
    img[paper & (rr < 0.012 ** 2)] = (1.0, 0.24, 0.54)            # ピンクのシール
    img[paper & (rr < 0.0032 ** 2)] = (0.05, 0.05, 0.05)          # 黒点
    img = img.reshape(H, SS, W, SS, 3).mean(axis=(1, 3))
    return (np.clip(img, 0, 1) * 255).astype(np.uint8)

def turntable():
    n = int(round(DUR * FPS))
    tmp = pathlib.Path(tempfile.mkdtemp())
    for i in range(n + 1):
        (tmp / ('f%04d.rgb' % i)).write_bytes(frame(i / FPS).tobytes())
    raw = tmp / 'all.rgb'
    with open(raw, 'wb') as fo:
        for i in range(n + 1):
            fo.write((tmp / ('f%04d.rgb' % i)).read_bytes())
    common = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
              '-s', '%dx%d' % (W, H), '-r', str(FPS), '-i', str(raw)]
    out = ROOT / 'samples'
    out.mkdir(exist_ok=True)
    subprocess.run(common + ['-c:v', 'libx264', '-profile:v', 'baseline', '-pix_fmt', 'yuv420p',
                             '-crf', '26', '-movflags', '+faststart', str(out / 'turntable.mp4')], check=True)
    subprocess.run(common + ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-b:v', '0', '-crf', '38',
                             str(out / 'turntable.webm')], check=True)

    truth = {
        'W': W, 'H': H, 'fps': FPS, 'R': R_STICK, 'T': T, 'paper': [PW, PH],
        # t=0 の紙の四隅（長い辺の端から一周）：角 A=(0,0)、B=(PW,0)、C=(PW,PH)、D=(0,PH)
        'corners_t0': [project([0, 0, 0]), project([PW, 0, 0]), project([PW, 0, PH]), project([0, 0, PH])],
        'center_px': project(C),
        'sticker_t0': project(C + np.array([R_STICK, 0, 0])),
        'camera': {'hfov': HFOV, 'dist': DIST, 'elev': ELEV}
    }
    (out / 'turntable.json').write_text(json.dumps(truth, indent=1), encoding='utf-8')

    print('turntable', [ (out / q).stat().st_size // 1024 for q in ['turntable.mp4', 'turntable.webm'] ], 'KB')


# ===================================================================
# ボードに沿った斜方投射（鉛直な面の 4-A）
#   ボード（灰色）に模造紙の半分（788×545 mm、白）を貼り、右に糸とおもり。
#   ピンクのボール（半径 3 cm、中心に黒点）がボードの手前 3.5 cm を飛ぶ。
#   カメラは標準（横の画角 69°）、ボードの正面 1.6 m・仰角 8°、60 fps。
# ===================================================================
def throw():
    W2, H2, FPS2 = 960, 540, 30     # 30 fps（60 fps だと headless の走査でコマが落ちた。実機の動画は 60 fps 推奨のまま）
    G = 9.8
    PW2, PH2 = 0.788, 0.545
    v0 = np.array([1.5, 2.6]); p0 = np.array([-0.40, -0.05]); ZOFF, RB = 0.035, 0.03
    T = 2 * v0[1] / G
    f2 = (W2 / 2) / math.tan(math.radians(69.0 / 2))
    tgt = np.array([0.0, 0.05, 0.0]); e = math.radians(8.0)
    pos2 = tgt + np.array([0.0, 1.6 * math.sin(e), 1.6 * math.cos(e)])
    fw2 = (tgt - pos2) / np.linalg.norm(tgt - pos2)
    rt2 = np.cross(fw2, [0, 1, 0]); rt2 /= np.linalg.norm(rt2)
    dn2 = np.cross(fw2, rt2); dn2 /= np.linalg.norm(dn2)

    def proj(p):
        r = np.asarray(p, float) - pos2
        return [float(f2 * (r @ rt2) / (r @ fw2) + W2 / 2), float(f2 * (r @ dn2) / (r @ fw2) + H2 / 2)]

    ys, xs = np.mgrid[0:H2 * SS, 0:W2 * SS]
    u = (xs + 0.5) / SS - W2 / 2; v = (ys + 0.5) / SS - H2 / 2
    d = u[..., None] * rt2 + v[..., None] * dn2 + f2 * fw2
    k = -pos2[2] / d[..., 2]                       # ボード（z = 0）との交点
    X = pos2[0] + k * d[..., 0]; Y = pos2[1] + k * d[..., 1]
    base = np.zeros((H2 * SS, W2 * SS, 3), np.float32)
    base[:] = (0.72, 0.74, 0.76)                   # ボード
    base[Y < -0.45] = (0.55, 0.50, 0.44)            # 床（ボードの下は床が見える体）
    paper = (np.abs(X) < PW2 / 2) & (np.abs(Y - 0.05) < PH2 / 2)
    base[paper] = (0.96, 0.96, 0.94)
    # 糸（ボードの 1 cm 手前、x = 0.48）とおもり。画面上の太さ 2 px ほど
    a = np.array(proj([0.48, 0.42, 0.01])); bpt = np.array(proj([0.48, -0.25, 0.01]))
    P = np.stack([(xs + 0.5) / SS, (ys + 0.5) / SS], -1)
    ab = bpt - a; tt = np.clip(((P - a) @ ab) / (ab @ ab), 0, 1)
    dist = np.linalg.norm(P - (a + tt[..., None] * ab), axis=-1)
    base[dist < 1.1] = (0.10, 0.10, 0.12)
    wpt = np.array(proj([0.48, -0.27, 0.01]))
    base[np.linalg.norm(P - wpt, axis=-1) < 7] = (0.25, 0.25, 0.28)

    pre, post = int(0.2 * FPS2), int(0.2 * FPS2)
    nfl = int(math.floor(T * FPS2))
    n = pre + nfl + post
    tmp = pathlib.Path(tempfile.mkdtemp())
    raw = tmp / 'all.rgb'
    with open(raw, 'wb') as fo:
        for i in range(n + 1):
            t = min(max(0, (i - pre) / FPS2), nfl / FPS2)
            c3 = np.array([p0[0] + v0[0] * t, p0[1] + v0[1] * t - G * t * t / 2, ZOFF])
            cc = np.array(proj(c3)); depth = (c3 - pos2) @ fw2
            rpx = f2 * RB / depth
            img = base.copy()
            dd = np.linalg.norm(P - cc, axis=-1)
            img[dd < rpx] = (1.0, 0.24, 0.54)
            img[dd < rpx * 0.25] = (0.05, 0.05, 0.05)
            img = img.reshape(H2, SS, W2, SS, 3).mean(axis=(1, 3))
            fo.write((np.clip(img, 0, 1) * 255).astype(np.uint8).tobytes())
    common = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
              '-s', '%dx%d' % (W2, H2), '-r', str(FPS2), '-i', str(raw)]
    out = ROOT / 'samples'
    subprocess.run(common + ['-c:v', 'libx264', '-profile:v', 'baseline', '-pix_fmt', 'yuv420p',
                             '-crf', '26', '-movflags', '+faststart', str(out / 'throw.mp4')], check=True)
    subprocess.run(common + ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-b:v', '0', '-crf', '38',
                             str(out / 'throw.webm')], check=True)
    cy = 0.05
    truth = {
        'W': W2, 'H': H2, 'fps': FPS2, 'g': G, 'v0': v0.tolist(), 'offset': ZOFF, 'paper': [PW2, PH2],
        'launchIndex': pre, 'landIndex': pre + nfl, 'launchT': pre / FPS2, 'landT': (pre + nfl) / FPS2,
        # 長い辺の端（左上）から一周
        'corners_t0': [proj([-PW2 / 2, cy + PH2 / 2, 0]), proj([PW2 / 2, cy + PH2 / 2, 0]),
                       proj([PW2 / 2, cy - PH2 / 2, 0]), proj([-PW2 / 2, cy - PH2 / 2, 0])],
        'plumb': [proj([0.48, 0.35, 0.01]), proj([0.48, -0.18, 0.01])],
        'ball_t0': proj([p0[0], p0[1], ZOFF])
    }
    (out / 'throw.json').write_text(json.dumps(truth, indent=1), encoding='utf-8')
    print('throw', [(out / q).stat().st_size // 1024 for q in ['throw.mp4', 'throw.webm']], 'KB')


def write_js():
    out = ROOT / 'samples'
    b64 = lambda p, m: 'data:%s;base64,%s' % (m, base64.b64encode(p.read_bytes()).decode('ascii'))
    items = []
    for key in ['turntable', 'throw']:
        if not (out / (key + '.mp4')).exists():
            continue
        items.append('    %s: {\n      mp4: "%s",\n      webm: "%s"\n    }' % (
            key, b64(out / (key + '.mp4'), 'video/mp4'), b64(out / (key + '.webm'), 'video/webm')))
    js = """/* 自動生成ファイル。編集しないこと。
   tools/make_sample3d.py が samples/*.mp4|webm から作ります（合成のお手本動画）。 */
(function (HG) {
  'use strict';
  HG.samples3d = {
%s
  };
})(window.HG = window.HG || {});
""" % ',\n'.join(items)
    (ROOT / 'js' / 'hg3d' / 'samples3d.js').write_text(js, encoding='utf-8')
    print('samples3d.js', len(js) // 1024, 'KB')


import sys
which = sys.argv[1:] or ['turntable', 'throw']
if 'turntable' in which: turntable()
if 'throw' in which: throw()
write_js()
