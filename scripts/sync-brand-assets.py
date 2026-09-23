# -*- coding: utf-8 -*-
"""
z1 品牌标识资源同步 —— 从仓库根 `logo/`（UI 同事的设计交付物）复制到两端 public/brand/。

用法：
    python scripts/sync-brand-assets.py

设计要点：
  * **只复制实际用到的档位**（11 个文件 / 单端 ≈ 25 KB）—— 不搬 logo/ 的 153 个文件。
  * **纯复制、不改内容**（不裁切、不改色）—— logo/ 是设计交付物，只读。
  * **两端放完全相同的清单** ⇒ 便于一条命令做 SHA256 校验。
  * ⚠️ 只在 logo 更新时手工跑；**不要进构建流程**（构建不该依赖仓库根的 logo/）。
  * ⚠️ 不删除任何文件（沙箱对批量删除有限制，且旧文件由实施清单第 72 项单独处理）。

对应设计：md/spec-20260922-v2/08-品牌标识落地.md §4
"""
import hashlib
import os
import shutil
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'logo')

# (源相对路径, 目标文件名, 用途)
MANIFEST = [
    ('primary/z1-icon.svg',              'z1-icon.svg',              '主标识 / SVG favicon / 暗色保底'),
    ('primary/z1-icon-32.png',           'z1-icon-32.png',           'favicon（16-32px）'),
    ('primary/z1-icon-square-192.png',   'z1-icon-square-192.png',   'apple-touch-icon(180) / PWA 192'),
    ('primary/z1-icon-square-512.png',   'z1-icon-square-512.png',   'PWA 512'),
    ('primary/z1-icon-maskable-192.png', 'z1-icon-maskable-192.png', 'PWA maskable 192（Android）'),
    ('primary/z1-icon-maskable-512.png', 'z1-icon-maskable-512.png', 'PWA maskable 512（Android）'),
    ('primary/z1-icon-dark.svg',         'z1-icon-dark.svg',         '暗色主题'),
    ('variants/z1-mark.svg',             'z1-mark.svg',              '桌面侧栏 / 注册页（浅底）'),
    ('variants/z1-mark-white.svg',       'z1-mark-white.svg',        '登录 hero（渐变底）/ 暗色侧栏'),
    ('lockup/z1-lockup-h.svg',           'z1-lockup-h.svg',          '桌面端登录左栏'),
    ('lockup/z1-lockup-v.svg',           'z1-lockup-v.svg',          '关于页（两端）'),
]

TARGETS = [
    ('life-assisitant-ui-mobile', '移动端'),
    ('life-assisitant-ui-desktop', '桌面端'),
]

PNG_MAGIC = b'\x89PNG\r\n\x1a\n'


def sha256(path):
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


def probe(path):
    """返回 (体积, 说明)；校验文件头，PNG 还取宽高。"""
    size = os.path.getsize(path)
    with open(path, 'rb') as f:
        head = f.read(32)
    if head[:8] == PNG_MAGIC:
        w = struct.unpack('>I', head[16:20])[0]
        h = struct.unpack('>I', head[20:24])[0]
        return size, '%dx%d' % (w, h)
    if head[:4] == b'<svg' or b'<svg' in head:
        return size, 'SVG'
    return size, '** 未知格式 **'


def main():
    if not os.path.isdir(SRC):
        print('ERROR: 找不到源目录 %s' % SRC)
        return 1

    print('源：%s' % SRC)
    print('清单：%d 个文件 x %d 端 = %d 份' % (len(MANIFEST), len(TARGETS), len(MANIFEST) * len(TARGETS)))
    print()

    # ---- 1. 逐端复制 ----
    written = {}          # 文件名 -> [(端, 路径, 体积, 说明)]
    total_per_end = 0
    for tag, label in TARGETS:
        dst_dir = os.path.join(ROOT, tag, 'public', 'brand')
        os.makedirs(dst_dir, exist_ok=True)
        print('=== %s -> %s' % (label, os.path.relpath(dst_dir, ROOT)))
        sub_total = 0
        for rel, name, use in MANIFEST:
            src_p = os.path.join(SRC, rel.replace('/', os.sep))
            if not os.path.exists(src_p):
                print('   [MISS] %-30s 源不存在: %s' % (name, rel))
                continue
            dst_p = os.path.join(dst_dir, name)
            shutil.copy2(src_p, dst_p)
            size, note = probe(dst_p)
            sub_total += size
            written.setdefault(name, []).append((tag, dst_p, size, note))
            print('   %-30s %7d B  %-10s %s' % (name, size, note, use))
        print('   ---- 小计 %d B (%.1f KB)' % (sub_total, sub_total / 1024))
        total_per_end = sub_total
        print()

    # ---- 2. 两端一致性 ----
    print('=== 两端 SHA256 一致性 ===')
    all_same = True
    for name, entries in sorted(written.items()):
        if len(entries) != len(TARGETS):
            print('   [SKIP] %-30s 端数不足' % name)
            all_same = False
            continue
        hs = {sha256(p) for _, p, _, _ in entries}
        flag = 'OK ' if len(hs) == 1 else '**不一致**'
        if len(hs) != 1:
            all_same = False
        print('   %s %-30s %s' % (flag, name, list(hs)[0][:16]))
    print()

    # ---- 3. 清理旧引用提示（只提示，不删） ----
    print('=== 旧资源（⚠️ 本脚本不删，实施清单第 72 项单独处理）===')
    for tag, label in TARGETS:
        for old in ('z1-logo.png', 'favicon.png'):
            p = os.path.join(ROOT, tag, 'public', old)
            if os.path.exists(p):
                print('   %-6s public/%-16s %8d B' % (label, old, os.path.getsize(p)))
    print()

    # ---- 4. 汇总 ----
    print('=== 汇总 ===')
    print('   单端 brand/ 体积：%d B (%.1f KB)' % (total_per_end, total_per_end / 1024))
    old_total = sum(
        os.path.getsize(os.path.join(ROOT, t, 'public', 'z1-logo.png'))
        for t, _ in TARGETS
        if os.path.exists(os.path.join(ROOT, t, 'public', 'z1-logo.png'))
    )
    print('   现状 z1-logo.png 两端合计：%d B (%.1f KB)' % (old_total, old_total / 1024))
    if old_total:
        print('   ⇒ 替换后静态资源降幅：%.1f%%' % ((1 - total_per_end / old_total) * 100))
    print()
    print('两端一致：%s' % ('✅ 是' if all_same else '❌ 否（见上）'))
    return 0 if all_same else 2


if __name__ == '__main__':
    sys.exit(main())
