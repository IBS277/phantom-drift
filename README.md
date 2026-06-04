# Racing Multiplayer — First-Person Split-Screen Engine

A MakeCode Arcade **extension** that adds **first-person, split-screen** racing for
2–4 players. Each player drives their own car (player1–4 controls) and gets their own
driver's-eye view in their part of the screen, with a rear-view mirror and starting
lights. Uses the player2–4 controls, so MakeCode's **Host** button appears for online
multiplayer.

> Unlike a top-down camera, the first-person view is drawn by this engine, so the
> "track" is a list of curvatures you supply — see below.

## Use as Extension

- open https://arcade.makecode.com/
- click **New Project**
- click **Extensions** under the gearwheel (⚙) menu
- paste **https://github.com/IBS277/racing-multiplayer** and import

## Quick start

In the JavaScript view of your game:

```ts
fpSplit.run(
    [0, 0, 0.5, 0, -0.6, 0.4, 1.6, 0.5, -0.2, 0.8, -0.8, -0.6, 1.0, 0.5, 0, 0],
    46,   // segment length (world units per curvature value)
    3     // laps to win
)
```

That single call gives you: a 2–4 player picker, red/yellow/green start lights, the
split-screen first-person race, rear mirrors, off-track penalty, and lap counting.

## The track

`run(curve, segmentLength, laps)` takes a **curve array**: one number per segment.

- `0` = straight
- positive = right-hand corner (bigger = tighter)
- negative = left-hand corner

The list loops, so the end joins back to the start. Tune `segmentLength` for how long
each segment lasts.

## API

| Function | What it does |
|----------|--------------|
| `fpSplit.run(curve, segLen, laps)` | Start the whole experience (picker → lights → race). Call once. |
| `fpSplit.setTrack(curve, segLen)` | Replace the track. |
| `fpSplit.setLaps(n)` | Set laps to win. |
| `fpSplit.onFinish(handler)` | Callback with the winner's index (0–3) when someone finishes. |
| `fpSplit.lapOf(i)` | Current lap (1-based) of player `i`. |

## Controls

Per player: **◄ ►** steer · **▲** throttle · **▼** brake. Player 1 also uses **▲/▼** and
**Ⓐ** on the start screen to choose the player count and begin.

## Notes / limits

- First-person split is hand-rendered (MakeCode has no 3D engine), so this engine owns
  the road look; you provide the shape via the curve array.
- 2 players = top/bottom halves; 3–4 = quadrants. At 4 players each view is small.
