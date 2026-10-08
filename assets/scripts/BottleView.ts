import { Color, Graphics, Mask, Node, ParticleSystem2D, Sprite, SpriteFrame, Tween, tween, UIOpacity, UITransform, Vec2, Vec3 } from 'cc';
import { completeSparkle, FxSprites, questionBurst, streamDroplets, streamRipple, streamSplash } from './Fx';
import { HIDDEN, HIDDEN_LIQUID, LiquidColor, PALETTE } from './LevelConfig';
import { animate, makeNode, makeSprite } from './NodeUtils';

export interface SurfaceFrames {
    tint: SpriteFrame[];
    ripple: SpriteFrame[];
    shadow: SpriteFrame[];
    spec: SpriteFrame[];
}

export interface BottleSprites {
    back: SpriteFrame;        // inside of the glass (mouth rim, bottom)
    front: SpriteFrame;       // glass outline drawn over the liquid
    mask: SpriteFrame;        // bottle silhouette, stencil for the liquid
    refl: SpriteFrame;        // reflection streak
    glow: SpriteFrame;        // selection / warning outline
    cork: SpriteFrame;        // cork, drawn in a glass-sized canvas
    liquid: SpriteFrame;      // 9-sliced liquid cylinder
    liquidShadow: SpriteFrame;
    liquidDim: SpriteFrame;   // flat variants used under the top layer while dimmed by the tutorial
    liquidShadowDim: SpriteFrame;
    question: SpriteFrame;
    stream: SpriteFrame;      // 9-sliced pour stream
    tick: SpriteFrame;
    cross: SpriteFrame;
    surface: SurfaceFrames;
    fx: FxSprites;
}

// All sizes below are in the reference bottle's own units; the board scales bottles down to screen size.

/** Bottle node size, used for layout and as the touch area. */
export const BOTTLE_W = 845;
export const BOTTLE_H = 1916;
/** Every bottle part sits in a child node scaled by this. */
const INNER_SCALE = 1.3;
const GLASS_W = 650;
const GLASS_H = 1474;
const MASK_W = 600;

// Liquid layers, in glass-centred inner units.
const SEG_W = 433;
const SEG_BOTTOM = -635;
const SEG_STEP = 221;
const SEG_FULL_H = 315;
const SEG_EMPTY_H = 90;
/** The liquid sprite reaches this far above its layer (its top ellipse). */
const SEG_SPRITE_EXTRA = 100;
export const LIQUID_INSET_TOP = 105;
export const LIQUID_INSET_BOTTOM = 95;
const SURFACE_W = 502;
const SURFACE_H = 217;
const SURFACE_Y = 4;
const QUESTION_Y = 70;
const QUESTION_SIZE = 110;
const QUESTION_FX_Y = 155;
const QUESTION_COLOR = new Color(178, 178, 178, 255);

// Box model of the liquid used while the bottle tilts (reference BottleVisual.init values).
const WATER_W = 433;
const WATER_SEG_H = 244.5;
const WATER_BOTTLE_H = 1219.3;
const WATER_LEFT = -217.5;
const WATER_BOTTOM = -635.5;
const TILT_SURFACE_RATIO = 535 / 450;

/** Mouth corners, in bottle (root) units. */
const MOUTH = new Vec3(113 * INNER_SCALE, 584 * INNER_SCALE, 0);
/** Top of the incoming pour stream, in inner units. */
const STREAM_TOP = 1153;
const STREAM_W = 60;
const STREAM_FX_Y = -138;
export const STREAM_INSET_TOP = 74;
export const STREAM_INSET_BOTTOM = 14;

const CORK_Y = 5;
const CORK_DROP = 500;
/** Completion sparkle emitter: the reference spawns it at (0, -30) on its "BottleTop" node, which sits at the bottle's
 * centre, so the sparkles fill the liquid rather than the neck. */
const SPARKLE_Y = -30;
const MARK_Y = 835;
const MARK_SIZE = 400;
const MARK_SCALE = 0.8;

/** Lift when selected, in bottle units, and how long a full lift takes. */
export const LIFT_HEIGHT = 300;
export const LIFT_DURATION = 0.1;

const FPS = 60;
const SPEC_OPACITY = 127;
const EPS = 1e-4;

export const isHidden = (layer: string) => layer.startsWith(HIDDEN);
const colorKey = (layer: string) => (isHidden(layer) ? layer.slice(HIDDEN.length) : layer);
const colorsOf = (layer: string): LiquidColor => (isHidden(layer) ? HIDDEN_LIQUID : PALETTE[layer]);

function lerpColor(a: Color, b: Color, t: number): Color {
    return new Color(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, a.a + (b.a - a.a) * t);
}

/** Animated liquid surface: four frame sequences (tint, ripple, shadow, specular) played together at 60 fps. */
class SurfaceView {
    readonly node: Node;
    private readonly layers: { sprite: Sprite; frames: SpriteFrame[] }[];
    /** Length in frames of the longest sequence (the wobble is over when it ends). */
    private readonly length: number;
    private time = 0;
    private playing = false;
    private loop = false;

    constructor(parent: Node, frames: SurfaceFrames, private readonly spriteRatio: number) {
        this.node = makeNode('Surface', parent);
        this.layers = [frames.tint, frames.ripple, frames.shadow, frames.spec].map((f, i) => {
            const n = makeSprite(['Tint', 'Ripple', 'Shadow', 'Spec'][i], this.node, f[0], SURFACE_W, SURFACE_H);
            if (i === 3) n.addComponent(UIOpacity).opacity = SPEC_OPACITY;
            return { sprite: n.getComponent(Sprite)!, frames: f };
        });
        this.length = Math.max(...this.layers.map(l => l.frames.length));
        this.reset();
    }

    setColors(c: LiquidColor) {
        this.layers[0].sprite.color = c.tint;
        this.layers[1].sprite.color = c.ripple;
        this.layers[2].sprite.color = c.shadow;
    }

    setWidth(w: number) {
        for (const l of this.layers) l.sprite.node.getComponent(UITransform)!.setContentSize(w * this.spriteRatio, SURFACE_H);
    }

    /** Settled surface (end of the wobble). */
    reset() {
        this.playing = false;
        this.layers.forEach((l, i) => (l.sprite.spriteFrame = i === 3 ? l.frames[0] : l.frames[l.frames.length - 1]));
    }

    play(loop: boolean) {
        this.time = 0;
        this.loop = loop;
        this.playing = true;
        this.show();
    }

    get isPlaying() { return this.playing; }

    tick(dt: number) {
        if (!this.playing) return;
        this.time += dt;
        if (!this.loop && this.time * FPS >= this.length) this.playing = false;
        this.show();
    }

    private show() {
        const f = Math.floor(this.time * FPS);
        for (const l of this.layers) {
            const n = l.frames.length;
            l.sprite.spriteFrame = l.frames[this.loop ? f % n : Math.min(f, n - 1)];
        }
    }
}

/** One liquid layer. The shadow, surface and question mark are children of the body so they hide with it. */
class Segment {
    readonly node: Node;
    readonly body: Sprite;
    readonly shade: Sprite;
    readonly surface: SurfaceView;
    readonly question: Node;
    readonly questionOpacity: UIOpacity;
    height = SEG_FULL_H;
    /** 0 = still drawn as hidden, 1 = fully revealed (animated by the reveal). */
    reveal = 1;

    constructor(parent: Node, index: number, sp: BottleSprites) {
        this.node = makeNode('Segment', parent);
        this.node.setPosition(0, SEG_BOTTOM + SEG_STEP * index);
        const body = makeSprite('Liquid', this.node, sp.liquid, SEG_W, SEG_FULL_H + SEG_SPRITE_EXTRA);
        body.getComponent(UITransform)!.setAnchorPoint(0.5, 0);
        this.body = body.getComponent(Sprite)!;
        const shade = makeSprite('Shadow', body, sp.liquidShadow, SEG_W, SEG_FULL_H + SEG_SPRITE_EXTRA);
        shade.getComponent(UITransform)!.setAnchorPoint(0.5, 0);
        this.shade = shade.getComponent(Sprite)!;
        this.surface = new SurfaceView(body, sp.surface, SURFACE_W / SEG_W);
        this.surface.setWidth(SEG_W);
        this.question = makeSprite('Question', body, sp.question, QUESTION_SIZE, QUESTION_SIZE, QUESTION_COLOR);
        this.question.getComponent(UITransform)!.setAnchorPoint(0.5, 0);
        this.question.setPosition(0, QUESTION_Y);
        this.questionOpacity = this.question.addComponent(UIOpacity);
        this.setHeight(SEG_FULL_H);
    }

    setHeight(h: number) {
        this.height = h;
        for (const s of [this.body, this.shade]) s.node.getComponent(UITransform)!.setContentSize(SEG_W, h + SEG_SPRITE_EXTRA);
        this.surface.node.setPosition(0, h + SURFACE_Y);
    }
}

export class BottleView {
    readonly node: Node;
    /** Logical layers bottom -> top. Hidden layers are prefixed with HIDDEN. */
    layers: string[];
    home = new Vec3();
    /** True while this bottle pours or is being completed; it ignores taps meanwhile. */
    busy = false;
    /** Pours currently running into this bottle. Like the reference, more can join; it can't be lifted meanwhile. */
    incoming = 0;
    /** Soft shadow under the bottle; it lives on the board behind all bottles. */
    shadow: { node: Node; opacity: UIOpacity } | null = null;

    /** What is drawn: layers and fill level (fractional while pouring). Follows `layers` when idle. */
    private display: string[];
    private level: number;
    /** Pours whose stream is currently running into this bottle; they share one stream. */
    private streams = 0;

    private readonly inner: Node;
    private readonly glassOpacity: UIOpacity;
    private readonly clip: Mask;
    private readonly water: Graphics;
    private readonly tiltSurface: SurfaceView;
    private readonly segments: Segment[] = [];
    private readonly stream: Node;
    private readonly streamSprite: Sprite;
    private readonly cork: Node;
    private readonly glow: Sprite;
    private readonly tickMark: Node;
    private readonly crossMark: Node;
    private corked = false;
    private dimmed = false;
    private graphicsMode = false;
    private lift = 0;
    private readonly liftState = { p: 0 };
    private streamFx: ParticleSystem2D[] = [];

    constructor(parent: Node, layers: string[], readonly capacity: number, private readonly sp: BottleSprites) {
        this.layers = [...layers];
        this.display = [...layers];
        this.level = layers.length;

        this.node = makeNode('Bottle', parent);
        this.node.addComponent(UITransform).setContentSize(BOTTLE_W, BOTTLE_H);
        this.inner = makeNode('Scale', this.node);
        this.inner.setScale(INNER_SCALE, INNER_SCALE, 1);

        const glass = makeNode('Glass', this.inner);
        this.glassOpacity = glass.addComponent(UIOpacity);
        makeSprite('Back', glass, sp.back, GLASS_W, GLASS_H);

        const clip = makeNode('Clip', glass);
        clip.addComponent(UITransform).setContentSize(MASK_W, GLASS_H);
        this.clip = clip.addComponent(Mask);
        this.clip.type = Mask.Type.SPRITE_STENCIL;
        this.clip.spriteFrame = sp.mask;
        this.clip.alphaThreshold = 0.1;
        // The upright liquid sprites already fit the glass, so the stencil is only needed while the bottle tilts;
        // keeping it off the rest of the time saves a stencil pass per bottle every frame.
        this.clip.enabled = false;
        const stencil = clip.getComponent(Sprite);
        if (stencil) {
            stencil.trim = false;
            stencil.sizeMode = Sprite.SizeMode.CUSTOM;
            clip.getComponent(UITransform)!.setContentSize(MASK_W, GLASS_H);
        }
        this.water = makeNode('Water', clip).addComponent(Graphics);
        this.tiltSurface = new SurfaceView(clip, sp.surface, TILT_SURFACE_RATIO);
        this.tiltSurface.node.active = false;
        for (let i = 0; i < capacity; i++) this.segments.push(new Segment(clip, i, sp));

        this.stream = makeNode('Stream', glass);
        this.stream.setPosition(0, STREAM_TOP);
        const streamNode = makeSprite('StreamSprite', this.stream, sp.stream, STREAM_W, 100);
        streamNode.getComponent(UITransform)!.setAnchorPoint(0.5, 1);
        this.streamSprite = streamNode.getComponent(Sprite)!;
        this.streamSprite.type = Sprite.Type.SLICED;
        this.stream.active = false;

        this.cork = makeSprite('Cork', glass, sp.cork, GLASS_W, GLASS_H);
        this.cork.active = false;
        makeSprite('Front', glass, sp.front, GLASS_W, GLASS_H);
        makeSprite('Reflection', glass, sp.refl, GLASS_W, GLASS_H);

        this.tickMark = makeSprite('Tick', this.inner, sp.tick, MARK_SIZE, MARK_SIZE);
        this.crossMark = makeSprite('Cross', this.inner, sp.cross, MARK_SIZE, MARK_SIZE);
        for (const mark of [this.tickMark, this.crossMark]) {
            mark.setPosition(0, MARK_Y);
            mark.setScale(MARK_SCALE, MARK_SCALE, 1);
            mark.active = false;
        }
        this.glow = makeSprite('Outline', this.inner, sp.glow, GLASS_W, GLASS_H, new Color(255, 255, 255, 0)).getComponent(Sprite)!;

        this.render();
    }

    // ---------------------------------------------------------------- rules

    get isEmpty() { return this.layers.length === 0; }
    get isFull() { return this.layers.length >= this.capacity; }
    get isCorked() { return this.corked; }

    /** Visible top colour and how many units of it are stacked on top. Null colour if empty or hidden. */
    top(): { color: string | null; count: number } {
        const last = this.layers[this.layers.length - 1];
        if (!last || isHidden(last)) return { color: null, count: 0 };
        let count = 0;
        for (let i = this.layers.length - 1; i >= 0 && this.layers[i] === last; i--) count++;
        return { color: last, count };
    }

    isComplete(): boolean {
        return this.isFull && this.layers.every(l => l === this.layers[0] && !isHidden(l));
    }

    /** Reveal the hidden top layer and the hidden layers of the same colour right below it. Returns their indices. */
    revealTop(): number[] {
        const revealed: number[] = [];
        let i = this.layers.length - 1;
        if (i < 0 || !isHidden(this.layers[i])) return revealed;
        const hidden = this.layers[i];
        while (i >= 0 && this.layers[i] === hidden) {
            this.layers[i] = colorKey(hidden);
            revealed.push(i--);
        }
        return revealed;
    }

    // ---------------------------------------------------------------- per-frame

    tick(dt: number) {
        for (const s of this.segments) s.surface.tick(dt);
        this.tiltSurface.tick(dt);
    }

    /** Update the liquid layers from `display` / `level`. */
    private render() {
        const full = Math.floor(this.level + EPS);
        const shown = Math.ceil(this.level - EPS);
        this.segments.forEach((s, i) => {
            const visible = i < shown && !!this.display[i] && !this.graphicsMode;
            s.body.node.active = visible;
            if (!visible) return;
            s.setHeight(i < full ? SEG_FULL_H : SEG_EMPTY_H + (this.level - i) * (SEG_FULL_H - SEG_EMPTY_H));

            const layer = this.display[i];
            const hidden = isHidden(layer);
            const c = colorsOf(layer);
            const t = hidden ? 0 : s.reveal;
            const mix = (k: keyof LiquidColor) => lerpColor(HIDDEN_LIQUID[k], c[k], t);
            const isTop = i === shown - 1;
            const flat = this.dimmed && !isTop;
            s.body.spriteFrame = flat ? this.sp.liquidDim : this.sp.liquid;
            s.shade.spriteFrame = flat ? this.sp.liquidShadowDim : this.sp.liquidShadow;
            s.body.type = s.shade.type = flat ? Sprite.Type.SIMPLE : Sprite.Type.SLICED;
            s.body.color = mix('base');
            s.shade.color = mix('shadow');
            s.surface.setColors({ base: mix('base'), tint: mix('tint'), shadow: mix('shadow'), ripple: mix('ripple') });
            s.surface.node.active = !this.dimmed || isTop;
            s.question.active = hidden || s.reveal < 1;
            s.questionOpacity.opacity = hidden ? 255 : 255 * (1 - s.reveal);
        });
    }

    /** Play the surface wobble on the top layer (after the bottle is lifted, lowered or poured from). */
    playTopSurface() {
        this.segments[Math.ceil(this.level - EPS) - 1]?.surface.play(false);
    }

    // ---------------------------------------------------------------- selection

    /** 0 = resting, 1 = fully lifted. The outline fades in with the lift. */
    setLift(p: number) {
        this.lift = p;
        this.node.setPosition(this.home.x, this.home.y + LIFT_HEIGHT * p, 0);
        Tween.stopAllByTarget(this.glow);
        this.glow.color = new Color(255, 255, 255, 255 * p);
    }

    get liftProgress() { return this.lift; }

    /** Lift or lower at the reference speed (a full lift takes LIFT_DURATION); the top surface wobbles on arrival. */
    liftTo(target: number, onArrive?: () => void) {
        Tween.stopAllByTarget(this.liftState);
        const dur = Math.abs(target - this.lift) * LIFT_DURATION;
        if (dur <= 0) return;
        this.liftState.p = this.lift;
        tween(this.liftState)
            .to(dur, { p: target }, { onUpdate: () => this.setLift(this.liftState.p) })
            .call(() => { this.setLift(target); this.playTopSurface(); onArrive?.(); })
            .start();
    }

    stopLift() { Tween.stopAllByTarget(this.liftState); }

    /** Fade the outline out (the lifted bottle starts to pour). */
    fadeOutline(dur: number) {
        this.lift = 0;
        Tween.stopAllByTarget(this.glow);
        tween(this.glow).to(dur, { color: new Color(255, 255, 255, 0) }).start();
    }

    /** Red outline flashing `times` times (played on every unfinished bottle before the "out of moves" card). */
    pulseOutline(times: number): Promise<void> {
        Tween.stopAllByTarget(this.glow);
        const pulse = tween<Sprite>()
            .to(0.25, { color: new Color(255, 0, 0, 0) }, { easing: 'sineInOut' })
            .to(0.25, { color: new Color(255, 0, 0, 80) }, { easing: 'sineInOut' });
        return new Promise(resolve => {
            tween(this.glow).repeat(times, pulse).call(() => {
                this.glow.color = new Color(255, 255, 255, 0);
                resolve();
            }).start();
        });
    }

    /** Tutorial state: `dim` fades the bottle, `mark` shows a tick or cross above it. */
    setTutorialState(dim: number, mark: 'tick' | 'cross' | null) {
        this.glassOpacity.opacity = dim;
        this.dimmed = dim < 255;
        this.tickMark.active = mark === 'tick';
        this.crossMark.active = mark === 'cross';
        this.render();
    }

    // ---------------------------------------------------------------- pouring (source)

    /** Mouth corner the liquid leaves from, in bottle units relative to the bottle centre. */
    mouth(left: boolean): Vec3 {
        return new Vec3(left ? -MOUTH.x : MOUTH.x, MOUTH.y, 0);
    }

    /** Top of this bottle's incoming stream, in bottle units relative to the bottle centre. */
    get streamTop(): Vec3 { return new Vec3(0, STREAM_TOP * INNER_SCALE, 0); }

    /** Tilt (degrees, positive = to the left) at which the level reaches the mouth with `layerIndex + 1` layers left. */
    pourAngle(layerIndex: number, left: boolean): number {
        const area = (layerIndex + 1) * WATER_SEG_H * WATER_W;
        const box = WATER_W * WATER_BOTTLE_H;
        let a = Math.PI / 2;
        a -= area > box / 2
            ? Math.atan(WATER_W * WATER_W / (2 * (box - area)))
            : Math.atan(2 * area / (WATER_BOTTLE_H * WATER_BOTTLE_H));
        return (left ? a : -a) * 180 / Math.PI;
    }

    /** Switch to drawing the liquid as polygons that stay level while the bottle tilts. */
    beginPour(display: string[]) {
        this.display = display;
        this.level = display.length;
        this.graphicsMode = true;
        this.clip.enabled = true;
        this.render();
        this.drawWater(this.level);
    }

    /** Draw the tilted liquid with `level` layers left (reference BottleWaterRenderer.drawWater). */
    drawWater(level: number) {
        const g = this.water;
        g.clear();
        if (level <= EPS) { this.hideTiltSurface(); return; }
        const top = Math.ceil(level - EPS) - 1;
        const frac = level - top;
        const angle = this.node.angle;
        const left = angle > 0;
        const slope = Math.tan(Math.abs(angle) * Math.PI / 180);
        const triangle = WATER_W * WATER_W * slope / 2;
        const p = (x: number, y: number) => new Vec2(left ? x : -x, y); // mirrored when tilting right

        for (let i = top; i >= 0; i--) {
            const area = (i + (i === top ? frac : 1)) * WATER_SEG_H * WATER_W;
            const colors = colorsOf(this.display[i]);
            g.fillColor = colors.base;
            const base = area <= triangle ? Math.sqrt(2 * area / slope) : WATER_W;
            const rise = area <= triangle ? 0 : (area - triangle) / WATER_W;
            const m = p(WATER_LEFT, WATER_BOTTOM);
            const q = p(WATER_LEFT + base, WATER_BOTTOM);
            const s = p(WATER_LEFT + base, WATER_BOTTOM + rise);
            const c = p(WATER_LEFT, WATER_BOTTOM + rise + slope * base);
            const bulge = left ? -WATER_SEG_H : WATER_SEG_H;
            g.moveTo(m.x, m.y);
            g.lineTo(q.x, q.y);
            if (i === top) {
                g.lineTo(s.x, s.y);
                g.lineTo(c.x, c.y);
                this.placeTiltSurface(s, c, colors);
            } else if (rise === 0) {
                curveTo(g, q, c, bulge);
            } else {
                g.lineTo(s.x, s.y);
                curveTo(g, s, c, bulge);
                g.lineTo(c.x, c.y);
            }
            g.lineTo(m.x, m.y);
            g.fill();
        }
    }

    private placeTiltSurface(a: Vec2, b: Vec2, c: LiquidColor) {
        const s = this.tiltSurface;
        s.node.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2);
        s.node.angle = -this.node.angle;
        s.setWidth(Vec2.distance(a, b));
        s.setColors(c);
        s.node.active = true;
        if (!s.isPlaying) s.play(true);
    }

    private hideTiltSurface() {
        this.tiltSurface.reset();
        this.tiltSurface.node.active = false;
        this.tiltSurface.node.angle = 0;
    }

    /** Back to sprite layers once the bottle is upright again; newly uncovered hidden layers fade in. */
    endPour(revealed: number[]) {
        this.water.clear();
        this.hideTiltSurface();
        this.graphicsMode = false;
        this.clip.enabled = false;
        this.display = [...this.layers];
        this.level = this.layers.length;
        for (const i of revealed) this.segments[i].reveal = 0;
        this.render();
        for (const i of revealed) this.playReveal(i);
        this.playTopSurface();
    }

    /** Hidden colour fades into the real one while the "?" fades out and question marks pop out. */
    private playReveal(i: number) {
        const seg = this.segments[i];
        questionBurst(seg.node, new Vec3(0, QUESTION_FX_Y, 0), this.sp.fx);
        animate(0.3, t => {
            seg.reveal = t;
            this.render();
        });
    }

    // ---------------------------------------------------------------- pouring (target)

    /** Prepare to receive layers: the new layers stay hidden until the stream reaches them. */
    beginFill() {
        this.incoming++;
        this.display = [...this.layers];
        // layers still to come start at their "empty" height, so the stream ends on the current surface
        for (let i = Math.floor(this.level + EPS); i < this.capacity; i++) this.segments[i].setHeight(SEG_EMPTY_H);
        this.render();
    }

    /** One pour into this bottle has finished; once none are left the level snaps to the logical layers. */
    endFill() {
        if (--this.incoming === 0) this.setFillLevel(this.layers.length);
    }

    get fillLevel() { return this.level; }

    /** Raise the liquid to `level`; each layer that fills up plays its surface wobble. */
    setFillLevel(level: number) {
        const before = Math.floor(this.level + EPS);
        this.level = level;
        this.render();
        for (let i = before; i < Math.floor(level + EPS); i++) this.segments[i].surface.play(false);
    }

    showStream(tint: Color, flip: boolean) {
        if (this.streams++ > 0) return; // a second pour joins the running stream
        this.stream.active = true;
        this.stream.setScale(flip ? -1 : 1, 1, 1);
        this.streamSprite.color = tint;
        this.streamFx = [
            streamDroplets(this.stream, new Vec3(0, STREAM_FX_Y, 0), this.sp.fx, tint),
            streamRipple(this.stream, Vec3.ZERO, this.sp.fx, tint),
            streamSplash(this.stream, Vec3.ZERO, this.sp.fx, tint),
        ];
        this.updateStream();
    }

    /** Stretch the stream from its top down to the current liquid surface. */
    updateStream() {
        if (!this.stream.active) return;
        const seg = this.segments[Math.min(Math.floor(this.level + EPS), this.capacity - 1)];
        const h = Math.max(10, STREAM_TOP - (seg.node.position.y + seg.height));
        this.streamSprite.node.getComponent(UITransform)!.setContentSize(STREAM_W, h);
        for (const fx of this.streamFx.slice(1)) fx.node.setPosition(0, -h, 0);
    }

    /** Like the reference, the stream effects are removed at once when the pour ends. */
    hideStream() {
        if (--this.streams > 0) return;
        for (const fx of this.streamFx) fx.node.destroy();
        this.streamFx = [];
        this.stream.active = false;
    }

    // ---------------------------------------------------------------- completion

    /** The cork drops into the neck from above. */
    playCork(): Promise<void> {
        this.corked = true;
        this.cork.active = true;
        this.cork.setPosition(0, CORK_Y + CORK_DROP, 0);
        return new Promise(resolve => tween(this.cork)
            .to(0.3, { position: new Vec3(0, CORK_Y, 0) }, { easing: 'sineIn' })
            .call(() => resolve())
            .start());
    }

    /** Sparkles at the neck, then a quick squash and stretch of the whole bottle. */
    playComplete(): Promise<void> {
        completeSparkle(this.inner, new Vec3(0, SPARKLE_Y, 0), this.sp.fx);
        const s = this.node.scale.clone();
        return new Promise(resolve => tween(this.node)
            .to(0.066, { scale: new Vec3(s.x, s.y * 0.94, 1) })
            .delay(0.033)
            .to(0.066, { scale: new Vec3(s.x * 0.953, s.y, 1) })
            .delay(0.033)
            .to(0.066, { scale: s })
            .call(() => resolve())
            .start());
    }
}

/** Quadratic curve from a to b bulging sideways by `bulge` (reference BottleWaterRenderer). */
function curveTo(g: Graphics, a: Vec2, b: Vec2, bulge: number) {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) { g.lineTo(b.x, b.y); return; }
    g.quadraticCurveTo(mx + dy / len * bulge, my - dx / len * bulge, b.x, b.y);
}
