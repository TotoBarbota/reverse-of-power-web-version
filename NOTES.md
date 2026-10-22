# Notes for future work

Things learned while building this port that aren't obvious from the code.

## Visual reference

- The game screens follow the Android app's source closely: sunburst backgrounds, retro TV, doors, power-play cards, trivia overlays, link slots, the hex column.
- The lobby deliberately does not. The Android lobby (join, name, selfie and avatar, waiting room) is plain Material 3: background `#F5F5F5`, white 8dp cards with elevation 2–4dp, blue `#2196F3` filled buttons with 8dp corners, Roboto, black text at 87%/60% alpha. This port uses a dark purple lobby with cream cards instead. Restyling it to match is an open option, kept as is for now at the owner's request.
- The Android app uses Roboto with `textStyle="bold"` (700) everywhere. This port uses a rounded system font at weight 900, which reads heavier.
- The Android Continue screen is a 200dp green circle; the end-of-game scroll is a canvas drawing (parchment `#F5E6C8`, wax seal `#8B0000`) with no title or hint. This port's versions are simpler CSS.
- The Decades whirlpool looks like a solid translucent ring with a horizontal cut. That matches the original: each arm's width at the rim (0.3 × maxRadius) is wider than the gap between the two arms (about 0.14 × maxRadius), and both arms end on the horizontal axis.
- In the Android pairs layout the top-centre slot covers the "N to go" counter. Here the counter sits just above the hint so it stays readable. The sorting question sits at 48px instead of 36dp for the same reason: at 36dp it slides under the counter.

## Protocol and console behaviour

- The console moves the phone from the join screen to name entry by sending `ClientQuizCommandMessage` action 31. Connecting alone doesn't navigate.
- The console accepts one player per source IP. Several phones work through one computer when each gets its own IP on the adapter; `probe/kip-probe.mjs` proved this with two players.
- The console waits for `ClientPowerPlayChoice`, `ClientCategorySelectChoice` and `ClientStopCategorySelectOverrideResponse` before moving on. If a phone is gone, the room stalls. The relay answers these itself when it hasn't heard from the phone for 20 s.
- Real `ServerColourMessage` tints are mid-tone. For example: background `#BFB196`, primary `#B69252`, secondary `#CCA53E`. The primary tint fills the TV face, and the TV text is eggshell, so a light primary tint makes the text unreadable. Keep fake data realistic.
- `ServerBeginCategorySelectOverride.InitialCategorySelectChoice` is the category name shown on the power-pick screen.

## Windows networking

- Adding an address with `netsh` on a DHCP adapter switches the adapter to static unless `dhcpstaticipcoexistence` is enabled first. Doing it the wrong way once cut the machine's internet. Always enable coexistence, then check that the primary address is still there.
- A Node process can survive `Stop-Process` on its PowerShell wrapper and keep UDP 9060 bound (`EADDRINUSE`). Kill node processes by command line instead.

## Browser behaviour

- On touch screens, Chrome counts `pointerup` and `touchend` as user activation, but not `pointerdown`. Fullscreen and wake lock must be requested from those events; audio unlock can run on all three.
- A canvas positioned with only `inset: 0` keeps its intrinsic size; it needs explicit `width: 100%; height: 100%`.
- Calling `wake()` from `pageshow` while a WebSocket is still connecting kills it ("closed before the connection is established"). Give a connecting socket a few seconds before replacing it.
- Headless Chrome never grants fullscreen, so the e2e run always logs `requestFullscreen` warnings. They are expected.

## Testing

- `test/run-e2e.ps1` needs the PC's real LAN IP, because the fake console binds UDP 9066 there and the relay binds 9060.
- The e2e driver taps at random, so effects like bombs and lockdown sometimes time out instead of being cleared. The protocol messages still go out.
- `docs/specs/` holds the per-screen specs written from the Android source during the port: layouts, sizes, colours, timings, messages and quirks. Check them before changing a screen. They were written by reading code, not by running the app, so re-check the Android source when something looks off.
