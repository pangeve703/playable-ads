import { Color, Node, Sprite, SpriteFrame, Tween, tween, UITransform } from 'cc';
import { makeNode, makeSprite, wait } from './NodeUtils';
import { PALETTE } from './LevelConfig';

/** Frame sequences of the bag animations. Each sequence has a white layer and a layer tinted with the bag colour. */
export interface BagSprites {
    openWhite: SpriteFrame[];
    openCol: SpriteFrame[];
    backWhite: SpriteFrame[];
    backCol: SpriteFrame[];
    frontWhite: SpriteFrame[];
    frontCol: SpriteFrame[];
}

/** Size of one (uncropped) bag animation frame. */
const BAG_FRAME_W = 175;
const BAG_FRAME_H = 270;

/**
 * The sheets only keep the part of each frame that is ever visible (the union over the animation), to save texture
 * memory. x/y is where that part sits in the original frame (from its top-left corner).
 */
export const BAG_CROP = {
    open: { x: 37, y: 26, w: 99, h: 231 },
    collect: { x: 8, y: 5, w: 155, h: 254 },
};
type Crop = (typeof BAG_CROP)['open'];
/** Layout bounds of one bag (the frames carry transparent padding around the bag). */
export const BAG_W = 162.5;
export const BAG_H = 325;

const FPS = 60;
const FRAME_SCALE = 1.3;
/** Fraction of the collect animation played while the bottle hovers above the bag; the rest plays as it drops in. */
const COLLECT_SPLIT = 0.2;

/** Steps one or more sprites through frame sequences in lockstep. */
class FlipBook {
    private readonly state = { frame: 0 };

    constructor(private readonly sprites: Sprite[], private readonly frames: SpriteFrame[][]) {
        this.show(0);
    }

    get length() { return this.frames[0].length; }

    show(frame: number) {
        const i = Math.min(this.length - 1, Math.max(0, Math.floor(frame)));
        this.sprites.forEach((s, k) => (s.spriteFrame = this.frames[k][i]));
    }

    /** Play from frame `from` to frame `to` (fractional frames allowed) at 60 fps. */
    play(from: number, to: number): Promise<void> {
        Tween.stopAllByTarget(this.state);
        this.state.frame = from;
        this.show(from);
        return new Promise(resolve => {
            tween(this.state)
                .to((to - from) / FPS, { frame: to }, { onUpdate: () => this.show(this.state.frame) })
                .call(() => { this.show(to); resolve(); })
                .start();
        });
    }

    stop() { Tween.stopAllByTarget(this.state); }
}

/**
 * Shopping bag that collects completed bottles. Layer order (back to front):
 * collect/back -> collect/middle (the bottle is parented here while it drops in) -> collect/front, plus the
 * separate `open` layer used for the idle and opening state.
 */
export class BagView {
    readonly node: Node;
    /** Bottles drop into this node so the front of the bag covers them. */
    readonly middle: Node;
    /** Bottles fly in here first so they are drawn above the whole bag. */
    readonly front: Node;

    private readonly open: Node;
    private readonly collect: Node;
    private readonly openAnim: FlipBook;
    private readonly collectAnim: FlipBook;

    constructor(parent: Node, readonly color: string, sp: BagSprites) {
        const tint = PALETTE[color].tint;
        this.node = makeNode('Bag', parent);
        this.node.addComponent(UITransform).setContentSize(BAG_W, BAG_H);

        const scale = makeNode('Scale', this.node);
        scale.setScale(FRAME_SCALE, FRAME_SCALE, 1);

        this.collect = makeNode('Collect', scale);
        const back = makeNode('Back', this.collect);
        const c = BAG_CROP.collect;
        const backWhite = this.frame(back, sp.backWhite[0], c);
        const backCol = this.frame(back, sp.backCol[0], c, tint);
        this.middle = makeNode('Middle', this.collect);
        this.front = makeNode('Front', this.collect);
        const frontWhite = this.frame(this.front, sp.frontWhite[0], c);
        const frontCol = this.frame(this.front, sp.frontCol[0], c, tint);
        this.collectAnim = new FlipBook(
            [backWhite, backCol, frontWhite, frontCol],
            [sp.backWhite, sp.backCol, sp.frontWhite, sp.frontCol],
        );
        this.collect.active = false;

        this.open = makeNode('Open', scale);
        const openWhite = this.frame(this.open, sp.openWhite[0], BAG_CROP.open);
        const openCol = this.frame(this.open, sp.openCol[0], BAG_CROP.open, tint);
        this.openAnim = new FlipBook([openWhite, openCol], [sp.openWhite, sp.openCol]);
    }

    /** Handles swing open. Resolves shortly after the animation so the bag can settle. */
    async playOpen(): Promise<void> {
        this.collect.active = false;
        this.open.active = true;
        await Promise.all([this.openAnim.play(0, this.openAnim.length), wait(0.25)]);
    }

    /** Swap to the collect layers (frame 0 matches the last open frame). */
    prepareCollect() {
        this.openAnim.stop();
        this.open.active = false;
        this.collect.active = true;
        this.collectAnim.show(0);
    }

    /** First part of the collect animation: the bag starts to open its mouth, then holds. */
    collectPart1(): Promise<void> {
        return this.collectAnim.play(0, this.collectAnim.length * COLLECT_SPLIT);
    }

    /** Rest of the collect animation: the mouth opens wide around the bottle and closes again. */
    collectPart2(): Promise<void> {
        return this.collectAnim.play(this.collectAnim.length * COLLECT_SPLIT, this.collectAnim.length);
    }

    destroy() {
        this.openAnim.stop();
        this.collectAnim.stop();
        this.node.destroy();
    }

    /** A cropped frame placed where that part sits in the full frame. */
    private frame(parent: Node, sf: SpriteFrame, crop: Crop, tint?: Color): Sprite {
        const node = makeSprite('Frame', parent, sf, crop.w, crop.h, tint);
        node.setPosition(crop.x + crop.w / 2 - BAG_FRAME_W / 2, BAG_FRAME_H / 2 - (crop.y + crop.h / 2));
        return node.getComponent(Sprite)!;
    }
}
