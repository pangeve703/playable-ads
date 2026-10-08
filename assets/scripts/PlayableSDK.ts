/**
 * Thin wrapper over the different ad-network APIs, so game code only calls `openStore()` / `gameEnd()`.
 * Whichever API the network injects into the page is used; outside an ad container it falls back to window.open.
 */
const w = (typeof window !== 'undefined' ? window : {}) as any;

export function openStore(url: string) {
    try {
        if (w.super_html?.download) { w.super_html.download(); return; }   // super-html build plugin
        if (w.mraid?.open) { w.mraid.open(url); return; }                    // AppLovin, Unity, ironSource (MRAID)
        if (w.FbPlayableAd?.onCTAClick) { w.FbPlayableAd.onCTAClick(); return; } // Meta
        if (w.ExitApi?.exit) { w.ExitApi.exit(); return; }                   // Google Ads
        if (w.dapi?.openStoreUrl) { w.dapi.openStoreUrl(); return; }         // ironSource DAPI
        if (w.install) { w.install(); return; }                              // Mintegral
        w.open?.(url, '_blank');
    } catch (e) {
        console.warn('[PlayableSDK] openStore failed', e);
    }
}

/** Tell the network the game reached its end (some networks require this). */
export function gameEnd() {
    try {
        w.super_html?.game_end?.();
        w.gameEnd?.();
    } catch (e) {
        console.warn('[PlayableSDK] gameEnd failed', e);
    }
}

/**
 * Calls `cb(false)` when the ad is hidden (closed, app in the background, MRAID not viewable) and `cb(true)` when it
 * shows again. Ad networks require the sound to stop while the ad is hidden.
 */
export function onVisibilityChange(cb: (visible: boolean) => void) {
    const doc = typeof document !== 'undefined' ? document : null;
    let pageVisible = !doc || doc.visibilityState !== 'hidden';
    let adVisible = true;
    let last = true;
    const update = () => {
        const visible = pageVisible && adVisible;
        if (visible !== last) { last = visible; cb(visible); }
    };
    doc?.addEventListener('visibilitychange', () => { pageVisible = doc.visibilityState !== 'hidden'; update(); });
    try {
        w.mraid?.addEventListener?.('viewableChange', (viewable: boolean) => { adVisible = !!viewable; update(); });
        w.mraid?.addEventListener?.('stateChange', (state: string) => { adVisible = state !== 'hidden'; update(); });
    } catch (e) {
        console.warn('[PlayableSDK] MRAID events unavailable', e);
    }
}
