# TV apps built in Claude Code

Apps built for Patch in Claude Code, on a Claude membership (no Anthropic API key). To put one on a TV, download its `.html` file, then in Patch go to TV apps → **Make a TV app** → **Your own code** → **Choose a file** → **Make it**.

- **[alien-attack.html](alien-attack.html): Alien Attack.** A neon space shooter.
  - Controls: ◀ ▶ steer (your ship fires by itself), ▼ fires a nova blast, OK pauses.
  - Inside: three kinds of alien, crystal shields, and a bonus comet that drops power-ups (triple shot, rapid fire, shield).
  - The waves get faster, and the TV keeps your best score.

To make another, ask Claude Code on this project for "a TV app for Patch" and describe it. The `patch-tv-app` skill in `.claude/skills` has the rules it follows.
