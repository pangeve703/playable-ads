import { Color, Layers, Node, Rect, Size, Sprite, SpriteFrame, Texture2D, tween, UITransform, Vec2 } from 'cc';

export function makeNode(name: string, parent: Node): Node {
    const n = new Node(name);
    n.layer = Layers.Enum.UI_2D;
    parent.addChild(n);
    return n;
}

export function makeSprite(name: string, parent: Node, sf: SpriteFrame, w: number, h: number, color?: Color): Node {
    const n = makeNode(name, parent);
    const s = n.addComponent(Sprite);
    s.sizeMode = Sprite.SizeMode.CUSTOM;
    // keep the transparent margins: textures are trimmed on import, and art is laid out by its untrimmed size
    s.trim = false;
    s.spriteFrame = sf;
    n.getComponent(UITransform)!.setContentSize(w, h);
    if (color) s.color = color;
    return n;
}

/** Tween a 0..1 progress over `dur` seconds, calling `step` every frame. */
export function animate(dur: number, step: (t: number) => void): Promise<void> {
    const state = { t: 0 };
    step(0);
    return new Promise(resolve => {
        tween(state)
            .to(dur, { t: 1 }, { onUpdate: () => step(state.t) })
            .call(() => { step(1); resolve(); })
            .start();
    });
}

export function wait(sec: number): Promise<void> {
    return new Promise(resolve => tween({}).delay(sec).call(() => resolve()).start());
}

/** One sheet of an atlas written by tools/pack_sheets.py: frames as [x, y, w, h, tx, ty] (trimmed rect in the atlas, its position in the cell). */
export interface PackedSheet { cellW: number; cellH: number; frames: number[][] }

/** SpriteFrames for a packed sheet. Frames are trimmed in the atlas but keep their full cell (or `trim` frame) size. */
export function packedFrames(tex: Texture2D, sheet: PackedSheet, trim?: SheetTrim): SpriteFrame[] {
    const fullW = trim ? trim.fullW : sheet.cellW, fullH = trim ? trim.fullH : sheet.cellH;
    const ox = trim ? trim.x : 0, oy = trim ? trim.y : 0;
    return sheet.frames.map(([x, y, w, h, tx, ty]) => {
        const sf = new SpriteFrame();
        sf.texture = tex;
        sf.rect = new Rect(x, y, w, h);
        sf.originalSize = new Size(fullW, fullH);
        sf.offset = new Vec2(ox + tx + w / 2 - fullW / 2, fullH / 2 - (oy + ty + h / 2));
        return sf;
    });
}

/** Where a sheet's cells sit inside the full animation frame they were cropped from (pixels, y down). */
export interface SheetTrim { x: number; y: number; fullW: number; fullH: number }
