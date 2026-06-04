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
    const CAR_COLORS = [2, 4, 8, 5]      // P1 red, P2 orange, P3 blue, P4 yellow

    // ---- physics ----
    const MAX_SPEED = 64, ACCEL = 42, BRAKE = 80, ENGINE_BRAKE = 16, OFF_MAX = 24
    const STEER = 2.0, CENTRI = 2.4
    const SEE = 240                      // metres of road visible ahead

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

    // ---- game state ----
    const PH_SELECT = 0, PH_LIGHTS = 1, PH_RACE = 2, PH_DONE = 3
    let phase = PH_SELECT
    let numPlayers = 2
    let lightsT = 0
    let finished = false
    let winner = -1
    let started = false
    let finishHandler: (winnerIndex: number) => void = null

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

    // Draw a rear-view car centred horizontally at cx with its base (bottom of
    // the wheels) at baseY. Scales with cw/ch so it reads as a car at any
    // distance: tyres, a lower body in the car colour, a tapered cabin/roof,
    // a dark rear window and two red tail-lights. Clipped to [clipL, clipR).
    function drawCar(target: Image, cx: number, baseY: number, cw: number, ch: number, col: number, clipL: number, clipR: number) {
        const half = cw >> 1
        const bodyH = Math.max(1, Math.round(ch * 0.55))   // lower body height
        const roofH = ch - bodyH                            // cabin height
        const wheelH = Math.max(1, Math.round(ch * 0.28))
        const bodyTop = baseY - bodyH
        const roofTop = bodyTop - roofH
        const roofInset = Math.max(1, Math.round(cw * 0.18))

        // ground shadow
        clipH(target, cx - half - 1, cx + half + 1, baseY, 13, clipL, clipR)
        // tyres (dark) sitting at the outer base corners
        for (let wy = 0; wy < wheelH; wy++) {
            clipH(target, cx - half, cx - half + Math.max(1, Math.idiv(cw, 4)), baseY - 1 - wy, 15, clipL, clipR)
            clipH(target, cx + half - Math.max(1, Math.idiv(cw, 4)), cx + half, baseY - 1 - wy, 15, clipL, clipR)
        }
        // lower body in the player colour
        for (let by = bodyTop; by < baseY - (wheelH >> 1); by++)
            clipH(target, cx - half, cx + half, by, col, clipL, clipR)
        // tapered cabin / roof, slightly narrower
        for (let ry = roofTop; ry < bodyTop; ry++)
            clipH(target, cx - half + roofInset, cx + half - roofInset, ry, col, clipL, clipR)
        // dark rear window across the cabin
        if (roofH >= 3)
            clipH(target, cx - half + roofInset, cx + half - roofInset, roofTop + 1, 15, clipL, clipR)
        // red tail-lights at the lower corners (only when big enough to show)
        if (cw >= 8) {
            const ll = Math.max(1, Math.idiv(cw, 6))
            clipH(target, cx - half, cx - half + ll, bodyTop + 1, C_RED, clipL, clipR)
            clipH(target, cx + half - ll, cx + half, bodyTop + 1, C_RED, clipL, clipR)
        }
    }

    // ---------------------------------------------------------------- rendering
    function renderView(target: Image, ox: number, oy: number, vw: number, vh: number, i: number) {
        const hor = oy + Math.idiv(vh * 2, 5)
        const bot = oy + vh
        const hw = vw * 0.42
        const bendScale = vw * 0.5
        target.fillRect(ox, oy, vw, hor - oy, C_SKY)

        for (let y = hor; y < bot; y++) {
            const t = (y - hor) / (bot - hor)
            const roadW = t * hw
            const cx = ox + (vw >> 1) + cur[i] * (1 - t) * (1 - t) * bendScale - lat[i] * roadW
            const band = bandOf(pos[i] * 0.05 + (1 - t) * 11)
            const road = band ? C_ROAD_D : C_ROAD_L
            const rumble = band ? C_RUMBLE_A : C_RUMBLE_B
            const rw = roadW * 0.13 + 1
            target.fillRect(ox, y, vw, 1, C_GRASS_L)
            clipH(target, cx - roadW - rw, cx + roadW + rw, y, rumble, ox, ox + vw)
            clipH(target, cx - roadW, cx + roadW, y, road, ox, ox + vw)
            if (band == 0 && roadW > 4) clipH(target, cx - 1, cx + 1, y, C_LINE, ox, ox + vw)
        }

        // the other players, as cars by relative track position
        for (let j = 0; j < numPlayers; j++) {
            if (j == i) continue
            let dA = (pos[j] - pos[i]) % lapLen
            if (dA < 0) dA += lapLen
            if (dA <= 2 || dA >= SEE) continue
            const tr = 1 - dA / SEE
            const yb = Math.round(hor + tr * (bot - hor))
            const rwid = tr * hw
            const cxj = Math.round(ox + (vw >> 1) + cur[i] * (1 - tr) * (1 - tr) * bendScale - lat[i] * rwid + lat[j] * rwid)
            const cw = Math.max(3, Math.round(tr * hw * 0.95))
            const ch = Math.max(2, Math.round(cw * 0.7))
            if (cxj - (cw >> 1) < ox + vw && cxj + (cw >> 1) > ox && yb - ch >= oy && yb <= bot)
                drawCar(target, cxj, yb, cw, ch, CAR_COLORS[j], ox, ox + vw)
        }

        // lap label
        const lapNum = Math.min(Math.floor(pos[i] / lapLen) + 1, lapsToWin)
        target.fillRect(ox + 1, oy + 1, 38, 8, C_PANEL)
        target.print("P" + (i + 1) + " L" + lapNum, ox + 3, oy + 2, CAR_COLORS[i], image.font5)

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
            for (let j = 0; j < numPlayers; j++) if (j != i && pos[j] > pos[i]) place++
            const suffix = place == 2 ? "nd" : place == 3 ? "rd" : "th"
            target.print("P" + (winner + 1) + " WON", cx - 16, midY - 8, winCol, image.font5)
            target.print("YOU: " + place + suffix, cx - 17, midY + 1, C_PANEL, image.font5)
        }
    }

    function drawRearMirror(target: Image, ox: number, oy: number, vw: number, i: number) {
        const mw = 30, mh = 12
        const mx = ox + vw - mw - 1, my = oy + 1
        target.fillRect(mx - 1, my - 1, mw + 2, mh + 2, 15)
        target.fillRect(mx, my, mw, mh, C_SKY)
        target.fillRect(mx, my + (mh >> 1), mw, mh - (mh >> 1), C_ROAD_L)
        for (let j = 0; j < numPlayers; j++) {
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
        if (ctrlFor(i).up.isPressed()) spd[i] += ACCEL * dt
        else if (ctrlFor(i).down.isPressed()) spd[i] -= BRAKE * dt
        else {
            if (spd[i] > 0) spd[i] = Math.max(0, spd[i] - ENGINE_BRAKE * dt)
            else if (spd[i] < 0) spd[i] = Math.min(0, spd[i] + ENGINE_BRAKE * dt)
        }
        const off = Math.abs(lat[i]) > 1
        if (off) { spd[i] -= spd[i] * 1.1 * dt; if (spd[i] > OFF_MAX) spd[i] = OFF_MAX }
        if (spd[i] > MAX_SPEED) spd[i] = MAX_SPEED
        if (spd[i] < -MAX_SPEED * 0.3) spd[i] = -MAX_SPEED * 0.3

        let st = 0
        if (ctrlFor(i).left.isPressed()) st = -1
        else if (ctrlFor(i).right.isPressed()) st = 1
        sdisp[i] += (st - sdisp[i]) * Math.min(1, dt * 8)

        cur[i] += (curveAt(pos[i] + 40) - cur[i]) * Math.min(1, dt * 2.5)
        pos[i] += spd[i] * dt
        const mf = Math.abs(spd[i]) > 2 ? 1 : 0.6
        lat[i] += sdisp[i] * STEER * dt * mf
        lat[i] -= cur[i] * (spd[i] / MAX_SPEED) * CENTRI * dt
        if (lat[i] > 1.5) lat[i] = 1.5
        if (lat[i] < -1.5) lat[i] = -1.5

        const lp = Math.floor(pos[i] / lapLen)
        if (lp > plap[i]) {
            plap[i] = lp
            if (lp >= lapsToWin && !finished) {
                finished = true
                winner = i
                phase = PH_DONE
                if (finishHandler) finishHandler(winner)
            }
        }
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

        controller.player1.up.onEvent(ControllerButtonEvent.Pressed, function () {
            if (phase == PH_SELECT) numPlayers = Math.min(4, numPlayers + 1)
        })
        controller.player1.down.onEvent(ControllerButtonEvent.Pressed, function () {
            if (phase == PH_SELECT) numPlayers = Math.max(2, numPlayers - 1)
        })
        controller.player1.A.onEvent(ControllerButtonEvent.Pressed, function () {
            if (phase == PH_SELECT) { phase = PH_LIGHTS; lightsT = 0 }
        })

        scene.createRenderable(0, function (target: Image) {
            if (phase == PH_SELECT) {
                target.fill(C_GRASS_L)
                target.fillRect(4, 24, 152, 74, C_PANEL)
                target.print("FIRST-PERSON SPLIT", 26, 28, 1, image.font5)
                target.print("PLAYERS: " + numPlayers, 44, 44, 1, image.font8)
                target.print("IS EVERYBODY READY?", 24, 62, 1, image.font5)
                target.print("UP/DOWN to change", 30, 74, C_YEL, image.font5)
                target.print("A = START", 54, 84, C_GRN, image.font5)
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
                if (phase == PH_DONE) drawResult(target, ox, oy, vw, vh, i)
            }
            target.fillRect(0, 59, 160, 2, 15)
            if (numPlayers > 2) target.fillRect(79, 0, 2, 120, 15)
        })

        game.onUpdate(function () {
            const dt = game.eventContext().deltaTime
            if (phase == PH_LIGHTS) {
                lightsT += dt
                if (lightsT >= 2.7) phase = PH_RACE
                return
            }
            if (phase != PH_RACE || finished) return
            for (let i = 0; i < numPlayers; i++) drive(i, dt)
        })
    }
}
