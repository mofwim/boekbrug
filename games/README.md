# Rapid Hyper-Casual Games

Each folder is a complete, publishable game:
- **Target**: itch.io + GameDistribution (ad-supported)
- **Cycle**: 1–2 weeks per game
- **Pattern**: Proven Slipper Fight stack

## Games

- `game-1-template`: Starter template for new games
- (add game folders here)

## Publishing

```bash
# Each game builds independently to dist/
cd games/GAME_NAME
npm run build:web      # itch.io
npm run build:portal   # GameDistribution (with GD_GAME_ID)
```

## Shared Resources

`../shared/` contains:
- Build config templates
- Asset pipeline (image optimization, sprite sheets)
- Deploy scripts (zip → itch, GD upload)
