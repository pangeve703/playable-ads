# Travel Sort – Playable Ad

## How to run

1. Install Cocos Creator 3.8.8.
2. Open this folder as a project.
3. Open `assets/scenes/main.scene` and press Preview.

## How to build

The final file is `build/playable/TravelSort_AppLovin.html`. It's one HTML file, about 2.2 MB.

**Step 1: build Web Mobile.**

You can use Project → Build in the editor.

The settings I use (they're in `tools/build-web-mobile.json`):

- Platform Web Mobile, only `main.scene`, Debug off, Source Maps off
- MD5 Cache off
- Main Bundle Compression: Merge All JSON
- No compressed textures, no splash screen, orientation Auto
- `CLEANUP_IMAGE_CACHE` on, to save memory
- In Feature Cropping, only the modules the game uses are on: 2D, UI, Mask, Graphics, Particle 2D, Tween, Audio, Animation. This made the engine go from 2.5 MB down to 1.7 MB.

**Step 2: pack it into one file.**

```
node tools/build_playable.js
```

This puts every file from the build inside the HTML. When the game asks for a file, a small script gives it the copy from inside the page, so nothing is downloaded. The reference file works the same way.

**Step 3: test in AppLovin.**

Open https://p.applov.in/playablePreview?create=1&qr=1, upload the HTML, and try both portrait and landscape. You can scan the QR code to play it on your phone.

## Tools

- Cocos Creator 3.8.8 with TypeScript. No other libraries in the game.
- VS Code and Claude Code (see `AI_PROCESS.md`).
- Python with Pillow, for cutting, converting and packing images.
- Playwright, to run my build and the reference side by side and compare screenshots and timing.
- fflate, a small MIT library, to unzip the files inside the HTML.

## Known differences and limits

- **Bag colour order:** There's no bag order in source code. You can change the order in `LevelConfig.ts` (`bagSequence`).
- **Tutorial hand when the screen size changes:** in the reference, the hand moves to the bottle's new position when the screen is resized or rotated. In my version, the hand keeps the position it had.
- **Store link:** it's still a placeholder (`storeUrl` on `GameManager`).

## Time spent

About 2 days.
