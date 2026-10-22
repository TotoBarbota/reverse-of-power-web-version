# Trivia Answering Screen and Power-Play Overlays: Porting Spec

Source: `C:\Users\tkaragiannis\Documents\git\.cursor-tmp\reverse-of-power\app\src\main`
Purpose: 1:1 re-implementation in HTML/JavaScript (canvas/CSS).
Status: read-only analysis of the Android Kotlin source. Nothing was run on a device.

## 0. Conventions

- Files read: `java\com\game\remoteclient\ui\TriviaAnsweringFragment.kt`, `IceOverlayView.kt`, `BomblesOverlayView.kt`, `NibblersOverlayView.kt`, `GloopOverlayView.kt`, `ZipperOverlayView.kt`, `LetterScatterOverlayView.kt`, `LockdownOverlayView.kt`, `BugOverlayView.kt`, `DiscoOverlayView.kt`, `SunburstBackgroundView.kt`, `HoldingScreenFragment.kt`, `res\layout\fragment_trivia_answering.xml`, `res\values\strings.xml`, `res\values\colors.xml`, `res\values\themes.xml`, `res\navigation\nav_graph.xml`, `java\com\game\protocol\GameMessages.kt`, `GameProtocolClient.kt`, `ProtocolEncoder.kt`, `ProtocolDecoder.kt` (excerpt), `java\com\game\remoteclient\network\NetworkManager.kt` (excerpts), `DebugLauncherFragment.kt` (excerpt).
- Units: `dp` and `sp` are as written in the XML. For a web port assume 1 dp = 1 CSS px and 1 sp = 1 CSS px (font scale 1.0). Overlay "px" values in Kotlin are view pixels, so they are given relative to the view size (`w`, `h`) or as dp where the code multiplies by `density`.
- "Per-button overlay" means an overlay that sits inside one answer button's `FrameLayout` and is sized to that frame.
- Line numbers refer to the files as supplied.
- "Inference" marks a conclusion drawn from the code that is not stated in it.
- "not found" means no code or resource in the source provides the behaviour.

---

## 1. Entry, exit and message flow

### 1.1 Navigation (`res\navigation\nav_graph.xml`)

| From | Action | Notes |
|---|---|---|
| `holdingScreenFragment` | `action_holdingScreen_to_triviaAnswering` | Triggered by `triviaCb` in `HoldingScreenFragment` (line ~80). |
| `categorySelectionFragment` | `action_categorySelection_to_triviaAnswering` | `app:popUpTo="@id/holdingScreenFragment"`, `popUpToInclusive="false"`. |
| `debugLauncherFragment` | `action_debugLauncher_to_triviaAnswering` | Debug-only harness (DebugLauncherFragment ~line 170-186). |

`triviaAnsweringFragment` has `android:label="Trivia"`. It has no arguments.

### 1.2 Inbound path

`ProtocolDecoder.kt` (line ~245) maps the `TypeString` containing `ServerBeginTriviaAnsweringPhase` to `ServerBeginTriviaAnsweringPhase`. `GameProtocolClient` offers the decoded message to protocol handling, then to the UI callback. `NetworkManager.handleUIEvents` (line ~290) does:

```kotlin
is ServerBeginTriviaAnsweringPhase -> {
    pendingTrivia = message
    onTriviaMessage?.invoke(message)
}
```

`TriviaAnsweringFragment` registers `triviaCb` in `observeMessages()` (lines 70-80):

```kotlin
triviaCb = { message ->
    activity?.runOnUiThread { displayTrivia(message) }
}
holdingScreenCb = { _ ->
    activity?.runOnUiThread { navigateToHoldingScreen() }
}
networkManager.onTriviaMessage = triviaCb
networkManager.onHoldingScreenMessage = holdingScreenCb
```

In `onViewCreated` (lines 60-68) a pending trivia is consumed once:

```kotlin
networkManager.pendingTrivia?.let { trivia ->
    displayTrivia(trivia)
    networkManager.pendingTrivia = null
}
```

Quirk: `pendingTrivia` is cleared only in this path, not when the callback delivers a trivia. A later `onViewCreated` on the same `NetworkManager` would replay a stale trivia (inference from the code; not observed).

### 1.3 Messages that are not handled

- `ServerAwaitTriviaAnsweringPhaseMessage` (pre-trivia notice with `PowerPlays`) is decoded (`ProtocolDecoder.kt` line ~243) but `NetworkManager.handleUIEvents` has no `is ServerAwaitTriviaAnsweringPhaseMessage` branch. It falls to `else -> return false`, and `GameProtocolClient` logs `Unhandled message`. The trivia screen therefore never shows the pre-trivia power-play notice.
- `ServerBeginTriviaAnsweringPhase.serverTick`, `QuestionID`, `PrimaryTint`, `PowerPlayPlayers` are not read by this screen (see section 2).

### 1.4 Exit

`ClientHoldingScreenCommandMessage` of any `HoldingScreenType` pops the trivia screen:

```kotlin
holdingScreenCb = { _ ->
    activity?.runOnUiThread { navigateToHoldingScreen() }
}
...
private fun navigateToHoldingScreen() {
    findNavController().popBackStack(R.id.holdingScreenFragment, false)
}
```

- The message contents are ignored. `HoldingScreenText` is not forwarded to the next screen by the trivia code. The holding screen shows its own default text after the pop (`R.string.look_at_tv`, or `R.string.get_ready` when type is 9, see `HoldingScreenFragment.handleHoldingScreenMessage`).
- Because any holding-screen message pops, a player-join message (`HoldingScreenType == 5`, per the comment in `ContinueFragment.kt` line 43) also pops the trivia screen (inference from the code).
- `onDestroyView` cancels the timer (`timer?.cancel()`), so no automatic no-answer is sent after leaving the screen.

---

## 2. Inbound message: `ServerBeginTriviaAnsweringPhase`

Source: `GameMessages.kt` lines 288-365.

```kotlin
@Serializable
data class TriviaAnswer(
    val DisplayIndex: Int,
    val DisplayText: String,
    val IsCorrect: Boolean
)

@Serializable
data class PowerPlayPlayer(
    val SlotIndex: Int,
    val Name: String,
    val ImageGUID: String,
    val Colour: ColorTint,
    val Self: Boolean,
    val Away: Boolean
)

@Serializable(with = PowerTypeSerializer::class)
enum class PowerType(val value: Int) {
    FREEZE(4), BOMBLES(5), NIBBLERS(6), GLOOP(7),
    DOUBLE_TROUBLE_FREEZE_GLOOP(10), DOUBLE_TROUBLE_FREEZE_BOMBLES(11), DOUBLE_TROUBLE_NIBBLERS_GLOOP(12),
    NONE(-1), BET(1), POINTS_PARTY(8), LOCKDOWN(20), ZIPPERS(22), BUG(24),
    POINTS_DOUBLER(25), FIFTY_FIFTY(26), LETTER_SCATTER(28), DISCO_INFERNO(29);

    companion object {
        private val byValue = entries.associateBy { it.value }
        fun fromValue(value: Int): PowerType = byValue[value] ?: NONE
    }
}

@Serializable
data class ActivePowerPlay(
    val PowerType: PowerType,
    val Count: Int,
    val Culprits: List<Int> = emptyList()
)

@Serializable
data class ServerBeginTriviaAnsweringPhase(
    override val TypeString: String = "KnowledgeIsPower.ServerBeginTriviaAnsweringPhase",
    val QuestionID: String,
    val QuestionText: String,
    val QuestionDuration: Double,
    val Answers: List<TriviaAnswer>,
    val PowerPlays: List<ActivePowerPlay>,
    val PowerPlayPlayers: List<PowerPlayPlayer>,
    val RoundType: Int, // 1 = normal, 5 = finals, 6 = ?
    val BackgroundTint: ColorTint? = null,
    val PrimaryTint: ColorTint? = null,
    val SecondaryTint: ColorTint? = null,
    val serverTick: Long = 0
) : GameMessage()
```

`ColorTint` is `r, g, b, a` as `Float` in 0..1 (`GameMessages.kt` line ~200).

Unknown `PowerType` integers map to `NONE` (`fromValue`). `NONE` and unknown types are ignored by the trivia screen.

### Field usage on the trivia screen

| Field | Used? | How |
|---|---|---|
| `QuestionID` | No | Not echoed in the answer message. |
| `QuestionText` | Yes | `binding.questionText.text = trivia.QuestionText` (raw, no trimming). |
| `QuestionDuration` | Yes | Seconds. Starts the no-answer timer: `durationMs = (trivia.QuestionDuration * 1000).toLong()`. |
| `Answers` | Yes | Mapped by `DisplayIndex` (section 4). `IsCorrect` is used only in finals (section 5). |
| `PowerPlays` | Yes | Sums `Count` per type (section 7). `Culprits` is not read. |
| `PowerPlayPlayers` | No | Not read by this screen. Only `PowerPlayFragment.kt` line 119 reads it. |
| `RoundType` | Yes | `== 5` shows the finals warning and enables finals rules. Other values behave as normal. |
| `BackgroundTint` | Yes | Sunburst primary colour (default `#333333` if null). |
| `PrimaryTint` | No | Not read by the trivia code. |
| `SecondaryTint` | Yes | Sunburst secondary colour (default `#222222` if null). |
| `serverTick` | No | Not read. |

`PowerPlayPlayers` and `Culprits` are not used by any trivia overlay. Searching the whole `java` tree, `Culprits` is referenced only in its declaration in `GameMessages.kt` line 348. So overlays are not player-attributed and show no photos or names.

---

## 3. Layout: `res\layout\fragment_trivia_answering.xml`

### 3.1 Structure and z-order

Root: `FrameLayout`, match_parent. Children in XML order (Android draws siblings in ascending `translationZ`; touches are dispatched top-most first):

| Order | View | id | Z (translationZ) | Visible at start | Touch behaviour |
|---|---|---|---|---|---|
| 1 | `SunburstBackgroundView` | `sunburstBackground` | none (0) | yes | none (no clickable) |
| 2 | `LinearLayout` (vertical, padding 16dp, gravity center) | none | none (0) | yes | contains answers and overlays |
| 3 | `DiscoOverlayView` | `discoOverlay` | 7.5dp | gone | `clickable=false`, `focusable=false`, passes through |
| 4 | `View` (gloop touch interceptor) | `gloopTouchInterceptor` | 9.5dp | gone | consumes all touches while visible (section 8.4) |
| 5 | `BomblesOverlayView` | `bomblesOverlay` | 10dp | gone | passes through unless a bomble is hit |
| 6 | `LockdownOverlayView` | `lockdownOverlay` | 10.5dp | gone | consumes all touches while active |
| 7 | `BugOverlayView` | `bugOverlay` | 11dp | gone | consumes all touches while active |
| 8 | `View` (wrong answer) | `wrongAnswerOverlay` | 12dp | gone | `clickable=true`, blocks touches while visible |
| 9 | `FrameLayout` (bombles explosion) | `bomblesExplosionOverlay` | 14dp | gone | `clickable=true`, blocks touches while visible |

Inside the `LinearLayout` (order 2), the per-button overlays live inside each button's `FrameLayout`. Their Z values are 7 to 9.5dp, relative to the siblings in that `FrameLayout`. Inference: because Android sorts Z only among siblings, the whole answer grid is drawn as one unit at Z 0. So the disco overlay (7.5dp) paints over the whole grid, including the per-button ice, gloop and zipper overlays, and the gloop interceptor (9.5dp) and bombles (10dp) paint over everything in the grid. This matches the XML but was not verified on a device.

Per-button child order (inside each of the four `FrameLayout`s), bottom to top:

| Child | Z |
|---|---|
| `Button` answerN (no translationZ) | 0 |
| `NibblersOverlayView` nibblersOverlayN | 7dp |
| `LetterScatterOverlayView` letterScatterOverlayN | 7.1dp |
| `IceOverlayView` iceOverlayN | 8dp |
| `GloopOverlayView` gloopOverlayN | 9dp |
| `ZipperOverlayView` zipperOverlayN | 9.5dp |

### 3.2 Question text

- `TextView` `questionText`, `android:layout_width="match_parent"`, wrap height.
- `textSize 20sp`, `textStyle bold`, `textColor white (#FFFFFF)`.
- Shadow: `shadowColor #80000000`, `shadowDx 2`, `shadowDy 2`, `shadowRadius 3`.
- `gravity center`, `layout_marginBottom 24dp`.
- No max lines, no ellipsis, no timer element.

### 3.3 Grid geometry

Root `LinearLayout` (vertical, `gravity center`, `padding 16dp`) contains the question and a grid `LinearLayout` (`layout_height 0dp`, `layout_weight 1`, vertical, `gravity center`).

The grid has two rows (each `0dp` height, `layout_weight 1`, horizontal). Between them sits the finals warning `TextView` (wrap height). Each row has two cells (`FrameLayout`, `0dp` width, `layout_weight 1`, `layout_margin 8dp`).

Answer index to cell:

| Index | Position |
|---|---|
| 0 | top-left |
| 1 | top-right |
| 2 | bottom-left |
| 3 | bottom-right |

Cell size in CSS px for a screen of width `W` and height `H`:
- Width per cell = `(W - 32) / 2`, and the button fills the cell minus 8dp margins on each side.
- Height: the grid height is `H - 32 - questionTextHeight - 24`. Each row takes half of the grid height after the finals warning is subtracted (finals warning is `wrap_content`).

### 3.4 Answer buttons

Each `Button` (answer0..answer3):
- `layout_width match_parent`, `layout_height match_parent` inside its cell.
- `textSize 34sp`, `textStyle bold`, `textColor white (#FFFFFF)`.
- `backgroundTint #CC444444` (ARGB: alpha 0xCC = 80%, RGB #444444).
- `paddingHorizontal 58dp`.
- `tools:text` placeholders (`EGGOs`, `UGGs`, `OWLs`, `ARGHs`) are design-time only.
- Shape: the theme gives `materialButtonStyle = Widget.App.Button` (parent `Widget.Material3.Button`) with `shapeAppearance = ShapeAppearance.App.Rounded` (`cornerSize 8dp`, `cornerFamily rounded`) (`themes.xml`). So a filled, rounded rectangle, corner radius 8dp.
- Not found in source: text transform (all caps), elevation, ripple, min height. These come from Material3 defaults and were not verified on a device.

### 3.5 Finals warning

`TextView` `finalsWarning`:
- `text="@string/finals_warning"` (`Finals! Wrong answers are rejected!`).
- `textSize 14sp`, `textStyle bold|italic`, `textColor #FFDDDD`, `gravity center`, `paddingVertical 4dp`.
- Visible only when `RoundType == 5`, set in code (`displayTrivia`), not in XML.

### 3.6 Full-screen overlays used by the trivia code

- Wrong answer: `View` `wrongAnswerOverlay`: `background #66CC0000` (40% red), `clickable`, `focusable`, `translationZ 12dp`, starts gone.
- Bombles explosion: `FrameLayout` `bomblesExplosionOverlay`: `background #BBFFFFFF` (73% white), `clickable`, `focusable`, `translationZ 14dp`, starts gone. Contains a `TextView` with `text="@string/dont_touch_bombs"`, `textSize 42sp`, `textStyle bold`, `textColor #333333`, centred.

### 3.7 Timer

No timer view. The countdown is a `CountDownTimer` only (section 5.4). Not found: any visible countdown.

---

## 4. Trivia display routine: `displayTrivia(trivia)` (lines 82-238)

Steps, in order:

1. Reset state:
   ```kotlin
   answered = false
   wrongAnswerCount = 0
   penaltyActive = false
   questionStartTime = SystemClock.elapsedRealtime()
   ```
   Quirk: `handler` pending callbacks from an earlier penalty are not cancelled here. A previous penalty's delayed callback can still run and re-enable buttons for the new question. `bomblesExplosionOverlay` is not hidden here either.

2. Question text: `binding.questionText.text = trivia.QuestionText`. Wrong-answer overlay hidden (`GONE`).

3. Finals warning: `binding.finalsWarning.visibility = if (trivia.RoundType == 5) View.VISIBLE else View.GONE`.

4. Background (sunburst):
   ```kotlin
   val backgroundColor = trivia.BackgroundTint?.let { colorTintToInt(it) } ?: Color.parseColor("#333333")
   val backgroundSecondary = trivia.SecondaryTint?.let { colorTintToInt(it) } ?: Color.parseColor("#222222")
   binding.sunburstBackground.setColors(backgroundColor, backgroundSecondary)
   ```
   `PrimaryTint` is not used.

   `colorTintToInt` (lines ~385-392):
   ```kotlin
   Color.argb(
       (tint.a * 255).toInt().coerceIn(0, 255),
       (tint.r * 255).toInt().coerceIn(0, 255),
       (tint.g * 255).toInt().coerceIn(0, 255),
       (tint.b * 255).toInt().coerceIn(0, 255)
   )
   ```
   Note: `toInt()` truncates. Use `Math.trunc(x * 255)` clamped to 0..255.

5. Power-play counts (sums over all entries of that type; `Culprits` and `PowerPlayPlayers` ignored):
   ```kotlin
   val nibblersCount = trivia.PowerPlays.filter { it.PowerType == PowerType.NIBBLERS }.sumOf { it.Count }
   val freezeCount = trivia.PowerPlays.filter { it.PowerType == PowerType.FREEZE }.sumOf { it.Count }
   val gloopCount = trivia.PowerPlays.filter { it.PowerType == PowerType.GLOOP }.sumOf { it.Count }
   val zipperCount = trivia.PowerPlays.filter { it.PowerType == PowerType.ZIPPERS }.sumOf { it.Count }
   val letterScatterCount = trivia.PowerPlays.filter { it.PowerType == PowerType.LETTER_SCATTER }.sumOf { it.Count }
   ```
   Bombles, bug, lockdown and disco are summed the same way later in the routine.

6. Reset all per-button overlays: `reset()` on nibblers, ice, gloop, zipper, letter-scatter (all four each).

7. Map answers by index:
   ```kotlin
   val answerByIndex = trivia.Answers.associateBy { it.DisplayIndex }
   ```
   Duplicate `DisplayIndex` values: last one wins. Indexes outside 0..3 are ignored silently.

8. For each button index 0..3:
   - If an answer exists: `text = DisplayText`, `visibility VISIBLE`, `alpha 1.0`, `isEnabled true`, and set the click listener (section 5).
   - Then, for that answer's button only, activate the overlays (section 7 gives the rules): letter-scatter or nibblers; ice if `freezeCount > 0`; gloop if `gloopCount > 0`; zipper if `zipperCount > 0`.
   - If no answer exists: `visibility = INVISIBLE` (keeps its place, so a 50/50 layout leaves blank cells).

   Letter scatter wins over nibblers:
   ```kotlin
   if (letterScatterCount > 0) {
       letterScatterOverlays[index].activate(answer.DisplayText, index, nibblersCount)
       button.setTextColor(Color.TRANSPARENT)
   } else if (nibblersCount > 0) {
       nibblersOverlays[index].activate(nibblersCount, index, answer.DisplayText)
       button.setTextColor(Color.TRANSPARENT)
   }
   ```
   Every overlay is applied to every answered button. No per-target selection exists in the trivia screen. Inference: `PowerPlayTargets` and `Culprits` are therefore not represented.

9. Gloop interceptor: `if (gloopCount > 0) setupGloopInterceptor(buttons)` (section 8.4).

10. Full-screen overlays:
    - Bombles: if `bomblesCount > 0`, `activate(bomblesCount)` and set `onBombleTouched`. Else `deactivate()`.
    - Bug: if `bugCount > 0`, `activate(bugCount)`. Else `reset()`.
    - Lockdown: if `lockdownCount > 0`, `activate(lockdownCount * 3)`. Else `reset()`.
    - Disco: if `discoCount > 0`, `activate()`. Else `reset()`.

    Not reset on a new trivia with no gloop: `gloopTouchInterceptor` (section 9).

11. Timer (section 5.4).

Point 10: `binding.lockdownOverlay.activate(lockdownCount * 3)`, so lock count = `lockdownCount * 3`, clamped to 1..6 inside the overlay.

---

## 5. Answering mechanics

### 5.1 Tapping an answer (click listener, lines ~128-141)

```kotlin
button.setOnClickListener {
    if (answered || penaltyActive) return@setOnClickListener

    if (isFinals && !answer.IsCorrect) {
        onWrongAnswer(buttons)
    } else {
        answered = true
        timer?.cancel()
        val answerTime = (SystemClock.elapsedRealtime() - questionStartTime) / 1000.0
        highlightSelected(buttons, index)
        Log.d("TriviaAnswering", "Selected answer $index: ${answer.DisplayText} (${answerTime}s)")
        networkManager.sendTriviaAnswer(answer.DisplayIndex, answerTime, wrongAnswerCount)
    }
}
```

- Non-finals (`RoundType != 5`): `IsCorrect` is ignored. Any tap is sent to the server immediately as the answer. The server decides correctness. The client never shows correct or incorrect.
- Finals (`RoundType == 5`): a wrong tap (`IsCorrect == false`) is handled locally (5.2) and nothing is sent. A correct tap is sent.
- `answerTime` is computed before `highlightSelected`.

### 5.2 Wrong answer in finals: `onWrongAnswer` (lines ~240-261)

```kotlin
private fun onWrongAnswer(buttons: List<Button>) {
    wrongAnswerCount++
    penaltyActive = true
    Log.d("TriviaAnswering", "Wrong answer #$wrongAnswerCount, 1.9s penalty")
    binding.wrongAnswerOverlay.visibility = View.VISIBLE
    buttons.forEach { it.isEnabled = false }
    handler.postDelayed({
        if (_binding == null) return@postDelayed
        binding.wrongAnswerOverlay.visibility = View.GONE
        penaltyActive = false
        buttons.forEach { button ->
            if (button.visibility == View.VISIBLE) {
                button.isEnabled = true
            }
        }
    }, 1900)
}
```

- Retry: yes, unlimited. After 1900 ms the player can tap again. No cap on wrong taps.
- Counter: `wrongAnswerCount` counts finals wrong taps only. It is sent as `NumWrongAnswers` with the eventual correct answer (5.6).
- Visual: `wrongAnswerOverlay` shows instantly (no fade) and hides instantly after 1900 ms. All four buttons get `isEnabled = false` for the penalty.
- Overlay blocks touches while visible (`clickable=true`).
- The timer keeps running during the penalty.
- No network message is sent on a wrong finals answer.

### 5.3 Bombles penalty: `onBombleTouched` (lines ~264-281)

```kotlin
private fun onBombleTouched(buttons: List<Button>) {
    penaltyActive = true
    Log.d("TriviaAnswering", "Bomble touched! 1.9s penalty")
    binding.bomblesExplosionOverlay.visibility = View.VISIBLE
    buttons.forEach { it.isEnabled = false }
    handler.postDelayed({
        if (_binding == null) return@postDelayed
        binding.bomblesExplosionOverlay.visibility = View.GONE
        penaltyActive = false
        buttons.forEach { button ->
            if (button.visibility == View.VISIBLE) {
                button.isEnabled = true
            }
        }
    }, 1900)
}
```

Invoked from `bomblesOverlay.onBombleTouched`, which is set in `displayTrivia`:

```kotlin
binding.bomblesOverlay.onBombleTouched = {
    if (!answered && !penaltyActive) {
        onBombleTouched(buttons)
    }
}
```

- Applies in both normal and finals rounds. No `isFinals` check.
- Not counted in `wrongAnswerCount`. Not sent. Not reported.
- The touched bomble is not removed. It keeps moving.
- Touches inside a bomble are consumed by the bombles overlay (8.6). The explosion overlay then blocks everything for 1.9 s.

### 5.4 Automatic no-answer on timeout (lines ~224-236)

```kotlin
timer?.cancel()
val durationMs = (trivia.QuestionDuration * 1000).toLong()
timer = object : CountDownTimer(durationMs, durationMs) {
    override fun onTick(millisUntilFinished: Long) {}
    override fun onFinish() {
        if (_binding == null || answered) return
        answered = true
        Log.d("TriviaAnswering", "Time expired, sending no-answer")
        networkManager.sendTriviaAnswer(-1, trivia.QuestionDuration)
    }
}.start()
```

- Duration: `QuestionDuration` seconds × 1000, truncated to a Long millisecond count.
- Starts at the end of `displayTrivia`, after the overlays are set up.
- On expiry, sends `ChosenAnswerDisplayIndex = -1`, `AnswerTime = QuestionDuration` (the full server duration, not the elapsed time), and `NumWrongAnswers` defaults to `0`, even if finals wrong taps happened.
- Fires during a penalty too: `onFinish` checks only `answered`, not `penaltyActive`.
- No visual feedback. The screen just waits.
- Platform note (Android `CountDownTimer`, not in this repo): a duration ≤ 0 calls `onFinish` immediately.

### 5.5 `AnswerTime` (units and origin)

```kotlin
val answerTime = (SystemClock.elapsedRealtime() - questionStartTime) / 1000.0
```

- Units: seconds, as a `Double`.
- Origin: `questionStartTime` is `SystemClock.elapsedRealtime()` at the top of `displayTrivia`. That is the device's own clock when the trivia was displayed, not the server's question start. `elapsedRealtime` is milliseconds since boot, including sleep.
- The value is taken at tap time. It is not clamped to `QuestionDuration`.
- Penalty time (1.9 s per finals wrong tap, or a bomble touch) is included in `AnswerTime` because nothing subtracts it.

### 5.6 After answering

- `answered = true`; timer cancelled.
- `highlightSelected(buttons, selectedIndex)` (lines ~283-288):
  ```kotlin
  buttons.forEachIndexed { index, button ->
      button.alpha = if (index == selectedIndex) 1.0f else 0.3f
  }
  ```
  Only the selected button stays at alpha 1.0. The others go to 0.3. Invisible buttons are untouched.
- Buttons are not disabled. Further taps are blocked by `answered`.
- Overlays keep running. Bombles keep moving. Bomble taps are ignored because of `!answered`.
- No waiting text is shown. `waiting_for_other_players` and `done_waiting` strings are not referenced here.
- The screen waits for `ClientHoldingScreenCommandMessage` (1.4), then pops.
- Finals correct answer: same path as non-finals. `NumWrongAnswers` holds the finals wrong-tap count.

### 5.7 Where `IsCorrect` is used

Only in `if (isFinals && !answer.IsCorrect)` (5.1). Non-finals never read it. The client never displays correctness and never sends `IsCorrect` back.

### 5.8 FIFTY_FIFTY, POINTS_DOUBLER, POINTS_PARTY

- Not found in `TriviaAnsweringFragment`: no reference to `FIFTY_FIFTY`, `POINTS_DOUBLER` or `POINTS_PARTY` (only comment text, line ~222).
- The only comment says: `POINTS_DOUBLER / POINTS_PARTY / FIFTY_FIFTY: server adjusts scoring, no overlay`.
- The client does not hide any wrong answers. Buttons present in `Answers` (by `DisplayIndex`) are shown and others are `INVISIBLE` (section 4, step 8). Whether the server sends only two answers for 50/50 is not determinable from this client.
- The power-play picker (`PowerPlayFragment`) and the debug launcher treat 50/50 as a self-targeted power play. That is not part of the trivia screen.

---

## 6. Outbound messages

### 6.1 `ClientTriviaAnswer` (`GameMessages.kt` lines 565-584)

```kotlin
@Serializable
data class ClientTriviaAnswer(
    override val TypeString: String = "KnowledgeIsPower.ClientTriviaAnswer",
    val ChosenAnswerDisplayIndex: Int,
    val AnswerTime: Double,
    val NumBombsExploded: Int = 0,
    val PaintCleared: Boolean = false,
    val IceCleared: Boolean = false,
    val NumWrongAnswers: Int = 0,
    val TotalPaintLayersPerAnswer: Int = 0,
    val PaintLayersClearedAnswer0: Int = 0,
    val PaintLayersClearedAnswer1: Int = 0,
    val PaintLayersClearedAnswer2: Int = 0,
    val PaintLayersClearedAnswer3: Int = 0,
    val TotalIceLayersPerAnswer: Int = 0,
    val IceLayersClearedAnswer0: Int = 0,
    val IceLayersClearedAnswer1: Int = 0,
    val IceLayersClearedAnswer2: Int = 0,
    val IceLayersClearedAnswer3: Int = 0
) : GameMessage()
```

Fields actually set by the trivia screen: `ChosenAnswerDisplayIndex`, `AnswerTime`, `NumWrongAnswers`. Everything else keeps its default.

- `NumBombsExploded`, `PaintCleared`, `IceCleared`, `TotalPaintLayersPerAnswer`, `PaintLayersClearedAnswer0..3`, `TotalIceLayersPerAnswer`, `IceLayersClearedAnswer0..3`: never set by any code in `java`. Searched for `IceCleared`, `NumBombsExploded`, `PaintCleared`, `PaintLayers`, `IceLayers`: only the declaration matched. So overlay clearing is never reported to the server.

### 6.2 `NetworkManager.sendTriviaAnswer` (lines 401-410)

```kotlin
fun sendTriviaAnswer(answerIndex: Int, answerTime: Double, numWrongAnswers: Int = 0) {
    Log.d(TAG, "Trivia answer: index=$answerIndex time=$answerTime wrongAnswers=$numWrongAnswers")
    scope.launch {
        protocolClient?.sendMessage(ClientTriviaAnswer(
            ChosenAnswerDisplayIndex = answerIndex,
            AnswerTime = answerTime,
            NumWrongAnswers = numWrongAnswers
        ))
    }
}
```

Call sites in the trivia screen:
- Tap: `networkManager.sendTriviaAnswer(answer.DisplayIndex, answerTime, wrongAnswerCount)` (line ~139).
- Timeout: `networkManager.sendTriviaAnswer(-1, trivia.QuestionDuration)` (line ~235). `numWrongAnswers` defaults to `0`.

Fire and forget: no reply is awaited, no retry in this path. `protocolClient` is nullable; a null client is a silent no-op.

### 6.3 Transport (`ProtocolEncoder.kt`, `GameProtocolClient.kt`)

Serialisation (`ProtocolEncoder.encodeJson`): `kotlinx.serialization` with `Json { ignoreUnknownKeys = true; encodeDefaults = true }`. So every field is written, defaults included, and `TypeString` is the first member.

Message body (`encodeMessage`):
```kotlin
fun encodeMessage(msg: GameMessage): List<ByteArray> {
    val jsonBytes = encodeJson(msg)
    val body = ByteBuffer.allocate(jsonBytes.size + 10).order(ByteOrder.LITTLE_ENDIAN)
    body.put(bodyMagic)        // KIP: 0x33 0x29
    body.put(TYPE_JSON)        // 0xB1 0xE2 0xFF 0xFF
    body.putInt(jsonBytes.size)
    body.put(jsonBytes)
    return wrapAndChunk(body.array())
}
```

Packet header (`buildPacket`, 22 bytes, little-endian):
```kotlin
buffer.put(packetMagic)        // KIP: 0xAE 0x7F
buffer.putInt(messageId)
buffer.putInt(packetNum)
buffer.putInt(packetIdx)
buffer.putInt(payload.size)
buffer.putInt(byteOffset)
buffer.put(payload)
```

Chunking: `fragmentSize = 1002` payload bytes per packet; `messageId = ++messageCounter`.

Transport: UDP to the server port `9066` (default), listen port `9060` (`GameProtocolClient` constructor). Connection request: 38 bytes (`MAGIC_ACK` 0x8A 0x33, int -1, 32 zero bytes). A background thread sends an ACK with the last received message id once per second (`Thread.sleep(1000)`).

Only the magic constants differ for Decades mode (`0xC1 0x48`, `0xA3 0xD3`). Set by `InterfaceVersionMessage` prefix `KIP2_` (not for this screen).

### 6.4 Illustrative wire JSON (derived from the serializer, not captured)

A correct tap on index 1 after 3.456 s, with 2 finals wrong taps:

```json
{"TypeString":"KnowledgeIsPower.ClientTriviaAnswer","ChosenAnswerDisplayIndex":1,"AnswerTime":3.456,"NumBombsExploded":0,"PaintCleared":false,"IceCleared":false,"NumWrongAnswers":2,"TotalPaintLayersPerAnswer":0,"PaintLayersClearedAnswer0":0,"PaintLayersClearedAnswer1":0,"PaintLayersClearedAnswer2":0,"PaintLayersClearedAnswer3":0,"TotalIceLayersPerAnswer":0,"IceLayersClearedAnswer0":0,"IceLayersClearedAnswer1":0,"IceLayersClearedAnswer2":0,"IceLayersClearedAnswer3":0}
```

Timeout: `"ChosenAnswerDisplayIndex":-1`, `"AnswerTime"` equals `QuestionDuration`, `"NumWrongAnswers":0`.

### 6.5 Never sent by this screen

- Anything about overlays (ice, paint, bombs, layers).
- Wrong finals taps individually (only the count, at answer time).
- `QuestionID`.
- Any "waiting" or "ready" message.

---

## 7. Power-play dispatch (what the trivia screen does per `PowerType`)

| PowerType (value) | Handled on trivia screen? | Implementation | Scope |
|---|---|---|---|
| FREEZE (4) | Yes | `IceOverlayView` per answer | Every answered button |
| BOMBLES (5) | Yes | `BomblesOverlayView` full screen + explosion overlay | Full screen |
| NIBBLERS (6) | Yes | `NibblersOverlayView` per answer (suppressed when LETTER_SCATTER present) | Every answered button |
| GLOOP (7) | Yes | `GloopOverlayView` per answer + interceptor | Every answered button |
| DOUBLE_TROUBLE_FREEZE_GLOOP (10) | No | Not matched | Nothing |
| DOUBLE_TROUBLE_FREEZE_BOMBLES (11) | No | Not matched | Nothing |
| DOUBLE_TROUBLE_NIBBLERS_GLOOP (12) | No | Not matched | Nothing |
| NONE (-1) and unknown ints | No | `fromValue` returns `NONE` | Nothing |
| BET (1) | No | Not matched | Nothing |
| POINTS_PARTY (8) | No | Comment only | Nothing |
| LOCKDOWN (20) | Yes | `LockdownOverlayView` full screen | Full screen |
| ZIPPERS (22) | Yes | `ZipperOverlayView` per answer | Every answered button |
| BUG (24) | Yes | `BugOverlayView` full screen | Full screen |
| POINTS_DOUBLER (25) | No | Comment only | Nothing |
| FIFTY_FIFTY (26) | No | Comment only | Nothing |
| LETTER_SCATTER (28) | Yes | `LetterScatterOverlayView` per answer | Every answered button |
| DISCO_INFERNO (29) | Yes | `DiscoOverlayView` full screen | Full screen |

Double Trouble (10, 11, 12) is not decomposed on the client. The code comment says: `DOUBLE_TROUBLE variants: server sends the component types (FREEZE+GLOOP etc.) individually`. So the server must send two separate entries (for example FREEZE and GLOOP). Sending only the DT value shows nothing.

Counts are sums over all entries of a type. Several players' power plays stack.

---

## 8. Overlay specifications

Common facts:
- Overlays are applied to every answered button. No target selection.
- Nothing reports overlay state to the server (section 6.1).
- Only the per-button `Button` draws text. When NIBBLERS or LETTER_SCATTER is active, the button's own text colour is set to `TRANSPARENT` and the overlay draws the text instead. The button keeps its layout size.
- Animation: frame-based (`postOnAnimation`). Speeds are per frame, so they run faster on high-refresh displays. A web port should decide whether to keep per-frame or convert to time-based.

### 8.1 Ice (FREEZE, type 4): `IceOverlayView`

Count: `freezeCount` summed. Per-button `activate(freezeCount, index)`.

Kotlin, activation:
```kotlin
fun activate(count: Int, viewSeed: Int) {
    tapsNeeded = 5 * count.coerceAtLeast(1)
    tapCount = 0
    seed = viewSeed.toLong()
    state = State.FROZEN
    crackSegments.clear()
    frostVeins.clear()
    crystals.clear()
    visibility = VISIBLE
    alpha = 1f
    generateFrost()
    invalidate()
}
```

- Layers: `tapsNeeded = 5 × count` taps, each tap = one layer step. Count 1 → 5 taps, 2 → 10 taps.
- Seed = button index (deterministic frost).

Frost generation (`generateFrost`, `generateDendrites`, `growBranch`):
- Edge dendrites: `edgeCount = 8 + rng.nextInt(6)` → 8 to 13 roots. Each root starts at a random point on one of the four edges with base angles 90 (top), 180 (right), 270 (bottom), 0 (left).
- `growBranch` with `maxDepth = 3`: `segments = 3 + rng.nextInt(4)` (3 to 6). Each segment turns `-30 + rand*60` degrees, length `(12 + rand*20) * lenScale`, where `lenScale = 1 / (1 + depth*0.6)`. Sub-branch chance `rng.nextFloat() < 0.45f` when `depth < maxDepth`; branch angle = current ± `(40 + rand*30)`.
- Crystals: 15 stars at random positions, `size = 4 + rand*10`, random rotation, 6 spokes. Barbs on spokes only when `size > 6`: barb length `size*0.35`, at ±45°, from `size*0.55`.

Tap handling (`onTouchEvent`):
```kotlin
override fun onTouchEvent(event: MotionEvent): Boolean {
    if (state == State.SHATTERED) return false
    if (event.action == MotionEvent.ACTION_DOWN) {
        tapCount++
        generateCracks(event.x, event.y)
        state = State.CRACKING
        if (tapCount >= tapsNeeded) shatter() else invalidate()
        return true
    }
    return true // consume all touches while frozen
}
```
- Taps are counted on `ACTION_DOWN` only.
- Each tap adds a crack network at the tap point: `branchCount = 3 + rng.nextInt(3)` (3 to 5); each branch has `segmentCount = 4 + rng.nextInt(5)` (4 to 8) segments of length `15 + rand*30`, angle step `-40 + rand*80`; sub-branch chance 0.4 at ±45°, length `10 + rand*20`. Random seed per tap: `seed + tapCount * 31`.
- While FROZEN, the overlay consumes all touches inside its bounds. Taps on that button do not answer it.

Shatter:
```kotlin
private fun shatter() {
    state = State.SHATTERED
    ValueAnimator.ofFloat(1f, 0f).apply {
        duration = 200
        addUpdateListener { anim ->
            alpha = anim.animatedValue as Float
            if (alpha <= 0f) {
                visibility = GONE
                onIceShattered?.invoke()
            }
        }
        start()
    }
}
```
- `onDraw` returns immediately when SHATTERED, so the ice vanishes at once. `onTouchEvent` returns false from that point, so the button is tappable immediately. The 200 ms alpha fade is not visible.
- `onIceShattered` is set to null in the trivia screen.

Drawing (`onDraw`, clipped to a rounded rect with radius `16dp`):
- Base fill: `#88CADFEA`.
- Edge frost: vertical and horizontal gradients from each edge, depth `min(w,h) * 0.18`, colour `#88FFFFFF` fading to transparent.
- Veins: stroke `#88FFFFFF`, width 1.5 px, round caps, with a glow stroke `#30FFFFFF`, width 4 px, under each vein.
- Crystals: stroke `#99FFFFFF`, width 1.2 px, round caps.
- Edge outline: round rect inset 1 px, stroke `#66D0ECF4`, width 2 px, radius 16dp.
- Cracks: stroke `#DDFFFFFF`, width 2.5 px, round caps, with a glow stroke `#44FFFFFF`, width 6 px.

Resize: `onSizeChanged` rebuilds frost if not SHATTERED. Before layout, `activate` uses a fallback of 400×200 px.

Not found: a visible "layer count" indicator. Dead code: `crystalFillPaint` is declared but unused.

### 8.2 Nibblers (NIBBLERS, type 6): `NibblersOverlayView`

Count: `nibblersCount` summed. Per-button `activate(nibblersCount, index, answerText)`. Not used when LETTER_SCATTER is present (8.3).

Kotlin:
```kotlin
fun activate(count: Int, viewSeed: Int, text: String) {
    layerCount = count.coerceAtLeast(1)
    seed = System.currentTimeMillis() + viewSeed * 31L
    this.text = text
    active = true
    visibility = VISIBLE
    if (width > 0 && height > 0) generateNibbledText()
    invalidate()
}
```

Bite generation (`generateNibbledText`):
- Text bitmap, ARGB_8888, size = view size.
- Text paint: white, `textSize = 42f * scaledDensity` (42sp), `Typeface.DEFAULT_BOLD`, centred.
- `hPad = 58dp`. `textWidth = w - 2*hPad`. Layout: `StaticLayout`, centre-aligned, drawn at `(hPad, (h - layout.height)/2)`.
- Bites: `biteCount = 2 + layerCount * 2`. Each bite picks a random line, `cx` in `[lineLeft, lineRight]`, `cy` in `[lineTop, lineBottom]`, `baseRadius = lineHeight * (0.17 + rand*0.14)`. Cluster of `2 + rng.nextInt(3)` (2 to 4) circles, each at offset `(rand - 0.5) * baseRadius * 1.35`, radius `baseRadius * (0.59 + rand*0.59)`, drawn with `PorterDuff.Mode.CLEAR`.
- Seed: `System.currentTimeMillis() + viewSeed*31`, so bites differ every time.

Interaction: none. No `onTouchEvent`, so taps pass through to the button. Nibbles are never cleared; they stay for the whole question.

Text-size mismatch: the button is 34sp, the nibbled text is 42sp (× scaledDensity). The nibbled text is about 1.24× larger than the button text it replaces. Keep it for 1:1 (section 9).

### 8.3 Letter Scatter (LETTER_SCATTER, type 28): `LetterScatterOverlayView`

Count: presence only (`letterScatterCount > 0`). Per-button `activate(answerText, index, nibblersCount)`. The `nibblersCount` argument is used for holes.

- Draws the answer text one character at a time, each with a random vertical offset and rotation. Static after layout. No per-frame motion (despite the class comment "dancing").
- Text: `textSize = 42f * scaledDensity`, `isFakeBoldText = true`, white, centred per character, `letterSpacing = 0.05f`, typeface `Typeface.create(Typeface.DEFAULT_BOLD, BOLD)`. Comment says "rounded", but no rounded font is loaded (section 9).

Layout (`layoutChars`, run in `post {}` and on resize):
- `hPad = 58dp`, `availW = width - 2*hPad`, `centerY = height / 2`.
- If total width exceeds `availW`: `textSize *= (availW / totalWidth) * 0.95`. This mutates the paint in place, so repeated layout passes shrink again.
- Characters are laid out left-to-right, centred: `x = (width - scaledTotal)/2`, cumulative.
- `baseY = centerY + textSize * 0.35`.
- `yOffset = (rand - 0.5) * 2 * maxShift`, `maxShift = textSize * 0.25`.
- `rotation = (rand - 0.5) * 14` degrees (±7°), around pivot `(x, baseY + yOffset - textSize*0.35)`.
- Seed: `System.currentTimeMillis() + viewSeed*31`, then `Random(seed + 777)` for layout.

Holes (when `nibbleCount > 0`):
- `holeCount = 2 + nibbleCount * 2`. Each picks a random character, `cx = charX + (rand-0.5)*charWidth*1.5`, `cy = baseY + (rand-0.5)*textSize*0.6`, `baseR = textSize * (0.12 + rand*0.1)`, cluster of 2 to 4 holes of radius `baseR * (0.5 + rand*0.6)`.
- Drawn by rendering the text to an offscreen bitmap, then clearing the holes.

Interaction: none (no `onTouchEvent`). Taps pass through to the button.

### 8.4 Gloop (GLOOP, type 7): `GloopOverlayView` and the touch interceptor

Count: `gloopCount` summed. Per-button `activate(gloopCount, index)`. "Layers" are `layerCount = count`, which only changes brush width (below), not the number of layers.

Activation:
```kotlin
fun activate(count: Int, viewSeed: Int) {
    layerCount = count.coerceAtLeast(1)
    seed = viewSeed.toLong() + 500
    active = true
    cleared = false
    grid.fill(false)
    visibility = VISIBLE
    alpha = 1f
    if (width > 0 && height > 0) generateGloop()
    invalidate()
}
```

Appearance (`generateGloop`, art generated once per activation, seeded):
- Base blobs: 18 ovals, colour `#EE4CAF50`. Centre random in the view. Radius `rx = w*0.2 + rand*w*0.35`, `ry = h*0.2 + rand*h*0.35`.
- Light patches: 14 ovals, `#AA81C784`. `rx = 12px + rand*w*0.12`, `ry = 8px + rand*h*0.1`.
- Dark patches: 10 ovals, `#DD388E3C`. `rx = 10px + rand*w*0.1`, `ry = 6px + rand*h*0.08`.
- Highlights: 8 circles, `#5500E676`, radius `4px + rand*10px`.
- Edge splatters: 10 circles, `#EE4CAF50`, placed within 15% of one of the four edges, radius `8px + rand*20px`.
- Clipped to a rounded rect of radius `16dp` (the button corner is 8dp; section 3.4).

Brush and coverage:
```kotlin
eraserPaint.strokeWidth = min(wf, hf) * 0.18f * 1.2f / layerCount
```
- Stroke: `CLEAR` xfermode, round caps and joins, width `min(w,h) * 0.216 / layerCount`. Radius = half that.
- Coverage grid: 10 columns × 6 rows = 60 cells per gloop overlay. Each erase marks the cells under the brush circle, and line segments are sampled every `radius * 0.5`.
- Cleared when `clearedCells >= grid.size * 0.65f`, that is 39 of 60 cells:
  ```kotlin
  if (clearedCells >= grid.size * 0.65f) {
      cleared = true
      ValueAnimator.ofFloat(1f, 0f).apply {
          duration = 200
          ...
          if (alpha <= 0f) { visibility = GONE; onGloopCleared?.invoke() }
      }
  }
  ```
- Clearing is a 200 ms alpha fade. The overlay stays until the fade ends, then goes `GONE`. Unlike ice, the gloop bitmap is still drawn during the fade.

Interceptor (`gloopTouchInterceptor`, the full-screen `View` at 9.5dp):
- Shown by `setupGloopInterceptor(buttons)` when any gloop is active. Its listener handles all gesture input, because the interceptor is above every answer.
- Touch handling (`setOnTouchListener`, lines ~310-356):
  - `ACTION_DOWN`: save raw screen point (`rawX`, `rawY`), `gloopMoved = false`, `lastGloopTarget = null`. Find the gloop overlay under the point (`findGloopAt`). If found, call `handleSwipe(localX, localY, isNewContact = true)`. Return `true` (always consumes).
  - `ACTION_MOVE`: if squared displacement from the down point `dx*dx + dy*dy > 20*20` (20 raw px), set `gloopMoved = true` (sticky). Find overlay under the point; if found, `handleSwipe(..., isNewContact = hit != lastGloopTarget)`, then `lastGloopTarget = hit`. Return `true`.
  - `ACTION_UP`: if `!gloopMoved`, find the button under the point (`findButtonAt`, first VISIBLE button whose rect contains the point) and call `performClick()` on it. Then `lastGloopTarget = null`. Return `true`.
  - Other actions: return `true`.
- So a tap (no movement beyond 20 px) on any answer forwards a click to that answer, even when that answer is covered by gloop, ice, zipper or nibblers. The same tap also erases a brush dab at the touch point (`ACTION_DOWN`).
- The forwarded click is guarded only by `answered || penaltyActive`, the same guard as a direct tap.
- Hide: each gloop overlay's `onGloopCleared` runs `if (gloopOverlays.none { it.visibility == VISIBLE }) gloopTouchInterceptor.visibility = GONE`. So the interceptor stays until the last gloop is gone.
- While the interceptor is visible, it takes every touch on the screen. That disables ice taps, zipper drags and nibbler/letter-scatter taps in the grid (taps on those answers are forwarded as plain clicks, bypassing the overlay). Bombles, bug, lockdown and wrong-answer overlays are above it and still block as usual.

Wiping (`handleSwipe`):
- `isNewContact`: `eraseAt(x, y)` draws a dab circle of radius = brush/2, marks cells, and checks coverage.
- Otherwise: draws a line from the last point to the current point with the eraser, marks cells along the segment, and checks coverage.
- Inside a gloop overlay, touches on that overlay's coordinates only. `handleSwipe` returns immediately when `!active || cleared`.
- Gesture crosses overlays: moving onto a different overlay starts a new contact there (a dab), not a line from the previous overlay.

### 8.5 Zippers (ZIPPERS, type 22): `ZipperOverlayView`

Count: presence only; `count` argument is unused. Per-button `activate(zipperCount, index)`. `seed` is set but the denim seed parameter is unused in drawing.

Interaction (all taps inside the button frame):
- `onTouchEvent`: if `!active` return `false`. Otherwise consumes every event (`return true`).
- `ACTION_DOWN` near the pull: pull centre `pullX = 0.12w + openFraction * (w - 0.24w)`, `midY = h/2`. Grab radius `pullRadius * 2.5 = h*0.18*2.5 = 0.45h`. Within that radius sets `dragging = true` and records `dragStartX`. Otherwise consumes without dragging.
- `ACTION_MOVE` while dragging: `openFraction = clamp(openFraction + deltaX / (w*0.75), 0, 1)`, then `dragStartX = event.x`.
- `ACTION_UP` / `ACTION_CANCEL`: `dragging = false`. If `openFraction > 0.85`, call `openFully()`. Otherwise the partial opening stays (no snap back).

Full open (`openFully`):
- Sets `active = false` immediately, then fades `alpha` from current value to 0 over 200 ms.
- `onDraw` returns early when `!active`, so the zipper disappears instantly. `onTouchEvent` returns `false` at once, so touches reach the answer. The 200 ms fade is not visible.
- Calls `onZipperOpened` at the end (null in the trivia screen).
- Nothing is reported to the server.

Drawing (`onDraw`, clipped to rounded rect radius `16dp`):
- Gap (only when `openFraction > 0.01`): rounded rect from `x = 0.12w` to `pullX`, `y = midY ± 0.35h*openFraction`, radius 8 px, colour `#F5F0E0`.
- Denim halves: top `(0, 0)–(w, midY - trackH - toothH)`, bottom `(midY + trackH + toothH)–(h)`. Vertical gradient `#3088B8` to `#2878A8`. Stitch dashes: colour `#3080C0E0`, width `1.5dp`, dash `4dp`, gap `3dp`, inset `8dp` from each side, at `4dp` from the inner edge.
- Flaps (only when partially open): `#2878A8` strips of height `0.35h*openFraction*0.15` along the gap edges.
- Track: rect `(0, midY - trackH)`–`(w, midY + trackH)`, colour `#C8A830`, edges `#A08020` width 1.5 px. `trackH = h*0.06`.
- Teeth (only right of the pull): `toothH = h*0.1`, `toothW = w*0.018`, `spacing = toothW*2.2`. Top teeth at `tx = pullX + spacing, +spacing, ...` in `#D4B840`, round rect radius 2 px, with a shadow strip `#A08020` over the right 40% of each tooth. Bottom teeth offset by half a spacing.
- Pull tab at `(pullX, midY)`, `size = h*0.16`: teardrop body `#E0C850` with edge `#907018` width 2 px, body width `0.7*size`, height `1.3*size`; highlight circle `#F0E080` radius `0.15*size`; ring `#D4B840`, stroke `0.12*size`, radius `0.18*size`, centred above the body.

Not found: any "zipping" animation beyond the 200 ms fade. Dead code: `denimSeed` unused.

### 8.6 Bombles (BOMBLES, type 5): `BomblesOverlayView` and the explosion

Count: `bomblesCount` summed. Full-screen `activate(bomblesCount)`.

Number of bombles: `numBombles = (count * 2 + 4).coerceIn(6, 10)` (6 for 1, 8 for 2, 10 for 3 or more).

Kotlin:
```kotlin
val numBombles = (count * 2 + 4).coerceIn(6, 10)
val baseSize = 50f * density
val size = baseSize * (0.85f + rng.nextFloat() * 0.3f)  // 42.5 to 57.5 dp
val speed = (1.5f + rng.nextFloat() * 2f) * density      // 1.5 to 3.5 dp per frame
val rotationSpeed = -1.5f + rng.nextFloat() * 3f         // -1.5 to +1.5 deg per frame
val spikeOffsets = FloatArray(8) { 0.9f + rng.nextFloat() * 0.25f }
```
- Start: along a random edge at distance `size` from it. Random direction.
- Seed: `Random(System.currentTimeMillis())`.
- Before layout, `activate` falls back to 800×1200 px for `w`, `h`. Bombles are not rebuilt on resize; the first frame clamps them into bounds (section 9).

Motion (`updatePositions`, per frame via `postOnAnimation`):
- `x += vx`, `y += vy`, `rotation += rotationSpeed`.
- Bounce at `margin = size * 0.4` from each edge: clamp and flip the velocity component.

Appearance (`drawBomble`, rotated by `rotation`):
- Body radius `R = 0.45 * size`, colour `#2A2A2A`.
- Spikes: 8 at 45° steps. Inner `0.8R`, outer `1.45R * spikeOffset` (0.9 to 1.15). Line stroke `#FFD600`, width `0.1*size`, round caps. Tip circle `#FFC107`, radius `0.06*size`.
- Highlight: `#3D3D3D` circle radius `0.65R` at `(-0.15R, -0.15R)`.
- Seams: `#1A1A1A`, stroke `0.025*size`. Arc 1: rect `(±0.6R, ±0.95R)`, from -90° sweep 180°. Arc 2: rect `(±0.95R, ±0.4R)`, from 0° sweep 180°.
- Left eye: white radius `0.26R` at `(-0.22R, -0.12R)`; pupil `#000` radius `0.45*0.26R` at `(-0.17R, -0.07R)`.
- Right eye: white radius `0.2R` at `(0.18R, -0.18R)`; pupil radius `0.45*0.2R` at `(0.21R, -0.14R)`.

Touch (`onTouchEvent`):
```kotlin
if (event.action == MotionEvent.ACTION_DOWN) {
    for (b in bombles) {
        val dx = event.x - b.x
        val dy = event.y - b.y
        val touchRadius = b.size * 0.8f
        if (dx * dx + dy * dy < touchRadius * touchRadius) {
            onBombleTouched?.invoke()
            return true
        }
    }
}
return false
```
- Only `ACTION_DOWN` inside a bomble is consumed. Any other touch passes through to the answers.
- Hit radius is `0.8 * size` from the bomble centre.

Penalty: see 5.3. Explosion overlay: `#BBFFFFFF`, text "Don't touch the bombs!" (42sp bold `#333333`), 1.9 s, blocks taps, buttons disabled.

Clearing: not found. Bombles are never removed; they stay until the question ends or the overlay is deactivated.

### 8.7 Bug (BUG, type 24): `BugOverlayView`

Count: `bugCount` summed. `activate(count)`, with `count.coerceIn(1, 6)` bugs.

Setup (in `post {}`, once laid out):
- `bugRadius = width * 0.12`.
- Bug positions: `margin = bugRadius * 1.5`, `x, y` uniform in `[margin, w - margin]` × `[margin, h - margin]`. `wobblePhase = rand * 6.28`.
- `rng = Random(System.currentTimeMillis())` at construction.
- Scrambled rectangles: 40 of them.
  - `x, y` uniform on the view. `width = 40dp + rand*80dp`, `height = 25dp + rand*40dp`, `rotation = -30 + rand*60` degrees.
  - Colour: one of `#5A3D7A`, `#7A5A9A`, `#4A2D6A`, `#6A4A8A`, `#3A1D5A`, `#8A6AAA`.
  - Text: `if (rng.nextFloat() > 0.4f)` pick from `["Sna","Fli","res","OV","Pl","Air","gh","he"]`, else no text. About 60% carry text.
  - Hard-coded English, not in `strings.xml` (section 10).
- Animation: `wobblePhase += 0.08` per frame; `vortexRotation += 0.8` per frame (degrees). Continues while `animating`.

Drawing (`onDraw`):
1. Dim: full-screen rect, `#BB3A1560` (73% purple).
2. Scrambled rects: rotated rounded rect, radius `4dp`, colour as above. Text: `14dp`, fake bold, white, centred at `(0, height*0.15)`.
3. Each bug:
   - Vortex rays: 12 triangles from `0.8R` to `4R` (`rayLength = bugRadius*4`), angular half-width 8°. Colours alternate `#60AA44CC` (even) and `#408833AA` (odd). Whole set rotated by `vortexRotation`.
   - Body: rotated by `sin(wobblePhase)*5°`, scaled by `1 + sin(1.5*wobblePhase)*0.03`.
   - Glow: radial gradient radius `1.6R`, `#8040E0FF` at stop 0.4, to transparent at 1.0.
   - Fuzz: 8 layers, `layer` from 8 down to 0. Radius `R*(0.3 + layer*0.08)`. Alpha `clamp(255 - layer*20, 100, 255)`. Colour base `#40C8E8`. Strokes `20 + layer*4` per layer, at angle `s*360/strokes + layer*15`, from `r - 0.06R` to `r + 0.06R`, width `0.08R`.
   - Core: `#50D0F0`, radius `0.5R`.
   - Antennae: `#80E0FF`, width `0.06R`, from `(∓0.15R, -0.4R)` to `(∓0.4R, -R - 0.21R)`, tips `#80E0FF` radius `0.08R` at the ends.
   - Eyes: white radius `0.22R` at `(-0.2R, -0.1R)` and `(0.2R, -0.1R)`; pupils `#000` radius `0.11R` at `(-0.15R, -0.05R)` and `(0.25R, -0.05R)`.

Touch and clearing:
- `onTouchEvent` returns `false` if not active, otherwise consumes every event (blocks answers under the overlay).
- `ACTION_DOWN` within `bugRadius * 1.5` of a bug: `tapsRemaining--` (starts at 2). If it reaches 0, remove the bug. When the last bug is removed: `active = false`, `animating = false`, `visibility = GONE` (instant), `onBugCleared`.
- Otherwise the bug jumps to a random point in the quadrant opposite its current position. `farRight = bug.x < midX`, `farBottom = bug.y < midY`. X in `[midX, w - margin]` if farRight else `[margin, midX]`. Y likewise.
- Two taps per bug. Taps that miss all bugs are consumed and do nothing.

Not found: any fade on clearing.

### 8.8 Lockdown (LOCKDOWN, type 20): `LockdownOverlayView`

Count: `lockdownCount * 3` passed in, clamped to 1..6 locks (`generateLocks(count.coerceIn(1, 6))`). So LOCKDOWN count 1 → 3 locks, 2 or more → 6 locks.

Setup (in `post {}`):
- Lock size: `lockSize = width * 0.0675`. Touch radius `lockSize * 2`, i.e. `0.135w`.
- Locks: `margin = w*0.15`, `marginY = h*0.15`, `minSpacing = w*0.3`. Positions random in the inset rectangle, retried up to 50 times to keep `minSpacing` apart. Seed: `Random(count*7 + 13)` for the coerced count.
- Chains per lock: `chainCount = 3 + rng.nextInt(3)` (3 to 5).
  - Angle: `30 + rand*30` plus `90 * rng.nextInt(4)` (so 30 to 60, 120 to 150, 210 to 240 or 300 to 330 degrees).
  - Each chain passes through a point offset perpendicular by `(rand - 0.5) * linkW * 2` (±60 dp), where `linkW = 60dp`.
  - Chain line length `2*(w+h)` centred on that point.
  - Links: `linkCount = floor(length / (linkW*0.8))` (spacing 48 dp), placed at `t = i / linkCount` along the line. Links outside the view (plus 2 link sizes) are culled. Each link is rotated by the line angle, plus 90° on odd indices.
  - Link: `60dp × 36dp`, drawn as a rounded rect outline with corner radius 18dp (full pill), stroke `6dp`, colour `#E0C850`, round caps, plus a shadow outline `#60000000` stroke `8dp` offset `(1.5dp, 2dp)`.

Dimming: `canvas.drawRect(..., #66000000)` (40% black) over the whole view when active.

Padlock (`drawPadlock`, `s = lockSize`, centred `(cx, cy)`):
- Shackle `#887010`, stroke `0.16s`, round caps. Arc in rect `(cx ± 0.3s, cy - 0.55s - 0.55s .. cy - 0.3s)`, 180° sweep 180°. Two straight legs from the arc centre down to `cy - 0.25s`.
- Body: rounded rect `(cx ± 0.5s, cy - 0.25s)` to `+0.85s` tall, radius `0.12s`, fill `#A07010`, edge `#604008` stroke `3dp`.
- Highlight: `#C89820` rounded rect at body-relative `(0.08..0.42 w, 0.06..0.38 h)`, radius `0.06s`.
- Keyhole: `#302008` circle radius `0.12s` at body top + `0.48 * bodyH`; triangle slot from `(cx ± 0.054s, keyCy + 0.06s)` to `(cx, keyCy + 0.3s)`.

Clearing:
```kotlin
if (event.action == MotionEvent.ACTION_DOWN) {
    val lockSize = width * 0.0675f
    val touchRadius = lockSize * 2f
    // remove the first lock within touchRadius
    ...
    if (locks.isEmpty()) { active = false; visibility = GONE; onLockdownCleared?.invoke() }
}
return true
```
- One tap per lock. The first lock hit is removed. The overlay consumes every touch (`return true`), so a miss still blocks answers.
- No fade. The last lock disappears instantly.

Lifecycle: `onDetachedFromWindow` sets `active = false`.

### 8.9 Disco Inferno (DISCO_INFERNO, type 29): `DiscoOverlayView`

Count: presence only. Full-screen `activate()`.

Grid: 9 columns × 6 rows = 54 cells.
- Gap: `5dp`. `cellW = (w - gap*10)/9`, `cellH = (h - gap*7)/6`. Cell at `left = gap + col*(cellW+gap)`, `top = gap + row*(cellH+gap)`.
- Background: full-screen `#40000000` (25% black).
- Cell colour: `Color.HSVToColor(alpha, [hue, 1, 1])`. `phase = (hue/60).toInt() % 3`; `alpha = 0x60` (96) for phase 0, `0x48` (72) for phase 1, `0x54` (84) for phase 2.
- Hue init: random 0..360; speed `±(0.5 + rand*1.5)` degrees per frame. Random seed `System.currentTimeMillis()`.
- Per frame: `hue = (hue + speed) mod 360`.
- Flash: every 20 frames (`frameCount % 20 == 0`), `Random(frameCount)`, `flashCount = 2 + rng.nextInt(4)` (2 to 5). Each picks a random cell, sets a random hue, and reverses its speed.
- `discoColors` (8 colours, `#40FF0080` etc.) is declared but unused. Dead code.
- Not touchable. `clickable=false`, no `onTouchEvent`.
- Z 7.5dp: see section 3.1 for its position relative to the grid.

Stop: `reset()` sets `animating = false`, `visibility = GONE`.

### 8.10 Wrong-answer overlay (finals only)

Specified in 3.6 and 5.2. Summary: `#66CC0000` full screen, instant show/hide, 1900 ms, blocks taps while visible, no network message.

### 8.11 Double Trouble (types 10, 11, 12)

- Not decomposed by the trivia screen. No overlay is driven by the DT value itself (section 7).
- Combination is by stacking the component types, which the server must send separately (for example FREEZE + GLOOP for type 10, FREEZE + BOMBLES for 11, NIBBLERS + GLOOP for 12).
- Interactions between the component overlays are as follows. These are all facts of the code.
  - Nibblers and letter scatter: when both are present, letter scatter is drawn and nibbles are applied as holes in letter scatter (`nibbleStacks`). Nibblers' own overlay is not activated.
  - Ice and gloop on the same button: gloop is above ice (9dp vs 8dp). Both are active, but ice gets no touches while the gloop interceptor is visible (8.4). After the last gloop clears, ice takes taps normally.
  - Gloop interceptor vs. ice on other buttons: a tap on an ice-covered button while any gloop is still visible is forwarded as a click to that answer (8.4), so the ice is bypassed.
  - Bombles, bug, lockdown, wrong-answer overlays are above the interceptor and grid. They block or pass touches as specified in each section.

### 8.12 Hit-testing summary

Top to bottom, what gets a touch first:

| Layer | Consumes all touches? | Consumes some touches? | Passes through |
|---|---|---|---|
| Explosion overlay (14dp, visible during bombles penalty) | Yes (clickable) | | |
| Wrong-answer overlay (12dp, visible during finals penalty) | Yes (clickable) | | |
| Bug overlay (11dp, while active) | Yes | | |
| Lockdown overlay (10.5dp, while active) | Yes | | |
| Bombles overlay (10dp) | | Only `ACTION_DOWN` inside a bomble | Everything else |
| Gloop interceptor (9.5dp, while any gloop visible) | Yes | | |
| Disco overlay (7.5dp) | | | Yes (not clickable) |
| Grid, per button, top to bottom: zipper (9.5) | Yes, inside zipper while active | | |
| Grid: gloop (9), no own touches (returns `false`) | | | Yes |
| Grid: ice (8), consumes inside bounds while FROZEN | Yes, inside its frame while FROZEN | | |
| Grid: letter scatter (7.1), nibblers (7) | | | Yes (no touch handler) |
| Grid: answer button | | | Receives tap when nothing above consumes |

Note: the disco overlay sits above the whole grid by Z (section 3.1), so it is visually over the per-button overlays. It does not take touches.

### 8.13 Culprits and PowerPlayPlayers

- Not used by any overlay. No photos, names or avatars are drawn on the trivia screen.
- `PowerPlayPlayers` is not read on this screen.

---

## 9. Quirks and observations (keep for 1:1 or decide)

1. Letter scatter and nibbled text are 42sp, but answer buttons are 34sp. The overlay text is ~24% larger than the button text it replaces.
2. The gloop interceptor is not hidden at the start of a new trivia that has no gloop (`displayTrivia` only calls `setupGloopInterceptor` when `gloopCount > 0`). A stale interceptor can survive into the next question if this screen is reused.
3. `displayTrivia` does not reset `bomblesExplosionOverlay` or cancel the pending penalty `Runnable`. A bomble penalty can leak into the next question.
4. `displayTrivia` does not restore the button text colour. A button that had nibbles or letter scatter stays `TRANSPARENT` on a later question without those power plays (inference; button colour is set only in the activation branch).
5. Bombles are activated before layout when `displayTrivia` runs from `onViewCreated`. `activate` uses the 800×1200 fallback. The bombles are not regenerated on resize (`onSizeChanged` is not overridden), so they stay at fallback positions until the first frame clamps them.
6. Letter scatter's `textSize` is mutated in place during layout, so each relayout can shrink the text again.
7. Ice, zipper and gloop-wipe overlays use a 16dp clip radius, while the buttons are 8dp. The visible shapes do not match the button shape.
8. Zipper and ice disappear immediately on success. Their 200 ms fades are invisible because their draw code returns early.
9. Gloop: a tap on any answer, even covered by gloop, ice or zipper while the interceptor is visible, is forwarded as a click (8.4).
10. `NumWrongAnswers` counts finals wrong taps only, and is 0 on timeout.
11. `AnswerTime` includes penalty time and is measured on the device, not from the server's question start.
12. The timer fires during a penalty and sends a no-answer.
13. Lockdown, bug and wrong-answer overlays consume all touches. A miss on the lockdown overlay still blocks.
14. Bug overlay's fake answers say "Sna", "Fli", "res", "OV", "Pl", "Air", "gh", "he". These look intentionally scrambled. Hard-coded, not localised.
15. "Letter scatter" comment says "dancing" and "rounded whimsical font". Code uses static offsets and `Typeface.DEFAULT_BOLD`.
16. Disco overlay comment says "bottom of effect stack"; by XML Z it draws above the grid (section 3.1).
17. Any ClientHoldingScreenCommandMessage pops the trivia screen, including player-join messages (section 1.4).
18. `pendingTrivia` is cleared only in `onViewCreated` (section 1.2).

---

## 10. User-visible English strings

From `res\values\strings.xml`, used on or around this screen:

| Resource | English text | Where used |
|---|---|---|
| `finals_warning` | `Finals! Wrong answers are rejected!` | `finalsWarning` TextView, shown when RoundType == 5 |
| `dont_touch_bombs` | `Don\'t touch the bombs!` (displayed as `Don't touch the bombs!`) | Bombles explosion overlay text |

Adjacent strings (not on this screen, shown by the next screen after the pop):
- `look_at_tv`: `Look at the TV` (holding screen default text, `HoldingScreenFragment` line ~179 and `RetroTvView` line 45).
- `get_ready`: `Get Ready!` (holding screen type 9).

Defined but not referenced anywhere in the source (checked `java` and `res` for `R.string.*`, `@string/*`):
- `question_placeholder`: `Question will appear here`
- `answer_a`: `Answer A`, `answer_b`: `Answer B`, `answer_c`: `Answer C`, `answer_d`: `Answer D`

Power-play names and descriptions (`pp_*`) are shown by `PowerPlayFragment` only, not on this screen. Examples: `pp_bug_name`: `BUG`, `pp_bug_desc`: `Bugs crawl over the answers`; `pp_zippers_name`: `ZIPPERS`, `pp_zippers_desc`: `Zip up the answers`; `pp_lockdown_name`: `LOCKDOWN`, `pp_lockdown_desc`: `Lock the answers in place`; `pp_disco_name`: `DISCO INFERNO`, `pp_disco_desc`: `Disco lights dazzle the screen`; `pp_letter_scatter_name`: `LETTER SCATTER`, `pp_letter_scatter_desc`: `Scatter the letters`; `pp_gloop_name`: `GLOOP`, `pp_gloop_desc`: `Cover answers in gloop`; `pp_freeze_name`: `FREEZE`, `pp_freeze_desc`: `Encase answers in ice`; `pp_bombs_name`: `BOMBS`, `pp_bombs_desc`: `Throw bombs over answers`; `pp_munchers_name`: `MUNCHERS`, `pp_munchers_desc`: `Munch away at answers`; `pp_points_party_desc`: `Winners get double winnings`; `pp_points_doubler_desc`: `You get ×2 prize points`; `pp_fifty_fifty_desc`: `Remove half the answers`.

Hard-coded English in Kotlin (not in `strings.xml`) on this screen:
- `BugOverlayView.kt`: fragment texts `"Sna"`, `"Fli"`, `"res"`, `"OV"`, `"Pl"`, `"Air"`, `"gh"`, `"he"`.

Design-time only (`tools:text`, not shipped): question `Everyone wanted a pair in the 00s. What are they?`, answers `EGGOs`, `UGGs`, `OWLs`, `ARGHs`.

Log messages (`Log.d`, `Log.i`) are not user-visible.

Localisation: `values-ru\strings.xml` has Russian versions of the same keys. Not used in this spec.

---

## 11. Numeric constants index (gameplay-affecting)

| Constant | Value | Location |
|---|---|---|
| Penalty (wrong finals answer and bombles) | 1900 ms | `TriviaAnsweringFragment` `handler.postDelayed(..., 1900)` |
| Question timeout | `QuestionDuration * 1000` ms | `TriviaAnsweringFragment` `CountDownTimer` |
| Timeout answer index | -1 | `TriviaAnsweringFragment` |
| Finals round type | `RoundType == 5` | `TriviaAnsweringFragment` |
| Default background tint | `#333333` | `TriviaAnsweringFragment` |
| Default secondary tint | `#222222` | `TriviaAnsweringFragment` |
| Sunburst rays | 24, each 15° | `SunburstBackgroundView` `numRays = 24`, `anglePerRay = 360/numRays` |
| Sunburst max radius | `max(w,h) * 1.5` | `SunburstBackgroundView.onDraw` |
| Sunburst darken | `#55000000` | `SunburstBackgroundView` |
| Wrong-answer overlay | `#66CC0000` | `wrongAnswerOverlay` |
| Explosion overlay | `#BBFFFFFF` | `bomblesExplosionOverlay` |
| Answer button tint | `#CC444444` | layout |
| Answer button text | 34sp bold white | layout |
| Answer button horizontal padding | 58dp | layout |
| Answer cell margin | 8dp | layout |
| Answer button corner radius | 8dp | `themes.xml` `ShapeAppearance.App.Rounded` |
| Question text | 20sp bold white, shadow `#80000000` dx2 dy2 r3 | layout |
| Finals warning | 14sp bold italic `#FFDDDD` | layout |
| Overlay clip corner radius (ice, gloop, zipper) | 16dp | overlay views |
| Gloop tap/swipe threshold | 20 px (squared 400) | `TriviaAnsweringFragment` interceptor |
| Gloop coverage | 65% of 60 cells (39) | `GloopOverlayView.checkCoverage` |
| Gloop brush | `min(w,h) * 0.18 * 1.2 / count` | `GloopOverlayView.generateGloop` |
| Gloop fade | 200 ms | `GloopOverlayView.checkCoverage` |
| Ice taps | `5 * count` | `IceOverlayView.activate` |
| Ice fade | 200 ms | `IceOverlayView.shatter` |
| Nibble bites | `2 + 2 * count` per button | `NibblersOverlayView.generateNibbledText` |
| Letter-scatter holes | `2 + 2 * nibbleCount` per button | `LetterScatterOverlayView.generateHoles` |
| Letter-scatter text | 42sp × scaledDensity, fake bold | `LetterScatterOverlayView` |
| Zipper open threshold | 0.85 | `ZipperOverlayView.onTouchEvent` |
| Zipper drag scale | `w * 0.75` | `ZipperOverlayView.onTouchEvent` |
| Zipper grab radius | `0.45h` (`h*0.18*2.5`) | `ZipperOverlayView.onTouchEvent` |
| Zipper fade | 200 ms | `ZipperOverlayView.openFully` |
| Bombles count | `(2*count + 4)` clamped to 6..10 | `BomblesOverlayView.activate` |
| Bombles size | `50dp × (0.85 .. 1.15)` | `BomblesOverlayView.activate` |
| Bombles speed | `(1.5 .. 3.5) dp` per frame | `BomblesOverlayView.activate` |
| Bombles rotation | `-1.5 .. +1.5` deg per frame | `BomblesOverlayView.activate` |
| Bombles touch radius | `0.8 * size` | `BomblesOverlayView.onTouchEvent` |
| Bombles bounce margin | `0.4 * size` | `BomblesOverlayView.updatePositions` |
| Bug count | `count` clamped 1..6 | `BugOverlayView.activate` |
| Bug radius | `width * 0.12` | `BugOverlayView.activate` |
| Bug taps per bug | 2 | `Bug.tapsRemaining = 2` |
| Bug touch radius | `bugRadius * 1.5` | `BugOverlayView.onTouchEvent` |
| Bug wobble | +0.08 phase/frame, ±5° | `BugOverlayView` |
| Bug vortex | +0.8° per frame, 12 rays | `BugOverlayView` |
| Bug dim | `#BB3A1560` | `BugOverlayView` |
| Lockdown count | `lockdownCount * 3` clamped 1..6 | `TriviaAnsweringFragment` + `LockdownOverlayView.activate` |
| Lockdown dim | `#66000000` | `LockdownOverlayView.onDraw` |
| Lockdown lock size | `width * 0.0675` | `LockdownOverlayView` |
| Lockdown touch radius | `2 * lockSize` | `LockdownOverlayView.onTouchEvent` |
| Chain link | 60dp × 36dp, spacing 48dp | `LockdownOverlayView` |
| Chains per lock | 3 to 5 | `LockdownOverlayView.generateChainsForLock` |
| Disco grid | 9 × 6, gap 5dp | `DiscoOverlayView` |
| Disco hue speed | ±(0.5 .. 2.0) deg per frame | `DiscoOverlayView.activate` |
| Disco flash | every 20 frames, 2 to 5 cells | `DiscoOverlayView.animationRunnable` |
| Disco cell alpha | 96 / 72 / 84 by phase | `DiscoOverlayView.onDraw` |

---

## 12. Not found, or not determinable from source

- Visible countdown timer on the trivia screen: not found.
- Waiting text or spinner after answering: not found.
- Any reaction to `IsCorrect` for non-finals: not found (IsCorrect is not read).
- Answer colouring (green/red) after tapping: not found. Only alpha changes.
- Handling of FIFTY_FIFTY, POINTS_DOUBLER, POINTS_PARTY on this screen: not found (comment only). Whether the server removes answers for 50/50: not determinable from this client.
- Reporting of overlay clears to the server (ice shatter, gloop, zipper, lockdown, bug, bombles touches): not found. All related `ClientTriviaAnswer` fields are never set.
- Use of `PowerPlayPlayers` or `Culprits` on this screen: not found.
- Use of `PrimaryTint` on this screen: not found.
- Use of `QuestionID` or `serverTick` on this screen: not found.
- Button text transform, elevation, ripple, minimum height: not specified (Material3 defaults; verify on device).
- Font for nibbles / letter scatter beyond `Typeface.DEFAULT_BOLD`: not found (no custom font asset).
- Rounded font claimed in the letter-scatter comment: not found in resources.
- Server behaviour for Double Trouble decomposition: not found in this client; the client expects the server to send components separately.
- Exact reference frame for `TriviaAnsweringFragment` line numbers in the file as supplied: approximate where marked "~".

---

## 13. Dead or unused code (for awareness)

- `IceOverlayView.crystalFillPaint`: declared, unused.
- `DiscoOverlayView.discoColors`: declared, unused.
- `ZipperOverlayView.activate(count, ...)`: `count` unused. `denimSeed` unused.
- `ZipperOverlayView.seed`: set, only passed into `drawDenim`, which ignores it.
- Overlay callbacks `onIceShattered`, `onZipperOpened`, `onBugCleared`, `onLockdownCleared`: set to null by the trivia screen, so nothing runs on clear. Only `onGloopCleared` is non-null (it hides the gloop interceptor, section 8.4).
