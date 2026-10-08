import { Color, Node, ParticleSystem2D, SpriteFrame, Vec2, Vec3 } from 'cc';
import { makeNode } from './NodeUtils';

/** Sprites used by the particle effects. */
export interface FxSprites {
    droplet: SpriteFrame;
    ripple: SpriteFrame;
    sparkle: SpriteFrame;
    question: SpriteFrame;
}

const { PositionType, EmitterMode } = ParticleSystem2D;

interface ParticleConfig {
    sprite: SpriteFrame;
    total: number;
    /** Seconds of emission, -1 = until stopped. */
    duration: number;
    rate: number;
    life: number;
    lifeVar?: number;
    angle?: number;
    angleVar?: number;
    startSize: number;
    startSizeVar?: number;
    endSize: number;
    startSpin?: number;
    startSpinVar?: number;
    endSpin?: number;
    endSpinVar?: number;
    speed?: number;
    speedVar?: number;
    tangentialAccel?: number;
    radialAccel?: number;
    gravity?: Vec2;
    posVar?: Vec2;
    position: number;
    startColor: Color;
    endColor: Color;
}

/** Build a ParticleSystem2D from code. The node is configured while inactive so it starts with these values. */
function emitter(parent: Node, pos: Vec3, c: ParticleConfig): ParticleSystem2D {
    const node = makeNode('Fx', parent);
    node.active = false;
    node.setPosition(pos);
    const ps = node.addComponent(ParticleSystem2D);
    ps.custom = true;
    ps.spriteFrame = c.sprite;
    ps.totalParticles = c.total;
    ps.duration = c.duration;
    ps.emissionRate = c.rate;
    ps.life = c.life;
    ps.lifeVar = c.lifeVar ?? 0;
    ps.angle = c.angle ?? 0;
    ps.angleVar = c.angleVar ?? 0;
    ps.startSize = c.startSize;
    ps.startSizeVar = c.startSizeVar ?? 0;
    ps.endSize = c.endSize;
    ps.endSizeVar = 0;
    ps.startSpin = c.startSpin ?? 0;
    ps.startSpinVar = c.startSpinVar ?? 0;
    ps.endSpin = c.endSpin ?? 0;
    ps.endSpinVar = c.endSpinVar ?? 0;
    ps.emitterMode = EmitterMode.GRAVITY;
    ps.gravity = c.gravity ?? new Vec2(0, 0);
    ps.speed = c.speed ?? 0;
    ps.speedVar = c.speedVar ?? 0;
    ps.tangentialAccel = c.tangentialAccel ?? 0;
    ps.tangentialAccelVar = 0;
    ps.radialAccel = c.radialAccel ?? 0;
    ps.radialAccelVar = 0;
    ps.posVar = c.posVar ?? new Vec2(0, 0);
    ps.positionType = c.position;
    ps.startColor = c.startColor;
    ps.startColorVar = new Color(0, 0, 0, 0);
    ps.endColor = c.endColor;
    ps.endColorVar = new Color(0, 0, 0, 0);
    ps.playOnLoad = true;
    ps.autoRemoveOnFinish = c.duration > 0;
    node.active = true;
    return ps;
}

const withAlpha = (c: Color, a: number) => new Color(c.r, c.g, c.b, a);

/** Droplets running down the pour stream (reference "streamfx2"). */
export function streamDroplets(parent: Node, pos: Vec3, sp: FxSprites, tint: Color): ParticleSystem2D {
    return emitter(parent, pos, {
        sprite: sp.droplet, total: 15, duration: -1, rate: 50, life: 0.1125, lifeVar: 0.075,
        angle: 270, angleVar: 1, startSize: 5, startSizeVar: 1, endSize: 0, startSpinVar: 360, endSpinVar: 360,
        speed: 1500, speedVar: 20, posVar: new Vec2(10, 0), position: PositionType.FREE,
        startColor: tint, endColor: tint,
    });
}

/** Rings spreading on the surface where the stream lands (reference "ripplefx"). */
export function streamRipple(parent: Node, pos: Vec3, sp: FxSprites, tint: Color): ParticleSystem2D {
    const ps = emitter(parent, pos, {
        sprite: sp.ripple, total: 5, duration: -1, rate: 5, life: 1, startSize: 100, endSize: 250,
        gravity: new Vec2(0, 50), position: PositionType.GROUPED,
        startColor: tint, endColor: withAlpha(tint, 0),
    });
    ps.node.setScale(1, 0.7, 1);
    return ps;
}

/** Splash droplets where the stream lands (reference "splashfx"). */
export function streamSplash(parent: Node, pos: Vec3, sp: FxSprites, tint: Color): ParticleSystem2D {
    return emitter(parent, pos, {
        sprite: sp.droplet, total: 5, duration: -1, rate: 50, life: 0.4, lifeVar: 0.1,
        angle: 90, angleVar: 40, startSize: 60, startSizeVar: -20, endSize: 20, startSpinVar: 360, endSpinVar: 360,
        speed: 700, speedVar: 50, gravity: new Vec2(0, -2000), posVar: new Vec2(100, 0), position: PositionType.GROUPED,
        startColor: tint, endColor: withAlpha(tint, 100),
    });
}

/** Little question marks that pop out when a hidden layer is revealed (reference "questionmark_vfx"). */
export function questionBurst(parent: Node, pos: Vec3, sp: FxSprites): ParticleSystem2D {
    return emitter(parent, pos, {
        sprite: sp.question, total: 40, duration: 0.2, rate: 60, life: 0.7, lifeVar: 0.2,
        angle: 31.1, angleVar: 360, startSize: 25, startSizeVar: 0.1, endSize: 10, startSpin: 0.1, endSpin: 180, endSpinVar: 360,
        speed: 60, tangentialAccel: 45, posVar: new Vec2(25, 0), position: PositionType.FREE,
        startColor: new Color(255, 255, 255, 189), endColor: new Color(255, 255, 255, 21),
    });
}

/** Sparkles around the neck of a completed bottle (reference "HoverSparkle10A"). */
export function completeSparkle(parent: Node, pos: Vec3, sp: FxSprites): ParticleSystem2D {
    return emitter(parent, pos, {
        sprite: sp.sparkle, total: 20, duration: 0.06, rate: 250, life: 0.5, lifeVar: 0.2,
        angleVar: 360, startSize: 20, startSizeVar: 10, endSize: 0, endSpinVar: 90,
        radialAccel: 40, posVar: new Vec2(27, 87), position: PositionType.FREE,
        startColor: new Color(255, 255, 255, 163), endColor: new Color(255, 255, 255, 214),
    });
}
