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
// Readable settings used by the simple fpSplit API (set in your main.ts).
enum WeatherMode {
    //% block="off (always sunny)"
    Off = 0,
    //% block="always sunny"
    Sunny = 1,
    //% block="always rain"
    Rain = 2,
    //% block="always fog"
    Fog = 3,
    //% block="always night"
    Night = 4,
    //% block="dynamic (changes each lap)"
    Dynamic = 5
}
enum PitMode {
    //% block="off"
    Off = 0,
    //% block="auto"
    Auto = 1,
    //% block="manual"
    Manual = 2
}
enum RaceDifficulty {
    //% block="easy"
    Easy = 0,
    //% block="hard"
    Hard = 1
}

//% color="#d83b3b" weight=100 icon="" block="Racing"
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
    let tyre = [1, 1, 1, 1]         // current tyre compound (0 soft,1 med,2 hard)
    let pitting = [false, false, false, false]  // currently in a pit stop?
    let pitDriving = [false, false, false, false]   // driving down the pit lane (pre-menu)?
    let pitDriveT = [0, 0, 0, 0]    // pit-lane drive-in timer
    let pitChoosing = [false, false, false, false]  // in the tyre-choice menu?
    let pitSel = [1, 1, 1, 1]       // highlighted tyre in the pit menu
    let pitProg = [0, 0, 0, 0]      // pit-stop service progress 0..1
    let pitDone = [0, 0, 0, 0]      // laps on which this player has already pitted (bitmask)
    let canPit = [false, false, false, false]  // in the pit zone right now?
    let pitPenaltyShown = [0, 0, 0, 0]  // seconds left flashing the "+5s" notice

    // tyre-wear tuning
    const WEAR_RATE = 0.04           // base wear gained per second of racing
    const WEAR_SLOW = 0.35          // top-speed loss fraction at full wear
    const WEAR_GRIP = 0.4           // grip loss fraction at full wear
    const PIT_TIME = 1.6            // seconds to service tyres in the pit lane
    const PIT_PENALTY = 5          // +5s time penalty added to your lap when you pit

    // ---- tyre compounds (chosen in the pit) ----
    // 0 SOFT (fast, wears quick) · 1 MEDIUM (balanced) · 2 HARD (slow, lasts long)
    // 3 WET (great grip in rain, slow in the dry)
    const NTYRE = 4
    const TYRE_NAMES = ["SOFT", "MEDIUM", "HARD", "WET"]
    const TYRE_COL = [2, 5, 1, 8]               // red, yellow, white, blue dots
    const TYRE_WEAR_MUL = [1.7, 1.0, 0.55, 1.1] // how fast each compound wears
    const TYRE_SPEED_MUL = [1.06, 1.0, 0.95, 0.9]    // top-speed per compound (wet is slow)
    const TYRE_GRIP_MUL = [1.12, 1.0, 0.92, 0.95]    // base (dry) grip per compound

    // ---- game state ----
    const PH_TITLE = 4, PH_SELECT = 0, PH_LIGHTS = 1, PH_RACE = 2, PH_DONE = 3
    let phase = PH_TITLE          // game opens on the title splash, then the menu
    let titleT = 0                // seconds the title screen has shown
    let numPlayers = 2
    let lightsT = 0
    let finished = false
    let winner = -1
    let started = false
    let finishHandler: (winnerIndex: number) => void = null
    let startHandler: () => void = null              // onStart()
    let lapHandler: (player: number, lap: number) => void = null  // onLap()
    let standings: number[] = []     // car indices, finishing order (podium)
    let podiumT = 0                  // podium animation timer
    let builtTrack: number[] = []    // track assembled by the addX() builder calls

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
    const MENU_ROWS = 7
    let menuRow = 0
    let pitMode = 0                 // 0 OFF, 1 AUTO (pit when worn), 2 MANUAL (steer into pit lane)
    const PITMODE_NAMES = ["OFF", "AUTO", "MANUAL"]
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
        } else if (menuRow == 1) {                  // track
            selTrack = (selTrack + dir + 4) % 4
        } else if (menuRow == 2) {                  // laps 1..9
            lapsToWin = Math.max(1, Math.min(9, lapsToWin + dir))
        } else if (menuRow == 3) {                  // pit stops off/auto/manual
            pitMode = (pitMode + dir + 3) % 3
        } else if (menuRow == 4) {                  // difficulty
            difficulty = (difficulty + dir + 2) % 2
        } else if (menuRow == 5) {                  // weather: OFF, FIXED x4, DYNAMIC
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
    // Confirm the highlighted tyre in the pit menu: fit it, then start servicing.
    function confirmTyre(i: number) {
        tyre[i] = pitSel[i]
        pitChoosing[i] = false
        pitting[i] = true
        pitProg[i] = 0
    }

    function beginRaceFromMenu() {
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
            wear[k] = 0; pitting[k] = false; pitProg[k] = 0; pitDone[k] = 0; pitPenaltyShown[k] = 0
            tyre[k] = 1; pitChoosing[k] = false; pitSel[k] = 1   // start on mediums
            pitDriving[k] = false; pitDriveT[k] = 0
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
    // Opening title splash: game name + creator + school. Shows ~2 seconds.
    function drawTitle(target: Image) {
        target.fill(0)
        // sky/track stripe backdrop for flavour
        target.fillRect(0, 30, 160, 22, C_SKY)
        target.fillRect(0, 52, 160, 14, C_GRASS_L)
        // checkered band under the title
        for (let x = 0; x < 160; x += 8) target.fillRect(x, 26, 4, 3, ((x >> 3) & 1) ? 1 : 15)
        // game name (big)
        target.print("PHOTOM", 40, 34, C_YEL, image.font8)
        target.print("DRIFT", 52, 50, C_RED, image.font8)
        // a little car icon
        target.fillRect(74, 70, 12, 6, C_RED)
        target.fillRect(72, 71, 3, 4, 15)
        target.fillRect(85, 71, 3, 4, 15)
        // creator + school at the bottom
        target.print("CREATOR: ISHAN SATHAVALLI", 12, 96, 1, image.font5)
        target.print("MILLBURN MIDDLE SCHOOL", 22, 106, C_GRN, image.font5)
    }

    function drawMenu(target: Image) {
        target.fill(C_SKY)
        target.fillRect(2, 2, 156, 116, 0)
        target.print("F1 SPLIT-SCREEN RACE", 24, 4, C_YEL, image.font5)
        const wxLabel = wxMode == 1 ? WX_NAMES[wxFixed] : WXMODE_NAMES[wxMode]
        menuLine(target, 0, 16, "PLAYERS", "" + numPlayers)
        menuLine(target, 1, 28, "TRACK", TRACK_NAMES[selTrack])
        menuLine(target, 2, 40, "LAPS", "" + lapsToWin)
        menuLine(target, 3, 52, "PIT STOPS", PITMODE_NAMES[pitMode])
        menuLine(target, 4, 64, "DIFFICULTY", DIFF_NAMES[difficulty])
        menuLine(target, 5, 76, "WEATHER", wxLabel)
        const startActive = menuRow == 6
        target.fillRect(50, 90, 60, 11, startActive ? 6 : C_PANEL)
        target.print("> START <", 56, 93, startActive ? 0 : 1, image.font5)
        target.print("UP/DN MOVE  L/R CHANGE  A=GO", 4, 112, 1, image.font5)
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
            // a celebrating driver hopping on top — the winner jumps higher/faster
            const isWin = idx == 0
            const phase2 = podiumT * (isWin ? 7 : 4) + s
            const hop = Math.round((isWin ? 5 : 2) * Math.abs(Math.sin(phase2)))
            const fx = x + 6
            const fy = baseY - h - 16 - hop          // feet baseline (jumps up by hop)
            drawDriver(target, fx, fy, CAR_COLORS[car], hop > 0)
            target.print("P" + (car + 1), x + 4, fy - 8, CAR_COLORS[car], image.font5)
        }
        target.print("PRESS RESET TO RACE AGAIN", 16, 119 - 6, 13, image.font5)
    }

    // Draw a tiny celebrating racing driver: helmet (player colour), torso,
    // legs, and arms. When `up` the arms are raised in a victory pose.
    function drawDriver(target: Image, x: number, y: number, col: number, up: boolean) {
        // helmet
        target.fillRect(x + 2, y, 5, 4, col)
        target.setPixel(x + 4, y + 2, 1)             // visor glint
        // torso (white race suit with a coloured stripe)
        target.fillRect(x + 2, y + 4, 5, 6, 1)
        target.fillRect(x + 4, y + 4, 1, 6, col)
        // legs
        target.fillRect(x + 2, y + 10, 2, 4, 15)
        target.fillRect(x + 5, y + 10, 2, 4, 15)
        // arms: raised when celebrating, else down
        if (up) {
            target.fillRect(x, y + 2, 2, 4, 1); target.setPixel(x, y + 1, col)
            target.fillRect(x + 7, y + 2, 2, 4, 1); target.setPixel(x + 8, y + 1, col)
        } else {
            target.fillRect(x, y + 5, 2, 4, 1)
            target.fillRect(x + 7, y + 5, 2, 4, 1)
        }
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

        // Is the pit lane visible for this player? It runs alongside the road for
        // a stretch around pitD. pitNear = 0 outside it, ramps to 1 in the middle.
        const lapPos = ((pos[i] % lapLen) + lapLen) % lapLen
        let dPit = pitD - lapPos
        if (dPit < -lapLen / 2) dPit += lapLen
        if (dPit > lapLen / 2) dPit -= lapLen
        const pitShown = pitMode > 0 && dPit > -90 && dPit < 140
        // fade the lane in/out at its ends so it doesn't pop
        let pitNear = 0
        if (pitShown) {
            if (dPit > 110) pitNear = (140 - dPit) / 30
            else if (dPit < -60) pitNear = (dPit + 90) / 30
            else pitNear = 1
            pitNear = Math.max(0, Math.min(1, pitNear))
        }

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

            // ---- PIT LANE: a wall + a parallel lane on the RIGHT of the road ----
            if (pitNear > 0 && roadW > 1) {
                const laneW = roadW * 0.8 * pitNear         // pit lane width
                const wallW = Math.max(1, Math.round(roadW * 0.1))
                const wallX = cx + roadW + rw               // just outside the rumble
                // striped pit wall
                const wallCol = band ? 2 : 1
                clipH(target, wallX, wallX + wallW, y, wallCol, ox, ox + vw)
                // pit-lane tarmac beyond the wall (slightly darker)
                const laneL = wallX + wallW
                clipH(target, laneL, laneL + laneW, y, band ? 11 : 10, ox, ox + vw)
                // blue edge line on the far side of the pit lane
                clipH(target, laneL + laneW, laneL + laneW + 1, y, 8, ox, ox + vw)
            }
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

        const myLap = ((pos[i] % lapLen) + lapLen) % lapLen

        // PIT BOX marker on the pit lane (a yellow "PIT" garage sign at pitD)
        if (pitMode > 0) {
            let dB = pitD - myLap
            if (dB < 0) dB += lapLen
            if (dB > 2 && dB < see) {
                const tr = 1 - dB / see
                const roadY = hor + tr * (bot - hor)
                const yB = Math.round(roadY + tr * tr * (bot - roadY) * 0.25)
                const rwid = tr * hw
                // box sits in the centre of the pit lane (to the right of the road)
                const laneCx = Math.round(ox + (vw >> 1) + cur[i] * (1 - tr) * (1 - tr) * bendScale - lat[i] * rwid - lean * tr + 1.55 * rwid)
                const bw = Math.max(3, Math.round(tr * 16))
                const bh = Math.max(2, Math.round(tr * 10))
                if (yB > oy && yB <= bot && laneCx < ox + vw) {
                    // garage box
                    for (let r = 0; r < bh; r++)
                        clipH(target, laneCx - bw, laneCx + bw, yB - r, C_PANEL, ox, ox + vw)
                    target.drawRect(Math.max(ox, laneCx - bw), yB - bh, bw * 2, bh, C_YEL)
                    if (tr > 0.45) target.print("PIT", Math.max(ox, laneCx - 6), yB - bh - 6, C_YEL, image.font5)
                }
            }
        }

        // items (oil slicks + boost tokens) projected onto the road ahead
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
                drawGasPump(target, xI, yI, sz, ox, ox + vw)
            } else {
                // oil slick: dark ellipse on the tarmac
                for (let r = 0; r < (sz >> 1) + 1; r++)
                    clipH(target, xI - sz + r, xI + sz - r, yI - r, 15, ox, ox + vw)
            }
        }

        // pit lane: a blue-striped lane on the right edge of the road ahead
        if (pitMode == 2) {
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

    // Per-view HUD: lap header (top-left), labelled S/B/T bars, lap times, and
    // the live race position in the BOTTOM-RIGHT corner.
    function drawHud(target: Image, ox: number, oy: number, vw: number, i: number) {
        const col = CAR_COLORS[i]
        const lapNum = Math.min(Math.floor(pos[i] / lapLen) + 1, lapsToWin)
        const place = placeOf(i)
        // line 1: P# L#/total
        target.fillRect(ox + 1, oy + 1, 46, 7, C_PANEL)
        target.print("P" + (i + 1) + " L" + lapNum + "/" + lapsToWin, ox + 2, oy + 1, col, image.font5)
        // labelled bars: S(peed) / B(oost) / T(yres). Labels sit left of each bar.
        const lblX = ox + 2, barX = ox + 8
        const barW = Math.min(44, vw - 10)
        // S = speed
        const sy = oy + 9
        target.print("S", lblX, sy - 1, 1, image.font5)
        target.drawRect(barX, sy, barW, 4, C_PANEL)
        const frac = Math.max(0, Math.min(1, spd[i] / MAX_SPEED))
        const fillW = Math.round((barW - 2) * frac)
        if (fillW > 0) target.fillRect(barX + 1, sy + 1, fillW, 2, (boosting[i] || boostFx[i] > 0) ? C_GRN : frac > 0.8 ? C_RED : col)
        // B = boost
        const by = sy + 5
        target.print("B", lblX, by - 1, 1, image.font5)
        target.drawRect(barX, by, barW, 3, C_PANEL)
        const bfrac = Math.max(0, Math.min(1, boost[i] / BOOST_MAX))
        const bw = Math.round((barW - 2) * bfrac)
        if (bw > 0) target.fillRect(barX + 1, by + 1, bw, 1, boosting[i] ? C_YEL : C_GRN)
        // T = tyres (only when pit stops enabled)
        let nextY = by + 4
        if (pitMode > 0) {
            const wy = by + 4
            target.print("T", lblX, wy - 1, 1, image.font5)
            target.drawRect(barX, wy, barW, 3, C_PANEL)
            const ww = Math.round((barW - 2) * (1 - wear[i]))
            const wcol = wear[i] > 0.7 ? C_RED : wear[i] > 0.4 ? C_YEL : C_GRN
            if (ww > 0) target.fillRect(barX + 1, wy + 1, ww, 1, wcol)
            // current tyre-compound dot at the end of the bar
            fillDisc(target, barX + barW + 4, wy + 1, 2, TYRE_COL[tyre[i]])
            nextY = wy + 4
        }
        // current lap time stays under the bars; best lap moves to bottom-left
        if (vw >= 120) {
            target.print("LAP " + fmtTime(lapTime[i]), ox + 2, nextY, 1, image.font5)
            // BEST lap time in the bottom-left corner (wide 2-player panels only)
            target.print("BEST " + fmtTime(bestLap[i]), ox + 2, oy + 60 - 8, C_YEL, image.font5)
        }
        // PLACE indicator in the BOTTOM-RIGHT corner of this panel (panels are
        // 60px tall in both 2P and 4P layouts).
        const ord = ordinal(place)
        const pcol = place == 1 ? C_YEL : 1
        const pw = ord.length * 4 + 4
        const px = ox + vw - pw - 1, py = oy + 60 - 9
        target.fillRect(px, py, pw, 8, 0)
        target.drawRect(px, py, pw, 8, pcol)
        target.print(ord, px + 2, py + 1, pcol, image.font5)
    }

    // Tyre-choice menu shown when a player has parked in the pit box. Four tyre
    // discs (Soft/Medium/Hard/Wet); LEFT/RIGHT highlights one, A fits it.
    function drawTyreMenu(target: Image, ox: number, oy: number, vw: number, vh: number, i: number) {
        const cx = ox + (vw >> 1), cy = oy + (vh >> 1)
        target.fillRect(ox + 4, oy + 4, vw - 8, vh - 8, 0)
        target.drawRect(ox + 4, oy + 4, vw - 8, vh - 8, C_YEL)
        target.print("CHOOSE TYRES", cx - 24, oy + 7, C_YEL, image.font5)
        // four tyres spaced across the middle (tighter on narrow 4P panels)
        const gap = vw >= 120 ? 22 : 17
        const startX = cx - gap * (NTYRE - 1) / 2
        for (let t = 0; t < NTYRE; t++) {
            const tx = Math.round(startX + t * gap), ty = cy
            const sel = pitSel[i] == t
            const r = sel ? 8 : 6
            // tyre = black disc with a coloured rim showing the compound
            fillDisc(target, tx, ty, r, 15)
            fillDisc(target, tx, ty, Math.max(2, r - 2), TYRE_COL[t])
            fillDisc(target, tx, ty, 1, 15)
            if (sel) {
                target.drawRect(tx - r - 2, ty - r - 2, 2 * r + 4, 2 * r + 4, C_GRN)
                target.print(TYRE_NAMES[t], cx - TYRE_NAMES[t].length * 2, ty + r + 5, C_GRN, image.font5)
                const arrowY = ty - r - 6 - (Math.floor(clock * 6) & 1)
                target.print("v", tx - 1, arrowY, C_GRN, image.font5)
            }
        }
        // hint — suggest WET when it's raining
        if (isCPU[i]) target.print("FITTING...", cx - 18, oy + vh - 8, 1, image.font5)
        else if (weather == WX_RAIN) target.print("RAIN! TRY WET", cx - 26, oy + vh - 8, 8, image.font5)
        else target.print("L/R PICK  A FIT", cx - 26, oy + vh - 8, 1, image.font5)
    }

    // Animated F1 pit-stop scene, staged by pitProg (0..1):
    //   .00-.18 car drives in   .18-.30 jacks lift   .30-.70 wheel change
    //   .70-.82 jacks drop      .82-1.0 lollipop GO + launch out
    // `clock` drives the fast impact-wrench flicker and crew motion.
    function drawPit(target: Image, ox: number, oy: number, vw: number, vh: number, i: number) {
        const cx = ox + (vw >> 1)
        const groundY = oy + vh - 12       // tarmac line the wheels rest on
        const col = CAR_COLORS[i]
        const p = Math.min(1, pitProg[i])
        const flick = Math.floor(clock * 22) & 1          // impact-wrench flicker
        const bob = Math.floor(clock * 6) & 1             // crew bob

        // garage backdrop (dark) with a yellow header
        target.fillRect(ox + 3, oy + 3, vw - 6, vh - 6, 0)
        target.fillRect(ox + 3, oy + 3, vw - 6, 9, C_PANEL)
        target.print("PIT STOP", cx - 16, oy + 4, C_YEL, image.font5)
        // floor line
        clipH(target, ox + 3, ox + vw - 3, groundY + 7, C_PANEL, ox, ox + vw)

        // --- car horizontal position: drive in, hold, launch out ---
        let carDX = 0
        if (p < 0.18) carDX = Math.round((0.18 - p) / 0.18 * -(vw))      // enters from left
        else if (p > 0.85) carDX = Math.round((p - 0.85) / 0.15 * (vw))  // launches right
        const cxx = cx + carDX

        // --- jack lift: car body rises a few px while jacked ---
        const jacked = p >= 0.18 && p <= 0.82
        const lift = jacked ? 4 : 0
        const bodyY = groundY - 6 - lift

        // wheels (4) — side view: two visible, front + rear
        const swapping = p > 0.30 && p < 0.70
        const wheelOff = swapping && flick
        const newWheel = swapping && p > 0.5
        const wheelR = 3
        const frontWX = cxx + 9, rearWX = cxx - 9

        // --- car body (side profile) in player colour ---
        // floor pan
        target.fillRect(cxx - 13, bodyY + 4, 26, 3, col)
        // sidepod / chassis
        target.fillRect(cxx - 9, bodyY, 18, 5, col)
        // nose (front, right)
        target.fillRect(cxx + 9, bodyY + 2, 6, 3, col)
        target.fillRect(cxx + 14, bodyY + 3, 2, 2, col)
        // airbox + halo over the cockpit
        target.fillRect(cxx - 3, bodyY - 3, 5, 3, col)
        target.fillRect(cxx - 4, bodyY - 1, 7, 1, 15)     // halo bar
        // rear wing (left)
        target.fillRect(cxx - 15, bodyY - 2, 2, 6, 15)
        target.fillRect(cxx - 15, bodyY - 2, 5, 1, col)
        // driver helmet in the cockpit
        target.fillRect(cxx - 2, bodyY - 2, 3, 2, 1)
        // two visible wheels (front & rear), inlined for both positions
        for (let wn = 0; wn < 2; wn++) {
            const wxc = wn == 0 ? frontWX : rearWX
            if (wheelOff) {
                // old wheel rolled away to the side during the swap
                const roll = cxx - 20 - Math.floor((p - 0.30) * 30)
                fillDisc(target, roll, groundY + 1, wheelR, 15)
            } else {
                fillDisc(target, wxc, groundY + 1 - lift, wheelR, 15)
                target.setPixel(wxc, groundY + 1 - lift, newWheel ? C_RED : C_YEL)   // hub
                if (swapping && flick) target.setPixel(wxc + (bob ? 2 : -2), groundY - 1 - lift, C_YEL)
            }
        }

        // --- jacks (front & rear) wedge under the car while lifted ---
        if (jacked) {
            target.fillRect(cxx + 15, bodyY + 4, 2, lift + 3, C_YEL)   // front jack arm
            target.fillRect(cxx - 17, bodyY + 4, 2, lift + 3, C_YEL)   // rear jack arm
        }

        // --- crew: 2 gunners (front/rear wheel) + 2 jack men + lollipop ---
        if (p >= 0.15 && p <= 0.86) {
            const arm = swapping ? flick : 0
            drawCrew(target, frontWX - 7, groundY - 7 + (bob ? 0 : 1), col, arm)   // front gunner
            drawCrew(target, rearWX + 2, groundY - 7 + (bob ? 1 : 0), col, swapping ? (1 - flick) : 0)  // rear gunner
            drawCrew(target, cxx + 17, bodyY - 4, col, 0)     // front jack man
            drawCrew(target, cxx - 22, bodyY - 4, col, 0)     // rear jack man
        }
        // lollipop man out front: red STOP, then green GO at the end
        const lolly = p > 0.82
        target.fillRect(cxx + 20, bodyY - 10, 1, 12, 15)
        fillDisc(target, cxx + 20, bodyY - 11, 2, lolly ? C_GRN : C_RED)

        // fresh-tyre stack in the corner
        fillDisc(target, ox + 9, groundY + 2, 2, 15)
        fillDisc(target, ox + 9, groundY - 2, 2, 15)

        // status text
        const msg = p < 0.18 ? "CAR IN..." : p > 0.82 ? "GO GO GO!" : "CHANGING TYRES"
        target.print(msg, cx - msg.length * 2, oy + vh - 6, p > 0.82 ? C_GRN : 1, image.font5)
        // "+5s" penalty notice top-right of the box
        target.print("+5s", ox + vw - 16, oy + 5, C_RED, image.font5)
    }
    // Draw a fuel pump (boost pickup) standing on the road, base at (bx, byBase),
    // scaled by sz. Red body + light-blue screen with dark bars + grey nozzle/hose,
    // matching a classic gas-pump icon. Clipped to [clipL, clipR).
    function drawGasPump(target: Image, bx: number, byBase: number, sz: number, clipL: number, clipR: number) {
        const w = Math.max(3, Math.round(sz * 1.2))   // body half-width
        const h = Math.max(6, sz * 2 + 2)             // body height
        const top = byBase - h
        const GREY = 13, RED = C_RED, SCREEN = 9, DARK = 15
        // pump body (red)
        for (let yy = 0; yy < h; yy++)
            clipH(target, bx - w, bx + w, top + yy, RED, clipL, clipR)
        // base foot (grey)
        clipH(target, bx - w - 1, bx + w + 1, byBase, GREY, clipL, clipR)
        if (sz >= 4) {
            // blue display screen in the upper body
            const scTop = top + 1, scBot = top + Math.max(2, Math.idiv(h, 2))
            for (let yy = scTop; yy < scBot; yy++)
                clipH(target, bx - w + 1, bx + w - 1, yy, SCREEN, clipL, clipR)
            // two dark display bars
            const midX = bx - 1
            clipH(target, bx - w + 2, midX, scTop + 1, DARK, clipL, clipR)
            if (scBot - scTop >= 4) clipH(target, bx - w + 2, midX, scTop + 3, DARK, clipL, clipR)
            // grey nozzle + hose on the right side
            clipH(target, bx + w, bx + w + 2, top + 2, GREY, clipL, clipR)        // nozzle head
            target.setPixel(bx + w + 2, top + 3, GREY)
            for (let yy = top + 3; yy < byBase - 2; yy++)                         // hose curving down
                target.setPixel(bx + w + 1 + ((yy & 2) ? 1 : 0), yy, GREY)
        }
    }

    // Small filled disc (MakeCode Image has no fillCircle).
    function fillDisc(target: Image, cx: number, cy: number, r: number, c: number) {
        for (let dy = -r; dy <= r; dy++) {
            const w = Math.round(Math.sqrt(r * r - dy * dy))
            target.fillRect(cx - w, cy + dy, 2 * w + 1, 1, c)
        }
    }
    // A pit-crew member: helmet (team red), torso, legs, and a wrench/gun arm
    // that pumps with `arm` (0/1). Stands facing the car.
    function drawCrew(target: Image, x: number, y: number, teamCol: number, arm: number) {
        target.fillRect(x + 1, y, 3, 2, C_RED)        // red team helmet
        target.fillRect(x + 1, y + 2, 3, 3, 1)        // white torso
        target.setPixel(x + 2, y + 3, teamCol)        // team-colour badge
        target.fillRect(x + 1, y + 5, 1, 2, 15)       // legs
        target.fillRect(x + 3, y + 5, 1, 2, 15)
        // wheel-gun arm pumping toward the car
        target.fillRect(x + 4, y + 2 + arm, 2, 1, C_YEL)
        target.setPixel(x + 6, y + 2 + arm, 15)
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

        // --- pit: DRIVE-IN (peel off onto the pit lane, then park) ---
        if (pitDriving[i]) {
            pitDriveT[i] += dt
            // crawl forward at the pit limiter while sliding into the lane
            spd[i] = Math.min(spd[i] + ACCEL * dt, MAX_SPEED * 0.3)
            // slowing to a stop over the last third of the drive-in
            if (pitDriveT[i] > 0.9) spd[i] = Math.max(0, spd[i] - spd[i] * 4 * dt)
            pos[i] += spd[i] * dt
            lat[i] += (1.55 - lat[i]) * Math.min(1, dt * 4)   // ease over to the pit lane
            steerAng[i] = 0.6                                  // wheels turned into the lane
            if (pitDriveT[i] >= 1.3) {                         // arrived → open tyre menu
                pitDriving[i] = false
                pitChoosing[i] = true; pitProg[i] = 0; pitSel[i] = tyre[i]
            }
            return
        }

        // --- pit: TYRE CHOICE (car parked in the box, menu shown) ---
        if (pitChoosing[i]) {
            spd[i] = Math.max(0, spd[i] - spd[i] * 5 * dt)   // brake to a stop
            lat[i] = 1.55
            if (isCPU[i]) {
                // CPU: WET in the rain, else by laps remaining (soft late, hard early)
                const lapsLeft = lapsToWin - Math.floor(pos[i] / lapLen)
                pitSel[i] = weather == WX_RAIN ? 3 : lapsLeft <= 1 ? 0 : lapsLeft >= 3 ? 2 : 1
                // confirm shortly after arriving
                pitProg[i] += dt
                if (pitProg[i] > 0.5) confirmTyre(i)
            }
            // (human confirms via the A-button handler -> confirmTyre)
            return
        }
        // --- pit SERVICING: crawl through the lane while tyres are fitted ---
        if (pitting[i]) {
            spd[i] = Math.min(spd[i] + ACCEL * dt, MAX_SPEED * 0.22)
            pos[i] += spd[i] * dt
            lat[i] = 1.55
            pitProg[i] += dt / PIT_TIME
            if (pitProg[i] >= 1) {
                pitting[i] = false; pitProg[i] = 0; wear[i] = 0   // fresh tyres, rejoin
                lat[i] = 0.6
            }
            return
        }
        // tyres wear with distance raced (faster on soft, slower on hard)
        wear[i] = Math.min(1, wear[i] + WEAR_RATE * TYRE_WEAR_MUL[tyre[i]] * dt)
        if (pitMode > 0) {
            const lapPos = ((pos[i] % lapLen) + lapLen) % lapLen
            const curLap = Math.floor(pos[i] / lapLen)
            const inZone = Math.abs(lapPos - pitD) < 24
            const notPittedThisLap = !(pitDone[i] & (1 << (curLap & 7)))
            canPit[i] = inZone && notPittedThisLap
            let enter = false
            if (notPittedThisLap && inZone) {
                if (pitMode == 1) enter = wear[i] > 0.8           // AUTO: only when really worn
                else enter = isCPU[i] ? wear[i] > 0.8 : lat[i] > 0.7   // MANUAL: steer right
            }
            if (enter) {
                // begin the visible drive-in down the pit lane (then the menu)
                pitDriving[i] = true; pitDriveT[i] = 0
                pitDone[i] |= (1 << (curLap & 7))
                lapTime[i] += PIT_PENALTY               // pitting costs time (strategy)
                pitPenaltyShown[i] = 1.8
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
        // worn tyres lower top speed; the chosen compound also tweaks top speed
        const tyreSpd = pitMode > 0 ? TYRE_SPEED_MUL[tyre[i]] : 1
        const wearSlow = pitMode > 0 ? (1 - WEAR_SLOW * wear[i]) : 1
        const topSpeed = (boosting[i] || boostFx[i] > 0) ? BOOST_SPEED : MAX_SPEED * wearSlow * tyreSpd

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
        // grip = weather grip, reduced by wear, scaled by the chosen compound
        // WET tyres claw back most of the rain grip loss; dry tyres suffer in rain.
        let tyreGrip = TYRE_GRIP_MUL[tyre[i]]
        if (pitMode > 0 && tyre[i] == 3 && weather == WX_RAIN) tyreGrip = 1.5   // wet in rain = great
        const grip = wxGrip() * (pitMode > 0 ? (1 - WEAR_GRIP * wear[i]) * tyreGrip : 1)
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
            // onLap(player 1-4, lap number) — only for human players, capped at lapsToWin
            if (lapHandler && i < numPlayers) lapHandler(i + 1, Math.min(lp + 1, lapsToWin))
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

    /** Register a callback fired when a player finishes (gets the winner index 0-3).
     * (Low-level; onWin() gives a friendlier 1-based player number.) */
    export function onFinish(handler: (winnerIndex: number) => void) {
        finishHandler = handler
    }

    /** Current lap (1-based) of a player. */
    export function lapOf(playerIndex: number): number {
        return Math.min(Math.floor(pos[playerIndex] / lapLen) + 1, lapsToWin)
    }

    // ============================================================ simple API
    // These set the DEFAULTS shown on the in-game setup menu. Players can still
    // change them on the menu before the race starts. Call them in your main.ts
    // before startRace(), e.g.  fpSplit.setLaps(3).

    /** Set the default number of laps (1–9). */
    //% blockId=fpsplit_set_laps block="set laps to %laps"
    //% laps.min=1 laps.max=9 laps.defl=3
    export function setLaps(laps: number) {
        lapsToWin = Math.max(1, Math.min(9, laps))
    }

    /** Set the default weather. */
    //% blockId=fpsplit_set_weather block="set weather to %mode"
    export function setWeather(mode: WeatherMode) {
        if (mode == WeatherMode.Off) { wxMode = 0 }
        else if (mode == WeatherMode.Dynamic) { wxMode = 2 }
        else { wxMode = 1; wxFixed = mode - 1 }   // Sunny..Night -> wxFixed 0..3
    }

    /** Set the default pit-stop mode. */
    //% blockId=fpsplit_set_pit block="set pit stops to %mode"
    export function setPitStops(mode: PitMode) {
        pitMode = mode
    }

    /** Set the default CPU difficulty. */
    //% blockId=fpsplit_set_diff block="set difficulty to %level"
    export function setDifficulty(level: RaceDifficulty) {
        difficulty = level
    }

    /** Set how many players race (2–4). */
    //% blockId=fpsplit_set_players block="set players to %count"
    //% count.min=2 count.max=4 count.defl=2
    export function setPlayers(count: number) {
        numPlayers = Math.max(2, Math.min(4, count))
    }


    /** Run a function when a player wins (gets the winning player number 1–4). */
    //% blockId=fpsplit_on_win block="on player win $winner"
    //% draggableParameters
    export function onWin(handler: (winner: number) => void) {
        finishHandler = function (idx: number) { handler(idx + 1) }
    }

    /** Run a function when the race starts (after the lights go green). */
    //% blockId=fpsplit_on_start block="on race start"
    export function onStart(handler: () => void) {
        startHandler = handler
    }

    /** Run a function each time a player completes a lap (player 1–4, lap number). */
    //% blockId=fpsplit_on_lap block="on player $player completes lap $lap"
    //% draggableParameters
    export function onLap(handler: (player: number, lap: number) => void) {
        lapHandler = handler
    }

    /** The race position of a player (1 = leading). Player number is 1–4. */
    //% blockId=fpsplit_get_place block="place of player %player"
    //% player.min=1 player.max=4
    export function getPlace(player: number): number {
        return placeOf(player - 1)
    }

    /** The current lap (1-based) of a player. Player number is 1–4. */
    //% blockId=fpsplit_get_lap block="lap of player %player"
    //% player.min=1 player.max=4
    export function getLap(player: number): number {
        return lapOf(player - 1)
    }

    // ----------------------------------------------- readable track builder
    // Build a track piece by piece, then startRace() with no argument uses it.
    // Curvature: + turns right, - turns left, 0 is straight.

    /** Start a fresh, empty track (call before adding pieces). */
    //% blockId=fpsplit_new_track block="new track"
    export function newTrack() {
        builtTrack = []
    }
    function pushSegs(curve: number, count: number) {
        for (let k = 0; k < count; k++) builtTrack.push(curve)
    }
    /** Add a straight section (length = how many segments). */
    //% blockId=fpsplit_add_straight block="add straight length %length"
    //% length.min=1 length.defl=3
    export function addStraight(length: number) {
        pushSegs(0, Math.max(1, length))
    }
    /** Add a right-hand turn (length = how many segments). */
    //% blockId=fpsplit_add_right block="add right turn length %length"
    //% length.min=1 length.defl=2
    export function addRightTurn(length: number) {
        pushSegs(0.7, Math.max(1, length))
    }
    /** Add a left-hand turn (length = how many segments). */
    //% blockId=fpsplit_add_left block="add left turn length %length"
    //% length.min=1 length.defl=2
    export function addLeftTurn(length: number) {
        pushSegs(-0.7, Math.max(1, length))
    }
    /** Add a sharp hairpin bend. */
    //% blockId=fpsplit_add_hairpin block="add hairpin"
    export function addHairpin() {
        builtTrack.push(1.4); builtTrack.push(1.7); builtTrack.push(1.5)
    }
    /** Add a quick left-right chicane. */
    //% blockId=fpsplit_add_chicane block="add chicane"
    export function addChicane() {
        builtTrack.push(0.8); builtTrack.push(-0.8)
    }

    /**
     * Start the race. Pass a track (list of corners), or pass an empty list []
     * to use the track you built with the addStraight/addRightTurn/... calls.
     * Shows the setup menu (pre-filled with your defaults), lights, then race.
     */
    //% blockId=fpsplit_start block="start race on track %track"
    export function startRace(track: number[]) {
        const t = (track && track.length > 1) ? track : builtTrack
        run(t, 46, lapsToWin)
    }

    /** Start the race using the track you built with the add... calls. */
    //% blockId=fpsplit_start_built block="start race"
    export function startBuiltRace() {
        run(builtTrack, 46, lapsToWin)
    }

    /**
     * Start the whole experience: player picker → start lights → split-screen
     * first-person race. Call once. (Low-level; startRace() is simpler.)
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
            else if (pitChoosing[0]) pitSel[0] = (pitSel[0] + NTYRE - 1) % NTYRE   // pick tyre
        })
        controller.player1.right.onEvent(ControllerButtonEvent.Pressed, function () {
            if (phase == PH_SELECT) menuAdjust(1)
            else if (pitChoosing[0]) pitSel[0] = (pitSel[0] + 1) % NTYRE
        })
        controller.player1.A.onEvent(ControllerButtonEvent.Pressed, function () {
            if (phase == PH_SELECT) beginRaceFromMenu()
            else if (pitChoosing[0]) confirmTyre(0)
        })
        // players 2-4: tyre menu (left/right pick, A confirm). Also keeps the
        // multiplayer host button enabled via player2-4 event references.
        controller.player2.left.onEvent(ControllerButtonEvent.Pressed, function () { if (pitChoosing[1]) pitSel[1] = (pitSel[1] + NTYRE - 1) % NTYRE })
        controller.player2.right.onEvent(ControllerButtonEvent.Pressed, function () { if (pitChoosing[1]) pitSel[1] = (pitSel[1] + 1) % NTYRE })
        controller.player2.A.onEvent(ControllerButtonEvent.Pressed, function () { if (pitChoosing[1]) confirmTyre(1) })
        controller.player3.left.onEvent(ControllerButtonEvent.Pressed, function () { if (pitChoosing[2]) pitSel[2] = (pitSel[2] + NTYRE - 1) % NTYRE })
        controller.player3.right.onEvent(ControllerButtonEvent.Pressed, function () { if (pitChoosing[2]) pitSel[2] = (pitSel[2] + 1) % NTYRE })
        controller.player3.A.onEvent(ControllerButtonEvent.Pressed, function () { if (pitChoosing[2]) confirmTyre(2) })
        controller.player4.left.onEvent(ControllerButtonEvent.Pressed, function () { if (pitChoosing[3]) pitSel[3] = (pitSel[3] + NTYRE - 1) % NTYRE })
        controller.player4.right.onEvent(ControllerButtonEvent.Pressed, function () { if (pitChoosing[3]) pitSel[3] = (pitSel[3] + 1) % NTYRE })
        controller.player4.A.onEvent(ControllerButtonEvent.Pressed, function () { if (pitChoosing[3]) confirmTyre(3) })

        scene.createRenderable(0, function (target: Image) {
            if (phase == PH_TITLE) {
                drawTitle(target)
                return
            }
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
                if (phase == PH_RACE && pitDriving[i]) {
                    // banner while peeling into the pit lane
                    const bx = ox + (vw >> 1) - 32, by2 = oy + 12
                    target.fillRect(bx, by2, 66, 9, 0)
                    target.print("ENTERING PITS", bx + 2, by2 + 1, 8, image.font5)
                }
                else if (phase == PH_RACE && pitChoosing[i]) drawTyreMenu(target, ox, oy, vw, vh, i)
                else if (phase == PH_RACE && pitting[i]) drawPit(target, ox, oy, vw, vh, i)
                else if (phase == PH_RACE && pitMode == 2 && canPit[i] && !isCPU[i]) {
                    // MANUAL: flashing prompt to steer into the pit lane on the right
                    if ((Math.floor(clock * 3) & 1) == 0) {
                        const px = ox + (vw >> 1) - 38, py = oy + vh - 16
                        target.fillRect(px, py, 78, 9, 0)
                        target.print(">> INTO PIT LANE", px + 2, py + 1, 8, image.font5)
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
            if (phase == PH_TITLE) {           // title splash for 2 seconds, then menu
                titleT += dt
                if (titleT >= 2) phase = PH_SELECT
                return
            }
            if (phase == PH_SELECT) return   // menu waits for the player to press A
            if (phase == PH_DONE) { podiumT += dt; return }
            if (phase == PH_LIGHTS) {
                lightsT += dt
                if (lightsT >= 2.7) {
                    phase = PH_RACE
                    if (startHandler) startHandler()      // onStart()
                }
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
