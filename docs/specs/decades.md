# Decades mini-games: porting spec (Elimination, Matching, Missing Letter)

Purpose: factual, 1:1 description of the three Android (Kotlin) "Decades" answering screens, so they can be re-implemented in HTML/JavaScript. Everything here is read from source. Where something is absent, the text says "not found". Nothing is invented.

## 0. Sources and conventions

Source root: `reverse-of-power\app\src\main`

| Item | Path (relative to source root) |
|---|---|
| Elimination fragment | `java\com\game\remoteclient\ui\EliminationAnsweringFragment.kt` |
| Matching fragment | `java\com\game\remoteclient\ui\MatchingAnsweringFragment.kt` |
| Missing Letter fragment | `java\com\game\remoteclient\ui\MissingLetterAnsweringFragment.kt` |
| 3D hex column (GL) | `java\com\game\remoteclient\ui\HexColumnView.kt` |
| Flow layout (letter tiles) | `java\com\game\remoteclient\ui\FlowLayout.kt` |
| Sunburst background | `java\com\game\remoteclient\ui\SunburstBackgroundView.kt` |
| Whirlpool overlay | `java\com\game\remoteclient\ui\WhirlpoolView.kt` |
| Layouts | `res\layout\fragment_elimination_answering.xml`, `fragment_matching_answering.xml`, `fragment_missing_letter_answering.xml` |
| Messages | `java\com\game\protocol\GameMessages.kt` |
| Network | `java\com\game\remoteclient\network\NetworkManager.kt` |
| Strings | `res\values\strings.xml`, `res\values-ru\strings.xml` |
| Colors | `res\values\colors.xml` (not used directly; the only indirect use is `circle_background.xml`, which references `@color/primary` = `#FF2196F3`, overridden at runtime by `backgroundTint` `#F0EAD6`). All other colors are hard-coded hex |
| Navigation | `res\navigation\nav_graph.xml` (routes `eliminationAnsweringFragment`, `missingLetterAnsweringFragment`, `matchingAnsweringFragment`) |
| Real message log | `docs\fullgame-decades.txt` |

Conventions used below:
- "dp" is Android density-independent pixels. In an HTML port, treat 1 dp as 1 CSS px at the design density unless stated otherwise. "sp" is scaled pixels (text), treated as CSS px.
- Kotlin snippets are trimmed quotes with the source file name and function. Line numbers are given where verified.
- Hex colors are exact. Where a color is computed from another color, the formula is given (see section 6.5 for shade math).
- Durations are in milliseconds unless labelled seconds.

---

## 1. Wire contract (shared by all three screens)

### 1.1 Server to client (Begin messages)

Source: `GameMessages.kt`

```kotlin
// lines 466-471
@Serializable
data class EliminatingAnswerData(
    val CorrectInfo: String,
    val IncorrectInfo: String,
    val CorrectAnswer: String,
    val IncorrectAnswers: List<String>
)

// lines 474-481
@Serializable
data class ServerBeginEliminatingAnsweringPhase(
    override val TypeString: String = "KnowledgeIsPower.ServerBeginEliminatingAnsweringPhase",
    val ChallengeId: String,
    val QuestionText: String,
    val QuestionDuration: Double,
    val EliminatingAnswerData: List<EliminatingAnswerData>,
    val serverTick: Long = 0
) : GameMessage()

// lines 490-495
@Serializable
data class MissingLetterAnswerData(
    val answerInfo: String,
    val correct: String,
    val letters: String,
    val finalDisplay: String
)

// lines 498-505
@Serializable
data class ServerBeginMissingLetterAnsweringPhase(
    override val TypeString: String = "KnowledgeIsPower.ServerBeginMissingLetterAnsweringPhase",
    val ChallengeId: String,
    val Question: String,
    val QuestionDuration: Double,
    val MissingLetterAnswerData: List<MissingLetterAnswerData>,
    val serverTick: Long = 0
) : GameMessage()

// lines 514-517
@Serializable
data class MatchingData(
    val QuestionText: String,
    val AnswerText: String
)

// lines 520-527
@Serializable
data class ServerBeginMatchingAnsweringPhase(
    override val TypeString: String = "KnowledgeIsPower.ServerBeginMatchingAnsweringPhase",
    val ChallengeId: String,
    val QuestionDuration: Double,
    val MatchingData: List<MatchingData>,
    val DummyAnswerData: List<String>,
    val serverTick: Long = 0
) : GameMessage()
```

Decoding (`ProtocolDecoder.kt`, lines 251-256): the message is routed by `typeString.contains(...)` and decoded with `json.decodeFromString<...>(jsonStr)`. The three Begin types are routed by those names.

Field usage in the three fragments (verified by grep across `remoteclient`):

| Field | Used by client? | Where |
|---|---|---|
| `QuestionDuration` (seconds, Double) | Yes, all three | `(phase.QuestionDuration * 1000).toLong()` for the phase timer |
| `QuestionText` (Elimination), `Question` (Missing Letter) | Yes | shown in `questionText` |
| `EliminatingAnswerData[].CorrectAnswer`, `.IncorrectAnswers` | Yes | round build |
| `EliminatingAnswerData[].CorrectInfo`, `.IncorrectInfo` | **No** (not read by any fragment; only `DebugLauncherFragment` sets them to `""`) | - |
| `MissingLetterAnswerData[].answerInfo` | Yes | tiles |
| `MissingLetterAnswerData[].correct` | Yes | missing character and correctness |
| `MissingLetterAnswerData[].letters` | Yes | letter buttons |
| `MissingLetterAnswerData[].finalDisplay` | **No** (not read by any client code in `app\src\main`) | - |
| `MatchingData[].QuestionText`, `.AnswerText` | Yes | question text, correct face |
| `DummyAnswerData` | Yes | filler faces |
| `ChallengeId` | **No** in these three fragments (`NetworkManager.kt` line 322 uses it only when converting an Ordering phase to Linking) | - |
| `serverTick` | **No** in these three fragments | - |

### 1.2 Client to server (answer and progress messages)

Source: `GameMessages.kt` (lines 484-487, 508-511, 530-533, 613-616) and `NetworkManager.kt` (lines 441-474).

```kotlin
// GameMessages.kt 484-487
@Serializable
data class ClientToServerEliminatingAnswer(
    override val TypeString: String = "KnowledgeIsPower.ClientToServerEliminatingAnswer",
    val AnswerCount: Int
) : GameMessage()

// GameMessages.kt 508-511
@Serializable
data class PrototypeClientToServerMissingLetterAnswer(
    override val TypeString: String = "KnowledgeIsPower.PrototypeClientToServerMissingLetterAnswer",
    val ClientMissingLetterCorrectAnswerCount: Int
) : GameMessage()

// GameMessages.kt 530-533
@Serializable
data class ClientToServerMatchingAnswer(
    override val TypeString: String = "KnowledgeIsPower.ClientToServerMatchingAnswer",
    val ClientMatchingCorrectAnswerCount: Int
) : GameMessage()

// GameMessages.kt 613-616
@Serializable
data class ClientToServerOngoingChallengeMessage(
    override val TypeString: String = "KnowledgeIsPower.ClientToServerOngoingChallengeMessage",
    val CorrectAnswerCount: Int
) : GameMessage()
```

Send wrappers, `NetworkManager.kt`:

```kotlin
// 441-448
fun sendEliminationAnswer(correctCount: Int) {
    Log.d(TAG, "Elimination answer: $correctCount correct")
    scope.launch {
        protocolClient?.sendMessage(ClientToServerEliminatingAnswer(
            AnswerCount = correctCount
        ))
    }
}

// 450-456
fun sendOngoingChallengeUpdate(correctCount: Int) {
    scope.launch {
        protocolClient?.sendMessage(ClientToServerOngoingChallengeMessage(
            CorrectAnswerCount = correctCount
        ))
    }
}

// 458-465
fun sendMatchingAnswer(correctCount: Int) {
    Log.d(TAG, "Matching answer: $correctCount correct")
    scope.launch {
        protocolClient?.sendMessage(ClientToServerMatchingAnswer(
            ClientMatchingCorrectAnswerCount = correctCount
        ))
    }
}

// 467-474
fun sendMissingLetterAnswer(correctCount: Int) {
    Log.d(TAG, "Missing letter answer: $correctCount correct")
    scope.launch {
        protocolClient?.sendMessage(PrototypeClientToServerMissingLetterAnswer(
            ClientMissingLetterCorrectAnswerCount = correctCount
        ))
    }
}
```

Transport: `GameProtocolClient.sendMessage(msg)` calls `encoder.encodeMessage(msg)` and sends each packet via `sendRawUDP`. `ProtocolEncoder.encodeJson` serializes the message with kotlinx `json.encodeToString` to UTF-8 JSON. The JSON includes `TypeString` as declared in the class. Sends run in a coroutine (`scope.launch`), so they are asynchronous and not awaited by the UI.

### 1.3 Other message used by all three: holding-screen return

`NetworkManager.kt` routes `ClientHoldingScreenCommandMessage` to `onHoldingScreenMessage`. Each fragment handles it by calling `activity?.runOnUiThread { findNavController().popBackStack(R.id.holdingScreenFragment, false) }`. This is the only way these screens exit. No client code sends anything on exit.

`GameMessages.kt` line 168 defines `ClientHoldingScreenCommandMessage` with `action: Int` (comment: `5 = look at the TV`), `time: Double = 0.0`, `HoldingScreenText: String`, `HoldingScreenType: Int` (comment: `4 = look at the tv; 9 = get ready, 5 = players joining`), `OtherPlayerIndex: Int`, `ShowPortraitPhotoControls: Boolean`, `serverTick`.

### 1.4 Real examples from `docs\fullgame-decades.txt`

Only one real Begin example exists in this file, for Missing Letter. There is **no real example** for `ServerBeginEliminatingAnsweringPhase` or `ServerBeginMatchingAnsweringPhase` in `fullgame-decades.txt` (grep for `ServerBegin(Eliminating|Matching)AnsweringPhase`: 0 matches; grep for `eliminat|matching` case-insensitive: 0 matches). `fullgame.txt` also has 0 matches for these three Begin types.

The log is a Kotlin `toString()` dump (not raw JSON), one line per message, with the message number and direction.

Missing Letter Begin (line 940, `#906 S→C 639b Message 0x78`), trimmed:

```text
ServerBeginMissingLetterAnsweringPhase(Companion=..., ChallengeId="CMP00023", Question="Complete the names of the 90s movies", QuestionDuration=30.0, MissingLetterAnswerData=[{..., answerInfo="CLUELESS", correct="E", letters="AEIOU", finalDisplay="CLUELESS"}, {..., answerInfo="MATILDA", correct="A", letters="AEIOU", finalDisplay="MATILDA"}, {..., answerInfo="BEETHOVEN", correct="E", letters="AEIOU", finalDisplay="BEETHOVEN"}, {..., answerInfo="WILD THINGS", correct="I", letters="AEIOU", finalDisplay="WILD THINGS"}, {..., answerInfo="TOY STORY", correct="O", let [... omitted end of long line]
```

Missing Letter answer sent back (line 1029, `#995 C→S 150b Message 0x6a`):

```text
PrototypeClientToServerMissingLetterAnswer(..., ClientMissingLetterCorrectAnswerCount=9)
```

Holding-screen return (line 136 and many others), trimmed:

```text
ClientHoldingScreenCommandMessage(..., action=5, time=0.0, HoldingScreenText="", HoldingScreenType=4, OtherPlayerIndex=-1, ShowPortraitPhotoControls=false, serverTick=...)
```

Elimination and Matching examples: **not found** in the docs. The only data for them is synthetic sample data in `DebugLauncherFragment.kt` (not real server traffic). Those samples are summarised in sections 2.4 and 3.4 and must not be treated as real.

### 1.5 Shared timer and completion model

- Each screen starts **one** `CountDownTimer(durationMs, 1000)` for the whole phase, in `startGame`. It is not per round. `durationMs = (phase.QuestionDuration * 1000).toLong()`. `onTick` is empty in all three. There is no visible countdown UI in any of the three layouts.
- `onFinish`: `if (_binding == null || answerSent) return; sendAnswer()`. So timeout sends the current score (see each screen).
- The timer is not paused by penalties, feedback delays, or taps.
- `sendAnswer()` sets `answerSent = true`, cancels the timer, logs, and sends once. Further calls return early.
- Sending does **not** navigate. The screen stays on its last state until the server sends `ClientHoldingScreenCommandMessage`, which pops back to the holding screen.
- `onDestroyView` cancels the timer and removes handler callbacks and clears the message callbacks. It does **not** send an answer.
- `startGame` (new Begin while a game is running) resets counters, cancels the old timer, starts a new one. It does **not** call `handler.removeCallbacksAndMessages`, so a 400/500/800 ms callback scheduled by the previous game can still fire inside the new game (observed, not tested).

### 1.6 Start-up consumption of pending messages

Each fragment in `onViewCreated` does:

```kotlin
networkManager.pendingElimination?.let { phase ->
    startGame(phase)
    networkManager.pendingElimination = null
}
```

(Matching uses `pendingMatching`, Missing Letter uses `pendingMissingLetter`.) The `NetworkManager` also sets `pendingX = message` on arrival, then calls the callback (`onEliminationMessage` etc.). So a message that arrives before the fragment exists is picked up when it is created.

### 1.7 Shared palette (hex)

| Use | Hex |
|---|---|
| Answer button / letter tile fill | `#F0EAD6` |
| Button and text (dark) | `#333333` |
| Blank tile (Missing Letter, unrevealed) | `#C8B8A0` |
| Correct feedback (teal) | `#4DB6AC` |
| Wrong feedback (rose) | `#C85080` |
| Wrong overlay (full screen, red at alpha 0x60) | `#60FF0000` |
| Counter background | `#40000000` |
| Text shadow for counter | `#80000000` (dx 2, dy 2, radius 3) |
| Question text shadow | `#80000000` (dx 1, dy 1, radius 2) |
| Instruction background | `#60000000` |
| White text | `@android:color/white` = `#FFFFFF` |

---

## 2. Screen 1: Elimination (`EliminationAnsweringFragment`)

### 2.1 Layout (`fragment_elimination_answering.xml`)

Root: `FrameLayout`, match_parent. Children in z-order (later = on top):

1. `SunburstBackgroundView` id `sunburstBackground`, match_parent. Colors set at runtime (see 2.1.1).
2. `WhirlpoolView`, match_parent (static spiral, see section 8.2).
3. `TextView` id `counterText`: wrap_content, gravity `top|center_horizontal`, layout_marginTop 8dp, textSize 20sp, bold, white, shadow `#80000000` dx 2 dy 2 radius 3, background `#40000000`, paddingHorizontal 16dp, paddingVertical 4dp. Default text `"15 to go"` (tools only; runtime text set by code, see 2.8).
4. `TextView` id `questionText`: wrap_content, gravity `top|center_horizontal`, layout_marginTop 40dp, textSize 16sp, bold, white, shadow `#80000000` dx 1 dy 1 radius 2, paddingHorizontal 16dp, paddingVertical 4dp. No explicit text gravity or width. Runtime text = `phase.QuestionText`.
5. `LinearLayout` (horizontal), match_parent width, wrap height, layout_gravity `center`, gravity `center`, paddingHorizontal 16dp. Contains three equal slots:
   - Each slot is a `FrameLayout`, width 0dp, weight 1, wrap height, gravity `center`.
   - Inside each slot a `TextView` with id `answer0`, `answer1`, `answer2` (in that order): 110dp x 110dp, layout_gravity `center`, gravity `center`, textSize 14sp, bold, color `#333333`, background `@drawable/circle_background` with `backgroundTint` `#F0EAD6`, padding 12dp, clickable, focusable.
6. `TextView` id `instructionText`: wrap_content, gravity `bottom|center_horizontal`, layout_marginBottom 24dp, textSize 16sp, color white, background `#60000000`, paddingHorizontal 20dp, paddingVertical 8dp, text `@string/smash_odd_one_out` (see section 9).
7. `View` id `wrongAnswerOverlay`: match_parent, background `#60FF0000`, initially `gone`.

`circle_background.xml` is an `oval` shape with solid `@color/primary` (`#FF2196F3`). The runtime `backgroundTintList` replaces that color with `#F0EAD6` (tint, SRC_IN). Visually the button is a `#F0EAD6` circle. The button is a 110 dp circle, not a 110 dp square.

#### 2.1.1 Sunburst colors
In `onViewCreated`: `binding.sunburstBackground.setColors(Color.parseColor("#E8679A"), Color.parseColor("#D05888"))`. These are never changed in this screen.

### 2.2 Data use

- `phase.EliminatingAnswerData` is the list of rounds. `totalRounds = rounds.size`.
- Per round, options are built from `CorrectAnswer` and `IncorrectAnswers` (see 2.3).
- `QuestionText` is shown once for the whole phase (it does not change per round).
- `CorrectInfo` and `IncorrectInfo` are not read.
- `ChallengeId` and `serverTick` are not read.

### 2.3 Round build (exact logic)

```kotlin
// startGame
rounds = phase.EliminatingAnswerData
totalRounds = rounds.size
currentRoundIndex = 0
correctCount = 0
answerSent = false
penaltyActive = false
binding.questionText.text = phase.QuestionText
binding.wrongAnswerOverlay.visibility = View.GONE
updateCounter()
displayRound(rounds[currentRoundIndex])
// timer: see 1.5

// displayRound
val answers = mutableListOf(round.CorrectAnswer)
answers.addAll(round.IncorrectAnswers.take(2))
answers.shuffle()
val buttons = listOf(binding.answer0, binding.answer1, binding.answer2)
buttons.forEachIndexed { index, button ->
    val text = answers[index]
    val isCorrect = text == round.CorrectAnswer
    button.text = text
    button.alpha = 1.0f
    button.isEnabled = true
    button.backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#F0EAD6"))
    button.setOnClickListener {
        if (answerSent || penaltyActive) return@setOnClickListener
        onAnswerTapped(isCorrect, buttons, index)
    }
}
```

Rules derived from this:
- Each round shows exactly three options: the correct answer plus the **first two** entries of `IncorrectAnswers` (`take(2)`). Any further incorrect answers are silently dropped.
- The three options are shuffled with Kotlin `shuffle()` (uniform random). Port: Fisher-Yates.
- Correctness is string equality: `text == round.CorrectAnswer`. If an incorrect answer equals the correct text, both would be treated as correct (not guarded).
- Every round rebuilds all three buttons from scratch (alpha 1, enabled, `#F0EAD6`), so state from one round never carries into the next.
- "Elimination" in the name refers to the per-round wrong button being disabled after a wrong tap (2.4). It is not a cross-round elimination.

Failure case (not guarded): if `IncorrectAnswers` has fewer than 2 entries, `answers` has fewer than 3 items and `answers[index]` throws `IndexOutOfBoundsException` in the `forEachIndexed` loop. If `EliminatingAnswerData` is empty, `rounds[currentRoundIndex]` throws in `startGame`.

### 2.4 Interaction, correctness and penalties

Tap handler: a button tap is ignored when `answerSent || penaltyActive`. Otherwise `onAnswerTapped(isCorrect, buttons, index)`.

```kotlin
// onAnswerTapped, correct branch
correctCount++
buttons[tappedIndex].backgroundTintList = ColorStateList.valueOf(Color.parseColor("#4DB6AC"))
buttons.forEach { it.isEnabled = false }
handler.postDelayed({
    if (_binding == null) return@postDelayed
    advanceRound()
}, 400)

// onAnswerTapped, wrong branch
penaltyActive = true
buttons[tappedIndex].backgroundTintList = ColorStateList.valueOf(Color.parseColor("#C85080"))
buttons[tappedIndex].alpha = 0.5f
buttons[tappedIndex].isEnabled = false
binding.wrongAnswerOverlay.visibility = View.VISIBLE
handler.postDelayed({
    if (_binding == null) return@postDelayed
    binding.wrongAnswerOverlay.visibility = View.GONE
    penaltyActive = false
}, 800)
```

Numbers and rules:
- **Correct tap**: `correctCount` +1. The tapped button turns `#4DB6AC` (alpha stays 1.0). All three buttons are disabled. After **400 ms** the round advances. The other two buttons keep their `#F0EAD6` fill (no disabled styling exists in the XML or drawable).
- **Wrong tap**: `correctCount` is unchanged. The tapped button turns `#C85080`, alpha **0.5**, and is disabled for the rest of this round. `wrongAnswerOverlay` becomes visible (full-screen `#60FF0000`). `penaltyActive = true` for **800 ms**, during which all taps are ignored. After 800 ms the overlay hides and taps resume on the remaining enabled buttons.
- There is no time penalty, no score penalty, and no limit on wrong taps. The player keeps tapping until the correct option is found or the phase timer ends.
- Because the wrong button is disabled and the others stay enabled, a round can take up to 2 wrong taps before the correct one (with 3 options).
- Score (`correctCount`) therefore equals the number of rounds the player completed before the timer ended or the last round completed. Wrong taps are not counted anywhere.

### 2.5 Round advance and completion

```kotlin
private fun advanceRound() {
    currentRoundIndex++
    if (currentRoundIndex >= totalRounds) {
        sendAnswer()
        return
    }
    updateCounter()
    displayRound(rounds[currentRoundIndex])
}

private fun updateCounter() {
    val remaining = totalRounds - currentRoundIndex
    binding.counterText.text = getString(R.string.x_to_go, remaining)
}
```

- The counter shows `totalRounds - currentRoundIndex` (rounds left, including the current one). At the start it reads `N to go`, where N = number of rounds.
- After the last correct answer, `advanceRound` calls `sendAnswer()` **without** `updateCounter()` or `displayRound()`. The screen keeps the last round's state: counter still shows `1 to go`, the last tapped button is green and all three are disabled.

### 2.6 Timer, timeout and sends

```kotlin
// startGame, timer part
timer?.cancel()
val durationMs = (phase.QuestionDuration * 1000).toLong()
timer = object : CountDownTimer(durationMs, 1000) {
    override fun onTick(millisUntilFinished: Long) {}
    override fun onFinish() {
        if (_binding == null || answerSent) return
        sendAnswer()
    }
}.start()

// sendAnswer
private fun sendAnswer() {
    if (answerSent) return
    answerSent = true
    timer?.cancel()
    Log.d("EliminationAnswering", "Completed: $correctCount/$totalRounds correct")
    networkManager.sendEliminationAnswer(correctCount)
}
```

- **Sent**: exactly once per phase, as `ClientToServerEliminatingAnswer { AnswerCount = correctCount }`, via `NetworkManager.sendEliminationAnswer`.
- **Triggers**: (a) last round completed (`advanceRound`, after the 400 ms delay), or (b) timer `onFinish`, sending the score so far (section 1.5).
- **Not sent**: no ongoing progress message (`ClientToServerOngoingChallengeMessage` is never sent here), and nothing on wrong taps.
- **Exit**: only the holding-screen command pops the screen (`popBackStack(R.id.holdingScreenFragment, false)`).

### 2.7 Feedback animations and durations

There are no animations (no `ValueAnimator`, `animate()`, transitions or fades in this file). All feedback is an instant state change plus a delayed callback:

| Event | Visual change | Duration |
|---|---|---|
| Correct tap | tapped button `#4DB6AC`; all buttons disabled | 400 ms, then next round |
| Wrong tap | tapped button `#C85080`, alpha 0.5, disabled; full-screen `#60FF0000` overlay shown | 800 ms, then overlay hidden and taps resume |
| Round change | buttons reset to `#F0EAD6`, alpha 1, enabled; counter text updated | instant |

No sound or haptic code exists in this file.

### 2.8 User-visible strings on this screen

| Where | Source | English text | Russian text (`values-ru`) |
|---|---|---|---|
| Counter | `getString(R.string.x_to_go, remaining)` | `%1$s to go` → e.g. `5 to go` | `Осталось %1$s` |
| Instruction (layout) | `@string/smash_odd_one_out` | `Tap to smash odd one out` | `Нажмите, чтобы разбить лишнее` |
| Question | `phase.QuestionText` (server) | data-driven | data-driven |
| Answer buttons | `round.CorrectAnswer` / `IncorrectAnswers` (server) | data-driven | data-driven |

Layout `tools:text` values (`15 to go`, `Moon`, etc.) are IDE preview only and never shown at runtime.

### 2.9 Observations (factual)

- No `CorrectInfo` / `IncorrectInfo` display: those fields exist in the message but are never shown.
- The `wrongAnswerOverlay` is a plain red translucent view with no text or icon.
- Timeout never shows any UI message; the screen just stops accepting input (`answerSent` blocks taps) and waits for the server.

---

## 3. Screen 2: Matching (`MatchingAnsweringFragment`)

### 3.1 Layout (`fragment_matching_answering.xml`)

Root: `FrameLayout`, id `rootLayout`, match_parent. Children in z-order:

1. `SunburstBackgroundView` id `sunburstBackground`, match_parent. Colors set at runtime (section 3.6).
2. `WhirlpoolView`, match_parent (section 8.2).
3. `HexColumnView` id `hexColumn`, match_parent (the 3D rotating column; section 6). It is a `GLSurfaceView`.
4. `TextView` id `counterText`: wrap_content, `top|center_horizontal`, marginTop 8dp, 20sp, bold, white, shadow `#80000000` dx 2 dy 2 radius 3, background `#40000000`, paddingHorizontal 16dp, paddingVertical 4dp. Default tools text `"15 to go"`.
5. `TextView` id `questionText`: match_parent width, wrap height, `top|center_horizontal`, marginTop 40dp, 18sp, bold, white, shadow `#80000000` dx 1 dy 1 radius 2, paddingHorizontal 24dp, paddingVertical 4dp, gravity `center` (text centered).
6. `TextView` id `instructionText`: wrap_content, `bottom|center_horizontal`, marginBottom 24dp, 16sp, white, background `#60000000`, paddingHorizontal 20dp, paddingVertical 8dp, text `@string/swipe_to_match`.

**There is no `wrongAnswerOverlay` in this layout.** Wrong answers in Matching use the sunburst and column colour only (section 3.4).

### 3.2 Data use

- `phase.MatchingData` is the list of rounds. Each round has `QuestionText` (shown) and `AnswerText` (the one correct face).
- `phase.DummyAnswerData` (`List<String>`) is the filler pool, stored in `dummyAnswers` at `startGame` (line 147).
- `ChallengeId` and `serverTick` are not read.

### 3.3 Round build and face selection

```kotlin
// startGame
rounds = phase.MatchingData
totalRounds = rounds.size
currentRoundIndex = 0
correctCount = 0
answerSent = false
locked = false
dummyAnswers = phase.DummyAnswerData
updateCounter()
displayRound()
// timer: section 1.5 (durationMs = QuestionDuration * 1000)

// displayRound
if (currentRoundIndex >= rounds.size) return
val round = rounds[currentRoundIndex]
binding.questionText.text = round.QuestionText
binding.sunburstBackground.setColors(normalPrimary, normalSecondary)
binding.hexColumn.setBodyColor(normalPrimary)

// Pick 6 faces: correct answer + 5 dummies (excluding the correct answer)
val pool = dummyAnswers.filter { it != round.AnswerText }
val fillers = if (pool.size >= 5) {
    pool.shuffled().take(5)
} else {
    // Not enough unique dummies — repeat from pool to fill 5 slots
    (0 until 5).map { pool[it % pool.size] }
}
val faces = (fillers + round.AnswerText).shuffled()
binding.hexColumn.setAnswerList(faces)
```

Rules:
- Each round shows **6 faces**: the correct `AnswerText` plus 5 fillers.
- The pool excludes entries equal to `AnswerText` (exact string match, case-sensitive). If the pool has at least 5 entries, 5 are chosen at random without replacement (`shuffled().take(5)`).
- If the pool has fewer than 5 entries (including after the exclusion), the code repeats the pool cyclically: filler `k` is `pool[k % pool.size]`. Duplicates are therefore shown. Example from the debug sample (section 3.8): `DummyAnswerData` has 4 entries, so the fallback path is used every round.
- Faces are then shuffled (`shuffled()`), so the correct face can be at any of the 6 positions.
- Edge cases (not guarded): if `DummyAnswerData` is empty and there is at least one round, `pool.size` is 0, the fallback runs `it % 0` and throws `ArithmeticException`. If `MatchingData` is empty, `displayRound` returns early and the screen shows no faces; the phase timer then sends `0`.
- Round change: `setAnswerList` resets `currentIndex = 0`, `currentRotation = 0`, `targetRotation = 0`, `animating = false`, `pressedFace = -1`.

### 3.4 Interaction: gestures, tap, correctness, penalties

Gesture setup: `rootLayout.setOnTouchListener` forwards every touch to a `GestureDetector` and returns `true` (consumes all touches). Constants:

- Scroll (swipe) threshold: `resources.displayMetrics.density * 40f` px (40 dp).
- Fling threshold: `density * 24f` px (24 dp).

```kotlin
// onDown
swipeConsumed = false
cumulativeDragX = 0f
return true

// onScroll
if (locked || answerSent) return false
cumulativeDragX -= distanceX
val threshold = resources.displayMetrics.density * 40f
if (!swipeConsumed && kotlin.math.abs(cumulativeDragX) > threshold) {
    swipeConsumed = true
    if (cumulativeDragX > 0) binding.hexColumn.prev() else binding.hexColumn.next()
}
return true

// onFling
if (locked || answerSent || swipeConsumed) return false
val dx = e2.x - (e1?.x ?: e2.x)
if (kotlin.math.abs(dx) < resources.displayMetrics.density * 24f) return false
swipeConsumed = true
if (dx > 0) binding.hexColumn.prev() else binding.hexColumn.next()
return true

// onSingleTapUp
if (locked || answerSent) return false
if (!binding.hexColumn.isTapOnFrontFace(e.x, e.y)) return false
confirmAnswer()
return true
```

Mechanics:
- **Swipe left** (finger moves to the left, `distanceX > 0`, so `cumulativeDragX` becomes negative): `next()`, which brings the next face (index +1 mod 6) to the front. **Swipe right**: `prev()` (index −1 mod 6).
- One face step per gesture: `swipeConsumed` stops a second step until the next `onDown`.
- A quick fling is accepted only if `|dx| ≥ 24 dp` and no scroll step has already happened in this gesture.
- Swipes are ignored while `locked` (feedback in progress) or `answerSent`.
- **Tap** counts only if it lands on the front face's screen area (`isTapOnFrontFace`, section 6.4). Taps on the body or the rest of the screen do nothing.
- Each face rotation is 60 degrees (section 6.3).

```kotlin
// confirmAnswer
if (currentRoundIndex >= rounds.size) return
val round = rounds[currentRoundIndex]
val selectedAnswer = binding.hexColumn.getCurrentAnswer()
val isCorrect = selectedAnswer == round.AnswerText
locked = true
binding.hexColumn.pressCurrentFace()
```

`getCurrentAnswer()` returns `answers[currentIndex % answers.size]` (the face the front is showing).

**Correct**:

```kotlin
correctCount++
networkManager.sendOngoingChallengeUpdate(correctCount)
binding.sunburstBackground.setColors(correctPrimary, correctSecondary)
binding.hexColumn.setBodyColor(correctPrimary)
handler.postDelayed({
    if (_binding == null) return@postDelayed
    locked = false
    advanceRound()
}, 500)
```

- Teal feedback (sunburst `#4DB6AC` / `#3DA69C`, column body `#4DB6AC`) for **500 ms**, then `locked = false` and the next round.
- The `sendOngoingChallengeUpdate` happens immediately on each correct answer (before the 500 ms).
- `locked` is cleared before `advanceRound()`.

**Wrong**:

```kotlin
binding.sunburstBackground.setColors(incorrectPrimary, incorrectSecondary)
binding.hexColumn.setBodyColor(incorrectPrimary)
handler.postDelayed({
    if (_binding == null) return@postDelayed
    binding.sunburstBackground.setColors(normalPrimary, normalSecondary)
    binding.hexColumn.setBodyColor(normalPrimary)
    locked = false
}, 400)
```

- Rose feedback (sunburst `#C85080` / `#B04070`, column body `#C85080`) for **400 ms**, then back to purple and `locked = false`.
- No score change, no time penalty, no send, no overlay. The player can retry immediately after 400 ms.
- The tapped face stays in the "pressed" look after a wrong answer (see 6.2 / `pressedFace` is not cleared on the wrong path), until the next `setAnswerList` (next round or next phase). Re-tapping another face is allowed after 400 ms.

Scoring: `correctCount` increments once per correct tap. Since a round only advances after a correct tap, `correctCount` equals the number of completed rounds (same model as Elimination).

### 3.5 Round advance, completion, timer, sends

```kotlin
private fun advanceRound() {
    currentRoundIndex++
    if (currentRoundIndex >= totalRounds) {
        sendAnswer()
        return
    }
    updateCounter()
    displayRound()
}

private fun updateCounter() {
    val remaining = totalRounds - currentRoundIndex
    binding.counterText.text = getString(R.string.x_to_go, remaining)
}

private fun sendAnswer() {
    if (answerSent) return
    answerSent = true
    timer?.cancel()
    Log.d("MatchingAnswering", "Completed: $correctCount/$totalRounds correct")
    networkManager.sendMatchingAnswer(correctCount)
}
```

- Timer: one phase timer, identical to section 1.5. Timeout calls `sendAnswer()` with the score so far.
- **Ongoing progress**: `ClientToServerOngoingChallengeMessage { CorrectAnswerCount = correctCount }` is sent on **every correct answer** (only this screen does this among the three; see 3.5.1).
- **Final**: `ClientToServerMatchingAnswer { ClientMatchingCorrectAnswerCount = correctCount }` once, on last round completion or timeout.
- After the last correct answer, the screen does not call `updateCounter`/`displayRound`. The sunburst and column remain **teal** (correct state) and the counter shows `1 to go`.

3.5.1 Ongoing message: this screen only. `GameProtocol2Client.kt` line 28 describes `ClientToServerOngoingChallengeMessage` as "Real-time progress during Missing Letter & Linking". **The Missing Letter fragment does not send it** (grep: only `MatchingAnsweringFragment.kt:193`). Discrepancy between the comment and the code.

Lifecycle: `onPause` calls `_binding?.hexColumn?.onPause()`; `onResume` calls `_binding?.hexColumn?.onResume()` (GL pause/resume only).

### 3.6 Colors and sunburst

| State | Sunburst primary / secondary | Column body |
|---|---|---|
| Normal (default, and after each round) | `#9C27B0` / `#7B1FA2` | `#9C27B0` |
| Correct (500 ms) | `#4DB6AC` / `#3DA69C` | `#4DB6AC` |
| Wrong (400 ms) | `#C85080` / `#B04070` | `#C85080` |

Initial `onViewCreated`: `binding.sunburstBackground.setColors(normalPrimary, normalSecondary)` and `setupGestures()`, then `observeMessages()`, then consume `pendingMatching`.

Note: `startGame` does not reset the sunburst or body color. It is set by `displayRound` (normal). After a correct last round, the colours remain teal (section 3.5).

### 3.7 Feedback summary

| Event | Visual | Duration |
|---|---|---|
| Correct | sunburst + body teal; face pressed look | 500 ms, then next round (colors reset in `displayRound`) |
| Wrong | sunburst + body rose; face pressed look stays until next round | 400 ms, then colors back to purple; `locked` cleared |
| Swipe step | column rotates 60 degrees (eased, section 6.3) | per frame easing |

No overlay, no sound, no haptics. No text is shown for feedback.

### 3.8 Strings and sample data

User-visible strings on this screen:

| Where | Source | English | Russian (`values-ru`) |
|---|---|---|---|
| Counter | `getString(R.string.x_to_go, remaining)` | `%1$s to go` | `Осталось %1$s` |
| Instruction | `@string/swipe_to_match` | `Swipe to find, tap to match` | `Проведите для поиска, нажмите для пары` |
| Question | `MatchingData.QuestionText` (server) | data-driven | data-driven |
| Faces | `AnswerText` and `DummyAnswerData` (server) | data-driven | data-driven |

Synthetic sample from `DebugLauncherFragment.launchMatching` (not real server data; it shows the shape only):

```kotlin
ServerBeginMatchingAnsweringPhase(
    ChallengeId = "LSM00011en",
    QuestionDuration = 55.0,
    MatchingData = listOf(
        MatchingData(QuestionText = "90s film starring Michael Jordan: Space ___", AnswerText = "Jam"),
        MatchingData(QuestionText = "Tommys surname in Rugrats", AnswerText = "Pickles"),
        // ... more rounds
    ),
    DummyAnswerData = listOf("Bread", "Sausage", "Carrot", "Eggs")
)
```

The fallback path (section 3.3) is used here, since 4 dummies < 5.

### 3.9 Observations

- No "wrong overlay" exists. The only wrong feedback is the rose sunburst and column body for 400 ms.
- Taps while `locked` are dropped (not queued).
- Swipe and tap are on the same touch stream; a tap that moves beyond the scroll threshold becomes a swipe, not a tap.
- `DummyAnswerData` duplicates and fallback repetition are not de-duplicated on the client.

---

## 4. Screen 3: Missing Letter (`MissingLetterAnsweringFragment`)

### 4.1 Layout (`fragment_missing_letter_answering.xml`)

Root: `FrameLayout`, match_parent. Children in z-order:

1. `SunburstBackgroundView` id `sunburstBackground`, match_parent. Colors set at runtime (`#E8679A` / `#D05888`, section 4.7).
2. `WhirlpoolView`, match_parent (section 8.2).
3. `TextView` id `counterText`: wrap_content, `top|center_horizontal`, marginTop 8dp, 20sp, bold, white, shadow `#80000000` dx 2 dy 2 radius 3, background `#40000000`, paddingHorizontal 16dp, paddingVertical 4dp. Tools text `"14 to go"`.
4. `TextView` id `questionText`: match_parent width, wrap height, `top|center_horizontal`, marginTop 56dp, 20sp, bold, white, shadow `#80000000` dx 1 dy 1 radius 2, gravity `center`, paddingHorizontal 16dp, paddingVertical 4dp. Runtime text = `phase.Question`.
5. `FlowLayout` id `wordTiles` (custom, section 7): width match_parent (overwritten at runtime to 60% of screen width), wrap height, layout_gravity `center`, marginBottom 40dp.
6. `LinearLayout` (horizontal), match_parent width, wrap height, layout_gravity `bottom`, marginBottom 24dp, gravity `center`, paddingHorizontal 8dp. Contains five `TextView`s `letter0` to `letter4` (in that order), each 64dp x 64dp, marginHorizontal 4dp, gravity `center`, textSize 24sp, bold, color `#333333`, background `@drawable/circle_background` tinted `#F0EAD6`, clickable, focusable.
7. `View` id `wrongAnswerOverlay`: match_parent, background `#60FF0000`, initially `gone`.

There is **no instruction text** in this layout.

### 4.2 Data use

- `phase.MissingLetterAnswerData` is the list of rounds.
- `answerInfo`: the full phrase (uppercase in the sample data), shown as tiles. Spaces are word gaps (not tiles).
- `correct`: the answer. The code uses `correct.first()` as the missing character for tiles, and compares the whole `correct` string to each letter button (case-insensitive). Data expectation: one letter.
- `letters`: the letter choices, shown as buttons in the order of the string (`letters.toList()`), no shuffling. Only the first 5 are shown (`letter0`..`letter4`). Extra letters are ignored. Missing letters hide the unused buttons.
- `finalDisplay`: **not read**. The tile text after reveal is `correct.first()`, not `finalDisplay`.
- The phrase is also the source for the tile count (`answerInfo.length`).

### 4.3 Round build and tile layout

```kotlin
// startGame
rounds = phase.MissingLetterAnswerData
totalRounds = rounds.size
currentRoundIndex = 0
correctCount = 0
answerSent = false
penaltyActive = false
binding.questionText.text = phase.Question
binding.wrongAnswerOverlay.visibility = View.GONE
updateCounter()
displayRound(rounds[currentRoundIndex])
// timer: section 1.5

// displayRound (tile part)
val missingChar = round.correct.first()
val screenWidth = resources.displayMetrics.widthPixels
val layoutWidth = (screenWidth * 0.60).toInt()
binding.wordTiles.layoutParams = binding.wordTiles.layoutParams.apply { width = layoutWidth }
binding.wordTiles.setPadding(0, 0, 0, 0)
val totalItems = round.answerInfo.length // includes spaces (become gap spacers)
val tilesPerRow = ((totalItems + 1) / 2).coerceIn(4, 12)
val tileSize = ((layoutWidth - (tilesPerRow - 1) * tileSpacing) / tilesPerRow)
    .coerceAtMost(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 80f, resources.displayMetrics).toInt())
val fontSize = tileSize * 0.45f / resources.displayMetrics.scaledDensity
binding.wordTiles.removeAllViews()
binding.wordTiles.horizontalSpacing = tileSpacing
binding.wordTiles.verticalSpacing = tileSpacing
for (ch in round.answerInfo) {
    if (ch == ' ') {
        val spacer = Space(requireContext())
        spacer.layoutParams = ViewGroup.LayoutParams(wordGap, tileSize)
        binding.wordTiles.addView(spacer)
    } else {
        val isMissing = ch.equals(missingChar, ignoreCase = true)
        val tile = TextView(requireContext()).apply {
            layoutParams = ViewGroup.LayoutParams(tileSize, tileSize)
            gravity = Gravity.CENTER
            setTextSize(TypedValue.COMPLEX_UNIT_SP, fontSize)
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#333333"))
            setBackgroundResource(R.drawable.letter_tile)
            if (isMissing) {
                text = ""
                backgroundTintList = ColorStateList.valueOf(tileColorBlank)
                tag = "missing"
            } else {
                text = ch.toString()
                backgroundTintList = ColorStateList.valueOf(tileColorLetter)
            }
        }
        binding.wordTiles.addView(tile)
    }
}
```

Constants (computed in code):
- `tileSpacing` = 3 dp (px at runtime). Used for both horizontal and vertical spacing.
- `wordGap` = 10 dp (width of a space spacer; height = `tileSize`).
- Tile max size = 80 dp.
- `layoutWidth` = 60% of screen width in px (integer truncation).
- `tilesPerRow` = `ceil(totalItems / 2)` clamped to 4..12 (`(totalItems+1)/2` integer division). Note `totalItems` counts spaces.
- `tileSize` (px) = `(layoutWidth − (tilesPerRow − 1) × 3dp) / tilesPerRow` using Int division, then clamped to ≤ 80 dp.
- `fontSize` (sp) = `tileSize × 0.45 / scaledDensity`, bold.
- Tile colors: letter `#F0EAD6`, blank `#C8B8A0`, text `#333333`, background shape `letter_tile.xml` (rectangle, solid `#F0EAD6`, corner radius 4 dp, tinted per state).

Missing-character rule: **every** tile whose character equals `correct.first()` (case-insensitive) becomes a blank. Example from the docs line 940: `CLUELESS`, `correct="E"`, has two E's, so both are blank. `BEETHOVEN` (E) has three. `WILD THINGS` (I) has two.

Blank tiles are identified by `tag == "missing"`.

Letter buttons:

```kotlin
val letterButtons = getLetterButtons()
val letters = round.letters.toList()
letterButtons.forEachIndexed { index, button ->
    if (index < letters.size) {
        val letter = letters[index].toString()
        val isCorrect = letter.equals(round.correct, ignoreCase = true)
        button.text = letter
        button.visibility = View.VISIBLE
        button.alpha = 1f
        button.isEnabled = true
        button.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#F0EAD6"))
        button.setOnClickListener {
            if (answerSent || penaltyActive) return@setOnClickListener
            onLetterTapped(isCorrect, round, letterButtons, index)
        }
    } else {
        button.visibility = View.GONE
    }
}
```

- Letter button `i` shows `letters[i]`. Only the first 5 are used.
- Correctness: `letter.equals(round.correct, ignoreCase = true)`. This is a whole-string comparison, so `correct` must be exactly one letter for it to match.
- Buttons are not reshuffled. The order is exactly the `letters` order from the server.
- Round change: buttons reset to visible, alpha 1, enabled, `#F0EAD6`.

### 4.4 Interaction, correctness and penalties

Tap: ignored when `answerSent || penaltyActive`. Otherwise `onLetterTapped`.

```kotlin
// correct
correctCount++
buttons[tappedIndex].backgroundTintList = ColorStateList.valueOf(Color.parseColor("#4DB6AC"))
revealTiles(round)
buttons.forEach { it.isEnabled = false }
handler.postDelayed({
    if (_binding == null) return@postDelayed
    advanceRound()
}, 400)

// wrong
penaltyActive = true
buttons[tappedIndex].backgroundTintList = ColorStateList.valueOf(Color.parseColor("#C85080"))
buttons[tappedIndex].alpha = 0.5f
buttons[tappedIndex].isEnabled = false
binding.wrongAnswerOverlay.visibility = View.VISIBLE
handler.postDelayed({
    if (_binding == null) return@postDelayed
    binding.wrongAnswerOverlay.visibility = View.GONE
    penaltyActive = false
}, 800)
```

Reveal:

```kotlin
private fun revealTiles(round: MissingLetterAnswerData) {
    val missingChar = round.correct.first()
    for (i in 0 until binding.wordTiles.childCount) {
        val child = binding.wordTiles.getChildAt(i)
        if (child is TextView && child.tag == "missing") {
            child.text = missingChar.toString()
            child.backgroundTintList = ColorStateList.valueOf(tileColorRevealed)
        }
    }
}
```

Numbers and rules:
- **Correct**: `correctCount` +1. Tapped letter turns `#4DB6AC` (alpha 1). All blank tiles are revealed with `correct.first()` text and `#4DB6AC` tint. All five letter buttons are disabled. After **400 ms** the round advances.
- **Wrong**: no score change. Tapped letter turns `#C85080`, alpha 0.5, disabled for the rest of the round. Full-screen `#60FF0000` overlay for **800 ms**, during which taps are ignored. Then overlay hides and the remaining enabled letters can be tapped.
- No time penalty and no limit on wrong taps. With 5 letters there can be up to 4 wrong taps before the correct one.
- Score (`correctCount`) equals the number of completed rounds (same model as Elimination and Matching).

Reveal colour: `tileColorRevealed` = `#4DB6AC`. Blank: `#C8B8A0`.

### 4.5 Round advance, completion, timer, sends

```kotlin
private fun advanceRound() {
    currentRoundIndex++
    if (currentRoundIndex >= totalRounds) {
        sendAnswer()
        return
    }
    updateCounter()
    displayRound(rounds[currentRoundIndex])
}

private fun updateCounter() {
    val remaining = totalRounds - currentRoundIndex
    binding.counterText.text = getString(R.string.x_to_go, remaining)
}

private fun sendAnswer() {
    if (answerSent) return
    answerSent = true
    timer?.cancel()
    Log.d("MissingLetterAnswering", "Completed: $correctCount/$totalRounds correct")
    networkManager.sendMissingLetterAnswer(correctCount)
}
```

- Timer: phase timer, identical to 1.5. On timeout, `sendAnswer()` sends the score so far.
- **Sent**: `PrototypeClientToServerMissingLetterAnswer { ClientMissingLetterCorrectAnswerCount = correctCount }`, once.
- **Not sent**: no `ClientToServerOngoingChallengeMessage` (contrary to the comment in `GameProtocol2Client.kt`, section 3.5.1).
- After the last correct answer, the screen keeps the revealed tiles, the disabled letters and `1 to go`.

### 4.6 Feedback animations and durations

Same model as Elimination (section 2.7):
- Correct: teal letter, reveal, 400 ms, next round.
- Wrong: rose letter at alpha 0.5, full-screen red overlay, 800 ms penalty lock.
- No animations, no transitions, no sound, no haptics.

### 4.7 Colors

- Sunburst: `#E8679A` / `#D05888`, set in `onViewCreated`, never changed.
- Tiles: letter `#F0EAD6`, blank `#C8B8A0`, revealed `#4DB6AC`, text `#333333`.
- Letter buttons: `#F0EAD6`, text `#333333`; correct `#4DB6AC`; wrong `#C85080` at alpha 0.5.

### 4.8 Strings

| Where | Source | English | Russian (`values-ru`) |
|---|---|---|---|
| Counter | `getString(R.string.x_to_go, remaining)` | `%1$s to go` | `Осталось %1$s` |
| Question | `phase.Question` (server) | data-driven | data-driven |
| Phrase tiles | `answerInfo` (server) | data-driven | data-driven |
| Letter buttons | `letters` (server) | data-driven | data-driven |

No instruction text. `finals_warning` is referenced only by the trivia layout (not these screens).

Synthetic sample from `DebugLauncherFragment.launchMissingLetter` (not real server data; the real one is in section 1.4):

```kotlin
ChallengeId = "DEBUG_CMP001",
QuestionDuration = 30.0,
MissingLetterAnswerData = listOf(
    MissingLetterAnswerData(answerInfo = "ANCHORMAN", correct = "A", letters = "AEIOU", finalDisplay = "ANCHORMAN"),
    MissingLetterAnswerData(answerInfo = "SCHOOL OF ROCK", correct = "O", letters = "AEIOU", finalDisplay = "SCHOOL OF ROCK"),
    // ...
)
```

### 4.9 Observations (factual)

- `finalDisplay` is never read.
- The `correct` field is treated as one letter for tiles (`first()`) but as a whole string for button matching. Multi-character values would break the button match.
- Letters missing from `letters` are not checked. If `correct` is not among `letters`, the round can only end by timer.
- Empty `correct` throws (`first()` on empty string). Empty `MissingLetterAnswerData` throws on `rounds[0]`.

---

## 5. Shared timing summary

| Screen | Correct feedback | Wrong feedback | Score on wrong | Ongoing progress message | Final message |
|---|---|---|---|---|---|
| Elimination | 400 ms (button teal, all disabled) | 800 ms (red overlay, button disabled, alpha 0.5) | none | not sent | `ClientToServerEliminatingAnswer.AnswerCount` |
| Matching | 500 ms (sunburst + body teal) | 400 ms (sunburst + body rose; `locked`) | none | `ClientToServerOngoingChallengeMessage.CorrectAnswerCount` on every correct | `ClientToServerMatchingAnswer.ClientMatchingCorrectAnswerCount` |
| Missing Letter | 400 ms (letter teal, reveal, all disabled) | 800 ms (red overlay, letter disabled, alpha 0.5) | none | not sent | `PrototypeClientToServerMissingLetterAnswer.ClientMissingLetterCorrectAnswerCount` |

Common to all three: phase timer = `QuestionDuration` seconds, started once; timeout sends current score; send is once per phase (`answerSent` guard); no send on destroy; exit only via server holding-screen command.

---

## 6. `HexColumnView` (Matching only): full drawing and interaction spec

Source: `HexColumnView.kt`. It is a `GLSurfaceView` implementing `Renderer`, OpenGL ES 2.0.

### 6.1 Surface setup

- `setEGLContextClientVersion(2)`, `setEGLConfigChooser(8, 8, 8, 8, 16, 0)` (RGBA8888, depth 16, no stencil).
- `holder.setFormat(PixelFormat.TRANSLUCENT)`, `setZOrderOnTop(true)`.
- `renderMode = RENDERMODE_CONTINUOUSLY` (redraws every vsync frame).
- Clear color `(0,0,0,0)`. Depth test on. Blend `SRC_ALPHA, ONE_MINUS_SRC_ALPHA`. Cull face `BACK`.
- Because `setZOrderOnTop(true)` is used, the GL surface is composited above its window. Any text under the column's pixels may be covered where the column is drawn. (Factual; not verified visually.)

### 6.2 Constants and state

| Name | Value |
|---|---|
| `FACE_COUNT` | 6 |
| `FACE_RAD` | 2π/6 = 60 degrees (1.0472 rad) |
| `SUBDIV_H` | 4 (columns of quads per face) |
| `SUBDIV_V` | 6 (rows of quads per face) |
| `columnRadius` | 1.2 |
| `screenHeight` | 1.1 |
| `bodyHeight` | 0.45 |
| `totalHeight` | 1.55 |
| `screenY` (top of screen strip) | 0.775 (= totalHeight/2) |
| `bodyY` (bottom of screen / top of body) | -0.325 |
| `bottomY` (bottom of body) | -0.775 |
| Camera eye | (0, 0.6, 4.2) |
| Camera target | (0, 0, 0) |
| Camera up | (0, 1, 0) |
| Projection | perspective, fovY 38 degrees, aspect = viewportW / viewportH, near 1, far 20 |
| Default body color (overridden by screen) | `#C2185B` |
| Screen fill (`screenColor`) | `#F5F0E0` |
| Bezel color (`bezelColor`) | `#8D6E63` |
| Face accent colors (index 0..5) | `#66BB6A`, `#42A5F5`, `#FF8A65`, `#AB47BC`, `#FFCA28`, `#EC407A` |
| Face texture size | 512 x 512 (`texSize = 512`) |

State: `answers` (List<String>, 6 entries from Matching), `currentIndex` (0..5, the front face), `currentRotation`/`targetRotation` (radians), `animating`, `pressedFace` (-1 or an index), `bodyColor`.

Public API:
- `setAnswerList(list)`: sets answers, `currentIndex = 0`, rotations to 0, `animating = false`, `pressedFace = -1`, dirty.
- `getCurrentAnswer()`: `answers[currentIndex % answers.size]` (or `""` if empty).
- `next()`: if animating, snap `currentRotation = targetRotation`; `currentIndex = (currentIndex + 1) % 6`; `targetRotation -= FACE_RAD`; `animating = true`.
- `prev()`: same but `currentIndex = (currentIndex - 1 + 6) % 6` and `targetRotation += FACE_RAD`.
- `setBodyColor(c)`: sets body color, marks textures dirty.
- `pressCurrentFace()`: `pressedFace = currentIndex`, marks dirty.

### 6.3 Rotation animation

Per GL frame (`onDrawFrame`):

```text
if animating:
    diff = targetRotation - currentRotation
    if |diff| < 0.01 rad: currentRotation = targetRotation; animating = false
    else: currentRotation += diff * 0.25
```

- Exponential ease (25 % of the remaining angle per frame) with a snap at 0.01 rad. The duration is frame-rate dependent (one step per vsync frame).
- The column is drawn with model rotation about +Y by `degrees(currentRotation)`.
- At rest, the front face is `currentIndex` and `currentRotation = -currentIndex × 60 degrees` (since `next` subtracts 60 degrees from the target).

### 6.4 Geometry and camera

Faces are vertical strips of a 6-sided prism (radius 1.2). For face `i`:
- Arc from angle `a0 = i×60° − 30°` to `a1 = i×60° + 30°`.
- Vertex position: `x = R·sin(a)`, `z = R·cos(a)`, `y` linear between top and bottom.

Two strips per face:
- **Screen strip**: y from `screenY` (0.775) down to `bodyY` (-0.325). Texture = `faceTextures[i]`.
- **Body strip**: y from `bodyY` (-0.325) down to `bottomY` (-0.775). Texture = `bodyTextures[i]`.

Each strip: 5 × 7 vertices (4 × 6 quads), 24 quads = 144 indices. Winding CCW from outside. UV: `u = col/4` (around the arc, left to right), `v = row/6` (top to bottom). Texture row 0 maps to the top of the bitmap.

Caps: top cap at `y = screenY` (radius R, fan from center), bottom cap at `y = bottomY`. Each cap is a 6-triangle fan from the center. Caps use one solid-color texture each and UV (0.5, 0.5).

Culling per frame: for face `i`, `faceAngle = currentRotation + i×60°`, `faceDot = cos(faceAngle)`. If `faceDot < −0.15`, skip the face entirely. Otherwise shade = `0.5 + 0.5 × clamp(faceDot, 0, 1)` (uniform `uShade` multiplies RGB in the fragment shader).

Caps: top cap uniform shade 0.9; bottom cap uniform shade 0.4.

Textures use `GL_LINEAR` min/mag filter, no mipmaps.

Shaders (for a faithful port): vertex `gl_Position = uMVPMatrix * aPosition; vTexCoord = aTexCoord`. Fragment `gl_FragColor = vec4(texture.rgb * uShade, texture.a)`.

MVP: `view = lookAt(eye (0,0.6,4.2), center (0,0,0), up (0,1,0))`, `model = rotateY(degrees(currentRotation))`, `mvp = projection × view × model`.

Hit-test helper (`isTapOnFrontFace`):
- Uses `targetRotation` (not `currentRotation`) and `currentIndex`.
- Builds `view` and `projection` as above and `model = rotateY(degrees(targetRotation))`.
- Front face corners (model space): `a0 = fi×60° − 30°`, `a1 = fi×60° + 30°`, with `fi = currentIndex`. Corners: `(R·sin a0, screenY, R·cos a0)`, `(R·sin a1, screenY, R·cos a1)`, `(R·sin a1, bodyY, R·cos a1)`, `(R·sin a0, bodyY, R·cos a0)`. Only the **screen** strip counts, not the body.
- Each corner projected: `clip = mvp × (x,y,z,1)`, `ndcX = clip.x/clip.w`, `ndcY = clip.y/clip.w`, screen `sx = (ndcX+1)/2 × viewportW`, `sy = (1−ndcY)/2 × viewportH`.
- Point-in-convex-quad test: for each edge, cross product sign; all same sign (or zero) → inside.

### 6.5 Face texture (rendered in a 512 px bitmap, then uploaded)

`shade(color, f)` = `Color.rgb(trunc(R·f), trunc(G·f), trunc(B·f))` with each clamped to 0..255 (truncation toward zero, not rounding).

Precomputed values (exact):
- `shade(#8D6E63, 0.5)` = `#463731` (face background, both states).
- `shade(#8D6E63, 0.8)` = `#70584F` (top cap texture).
- `shade(#F5F0E0, 0.85)` = `#D0CCBE` (pressed screen fill).
- `shade(#C2185B, 0.75)` = `#911244` (rib color for the default body).
- `shade(#C2185B, 0.6)` = `#740E36` (bottom cap for the default body).

Matching body colors (set by `setBodyColor`):

| Body state | Body `bodyColor` | Ribs `shade(body, 0.75)` | Bottom cap `shade(body, 0.6)` |
|---|---|---|---|
| Normal | `#9C27B0` | `#751D84` | `#5D1769` |
| Correct | `#4DB6AC` | `#398881` | `#2E6D67` |
| Wrong | `#C85080` | `#963C60` | `#78304C` |

Body texture (`createBodyTexture`): 512 × 512, fill `bodyColor`, then 6 horizontal rib lines at `y = 512 × i / 7` for `i = 1..6`, from x = 4 to x = 508, stroke width 3 px, color `shade(bodyColor, 0.75)`.

Cap textures: top = solid `shade(#8D6E63, 0.8)`; bottom = solid `shade(bodyColor, 0.6)` (created in `rebuildTextures`).

Face texture (`createFaceTexture(size=512, text, accent=faceColors[i], pressed)`): background first `drawColor(shade(#8D6E63, 0.5))` (i.e. `#463731`). Let `m = 0.06 × size` (30.72 px), `r = 0.10 × size` (51.2 px corner radius).

**Raised** (`pressed = false`):
1. Drop shadow: rounded rect `(m + s, m + 1.5s, size − m + s, size − m + 1.5s)` with `s = 0.02 × size` (10.24 px), fill `#60000000`, radius r.
2. Button: rounded rect `(m, m, size − m, size − m)`, fill `accent` (the face's accent color), radius r.
3. Top highlight: rounded rect `(m, m, size − m, m + 0.08 × size)`, fill `#40FFFFFF`, radius r.
4. Bottom shadow: rounded rect `(m, size − m − 0.06 × size, size − m, size − m)`, fill `#30000000`, radius r.
5. Screen: `sm = 0.12 × size` (61.44 px). Rounded rect `(sm, sm, size − sm, size − sm)`, radius `0.6 × r`, fill `#F5F0E0`.
6. Screen border: stroke width `0.012 × size` (6.14 px), color `shade(accent, 0.7)`, same rect and radius.
7. Text: color `#333333`, y offset 0.

**Pressed** (`pressed = true`):
1. Button: rounded rect `(m, m + 0.02 × size, size − m, size − m)`, fill `shade(accent, 0.65)`, radius r. No drop shadow.
2. Inner shadow: rounded rect `(m, m + 0.02 × size, size − m, m + 0.10 × size)`, fill `#40000000`, radius r.
3. Screen: `sm = 0.13 × size` (66.56 px). Rounded rect `(sm, sm + 0.02 × size, size − sm, size − sm)`, radius `0.6 × r`, fill `shade(#F5F0E0, 0.85)` = `#D0CCBE`.
4. Screen border: stroke width `0.012 × size`, color `shade(accent, 0.5)`.
5. Text: color `#555555`, y offset `0.01 × size`.

Text (`drawWrappedText`): `TextPaint` anti-aliased, center-aligned, `Typeface.DEFAULT_BOLD`, `textSize = 0.22 × size` (112.64 px). `maxWidth = trunc(size − screenMargin × 2.5)` (raised: 358 px with sm 61.44; pressed: 345 px with sm 66.56). Build a centered `StaticLayout` (no extra padding); while `lineCount > 3` and `textSize > 0.1 × size` (51.2 px), reduce `textSize` by 2 px and rebuild. Draw at `x = size/2`, `y = size/2 + yOffset − textHeight/2`.

Texts are `answers[i % answers.size]` (the face's answer). Faces `i` use `faceColors[i]`, so a given answer's accent color depends on its face index.

### 6.6 Dirty/rebuild

`texturesDirty` is set by `setAnswerList`, `setBodyColor`, `pressCurrentFace`, and on surface creation. `onDrawFrame` rebuilds all textures when dirty (deletes old textures, makes 6 face + 6 body + 2 cap textures). Note: `rebuildTextures` runs on every change, so every feedback state change rebuilds 14 bitmaps.

### 6.7 Known rendering quirks (factual)

- `drawFaceStrip` and `drawCap` reset `vertBuf.position(0)` and use absolute indices, which is correct because indices are absolute into the full per-face-array layout (verified by reading `buildStrip`).
- Front-face hit test uses `targetRotation`, drawing uses `currentRotation`. They agree only when `animating` is false.

---

## 7. `FlowLayout` (Missing Letter tiles only)

Source: `FlowLayout.kt`. A `ViewGroup` that wraps children into rows and centers each row.

`onMeasure`:
- `maxWidth = specWidth − paddingLeft − paddingRight`. Children measured with `AT_MOST maxWidth`, `heightMeasureSpec` unchanged. Gone children skipped.
- Row break when `x + child.measuredWidth > maxWidth && x > 0`. `x` accumulates `child.measuredWidth + horizontalSpacing`. `rowHeight` = max child height; on break, `y += rowHeight + verticalSpacing`.
- After the loop, `y += rowHeight` (adds the last row). Height = `y + paddingTop + paddingBottom` (resolved with the height spec).

`onLayout`:
- First pass: build rows. A child starts a new row when `currentRowWidth + child.measuredWidth > maxWidth && row not empty`. `currentRowWidth` adds `child.measuredWidth + horizontalSpacing` per child. Row width used for centering = sum − trailing `horizontalSpacing`.
- Second pass: for each row, `offsetX = (maxWidth − rowWidth) / 2 + paddingLeft` (integer division), place children left to right with `horizontalSpacing`, `y += rowHeight + verticalSpacing` per row.

Spacing: `horizontalSpacing = verticalSpacing = 3 dp`. Space spacers are `Space` views of width 10 dp and height `tileSize`, which participate in wrap and centering like tiles.

---

## 8. Background views

### 8.1 `SunburstBackgroundView` (all three screens)

- 24 rays from the center `(w/2, h/2)`. Ray `i` spans angles `i × 15° − 90°` to `(i+1) × 15° − 90°` (0° is +x, −90° is up).
- Ray length: `maxRadius = max(w, h) × 1.5`, drawn as triangles `(center, p(start), p(end))`.
- Even rays use `primaryColor`, odd rays use `secondaryColor`.
- After rays, a full-rect overlay of `#55000000` darkens everything.
- Default colors before `setColors` are `#C4B8A8` / `#D4C8B8`. Every screen overrides these in `onViewCreated` or `displayRound`.
- Only redrawn on `setColors` (`invalidate()`); no animation.

### 8.2 `WhirlpoolView` (all three screens)

- Two spiral arms (phase 0 and π), color `#30FFFFFF` (ARGB alpha 0x30 = 48/255 ≈ 19 % white).
- Built once in `onSizeChanged(w, h)`. Not animated.
- Parameters: center `(w/2, h/2)`, `maxRadius = min(w, h) × 0.38`, `maxHalfWidth = maxRadius × 0.15`, `rotations = 3.5`, `pointsPerRotation = 120`, total points `= trunc(3.5 × 120) = 420`.
- Spiral: `a = maxRadius / (rotations × 2π)`. For each arm, for `i = 0..total`: `θ = i/total × rotations × 2π + phase`, `r = a × (θ − phase)`. Tangent `(dx, dy) = (a·cos θ − r·sin θ, a·sin θ + r·cos θ)`, normalized, perpendicular `(−dy, dx)/|…|`. Half width `halfW = (i/total) × maxHalfWidth`. Left edge = centerline + perp × halfW; right edge = centerline − perp × halfW. Path: left edge forward, right edge backward, close.
- Drawn with `drawPath` (fill, no stroke).

---

## 9. All user-visible English strings (exact)

From `res\values\strings.xml`, used by these three screens:

| Resource | Exact English text | Used by |
|---|---|---|
| `x_to_go` | `%1$s to go` | Counter, all three screens (`getString(R.string.x_to_go, remaining)`) |
| `smash_odd_one_out` | `Tap to smash odd one out` | Elimination instruction (layout `@string/smash_odd_one_out`) |
| `swipe_to_match` | `Swipe to find, tap to match` | Matching instruction (layout `@string/swipe_to_match`) |

Russian (`res\values-ru\strings.xml`), for reference:

| Resource | Russian |
|---|---|
| `x_to_go` | `Осталось %1$s` |
| `smash_odd_one_out` | `Нажмите, чтобы разбить лишнее` |
| `swipe_to_match` | `Проведите для поиска, нажмите для пары` |

Not used by these screens: `finals_warning` (trivia layout only), `drag_to_link` (not referenced in the three fragments or layouts).

Data-driven user text (from the server, shown verbatim): Elimination `QuestionText` and `CorrectAnswer`/`IncorrectAnswers`; Matching `QuestionText` and face `AnswerText`/`DummyAnswerData`; Missing Letter `Question`, `answerInfo` tiles and `letters` buttons.

No other visible text: no titles, no labels, no toasts, no dialogs, and the wrong overlay has no text. `Log.d` messages are not user-visible.

---

## 10. Not found / open items

- **Real `ServerBeginEliminatingAnsweringPhase` example**: not found in `docs\fullgame-decades.txt` or `docs\fullgame.txt`.
- **Real `ServerBeginMatchingAnsweringPhase` example**: not found in either docs file.
- **Real `ServerBeginMissingLetterAnsweringPhase` example**: found (section 1.4).
- **Sound, haptics, animations (other than the timed color/overlay changes and the hex rotation easing)**: not found in these files.
- **Visible countdown / timer UI**: not found in any of the three layouts or fragments.
- **Retry limit, time penalty, or score penalty for wrong answers**: not found (wrong answers only trigger a delay and disabling).
- **Use of `CorrectInfo`, `IncorrectInfo`, `finalDisplay`, `ChallengeId`, `serverTick`** in these fragments: not found (section 1.1).
- **`ClientToServerOngoingChallengeMessage` from Missing Letter**: not found in code (the protocol comment says it applies; section 3.5.1).
- **Behaviour when the server sends a Begin message with invalid data** (empty rounds, fewer than 2 incorrect answers, empty dummies, empty `correct`): crashes or undefined as described in sections 2.3, 3.3, 4.9. No guard exists.
- **Pending callbacks across a new Begin** (no `removeCallbacksAndMessages` in `startGame`): observed from source, not tested on device.
- **Visual verification** of the GL column, z-order over text, and the Russian strings' fit: not verified (source-only analysis).
