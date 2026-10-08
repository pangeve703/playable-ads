import {
    _decorator, Asset, BlockInputEvents, Color, Component, JsonAsset, Node, ResolutionPolicy, resources, screen, Size,
    Sprite, SpriteFrame, Texture2D, Tween, tween, UIOpacity, UITransform, Vec3, view,
} from 'cc';
import { Audio } from './Audio';
import { BAG_H, BAG_W, BagSprites, BagView } from './BagView';
import {
    BOTTLE_H, BOTTLE_W, BottleSprites, BottleView, LIQUID_INSET_BOTTOM, LIQUID_INSET_TOP, STREAM_INSET_BOTTOM, STREAM_INSET_TOP,
    SurfaceFrames,
} from './BottleView';
import { LEVEL, PALETTE } from './LevelConfig';
import { animate, makeNode, makeSprite, PackedSheet, packedFrames, SheetTrim, wait } from './NodeUtils';
import { gameEnd, onVisibilityChange, openStore } from './PlayableSDK';

const { ccclass, property } = _decorator;

const DESIGN_W = 1080;
const DESIGN_H = 1920;

/** Sprite paths under assets/resources (without the /spriteFrame suffix). */
/**
 * Texture atlases made by tools/pack_sheets.py (grouped like the reference build's own atlases). A texture reference is
 * either the resources path of a standalone image or an entry of an atlas.
 */
const GAME_ATLAS = 'textures/game/game_atlas';
const HUD_ATLAS = 'textures/ui/hud_atlas';
const BAG_ATLAS = 'textures/bag/bag_atlas';
const WIN_ATLAS = 'textures/ui/win_atlas';
const LOSE_ATLAS = 'textures/ui/lose_atlas';
type TexRef = string | { atlas: string; name: string };
const inAtlas = (atlas: string, name: string): TexRef => ({ atlas, name });

const TEX = {
    bg: 'textures/bg/bg_wood_portrait',
    shelf: 'textures/bg/wood_shelf',
    back: inAtlas(GAME_ATLAS, 'bottle_back'),
    front: inAtlas(GAME_ATLAS, 'bottle_front'),
    mask: inAtlas(GAME_ATLAS, 'bottle_mask'),
    refl: inAtlas(GAME_ATLAS, 'bottle_refl'),
    glow: inAtlas(GAME_ATLAS, 'bottle_glow'),
    cork: inAtlas(GAME_ATLAS, 'bottle_cork'),
    bottleShadow: inAtlas(GAME_ATLAS, 'bottle_shadow'),
    liquid: inAtlas(GAME_ATLAS, 'liquid_base'),
    liquidShadow: inAtlas(GAME_ATLAS, 'liquid_shadow'),
    liquidDim: inAtlas(GAME_ATLAS, 'liquid_base_dim'),
    liquidShadowDim: inAtlas(GAME_ATLAS, 'liquid_shadow_dim'),
    question: inAtlas(GAME_ATLAS, 'question_mark'),
    stream: inAtlas(GAME_ATLAS, 'stream'),
    droplet: inAtlas(GAME_ATLAS, 'droplet'),
    ripple: inAtlas(GAME_ATLAS, 'ripple'),
    sparkle: inAtlas(GAME_ATLAS, 'sparkle_white'),
    tick: inAtlas(GAME_ATLAS, 'tick'),
    cross: inAtlas(GAME_ATLAS, 'cross'),
    logo: inAtlas(HUD_ATLAS, 'logo'),
    pointer: inAtlas(HUD_ATLAS, 'pointer'),
    bagShadow: inAtlas(BAG_ATLAS, 'bag_shadow'),
};
type TexKey = keyof typeof TEX;

/** End card art, loaded only when its card is shown (keeps it out of start-up time and memory during play). */
const END_TEX = {
    panel: 'textures/ui/panel_rewards',
    rays: inAtlas(WIN_ATLAS, 'rays'),
    banner: inAtlas(WIN_ATLAS, 'banner_victory'),
    chest: inAtlas(WIN_ATLAS, 'chest_gold'),
    claim: inAtlas(WIN_ATLAS, 'btn_claim'),
    chestGrey: inAtlas(LOSE_ATLAS, 'chest_silver'),
    cont: inAtlas(LOSE_ATLAS, 'btn_continue'),
    playMore: inAtlas(LOSE_ATLAS, 'txt_play_more'),
};
type EndTexKey = keyof typeof END_TEX;
const WIN_TEX: EndTexKey[] = ['panel', 'rays', 'banner', 'chest', 'claim'];
const LOSE_TEX: EndTexKey[] = ['panel', 'chestGrey', 'cont', 'playMore'];
/** Wider background used in landscape, loaded only if the screen is landscape. */
const BG_LANDSCAPE = 'textures/bg/bg_wood_landscape';

/**
 * A frame animation in a texture atlas made by tools/pack_sheets.py: `<path>.json` gives each trimmed frame, `atlas`
 * is the animation's key there, and `trim` places its cells inside a larger original frame.
 */
interface Sheet { path: string; atlas: string; trim?: SheetTrim }
/** All bag animations share one packed atlas. */
const BAG_SHEETS: Record<keyof BagSprites, Sheet> = {
    openWhite: { path: BAG_ATLAS, atlas: 'openWhite' },
    openCol: { path: BAG_ATLAS, atlas: 'openCol' },
    backWhite: { path: BAG_ATLAS, atlas: 'backWhite' },
    backCol: { path: BAG_ATLAS, atlas: 'backCol' },
    frontWhite: { path: BAG_ATLAS, atlas: 'frontWhite' },
    frontCol: { path: BAG_ATLAS, atlas: 'frontCol' },
};
/**
 * Liquid-surface animations: the reference 500x250 frames at half size (still at least 1 texel per screen pixel on
 * the largest tablets), cropped to the area their frames use. They live in game_atlas with the rest of the bottle, so
 * a bottle's glass, liquid and surfaces batch into one draw call.
 */
const surfaceTrim = (x: number, y: number): SheetTrim => ({ x, y, fullW: 250, fullH: 125 });
const SURFACE_SHEETS: Record<keyof SurfaceFrames, Sheet> = {
    tint: { path: GAME_ATLAS, atlas: 'surface_tint', trim: surfaceTrim(13, 9) },
    ripple: { path: GAME_ATLAS, atlas: 'surface_ripple', trim: surfaceTrim(23, 24) },
    shadow: { path: GAME_ATLAS, atlas: 'surface_shadow', trim: surfaceTrim(13, 9) },
    spec: { path: GAME_ATLAS, atlas: 'surface_spec', trim: surfaceTrim(14, 57) },
};

/** Screen region as fractions of the screen: left/right from the left edge, top/bottom from the top edge. */
interface Region { left: number; right: number; top: number; bottom: number }

/** Layout of the reference (SceneLayoutConfig / BagCollectionManager regions, line and logo widgets). */
const LAYOUT = {
    portrait: {
        bottles: { left: 0.05, right: 0.95, top: 0.3, bottom: 0.95 } as Region,
        bags: { left: 0.05, right: 0.95, top: 0.07, bottom: 0.3 } as Region,
        /** Shelf line, as a fraction of the screen height above the centre. */
        shelfY: 0.1705,
        /** Logo box (the logo fills its width) and its distance from the top-left corner, in canvas units. */
        logo: { size: 191, left: 43, top: 0 },
    },
    landscape: {
        bottles: { left: 0.2, right: 0.8, top: 0.3, bottom: 0.95 } as Region,
        bags: { left: 0.2, right: 0.8, top: 0.03, bottom: 0.3 } as Region,
        shelfY: 0.1665,
        logo: { size: 192, left: 0, top: 12 },
    },
    shelfHeight: 21,
};

/** Bottle grid in bottle units (reference layout): odd columns sit higher so the rows zigzag. */
const GRID_GAP_X = 650;
const GRID_GAP_Y = 1700;
const GRID_STAGGER = 500;
const BOTTLE_SHADOW_OFFSET = new Vec3(57, -701, 0);
const BOTTLE_SHADOW_SIZE = new Size(540, 250);
/** A bottle's shadow shrinks and fades as the bottle moves away from its slot, gone at this distance (bottle units). */
const BOTTLE_SHADOW_FADE = 1000;

/** Pour timing from the reference (BottleVisual): flight to / from the target, and pouring time per layer. */
const POUR_MOVE = 0.3;
const POUR_PER_LAYER = 0.3;
/** Extra tilt at the start of a pour when the start and end angles would be the same. */
const POUR_FORCED_START_ANGLE = 30;

/** Bag slot layout inside the bag container (reference prefab units). */
const BAG_SPACING = 150;
const BAG_Y = 20;
const BAG_SHADOW_OFFSET = new Vec3(5, -145, 0);
const BAG_SHADOW_SCALE = 1.3;
const BAG_SHADOW_FADE_DIST = 1000;

/** Bottle -> bag flight, tuned values from the reference. Distances are in bag-local units. */
const BAG_FX = {
    flyDuration: 0.5,
    hoverY: 200,
    flyAngle: -30,
    dropDuration: 0.25,
    dropScale: 0.6,
    part2Delay: 0.2,
    bagFlyUp: 500,
    bagFlyUpDuration: 0.3,
    bagDropDuration: 0.35,
};

/** End card size in window units (panel plus the banner above it), its visual centre, and its scale on a phone. */
const END_CARD_W = 928;
const END_CARD_H = 1550;
const END_CARD_CENTER_Y = 177;
const END_CARD_SCALE = 0.95;
/** Seconds per turn of the win card's light rays (reference scene value). */
const END_SPIRAL_TURN = 10;

const POINTER_SIZE = new Size(226, 276);
/**
 * Reference Pointer prefab: the sprite is anchored at its top-left corner, placed at (-25, 93) from the pointer pivot,
 * so the hand hangs down-right with the fingertip near the pivot. The image keeps 4/21 px of transparent margin
 * (left/top) around the trimmed hand the reference positions, hence the small correction.
 */
const POINTER_SPRITE_SCALE = 0.7;
const POINTER_SPRITE_POS = new Vec3(-25 - 4 * POINTER_SPRITE_SCALE, 93 + 21 * POINTER_SPRITE_SCALE, 0);

interface BagSlot {
    pos: Vec3;
    bag: BagView | null;
    shadow: Node;
    shadowOpacity: UIOpacity;
}

type TutorialState = 'select' | 'pour' | null;

/**
 * Builds and runs the whole playable at runtime. Add this component to the Canvas of an empty scene.
 * Sprites are loaded from assets/resources/textures, the level from LevelConfig.ts.
 */
@ccclass('GameManager')
export class GameManager extends Component {
    @property({ tooltip: 'Store URL used when the ad network has no CTA API of its own' })
    storeUrl = 'https://play.google.com/store';

    @property({ tooltip: 'Seconds without input before a hint hand appears after the tutorial (0 = never, like the reference)' })
    hintAfterIdleSeconds = 0;

    private sf = {} as Record<TexKey, SpriteFrame>;
    private endSf = {} as Record<EndTexKey, SpriteFrame>;
    private bgPortrait: SpriteFrame | null = null;
    private bgLandscape: SpriteFrame | null = null;
    private bgLandscapeLoading = false;
    private audio!: Audio;
    private bagSprites!: BagSprites;
    private white!: SpriteFrame;
    private root!: Node;
    private bg!: Node;
    private shelf!: Node;
    private logo!: Node;
    private board!: Node;
    private endCard: { node: Node; dim: Node; window: Node } | null = null;
    private bottleShadows!: Node;
    private bagBox!: Node;
    /** Same transform as `bagBox` but drawn above the board: the bag being filled moves here with its bottle. */
    private bagFront!: Node;
    /** Streams running anywhere; the pour loop sound plays while there is at least one. */
    private streams = 0;
    private hand!: Node;
    private handSprite!: Node;
    private bottles: BottleView[] = [];
    private selected: BottleView | null = null;
    private ended = false;
    private idle = 0;
    private lastWindow = new Size();
    private lastVisible = new Size();

    /** Pours currently animating. End conditions are only checked when this is 0. */
    private pours = 0;
    /** Bottles completed so far, and how many of them have not reached their bag yet. */
    private completed = 0;
    private collecting = 0;

    private slots: BagSlot[] = [];
    private nextBag = 0;
    private bagQueue: BottleView[] = [];
    private bagBusy = false;

    private tutorial: TutorialState = null;
    private hintTarget: BottleView | null = null;
    /** Pending start of the hand loop (it can start after a delay). */
    private handStart: (() => void) | null = null;

    onLoad() {
        this.white = this.makeWhiteFrame();
        this.audio = new Audio(this.node);
        onVisibilityChange(visible => this.audio.setSuspended(!visible));
        this.applyResolutionPolicy();
    }

    start() {
        Promise.all([
            this.loadSprites(),
            this.loadSheets(BAG_SHEETS),
            this.loadSheets(SURFACE_SHEETS),
            this.audio.load(),
        ])
            .then(([, bag, surface]) => this.build(bag, surface))
            .catch(err => console.error('[GameManager] failed to load sprites', err));
    }

    update(dt: number) {
        const win = screen.windowSize;
        if (win.width !== this.lastWindow.width || win.height !== this.lastWindow.height) {
            this.lastWindow.set(win.width, win.height);
            this.applyResolutionPolicy();
        }
        if (!this.root) return;
        const vis = view.getVisibleSize();
        if (vis.width !== this.lastVisible.width || vis.height !== this.lastVisible.height) {
            this.lastVisible.set(vis.width, vis.height);
            this.layout();
        }
        for (const b of this.bottles) b.tick(dt);
        this.updateBottleShadows();
        this.updateBagShadows();
        this.processBagQueue();
        if (this.hintAfterIdleSeconds > 0 && !this.tutorial && !this.ended && !this.hand.active && !this.selected) {
            this.idle += dt;
            if (this.idle >= this.hintAfterIdleSeconds) this.showIdleHint();
        }
    }

    /**
     * Reference AdaptScreenManager: the canvas takes the window's aspect ratio, sized by the average of the width and
     * height scale factors against 1080x1920 (1920x1080 in landscape), so nothing is cropped or letterboxed.
     */
    private applyResolutionPolicy() {
        const win = screen.windowSize;
        const landscape = win.width > win.height;
        const dw = landscape ? DESIGN_H : DESIGN_W;
        const dh = landscape ? DESIGN_W : DESIGN_H;
        const k = (dw / win.width + dh / win.height) / 2;
        view.setDesignResolutionSize(win.width * k, win.height * k, ResolutionPolicy.SHOW_ALL);
    }

    // ---------------------------------------------------------------- loading

    private loadSprites(): Promise<void> {
        return loadFrames(Object.keys(TEX) as TexKey[], k => TEX[k], this.sf);
    }

    /** Load frame animations from their atlases. */
    private loadSheets<K extends string>(sheets: Record<K, Sheet>): Promise<Record<K, SpriteFrame[]>> {
        const keys = Object.keys(sheets) as K[];
        return Promise.all(keys.map(k => {
            const s = sheets[k];
            return loadAtlas(s.path).then(a => packedFrames(a.texture, a.sheets[s.atlas], s.trim));
        })).then(frames => {
            const out = {} as Record<K, SpriteFrame[]>;
            keys.forEach((k, i) => (out[k] = frames[i]));
            return out;
        });
    }

    private makeWhiteFrame(): SpriteFrame {
        const tex = new Texture2D();
        tex.reset({ width: 2, height: 2, format: Texture2D.PixelFormat.RGBA8888 });
        tex.uploadData(new Uint8Array(16).fill(255));
        const sf = new SpriteFrame();
        sf.texture = tex;
        return sf;
    }

    // ---------------------------------------------------------------- build / layout

    private build(bagSprites: BagSprites, surface: SurfaceFrames) {
        this.bagSprites = bagSprites;
        // 9-slice borders of the liquid and stream sprites (reference capInsets)
        for (const sf of [this.sf.liquid, this.sf.liquidShadow]) {
            sf.insetTop = LIQUID_INSET_TOP;
            sf.insetBottom = LIQUID_INSET_BOTTOM;
        }
        this.sf.stream.insetTop = STREAM_INSET_TOP;
        this.sf.stream.insetBottom = STREAM_INSET_BOTTOM;

        this.root = makeNode('Game', this.node);
        this.root.addComponent(UITransform); // sized in layout(); touch listeners need one
        // capture phase: runs for every touch on the game before a bottle or the background handles it
        this.root.on(Node.EventType.TOUCH_START, () => this.audio.unlock(), this, true);
        this.bgPortrait = this.sf.bg;
        this.bg = makeSprite('Background', this.root, this.sf.bg, DESIGN_W, DESIGN_H);
        this.bg.on(Node.EventType.TOUCH_END, () => this.onBackgroundTap());
        this.logo = makeSprite('Logo', this.root, this.sf.logo, 496, 317);
        this.shelf = makeSprite('Shelf', this.root, this.sf.shelf, DESIGN_W, 41);
        // bags first, so bottles (lifted or pouring near the shelf) draw in front of them
        this.bagBox = makeNode('Bags', this.root);
        this.board = makeNode('Board', this.root);
        this.bottleShadows = makeNode('Shadows', this.board);
        this.bagFront = makeNode('BagsFront', this.root);

        const f = this.sf;
        const sprites: BottleSprites = {
            back: f.back, front: f.front, mask: f.mask, refl: f.refl, glow: f.glow, cork: f.cork,
            liquid: f.liquid, liquidShadow: f.liquidShadow, liquidDim: f.liquidDim, liquidShadowDim: f.liquidShadowDim,
            question: f.question, stream: f.stream, tick: f.tick, cross: f.cross, surface,
            fx: { droplet: f.droplet, ripple: f.ripple, sparkle: f.sparkle, question: f.question },
        };
        this.bottles = LEVEL.bottles.map(layers => {
            const b = new BottleView(this.board, layers, LEVEL.capacity, sprites);
            b.node.on(Node.EventType.TOUCH_END, () => this.onBottleTap(b));
            return b;
        });
        this.placeBottles();
        this.buildBags();

        this.hand = makeNode('Hand', this.root);
        this.handSprite = makeSprite('Sprite', this.hand, this.sf.pointer, POINTER_SIZE.width, POINTER_SIZE.height);
        this.handSprite.getComponent(UITransform)!.setAnchorPoint(0, 1);
        this.handSprite.setPosition(POINTER_SPRITE_POS);
        this.handSprite.setScale(POINTER_SPRITE_SCALE, POINTER_SPRITE_SCALE, 1);
        this.hand.active = false;

        const vis = view.getVisibleSize();
        this.lastVisible.set(vis.width, vis.height);
        this.layout();
        this.startTutorial();
    }

    /** Reference grid: 3 rows x 7 columns, odd columns raised; each bottle has a soft shadow behind the board. */
    private placeBottles() {
        const cols = LEVEL.cols;
        const rows = Math.ceil(this.bottles.length / cols);
        this.bottles.forEach((b, i) => {
            const c = i % cols;
            const r = Math.floor(i / cols);
            const x = (c - (cols - 1) / 2) * GRID_GAP_X;
            const y = ((rows - 1) / 2 - r) * GRID_GAP_Y - (c % 2 ? 0 : GRID_STAGGER);
            b.home.set(x, y, 0);
            b.node.setPosition(b.home);
            const shadow = makeSprite('Shadow', this.bottleShadows, this.sf.bottleShadow, BOTTLE_SHADOW_SIZE.width, BOTTLE_SHADOW_SIZE.height);
            shadow.setPosition(x + BOTTLE_SHADOW_OFFSET.x, y + BOTTLE_SHADOW_OFFSET.y, 0);
            b.shadow = { node: shadow, opacity: shadow.addComponent(UIOpacity) };
        });
    }

    private buildBags() {
        const n = LEVEL.bagCount;
        for (let i = 0; i < n; i++) {
            const pos = new Vec3((i - (n - 1) / 2) * BAG_SPACING, BAG_Y, 0);
            const shadow = makeSprite('BagShadow', this.bagBox, this.sf.bagShadow, 125, 50);
            shadow.setPosition(pos.x + BAG_SHADOW_OFFSET.x, pos.y + BAG_SHADOW_OFFSET.y, 0);
            const slot: BagSlot = { pos, bag: null, shadow, shadowOpacity: shadow.addComponent(UIOpacity) };
            this.slots.push(slot);
        }
        // shadows first so every bag is drawn above every shadow
        for (const slot of this.slots) {
            const color = this.takeBagColor();
            if (!color) continue;
            // the starting bags rest closed (in the reference their opening animation never runs at start-up)
            slot.bag = new BagView(this.bagBox, color, this.bagSprites);
            slot.bag.node.setPosition(slot.pos);
        }
    }

    private takeBagColor(): string | null {
        return this.nextBag < LEVEL.bagSequence.length ? LEVEL.bagSequence[this.nextBag++] : null;
    }

    private layout() {
        const vis = view.getVisibleSize();
        const W = vis.width, H = vis.height;
        const L = W > H ? LAYOUT.landscape : LAYOUT.portrait;

        this.root.getComponent(UITransform)!.setContentSize(W, H);

        // background covers the whole canvas; landscape uses the wider wood texture like the reference
        const landscape = W > H;
        if (landscape && !this.bgLandscape) this.loadLandscapeBackground();
        const bgFrame = landscape && this.bgLandscape ? this.bgLandscape : this.bgPortrait!;
        this.bg.getComponent(Sprite)!.spriteFrame = bgFrame;
        const bgW = bgFrame.originalSize.width, bgH = bgFrame.originalSize.height;
        const bgScale = Math.max(W / bgW, H / bgH);
        this.bg.getComponent(UITransform)!.setContentSize(bgW * bgScale, bgH * bgScale);

        // logo pinned to the top-left corner
        const logo = L.logo;
        const logoH = logo.size * 317 / 496;
        this.logo.getComponent(UITransform)!.setContentSize(logo.size, logoH);
        this.logo.setPosition(-W / 2 + logo.left + logo.size / 2, H / 2 - logo.top - logo.size / 2);

        // shelf line between the bags and the bottles
        this.shelf.getComponent(UITransform)!.setContentSize(W, LAYOUT.shelfHeight);
        this.shelf.setPosition(0, H * L.shelfY);

        // bags and bottles are each fitted into their region
        fitToRegion(this.bagBox, this.slots.map(sl => ({ pos: sl.pos, w: BAG_W, h: BAG_H })), L.bags, W, H);
        this.bagFront.setPosition(this.bagBox.position);
        this.bagFront.setScale(this.bagBox.scale);
        fitToRegion(this.board, this.bottles.map(b => ({ pos: b.home, w: BOTTLE_W, h: BOTTLE_H })), L.bottles, W, H);

        if (this.endCard) this.layoutEndCard(W, H);

        // the hint loop is in screen space, so restart it for the new layout
        if ((this.hand.active || this.handStart) && this.hintTarget) this.showHand(this.hintTarget, 0);
    }

    private loadLandscapeBackground() {
        if (this.bgLandscapeLoading) return;
        this.bgLandscapeLoading = true;
        resources.load(`${BG_LANDSCAPE}/spriteFrame`, SpriteFrame, (err, sf) => {
            if (err) { console.warn('[GameManager] landscape background missing', err); return; }
            this.bgLandscape = sf;
            this.layout();
        });
    }

    /** Like the bag shadows: a bottle's shadow shrinks and fades as the bottle is lifted or moves away. */
    private updateBottleShadows() {
        for (const b of this.bottles) {
            if (!b.shadow || b.node.parent !== this.board) continue;
            const k = 1 - Math.min(1, Vec3.distance(b.node.position, b.home) / BOTTLE_SHADOW_FADE);
            b.shadow.node.setScale(k, k, 1);
            b.shadow.opacity.opacity = 255 * k;
        }
    }

    // ---------------------------------------------------------------- input / rules

    private onBottleTap(b: BottleView) {
        if (this.ended || b.busy) return;
        this.idle = 0;
        if (this.tutorial) { this.onTutorialTap(b); return; }
        this.hideHand();

        const sel = this.selected;
        // reference SelectionSystem: a tap that can't be used is ignored (no shake); with a bottle raised, an
        // invalid target lowers it and raises the tapped bottle instead when it can be raised
        if (!sel) {
            if (this.canSelect(b)) this.select(b);
            return;
        }
        if (sel === b) { this.select(null); return; }
        if (this.canPour(sel, b)) { this.startPour(sel, b); return; }
        this.select(this.canSelect(b) ? b : null);
    }

    private onBackgroundTap() {
        if (this.ended) return;
        this.idle = 0;
        if (this.tutorial === 'pour') { this.select(null); this.tutorialSelect(1); return; }
        if (!this.tutorial) this.select(null);
    }

    private select(b: BottleView | null) {
        if (this.selected && this.selected !== b) this.selected.liftTo(0);
        this.selected = b;
        b?.liftTo(1, () => this.audio.select());
    }

    private canSelect(b: BottleView) {
        return !b.busy && b.incoming === 0 && !b.isCorked && b.top().color !== null;
    }

    private canPour(from: BottleView, to: BottleView) {
        const { color } = from.top();
        if (!color || from === to || to.busy || to.isFull || to.isCorked) return false;
        return to.isEmpty || to.top().color === color;
    }

    /**
     * The reference's "out of moves" rule: a move only counts if the whole top run of an unfinished bottle fits
     * into another bottle that is empty or has the same colour on top.
     */
    private hasAnyMove() {
        return this.bottles.some(a => {
            const { color, count } = a.top();
            if (!color || a.isCorked) return false;
            return this.bottles.some(b => b !== a && !b.isCorked && b.capacity - b.layers.length >= count
                && (b.isEmpty || b.top().color === color));
        });
    }

    // ---------------------------------------------------------------- pour animation

    private startPour(from: BottleView, to: BottleView) {
        this.selected = null;
        this.pour(from, to);
    }

    /**
     * Reference pour: the source flies so its mouth sits on top of the target's stream, tilts while the liquid
     * runs down the stream into the target layer by layer, then flies back home.
     */
    private async pour(from: BottleView, to: BottleView) {
        // the target is not locked: like the reference, other bottles may pour into it at the same time
        this.pours++;
        from.busy = true;
        from.stopLift();
        from.fadeOutline(POUR_MOVE);

        // rules first; the visuals catch up below
        const { color, count } = from.top();
        const amount = Math.min(count, to.capacity - to.layers.length);
        const fromBefore = [...from.layers];
        for (let i = 0; i < amount; i++) to.layers.push(from.layers.pop()!);
        const revealed = from.revealTop();
        const fromAfter = from.layers.length;

        const left = this.pourToLeft(from, to);
        let beginAngle = from.pourAngle(fromBefore.length - 1, left);
        const endAngle = from.pourAngle(fromAfter - 1, left);
        if (beginAngle === endAngle) beginAngle -= left ? POUR_FORCED_START_ANGLE : -POUR_FORCED_START_ANGLE;
        const beginPos = this.alignToStream(from, to, beginAngle, left);
        const endPos = this.alignToStream(from, to, endAngle, left);

        const siblingIndex = from.node.getSiblingIndex();
        from.node.setSiblingIndex(this.board.children.length - 1);
        from.beginPour(fromBefore);
        to.beginFill();

        // fly to the target, tilting to the start angle
        const start = from.node.position.clone();
        const pos = new Vec3();
        await animate(POUR_MOVE, t => {
            const k = t * t;
            from.node.setPosition(Vec3.lerp(pos, start, beginPos, k));
            from.node.angle = beginAngle * k;
            from.drawWater(fromBefore.length);
        });

        // pour; each running pour adds its share, so pours into the same bottle add up
        to.showStream(PALETTE[color!].tint, left);
        if (this.streams++ === 0) this.audio.startPour();
        let poured = 0;
        await animate(amount * POUR_PER_LAYER, t => {
            const k = 1 - (1 - t) * (1 - t);
            from.node.setPosition(Vec3.lerp(pos, beginPos, endPos, k));
            from.node.angle = beginAngle + (endAngle - beginAngle) * k;
            from.drawWater(fromAfter + amount * (1 - t));
            to.setFillLevel(Math.min(to.capacity, to.fillLevel + amount * t - poured));
            poured = amount * t;
            to.updateStream();
        });
        to.hideStream();
        if (--this.streams === 0) this.audio.stopPour();
        to.endFill();
        if (to.incoming === 0 && to.isComplete()) this.onBottleCompleted(to);

        // fly back home and stand upright
        const back = from.node.position.clone();
        const backAngle = from.node.angle;
        await animate(POUR_MOVE, t => {
            const k = Math.sin(t * Math.PI / 2);
            from.node.setPosition(Vec3.lerp(pos, back, from.home, k));
            from.node.angle = backAngle * (1 - k);
            from.drawWater(fromAfter);
        });
        from.node.setSiblingIndex(siblingIndex);
        from.endPour(revealed);
        from.busy = false;
        this.pours--;
        this.idle = 0;
        this.checkEnd();
    }

    /** Reference rule: pour towards the side away from the board edge, otherwise towards the source's side. */
    private pourToLeft(from: BottleView, to: BottleView): boolean {
        const m = from.mouth(false).x;
        const xs = this.bottles.map(b => b.home.x);
        const leftEdge = Math.min(...xs) - m;
        const rightEdge = Math.max(...xs) + m;
        const near = (a: number, b: number) => Math.abs(a - b) <= 1;
        const tl = to.home.x - m, tr = to.home.x + m;
        const sl = from.home.x - m, sr = from.home.x + m;
        return near(tl, leftEdge) || (!near(tr, rightEdge) && (sl > tl || !(sr < tr)));
    }

    /** Board position of the source so that its mouth, tilted by `angle`, sits on top of the target's stream. */
    private alignToStream(from: BottleView, to: BottleView, angle: number, left: boolean): Vec3 {
        const top = to.home.clone().add(to.streamTop);
        const mouth = from.mouth(left);
        const r = angle * Math.PI / 180;
        const cos = Math.cos(r), sin = Math.sin(r);
        return new Vec3(top.x - (mouth.x * cos - mouth.y * sin), top.y - (mouth.x * sin + mouth.y * cos), 0);
    }

    // ---------------------------------------------------------------- bags

    /** Cork the bottle, then queue it for the bag of its colour. It stays busy (untappable) from now on. */
    private async onBottleCompleted(b: BottleView) {
        this.completed++;
        this.collecting++;
        b.busy = true;
        this.audio.complete();
        await b.playCork();
        this.audio.corkLanded();
        await b.playComplete();
        await wait(0.05);
        this.bagQueue.push(b);
    }

    /** One bottle flies at a time; a bottle waits until a bag of its colour is on the shelf. */
    private processBagQueue() {
        if (this.bagBusy) return;
        for (let i = 0; i < this.bagQueue.length; i++) {
            const b = this.bagQueue[i];
            const slot = this.slots.find(s => s.bag?.color === b.layers[0]);
            if (!slot) continue;
            this.bagQueue.splice(i, 1);
            this.bagBusy = true;
            this.flyToBag(b, slot)
                .catch(err => console.error('[GameManager] bag flight failed', err))
                .then(() => {
                    this.bagBusy = false;
                    this.collecting--;
                    this.checkEnd();
                });
            return;
        }
    }

    private async flyToBag(b: BottleView, slot: BagSlot) {
        const bag = slot.bag!;
        bag.prepareCollect();
        // the completed bottle flies in front of every other bottle: its bag (which holds it) is drawn above the board
        bag.node.setParent(this.bagFront, false);

        // 1. lift the bottle above the bag, tilting it, while the bag starts to open; its shadow fades as it leaves
        const shadow = b.shadow;
        if (shadow) {
            b.shadow = null;
            tween(shadow.opacity).to(BAG_FX.flyDuration, { opacity: 0 }).call(() => shadow.node.destroy()).start();
        }
        b.node.setParent(bag.front, true);
        await Promise.all([
            this.tweenNode(b.node, BAG_FX.flyDuration, { position: new Vec3(0, BAG_FX.hoverY, 0), angle: BAG_FX.flyAngle }, 'sineOut'),
            bag.collectPart1(),
        ]);

        // 2. drop it inside: behind the bag front, shrinking, while the bag swallows it
        b.node.setParent(bag.middle, true);
        this.audio.bagCollect();
        const scale = b.node.scale.clone().multiplyScalar(BAG_FX.dropScale);
        scale.z = 1;
        await Promise.all([
            this.tweenNode(b.node, BAG_FX.dropDuration, { position: Vec3.ZERO.clone(), angle: 0, scale }, 'sineIn'),
            this.delay(BAG_FX.part2Delay).then(() => bag.collectPart2()),
        ]);
        b.node.active = false;
        b.node.setParent(this.board);

        // 3. the full bag leaves upwards and the next one drops into the slot
        const p = slot.pos;
        await this.tweenNode(bag.node, BAG_FX.bagFlyUpDuration, { position: new Vec3(p.x, p.y + BAG_FX.bagFlyUp, 0) }, 'sineIn');
        bag.destroy();
        slot.bag = null;

        const color = this.takeBagColor();
        if (!color) return;
        const next = new BagView(this.bagBox, color, this.bagSprites);
        slot.bag = next;
        next.node.setPosition(p.x, p.y + BAG_FX.bagFlyUp, 0);
        await this.tweenNode(next.node, BAG_FX.bagDropDuration, { position: p.clone() }, 'linear');
        await next.playOpen();
    }

    /** Shadows stay on the shelf and fade out as their bag moves away. */
    private updateBagShadows() {
        for (const slot of this.slots) {
            const bag = slot.bag;
            slot.shadow.active = !!bag;
            if (!bag) continue;
            const k = 1 - Math.min(1, Vec3.distance(bag.node.position, slot.pos) / BAG_SHADOW_FADE_DIST);
            slot.shadow.setScale(BAG_SHADOW_SCALE * k, BAG_SHADOW_SCALE * k, 1);
            slot.shadowOpacity.opacity = 255 * k;
        }
    }

    // ---------------------------------------------------------------- end conditions

    private checkEnd() {
        if (this.ended || this.pours > 0) return;
        if (this.completed >= LEVEL.winBottles) {
            // wait until the last bottle is in its bag
            if (this.collecting === 0) this.showEndCard(true);
            return;
        }
        if (!this.hasAnyMove()) this.showLose();
    }

    private async showLose() {
        this.ended = true;
        this.hideHand();
        this.select(null);
        const unfinished = this.bottles.filter(b => b.layers.length < b.capacity); // reference: every bottle with room
        await Promise.all(unfinished.map(b => b.pulseOutline(3)));
        this.showEndCard(false);
    }

    // ---------------------------------------------------------------- tutorial (forced first move)

    private startTutorial() {
        if (!LEVEL.tutorial) return;
        this.tutorialSelect(0);
    }

    /** Step 1: only the source bottle is lit and the hand taps it. */
    private tutorialSelect(handDelay: number) {
        const t = LEVEL.tutorial!;
        this.tutorial = 'select';
        this.bottles.forEach((b, i) => b.setTutorialState(i === t.from ? 255 : t.dimOpacity, null));
        this.showHand(this.bottles[t.from], handDelay);
    }

    /** Step 2: source and targets are lit; targets get a tick, every other bottle a cross. */
    private tutorialPour() {
        const t = LEVEL.tutorial!;
        this.tutorial = 'pour';
        this.hideHand();
        this.bottles.forEach((b, i) => {
            const target = t.to.indexOf(i) >= 0;
            b.setTutorialState(i === t.from || target ? 255 : t.dimOpacity, target ? 'tick' : i === t.from ? null : 'cross');
        });
    }

    private endTutorial() {
        this.tutorial = null;
        this.hideHand();
        this.bottles.forEach(b => b.setTutorialState(255, null));
    }

    private onTutorialTap(b: BottleView) {
        const t = LEVEL.tutorial!;
        const i = this.bottles.indexOf(b);
        if (this.tutorial === 'select') {
            if (i !== t.from) return;
            this.hideHand();
            this.select(b);
            this.tutorialPour();
        } else if (i === t.from) {
            this.select(null);
            this.tutorialSelect(1);
        } else if (t.to.indexOf(i) >= 0 && this.selected && this.canPour(this.selected, b)) {
            this.endTutorial();
            this.startPour(this.selected, b);
        }
    }

    // ---------------------------------------------------------------- hand

    /** Reference "tap" loop: the hand presses into the bottle while the bottle pulses. */
    private showHand(target: BottleView, delay: number) {
        this.hideHand();
        this.hintTarget = target;
        const s = this.board.scale.x;
        const press = new Vec3(this.board.position.x + target.home.x * s, this.board.position.y + target.home.y * s - 35, 0);
        const rest = press.clone().add3f(35, -35, 0);
        this.hand.setSiblingIndex(this.root.children.length - 1);
        this.hand.setPosition(rest);
        this.hand.setScale(1, 1, 1);
        this.hand.angle = 15;
        const dur = 0.5;
        this.handStart = () => {
            this.handStart = null;
            this.hand.active = true;
            tween(this.hand)
                .repeatForever(tween<Node>()
                    .call(() => tween(target.node)
                        .to(dur, { scale: new Vec3(1.1, 1.1, 1) }, { easing: 'quadInOut' })
                        .to(dur, { scale: Vec3.ONE.clone() }, { easing: 'quadInOut' })
                        .start())
                    .to(dur, { position: press, scale: new Vec3(0.8, 0.8, 1), angle: 0 }, { easing: 'quadInOut' })
                    .to(dur, { position: rest, scale: Vec3.ONE.clone(), angle: 15 }, { easing: 'quadInOut' }))
                .start();
        };
        if (delay > 0) this.scheduleOnce(this.handStart, delay);
        else this.handStart();
    }

    private hideHand() {
        if (!this.hand) return;
        if (this.handStart) { this.unschedule(this.handStart); this.handStart = null; }
        Tween.stopAllByTarget(this.hand);
        this.hand.active = false;
        if (this.hintTarget) {
            Tween.stopAllByTarget(this.hintTarget.node);
            this.hintTarget.node.setScale(Vec3.ONE);
            this.hintTarget = null;
        }
    }

    private showIdleHint() {
        const source = this.bottles.find(a => this.canSelect(a) && this.bottles.some(b => this.canPour(a, b)));
        if (source) this.showHand(source, 0);
        else this.idle = 0;
    }

    // ---------------------------------------------------------------- end card

    private async showEndCard(won: boolean) {
        this.ended = true;
        this.hideHand();
        this.select(null);
        gameEnd();
        if (won) this.audio.win();
        else this.audio.lose();
        try {
            await loadFrames(won ? WIN_TEX : LOSE_TEX, k => END_TEX[k], this.endSf);
        } catch (err) {
            console.error('[GameManager] failed to load end card', err);
            return;
        }
        const sf = this.endSf;

        const card = makeNode('EndCard', this.root);
        card.addComponent(UITransform);
        card.addComponent(BlockInputEvents);
        card.on(Node.EventType.TOUCH_END, () => openStore(this.storeUrl));

        // reference WinEndCard20a / LoseEndCard20a: black overlay, fully opaque on the win card and at 200 on the
        // lose card. The win card darkens in 0.3 s with the window shown at once; the lose card fades in as a whole.
        const dim = makeSprite('Dim', card, this.white, 1, 1, new Color(0, 0, 0, won ? 255 : 200));
        const fade = (won ? dim : card).addComponent(UIOpacity);
        fade.opacity = 0;

        // window children: sizes and positions of the reference scene nodes (panel-local units)
        const win = makeSprite('Window', card, sf.panel, 853, 1025);
        this.endCard = { node: card, dim, window: win };
        const vis = view.getVisibleSize();
        this.layoutEndCard(vis.width, vis.height);

        if (won) {
            const rays = makeSprite('Spiral', win, sf.rays, 790, 790);
            tween(rays).by(END_SPIRAL_TURN, { angle: -360 }).repeatForever().start();
        }
        const chest = makeSprite('Chest', win, won ? sf.chest : sf.chestGrey, 495, 420);
        chest.setPosition(30, 82);
        if (won) {
            chest.setScale(1.5, 1.5, 1);
            tween(chest).to(0.3, { scale: Vec3.ONE.clone() }, { easing: 'backOut' }).start();
        }

        const btn = makeSprite('CTA', win, won ? sf.claim : sf.cont, won ? 390 : 572, 214);
        btn.setPosition(0, -265);
        // reference PlayButton: breathes between full size and 92%
        tween(btn).repeatForever(tween<Node>()
            .to(0.6, { scale: Vec3.ONE.clone() }, { easing: 'sineInOut' })
            .to(0.6, { scale: new Vec3(0.92, 0.92, 1) }, { easing: 'sineInOut' })).start();

        // title anchored at its bottom edge, overlapping the panel's "Rewards" tab
        const title = won
            ? makeSprite('Banner', win, sf.banner, 928, 365)
            : makeSprite('PlayMore', win, sf.playMore, 772, 182);
        title.getComponent(UITransform)!.setAnchorPoint(0.5, 0);
        title.setPosition(-3, won ? 460 : 564);
        title.setScale(0.92, 0.92, 1);

        tween(fade).to(won ? 0.3 : 0.2, { opacity: 255 }).start();
    }

    /** The card (banner on top of the panel) is scaled to fit the screen and centred, like the reference. */
    private layoutEndCard(W: number, H: number) {
        const c = this.endCard!;
        c.node.getComponent(UITransform)!.setContentSize(W, H);
        c.dim.getComponent(UITransform)!.setContentSize(W, H);
        const s = Math.min(END_CARD_SCALE, 0.9 * H / END_CARD_H, 0.95 * W / END_CARD_W);
        c.window.setScale(s, s, 1);
        c.window.setPosition(0, -END_CARD_CENTER_Y * s);
    }

    // ---------------------------------------------------------------- helpers

    private tweenNode(node: Node, dur: number, props: { position?: Vec3; angle?: number; scale?: Vec3 }, easing: 'sineInOut' | 'sineOut' | 'sineIn' | 'linear' = 'sineInOut'): Promise<void> {
        return new Promise(resolve => tween(node).to(dur, props, { easing }).call(() => resolve()).start());
    }

    private delay(sec: number): Promise<void> {
        return new Promise(resolve => this.scheduleOnce(() => resolve(), sec));
    }
}

/** Reference GroupLayoutUtils.fitGroupToRegion: scale a group of items so its bounds fit the region, centred in it. */
function fitToRegion(group: Node, items: { pos: Vec3; w: number; h: number }[], r: Region, W: number, H: number) {
    if (!items.length) return;
    const minX = Math.min(...items.map(i => i.pos.x - i.w / 2));
    const maxX = Math.max(...items.map(i => i.pos.x + i.w / 2));
    const minY = Math.min(...items.map(i => i.pos.y - i.h / 2));
    const maxY = Math.max(...items.map(i => i.pos.y + i.h / 2));
    const s = Math.min((r.right - r.left) * W / (maxX - minX), (r.bottom - r.top) * H / (maxY - minY));
    const cx = ((r.left + r.right) / 2 - 0.5) * W;
    const cy = (0.5 - (r.top + r.bottom) / 2) * H;
    group.setScale(s, s, 1);
    group.setPosition(cx - (minX + maxX) / 2 * s, cy - (minY + maxY) / 2 * s, 0);
}

/** Load sprite frames by key into `out`. */
function loadFrames<K extends string>(keys: K[], ref: (k: K) => TexRef, out: Record<K, SpriteFrame>): Promise<void> {
    return Promise.all(keys.map(k => {
        const r = ref(k);
        return typeof r === 'string'
            ? loadAssets([`${r}/spriteFrame`], SpriteFrame).then(([sf]) => sf)
            : loadAtlas(r.atlas).then(a => packedFrames(a.texture, a.sheets[r.name])[0]);
    })).then(frames => keys.forEach((k, i) => (out[k] = frames[i])));
}

function loadAssets<T extends Asset>(paths: string[], type: new () => T): Promise<T[]> {
    return new Promise((resolve, reject) => resources.load(paths, type, (err, assets) => (err ? reject(err) : resolve(assets))));
}

/** An atlas from tools/pack_sheets.py: its texture plus the frame table (`<path>.json`). Loaded once, then shared. */
interface Atlas { texture: Texture2D; sheets: Record<string, PackedSheet> }
const atlases = new Map<string, Promise<Atlas>>();
function loadAtlas(path: string): Promise<Atlas> {
    let atlas = atlases.get(path);
    if (!atlas) {
        atlas = Promise.all([loadAssets([`${path}/texture`], Texture2D), loadAssets([path], JsonAsset)])
            .then(([[texture], [json]]) => ({ texture, sheets: json.json as Record<string, PackedSheet> }));
        atlases.set(path, atlas);
    }
    return atlas;
}
