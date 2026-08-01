# Pipe Dodge

Hyper-casual arcade game: dodge incoming pipes and rack up score.

## Quick Start

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`

## Publishing

**itch.io:**
```bash
npm run build:web
# Upload dist/ folder
```

**GameDistribution:**
```bash
NEXT_PUBLIC_GD_GAME_ID=<your-game-id> npm run build:portal
# Creates distributable zip
```

## Features

- Flappy Bird-style mechanics
- Minimal, fast, arcade feel
- GameDistribution ad integration ready
- Mobile responsive

## Development Pattern

This is a template for rapid game development. To create a new game:
1. Copy this folder to `games/game-2-NAME`
2. Modify `src/app/page.tsx` with new game logic
3. Update metadata in `src/app/layout.tsx`
4. Build and publish
