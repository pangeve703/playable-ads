import { Color } from 'cc';

/** Colours of one liquid, as in the reference palette. */
export interface LiquidColor {
    /** Liquid body. */
    base: Color;
    /** Surface, stream and bag colour. */
    tint: Color;
    /** Shading on the edges of the liquid and under the surface. */
    shadow: Color;
    /** Ripple highlight on the surface. */
    ripple: Color;
}

const hex = (h: string) => new Color().fromHEX(h);
const liquid = (base: string, tint: string, shadow: string, ripple: string): LiquidColor =>
    ({ base: hex(base), tint: hex(tint), shadow: hex(shadow), ripple: hex(ripple) });

/** Liquid colour keys -> colours. Keys are what the level data uses. */
export const PALETTE: Record<string, LiquidColor> = {
    R: liquid('#FF0000', '#FF2C2C', '#BF0606', '#FF4747'), // red
    Y: liquid('#FFAD17', '#FFCE2B', '#E08300', '#FAD454'), // yellow
    P: liquid('#A400EB', '#CE3AFF', '#7E00DE', '#D353FD'), // purple
    L: liquid('#45C1FF', '#51D1FF', '#0084FF', '#65D6FF'), // light blue
    B: liquid('#0544D3', '#0A6CFF', '#000BD5', '#217AFF'), // dark blue
    O: liquid('#FF6F10', '#FF8F1F', '#E65100', '#FDA54C'), // orange
    G: liquid('#56AA00', '#79E01F', '#24A102', '#7FEB1F'), // green
    K: liquid('#FD53DE', '#FF67F0', '#D9148D', '#FB7EEF'), // pink
};

/** Colours used for layers that are still hidden ("?"). */
export const HIDDEN_LIQUID = liquid('#252525', '#3C3C3C', '#000000', '#3C3C3C');

/** Prefix that marks a layer as hidden, e.g. "?R" is a hidden red layer. */
export const HIDDEN = '?';

export interface TutorialStep {
    /** Bottle the player is forced to pick up first. */
    from: number;
    /** Bottles the player may pour into (marked with a tick, every other bottle gets a cross). */
    to: number[];
    /** Opacity (0-255) of the bottles that are not part of the step. */
    dimOpacity: number;
}

export interface LevelData {
    capacity: number;
    /** Bottles are laid out left-to-right, top-to-bottom in this many columns; odd columns sit higher. */
    cols: number;
    /** Each bottle lists its layers from bottom to top. */
    bottles: string[][];
    /** Completed bottles needed to win. */
    winBottles: number;
    tutorial: TutorialStep | null;
    /** Number of bags shown at once above the shelf. */
    bagCount: number;
    /** Colour of each bag in the order they appear; a completed bottle flies into the bag of its colour. */
    bagSequence: string[];
}

/**
 * The reference level (P020A): 21 bottles in 7 staggered columns, every layer but the top one hidden.
 * 68 layers -> 17 bottles to complete (pink x3, every other colour x2).
 */
export const LEVEL: LevelData = {
    capacity: 4,
    cols: 7,
    bottles: [
        ['?P', 'R'],
        ['?R', '?Y', '?Y', 'R'],
        ['?O', '?P', '?R', 'P'],
        ['?Y', '?G', '?R', 'L'],
        ['?K', '?L', '?O', 'B'],
        ['?K', '?B', '?B', 'P'],
        ['?O', 'L'],
        ['?L', 'Y'],
        ['?G', '?K', '?P', 'O'],
        ['?G', '?L', '?L', 'B'],
        ['?K', '?G', '?R', 'K'],
        ['?O', '?G', '?K', 'O'],
        ['?B', '?Y', '?R', 'Y'],
        ['?P', 'G'],
        [],
        ['?P', '?K', '?B', 'K'],
        ['?B', '?L', '?K', 'G'],
        ['?O', '?Y', '?K', 'O'],
        ['?Y', '?R', '?K', 'P'],
        ['?L', '?B', '?G', 'K'],
        [],
    ],
    winBottles: 17,
    tutorial: { from: 10, to: [14, 20], dimOpacity: 51 },
    bagCount: 4,
    // Every completed bottle needs one bag, so the sequence holds each colour once per bottle of it.
    bagSequence: ['K', 'R', 'Y', 'L', 'P', 'G', 'O', 'B', 'K', 'R', 'Y', 'L', 'P', 'G', 'O', 'B', 'K'],
};
