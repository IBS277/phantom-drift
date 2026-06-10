# 🏎️ Phantom Drift

**First-person split-screen racing for MakeCode Arcade (2–4 players)**

Created by **Ishan S.** · Millburn Middle School

---

## What it is

A first-person, split-screen racing game where 2–4 players race head-to-head on one
screen — each driver sees their own view of the track. Pick a circuit, choose your
tyres in the pits, race through changing weather, and battle for the podium.

## Features

- 🪟 **Split-screen** — 2–4 players, each with their own first-person view
- 🛣️ **3 circuits** — Monaco, Speedway, Grand Prix (designed in your game code)
- ⚡ **Boost** — hold **B** for a turbo burst
- ⛽ **Pickups & hazards** — grab fuel, dodge oil slicks
- 🔧 **Pit stops** — drive into the pit lane and choose Soft / Medium / Hard / Wet tyres
- 🌦️ **Dynamic weather** — sun, rain, fog and night that change during the race
- 🗺️ **Live mini-map** — see every car's position on the track
- 🏆 **Podium celebration** — the winner jumps highest, with confetti!
- 🏁 **Title screen** — your game name, creator and school

## How to use it

1. In MakeCode Arcade: **New Project** → ⚙ → **Extensions** → paste this repo URL.
2. In your `main.ts` (JavaScript view), design your tracks, set the rules, and start:

```javascript
// Design tracks (the names show up on the menu)
fpSplit.addTrack("MONACO")
fpSplit.addStraight(2)
fpSplit.addHairpin()
fpSplit.addRightTurn(3)
fpSplit.addStraight(2)

// Title + rules
fpSplit.setTitle("PHANTOM DRIFT", "Ishan Sathavalli", "Millburn Middle School")
fpSplit.setPlayers(2)
fpSplit.setLaps(3)
fpSplit.setWeather(WeatherMode.Dynamic)
fpSplit.setPitStops(PitMode.Manual)

// Go!
fpSplit.startBuiltRace()
```

## Building a track

Each call adds a piece of road. Use several `addTrack("name")` blocks to give players
a menu of circuits.

| Call | Adds |
|------|------|
| `fpSplit.addTrack("name")` | Start a new named track |
| `fpSplit.addStraight(n)` | A straight, `n` segments long |
| `fpSplit.addRightTurn(n)` / `addLeftTurn(n)` | A turn |
| `fpSplit.addHairpin()` | A sharp U-bend |
| `fpSplit.addChicane()` | A quick left-right wiggle |
| `fpSplit.startBuiltRace()` | Finish and launch (first track is default) |

## Settings & events

| Call | What it does |
|------|--------------|
| `setTitle(name, creator, school)` | The opening title screen text |
| `setPlayers(n)` · `setLaps(n)` | Players (2–4) and lap count |
| `setWeather(WeatherMode.…)` | Off / Sunny / Rain / Fog / Night / Dynamic |
| `setPitStops(PitMode.…)` | Off / Auto / Manual |
| `setDifficulty(RaceDifficulty.…)` | Easy / Hard |
| `onWin(winner => …)` | Runs when a player wins (1–4) |
| `onLap(player, lap => …)` · `onStart(() => …)` | Lap / race-start events |
| `getPlace(p)` · `getLap(p)` | Read a player's position / lap |

## Controls

| Button | Race | Menu |
|--------|------|------|
| **Up** | Accelerate | Move cursor |
| **Down** | Brake | Move cursor |
| **Left / Right** | Steer | Change setting |
| **A** | Pit / continue | Start race |
| **B** | Boost ⚡ | — |

## 📖 Full rules

A kid-friendly illustrated rules guide is in **`RULES.html`** — open it in a browser
for an 8-slide walkthrough of how to play.

---

*Phantom Drift — built with MakeCode Arcade by Ishan S.*
