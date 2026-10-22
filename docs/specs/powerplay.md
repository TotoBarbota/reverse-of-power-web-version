# POWER PLAY selection screen: porting spec (Android Kotlin to HTML/JS)

Source root: `reverse-of-power\app\src\main`
Read-only analysis. Every claim below is taken from the source files named in each section. Where something is absent, the text says "not found".

Files analysed:
- `java\com\game\remoteclient\ui\PowerPlayFragment.kt` (the screen; all logic)
- `java\com\game\remoteclient\ui\RewardScrollView.kt` (read; NOT used by this screen, see section 15)
- `java\com\game\remoteclient\ui\HoldingScreenFragment.kt` (entry navigation)
- `java\com\game\remoteclient\ui\DebugLauncherFragment.kt` (developer entry point with fake data)
- `java\com\game\remoteclient\ui\SunburstBackgroundView.kt` (background view used by this layout)
- `java\com\game\remoteclient\network\NetworkManager.kt` (message dispatch, `receivedImages`, `sendPowerPlayChoice`)
- `java\com\game\protocol\GameMessages.kt` (message classes, `PowerType` enum)
- `java\com\game\protocol\ProtocolDecoder.kt` (JSON type routing)
- `res\layout\fragment_power_play.xml`, `item_power_play.xml`, `item_power_play_target.xml`
- `res\drawable\target_glow_ring.xml`, `target_spotlight.xml`, `pentagon_background.xml` (not used here), `circle_background.xml`, `ic_powerplay_*.xml`
- `res\values\strings.xml`, `res\values\colors.xml`
- `res\navigation\nav_graph.xml`
- `reverse-of-power\CLAUDE.md` section "Power Play Targeting" and "Power Play Types" (used only for cross-checking, see section 16)

---

## 1. Entry, live updates, exit

### 1.1 Entry message
- Server message: `KnowledgeIsPower.ServerBeginPowerPlayPhase` (`GameMessages.kt`, class `ServerBeginPowerPlayPhase`, fields `PowerPlays`, `PowerPlayPlayers`, `RoundType`).
- `ProtocolDecoder.kt`: `typeString.contains("ServerBeginPowerPlayPhase") -> json.decodeFromString<ServerBeginPowerPlayPhase>(jsonStr)`.
- `NetworkManager.kt` (approx. lines 295-298):
```kotlin
is ServerBeginPowerPlayPhase -> {
    pendingPowerPlay = message
    onPowerPlayMessage?.invoke(message)
}
```
- `HoldingScreenFragment.kt`: `powerPlayCb = { _ -> activity?.runOnUiThread { navigateToPowerPlay() } }`, and `navigateToPowerPlay()` calls `findNavController().navigate(R.id.action_holdingScreen_to_powerPlay)`. So the HOLDING SCREEN is the fragment that navigates to POWER PLAY when the message arrives.
- `nav_graph.xml`: `action_holdingScreen_to_powerPlay` destination `powerPlayFragment`. No `enterAnim`/`exitAnim`/`popEnterAnim` attributes are set on this action or on the `powerPlayFragment` node. Transition animation: not specified in XML (library default).
- `PowerPlayFragment.onViewCreated`:
```kotlin
// Apply pending power play data
networkManager.pendingPowerPlay?.let { phase ->
    showPowerPlayOptions(phase)
    networkManager.pendingPowerPlay = null
}
```
  `showPowerPlayOptions(phase)` uses the default `animateNew = true`, so NEW reel animations run on entry.

### 1.2 Live updates while the screen is shown
- `PowerPlayFragment.observeMessages()` subscribes ONLY to `networkManager.onHoldingScreenMessage` and `networkManager.onPowerPlayRequest`.
- It does NOT subscribe to `onPowerPlayMessage`. A second `ServerBeginPowerPlayPhase` received while this screen is visible overwrites `pendingPowerPlay` in NetworkManager, and nothing re-renders. Not handled.

### 1.3 Exit
- `holdingScreenCb = { _ -> activity?.runOnUiThread { if (_binding == null) return@runOnUiThread; navigateToHoldingScreen() } }`
- Registered on `networkManager.onHoldingScreenMessage`. ANY `ClientHoldingScreenCommandMessage` (no type/field check) triggers:
```kotlin
private fun navigateToHoldingScreen() {
    findNavController().popBackStack(R.id.holdingScreenFragment, false)
}
```
- The screen never navigates on its own after the choice. Exit is server-driven.
- Callbacks are cleared in `onDestroyView` (`if (networkManager.onHoldingScreenMessage === holdingScreenCb) ... = null`, same for `onPowerPlayRequest`).

### 1.4 Developer entry point (for testing the port)
- `DebugLauncherFragment.launchPowerPlay()` builds a fake `ServerBeginPowerPlayPhase` from checkboxes/spinners (`btnLaunchPowerPlay`), sets `networkManager.pendingPowerPlay`, and navigates with `action_debugLauncher_to_powerPlay`.
- Its fake data: `RoundType = 1`; `PowerPlayPlayers` = `targetPlayerCount` fake players, slot 0 = "you" (`Self = true`, `Away = false`), `ImageGUID = ""`, `Colour = ColorTint(0.5,0.5,0.5,1)`.
- Its per-type targeting simulation (comment in source): "everyone (Points Party) -> all slots, TargetCount = N, PowerTarget 4"; "self (Points Doubler / 50-50) -> [self], TargetCount = 1, PowerTarget 1"; "sabotage (everything else) -> opponents, TargetCount = 1, PowerTarget 2 (pick one)". Double Trouble gets the sabotage branch (`else`).

---

## 2. Wire data used by this screen

### 2.1 Messages (GameMessages.kt)
```kotlin
@Serializable
data class PowerPlayPlayer(
    val SlotIndex: Int,
    val Name: String,
    val ImageGUID: String,
    val Colour: ColorTint,
    val Self: Boolean,
    val Away: Boolean
)

@Serializable
data class PowerPlay(
    val DisplayIndex: Int,
    val PowerType: PowerType = com.game.protocol.PowerType.NONE,
    val PowerTypes: List<PowerType> = emptyList(),
    val PowerTarget: Int,
    val PowerPlayTargets: List<Int>,
    val New: Boolean,
    val TargetCount: Int
) {
    val effectivePowerType: PowerType get() = if (PowerType != com.game.protocol.PowerType.NONE) PowerType else PowerTypes.firstOrNull() ?: com.game.protocol.PowerType.NONE
    val effectivePowerTypes: List<PowerType> get() = if (PowerType != com.game.protocol.PowerType.NONE) listOf(PowerType) else PowerTypes
}

@Serializable
data class ServerBeginPowerPlayPhase(
    override val TypeString: String = "KnowledgeIsPower.ServerBeginPowerPlayPhase",
    val PowerPlays: List<PowerPlay>,
    val PowerPlayPlayers: List<PowerPlayPlayer>,
    val RoundType: Int
) : GameMessage()

@Serializable
data class ServerRequestPowerPlayChoice(
    override val TypeString: String = "KnowledgeIsPower.ServerRequestPowerPlayChoice"
) : GameMessage()

@Serializable
data class ClientPowerPlayChoice(
    override val TypeString: String = "KnowledgeIsPower.ClientPowerPlayChoice",
    val PowerPlaySlotIndex: Int,
    val TargetSlotIndex: List<Int>
) : GameMessage()
```

### 2.2 Which fields the screen actually reads
| Field | Used by PowerPlayFragment? | Where |
|---|---|---|
| `PowerPlays[].DisplayIndex` | Yes | sent as `PowerPlaySlotIndex` |
| `PowerPlays[].PowerType` / `PowerTypes` | Yes, via `effectivePowerType` | card type, name, icon, colour |
| `PowerPlays[].New` | Yes | triggers reel animation |
| `PowerPlays[].PowerPlayTargets` | Yes | candidate slots (single) / sent list (everyone) |
| `PowerPlays[].TargetCount` | Yes | the ONLY branch switch (`> 1` = Everyone card) |
| `PowerPlays[].PowerTarget` | NO. Not referenced anywhere in PowerPlayFragment | see section 11 |
| `PowerPlayPlayers[].SlotIndex` | Yes | matched against `PowerPlayTargets` |
| `PowerPlayPlayers[].Name` | Yes | target card label; also used to match the glowing card |
| `PowerPlayPlayers[].ImageGUID` | Yes | key into `networkManager.receivedImages` |
| `PowerPlayPlayers[].Colour` | NO. not found in this screen | |
| `PowerPlayPlayers[].Self` | NO. not found in this screen | see section 7.4 |
| `PowerPlayPlayers[].Away` | NO. not found in this screen | |
| `RoundType` | NO. not found in this screen | |

### 2.3 PowerType enum (GameMessages.kt)
Wire value is an integer (`PowerTypeSerializer` encodes/decodes `value`). Unknown integers decode to `NONE`.
```kotlin
// KIP types:
FREEZE(4), BOMBLES(5), NIBBLERS(6), GLOOP(7),
DOUBLE_TROUBLE_FREEZE_GLOOP(10), DOUBLE_TROUBLE_FREEZE_BOMBLES(11), DOUBLE_TROUBLE_NIBBLERS_GLOOP(12),
// Decades:
NONE(-1), // empty slot
BET(1), POINTS_PARTY(8), LOCKDOWN(20), ZIPPERS(22), BUG(24), POINTS_DOUBLER(25),
FIFTY_FIFTY(26), LETTER_SCATTER(28), DISCO_INFERNO(29)
```
`fromValue(v)` = `byValue[v] ?: NONE`.

### 2.4 Which cards are shown
- `showPowerPlayOptions` iterates `phase.PowerPlays` in array order and does `if (powerPlay.effectivePowerType == PowerType.NONE) continue`.
- So: one card per `PowerPlay` entry (keyed by `DisplayIndex`), skipped when the effective type is `NONE`. Unknown wire integers are `NONE` and are therefore skipped.
- Duplicates (e.g. two Freeze entries) each get their own card.
- `effectivePowerType`: uses `PowerType` if it is not `NONE`; otherwise `PowerTypes.firstOrNull()`. Only the first element of `PowerTypes` is ever shown (`effectivePowerTypes` is not used by this screen).

---

## 3. Static layout (fragment_power_play.xml)

Root: `FrameLayout` match_parent.
1. `com.game.remoteclient.ui.SunburstBackgroundView` id `sunburstBackground`, match_parent. Colours set in code: `setColors(#E8A040, #D08830)` (see section 14).
2. `LinearLayout` vertical, match_parent, `gravity=center_horizontal`:
   - `TextView` id `titleText`: wrap_content; text `@string/pick_a_power_play`; `textSize 24sp`; `textStyle bold`; `textColor white`; shadow `#80000000`, dx 2, dy 2, radius 3; `layout_marginTop 24dp`, `layout_marginBottom 8dp`.
   - `TextView` id `selectedPowerPlayLabel`: wrap_content; `textSize 18sp`; bold; white; shadow `#80000000` dx 1 dy 1 radius 2; `visibility gone`; `marginBottom 8dp`.
   - `HorizontalScrollView` id `powerPlayScrollView`: match_parent width; `layout_height 0dp`, `layout_weight 1`; `scrollbars none`; `fillViewport true`.
     - `LinearLayout` id `powerPlayContainer`: wrap_content width, match_parent height, horizontal, `gravity center`, `paddingHorizontal 24dp`. Cards are added here at runtime.
   - `LinearLayout` id `targetArea`: match_parent width; `layout_height 0dp`, `layout_weight 1`; vertical; `gravity center`; `visibility gone`.
     - `HorizontalScrollView` (match_parent width, wrap_content height, `scrollbars none`, `fillViewport true`, `clipChildren false`, `clipToPadding false`).
       - `LinearLayout` id `targetContainer`: wrap_content both; horizontal; `gravity center`; `paddingHorizontal 24dp`; `clipChildren false`; `clipToPadding false`. Target cards added here at runtime.
   - `TextView` id `descriptionText`: wrap_content; `textSize 16sp`; `textColor #CCFFFFFF`; shadow `#80000000` dx 1 dy 1 radius 2; `gravity center`; `marginBottom 24dp`; `marginTop 8dp`.
3. `View` id `stepBackZone` (sibling of the LinearLayout, so it overlays it): match_parent width, `layout_height 120dp`, `layout_gravity top`, `visibility gone`. No background, no content.

Note: `tools:text` attributes (e.g. "BOMBS", "Throw bombs over answers", "Player 1") are IDE preview only, not runtime.

---

## 4. Picker phase: the power play cards

### 4.1 Card layout (item_power_play.xml)
Card `LinearLayout`: width `200dp`, height match_parent, vertical, `gravity center`, `padding 16dp`, `layout_marginHorizontal 12dp`, background transparent.
- `ImageView` id `powerPlayIcon`: `120dp x 120dp`, `background @drawable/circle_background` (solid oval, colour `@color/primary` = `#FF2196F3`, tinted at runtime to the power colour), `scaleType centerInside`, `contentDescription @string/cd_power_play_icon` ("Power play icon").
- `TextView` id `powerPlayName`: wrap_content, `textSize 20sp`, bold, white, shadow `#80000000` dx 2 dy 2 radius 3, `gravity center`, `marginTop 12dp`.
- `TextView` id `powerPlayDescription`: wrap_content, `textSize 14sp`, `textColor #CCFFFFFF`, `gravity center`, `marginTop 6dp`.

So each card shows: circle icon, name (uppercase string resource), description below it.

### 4.2 Card population (showPowerPlayOptions)
For each non-NONE `PowerPlay`:
- The card is inflated and added to `powerPlayContainer`.
- `itemView.setOnClickListener` is attached (see section 7.7 for the step-back branch).
- If `powerPlay.New && animateNew` is true: `startRandomizeAnimation(nameView, descView, icon, type)` (reel, section 4.3).
- Otherwise, immediately:
```kotlin
nameView.text = name
descView.text = description
icon.background.setTint(getPowerPlayColor(powerPlay.effectivePowerType))
getPowerPlayDrawable(powerPlay.effectivePowerType)?.let { icon.setImageResource(it) }
```
Name and description come from `getPowerPlayInfo` (section 5).

### 4.3 "New" reel animation (startRandomizeAnimation)
Applies only to cards with `New = true` on first render (entry). Step-back passes `animateNew = false`, so the reel does not replay on return from target screen.

Decoy pool (exact list in code):
`FREEZE, BOMBLES, NIBBLERS, GLOOP, DOUBLE_TROUBLE_FREEZE_BOMBLES, LOCKDOWN, ZIPPERS, BUG, LETTER_SCATTER, DISCO_INFERNO`
- `otherTypes = pool.filter { it != realType }.shuffled()`
- `types = 11 decoys (otherTypes[i % otherTypes.size] for i in 0..10) + realType` = 12 entries.
- Because the modulo wraps, decoy index 0 and index 10 are the same type (when the pool has 10 entries). Not a bug to copy, but it is the behaviour.

Initial state (t = 0): name = types[0] name, icon = types[0] tint and drawable, description = "" (empty). Name is visible immediately.

Constants: `delays = [80, 80, 80, 80, 80, 80, 120, 160, 220, 300, 400]` (ms). Pre-delay `cumulativeDelay = 300`.

Each step i = 1..11 is scheduled with `handler.postDelayed(runnable, cumulativeDelay)`, then `cumulativeDelay += (i < 11 ? delays[i] : 400)`. Spin duration `S_i = (i < 11 ? delays[i] * 0.4 : 100)` (integer truncation).

| Step i | Fire time (ms) | Spin duration S_i (ms) | Gap to next fire (ms) |
|---|---|---|---|
| 1 | 300 | 32 | 80 |
| 2 | 380 | 32 | 80 |
| 3 | 460 | 32 | 80 |
| 4 | 540 | 32 | 80 |
| 5 | 620 | 32 | 80 |
| 6 | 700 | 48 | 120 |
| 7 | 820 | 64 | 160 |
| 8 | 980 | 88 | 220 |
| 9 | 1200 | 120 | 300 |
| 10 | 1500 | 160 | 400 |
| 11 (final, real type) | 1900 | 100 | n/a |

Each step, at its fire time:
1. Name text slides out: `translationY -> nameHeight`, `alpha -> 0`, duration S_i.
2. At the end of that: `translationY = -nameHeight`, name text = new type name, then slides in: `translationY -> 0`, `alpha -> 1`, duration S_i.
3. Icon colour tint and drawable switch immediately at the fire time (not at the slide end). If the drawable is missing, `setImageDrawable(null)`.
- `nameHeight = nameView.lineHeight` in px if > 0, else `48` (raw px, not dp).
- Description is NOT updated by decoy steps; it stays "".

Landing (step 11, after its slide-in ends at about 1900 + 100 + 100 = 2100 ms):
- `descView.text = real description`; `descView.alpha = 0`; then `descView.alpha -> 1` over `200 ms` (2100 to 2300 ms).
- `nameView` scale `1 -> 1.3` over `120 ms` (2100 to 2220), then `1.3 -> 1` over `120 ms` (2220 to 2340).
- `icon` scale `1 -> 1.2` over `120 ms`, then `1.2 -> 1` over `120 ms` (same timing as name).
- Final state: real name, real icon/tint, real description. Entire reel finishes about 2.34 s after entry.

Interruption: `showPowerPlayOptions` removes all pending reel runnables (`randomizeRunnables`) and cancels animations when rebuilding.

### 4.4 Selected state in picker
- Tapping a card (single-target path) does NOT dim, outline, or mark other cards. Not found.
- Visual feedback on tap is limited to: `selectedPowerPlayLabel` fade-in and description change, plus the phase transition (section 7.2 / 7.3).

### 4.5 "New" badge
- Not found. No badge view, string, or colour for "New" exists in item_power_play.xml, fragment_power_play.xml, or strings.xml. The `New` flag only drives the reel animation. (The string "New" appears only as a checkbox label in fragment_debug_launcher.xml, which is developer tooling.)

---

## 5. Mapping PowerType to display name, description, icon, colour

Source: `getPowerPlayInfo`, `getPowerPlayDrawable`, `getPowerPlayColor` (PowerPlayFragment.kt). Name and description are string resources (strings.xml text quoted).

| PowerType (int) | Name (string key: text) | Description (string key: text) | Icon drawable | Colour |
|---|---|---|---|---|
| FREEZE (4) | `pp_freeze_name`: "FREEZE" | `pp_freeze_desc`: "Encase answers in ice" | `ic_powerplay_freeze` | `#4FC3F7` (ice blue) |
| BOMBLES (5) | `pp_bombs_name`: "BOMBS" | `pp_bombs_desc`: "Throw bombs over answers" | `ic_powerplay_bombles` | `#FFD600` (code comment: "black/yellow") |
| NIBBLERS (6) | `pp_munchers_name`: "MUNCHERS" | `pp_munchers_desc`: "Munch away at answers" | `ic_powerplay_nibblers` | `#FF7043` (orange-red) |
| GLOOP (7) | `pp_gloop_name`: "GLOOP" | `pp_gloop_desc`: "Cover answers in gloop" | `ic_powerplay_gloop` | `#66BB6A` (green) |
| DOUBLE_TROUBLE_FREEZE_GLOOP (10) | `pp_double_trouble_name`: "DOUBLE TROUBLE" | `pp_dt_freeze_gloop_desc`: "Freeze and gloop" | `ic_powerplay_dt_freeze_gloop` | `#59B89A` |
| DOUBLE_TROUBLE_FREEZE_BOMBLES (11) | `pp_double_trouble_name`: "DOUBLE TROUBLE" | `pp_dt_freeze_bombs_desc`: "Freeze and bombs" | `ic_powerplay_dt_freeze_bombles` | `#A8C44B` |
| DOUBLE_TROUBLE_NIBBLERS_GLOOP (12) | `pp_double_trouble_name`: "DOUBLE TROUBLE" | `pp_dt_munchers_gloop_desc`: "Munchers and gloop" | `ic_powerplay_dt_nibblers_gloop` | `#D48A30` |
| LOCKDOWN (20) | `pp_lockdown_name`: "LOCKDOWN" | `pp_lockdown_desc`: "Lock the answers in place" | `ic_powerplay_lockdown` | `#78909C` |
| ZIPPERS (22) | `pp_zippers_name`: "ZIPPERS" | `pp_zippers_desc`: "Zip up the answers" | `ic_powerplay_zippers` | `#CE93D8` |
| BUG (24) | `pp_bug_name`: "BUG" | `pp_bug_desc`: "Bugs crawl over the answers" | `ic_powerplay_bug` | `#8D6E63` |
| POINTS_DOUBLER (25) | `pp_points_doubler_name`: "POINTS DOUBLER" | `pp_points_doubler_desc`: "You get ×2 prize points" | `ic_powerplay_points_doubler` | `#FFD700` |
| FIFTY_FIFTY (26) | `pp_fifty_fifty_name`: "50/50" | `pp_fifty_fifty_desc`: "Remove half the answers" | `ic_powerplay_fifty_fifty` | `#26C6DA` |
| LETTER_SCATTER (28) | `pp_letter_scatter_name`: "LETTER SCATTER" | `pp_letter_scatter_desc`: "Scatter the letters" | `ic_powerplay_letter_scatter` | `#FFA726` |
| DISCO_INFERNO (29) | `pp_disco_name`: "DISCO INFERNO" | `pp_disco_desc`: "Disco lights dazzle the screen" | `ic_powerplay_disco` | `#EC407A` |
| POINTS_PARTY (8) | `pp_points_party_name`: "POINTS PARTY" | `pp_points_party_desc`: "Winners get double winnings" | `ic_powerplay_points_party` | `#E91E63` |
| BET (1) | no branch: falls to `else` = `pp_unknown_name` with arg 1: "POWER PLAY #1" | `pp_unknown_desc`: "please remember the effect and tell developers" | none (`null`, no icon set) | fallback `#AB47BC` |
| NONE (-1) / unknown int | never displayed (filtered out, section 2.4) | | | |

Notes:
- `pp_unknown_name` is `"POWER PLAY #%1$d"`; `%1$d` gets `powerType.value`. In practice this only fires for `BET` (1), because every other enum value except `NONE` has a branch.
- Colour fallback for `else` (BET) is `Color.parseColor("#AB47BC")`.
- For `BET` in the non-reel path, the icon keeps its default drawable (none set) and only the circle is tinted `#AB47BC`. In the reel path the decoy/landing code calls `setImageDrawable(null)` when the drawable is null.
- Points Doubler colour comment in source: "gold (x2 your own points)"; Points Party: "party pink (points for everyone)".
- Double Trouble: name is the same for all three variants; only the description and icon/colour differ.

---

## 6. Icon list (drawables ic_powerplay_*.xml)

15 files exist in `res\drawable\`. Mapping used by `getPowerPlayDrawable`:

| Icon file | PowerType |
|---|---|
| ic_powerplay_freeze.xml | FREEZE |
| ic_powerplay_bombles.xml | BOMBLES (file name spelled "bombles") |
| ic_powerplay_nibblers.xml | NIBBLERS |
| ic_powerplay_gloop.xml | GLOOP |
| ic_powerplay_dt_freeze_gloop.xml | DOUBLE_TROUBLE_FREEZE_GLOOP |
| ic_powerplay_dt_freeze_bombles.xml | DOUBLE_TROUBLE_FREEZE_BOMBLES |
| ic_powerplay_dt_nibblers_gloop.xml | DOUBLE_TROUBLE_NIBBLERS_GLOOP |
| ic_powerplay_lockdown.xml | LOCKDOWN |
| ic_powerplay_zippers.xml | ZIPPERS |
| ic_powerplay_bug.xml | BUG |
| ic_powerplay_letter_scatter.xml | LETTER_SCATTER |
| ic_powerplay_disco.xml | DISCO_INFERNO |
| ic_powerplay_fifty_fifty.xml | FIFTY_FIFTY |
| ic_powerplay_points_doubler.xml | POINTS_DOUBLER |
| ic_powerplay_points_party.xml | POINTS_PARTY |
| (none) | BET, NONE, unknown: `null` |

Example drawing, `ic_powerplay_bombles.xml` (120x120 dp vector): a dark bomb body `#2A2A2A` with highlight `#3D3D3D`, fuse stem `#8D6E63`, spark `#FFD600`/`#FF9100`, five spikes `#FFD600` with tips `#FFC107`, two white eyes with black pupils. The other icon files are not described further (per request, mapping only).

---

## 7. Target-picking phase

### 7.1 Branch decision
In `onPowerPlaySelected(powerPlay)`:
```kotlin
// Targeting is server-driven: PowerPlayTargets lists the candidate slots and TargetCount how many are
// hit. TargetCount > 1 = a fixed multi-target set (e.g. everyone) → auto-send; TargetCount == 1 = the
// player picks one candidate (self-help powers list only the player's own slot).
if (powerPlay.TargetCount > 1) {
    ... // Everyone path (7.3)
    return
}
// single-target path (7.2)
```
- The ONLY condition is `TargetCount > 1`. `PowerTarget` is not read anywhere in PowerPlayFragment (section 11).
- The comment says "auto-send". That is wrong: the code does NOT auto-send. See 7.3 and section 16.

### 7.2 Single-target path (TargetCount == 1). Timeline from tap at t = 0
1. `selectedPowerPlay = powerPlay`.
2. `selectedPowerPlayLabel`: text = name, `visibility VISIBLE`, `alpha 0 -> 1` over 300 ms.
3. `descriptionText.text = description` (still visible until step 5).
4. `titleText`: `alpha 1 -> 0` over 200 ms, then text = "CHOOSE A TARGET", `alpha 0 -> 1` over 200 ms (finishes at 400 ms).
5. `powerPlayScrollView` AnimatorSet over 300 ms: `scaleX 1 -> 0.8`, `scaleY 1 -> 0.8`, `alpha 1 -> 0.4`.
6. At t = 300 ms (`postDelayed` on the scroll view, stored in `pendingTransition`):
   - `targetScreenActive = true`
   - `peekPicker()` (section 7.6): instant layout change. Scroll view height `72dp`, weight 0, scaleX/Y 1, alpha 0.4; cards bottom-aligned; card name and description `GONE`; `stepBackZone VISIBLE`; `selectedPowerPlayLabel` `GONE`; `descriptionText` `GONE`.
   - `showTargetPlayers(powerPlay)`: `targetArea VISIBLE`, `alpha 0 -> 1` over 300 ms; target cards built (7.4).
   - Race note: the AnimatorSet and the 300 ms runnable end at the same moment. `peekPicker()` assigns scale 1 / alpha 0.4 directly. Port as the final state scale 1, alpha 0.4.
7. Choice pending. `selectionEnabled` stays `true` in this path (not set to false), which matters for taps (7.7).

### 7.3 Everyone path (TargetCount > 1). Timeline from tap at t = 0
1. `selectedPowerPlay = powerPlay`; label fade-in as in 7.2 step 2; `descriptionText.text = description`.
2. `selectionEnabled = false`.
3. `titleText`: `alpha 1 -> 0` over 200 ms, then `titleText.text = name` (the POWER NAME, not "CHOOSE A TARGET"), `alpha 0 -> 1` over 200 ms.
4. Same scroll view shrink AnimatorSet as 7.2 step 5 (300 ms).
5. At t = 300 ms: `targetScreenActive = true`; `peekPicker()`; `showEveryoneTarget(powerPlay)` (7.4).
6. No automatic send. The player must tap the "Everyone" card (section 8).

### 7.4 Target candidate cards
Candidates (single path only):
```kotlin
// Candidates = whatever slots the server marked targetable (includes self for self-help powers)
val targets = players.filter { powerPlay.PowerPlayTargets.contains(it.SlotIndex) }
```
- Source list is `PowerPlayPlayers`, filtered by membership in `PowerPlayTargets`. Display order = order of `PowerPlayPlayers`, not order of `PowerPlayTargets`.
- A target slot with no matching player is silently skipped. If nothing matches, the target area is empty; no text is shown. Empty-state message: not found.
- Self / Away: `PowerPlayPlayer.Self` and `.Away` are NOT read. The self-slot, if the server includes it in `PowerPlayTargets`, is an ordinary candidate card with no "You" label and no special styling. Away players are not dimmed, filtered or marked. Not found in code.
- Duplicate names: the glow match in 7.5 compares by name string, so cards with identical names would both glow.

Per-card layout (item_power_play_target.xml): card `LinearLayout` 160dp wide, wrap_content height, vertical, `gravity center`, `padding 16dp`, `layout_marginHorizontal 12dp`, `clipChildren false`, `clipToPadding false`.
- `FrameLayout` 140dp x 140dp, `clipChildren false`, containing in z-order:
  1. `View` id `targetSpotlight`: 180dp x 180dp, centered, background `@drawable/target_spotlight`, `gone`.
  2. `View` id `targetGlowRing`: 136dp x 136dp, centered, background `@drawable/target_glow_ring`, `gone`.
  3. `ImageView` id `targetPhoto`: 120dp x 120dp, centered, `scaleType centerCrop`, `background @drawable/circle_background`, `clipToOutline true`.
- `TextView` id `targetName`: wrap_content, `textSize 18sp`, bold, white, shadow `#80000000` dx 2 dy 2 radius 3, `gravity center`, `marginTop 12dp`.

Photo vs avatar fallback (single path, `showTargetPlayers`):
```kotlin
val imageData = networkManager.receivedImages[player.ImageGUID]
if (imageData != null) {
    val bitmap = BitmapFactory.decodeByteArray(imageData, 0, imageData.size)
    if (bitmap != null) {
        photo.setImageBitmap(bitmap)
    } else {
        photo.background.setTint(Color.parseColor("#80FFFFFF"))
    }
} else {
    photo.background.setTint(Color.parseColor("#80FFFFFF"))
}
```
- Image source: `receivedImages` map (GUID to JPEG bytes), filled by `protocolClient.onImageReceived` in NetworkManager.
- Photo shown: the decoded JPEG via `setImageBitmap`, `centerCrop`, clipped to the circle outline.
- Fallback when GUID not in map OR decode fails: no image; the circle's background is tinted `#80FFFFFF` (semi-transparent white). No initials, no avatar stub, no placeholder icon. (`res\raw\avatar_stub.jpeg` exists but is NOT referenced by this screen.)
- The map is read once when cards are built. If the image arrives later, the card is not updated. Not found: any re-render.
- Debug launcher uses `ImageGUID = ""`, so it always hits the fallback.

Everyone card (`showEveryoneTarget`):
- One card, same layout as above.
- `targetName.text = getString(R.string.pp_everyone)` = "Everyone".
- `photo.scaleType = CENTER_INSIDE`.
- `photo.background.setTint(getPowerPlayColor(type))`: the circle is filled with the power colour (section 5).
- `photo.setImageResource(getPowerPlayDrawable(type))`: the power icon is drawn inside the coloured circle (if a drawable exists).
- Click: `onEveryoneSelected(powerPlay, itemView)`.

Card click (single path): `itemView.setOnClickListener { onTargetSelected(player) }`.

### 7.5 Single-target selection effects (onTargetSelected)
Applied to all cards in `targetContainer`:
- Matched card (by `targetName.text == player.Name`):
  - `targetGlowRing`: `VISIBLE`, `alpha 0`, then `alpha -> 1` over 300 ms, then `pulseGlow` (7.5a).
  - `targetSpotlight`: `VISIBLE`, `alpha 0`, `scaleX/Y 0.5`, then `alpha -> 1`, `scaleX/Y -> 1` over 400 ms.
  - `targetPhoto`: `scaleX/Y -> 1.05` over 300 ms (stays at 1.05).
- Every other card: `alpha -> 0.3` over 300 ms.

7.5a `pulseGlow(view)`: loop. `scaleX/Y 1 -> 1.1`, `alpha -> 0.7` over 800 ms; then `scaleX/Y -> 1`, `alpha -> 1` over 800 ms; then repeat. Loops until the fragment binding is null (not cancelled on step-back, only guarded by `_binding == null`).

### 7.6 Peek picker geometry (peekPicker)
Purpose: keep the picker visible as a small strip under the title, as a step-back affordance.
- `powerPlayScrollView.layoutParams`: `height = 72dp`, `weight = 0`.
- `powerPlayScrollView`: `scaleX = 1`, `scaleY = 1`, `alpha = 0.4`.
- Each card in `powerPlayContainer`: `gravity = BOTTOM | CENTER_HORIZONTAL`; name and description `GONE`. Comment in source: "Bottom-align each card's icon ... so only the icon's rounded bottom arc shows inside the short window."
  - Arithmetic (not measured): window 72dp minus card bottom padding 16dp leaves about 56dp of the 120dp icon visible from the bottom. Treat exact pixels as "lower part of the circle, rounded bottom edge visible", since the screen was not run.
- `stepBackZone`: `VISIBLE` (120dp tall, top).
- `selectedPowerPlayLabel`: animation cancelled, `GONE`.
- `descriptionText`: animation cancelled, `GONE` (comment: "Per the approved trade-off ... hide both during target selection").

### 7.7 Step-back (back to picker)
Triggers (all require `targetScreenActive && !choiceCommitted`):
1. `stepBackZone` click (the top 120dp zone over title and strip).
2. `powerPlayScrollView` click (background/gaps between cards).
3. Card click when `selectionEnabled == false` (Everyone path), see below.

Card click logic:
```kotlin
itemView.setOnClickListener {
    if (selectionEnabled) {
        onPowerPlaySelected(powerPlay)
    } else if (targetScreenActive && !choiceCommitted) {
        stepBackToPicker()
    }
}
```
Consequence: in the SINGLE-target path `selectionEnabled` stays `true`, so tapping a peeking card re-selects that card (new target list, shrink again) instead of stepping back. Step-back by card tap only happens in the Everyone path. Only `stepBackZone` and empty scroll-view space step back in the single path.

`stepBackToPicker()`:
```kotlin
binding.targetArea.visibility = View.GONE
currentPhase?.let { showPowerPlayOptions(it, animateNew = false) }
```
`showPowerPlayOptions` then: cancels pending transition and reel runnables, cancels animations, sets `selectionEnabled = true`, `targetScreenActive = false`, `choiceCommitted = false`, `selectedPowerPlay = null`; title "PICK A POWER PLAY"; description "" visible; label GONE; `targetArea` GONE; target cards removed; scroll view restored (height 0 weight 1, scale 1, alpha 1); `stepBackZone` GONE; cards re-inflated with static text (no reel).

Edge case (single path): tapping a different peek card during the 300 ms transition, or after it, re-runs `onPowerPlaySelected`. The shrink AnimatorSet is recreated with explicit start values `1 -> 0.8` (scale) and `1 -> 0.4` (alpha), so the strip briefly returns to alpha 1 and then settles at 0.4. `pendingTransition` is overwritten without cancelling the previous runnable.

Step-back is impossible after a choice is committed (`choiceCommitted == true`).

---

## 8. When ClientPowerPlayChoice is sent, and values

`NetworkManager.sendPowerPlayChoice`:
```kotlin
fun sendPowerPlayChoice(powerPlaySlotIndex: Int, targetSlotIndices: List<Int>) {
    Log.d(TAG, "Power play choice: slot=$powerPlaySlotIndex targets=$targetSlotIndices")
    scope.launch {
        protocolClient?.sendMessage(ClientPowerPlayChoice(
            PowerPlaySlotIndex = powerPlaySlotIndex,
            TargetSlotIndex = targetSlotIndices
        ))
    }
}
```
Three call sites in PowerPlayFragment.kt:

### 8.1 Everyone card tapped (onEveryoneSelected)
Condition: card tapped and `choiceCommitted == false`.
```kotlin
if (choiceCommitted) return
choiceCommitted = true
targetScreenActive = false
selectionEnabled = false
val targetSlots = powerPlay.PowerPlayTargets
networkManager.sendPowerPlayChoice(
    powerPlaySlotIndex = powerPlay.DisplayIndex,
    targetSlotIndices = targetSlots
)
```
Sent values: `PowerPlaySlotIndex = DisplayIndex`; `TargetSlotIndex = PowerPlayTargets` verbatim (the server list).

### 8.2 Single target card tapped (onTargetSelected)
Condition: `choiceCommitted == false` and `selectionEnabled == true`, and a `selectedPowerPlay` exists.
```kotlin
if (choiceCommitted || !selectionEnabled) return
val powerPlay = selectedPowerPlay ?: return
selectionEnabled = false
choiceCommitted = true
targetScreenActive = false
networkManager.sendPowerPlayChoice(
    powerPlaySlotIndex = powerPlay.DisplayIndex,
    targetSlotIndices = listOf(player.SlotIndex)
)
```
Sent values: `PowerPlaySlotIndex = DisplayIndex`; `TargetSlotIndex = [tapped player's SlotIndex]` (exactly one element).

### 8.3 Server asks for a choice and nothing is selected (onPowerPlayRequested)
Triggered by `ServerRequestPowerPlayChoice` (section 9), only when no power play has been selected.
```kotlin
if (selectedPowerPlay == null) {
    Log.d("PowerPlayFragment", "No power play selected, sending empty choice")
    networkManager.sendPowerPlayChoice(
        powerPlaySlotIndex = -1,
        targetSlotIndices = emptyList()
    )
}
```
Sent values: `PowerPlaySlotIndex = -1`; `TargetSlotIndex = []`.

### 8.4 Never sent
- Selecting a power play alone (picker tap, or the transition).
- Step-back.
- Server request while a power play IS selected (see section 9): nothing is sent.
- Any tap after `choiceCommitted == true`.
- No other send path exists in PowerPlayFragment.

---

## 9. ServerRequestPowerPlayChoice

- Decoder: `typeString.contains("ServerRequestPowerPlayChoice") -> json.decodeFromString<ServerRequestPowerPlayChoice>(jsonStr)`.
- NetworkManager:
```kotlin
is ServerRequestPowerPlayChoice -> {
    onPowerPlayRequest?.invoke()
}
```
- PowerPlayFragment handler: `powerPlayRequestCb` = `activity?.runOnUiThread { if (_binding == null) return; onPowerPlayRequested() }`.
- Behaviour (`onPowerPlayRequested`):
  - If `selectedPowerPlay == null` (nothing picked, or picked then stepped back): send the empty choice (`-1`, `[]`) (8.3).
  - If `selectedPowerPlay != null` (a power play has been picked, whether or not a target was chosen, or a choice was already committed): do nothing. No send, no UI change, no log.
- No UI change for the request itself: no message, no spinner, no countdown, no navigation.
- If there is no fragment listener (`onPowerPlayRequest == null`, e.g. screen not visible), NetworkManager drops the request silently. Not found: any queueing.
- No timeout logic exists on the client. The "timeout" is server-side only; the client only answers the request as above. A picked-but-not-targeted power play gets no answer from the client.

---

## 10. After the choice: text, navigation

### 10.1 Everyone choice
- `showChoiceConfirmed()` (also used only here, see 10.3):
  - `descriptionText.text = getString(R.string.pp_locked_in)` = "✓ Locked in!" (contains U+2713).
  - `descriptionText.alpha = 0`, `VISIBLE`, `alpha -> 1` over 200 ms.
- Everyone glow: `targetGlowRing` `VISIBLE`, `alpha 0 -> 1` over 300 ms, then `pulseGlow`.
- No spotlight, no dimming of other cards (there are no other cards).
- The title stays as the power name ("POINTS PARTY" etc.).

### 10.2 Single-target choice
- Selection effects as 7.5 (glow, spotlight, photo scale 1.05, others dim to 0.3).
- `showChoiceConfirmed()` is NOT called. "✓ Locked in!" is NOT shown in this path. `descriptionText` stays `GONE` (from `peekPicker`). So: no confirmation text on the single-target path.
- Title remains "CHOOSE A TARGET".

### 10.3 Navigation
- The fragment does not navigate after sending the choice.
- It remains on screen until a `ClientHoldingScreenCommandMessage` arrives, which then pops back to `holdingScreenFragment` (section 1.3).
- If the message never arrives, the screen stays open. Not found: any timeout fallback.

---

## 11. Auto-target cases (PowerTarget 1 self, 4 everyone, double trouble)

What the code does:
- `PowerTarget` is NOT read by PowerPlayFragment. The only reads of `PowerTarget` are in `GameMessages.kt` (declaration) and `DebugLauncherFragment.kt` (fake data). Not found in the UI.
- Branching uses `TargetCount` only.

Per case:
- **PowerTarget 1 (self), e.g. POINTS DOUBLER and FIFTY-FIFTY in the debug data:** if the server gives `TargetCount = 1` and `PowerPlayTargets = [self]`, the screen takes the SINGLE-target path (7.2). The player sees one candidate card (themself) under "CHOOSE A TARGET" and must tap it (8.2). No auto-selection. If `TargetCount = 1` with a different list, the same applies.
- **PowerTarget 4 (everyone), e.g. POINTS PARTY:** the code auto-selects nothing. The branch on `TargetCount > 1` shows the Everyone card (7.3). The player must tap it (8.1). Sends the server's `PowerPlayTargets` verbatim.
- **Auto-send:** the comment on the branch says "auto-send" and the Everyone comment says "No auto-send - the player must tap it to confirm". The code matches the second comment: NO auto-send exists anywhere.
- **Double trouble (DOUBLE_TROUBLE_*):** no special case in the screen. Name, description and icon come from the type mapping (section 5); targeting follows `TargetCount`, like any other sabotage. The debug launcher sends `PowerTarget 2`, `TargetCount 1`, opponents only (or all if no opponents). Not found: any "double trouble" branch in picker, target or choice code.
- **PowerTarget 2 (one opponent), the classic sabotage:** no code branch on `2`. Behaves like any `TargetCount == 1` power: candidate cards from `PowerPlayTargets`, tap one.

---

## 12. Timers and timing constants

Client-side timers in PowerPlayFragment (complete list):

| Name | Value | Where | What |
|---|---|---|---|
| Reel pre-delay | 300 ms | `startRandomizeAnimation` | delay before first reel step |
| Reel delays | 80, 80, 80, 80, 80, 80, 120, 160, 220, 300, 400 ms | `delays` | gap between reel steps |
| Reel spin | `delays[i]*0.4` (32..160 ms), last 100 ms | per step | slide out + slide in |
| Reel landing | desc fade 200 ms; name and icon bounce 120 ms up + 120 ms down | final step | |
| Picker to target transition | 300 ms | `pendingTransition` postDelayed | delay before `peekPicker` + target UI |
| Shrink | 300 ms | AnimatorSet | scroll view scale 1 to 0.8, alpha 1 to 0.4 |
| Title swap | 200 ms out, 200 ms in | `titleText` | |
| Label fade-in | 300 ms | `selectedPowerPlayLabel` | |
| Target area fade-in | 300 ms | `targetArea` | |
| Choice confirmed fade | 200 ms | `showChoiceConfirmed` | |
| Glow ring appear | 300 ms | glow | |
| Spotlight appear | 400 ms | spotlight | |
| Selected photo scale | 1.05 over 300 ms | | |
| Dim others | 300 ms, alpha 0.3 | | |
| Pulse | 800 ms up, 800 ms down, loops | `pulseGlow` | |

- No countdown, no question-style duration, no server timer on the client. `ServerBeginPowerPlayPhase` carries no duration field.
- No `Handler` timers besides the reel runnables and the 300 ms transition.

---

## 13. All user-visible English strings on this screen

Quoted from `res\values\strings.xml` (English only; `values-ru` not used here).

Screen and state:
- `pick_a_power_play`: "PICK A POWER PLAY" (title, picker phase)
- `choose_a_target`: "CHOOSE A TARGET" (title, single-target phase)
- `pp_locked_in`: "✓ Locked in!" (description, after Everyone tap only)
- `pp_everyone`: "Everyone" (Everyone card label)
- `cd_power_play_icon`: "Power play icon" (contentDescription of icon ImageView; not visible)

Power play names and descriptions (exact strings):
- `pp_freeze_name`: "FREEZE"; `pp_freeze_desc`: "Encase answers in ice"
- `pp_bombs_name`: "BOMBS"; `pp_bombs_desc`: "Throw bombs over answers"
- `pp_munchers_name`: "MUNCHERS"; `pp_munchers_desc`: "Munch away at answers"
- `pp_gloop_name`: "GLOOP"; `pp_gloop_desc`: "Cover answers in gloop"
- `pp_double_trouble_name`: "DOUBLE TROUBLE"; `pp_dt_freeze_gloop_desc`: "Freeze and gloop"; `pp_dt_freeze_bombs_desc`: "Freeze and bombs"; `pp_dt_munchers_gloop_desc`: "Munchers and gloop"
- `pp_lockdown_name`: "LOCKDOWN"; `pp_lockdown_desc`: "Lock the answers in place"
- `pp_zippers_name`: "ZIPPERS"; `pp_zippers_desc`: "Zip up the answers"
- `pp_bug_name`: "BUG"; `pp_bug_desc`: "Bugs crawl over the answers"
- `pp_letter_scatter_name`: "LETTER SCATTER"; `pp_letter_scatter_desc`: "Scatter the letters"
- `pp_disco_name`: "DISCO INFERNO"; `pp_disco_desc`: "Disco lights dazzle the screen"
- `pp_fifty_fifty_name`: "50/50"; `pp_fifty_fifty_desc`: "Remove half the answers"
- `pp_points_doubler_name`: "POINTS DOUBLER"; `pp_points_doubler_desc`: "You get ×2 prize points"
- `pp_points_party_name`: "POINTS PARTY"; `pp_points_party_desc`: "Winners get double winnings"
- `pp_unknown_name`: "POWER PLAY #%1$d"; `pp_unknown_desc`: "please remember the effect and tell developers" (only BET hits this)

Strings NOT used by this screen: `you` ("You"), `choose_a_category`, `power_pick*`, `continue_caps`, `start_caps`, etc. Not found on this screen.

Other text: none. Kotlin `Log.*` messages are developer-only (not user-visible). No `Toast`, no `AlertDialog`, no error text, no empty-state text (not found).

---

## 14. Colours, shapes, backgrounds

Layout text colours:
- White text: `@android:color/white` (`#FFFFFFFF`), used for title, label, names.
- Description text: `#CCFFFFFF` (80% white).
- Text shadows: `#80000000` (50% black) with the offsets above.

Code colours:
- Sunburst background: `backgroundColor = #E8A040` (primary, orange), `backgroundSecondary = #D08830` (secondary, darker orange), passed to `sunburstBackground.setColors(...)`.
- Target photo fallback: `#80FFFFFF`.
- Power colours: section 5.
- Fallback power colour: `#AB47BC`.

`colors.xml` entries NOT used by this screen (for reference): `primary #FF2196F3` is used by `circle_background` (overridden by tint at runtime); the rest (`accent`, `answer_*`, `background`, `surface`, `text_*`) are not referenced by this screen.

Drawables:
- `circle_background.xml`: oval, solid `@color/primary` (#FF2196F3). Used as the background of picker icons and target photos. Tinted at runtime (`setTint`).
- `target_glow_ring.xml`: layer-list. Outer ring stroke 6dp `#88FFFFFF`; inner ring inset 3dp, stroke 3dp `#CCFFFFFF`; transparent fill.
- `target_spotlight.xml`: oval radial gradient, centre `#66FFEB3B` (40% yellow) fading to `#00FFEB3B` at radius `50%p`.
- `pentagon_background.xml`: 120dp vector pentagon, fill `#D4AF37`, stroke `#FFD700` 3 px. Used ONLY by `fragment_power_pick.xml`. Not used by this screen.

SunburstBackgroundView (background of this screen), from `SunburstBackgroundView.kt`:
- 24 rays. Ray i covers angle `i*15 - 90` to `(i+1)*15 - 90` degrees, measured from the view centre. Even rays (i % 2 == 0) use the primary colour, odd rays the secondary colour.
- Ray length `max(width, height) * 1.5`.
- Full-rect overlay `#55000000` (33% black) drawn on top.
- Defaults if `setColors` is not called: `#C4B8A8` / `#D4C8B8`. This screen always calls `setColors`.

---

## 15. RewardScrollView: not used by this screen

- `RewardScrollView.kt` is a custom View (parchment scroll with wax seal, factoid text). It is referenced ONLY by `res\layout\fragment_end_of_game_fact.xml`.
- It does not appear in `fragment_power_play.xml`, `item_power_play.xml`, `item_power_play_target.xml`, or `PowerPlayFragment.kt`.
- So: no "reward scroll" UI, no scroll-open/close animation, and no factoid text exist on the POWER PLAY screen. Not found.
- Its `isOpened` and `factText` properties are never set from PowerPlayFragment.

---

## 16. Discrepancies to be aware of when porting

Source vs comments vs CLAUDE.md:
1. **Auto-send:** comment in `onPowerPlaySelected` says TargetCount > 1 "auto-send". Code does not auto-send; the player must tap the Everyone card (`showEveryoneTarget` comment agrees with the code).
2. **Routing key:** CLAUDE.md says "PowerPlayFragment currently routes auto-target vs picker by `effectivePowerType`". The current code routes by `TargetCount` only. `PowerTarget` is not read.
3. **BOMBLES colour:** CLAUDE.md table says "Orange-red"; code uses `#FFD600` (yellow, comment "black/yellow").
4. **NIBBLERS name/description:** CLAUDE.md says "NIBBLERS" / "Nibble away at answers"; strings say "MUNCHERS" / "Munch away at answers".
5. **BOMBLES name:** CLAUDE.md says "BOMBLES"; string says "BOMBS".
6. **Double Trouble Freeze+Bombles description:** CLAUDE.md says "Freeze and bombles combined"; string says "Freeze and bombs".
7. **Single-target confirmation:** source has "Locked in!" only on the Everyone path; single-target choices show no confirmation.
8. **Single-target selection still live:** `selectionEnabled` stays true, so tapping peeking cards re-selects instead of stepping back (7.7). The comment says peek circles are a step-back affordance; that holds only in the Everyone path.
9. **Reel decoy duplicate:** with a 10-type pool and 11 decoy slots, decoy 0 and decoy 10 repeat (section 4.3).

---

## 17. Not found (explicitly absent)

- "New" badge (text, shape or colour).
- Selected-card highlight in picker.
- Use of `Self`, `Away`, `Colour`, `RoundType`, `PowerTarget` in this screen.
- Avatar placeholder / initials for missing photos (only a flat `#80FFFFFF` tint).
- Empty-state text when no target candidates match.
- Client-side timeout, countdown, or auto-selection on `ServerRequestPowerPlayChoice`.
- Any handling of a second `ServerBeginPowerPlayPhase` while the screen is shown (ignored, section 1.2).
- Sound, vibration or haptics.
- Confirmation text on single-target choices.
- Any "double trouble" special branch in picker, target or send logic.
- Any use of `RewardScrollView` or `pentagon_background` on this screen.
- Any analytics or logging visible to the user.

---

## 18. Port checklist (factual, derived from the above)

- Entry: on `ServerBeginPowerPlayPhase`, navigate to this screen; render cards with entry reel for `New` cards (reel table in 4.3).
- Picker row: cards 200dp wide, 120dp icon circle tinted per type, name 20sp bold, description 14sp at 80% white. No badge.
- Tap a card: `TargetCount > 1` => Everyone flow (title becomes power name, single "Everyone" card, tap to send `[PowerPlayTargets]`, then "✓ Locked in!"); otherwise => target flow (title "CHOOSE A TARGET", target cards from `PowerPlayPlayers` filtered by `PowerPlayTargets`, tap to send `[SlotIndex]`, no confirmation text).
- Step-back: top 120 zone and peek strip, only before a choice is committed; card taps step back only in the Everyone flow.
- Server request: if no power play picked, send `(-1, [])`; otherwise send nothing.
- Exit: any `ClientHoldingScreenCommandMessage` pops back to the holding screen.
- Icons: section 6; names, descriptions and colours: section 5; strings: section 13.
