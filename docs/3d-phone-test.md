# 3D phone test (#430)

Run once on a mid-range iPhone (Safari) and once on a mid-range Android phone (Chrome). Use real devices, not emulators.

## Setup

1. Turn Wi-Fi off and use mobile data. Close the other apps, and start with the battery at 50% or more.
2. Open the play page with `?perf=1` at the end of the URL, for example `/play?perf=1` or `/play/<id>?perf=1`. Do this before you turn 3D on.
3. Open the menu and choose **View: 3D**. The readout shows up in the bottom-right corner.

How to read the readout:
- `3D chunk`: the download time of the 3D code. It says `cached` after the first time.
- `last move`: the average fps and the longest frame during the last piece slide or board flip.
- `now`: the frames drawn in the last second. An idle board draws nothing, so 0 is normal there.
- `square`: how tall the smallest square is on screen. The target is 44 px or more.
- `lost ctx`: how many times the browser threw away the WebGL context.
- `gpu`, `pixels`, `draws`: device details to note down.

## Checks

1. **Load.** Clear the site data, reload with `?perf=1` and turn 3D on. Note `3D chunk`.
2. **Moves.** Play 10 moves, including a capture, a knight move, castling and Flip Board. Note the lowest `last move` fps and the worst frame.
3. **Taps.** Note `square` in portrait and on its side. Tap a few corner squares and squares on the back row: each tap should hit the square you meant.
4. **10-minute game.** Play for 10 minutes. Note the battery drop, how warm the phone gets (cool, warm or hot) and the fps at the end.
5. **Background.** Switch to another app for 2 minutes or more, then come back. The board must redraw, with no black or frozen board. Note `lost ctx`. Repeat with the screen locked.
6. **Rotate.** Turn the phone to its side and back, mid-game. The board, trays, menu and promotion picker must fit inside the notch and rounded corners, and be reachable.

## Results (paste into #430)

```
Device:            (e.g. iPhone 13, iOS 18.1, Safari)
GPU:               (readout "gpu")
3D chunk:          ___ ms on mobile data
Move fps:          lowest ___ fps, worst frame ___ ms
Smallest square:   portrait ___ px, on its side ___ px
10 min game:       battery ___% -> ___%, heat: cool / warm / hot, fps at end ___
Background 2 min:  ok / black / frozen, lost ctx ___
Lock screen:       ok / black / frozen
Rotation:          ok / issues: ___
Full game smooth:  yes / no
Issues filed:      #___ (label "3D")
```

File each problem as its own issue with the **3D** label. Include the device, the readout values and the steps to reproduce it.
