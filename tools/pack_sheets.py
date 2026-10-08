#!/usr/bin/env python3
"""
Texture packer for the game art (a small stand-in for TexturePacker).

Inputs live in art_source: single images in atlas_src/ and frame animations as grid sheets (5 columns of equal
cells) in sheets_grid/. The grouping follows the reference build's own atlases: bottle parts,
liquid and particles together, logo with the hand, the end-card art together, and the bag animations together.

Output, per atlas: <name>.webp in assets/resources plus <name>.json mapping every entry to
{cellW, cellH, frames: [[x, y, w, h, tx, ty], ...]}: each frame's rect in the atlas and where that rect sits inside
its original image or cell (pixels, y down). NodeUtils.packedFrames() turns this back into SpriteFrames of the
original size, so the game code is unaware of the packing.

Frames are trimmed to their visible pixels, except sliced sprites (their insets are measured from the image edge)
and particle textures (particles ignore trim offsets). Each frame's edge pixels are extruded into the gap around it,
so filtering never pulls in a neighbour. Run from the project root:  python3 tools/pack_sheets.py   (needs Pillow)
"""
import json
import os
from PIL import Image

COLS = 5        # columns of the input grid sheets
PAD = 2         # gap between frames; the first pixel of it holds the extruded edge
MAX_SIZE = 2048
# game_atlas holds everything a bottle draws, surface animations included, so a whole bottle (and its neighbours)
# batches into one draw call. That needs more room: up to 4096 wide, which phones' GPUs support.
MAX_WIDTH = {'game/game_atlas': 4096}

SRC = 'art_source'
DST = 'assets/resources/textures'


def image(key, src, trim=True):
    return {'key': key, 'src': src, 'trim': trim}


def grid(key, src, cell_w, cell_h, count):
    return {'key': key, 'src': src, 'trim': True, 'grid': (cell_w, cell_h, count)}


ATLASES = {
    # bottle_mask_outline + bottle_parts + liquid_body_masks + liquid_pour_stream + fx particles
    'game/game_atlas': [
        image('bottle_back', 'atlas_src/game/bottle/bottle_back.png'),
        image('bottle_front', 'atlas_src/game/bottle/bottle_front.png'),
        image('bottle_mask', 'atlas_src/game/bottle/bottle_mask.png'),
        image('bottle_refl', 'atlas_src/game/bottle/bottle_refl.png'),
        image('bottle_glow', 'atlas_src/game/bottle/bottle_glow.png'),
        image('bottle_cork', 'atlas_src/game/bottle/bottle_cork.png'),
        image('bottle_shadow', 'atlas_src/game/bottle/bottle_shadow.png'),
        image('tick', 'atlas_src/ui/tick.webp'),
        image('cross', 'atlas_src/ui/cross.webp'),
        image('liquid_base', 'atlas_src/game/liquid/liquid_base.png', trim=False),
        image('liquid_shadow', 'atlas_src/game/liquid/liquid_shadow.png', trim=False),
        image('liquid_base_dim', 'atlas_src/game/liquid/liquid_base_dim.png', trim=False),
        image('liquid_shadow_dim', 'atlas_src/game/liquid/liquid_shadow_dim.png', trim=False),
        image('stream', 'atlas_src/game/liquid/stream.png', trim=False),
        image('question_mark', 'atlas_src/game/liquid/question_mark.png', trim=False),
        image('droplet', 'atlas_src/game/fx/droplet.png', trim=False),
        image('ripple', 'atlas_src/game/fx/ripple.png', trim=False),
        image('sparkle_white', 'atlas_src/game/fx/sparkle_white.png', trim=False),
        # liquid surface animations: cells cropped from the 250x125 frames (offsets in GameManager SURFACE_SHEETS)
        grid('surface_tint', 'sheets_grid/liquid/surface_tint.webp', 224, 115, 39),
        grid('surface_shadow', 'sheets_grid/liquid/surface_shadow.webp', 223, 88, 39),
        grid('surface_spec', 'sheets_grid/liquid/surface_spec.webp', 222, 68, 39),
        grid('surface_ripple', 'sheets_grid/liquid/surface_ripple.webp', 199, 80, 29),
    ],
    # ui_logo_hand
    'ui/hud_atlas': [
        image('logo', 'atlas_src/ui/logo.webp'),
        image('pointer', 'atlas_src/ui/pointer.webp'),
    ],
    # ui_rays_buttons + ui_victory_chests, split by card so only the shown card's atlas loads. The rewards panel,
    # shared by both cards and much larger than the rest, stays a texture of its own (textures/ui/panel_rewards).
    'ui/win_atlas': [
        image('rays', 'atlas_src/ui/rays.webp'),
        image('banner_victory', 'atlas_src/ui/banner_victory.webp'),
        image('chest_gold', 'atlas_src/ui/chest_gold.webp'),
        image('btn_claim', 'atlas_src/ui/btn_claim.webp'),
    ],
    'ui/lose_atlas': [
        image('chest_silver', 'atlas_src/ui/chest_silver.webp'),
        image('btn_continue', 'atlas_src/ui/btn_continue.webp'),
        image('txt_play_more', 'atlas_src/ui/txt_play_more.webp'),
    ],
    # cover_mask_sheet_*: the bag animations, plus the bag shadow
    'bag/bag_atlas': [
        grid('openWhite', 'sheets_grid/bag/open_white.webp', 99, 231, 12),
        grid('openCol', 'sheets_grid/bag/open_col.webp', 99, 231, 12),
        grid('backWhite', 'sheets_grid/bag/collect_back_white.webp', 155, 254, 19),
        grid('backCol', 'sheets_grid/bag/collect_back_col.webp', 155, 254, 19),
        grid('frontWhite', 'sheets_grid/bag/collect_front_white.webp', 155, 254, 19),
        grid('frontCol', 'sheets_grid/bag/collect_front_col.webp', 155, 254, 19),
        image('bag_shadow', 'atlas_src/bag/bag_shadow.png'),
    ],
}


def cells(entry):
    """The entry's frames as (image, cell w, cell h)."""
    src = Image.open(f'{SRC}/{entry["src"]}').convert('RGBA')
    if 'grid' not in entry:
        return [src]
    cw, ch, count = entry['grid']
    return [src.crop(((i % COLS) * cw, (i // COLS) * ch, (i % COLS + 1) * cw, (i // COLS + 1) * ch))
            for i in range(count)]


def trimmed(cell, trim):
    box = (cell.getchannel('A').getbbox() or (0, 0, 1, 1)) if trim else (0, 0, cell.width, cell.height)
    return cell.crop(box), box[0], box[1]


def skyline_pack(sizes, width, order):
    """Place rects (w, h) on the lowest skyline segment, tallest first. Returns positions and the height used."""
    sky = [(0, 0, width)]  # segments (x, y, w)
    pos = [None] * len(sizes)
    for i in sorted(range(len(sizes)), key=order):
        w, h = sizes[i][0] + PAD, sizes[i][1] + PAD
        best = None
        for s in range(len(sky)):
            x = sky[s][0]
            if x + w > width:
                break
            y, span, j = 0, 0, s
            while span < w:
                y = max(y, sky[j][1])
                span += sky[j][2]
                j += 1
            if best is None or y + h < best[1] + best[2]:
                best = (x, y, h)
        if best is None:
            return None, None
        x, y, h = best
        pos[i] = (x + PAD // 2, y + PAD // 2)
        new, end = [], x + w
        for sx, sy, sw in sky:
            if sx + sw <= x or sx >= end:
                new.append((sx, sy, sw))
                continue
            if sx < x:
                new.append((sx, sy, x - sx))
            if sx + sw > end:
                new.append((end, sy, sx + sw - end))
        new.append((x, y + h, w))
        new.sort()
        merged = []
        for seg in new:
            if merged and merged[-1][1] == seg[1] and merged[-1][0] + merged[-1][2] == seg[0]:
                merged[-1] = (merged[-1][0], seg[1], merged[-1][2] + seg[2])
            else:
                merged.append(seg)
        sky = merged
    return pos, max(y for _, y, _ in sky)


def paste_extruded(atlas, img, x, y):
    """Paste `img` at (x, y) and repeat its outermost pixels one pixel further out."""
    w, h = img.size
    atlas.paste(img.crop((0, 0, w, 1)), (x, y - 1))
    atlas.paste(img.crop((0, h - 1, w, h)), (x, y + h))
    atlas.paste(img, (x, y))
    col_l, col_r = img.crop((0, 0, 1, h)), img.crop((w - 1, 0, w, h))
    atlas.paste(col_l, (x - 1, y))
    atlas.paste(col_r, (x + w, y))
    for cx, cy, px in ((x - 1, y - 1, (0, 0)), (x + w, y - 1, (w - 1, 0)),
                       (x - 1, y + h, (0, h - 1)), (x + w, y + h, (w - 1, h - 1))):
        atlas.putpixel((cx, cy), img.getpixel(px))


def pack(name, entries):
    frames = []  # (key, image, tx, ty)
    data = {}
    source_px = 0
    for e in entries:
        cs = cells(e)
        source_px += sum(c.width * c.height for c in cs) if 'grid' not in e else \
            Image.open(f'{SRC}/{e["src"]}').size[0] * Image.open(f'{SRC}/{e["src"]}').size[1]
        data[e['key']] = {'cellW': cs[0].width, 'cellH': cs[0].height, 'frames': []}
        for c in cs:
            img, tx, ty = trimmed(c, e['trim'])
            frames.append((e['key'], img, tx, ty))
    sizes = [f[1].size for f in frames]
    best = None
    orders = [lambda i: -sizes[i][1], lambda i: -sizes[i][0], lambda i: -sizes[i][0] * sizes[i][1],
              lambda i: -max(sizes[i])]
    max_width = MAX_WIDTH.get(name, MAX_SIZE)
    for width in range(128, max_width + 1, 8 if max_width <= 2048 else 16):
        for order in orders:
            pos, height = skyline_pack(sizes, width, order)
            if pos and height <= MAX_SIZE and (best is None or width * height < best[0] * best[1]):
                best = (width, height, pos)
    if best is None:
        raise SystemExit(f'{name}: does not fit in {max_width}x{MAX_SIZE}')
    width, height, pos = best
    atlas = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    for (key, img, tx, ty), (x, y) in zip(frames, pos):
        paste_extruded(atlas, img, x, y)
        data[key]['frames'].append([x, y, img.width, img.height, tx, ty])
    atlas.save(f'{DST}/{name}.webp', 'WEBP', quality=92, method=6)
    with open(f'{DST}/{name}.json', 'w') as fh:
        json.dump(data, fh, separators=(',', ':'))
    print(f'{name}: {len(frames)} frames -> {width}x{height}, GPU {width * height * 4 / 2**20:.2f} MB '
          f'(separate textures {source_px * 4 / 2**20:.2f} MB), file {os.path.getsize(f"{DST}/{name}.webp") // 1024} KB')


if __name__ == '__main__':
    for atlas_name, atlas_entries in ATLASES.items():
        pack(atlas_name, atlas_entries)
