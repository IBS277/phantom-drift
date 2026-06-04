// Demo / playable test for the fpSplit extension (excluded when imported).
// This is the "game" — it just hands fpSplit a Monaco-flavoured track.
fpSplit.onFinish(function (winner) {
    game.over(true)
})
fpSplit.run(
    [
        0, 0, 0, 0.5, 0.4,        // start straight, Ste Devote
        0, 0, -0.6, -0.5,         // Beau Rivage climb, Massenet
        0.4, 0.5,                 // Casino, Mirabeau
        1.5, 1.7, 1.6,            // FAIRMONT HAIRPIN
        0.5, 0,                   // Portier, tunnel
        -0.2, -0.2, 0,            // tunnel curve
        0.8, -0.8,                // Nouvelle Chicane
        -0.6, 0,                  // Tabac
        -0.6, 0.6,                // Swimming Pool chicane
        1.0, 0.9,                 // La Rascasse
        0.5, 0,                   // Anthony Noghès
        0, 0, 0                   // run to the line
    ],
    46,   // segment length
    3     // laps to win
)
