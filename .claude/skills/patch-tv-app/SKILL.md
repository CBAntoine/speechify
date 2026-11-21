---
name: patch-tv-app
description: Build or change a TV app for Patch (the home-network app in patch/) right here in Claude Code, so it runs on the person's Claude membership instead of Anthropic API credits. Use when someone asks for a TV app, a game, board or tool for their TV, or a change to an app in patch/apps/.
---

# Building a TV app for Patch

Patch puts single-file HTML apps on TVs: a real app on Android TV, Google TV and Fire TV, and the TV's browser on Samsung and LG. An app built here uses the person's Claude membership. Patch's own "Build with Claude" needs an Anthropic API key instead.

1. **Follow Patch's TV app rules.** They are the `SYSTEM` text in `patch/src/tvapps/claude.mjs`; read it first. In short:
   - one self-contained HTML file, under 150 KB, with nothing loaded from elsewhere;
   - ES2015 only: no async/await, `?.`, `??`, object spread or modules;
   - the remote's keys: arrows, Enter 13, and Back 27/8/10009/461 plus `window.tvkit.back`;
   - 1920×1080 with 5% margins;
   - localStorage wrapped in try/catch;
   - `window.PatchTV` extras only when it exists;
   - games: arrows play, OK pauses, a start screen, a score, game over and a best score.
2. **Make it original.** A game can share a genre's mechanics, never another game's name, characters, art, sounds or levels.
3. **Save it** as `patch/apps/<name>.html` (lowercase, hyphens).
4. **Check it before sending:**
   - Parse the inline script with acorn at `ecmaVersion: 2015`. Install acorn in the scratchpad, not the project.
   - Play it in headless Chromium (Playwright is installed) with the remote's keys: start, play, pause, Back and game over.
   - Make sure there are no page errors, and look at screenshots at 1920×1080 and at phone size.
5. **Send the person the .html file** with a screenshot, and tell them how to add it: in Patch, TV apps → Make a TV app → **Your own code** → **Choose a file** → Make it, then put it on a TV. To change an app that's already in Patch: open it → Choose a file → Save changes.
6. **Keep it:** list it in `patch/apps/README.md` and commit. The repository is public, so never commit an app that holds personal details (names, schedules, addresses); send that one only as a file.
