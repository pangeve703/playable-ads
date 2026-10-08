## Tools

I mainly used Claude Code inside VS Code. It could read the project, run commands in the terminal, and open a headless browser to test the game.

## What I used it for

- **Getting the resources:** the reference is one HTML file with everything packed inside. The AI unpacked it and pulled out the images, animations, sounds and scripts.
- **Cropping and repacking:** it cropped the images to remove empty space, then repacked them into atlases.
- **Writing code:** it wrote most of the TypeScript: bottles, pouring, bags, tutorial, end cards, sound and the layout for different screens.
- **Comparing:** it played the reference and my version side by side with the same moves and took screenshots, so we could spot the differences.
- **Building:** it set up the Web Mobile build and wrote the tool that packs everything into one HTML file for AppLovin.

## Examples

- **Reducing memory and draw calls:** we cropped the images and packed about 35 separate images into 5 atlases. Putting everything a bottle draws into one atlas cut the draw calls from about 350 to 15.
- **Development:** when something looked wrong, the AI read the reference code to find the real numbers instead of guessing, changed my code, and tested it again.

## What I did myself

- Prompt to reference the html files and video.
- Checked how it looked and pointed out what was wrong.
- Tested the game in the Cocos preview.

## Where AI didn't help much

- **I had to check its work.** Its first try wasn't always right. I had to play the game after each change to catch these.
