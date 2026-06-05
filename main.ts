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
    let lapTime = [0, 0, 0, 0]      // seconds elapsed on the current lap
    let bestLap = [0, 0, 0, 0]      // best lap time so far (0 = none yet)

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
    // Live race position (1 = leading) for player i, by total distance covered.
    function placeOf(i: number): number {
        let p = 1
        for (let j = 0; j < numPlayers; j++) if (j != i && pos[j] > pos[i]) p++
        return p
    }
    function ordinal(n: number): string {
        return n == 1 ? "1st" : n == 2 ? "2nd" : n == 3 ? "3rd" : "4th"
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
            // road point for this distance, biased downward as the car gets
            // closer so its tyres sit on the road surface near the camera
            // instead of floating at the projected centreline.
            const roadY = hor + tr * (bot - hor)
            const yb = Math.round(roadY + tr * tr * (bot - roadY) * 0.25)
            const rwid = tr * hw
            const cxj = Math.round(ox + (vw >> 1) + cur[i] * (1 - tr) * (1 - tr) * bendScale - lat[i] * rwid + lat[j] * rwid)
            const cw = Math.max(4, Math.round(tr * hw * 1.05))
            // wheel-spin frame from the car's own distance travelled, so the
            // tyres cycle as it moves (faster car => pos advances faster => the
            // frame flips more often).
            const frame = Math.floor(pos[j] * 0.6) & 1
            if (cxj + (cw >> 1) > ox && cxj - (cw >> 1) < ox + vw && yb > oy && yb <= bot)
                drawCar(target, cxj, yb, cw, j, frame, ox, ox + vw, oy, bot)
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
            for (let j = 0; j < numPlayers; j++) if (j != i && pos[j] > pos[i]) place++
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
        if (fillW > 0) target.fillRect(ox + 2, sy + 1, fillW, 2, frac > 0.8 ? C_RED : col)
        // line 3: current lap time + best (only when room — 2-player full width)
        if (vw >= 120) {
            target.print("T " + fmtTime(lapTime[i]), ox + 2, sy + 6, 1, image.font5)
            target.print("B " + fmtTime(bestLap[i]), ox + 2, sy + 13, C_YEL, image.font5)
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

        // tick this player's current-lap timer
        lapTime[i] += dt

        const lp = Math.floor(pos[i] / lapLen)
        if (lp > plap[i]) {
            plap[i] = lp
            // record best lap and start the next lap's timer
            if (bestLap[i] == 0 || lapTime[i] < bestLap[i]) bestLap[i] = lapTime[i]
            lapTime[i] = 0
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
