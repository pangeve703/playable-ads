import { AudioClip, AudioSource, input, Input, Node, resources } from 'cc';

/** Sound clips under assets/resources/audio, taken from the reference playable. */
const CLIPS = {
    bgm: 'audio/bgm',
    pourLoop: 'audio/pour_loop',
    select: 'audio/bottle_select',
    bagCollect: 'audio/bag_collect',
    complete: 'audio/complete',
    cork: 'audio/cork',
    win: 'audio/win',
    lose: 'audio/lose',
};
type ClipKey = keyof typeof CLIPS;

/** Volumes from the reference AudioManager. */
const SFX_VOLUME = 0.8;
const SELECT_VOLUME = 0.6;
const BGM_VOLUME = 0.2;

/**
 * Reference audio behaviour: nothing plays until the first touch (browsers block audio before a user gesture),
 * then the music loops quietly. One source plays effects and the pour loop, a second one the music.
 */
export class Audio {
    private readonly sfx: AudioSource;
    private readonly music: AudioSource;
    private clips = {} as Record<ClipKey, AudioClip>;
    private enabled = false;
    /** True while the ad is hidden: nothing may play. */
    private suspended = false;

    constructor(host: Node) {
        this.sfx = host.addComponent(AudioSource);
        this.music = host.addComponent(AudioSource);
        for (const s of [this.sfx, this.music]) s.playOnAwake = false;
        // Fallback for touches that no node handles; touches on the game itself call unlock() from the root node,
        // because nodes that handle a touch swallow it before global listeners see it.
        input.on(Input.EventType.TOUCH_START, this.unlock, this);
        input.on(Input.EventType.MOUSE_DOWN, this.unlock, this);
    }

    load(): Promise<void> {
        const keys = Object.keys(CLIPS) as ClipKey[];
        return new Promise(resolve => {
            resources.load(keys.map(k => CLIPS[k]), AudioClip, (err, clips) => {
                // a missing sound should never stop the game from starting
                if (err) console.warn('[Audio] failed to load clips', err);
                else keys.forEach((k, i) => (this.clips[k] = clips[i]));
                resolve();
            });
        });
    }

    /** Call on the first user gesture: sounds play from then on and the music starts. */
    unlock() {
        input.off(Input.EventType.TOUCH_START, this.unlock, this);
        input.off(Input.EventType.MOUSE_DOWN, this.unlock, this);
        if (this.enabled) return;
        this.enabled = true;
        const bgm = this.clips.bgm;
        if (!bgm) return;
        this.music.clip = bgm;
        this.music.loop = true;
        this.music.volume = BGM_VOLUME;
        if (!this.suspended) this.music.play();
    }

    /** Stop all sound while the ad is hidden, and resume the music when it shows again. */
    setSuspended(suspended: boolean) {
        if (suspended === this.suspended) return;
        this.suspended = suspended;
        if (suspended) {
            this.sfx.stop();
            this.music.pause();
        } else if (this.enabled && this.music.clip) {
            this.music.play();
        }
    }

    /** Bottle reached the top of its lift. */
    select() { this.oneShot('select', SELECT_VOLUME); }
    /** Bottle drops into its bag. */
    bagCollect() { this.oneShot('bagCollect', SELECT_VOLUME); }
    /** A bottle was filled with one colour (before the cork). */
    complete() { this.oneShot('complete', SFX_VOLUME); }
    corkLanded() { this.oneShot('cork', SFX_VOLUME); }
    win() { this.oneShot('win', SFX_VOLUME); }
    lose() { this.oneShot('lose', SFX_VOLUME); }

    /** Looping pour sound while a stream runs. */
    startPour() {
        const clip = this.clips.pourLoop;
        if (!this.enabled || this.suspended || !clip) return;
        this.sfx.clip = clip;
        this.sfx.loop = true;
        this.sfx.volume = SFX_VOLUME;
        this.sfx.play();
    }

    stopPour() {
        this.sfx.stop();
        this.sfx.loop = false;
    }

    private oneShot(key: ClipKey, volume: number) {
        const clip = this.clips[key];
        if (this.enabled && !this.suspended && clip) this.sfx.playOneShot(clip, volume);
    }
}
