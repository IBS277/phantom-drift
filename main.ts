// =============================================================================
//  fpSplit — First-person split-screen racing engine (MakeCode Arcade extension)
// -----------------------------------------------------------------------------
//  Reusable library: import this repo as an extension, then in your game call
//  fpSplit.run(trackCurve, segmentLength, laps).  Everything else — the player
//  picker, the red/yellow/green start lights, the per-player split-screen
//  first-person views, rear mirrors, off-track penalty and lap counting — is
//  handled for you. Uses player1–4 controls (so MakeCode's HOST button works).
//
//  This is JavaScript-only (the API takes arrays), like riknoll's split-screen.
// =============================================================================
namespace fpSplit {
    // ---- screen ----
    const W = 160, H = 120

    // ---- colours (MakeCode default palette) ----
    const C_SKY = 9, C_GRASS_L = 7
    const C_ROAD_L = 11, C_ROAD_D = 12, C_RUMBLE_A = 2, C_RUMBLE_B = 1, C_LINE = 1
    const C_RED = 2, C_YEL = 5, C_GRN = 6, C_OFF = 12, C_PANEL = 15
    // Match MakeCode's standard player colours so the car colour equals the
    // player's joystick/icon colour: P1 red, P2 blue, P3 orange, P4 green.
    const CAR_COLORS = [2, 8, 4, 7]

    // ---- physics ----
    const MAX_SPEED = 64, ACCEL = 42, BRAKE = 80, ENGINE_BRAKE = 16, OFF_MAX = 24
    // STEER: how fast steering moves you sideways. CENTRI: outward pull in bends
    // (lowered for a smoother, less-floaty feel). STEER_EASE: how quickly the
    // visual steering angle follows the stick (for the lean / front-wheel feel).
    const STEER = 2.3, CENTRI = 1.6, STEER_EASE = 6
    const SEE = 240                      // metres of road visible ahead

    // ---- weather (shared, changes during the race) ----
    // 0 sunny, 1 rain (less grip), 2 fog (short view), 3 night (dark + lights).
    const WX_SUN = 0, WX_RAIN = 1, WX_FOG = 2, WX_NIGHT = 3
    const WX_NAMES = ["SUNNY", "RAIN", "FOG", "NIGHT"]
    let weather = WX_SUN
    let wxAnnounce = 0               // seconds left showing the "weather changed" banner
    let wxLastLap = -1              // leader lap at last weather roll
    let clock = 0                   // wall-clock seconds, ticks every frame (for rain etc.)

    // ---- boost (Phase 2) ----
    const BOOST_SPEED = 96            // top speed while boosting (vs MAX_SPEED 64)
    const BOOST_MAX = 1.4            // seconds of boost when full
    const BOOST_REGEN = 0.35        // boost charge regained per second
    const BOOST_USE = 1.0           // boost charge spent per second while boosting

    // ---- items on the track (Phase 3) ----
    // Each item: {d: distance along the lap, x: lateral -1..1, kind: 0=oil 1=boost,
    // taken: per-player bitmask of who has consumed it this lap}.
    class TrackItem {
        d: number
        x: number
        kind: number
        taken: number
        constructor(d: number, x: number, kind: number) {
            this.d = d; this.x = x; this.kind = kind; this.taken = 0
        }
    }
    let items: TrackItem[] = []
    let pitD = 0                     // pit-zone distance along the lap (set on start)

    // ---- track (set via run / setTrack) ----
    let trackCurve = [0]
    let segLen = 46
    let lapLen = 46
    let lapsToWin = 3

    // ---- per-player state ----
    let pos = [0, 0, 0, 0]
    let spd = [0, 0, 0, 0]
    let lat = [0, 0, 0, 0]
    let cur = [0, 0, 0, 0]
    let sdisp = [0, 0, 0, 0]
    let plap = [0, 0, 0, 0]
    let lapTime = [0, 0, 0, 0]      // seconds elapsed on the current lap
    let bestLap = [0, 0, 0, 0]      // best lap time so far (0 = none yet)
    let steerAng = [0, 0, 0, 0]     // eased steering angle (-1..1) for visual lean
    let boost = [BOOST_MAX, BOOST_MAX, BOOST_MAX, BOOST_MAX]  // boost charge left
    let boosting = [false, false, false, false]
    let spinT = [0, 0, 0, 0]        // seconds left spinning out (hazard hit)
    let isCPU = [false, false, false, false]  // AI-controlled car?
    let boostFx = [0, 0, 0, 0]      // pickup speed-bonus timer (seconds)
    let wear = [0, 0, 0, 0]         // tyre wear 0..1 (1 = fully worn)
    let pitting = [false, false, false, false]  // currently in a pit stop?
    let pitProg = [0, 0, 0, 0]      // pit-stop progress 0..1 (button-mash fills it)
    let pitDone = [0, 0, 0, 0]      // laps on which this player has already pitted (bitmask)
    let canPit = [false, false, false, false]  // in the pit zone right now?

    // tyre-wear tuning
    const WEAR_RATE = 0.04           // wear gained per second of racing (visible in a lap or two)
    const WEAR_SLOW = 0.35          // top-speed loss fraction at full wear
    const WEAR_GRIP = 0.4           // grip loss fraction at full wear
    const PIT_MASH = 0.12           // pit progress per A press (≈9 presses)

    // ---- game state ----
    const PH_SELECT = 0, PH_LIGHTS = 1, PH_RACE = 2, PH_DONE = 3
    let phase = PH_SELECT
    let numPlayers = 2
    let lightsT = 0
    let finished = false
    let winner = -1
    let started = false
    let finishHandler: (winnerIndex: number) => void = null
    let standings: number[] = []     // car indices, finishing order (podium)
    let podiumT = 0                  // podium animation timer

    // ---- track select (Phase 4) ----
    // Built-in tracks: curvature arrays. Index 0 is whatever the host passed to
    // run(); 1-3 are presets. selTrack picks one on the select screen.
    const TRACK_NAMES = ["CUSTOM", "MONACO", "OVAL", "TWISTY"]
    // MONACO: a tight street-circuit feel (hairpins + chicanes).
    const TRACK_MONACO = [0, 0, 0.5, 0.4, 0, 0, -0.6, -0.5, 0.5, 1.5, 1.7, 0.5, 0, -0.3, 0.8, -0.8, -0.6, 0.6, 1.0, 0.5, 0, 0]
    const TRACK_OVAL = [0, 0, 0, 0.8, 0.9, 0.9, 0.8, 0, 0, 0, 0, 0.8, 0.9, 0.9, 0.8, 0, 0, 0]
    const TRACK_TWISTY = [0, 0.9, -0.9, 0.8, -1.1, 1.2, -0.7, 0.6, -1.3, 1.0, -0.8, 0.5, -0.6, 1.1, -1.0, 0, 0]
    let hostCurve = [0]              // the curve passed into run() (= CUSTOM)
    let selTrack = 1                // default to MONACO on the picker
    let cpuCount = 0                // extra AI cars beyond human players (set on select)

    // ---- pre-game menu (cursor over setting rows) ----
    // rows: 0 players,1 track,2 cpu,3 laps,4 pit,5 difficulty,6 weather,7 START
    const MENU_ROWS = 8
    let menuRow = 0
    let pitOn = false               // pit stops enabled?
    let difficulty = 0              // 0 easy, 1 hard
    let wxMode = 2                  // 0 off(sunny), 1 fixed, 2 dynamic
    let wxFixed = 0                 // chosen weather when wxMode == fixed
    const DIFF_NAMES = ["EASY", "HARD"]
    const WXMODE_NAMES = ["OFF", "FIXED", "DYNAMIC"]

    // ---------------------------------------------------------------- helpers
    function bandOf(v: number): number {
        let b = Math.floor(v) % 2
        if (b < 0) b += 2
        return b
    }
    function curveAt(d: number): number {
        const f = d / segLen
        let i = Math.floor(f) % trackCurve.length
        if (i < 0) i += trackCurve.length
        const j = (i + 1) % trackCurve.length
        return trackCurve[i] + (trackCurve[j] - trackCurve[i]) * (f - Math.floor(f))
    }
    function clipH(target: Image, xa: number, xb: number, y: number, c: number, lo: number, hi: number) {
        let x0 = Math.max(lo, Math.round(xa))
        let x1 = Math.min(hi, Math.round(xb))
        if (x1 > x0) target.fillRect(x0, y, x1 - x0, 1, c)
    }
    function ctrlFor(i: number): controller.Controller {
        if (i == 0) return controller.player1
        if (i == 1) return controller.player2
        if (i == 2) return controller.player3
        return controller.player4
    }
    function infoFor(i: number): info.PlayerInfo {
        if (i == 0) return info.player1
        if (i == 1) return info.player2
        if (i == 2) return info.player3
        return info.player4
    }
    // Total cars on track = human players + CPU rivals.
    function carCount(): number { return numPlayers + cpuCount }

    // Change the value of the currently-highlighted menu row by dir (-1/+1).
    function menuAdjust(dir: number) {
        if (menuRow == 0) {                         // players 2..4
            numPlayers = Math.max(2, Math.min(4, numPlayers + dir))
            if (cpuCount > 4 - numPlayers) cpuCount = 4 - numPlayers
        } else if (menuRow == 1) {                  // track
            selTrack = (selTrack + dir + 4) % 4
        } else if (menuRow == 2) {                  // cpu cars 0..(4-players)
            const maxC = 4 - numPlayers
            cpuCount = Math.max(0, Math.min(maxC, cpuCount + dir))
        } else if (menuRow == 3) {                  // laps 1..9
            lapsToWin = Math.max(1, Math.min(9, lapsToWin + dir))
        } else if (menuRow == 4) {                  // pit stops on/off
            pitOn = !pitOn
        } else if (menuRow == 5) {                  // difficulty
            difficulty = (difficulty + dir + 2) % 2
        } else if (menuRow == 6) {                  // weather: OFF, FIXED x4, DYNAMIC
            // combined index 0=off,1..4=fixed sun/rain/fog/night,5=dynamic
            let wi = wxMode == 0 ? 0 : wxMode == 2 ? 5 : 1 + wxFixed
            wi = (wi + dir + 6) % 6
            if (wi == 0) { wxMode = 0 }
            else if (wi == 5) { wxMode = 2 }
            else { wxMode = 1; wxFixed = wi - 1 }
        }
        // row 7 (START) has no value to adjust
    }

    // Apply chosen settings and start the lights. Namespace-level (not nested in
    // run) so MakeCode reliably binds it from the A-button handler.
    function startRace() {
        // CUSTOM = the curve the host passed to run(); others are presets.
        const chosen = selTrack == 0 ? hostCurve : selTrack == 1 ? TRACK_MONACO
            : selTrack == 2 ? TRACK_OVAL : TRACK_TWISTY
        setTrack(chosen, segLen)
        buildItems()
        pitD = Math.floor(lapLen * 0.85)   // pit zone near the end of the lap
        for (let k = 0; k < 4; k++) {
            isCPU[k] = k >= numPlayers && k < numPlayers + cpuCount
            pos[k] = 0                        // all start on the line (can't reverse behind it)
            spd[k] = 0; lat[k] = 0; cur[k] = 0; sdisp[k] = 0; steerAng[k] = 0
            plap[k] = 0; lapTime[k] = 0; bestLap[k] = 0
            boost[k] = BOOST_MAX; boosting[k] = false; spinT[k] = 0; boostFx[k] = 0
            wear[k] = 0; pitting[k] = false; pitProg[k] = 0; pitDone[k] = 0
        }
        // weather mode: off => always sunny; fixed => chosen; dynamic => starts sunny, rolls each lap
        weather = wxMode == 0 ? WX_SUN : wxMode == 1 ? wxFixed : WX_SUN
        wxAnnounce = 0; wxLastLap = 0
        finished = false; winner = -1
        phase = PH_LIGHTS; lightsT = 0
    }

    // Draw one menu row: label + value, with a cursor and highlight when active.
    function menuLine(target: Image, row: number, y: number, label: string, value: string) {
        const active = menuRow == row
        if (active) {
            target.fillRect(6, y - 1, 148, 9, 1)        // white highlight bar
            target.print(">", 8, y, 2, image.font5)      // red cursor on white
        }
        // inactive labels are WHITE on the black panel (were black = invisible);
        // active labels are black on the white highlight bar.
        const labCol = active ? 15 : 1
        const valCol = active ? 2 : C_YEL
        target.print(label, 16, y, labCol, image.font5)
        target.print(value, 96, y, valCol, image.font5)
    }
    function drawMenu(target: Image) {
        target.fill(C_SKY)
        target.fillRect(2, 2, 156, 116, 0)
        target.print("F1 SPLIT-SCREEN RACE", 24, 4, C_YEL, image.font5)
        const wxLabel = wxMode == 1 ? WX_NAMES[wxFixed] : WXMODE_NAMES[wxMode]
        menuLine(target, 0, 15, "PLAYERS", "" + numPlayers)
        menuLine(target, 1, 25, "TRACK", TRACK_NAMES[selTrack])
        menuLine(target, 2, 35, "CPU CARS", "" + cpuCount)
        menuLine(target, 3, 45, "LAPS", "" + lapsToWin)
        menuLine(target, 4, 55, "PIT STOPS", pitOn ? "ON" : "OFF")
        menuLine(target, 5, 65, "DIFFICULTY", DIFF_NAMES[difficulty])
        menuLine(target, 6, 75, "WEATHER", wxLabel)
        // START row
        const startActive = menuRow == 7
        target.fillRect(50, 88, 60, 11, startActive ? 6 : C_PANEL)
        target.print("> START <", 56, 91, startActive ? 0 : 1, image.font5)
        target.print("UP/DN MOVE  L/R CHANGE  A=GO", 8, 110, 1, image.font5)
    }

    // Full-screen podium celebration: 1st/2nd/3rd on stepped blocks with their
    // car colour and a tiny F1, confetti raining for the winner. podiumT animates.
    function drawPodium(target: Image) {
        target.fill(0)
        target.fillRect(0, 0, 160, 22, C_PANEL)
        target.print("RACE RESULTS", 46, 4, C_YEL, image.font8)
        const winnerCar = standings.length > 0 ? standings[0] : winner
        target.print("P" + (winnerCar + 1) + " WINS!", 52, 14, CAR_COLORS[winnerCar], image.font5)

        // confetti (deterministic streaks animated by podiumT)
        const tt = Math.floor(podiumT * 12)
        for (let c = 0; c < 24; c++) {
            const cx = (c * 37 + tt * 3) % 160
            const cy = (c * 53 + tt * 5) % 96 + 22
            target.setPixel(cx, cy, CAR_COLORS[c % 4])
        }

        // three podium blocks: heights 1st>2nd>3rd, order 2nd|1st|3rd
        const slots = [1, 0, 2]               // which standings index sits in each x-slot
        const bx = [40, 70, 100]              // left x of each block
        const bh = [26, 36, 18]               // block heights for 2nd,1st,3rd
        const baseY = 116
        for (let s = 0; s < 3; s++) {
            const idx = slots[s]
            if (idx >= standings.length) continue
            const car = standings[idx]
            const x = bx[s], h = bh[s]
            // block
            target.fillRect(x, baseY - h, 20, h, C_PANEL)
            target.drawRect(x, baseY - h, 20, h, 1)
            target.print("" + (idx + 1), x + 8, baseY - h + 2, C_YEL, image.font5)
            // a little car on top in the player's colour
            const cy = baseY - h - 12
            target.fillRect(x + 4, cy + 4, 12, 7, CAR_COLORS[car])   // body
            target.fillRect(x + 2, cy + 5, 4, 5, 15)                  // L tyre
            target.fillRect(x + 14, cy + 5, 4, 5, 15)                 // R tyre
            target.fillRect(x + 5, cy + 1, 10, 2, 1)                  // wing
            target.print("P" + (car + 1), x + 4, cy - 6, CAR_COLORS[car], image.font5)
        }
        target.print("PRESS RESET TO RACE AGAIN", 16, 119 - 6, 13, image.font5)
    }

    // --- weather: how much grip is lost (1 = full grip) ---
    function wxGrip(): number {
        return weather == WX_RAIN ? 0.62 : weather == WX_FOG ? 0.85 : weather == WX_NIGHT ? 0.9 : 1
    }
    // view distance in metres for the current weather (fog = short)
    function wxSee(): number {
        return weather == WX_FOG ? 110 : weather == WX_NIGHT ? 170 : SEE
    }
    // palette per weather: [sky, grass, roadLight, roadDark]
    function wxSky(): number { return weather == WX_NIGHT ? 0 : weather == WX_RAIN ? 13 : weather == WX_FOG ? 1 : C_SKY }
    function wxGrass(): number { return weather == WX_NIGHT ? 3 : weather == WX_RAIN ? 6 : C_GRASS_L }
    function wxRoadL(): number { return weather == WX_NIGHT ? 12 : C_ROAD_L }
    function wxRoadD(): number { return weather == WX_NIGHT ? 15 : C_ROAD_D }
    // Live race position (1 = leading) for player i, by total distance covered.
    function placeOf(i: number): number {
        let p = 1
        for (let j = 0; j < carCount(); j++) if (j != i && pos[j] > pos[i]) p++
        return p
    }
    function ordinal(n: number): string {
        return n == 1 ? "1st" : n == 2 ? "2nd" : n == 3 ? "3rd" : "4th"
    }
    // Scatter items along the lap: alternating boost tokens and oil slicks at a
    // few positions and lateral offsets. Deterministic (no RNG) for fair races.
    function buildItems() {
        items = []
        const n = Math.max(4, Math.floor(lapLen / 220))
        for (let k = 0; k < n; k++) {
            const d = Math.floor((k + 0.5) * lapLen / n)
            const kind = k % 2            // alternate boost / oil
            // weave the lateral position so players must steer for them
            const x = ((k % 3) - 1) * 0.55
            items.push(new TrackItem(d, x, kind))
        }
    }
    // Format seconds as M:SS.t (tenths). Keeps the HUD compact.
    function fmtTime(t: number): string {
        if (t <= 0) return "--:--"
        const total = Math.floor(t * 10)
        const tenths = total % 10
        const secs = Math.floor(total / 10) % 60
        const mins = Math.floor(total / 600)
        const ss = secs < 10 ? "0" + secs : "" + secs
        return mins + ":" + ss + "." + tenths
    }

    // ---------------------------------------------------------------- F1 sprites
    // Hand-drawn rear-view Formula 1 cars (red/white livery) at three sizes so a
    // closer opponent shows more detail. Palette: 0 transparent, 1 white,
    // 2 red (player-tinted), 13 grey highlight, 15 black (tyres/wing/cockpit).
    // The red (2) pixels are recoloured per player; white/black stay fixed.

    // REAR-VIEW F1 cars (you see the back of the car ahead of you). Each size has
    // two frames (A/B) whose tyre tread lines (1=white) sit at different rows, so
    // alternating them reads as the wheels SPINNING. Red (2) = player livery.

    // NEAR — 21x16: rear view. Wing bar on top, body+cockpit in the middle, and
    // TWO rear tyres whose BOTTOMS sit on the same ground line (bottom row) so the
    // whole car contacts the road. The white tread (1) marks the spin frame.
    const F1_NEAR_A = img`
        . . . . f f f f f f f f f f f f f . . . .
        . . . . f 1 1 1 1 1 1 1 1 1 1 1 f . . . .
        . . . . f f f f f f f f f f f f f . . . .
        . . . . . . . f f 2 2 2 f f . . . . . . .
        . . . . . . f f 1 2 2 2 1 f f . . . . . .
        . . . . . . f 2 2 2 2 2 2 2 f . . . . . .
        . . . f f . f 2 2 2 2 2 2 2 f . f f . . .
        . . f f f f f 2 2 2 1 2 2 2 f f f f f . .
        . f f f f f f 2 2 2 2 2 2 2 f f f f f f .
        . f f 1 f f f 2 2 2 2 2 2 2 f f f 1 f f .
        . f f f f f f 2 2 2 1 2 2 2 f f f f f f .
        . f f 1 f f f 1 1 1 1 1 1 1 f f f 1 f f .
        . f f f f f f 1 1 1 1 1 1 1 f f f f f f .
        . f f 1 f f . f 1 1 1 1 1 f . f f 1 f f .
        . f f f f f . . f f f f f . . f f f f f .
        . . f f f f . . . . . . . . . f f f f . .
    `
    const F1_NEAR_B = img`
        . . . . f f f f f f f f f f f f f . . . .
        . . . . f 1 1 1 1 1 1 1 1 1 1 1 f . . . .
        . . . . f f f f f f f f f f f f f . . . .
        . . . . . . . f f 2 2 2 f f . . . . . . .
        . . . . . . f f 1 2 2 2 1 f f . . . . . .
        . . . . . . f 2 2 2 2 2 2 2 f . . . . . .
        . . . f f . f 2 2 2 2 2 2 2 f . f f . . .
        . . f f f f f 2 2 2 1 2 2 2 f f f f f . .
        . f f 1 f f f 2 2 2 2 2 2 2 f f f 1 f f .
        . f f f f f f 2 2 2 2 2 2 2 f f f f f f .
        . f f 1 f f f 2 2 2 1 2 2 2 f f f 1 f f .
        . f f f f f f 1 1 1 1 1 1 1 f f f f f f .
        . f f 1 f f f 1 1 1 1 1 1 1 f f f 1 f f .
        . f f f f f . f 1 1 1 1 1 f . f f f f f .
        . f f f f f . . f f f f f . . f f f f f .
        . . f f f f . . . . . . . . . f f f f . .
    `

    // MID — 15x11
    const F1_MID_A = img`
        . . . f f f f f f f f . . . .
        . . . f 1 1 1 1 1 1 f . . . .
        . . . . . f 2 2 2 f . . . . .
        . . . . f 2 1 2 1 2 f . . . .
        . . f f f 2 2 2 2 2 f f f . .
        . f f 1 f 2 2 1 2 2 f 1 f f .
        . f f f f 2 2 2 2 2 f f f f .
        . f f 1 f 1 1 1 1 1 f 1 f f .
        . f f f f 1 1 1 1 1 f f f f .
        . f f f . f 1 1 1 f . f f f .
        . . f f . . f f f . . f f . .
    `
    const F1_MID_B = img`
        . . . f f f f f f f f . . . .
        . . . f 1 1 1 1 1 1 f . . . .
        . . . . . f 2 2 2 f . . . . .
        . . . . f 2 2 1 2 2 f . . . .
        . . f f f 2 1 2 1 2 f f f . .
        . f f 1 f 2 2 2 2 2 f 1 f f .
        . f f f f 2 2 2 2 2 f f f f .
        . f f 1 f 1 1 1 1 1 f 1 f f .
        . f f f f 1 1 1 1 1 f f f f .
        . f f f . f 1 1 1 f . f f f .
        . . f f . . f f f . . f f . .
    `

    // FAR — 11x7
    const F1_FAR_A = img`
        . . f f f f f . .
        . . f 1 1 1 f . .
        . . f 2 2 2 f . .
        f f f 2 1 2 f f f
        f 1 f 2 2 2 f 1 f
        f f f 1 1 1 f f f
        . f f . . . f f .
    `
    const F1_FAR_B = img`
        . . f f f f f . .
        . . f 1 1 1 f . .
        . . f 2 2 2 f . .
        f f f 1 2 1 f f f
        f 1 f 2 2 2 f 1 f
        f f f 1 1 1 f f f
        . f f . . . f f .
    `

    // Per-player tinted copies of each size and wheel-spin frame, built lazily.
    // CAR_COLORS[p] replaces the red livery (palette 2).
    // Index: f1Sprites[player][tier 0=far/1=mid/2=near][frame 0=A/1=B].
    let f1Sprites: Image[][][] = null
    // content horizontal centre (in sprite px) per tier, so off-centre padding
    // in the literals doesn't shift the car sideways on screen.
    let f1Center: number[] = null
    let f1Bottom: number[] = null   // tyre-bottom row per tier (for planting on road)
    function contentCenter(im: Image): number {
        let lo = im.width, hi = -1
        for (let x = 0; x < im.width; x++) {
            let used = false
            for (let y = 0; y < im.height; y++) if (im.getPixel(x, y) != 0) { used = true; break }
            if (used) { if (x < lo) lo = x; hi = x }
        }
        return hi < 0 ? im.width / 2 : (lo + hi) / 2
    }
    // Lowest non-transparent row (the tyre bottom) so the car can be planted on
    // the road rather than floating above any empty rows at the sprite's base.
    function contentBottom(im: Image): number {
        for (let y = im.height - 1; y >= 0; y--)
            for (let x = 0; x < im.width; x++)
                if (im.getPixel(x, y) != 0) return y
        return im.height - 1
    }
    function buildF1Sprites() {
        f1Sprites = []
        f1Center = []
        f1Bottom = []
        // per tier: [frameA, frameB]
        const bases = [[F1_FAR_A, F1_FAR_B], [F1_MID_A, F1_MID_B], [F1_NEAR_A, F1_NEAR_B]]
        for (let s = 0; s < 3; s++) {
            f1Center.push(contentCenter(bases[s][0]))
            f1Bottom.push(contentBottom(bases[s][0]))
        }
        for (let p = 0; p < 4; p++) {
            const tiers: Image[][] = []
            for (let s = 0; s < 3; s++) {
                const frames: Image[] = []
                for (let fr = 0; fr < 2; fr++) {
                    const im = bases[s][fr].clone()
                    im.replace(2, CAR_COLORS[p])   // tint the red livery to this player's colour
                    frames.push(im)
                }
                tiers.push(frames)
            }
            f1Sprites.push(tiers)
        }
    }

    // Draw a rear-view F1 opponent centred at cx with its tyres planted at baseY,
    // sized by cw. frame (0/1) selects the wheel-spin pose. Clips to [L,R)x[T,B).
    function drawCar(target: Image, cx: number, baseY: number, cw: number, player: number, frame: number, clipL: number, clipR: number, clipT: number, clipB: number) {
        if (!f1Sprites) buildF1Sprites()
        // choose sprite tier by requested width
        const tier = cw >= 26 ? 2 : cw >= 15 ? 1 : 0
        const spr = f1Sprites[player][tier][frame & 1]
        // scale to roughly the requested width while keeping aspect
        const drawW = Math.max(4, Math.round(cw))
        const drawH = Math.round(spr.height * drawW / spr.width)
        const scale = drawW / spr.width
        // align the sprite's CONTENT centre (not its padded width) to cx
        const left = Math.round(cx - f1Center[tier] * scale)
        // plant the car: the tyre-bottom row sits exactly on baseY (the road),
        // so empty rows below the tyres in the sprite don't make it float.
        const belowTyres = (spr.height - 1 - f1Bottom[tier]) * scale
        const top = Math.round(baseY + belowTyres - drawH)
        // tight contact shadow right under the tyres (kept inside the panel)
        const shHalf = Math.round(drawW * 0.42)
        if (baseY >= clipT && baseY < clipB)
            clipH(target, cx - shHalf, cx + shHalf, baseY, 13, clipL, clipR)
        if (baseY + 1 >= clipT && baseY + 1 < clipB)
            clipH(target, cx - (shHalf >> 1), cx + (shHalf >> 1), baseY + 1, 13, clipL, clipR)
        // blit the sprite scaled, nearest-neighbour, clipped to the panel rect
        for (let px = 0; px < drawW; px++) {
            const dx = left + px
            if (dx < clipL || dx >= clipR) continue
            const sx = Math.idiv(px * spr.width, drawW)
            for (let py = 0; py < drawH; py++) {
                const dy = top + py
                if (dy < clipT || dy >= clipB) continue
                const sy = Math.idiv(py * spr.height, drawH)
                const c = spr.getPixel(sx, sy)
                if (c != 0) target.setPixel(dx, dy, c)
            }
        }
    }

    // ---------------------------------------------------------------- rendering
    function renderView(target: Image, ox: number, oy: number, vw: number, vh: number, i: number) {
        const hor = oy + Math.idiv(vh * 2, 5)
        const bot = oy + vh
        const hw = vw * 0.42
        const bendScale = vw * 0.5
        // visual lean: when steering, slide the whole road sideways a touch so
        // the turn reads as the car leaning into it (first-person "wheels turn").
        const lean = steerAng[i] * vw * 0.06
        const sky = wxSky(), grass = wxGrass(), rL = wxRoadL(), rD = wxRoadD()
        target.fillRect(ox, oy, vw, hor - oy, sky)

        for (let y = hor; y < bot; y++) {
            const t = (y - hor) / (bot - hor)
            const roadW = t * hw
            const cx = ox + (vw >> 1) + cur[i] * (1 - t) * (1 - t) * bendScale - lat[i] * roadW - lean * t
            const band = bandOf(pos[i] * 0.05 + (1 - t) * 11)
            const road = band ? rD : rL
            const rumble = band ? C_RUMBLE_A : C_RUMBLE_B
            const rw = roadW * 0.13 + 1
            target.fillRect(ox, y, vw, 1, grass)
            clipH(target, cx - roadW - rw, cx + roadW + rw, y, rumble, ox, ox + vw)
            clipH(target, cx - roadW, cx + roadW, y, road, ox, ox + vw)
            if (band == 0 && roadW > 4) clipH(target, cx - 1, cx + 1, y, C_LINE, ox, ox + vw)
        }

        // the other cars (players + CPU) by relative track position
        const see = wxSee()
        for (let j = 0; j < carCount(); j++) {
            if (j == i) continue
            let dA = (pos[j] - pos[i]) % lapLen
            if (dA < 0) dA += lapLen
            if (dA <= 2 || dA >= see) continue
            const tr = 1 - dA / see
            // road point for this distance, biased downward as the car gets
            // closer so its tyres sit on the road surface near the camera
            // instead of floating at the projected centreline.
            const roadY = hor + tr * (bot - hor)
            const yb = Math.round(roadY + tr * tr * (bot - roadY) * 0.25)
            const rwid = tr * hw
            const cxj = Math.round(ox + (vw >> 1) + cur[i] * (1 - tr) * (1 - tr) * bendScale - lat[i] * rwid - lean * tr + lat[j] * rwid + steerAng[j] * rwid * 0.25)
            const cw = Math.max(4, Math.round(tr * hw * 1.05))
            // wheel-spin frame from the car's own distance travelled, so the
            // tyres cycle as it moves (faster car => pos advances faster => the
            // frame flips more often).
            const frame = Math.floor(pos[j] * 0.6) & 1
            if (cxj + (cw >> 1) > ox && cxj - (cw >> 1) < ox + vw && yb > oy && yb <= bot)
                drawCar(target, cxj, yb, cw, j, frame, ox, ox + vw, oy, bot)
        }

        // items (oil slicks + boost tokens) projected onto the road ahead
        const myLap = ((pos[i] % lapLen) + lapLen) % lapLen
        for (const it of items) {
            if (it.taken & (1 << i)) continue
            let dI = it.d - myLap
            if (dI < 0) dI += lapLen
            if (dI <= 2 || dI >= see) continue
            const tr = 1 - dI / see
            const roadY = hor + tr * (bot - hor)
            const yI = Math.round(roadY + tr * tr * (bot - roadY) * 0.25)
            const rwid = tr * hw
            const xI = Math.round(ox + (vw >> 1) + cur[i] * (1 - tr) * (1 - tr) * bendScale - lat[i] * rwid - lean * tr + it.x * rwid)
            const sz = Math.max(2, Math.round(tr * 9))
            if (yI <= oy || yI > bot) continue
            if (it.kind == 1) {
                // boost token: yellow chevron / diamond
                for (let r = 0; r < sz; r++) {
                    const w = sz - r
                    clipH(target, xI - w, xI + w, yI - sz + r, C_YEL, ox, ox + vw)
                }
            } else {
                // oil slick: dark ellipse on the tarmac
                for (let r = 0; r < (sz >> 1) + 1; r++)
                    clipH(target, xI - sz + r, xI + sz - r, yI - r, 15, ox, ox + vw)
            }
        }

        // pit zone: a blue-striped patch on the right edge of the road ahead
        if (pitOn) {
            let dP = pitD - myLap
            if (dP < 0) dP += lapLen
            if (dP > 2 && dP < see) {
                const tr = 1 - dP / see
                const roadY = hor + tr * (bot - hor)
                const yP = Math.round(roadY + tr * tr * (bot - roadY) * 0.25)
                const rwid = tr * hw
                const xP = Math.round(ox + (vw >> 1) + cur[i] * (1 - tr) * (1 - tr) * bendScale - lat[i] * rwid - lean * tr + 0.8 * rwid)
                const pw = Math.max(2, Math.round(tr * 10))
                if (yP > oy && yP <= bot) {
                    for (let r = 0; r < pw; r++)
                        clipH(target, xP - pw + r, xP + pw - r, yP - r, ((yP + r) & 1) ? 8 : 1, ox, ox + vw)
                    if (tr > 0.4) target.print("PIT", Math.max(ox, xP - 7), yP - pw - 6, 8, image.font5)
                }
            }
        }

        // boost speed-lines: streaks from the edges when this car is boosting
        if (boosting[i] || boostFx[i] > 0) {
            const t6 = Math.floor(pos[i] * 2) & 7
            for (let s = 0; s < 4; s++) {
                const yy = oy + 6 + ((s * 13 + t6) % (vh - 8))
                clipH(target, ox + 1, ox + 6, yy, 1, ox, ox + vw)
                clipH(target, ox + vw - 6, ox + vw - 1, yy, 1, ox, ox + vw)
            }
        }

        // rain drops streaking down when it's raining (diagonal white streaks).
        // Driven by the wall clock so it keeps falling even when the car is still.
        if (weather == WX_RAIN) {
            const rt = Math.floor(clock * 40)
            for (let s = 0; s < 16; s++) {
                const rx = ox + ((s * 23 + rt * 2) % vw)
                const ry = oy + ((s * 17 + rt * 6) % (vh - 3))
                target.setPixel(rx, ry, 1)
                target.setPixel(rx + 1, ry + 1, 1)
                target.setPixel(rx + 2, ry + 2, 9)
            }
        }

        drawHud(target, ox, oy, vw, i)
        drawRearMirror(target, ox, oy, vw, i)
    }

    function drawMini(target: Image, x: number, y: number, on: boolean, col: number) {
        target.fillRect(x, y, 8, 8, on ? col : C_OFF)
        target.drawRect(x, y, 8, 8, C_PANEL)
    }
    function drawViewLights(target: Image, ox: number, oy: number, vw: number) {
        const cxv = ox + (vw >> 1)
        const ly = oy + 13
        drawMini(target, cxv - 13, ly, lightsT < 1, C_RED)
        drawMini(target, cxv - 4, ly, lightsT >= 1 && lightsT < 2, C_YEL)
        drawMini(target, cxv + 5, ly, lightsT >= 2, C_GRN)
        if (lightsT >= 2) target.print("GO!", cxv - 8, oy + 24, C_GRN, image.font5)
    }
    // Result overlay drawn on each player's view when the race is over.
    // The winner's panel celebrates in their car colour; the others show who won
    // and where they placed (by track position at the finish).
    function drawResult(target: Image, ox: number, oy: number, vw: number, vh: number, i: number) {
        const cx = ox + (vw >> 1)
        const midY = oy + (vh >> 1)
        // dim the panel so the text reads clearly
        target.fillRect(ox, oy, vw, vh, 0)
        const winCol = CAR_COLORS[winner]
        if (i == winner) {
            // winner panel: big colour banner
            target.fillRect(ox, midY - 9, vw, 18, winCol)
            target.print("P" + (winner + 1) + " WINS!", cx - 18, midY - 4, 0, image.font8)
            target.print("YOU WON", cx - 17, oy + vh - 9, winCol, image.font5)
        } else {
            // loser panel: name the winner + this player's finishing place
            let place = 1
            for (let j = 0; j < carCount(); j++) if (j != i && pos[j] > pos[i]) place++
            const suffix = place == 2 ? "nd" : place == 3 ? "rd" : "th"
            target.print("P" + (winner + 1) + " WON", cx - 16, midY - 8, winCol, image.font5)
            target.print("YOU: " + place + suffix, cx - 17, midY + 1, C_PANEL, image.font5)
        }
    }

    // Per-view HUD: lap + live position, a speed bar, and lap/best-lap times.
    function drawHud(target: Image, ox: number, oy: number, vw: number, i: number) {
        const col = CAR_COLORS[i]
        const lapNum = Math.min(Math.floor(pos[i] / lapLen) + 1, lapsToWin)
        const place = placeOf(i)
        // line 1: P# L#/total  + ordinal place
        target.fillRect(ox + 1, oy + 1, 52, 7, C_PANEL)
        target.print("P" + (i + 1) + " L" + lapNum + "/" + lapsToWin, ox + 2, oy + 1, col, image.font5)
        target.print(ordinal(place), ox + 38, oy + 1, place == 1 ? C_GRN : 1, image.font5)
        // line 2: speed bar (fraction of MAX_SPEED), framed
        const barW = Math.min(52, vw - 4)
        const sy = oy + 9
        target.drawRect(ox + 1, sy, barW, 4, C_PANEL)
        const frac = Math.max(0, Math.min(1, spd[i] / MAX_SPEED))
        const fillW = Math.round((barW - 2) * frac)
        if (fillW > 0) target.fillRect(ox + 2, sy + 1, fillW, 2, (boosting[i] || boostFx[i] > 0) ? C_GRN : frac > 0.8 ? C_RED : col)
        // boost gauge just under the speed bar (green = ready, dims as it drains)
        const by = sy + 5
        target.drawRect(ox + 1, by, barW, 3, C_PANEL)
        const bfrac = Math.max(0, Math.min(1, boost[i] / BOOST_MAX))
        const bw = Math.round((barW - 2) * bfrac)
        if (bw > 0) target.fillRect(ox + 2, by + 1, bw, 1, boosting[i] ? C_YEL : C_GRN)
        // tyre-wear gauge (only when pit stops are enabled): green->red as worn
        if (pitOn) {
            const wy = by + 4
            target.drawRect(ox + 1, wy, barW, 3, C_PANEL)
            const ww = Math.round((barW - 2) * (1 - wear[i]))   // remaining tyre life
            const wcol = wear[i] > 0.7 ? C_RED : wear[i] > 0.4 ? C_YEL : C_GRN
            if (ww > 0) target.fillRect(ox + 2, wy + 1, ww, 1, wcol)
        }
        // line 3: current lap time + best (only when room — 2-player full width)
        if (vw >= 120) {
            const ty = pitOn ? sy + 14 : sy + 10
            target.print("T " + fmtTime(lapTime[i]), ox + 2, ty, 1, image.font5)
            target.print("B " + fmtTime(bestLap[i]), ox + 2, ty + 7, C_YEL, image.font5)
        }
    }

    // Pit-stop overlay: when this player is in the box, show CHANGE TYRES and a
    // mash bar. For humans, tapping A fills it (handled via the A event below).
    function drawPit(target: Image, ox: number, oy: number, vw: number, vh: number, i: number) {
        const cx = ox + (vw >> 1), cy = oy + (vh >> 1)
        target.fillRect(ox + 6, cy - 14, vw - 12, 28, 0)
        target.drawRect(ox + 6, cy - 14, vw - 12, 28, C_YEL)
        target.print("PIT STOP!", cx - 18, cy - 11, C_YEL, image.font5)
        target.print(isCPU[i] ? "SERVICING..." : "MASH A!", cx - (isCPU[i] ? 22 : 14), cy - 2, 1, image.font5)
        // progress bar
        const bw = vw - 24
        target.drawRect(ox + 12, cy + 6, bw, 5, C_PANEL)
        const fw = Math.round((bw - 2) * Math.min(1, pitProg[i]))
        if (fw > 0) target.fillRect(ox + 13, cy + 7, fw, 3, C_GRN)
    }

    function drawRearMirror(target: Image, ox: number, oy: number, vw: number, i: number) {
        const mw = 30, mh = 12
        const mx = ox + vw - mw - 1, my = oy + 1
        target.fillRect(mx - 1, my - 1, mw + 2, mh + 2, 15)
        target.fillRect(mx, my, mw, mh, C_SKY)
        target.fillRect(mx, my + (mh >> 1), mw, mh - (mh >> 1), C_ROAD_L)
        for (let j = 0; j < carCount(); j++) {
            if (j == i) continue
            let dB = (pos[i] - pos[j]) % lapLen
            if (dB < 0) dB += lapLen
            if (dB <= 1 || dB >= 140) continue
            const near = 1 - dB / 140
            const bs = Math.max(2, Math.round(near * 7))
            let rl = lat[j] - lat[i]
            if (rl > 1) rl = 1
            if (rl < -1) rl = -1
            const bx = Math.round(mx + (mw >> 1) + rl * ((mw >> 1) - bs))
            const by = my + mh - bs - 1
            const bl = Math.max(mx, bx - (bs >> 1))
            const br = Math.min(mx + mw, bx + (bs >> 1))
            if (br > bl) target.fillRect(bl, by, br - bl, bs, CAR_COLORS[j])
        }
    }

    // ---------------------------------------------------------------- driving
    function drive(i: number, dt: number) {
        // resolve control inputs (human reads buttons; CPU is steered by AI)
        let accel = false, brake = false, st = 0, wantBoost = false
        if (isCPU[i]) {
            aiInputs(i)
            accel = aiAccel; brake = aiBrake; st = aiSteer; wantBoost = aiBoost
        } else {
            accel = ctrlFor(i).up.isPressed()
            brake = ctrlFor(i).down.isPressed()
            if (ctrlFor(i).left.isPressed()) st = -1
            else if (ctrlFor(i).right.isPressed()) st = 1
            // hold B to boost while charge remains
            wantBoost = ctrlFor(i).B.isPressed()
        }

        // spinning out from an oil slick: lose control briefly
        if (spinT[i] > 0) {
            spinT[i] -= dt
            spd[i] = Math.max(0, spd[i] - spd[i] * 2 * dt)
            steerAng[i] += (1.5 - steerAng[i]) * dt * 10   // visibly slew the wheel
            pos[i] += spd[i] * dt
            return
        }

        // --- pit stop (button-mash to change tyres) ---
        if (pitting[i]) {
            spd[i] = Math.max(0, spd[i] - spd[i] * 4 * dt)   // stopped in the box
            // mash A (CPU auto-mashes) to fill the progress bar
            const mash = isCPU[i] ? PIT_MASH * 60 * dt : 0
            pitProg[i] += mash
            if (pitProg[i] >= 1) {
                pitting[i] = false; pitProg[i] = 0; wear[i] = 0   // fresh tyres!
            }
            return
        }
        // tyres wear with distance raced; enter the pit if in the zone + press A
        wear[i] = Math.min(1, wear[i] + WEAR_RATE * dt)
        if (pitOn) {
            const lapPos = ((pos[i] % lapLen) + lapLen) % lapLen
            const curLap = Math.floor(pos[i] / lapLen)
            // wide, forgiving zone — anywhere across the road counts
            const inZone = Math.abs(lapPos - pitD) < 22
            const notPittedThisLap = !(pitDone[i] & (1 << (curLap & 7)))
            const wantPit = isCPU[i] ? (wear[i] > 0.6) : ctrlFor(i).A.isPressed()
            // store whether this player CAN pit right now (for the on-screen prompt)
            canPit[i] = inZone && notPittedThisLap
            if (inZone && wantPit && notPittedThisLap) {
                pitting[i] = true; pitProg[i] = 0
                pitDone[i] |= (1 << (curLap & 7))
                return
            }
        } else {
            canPit[i] = false
        }

        // --- boost ---
        boosting[i] = wantBoost && boost[i] > 0
        if (boosting[i]) boost[i] = Math.max(0, boost[i] - BOOST_USE * dt)
        else boost[i] = Math.min(BOOST_MAX, boost[i] + BOOST_REGEN * dt)
        if (boostFx[i] > 0) boostFx[i] -= dt   // pickup bonus decays
        // worn tyres lower top speed (boost overrides wear's speed loss)
        const wearSlow = pitOn ? (1 - WEAR_SLOW * wear[i]) : 1
        const topSpeed = (boosting[i] || boostFx[i] > 0) ? BOOST_SPEED : MAX_SPEED * wearSlow

        // --- throttle / brake ---
        if (accel) spd[i] += ACCEL * dt
        else if (brake) spd[i] -= BRAKE * dt
        else {
            if (spd[i] > 0) spd[i] = Math.max(0, spd[i] - ENGINE_BRAKE * dt)
            else if (spd[i] < 0) spd[i] = Math.min(0, spd[i] + ENGINE_BRAKE * dt)
        }
        if (boosting[i] || boostFx[i] > 0) spd[i] += ACCEL * 0.8 * dt  // boost shove
        const off = Math.abs(lat[i]) > 1
        if (off) { spd[i] -= spd[i] * 1.1 * dt; if (spd[i] > OFF_MAX) spd[i] = OFF_MAX }
        if (spd[i] > topSpeed) spd[i] = topSpeed
        if (spd[i] < -MAX_SPEED * 0.3) spd[i] = -MAX_SPEED * 0.3

        // --- steering (eased, drives both motion and the visual lean) ---
        sdisp[i] += (st - sdisp[i]) * Math.min(1, dt * 8)
        steerAng[i] += (sdisp[i] - steerAng[i]) * Math.min(1, dt * STEER_EASE)

        cur[i] += (curveAt(pos[i] + 40) - cur[i]) * Math.min(1, dt * 2.5)
        pos[i] += spd[i] * dt
        // can't reverse past the start line — clamp to the grid so laps never go negative
        if (pos[i] < 0) { pos[i] = 0; if (spd[i] < 0) spd[i] = 0 }
        // grip = weather grip, further reduced by tyre wear when pit stops are on
        const grip = wxGrip() * (pitOn ? (1 - WEAR_GRIP * wear[i]) : 1)
        const mf = (Math.abs(spd[i]) > 2 ? 1 : 0.6) * grip
        lat[i] += sdisp[i] * STEER * dt * mf
        // less grip => the bend throws you wider (centrifugal divided by grip)
        lat[i] -= cur[i] * (spd[i] / MAX_SPEED) * CENTRI * dt / grip
        if (lat[i] > 1.5) lat[i] = 1.5
        if (lat[i] < -1.5) lat[i] = -1.5

        checkItems(i)

        // tick this player's current-lap timer
        lapTime[i] += dt

        const lp = Math.floor(pos[i] / lapLen)
        if (lp > plap[i]) {
            plap[i] = lp
            for (const it of items) it.taken &= ~(1 << i)   // items respawn each lap
            // record best lap and start the next lap's timer
            if (bestLap[i] == 0 || lapTime[i] < bestLap[i]) bestLap[i] = lapTime[i]
            lapTime[i] = 0
            if (lp >= lapsToWin && !finished) {
                finished = true
                winner = i
                // final standings: all cars sorted by distance covered (desc)
                standings = []
                for (let k = 0; k < carCount(); k++) standings.push(k)
                for (let a = 0; a < standings.length; a++)
                    for (let b = a + 1; b < standings.length; b++)
                        if (pos[standings[b]] > pos[standings[a]]) {
                            const tmp = standings[a]; standings[a] = standings[b]; standings[b] = tmp
                        }
                podiumT = 0
                phase = PH_DONE
                if (finishHandler) finishHandler(winner)
            }
        }
    }

    // --- Phase 3: items (oil slicks slow/spin you; boost tokens speed you up) ---
    function checkItems(i: number) {
        const lapPos = ((pos[i] % lapLen) + lapLen) % lapLen
        for (const it of items) {
            if (it.taken & (1 << i)) continue
            if (Math.abs(lapPos - it.d) < 6 && Math.abs(lat[i] - it.x) < 0.35) {
                it.taken |= (1 << i)
                if (it.kind == 1) { boostFx[i] = 1.2 }        // boost token
                else { spinT[i] = 0.8 }                       // oil slick → spin out
            }
        }
    }

    // --- Phase 4: simple AI. Steers toward the road centre, anticipates the
    // upcoming curve, throttles full and boosts on straights. Sets the shared
    // aiAccel/aiBrake/aiSteer/aiBoost for the current car. ---
    let aiAccel = false, aiBrake = false, aiSteer = 0, aiBoost = false
    function aiInputs(i: number) {
        const bend = curveAt(pos[i] + 50)
        // aim lateral target slightly into the apex; steer to reduce error
        const targetLat = bend * 0.4
        const err = targetLat - lat[i]
        aiSteer = err > 0.08 ? 1 : err < -0.08 ? -1 : 0
        // ease off on very sharp bends, otherwise full throttle
        aiBrake = false
        aiAccel = true
        // hard difficulty: AI corners faster (lifts later) and boosts more freely
        const liftSpeed = difficulty == 1 ? 0.92 : 0.78
        const bendLimit = difficulty == 1 ? 1.3 : 1.05
        if (Math.abs(bend) > bendLimit && spd[i] > MAX_SPEED * liftSpeed) aiAccel = false
        aiBoost = Math.abs(bend) < (difficulty == 1 ? 0.45 : 0.3) && boost[i] > BOOST_MAX * (difficulty == 1 ? 0.3 : 0.5)
    }

    // ---------------------------------------------------------------- public API

    /**
     * Replace the track. curve = list of segment curvatures (+ right, - left);
     * segmentLength = world units per segment.
     */
    export function setTrack(curve: number[], segmentLength: number) {
        if (curve && curve.length > 1) trackCurve = curve
        segLen = segmentLength
        lapLen = trackCurve.length * segLen
    }

    /** Set how many laps win the race. */
    export function setLaps(laps: number) {
        lapsToWin = laps
    }

    /** Register a callback fired when a player finishes (gets the winner index 0-3). */
    export function onFinish(handler: (winnerIndex: number) => void) {
        finishHandler = handler
    }

    /** Current lap (1-based) of a player. */
    export function lapOf(playerIndex: number): number {
        return Math.min(Math.floor(pos[playerIndex] / lapLen) + 1, lapsToWin)
    }

    /**
     * Start the whole experience: player picker → start lights → split-screen
     * first-person race. Call once.
     */
    export function run(curve: number[], segmentLength: number, laps: number) {
        setTrack(curve, segmentLength)
        setLaps(laps)
        if (started) return
        started = true
        if (curve && curve.length > 1) hostCurve = curve

        // Enable MakeCode's online multiplayer hosting: referencing a
        // parts="multiplayer" method (onButtonEvent) on players 2-4 in reachable
        // code makes the compiler flag this game as multiplayer, so the player
        // icons and "Host multiplayer game" button appear when sharing. The
        // handlers are intentionally empty — driving still reads inputs via
        // isPressed() in drive(); this only flips the multiplayer flag on.
        controller.player2.onButtonEvent(ControllerButton.A, ControllerButtonEvent.Pressed, function () { })
        controller.player3.onButtonEvent(ControllerButton.A, ControllerButtonEvent.Pressed, function () { })
        controller.player4.onButtonEvent(ControllerButton.A, ControllerButtonEvent.Pressed, function () { })

        scene.setBackgroundColor(0)

        // ---- pre-game menu navigation ----
        // UP/DOWN move the cursor between setting rows; LEFT/RIGHT change the
        // highlighted value; A starts the race from any row.
        controller.player1.up.onEvent(ControllerButtonEvent.Pressed, function () {
            if (phase == PH_SELECT) menuRow = (menuRow + MENU_ROWS - 1) % MENU_ROWS
        })
        controller.player1.down.onEvent(ControllerButtonEvent.Pressed, function () {
            if (phase == PH_SELECT) menuRow = (menuRow + 1) % MENU_ROWS
        })
        controller.player1.left.onEvent(ControllerButtonEvent.Pressed, function () {
            if (phase == PH_SELECT) menuAdjust(-1)
        })
        controller.player1.right.onEvent(ControllerButtonEvent.Pressed, function () {
            if (phase == PH_SELECT) menuAdjust(1)
        })
        controller.player1.A.onEvent(ControllerButtonEvent.Pressed, function () {
            if (phase == PH_SELECT) startRace()
            else if (pitting[0]) pitProg[0] += PIT_MASH    // mash to change tyres
        })
        // A-mash during a pit stop for players 2-4
        controller.player2.A.onEvent(ControllerButtonEvent.Pressed, function () {
            if (phase == PH_RACE && pitting[1]) pitProg[1] += PIT_MASH
        })
        controller.player3.A.onEvent(ControllerButtonEvent.Pressed, function () {
            if (phase == PH_RACE && pitting[2]) pitProg[2] += PIT_MASH
        })
        controller.player4.A.onEvent(ControllerButtonEvent.Pressed, function () {
            if (phase == PH_RACE && pitting[3]) pitProg[3] += PIT_MASH
        })

        scene.createRenderable(0, function (target: Image) {
            if (phase == PH_SELECT) {
                drawMenu(target)
                return
            }
            if (phase == PH_DONE) {
                drawPodium(target)
                return
            }
            // LIGHTS or RACE: split views (+ countdown lights overlaid in LIGHTS)
            target.fill(0)
            for (let i = 0; i < numPlayers; i++) {
                let ox = 0, oy = 0, vw = 160, vh = 60
                if (numPlayers == 2) { ox = 0; vw = 160; vh = 60; oy = i * 60 }
                else { ox = (i % 2) * 80; oy = i < 2 ? 0 : 60; vw = 80; vh = 60 }
                renderView(target, ox, oy, vw, vh, i)
                if (phase == PH_LIGHTS) drawViewLights(target, ox, oy, vw)
                if (phase == PH_RACE && pitting[i]) drawPit(target, ox, oy, vw, vh, i)
                else if (phase == PH_RACE && pitOn && canPit[i] && !isCPU[i]) {
                    // flashing prompt when this player can pit
                    if ((Math.floor(pos[i] * 3) & 1) == 0) {
                        const px = ox + (vw >> 1) - 30, py = oy + vh - 16
                        target.fillRect(px, py, 62, 9, 0)
                        target.print("PRESS A: PIT", px + 2, py + 1, C_GRN, image.font5)
                    }
                }
            }
            target.fillRect(0, 59, 160, 2, 15)
            if (numPlayers > 2) target.fillRect(79, 0, 2, 120, 15)
            // weather-change banner across the centre of the screen
            if (wxAnnounce > 0 && phase == PH_RACE) {
                target.fillRect(30, 54, 100, 12, 0)
                target.drawRect(30, 54, 100, 12, C_YEL)
                target.print("WEATHER: " + WX_NAMES[weather], 36, 57, C_YEL, image.font5)
            }
        })

        game.onUpdate(function () {
            const dt = game.eventContext().deltaTime
            clock += dt   // wall clock, always advancing (rain, etc. independent of speed)
            if (phase == PH_DONE) { podiumT += dt; return }
            if (phase == PH_LIGHTS) {
                lightsT += dt
                if (lightsT >= 2.7) phase = PH_RACE
                return
            }
            if (phase != PH_RACE || finished) return
            for (let i = 0; i < numPlayers + cpuCount; i++) drive(i, dt)

            // shared dynamic weather: each time the leader completes a lap, shift
            // the weather (sun -> rain -> fog -> night -> ...) for everyone.
            if (wxAnnounce > 0) wxAnnounce -= dt
            let leadLap = 0
            for (let i = 0; i < numPlayers + cpuCount; i++)
                leadLap = Math.max(leadLap, Math.floor(pos[i] / lapLen))
            if (wxMode == 2 && leadLap > wxLastLap) {   // only in DYNAMIC mode
                wxLastLap = leadLap
                if (leadLap > 0) {           // don't change on the very first lap
                    weather = (weather + 1) % 4
                    wxAnnounce = 2.2
                }
            }
        })
    }
}
