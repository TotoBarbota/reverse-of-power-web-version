# Linking and Sorting minigames: porting spec (Android Kotlin to HTML/JS)

Source root: `reverse-of-power\app\src\main`
(Kotlin paths below are relative to `java\com\game\remoteclient\ui` unless stated.)

Read-only analysis. Every value below was read from source. Items marked **[inferred]** are derived from Android framework behaviour, not from app code, and need an on-device check before the port relies on them.

Conventions:
- `dp` / `sp` values are as written in the XML. Android `px` in Paint and `Bitmap` code is raw pixels, not dp.
- `Kotlin: file:line` references point at the labelled line numbers shown in the source listing. Where a line number is not labelled, the function name is given.

---

## 0. Screens in scope

| Screen (Kotlin) | Layout | Minigame | Server message | Answer message sent |
|---|---|---|---|---|
| `LinkingPairsFragment` | `fragment_linking_pairs.xml` | Linking, match pairs (KIP) | `ServerBeginLinkingAnsweringPhase` | `ClientLinkingAnswer` |
| `LinkingAnswersFragment` | `fragment_linking_answers.xml` | Linking, word chain / ordering (Decades) | `ServerBeginOrderingAnsweringPhase`, converted to linking format in `NetworkManager` | `ClientToServerOrderingAnswer` |
| `SortingAnswersFragment` | `fragment_sorting_answers.xml` | Sorting into two buckets (KIP) | `ServerBeginSortingAnsweringPhase` | `ClientSortingAnswer` |
| `LinkingLineView` | (custom view, used inside both linking layouts) | Drag line drawing and touch routing | n/a | n/a |

Code comments for the two linking styles: the debug launcher labels the pairs screen "KIP-style: top/bottom half-circles, Direction 1=top, 2=bottom, match by AnswerID suffix" and the chain screen "Decades-style: words grouped by MatchIndex, Direction = order within phrase" (`ui\DebugLauncherFragment.kt`, `launchLinkingPairs` / `launchLinkingChain`). The protocol doc comment in `protocol\GameProtocol2Client.kt` lists sorting as removed in Decades.

---

## 1. Routing: which server message opens which screen

### 1.1 NetworkManager (`network\NetworkManager.kt`)

```kotlin
is ServerBeginLinkingAnsweringPhase -> {
    pendingLinking = message
    onLinkingMessage?.invoke(message)
}

is ServerBeginOrderingAnsweringPhase -> {
    // Convert ordering data to linking format for the fragment
    val linkingAnswers = message.OrderingAnswerData.flatMapIndexed { matchIndex, data ->
        data.WordsInCorrectOrder.mapIndexed { direction, word ->
            LinkingAnswer(
                DisplayText = word,
                AnswerID = "ORD_${matchIndex}_$direction",
                MatchIndex = matchIndex,
                Direction = direction
            )
        }
    }
    val converted = ServerBeginLinkingAnsweringPhase(
        QuestionID = message.ChallengeId,
        QuestionText = message.QuestionText,
        QuestionDuration = message.QuestionDuration,
        LinkingAnswers = linkingAnswers
    )
    pendingLinking = converted
    onOrderingMessage?.invoke(converted)
}

is ServerBeginSortingAnsweringPhase -> {
    pendingSorting = message
    onSortingMessage?.invoke(message)
}
```

Ordering conversion, in words:
- `MatchIndex` = 0-based index of the group in `OrderingAnswerData`.
- `Direction` = 0-based index of the word inside `WordsInCorrectOrder`.
- `AnswerID` = `"ORD_<MatchIndex>_<Direction>"`, for example `ORD_0_0`, `ORD_0_1`.
- `LayoutId` on `OrderingAnswerData` is declared but not read by any linking or sorting screen (grep: declaration only).
- `serverTick` on the ordering and sorting messages is not read by these screens.

Wire decoding (`protocol\ProtocolDecoder.kt`, lines ~247-258 and ~293-296): `typeString.contains(...)` routes `"ServerBeginLinkingAnsweringPhase"`, `"ServerBeginSortingAnsweringPhase"` and `"ServerBeginOrderingAnsweringPhase"`.

### 1.2 HoldingScreenFragment (`ui\HoldingScreenFragment.kt`)

Subscriptions and navigation:

```kotlin
linkingCb = { _ ->
    activity?.runOnUiThread { navigateToLinkingPairs() }
}
orderingCb = { _ ->
    activity?.runOnUiThread { navigateToOrderingAnswers() }
}
sortingCb = { _ ->
    activity?.runOnUiThread { navigateToSortingAnswers() }
}
...
networkManager.onLinkingMessage = linkingCb
networkManager.onOrderingMessage = orderingCb
networkManager.onSortingMessage = sortingCb
...
private fun navigateToLinkingPairs() {
    findNavController().navigate(R.id.action_holdingScreen_to_linkingPairs)
}

private fun navigateToOrderingAnswers() {
    findNavController().navigate(R.id.action_holdingScreen_to_linkingAnswers)
}

private fun navigateToSortingAnswers() {
    findNavController().navigate(R.id.action_holdingScreen_to_sortingAnswers)
}
```

Destinations (`res\navigation\nav_graph.xml`):
- `action_holdingScreen_to_linkingPairs` goes to `LinkingPairsFragment`.
- `action_holdingScreen_to_linkingAnswers` goes to `LinkingAnswersFragment`.
- `action_holdingScreen_to_sortingAnswers` goes to `SortingAnswersFragment`.

Routing summary:
- A `ServerBeginLinkingAnsweringPhase` opens the **pairs** screen.
- A `ServerBeginOrderingAnsweringPhase` opens the **chain** (`LinkingAnswersFragment`) screen.
- A `ServerBeginSortingAnsweringPhase` opens the **sorting** screen.

### 1.3 Pending-message hand-off (all three screens)

Each fragment consumes a pending phase in `onViewCreated`:

```kotlin
networkManager.pendingLinking?.let { phase ->
    startGame(phase)
    networkManager.pendingLinking = null
}
```

(`LinkingAnswersFragment` ~line 72, `LinkingPairsFragment` ~line 68, `SortingAnswersFragment` ~line 72 with `pendingSorting`.)

### 1.4 Exit from every screen

All three screens subscribe to `onHoldingScreenMessage` and leave on **any** `ClientHoldingScreenCommandMessage`, regardless of its content:

```kotlin
holdingScreenCb = { _ ->
    activity?.runOnUiThread { navigateToHoldingScreen() }
}
...
private fun navigateToHoldingScreen() {
    findNavController().popBackStack(R.id.holdingScreenFragment, false)
}
```

The screens do not navigate on their own after sending an answer. They wait for the server's holding-screen message.

### 1.5 Subscriptions per screen (for the port's message bus)

- `LinkingPairsFragment`: `onHoldingScreenMessage`, `onLinkingMessage`.
- `LinkingAnswersFragment`: `onHoldingScreenMessage`, `onLinkingMessage`. It does **not** subscribe to `onOrderingMessage`. See section 9.
- `SortingAnswersFragment`: `onHoldingScreenMessage` only. It does not subscribe to `onSortingMessage`. See section 9.

---

## 2. Shared visual background and feedback colours

### 2.1 Colours (identical in all three fragments, hard-coded hex, not from `colors.xml`)

| Name | Hex | Kotlin |
|---|---|---|
| normal primary | `#E8679A` | `normalPrimary = Color.parseColor("#E8679A")` |
| normal secondary | `#D05888` | `normalSecondary = Color.parseColor("#D05888")` |
| correct primary | `#4DB6AC` | `correctPrimary` |
| correct secondary | `#3DA69C` | `correctSecondary` |
| incorrect primary | `#C85080` | `incorrectPrimary` |
| incorrect secondary | `#B04070` | `incorrectSecondary` |

`colors.xml` has no entries used by these screens. Its `@color/primary` (`#FF2196F3`) is used only as the default fill of the drawables, and the layouts override it with `backgroundTint`.

### 2.2 Sunburst background (`ui\SunburstBackgroundView.kt`)

- `setColors(primary, secondary)` sets the two colours and calls `invalidate()`. **No animation**. Colour changes are instant.
- 24 rays. Ray `i` spans angles `i*15-90` to `(i+1)*15-90` degrees, with 0 degrees along +x and -90 degrees pointing up. Even rays use `primary`, odd rays use `secondary`.
- Ray length is `maxRadius = max(width, height) * 1.5`, from the centre.
- After the rays, a full-size rectangle is filled with `#55000000` (dark overlay).
- Default colours are `#C4B8A8` and `#D4C8B8` (only used if nothing is set).

### 2.3 Whirlpool overlay (`ui\WhirlpoolView.kt`, in all three layouts)

- Two spiral arms, `rotations = 3.5`, `pointsPerRotation = 120`.
- `maxRadius = min(w,h) * 0.38`, `maxHalfWidth = maxRadius * 0.15`, arm half-width tapers from 0 at the centre to `maxHalfWidth` at the outside.
- Fill colour `#30FFFFFF` (white, about 19 percent alpha).
- Built in `onSizeChanged`, drawn as two filled paths.

### 2.4 Shared feedback helper pattern

All three screens use the same feedback helper pattern:
- A feedback overlay (`feedbackOverlay`) is made `VISIBLE`, showing answer text.
- `sunburstBackground` is recoloured to correct or incorrect colours.
- After a delay, `hideFeedback()` hides the overlay and restores `normalPrimary` and `normalSecondary`.

```kotlin
private fun hideFeedback() {
    binding.feedbackOverlay.visibility = View.GONE
    binding.sunburstBackground.setColors(normalPrimary, normalSecondary)
}
```

---

## 3. LinkingLineView (`ui\LinkingLineView.kt`)

Used as the topmost child of both linking layouts (`match_parent`). It receives every touch on the screen, so the slot views underneath never get touches directly.

### 3.1 Touch routing

```kotlin
override fun onTouchEvent(event: MotionEvent): Boolean {
    when (event.action) {
        MotionEvent.ACTION_DOWN -> {
            return onDragStart?.invoke(event.x, event.y) ?: false
        }
        MotionEvent.ACTION_MOVE -> {
            if (isDrawing) {
                onDragMove?.invoke(event.x, event.y)
                updateLine(event.x, event.y)
                return true
            }
            return false
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
            if (isDrawing) {
                clearLine()
                if (event.action == MotionEvent.ACTION_UP) {
                    onDragEnd?.invoke(event.x, event.y)
                }
                return true
            }
            return false
        }
    }
    return super.onTouchEvent(event)
}
```

Consequences:
- If `onDragStart` returns `false`, the gesture is not consumed and no further events are handled for it.
- `ACTION_CANCEL` clears the line but does **not** call `onDragEnd`.
- Each `ACTION_MOVE` calls `onDragMove` first, then `updateLine`. Hit-testing therefore happens only at the sampled MOVE points. A slot that the finger crosses between two samples is never tested.
- After `clearLine()`, `isDrawing` is false, so later MOVE events in the same gesture return `false` and are not handled. This is how a wrong attempt in the chain screen "ends" the drag without a new touch-down.

### 3.2 Line data model

- `startLine(x, y)`: `dragPath.reset()`, `moveTo(x,y)`, `isDrawing = true`.
- `updateLine(x, y)`: `lineTo(x,y)` only if `isDrawing`. The active path is a polyline through every MOVE sample.
- `commitDragAsChain(endX, endY)`: `dragPath.lineTo(endX, endY)`, then the path is copied into `chainPaths`, then `dragPath` is reset. This is the only place a line segment is persisted.
- `clearLine()`: `isDrawing = false`, `dragPath.reset()`.
- `clearChainLines()`: empties `chainPaths`.

### 3.3 Line rendering (device pixels, not dp)

- Outline paint: colour `#2299AA`, `strokeWidth = 24f`, `STROKE`, round cap, round join, anti-aliased.
- Stripe paint: `strokeWidth = 18f`, `STROKE`, round cap, round join, anti-aliased, with a shader.
- Stripe shader: a 20x20 px bitmap, `stripeWidth = 10`. Pixel `(x,y)` is white `#FFFFFF` when `((x+y)/10) % 2 == 0`, otherwise `#66CCDD`. Tile mode REPEAT on both axes.
- Draw order: for each path in `chainPaths`, outline then stripe. Then, if `isDrawing`, the active path gets outline then stripe.

---

## 4. LinkingAnswersFragment: word-chain ordering (Decades)

Layout: `fragment_linking_answers.xml`. Message: `ServerBeginOrderingAnsweringPhase`, converted (section 1.1). Answer message: `ClientToServerOrderingAnswer`.

### 4.1 Data and rounds

```kotlin
rounds = phase.LinkingAnswers
    .groupBy { it.MatchIndex }
    .toSortedMap()
    .values
    .map { group -> group.sortedBy { it.Direction } }
```

- A round is one `MatchIndex` group. Rounds are played in ascending `MatchIndex` order (not shuffled).
- Within a round, the correct order is the items sorted by `Direction` (`correctOrder`).
- Each time a round is displayed, the items are shuffled: `currentSlots = round.shuffled()`.
- `totalRounds = rounds.size`. A round is "done" when its whole chain has been connected.
- Only 5 slot views exist (`slot0` to `slot4`). A round with more than 5 items would show only the first 5 (no guard). Rounds with 3 or 4 items hide the unused slots (see 4.2).

### 4.2 Layout (`fragment_linking_answers.xml`)

Root is a `FrameLayout` `match_parent`. Child order (back to front): `sunburstBackground`, `WhirlpoolView`, `timerText`, `slot0`, `slot1`, `slot2`, `slot3`, `slot4`, `instructionText`, `feedbackOverlay`, `linkingLine`.

| View | Size | Gravity | Margins | Other |
|---|---|---|---|---|
| `timerText` | wrap | `top\|center_horizontal` | marginTop 8dp | 20sp bold, white, shadow `#80000000` dx2 dy2 r3, bg `#40000000`, paddingH 16dp, paddingV 4dp |
| `slot0` | 144dp x 144dp | `start\|top` | marginStart 16dp, marginTop 40dp | visible |
| `slot1` | 144dp x 144dp | `end\|top` | marginEnd 16dp, marginTop 32dp | visible |
| `slot2` | 144dp x 144dp | `center_horizontal\|bottom` | marginBottom 40dp | visible |
| `slot3` | 144dp x 144dp | `start\|bottom` | marginStart 8dp, marginBottom 32dp | **GONE** in XML, made visible per round |
| `slot4` | 144dp x 144dp | `end\|bottom` | marginEnd 8dp, marginBottom 32dp | **GONE** in XML, made visible per round |
| `instructionText` | wrap | `center` | none | 16sp, text `#CCFFFFFF`, bg `#30000000`, paddingH 20dp, paddingV 6dp |
| `feedbackOverlay` | match_parent | n/a | n/a | **GONE** by default; inner `LinearLayout` is wrap, centred, vertical, bg `circle_background` (oval) tinted `#DDFFFFFF`, padding 32dp |
| `feedbackTopText` | wrap | centre | n/a | 22sp bold, `#333333`, gravity center |
| `feedbackBottomText` | wrap | centre | marginTop 8dp | 22sp bold, `#333333`, **GONE** in XML and never made visible here |
| `linkingLine` | match_parent | n/a | n/a | `LinkingLineView` |

Slot shape and text (all five slots): `TextView` with `background` `@drawable/circle_background` (an `oval`) and `backgroundTint` `#F0EAD6`. Text 16sp bold, colour `#009688`, `gravity=center`, `autoSizeTextType=uniform`, `autoSizeMinTextSize=10sp`, `autoSizeMaxTextSize=16sp`, padding 12dp, `clickable` and `focusable` true in XML (but touch is taken by `linkingLine`).

Slot visibility per round (`displayRound`):
```kotlin
slotViews.forEachIndexed { index, tv ->
    if (index < currentSlots.size) {
        tv.text = currentSlots[index].DisplayText
        tv.visibility = View.VISIBLE
        tv.alpha = 1f
        tv.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#F0EAD6"))
    } else {
        tv.visibility = View.GONE
    }
}
```
So a 3-item round uses `slot0` to `slot2`; a 4-item round uses `slot0` to `slot3`; a 5-item round uses all five. Positions are fixed by slot index, and the shuffled order decides which phrase word lands in which position.

Slot positions as hit-test centres: because these slots have no rotation, the hit box and visual box are the same (section 4.5).

### 4.3 Colours used on this screen

- Background: normal `#E8679A` / `#D05888`, correct `#4DB6AC` / `#3DA69C`, incorrect `#C85080` / `#B04070`.
- Slot fill: `#F0EAD6` (idle).
- Slot fill when connected in the current chain: `#B2DFDB` (see `updateSlotHighlights`).
- Slot text: `#009688`.
- Overlay box fill: `#DDFFFFFF`. Overlay text: `#333333` in XML, but `feedbackTopText` colour is overwritten in code (see 4.7).

### 4.4 Timer and counter

Timer (`startGame`):
```kotlin
val durationMs = (phase.QuestionDuration * 1000).toLong()
timer = object : CountDownTimer(durationMs, 1000) {
    override fun onTick(millisUntilFinished: Long) {}
    override fun onFinish() {
        if (_binding == null) return
        sendAnswer()
    }
}.start()
```
- `QuestionDuration` is seconds as a Double. Ticks are ignored, so there is **no visible countdown clock**.
- The timer starts after the first round is displayed. It is not paused or resumed by any message on this screen.

Counter (`updateCounter`):
```kotlin
private fun updateCounter() {
    val remaining = totalRounds - currentRoundIndex
    binding.timerText.text = getString(R.string.x_to_go, remaining)
}
```
- Shown on `timerText` as `"<n> to go"` (string `x_to_go` = `"%1$s to go"`).
- Set in `startGame` (shows `totalRounds to go`) and after each completed round. It goes down to `"0 to go"` after the last round and is **not** hidden at zero.

### 4.5 Drag and tap mechanics

Hit test (`findSlotAt`, `isPointInView`): axis-aligned rectangle test on each slot's window bounds (`x >= left && x <= right && y >= top && y <= bottom`). Only slots with `visibility == VISIBLE` and index `< currentSlots.size` are tested, in index order `0` to `4`, first hit wins. **No hit radius or padding.** Each slot is a 144 x 144 dp square even though it is drawn as a circle.

Connection centre (`getSlotCenter`): the centre of the slot's bounds, converted into the overlay's coordinates:
```kotlin
val x = (loc[0] - overlayLoc[0]).toFloat() + view.width / 2f
val y = (loc[1] - overlayLoc[1]).toFloat() + view.height / 2f
```

Gesture flow:

1. **Touch down** (`onDragStart`):
```kotlin
binding.linkingLine.onDragStart = { x, y ->
    if (chainLocked) {
        false
    } else {
        val slot = findSlotAt(x, y)
        if (slot != null && canStartFrom(slot)) {
            connectedChain.add(slot)
            updateSlotHighlights()
            val center = getSlotCenter(getSlotView(slot))
            binding.linkingLine.startLine(center[0], center[1])
            true
        } else {
            false
        }
    }
}
```
   - Starting is allowed only on the slot whose `AnswerID` equals `correctOrder[0].AnswerID`, and only when the chain is empty (`canStartFrom`). Touching any other slot is silently ignored: no line, no attempt recorded, no penalty.
   - Touch down is ignored while `chainLocked` is true.
   - On success the start slot is added to the chain and the line starts at its centre.

2. **Move** (`onDragMove`): runs only if `connectedChain` is not empty and not `chainLocked`. The slot under the finger is looked up. Ignored if no slot is under the finger, or if the slot is already in the chain (`connectedChain.contains(slot)`).
   - **Correct next slot** (`isCorrectNext`: `currentSlots[slot].AnswerID == correctOrder[connectedChain.size].AnswerID`):
```kotlin
val toCenter = getSlotCenter(getSlotView(slot))
binding.linkingLine.commitDragAsChain(toCenter[0], toCenter[1])

connectedChain.add(slot)
updateSlotHighlights()
binding.linkingLine.startLine(toCenter[0], toCenter[1])

if (connectedChain.size == currentSlots.size) {
    binding.linkingLine.clearLine()
    evaluateChain()
}
```
     The completed segment snaps to the target circle's centre. The next drag segment starts from the same centre. When the whole chain is connected, the in-progress line is cleared and `evaluateChain()` runs.
   - **Wrong slot** (any other unconnected slot):
```kotlin
binding.linkingLine.clearLine()
recordFailedAttempt()
chainLocked = true
binding.sunburstBackground.setColors(incorrectPrimary, incorrectSecondary)
binding.root.postDelayed({
    if (_binding == null) return@postDelayed
    binding.sunburstBackground.setColors(normalPrimary, normalSecondary)
    chainLocked = false
    resetChain()
}, 400)
```
     The in-progress line is removed at once. The sunburst flashes incorrect colours for 400 ms. After 400 ms the chain is reset: `connectedChain` is cleared, `chainPaths` are cleared, and highlights reset. The finger must lift and touch down again to continue.

3. **Touch up** (`onDragEnd`):
```kotlin
binding.linkingLine.onDragEnd = { _, _ ->
    if (!chainLocked && connectedChain.size < currentSlots.size) {
        resetChain()
    }
}
```
   Releasing an incomplete chain resets it (clears chain lines and highlights). No attempt is recorded for it.

Slot highlight (`updateSlotHighlights`): every visible slot in the round gets `#B2DFDB` if its index is in `connectedChain`, otherwise `#F0EAD6`.

Line style: the path is drawn per section 3.3. The completed chain segments are persisted in `chainPaths`; they remain on screen until the next round starts (`displayRound` calls `clearChainLines()`) or until `resetChain()`.

### 4.6 What counts as correct

- For each step, the dragged slot's `AnswerID` must equal `correctOrder[connectedChain.size].AnswerID`, where `correctOrder` is the round sorted by `Direction` (ascending).
- The first step must be `correctOrder[0]`.
- A round is correct only when the full chain is connected in order. Partial chains are not scored.
- `MatchIndex` is only used for grouping rounds. It is not compared per step.

### 4.7 Retries, penalties, and scoring

- Wrong attempts are allowed. After a wrong step the chain resets and the player can try again within the same round, with no limit on attempts.
- There is no time penalty and no score deduction in the UI.
- `correctCount` increments by 1 per correct round (`evaluateChain`). Failed attempts do not change it.
- The attempt list is built (`recordFailedAttempt`, `evaluateChain`) but is **never sent**. See section 4.10.

`recordFailedAttempt()`:
```kotlin
val chainAnswers = connectedChain.map { currentSlots[it] }
for (i in 0 until chainAnswers.size - 1) {
    attempts.add(ClientLinkingAnswerEntry(
        FromID = chainAnswers[i].AnswerID,
        ToID = chainAnswers[i + 1].AnswerID,
        Correct = false
    ))
}
```
A wrong step therefore records the pairs of the partial chain before the wrong slot, each as `Correct=false`. The wrong slot itself is not recorded.

### 4.8 Feedback on a completed round (`evaluateChain`)

```kotlin
val phraseText = correctOrder.joinToString(" ") { it.DisplayText }
chainLocked = true
showFeedback(phraseText, true)
binding.feedbackOverlay.postDelayed({
    if (_binding == null) return@postDelayed
    hideFeedback()
    chainLocked = false
    currentRoundIndex++
    updateCounter()
    if (currentRoundIndex >= totalRounds) {
        sendAnswer()
    } else {
        displayRound()
    }
}, 600)
```

- Overlay text: the correct phrase, all words joined by single spaces, in `Direction` order (for example `Walk This Way`). `feedbackBottomText` is GONE.
- `showFeedback(text, correct=true)`: `feedbackOverlay` VISIBLE, sunburst to `#4DB6AC`/`#3DA69C`, `feedbackTopText` colour `#4DB6AC`.
- Duration: 600 ms. Then `hideFeedback()` restores normal colours, the counter updates, and the next round is shown (or the answer is sent after the last round).
- After the last round the completed chain lines and highlights stay on screen (`#B2DFDB`) until the holding screen takes over.

Feedback for a wrong step: no overlay and no text. Only the sunburst colour changes (400 ms).

No `correct` or `incorrect` words are shown on this screen.

### 4.9 Sending (`sendAnswer`)

```kotlin
private fun sendAnswer() {
    if (answerSent) return
    answerSent = true
    timer?.cancel()
    Log.d("LinkingAnswers", "Sending answer: $correctCount correct out of $totalRounds")
    networkManager.sendOrderingAnswer(correctCount)
}
```

`NetworkManager.sendOrderingAnswer`:
```kotlin
fun sendOrderingAnswer(correctCount: Int) {
    Log.d(TAG, "Ordering answer: $correctCount correct")
    scope.launch {
        protocolClient?.sendMessage(ClientToServerOrderingAnswer(
            ClientOrderingCorrectAnswerCount = correctCount
        ))
    }
}
```

Wire type: `ClientToServerOrderingAnswer`, `TypeString = "KnowledgeIsPower.ClientToServerOrderingAnswer"`, field `ClientOrderingCorrectAnswerCount: Int`. There is no attempts array.

When it is sent:
1. **Timer expiry** (`onFinish`): sends `correctCount` as it stands. A partially built chain is not counted.
2. **Last round completed**: sent 600 ms after the last correct chain.

Sent only once (`answerSent`). Input is **not** disabled after sending (see section 8).

Per-step progress messages: none. `ClientToServerOngoingChallengeMessage` is not sent here (see section 9).

### 4.10 Timeout

On timer expiry the same `sendAnswer()` runs. It sends `ClientOrderingCorrectAnswerCount = correctCount`. There is no timeout flag, and no field distinguishes a timeout from a finish.

### 4.11 Edge cases in code

- **Round of 1 item**: `onDragStart` checks the start slot and adds it to the chain, but nothing checks for completion there. Completion is only checked after a successful step in `onDragMove`. With one item the round cannot be finished by the player, so the screen waits for the timer.
- **No rounds**: `displayRound()` returns early; nothing is sent until the timer expires.
- **More than 5 items in a round**: only the first 5 are rendered (`getSlotViews()` lists 5 views). No check is performed.

### 4.12 User-visible strings on this screen

- Instruction (`instructionText`): `drag_to_link_in_order` = **"Drag to link in order"**. Set in `startGame` and never changed. (The XML default is `drag_to_link`, but code overwrites it.)
- Counter (`timerText`): `x_to_go` = **"%1$s to go"** (for example "3 to go", "0 to go").
- Feedback text: the phrase built from `DisplayText` values (section 4.8).
- Slot text: the `DisplayText` of each item.
- No other fixed text.

---

## 5. LinkingPairsFragment: match pairs (KIP)

Layout: `fragment_linking_pairs.xml`. Message: `ServerBeginLinkingAnsweringPhase` (`Direction` 1 = top, 2 = bottom). Answer message: `ClientLinkingAnswer`.

### 5.1 Data and queues

```kotlin
val allAnswers = phase.LinkingAnswers.sortedBy { it.MatchIndex }

topQueue.clear()
bottomQueue.clear()
topQueue.addAll(allAnswers.filter { it.Direction == 1 })
bottomQueue.addAll(allAnswers.filter { it.Direction == 2 })

totalPairs = minOf(topQueue.size, bottomQueue.size)
correctCount = 0
attempts.clear()
answerSent = false

fillSlots()
updateUI()
```

- Items with `Direction` other than 1 or 2 are dropped without any error.
- `sortedBy` is stable, so the original server order is kept within each `MatchIndex`.
- `totalPairs = min(topCount, bottomCount)`. Extra items can still appear on screen, but they do not count toward completion.
- Active slots: 3 on top (`activeTop[0..2]`) and 3 on bottom (`activeBottom[0..2]`).

`fillRow`:
```kotlin
private fun fillRow(slots: Array<LinkingAnswer?>, queue: MutableList<LinkingAnswer>) {
    val occupied = slots.count { it != null }
    val toFill = minOf(3 - occupied, queue.size)
    if (toFill <= 0) return

    val emptyIndices = slots.indices.filter { slots[it] == null }.shuffled()
    for (i in 0 until toFill) {
        slots[emptyIndices[i]] = queue.removeFirst()
    }
}
```
- Queue items are placed into randomly chosen empty slot indices.
- Because only one slot per side empties per correct match, a replacement normally lands in the same slot index that was just cleared.

### 5.2 Match key and the guaranteed-visible-pair rule

Match key:
```kotlin
private fun getMatchKey(answerId: String): String {
    val afterAnswer = answerId.substringAfter("Answer", "")
    return if (afterAnswer.length >= 2) afterAnswer.drop(1) else answerId
}
```
- `"LNK00086_AnswerA01"` gives key `"01"`. `"LNK00086_AnswerB01"` also gives `"01"`. So these two match.
- The letter after `Answer` is ignored. `AnswerA` and `AnswerB` with the same digits match each other. Two items from different questions with the same digits would also match.
- An ID without `Answer` (or with fewer than 2 chars after it) is used whole as the key.

`ensureMatch()` runs at the end of every `fillSlots()`. It guarantees a visible matching pair when possible:
```kotlin
val topKeys = activeTop.filterNotNull().map { getMatchKey(it.AnswerID) }.toSet()
val bottomKeys = activeBottom.filterNotNull().map { getMatchKey(it.AnswerID) }.toSet()

if (topKeys.intersect(bottomKeys).isNotEmpty()) return

// Try swapping from bottom queue to match any active top item
for (topItem in activeTop.filterNotNull()) {
    val topKey = getMatchKey(topItem.AnswerID)
    val matchIdx = bottomQueue.indexOfFirst { getMatchKey(it.AnswerID) == topKey }
    if (matchIdx >= 0) {
        val match = bottomQueue.removeAt(matchIdx)
        val swapIdx = activeBottom.indices.first { activeBottom[it] != null }
        activeBottom[swapIdx]?.let { bottomQueue.add(it) }
        activeBottom[swapIdx] = match
        return
    }
}

// Try swapping from top queue to match any active bottom item
for (bottomItem in activeBottom.filterNotNull()) {
    val bottomKey = getMatchKey(bottomItem.AnswerID)
    val matchIdx = topQueue.indexOfFirst { getMatchKey(it.AnswerID) == bottomKey }
    if (matchIdx >= 0) {
        val match = topQueue.removeAt(matchIdx)
        val swapIdx = activeTop.indices.first { activeTop[it] != null }
        activeTop[swapIdx]?.let { topQueue.add(it) }
        activeTop[swapIdx] = match
        return
    }
}

// Both queues exhausted and no matches visible — auto-submit
sendAnswer()
```
- Swaps always replace the first occupied slot on the other side (lowest index), and the displaced item goes to the back of its queue.
- If no pair can be made visible, `sendAnswer()` runs immediately. This happens at the normal end of play (nothing left active or queued), or when an active item has no partner anywhere (data mismatch).
- Note: `fillSlots()` at start runs before the timer is created (see section 5.9).

### 5.3 Layout (`fragment_linking_pairs.xml`)

Root `FrameLayout` `match_parent`. Child order: `sunburstBackground`, `WhirlpoolView`, `timerText`, `topSlot0`, `topSlot1`, `topSlot2`, `instructionText`, `bottomSlot0`, `bottomSlot1`, `bottomSlot2`, `feedbackOverlay`, `linkingLine`.

| View | Size | Gravity | Margins | Rotation | Initial visibility |
|---|---|---|---|---|---|
| `timerText` | wrap | `top\|center_horizontal` | marginTop 8dp | none | VISIBLE; 20sp bold white, shadow `#80000000` dx2 dy2 r3, bg `#40000000`, paddingH 16dp, paddingV 4dp |
| `topSlot0` | 200dp x 100dp | `start\|top` | marginStart 20dp, marginTop 24dp | **-12** | VISIBLE |
| `topSlot1` | 200dp x 100dp | `end\|top` | marginEnd 20dp, marginTop 16dp | **12** | VISIBLE |
| `topSlot2` | 200dp x 100dp | `center_horizontal\|top` | marginTop 20dp | **3** | **INVISIBLE** |
| `instructionText` | wrap | `center` | none | none | 16sp, `#CCFFFFFF`, bg `#30000000`, paddingH 20dp, paddingV 6dp |
| `bottomSlot0` | 200dp x 100dp | `start\|bottom` | marginStart 60dp, marginBottom 24dp | **8** | VISIBLE |
| `bottomSlot1` | 200dp x 100dp | `end\|bottom` | marginEnd 20dp, marginBottom 16dp | **-8** | VISIBLE |
| `bottomSlot2` | 200dp x 100dp | `center_horizontal\|bottom` | marginBottom 20dp | **-3** | **INVISIBLE** |
| `feedbackOverlay` | match_parent | n/a | n/a | none | GONE by default; inner `LinearLayout` wrap, centred, vertical, bg `circle_background` tinted `#DDFFFFFF`, padding 32dp |
| `feedbackTopText` | wrap | centre | n/a | none | 22sp bold, `#333333` (overwritten in code) |
| `feedbackBottomText` | wrap | centre | marginTop 8dp | none | 22sp bold, `#333333` (overwritten in code); no visibility attribute, so VISIBLE |
| `linkingLine` | match_parent | n/a | n/a | none | `LinkingLineView` |

Slot text: `TextView` `match_parent` inside each slot. 16sp bold, `#333333`, `gravity=center`, padding 8dp, `backgroundTint #F0EAD6`. Top slots use `@drawable/half_circle_top`, bottom slots use `@drawable/half_circle_bottom`.

Drawable shapes (XML, `res\drawable`):
- `half_circle_top`: `rectangle` with `topLeftRadius` and `topRightRadius` = 1000dp. Bottom corners square.
- `half_circle_bottom`: `rectangle` with `bottomLeftRadius` and `bottomRightRadius` = 1000dp.
- `circle_background`: `oval`.

Android caps corner radii to fit the box. **[inferred]** For a 200 x 100 dp slot, `half_circle_top` and `half_circle_bottom` therefore come out as half-discs with radius 100 dp (a dome with its flat edge at the bottom or top). Verify on device.

Per-slot rotation sets the visual tilt. Hit-testing is affected (section 5.4).

Colours on this screen: background sunburst as in section 2.1. Slot fill `#F0EAD6` (no highlight state). Text `#333333`. Feedback text `#4DB6AC` or `#C85080` (set in code).

### 5.4 Drag and hit-testing

Start (`onDragStart`):
```kotlin
binding.linkingLine.onDragStart = { x, y ->
    val slot = findTopSlotAt(x, y)
    if (slot != null && activeTop[slot] != null) {
        dragFromSlot = slot
        val center = getViewCenter(getTopSlotView(slot))
        binding.linkingLine.startLine(center[0], center[1])
        true
    } else {
        false
    }
}
```
- Only top slots can start a drag. The slot must hold an active item (`activeTop[slot] != null`). Hidden slots are excluded by this check.
- No line is drawn on touch-down unless the start is valid.

Release (`onDragEnd`):
```kotlin
binding.linkingLine.onDragEnd = { x, y ->
    val fromSlot = dragFromSlot
    if (fromSlot != null) {
        val bottomSlot = findBottomSlotAt(x, y)
        if (bottomSlot != null && activeTop[fromSlot] != null && activeBottom[bottomSlot] != null) {
            processMatch(fromSlot, bottomSlot)
        }
        dragFromSlot = null
    }
}
```
- The drop point is the release point. Only bottom slots that hold an active item count. Releasing anywhere else does nothing and records nothing.
- There is no `onDragMove` handler. The line follows the finger for drawing only (section 3), and there is no snapping to the bottom slot.
- There is no "drag over" hit test. A pair is judged only on release.

Hit-test rectangle (`isPointInView`):
```kotlin
val location = IntArray(2)
view.getLocationInWindow(location)
val overlayLocation = IntArray(2)
binding.linkingLine.getLocationInWindow(overlayLocation)
val viewX = (location[0] - overlayLocation[0]).toFloat()
val viewY = (location[1] - overlayLocation[1]).toFloat()
return x >= viewX && x <= viewX + view.width && y >= viewY && y <= viewY + view.height
```
- Rectangle test only. No hit radius.
- Visible-state is not checked here; the item checks above do that.

Centre for line start (`getViewCenter`): same arithmetic as the chain screen (location plus half width and half height).

**[inferred, verify on device]** Android's `View.getLocationInWindow` maps the view's local origin through the view's own transform (including rotation about the pivot). For a rotated view, the reported location is therefore the rotated top-left corner, not the unrotated corner. The code then uses the unrotated `width` and `height`. The result is that for each rotated slot, the hit box and the line start point are shifted from the visual centre by the offset below, where `c = cos(θ)`, `s = sin(θ)` and `θ` is the rotation:

- `dx = 100*(1 - c) + 50*s`
- `dy = 50*(1 - c) - 100*s`

Computed offsets, in dp:

| Slot | Rotation | dx | dy |
|---|---|---|---|
| `topSlot0` | -12 | -8.2 | +21.9 |
| `topSlot1` | +12 | +12.6 | -19.7 |
| `topSlot2` | +3 | +2.8 | -5.2 |
| `bottomSlot0` | +8 | +7.9 | -13.4 |
| `bottomSlot1` | -8 | -6.0 | +14.4 |
| `bottomSlot2` | -3 | -2.5 | +5.3 |

Use these only after confirming on a device. The hit box is the unrotated 200 x 100 dp frame moved by `(dx, dy)` from its layout position, so its centre sits at the visual centre plus `(dx, dy)`.

### 5.5 Correctness

```kotlin
val topKey = getMatchKey(topItem.AnswerID)
val bottomKey = getMatchKey(bottomItem.AnswerID)
val isCorrect = topKey == bottomKey
```
- Correct when the match keys are equal (section 5.2). `MatchIndex` is not compared.
- Only a top item can be the drag start and only a bottom item can be the drop target, so the pair is always (top, bottom).

### 5.6 Feedback, retries and penalties

`processMatch`:
```kotlin
attempts.add(ClientLinkingAnswerEntry(
    FromID = topItem.AnswerID,
    ToID = bottomItem.AnswerID,
    Correct = isCorrect
))
...
if (isCorrect) {
    correctCount++
    showFeedback(topItem.DisplayText, bottomItem.DisplayText, true)

    activeTop[topSlot] = null
    activeBottom[bottomSlot] = null

    binding.feedbackOverlay.postDelayed({
        if (_binding == null) return@postDelayed
        hideFeedback()
        fillSlots()
        updateUI()

        if (correctCount >= totalPairs) {
            sendAnswer()
        }
    }, 500)
} else {
    showFeedback(topItem.DisplayText, bottomItem.DisplayText, false)
    binding.feedbackOverlay.postDelayed({
        if (_binding == null) return@postDelayed
        hideFeedback()
    }, 500)
}
```

Correct pair:
- `correctCount` goes up at once. The pair is removed from the active arrays at once, but its slot views keep showing the old text until the 500 ms callback calls `updateUI()`.
- Overlay shows the top text above the bottom text, both in `#4DB6AC`. Sunburst goes to correct colours. Duration 500 ms.
- After 500 ms: overlay hidden, sunburst normal, `fillSlots()` (refills and runs `ensureMatch`), `updateUI()`. If all pairs are correct, the answer is sent.

Wrong pair:
- Attempt recorded with `Correct = false`. Both items stay active. Overlay shows both texts in `#C85080`, sunburst incorrect, 500 ms.
- No penalty, no lockout, no count change. The same items can be tried again immediately.

Only pair attempts are recorded; no attempt is made on a non-matching drag start or a release outside a bottom slot.

No input lock: during the 500 ms feedback, other pairs can still be dragged. Overlapping feedback timers can hide a newer overlay early (section 8).

Overlay text: exactly the two `DisplayText` values. No "correct" or "wrong" word is shown.

### 5.7 Counter and instruction

```kotlin
private fun updateRemainingCount() {
    val remaining = totalPairs - correctCount
    if (remaining > 0) {
        binding.timerText.text = getString(R.string.x_to_go, remaining)
        binding.timerText.visibility = View.VISIBLE
        binding.instructionText.text = getString(R.string.drag_to_link)
    } else {
        binding.timerText.visibility = View.GONE
        binding.instructionText.text = getString(R.string.done_waiting)
    }
}
```
- `timerText` shows `"<n> to go"` where `n = totalPairs - correctCount`. It is GONE when `n = 0`.
- `instructionText` shows "Drag to link answers" while pairs remain, and "Done, waiting for other players" at zero.
- Called from `startGame` and from `updateUI()`. `updateUI()` runs 500 ms after a correct pair, so the counter changes 500 ms after the match, not at the moment of the match.

### 5.8 Timer and sending

Timer: same as section 4.4 (`CountDownTimer(durationMs, 1000)`, `durationMs = QuestionDuration * 1000`, no tick display, `onFinish` calls `sendAnswer()`). There is no visible countdown clock.

`sendAnswer`:
```kotlin
private fun sendAnswer() {
    if (answerSent) return
    answerSent = true
    timer?.cancel()

    Log.d("LinkingPairs", "Sending answer: $correctCount correct out of $totalPairs")
    networkManager.sendLinkingAnswer(correctCount, attempts)
}
```

`NetworkManager.sendLinkingAnswer`:
```kotlin
fun sendLinkingAnswer(correctCount: Int, answers: List<ClientLinkingAnswerEntry>) {
    Log.d(TAG, "Linking answer: $correctCount correct, ${answers.size} attempts")
    scope.launch {
        protocolClient?.sendMessage(ClientLinkingAnswer(
            ClientLinkingCorrectAnswerCount = correctCount,
            ClientAnswers = answers
        ))
    }
}
```

Wire type: `ClientLinkingAnswer`, `TypeString = "KnowledgeIsPower.ClientLinkingAnswer"`, fields:
- `ClientLinkingCorrectAnswerCount: Int`
- `ClientAnswers: List<ClientLinkingAnswerEntry>` where `ClientLinkingAnswerEntry` = `{ FromID: String, ToID: String, Correct: Boolean }`.

Every entry records the top item's `AnswerID` as `FromID` and the bottom item's `AnswerID` as `ToID`, for both correct and wrong attempts.

When it is sent:
1. **Timer expiry**: `correctCount` and all attempts so far.
2. **All pairs matched**: 500 ms after the last correct pair.
3. **Auto-submit from `ensureMatch`** when no pair can be made visible (section 5.2). This happens inside `fillSlots()`, which can run during `startGame` before the timer is created.

Sent at most once (`answerSent`). No per-attempt messages. `ClientToServerOngoingChallengeMessage` is not sent here.

Timeout: the same message as finish. Attempts already made are sent; there is no timeout flag.

### 5.9 Edge cases in code

- **Empty list**: `totalPairs = 0`, `fillSlots` runs `ensureMatch`, which calls `sendAnswer()` with count 0 at once (before the timer is created).
- **Unequal sides**: `totalPairs` is the smaller count. Extra items are still shown and can be matched in play, but they cannot raise the count above `totalPairs`.
- **Overlapping timers**: `correctCount >= totalPairs` is only checked in the 500 ms callback. Answers are guarded by `answerSent`, so there is no double send.

### 5.10 User-visible strings on this screen

- Instruction, default and while pairs remain: `drag_to_link` = **"Drag to link answers"**.
- Instruction, when all pairs are matched: `done_waiting` = **"Done, waiting for other players"**.
- Counter: `x_to_go` = **"%1$s to go"**. Hidden at zero.
- Feedback and slot text: the `DisplayText` values. No other fixed text.

---

## 6. SortingAnswersFragment: sort into two buckets (KIP)

Layout: `fragment_sorting_answers.xml`. Message: `ServerBeginSortingAnsweringPhase`. Answer message: `ClientSortingAnswer`.

### 6.1 Data and order

```kotlin
private fun startGame(phase: ServerBeginSortingAnsweringPhase) {
    itemQueue.clear()
    itemQueue.addAll(phase.SortingAnswers.shuffled())
    totalItems = itemQueue.size
    correctCount = 0
    attempts.clear()
    answerSent = false

    leftBucketId = phase.LeftBucketID
    rightBucketId = phase.RightBucketID
    binding.leftBucketLabel.text = phase.LeftBucketLabel
    binding.rightBucketLabel.text = phase.RightBucketLabel
    binding.questionText.text = phase.QuestionText

    showNextItem()
    updateRemainingCount()
    ...
}
```
- Items are shuffled **once** per phase. The queue is then taken in that order, one at a time (`removeFirst`).
- Bucket labels and the question text come from the server.
- Bucket IDs come from `LeftBucketID` and `RightBucketID`.

### 6.2 Layout (`fragment_sorting_answers.xml`)

Root `FrameLayout` `match_parent`. Child order: `sunburstBackground`, `WhirlpoolView`, `timerText`, `questionText`, `leftBucket`, `rightBucket`, `itemSlot`, `feedbackOverlay`. There is no `LinkingLineView` and no instruction text in this layout.

| View | Size | Gravity | Margins | Other |
|---|---|---|---|---|
| `timerText` | wrap | `top\|center_horizontal` | marginTop 8dp | 20sp bold white, shadow `#80000000` dx2 dy2 r3, bg `#40000000`, paddingH 16dp, paddingV 4dp. Preview text in XML only |
| `questionText` | wrap | `top\|center_horizontal` | marginTop 36dp | 14sp, `#CCFFFFFF`, bg `#30000000`, paddingH 16dp, paddingV 4dp |
| `leftBucket` | 180dp x 300dp | `start\|center_vertical` | none | `FrameLayout` |
| `leftBucketLabel` | match_parent | centre | n/a | 20sp bold `#333333`, bg `half_circle_left` tinted `#F0EAD6`, paddingStart 16dp, paddingEnd 32dp |
| `rightBucket` | 180dp x 300dp | `end\|center_vertical` | none | `FrameLayout` |
| `rightBucketLabel` | match_parent | centre | n/a | 20sp bold `#333333`, bg `half_circle_right` tinted `#F0EAD6`, paddingStart 32dp, paddingEnd 16dp |
| `itemSlot` | 180dp x 80dp | `center` | none | `FrameLayout`, carries the touch listener |
| `itemText` | match_parent | centre | n/a | 18sp bold `#333333`, bg `circle_background` (oval) tinted `#F0EAD6`, padding 12dp |
| `feedbackOverlay` | match_parent | n/a | n/a | GONE by default |
| `feedbackText` | wrap | `center` | n/a | 22sp bold `#333333`, bg `circle_background` tinted `#DDFFFFFF`, padding 32dp, gravity center (colour overwritten in code) |

Drawables:
- `half_circle_left`: `topLeftRadius` and `bottomLeftRadius` = 1000dp.
- `half_circle_right`: `topRightRadius` and `bottomRightRadius` = 1000dp.
- `circle_background`: `oval`, so the item and feedback boxes are ellipses, not circles (for example 180 x 80 dp for the item).

**[inferred]** With Android's radius-capping, `half_circle_left` on a 180 x 300 dp bucket comes out as a half-disc of radius 150 dp on the outer side, with a 30 dp flat strip on the inner side. Verify on device.

Colours: background sunburst (section 2). Bucket fill `#F0EAD6`, bucket and item text `#333333`. Question text `#CCFFFFFF` on `#30000000`. Feedback text colour set in code.

### 6.3 Drag mechanics (`setupDragHandling`)

The touch listener is on `itemSlot` only. Buckets have no touch listeners. Drop targets are judged purely by horizontal position.

```kotlin
binding.itemSlot.setOnTouchListener { view, event ->
    if (currentItem == null) return@setOnTouchListener false

    when (event.action) {
        MotionEvent.ACTION_DOWN -> {
            dragStartX = event.rawX - view.translationX
            dragStartY = event.rawY - view.translationY
            isDragging = true
            view.animate().scaleX(1.1f).scaleY(1.1f).setDuration(100).start()
            true
        }
        MotionEvent.ACTION_MOVE -> {
            if (isDragging) {
                view.translationX = event.rawX - dragStartX
                view.translationY = event.rawY - dragStartY
                true
            } else false
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
            if (isDragging) {
                isDragging = false
                view.animate().scaleX(1f).scaleY(1f).setDuration(100).start()

                if (event.action == MotionEvent.ACTION_UP) {
                    val itemCenterX = view.x + view.width / 2f
                    val item = currentItem
                    if (item != null) {
                        when {
                            itemCenterX < binding.leftBucket.right -> {
                                processSort(item, leftBucketId)
                                return@setOnTouchListener true
                            }
                            itemCenterX > binding.rightBucket.left -> {
                                processSort(item, rightBucketId)
                                return@setOnTouchListener true
                            }
                        }
                    }
                }
                // Snap back to center
                view.animate()
                    .translationX(0f)
                    .translationY(0f)
                    .setDuration(200)
                    .start()
                true
            } else false
        }
        else -> false
    }
}
```

Details:
- **Follow**: the item moves 1:1 with the finger (`translation = finger - start`). No clamping, no bounds.
- **Pick-up**: scale to 1.1 over 100 ms on touch down. Scale back to 1.0 over 100 ms on release.
- **Drop decision**: uses the item's **centre X** (`view.x + width/2`, where `view.x` already includes translation):
  - Left bucket if `centreX < leftBucket.right`. `leftBucket.right` is the right edge of the left bucket, which is 180dp from the left edge (it is `start` aligned with no margin).
  - Right bucket if `centreX > rightBucket.left`. `rightBucket.left` is `rootWidth - 180dp`.
  - Left is tested first. If the two regions overlap (root width under 360dp), left wins.
  - Vertical position is ignored.
  - In the gap between the buckets, the item snaps back to centre over 200 ms and nothing is recorded.
- **Cancel**: `ACTION_CANCEL` does not sort. It goes to the snap-back branch.
- The item is at the centre of the screen on start (`layout_gravity=center`), so on a 360dp-wide screen the left threshold is `180dp` and the item is exactly on it. Any leftward movement sorts left. The threshold formula above is exact, but actual sensitivity depends on the device width.

### 6.4 Correctness and the direction mapping

```kotlin
private fun processSort(item: SortingAnswer, chosenBucketId: String) {
    val correctBucketId = if (item.AnswerDirection == 1) leftBucketId else rightBucketId
    val isCorrect = chosenBucketId == correctBucketId

    attempts.add(ClientSortingAnswerEntry(
        AnswerID = item.AnswerID,
        AnswerBucketID = chosenBucketId,
        Correct = isCorrect
    ))
    ...
}
```
- `AnswerDirection == 1` means the left bucket (`LeftBucketID`). **Any other value** (2, 0, and so on) means the right bucket (`RightBucketID`).
- Correct when the chosen bucket **ID string** equals the correct bucket ID. The direction is never compared directly with the bucket ID.
- If `LeftBucketID == RightBucketID`, every answer is correct. The code does not check for this.

Attempts record the chosen bucket **ID** in `AnswerBucketID`, not the direction.

### 6.5 Feedback, retries and penalties

```kotlin
private fun showFeedback(text: String, correct: Boolean) {
    binding.feedbackOverlay.visibility = View.VISIBLE
    binding.feedbackText.text = text
    binding.itemSlot.visibility = View.INVISIBLE

    if (correct) {
        binding.sunburstBackground.setColors(correctPrimary, correctSecondary)
        binding.feedbackText.setTextColor(correctPrimary)
    } else {
        binding.sunburstBackground.setColors(incorrectPrimary, incorrectSecondary)
        binding.feedbackText.setTextColor(incorrectPrimary)
    }
}
```

After `processSort` (in `processSort`):
```kotlin
binding.feedbackOverlay.postDelayed({
    if (_binding == null) return@postDelayed
    hideFeedback()
    showNextItem()
    updateRemainingCount()

    if (currentItem == null && itemQueue.isEmpty()) {
        sendAnswerAndNavigate()
    }
}, 400)
```

- Overlay text: the item's `DisplayText` only. The bucket chosen is not shown. No "correct" or "wrong" word is shown.
- Correct: `correctCount++`, sunburst `#4DB6AC`/`#3DA69C`, text `#4DB6AC`.
- Incorrect: sunburst `#C85080`/`#B04070`, text `#C85080`. No count change.
- Duration 400 ms. The item is hidden during feedback (`itemSlot` INVISIBLE). The next item is shown after 400 ms, with translation reset to 0.
- **No retry**: each item is sorted once. A wrong sort is recorded and the next item is shown.
- **No penalty** beyond the item not counting.

`showNextItem`:
```kotlin
private fun showNextItem() {
    if (itemQueue.isNotEmpty()) {
        currentItem = itemQueue.removeFirst()
        binding.itemText.text = currentItem!!.DisplayText
        binding.itemSlot.translationX = 0f
        binding.itemSlot.translationY = 0f
        binding.itemSlot.visibility = View.VISIBLE
        binding.itemSlot.alpha = 1f
    } else {
        currentItem = null
        binding.itemSlot.visibility = View.INVISIBLE
    }
}
```

### 6.6 Counter

```kotlin
private fun updateRemainingCount() {
    val remaining = itemQueue.size + (if (currentItem != null) 1 else 0)
    if (remaining > 0) {
        binding.timerText.text = getString(R.string.x_to_go, remaining)
        binding.timerText.visibility = View.VISIBLE
    } else {
        binding.timerText.visibility = View.GONE
    }
}
```
- Counts the item currently on screen plus the queue. The current item still counts during its 400 ms feedback. The count drops when the next item is shown.
- Hidden (GONE) when nothing is left.

### 6.7 Timer and sending

Timer (`startGame`):
```kotlin
val durationMs = (phase.QuestionDuration * 1000).toLong()
timer = object : CountDownTimer(durationMs, 1000) {
    override fun onTick(millisUntilFinished: Long) {}
    override fun onFinish() {
        if (_binding == null) return
        sendAnswerAndNavigate()
    }
}.start()
```
No tick display. No visible countdown clock.

`sendAnswerAndNavigate` (the name says "navigate", but it only sends; navigation comes from the holding-screen message):
```kotlin
private fun sendAnswerAndNavigate() {
    if (answerSent) return
    answerSent = true
    timer?.cancel()

    Log.d("SortingAnswers", "Sending answer: $correctCount correct out of $totalItems")
    networkManager.sendSortingAnswer(correctCount, attempts)
}
```

`NetworkManager.sendSortingAnswer`:
```kotlin
fun sendSortingAnswer(correctCount: Int, answers: List<ClientSortingAnswerEntry>) {
    Log.d(TAG, "Sorting answer: $correctCount correct, ${answers.size} attempts")
    scope.launch {
        protocolClient?.sendMessage(ClientSortingAnswer(
            ClientSortingCorrectAnswerCount = correctCount,
            SortingAnswers = answers
        ))
    }
}
```

Wire type: `ClientSortingAnswer`, `TypeString = "KnowledgeIsPower.ClientSortingAnswer"`, fields:
- `ClientSortingCorrectAnswerCount: Int`
- `SortingAnswers: List<ClientSortingAnswerEntry>` where `ClientSortingAnswerEntry` = `{ AnswerID: String, AnswerBucketID: String, Correct: Boolean }`.

When it is sent:
1. **Timer expiry**: `correctCount` and the attempts so far. Items not yet sorted have no entry.
2. **Last item resolved**: 400 ms after the last sort, when `currentItem == null && itemQueue.isEmpty()`.

Sent once (`answerSent`). No per-item messages. `ClientToServerOngoingChallengeMessage` is not sent here.

Timeout: same message as finish, with the attempts so far and no timeout flag.

### 6.8 Edge cases in code

- **No items**: `showNextItem` hides the item. Nothing is sent until the timer expires, because the send only happens after a sort or at timer expiry.
- **Input during feedback**: the item is INVISIBLE, so it cannot be dragged. The bucket areas have no touch handling.
- **Input after timer expiry**: the item is still draggable (no lock on `answerSent`). Sorts after the send are added to `attempts` and count in `correctCount`, but are never sent (section 8).

### 6.9 User-visible strings on this screen

- The screen has **no string resources of its own**. The bucket labels (`LeftBucketLabel`, `RightBucketLabel`), question (`QuestionText`) and item text (`DisplayText`) all come from the server.
- Counter: `x_to_go` = **"%1$s to go"**. Hidden at zero.
- Feedback: the item's `DisplayText`.
- No instruction text exists on this screen.

---

## 7. Protocol encoding (for the port's transport layer)

- Every outgoing message is serialised with `kotlinx.serialization` `Json { encodeDefaults = true }` (`protocol\ProtocolEncoder.kt`). `encodeDefaults = true` means `TypeString` is always written, because it has a default value.
- `ProtocolEncoder.encodeMessage(msg)` wraps the JSON bytes (UTF-8) in a body with a magic value, a JSON type byte and a length, then splits into UDP packets via `sendRawUDP`. The header layout is not documented here.
- Incoming `TypeString` values used by these screens are listed in section 1.1.
- All field names in the wire JSON are the Kotlin property names exactly, including PascalCase (for example `ClientLinkingCorrectAnswerCount`, `ClientAnswers`, `FromID`, `ToID`, `Correct`, `AnswerID`, `AnswerBucketID`, `SortingAnswers`, `ClientOrderingCorrectAnswerCount`). Field names are case-sensitive.

---

## 8. Porting gotchas (behaviour the HTML port must reproduce, including quirks)

1. **No input lock after send.** None of the three screens blocks input after `answerSent` becomes true. Pairs and sorting keep processing drags. Their attempts are appended but never sent. Chains keep completing and incrementing `correctCount` (the chain screen's `evaluateChain` does not check `answerSent`), but the value is never sent again.
2. **Overlapping feedback timers.** Each pairs feedback schedules its own 500 ms hide. A second feedback within 500 ms of the first is hidden early by the first timer.
3. **Pairs input during feedback.** Drags on other pairs are accepted during the 500 ms overlay. Chain screen locks input with `chainLocked` (400 ms wrong, 600 ms correct). Sorting hides the item during feedback.
4. **Counter timing.** Pairs: the count changes 500 ms after a correct match. Sorting: the count changes when the next item appears (400 ms after). Chain: the count changes 600 ms after the chain completes, and shows `0 to go` at the end instead of hiding.
5. **Chain highlight.** Connected circles are `#B2DFDB`, and that highlight stays on the final completed chain until the holding screen takes over.
6. **Rectangular hit boxes.** Chain circles are hit by their 144 dp square, not the circle. Pairs use rotated boxes with the shift in section 5.4 (verify on device).
7. **Sampling.** Chain-screen hit tests run on MOVE samples only, so a fast swipe can cross a slot without triggering it. The sorting screen decides only at release, so this does not apply there.
8. **Auto-submit before the timer.** In pairs, `ensureMatch` in `startGame` can send the answer before the timer exists.
9. **Chain wrong slot does not record the wrong step.** Only partial-chain pairs are recorded (and never sent).
10. **Matching ignores the letter.** Pairs match on the digits after `Answer` plus the letter removed (for example `A01` and `B01`). The key comparison is on the suffix only.
11. **Holding-screen exit on any holding message.** Every holding-screen command message leaves the screen, whatever its `HoldingScreenType` or `action`.

---

## 9. Not found / not implemented

- **`ClientToServerOngoingChallengeMessage` (progress updates)**: not sent by the pairs, chain or sorting screens. The only call site in the app is `ui\MatchingAnsweringFragment.kt`, which calls `networkManager.sendOngoingChallengeUpdate(correctCount)`. The protocol comment in `protocol\GameProtocol2Client.kt` says it is used for "Missing Letter & Linking". This does not match the code for the linking screens.
- **Countdown clock / tick display**: not found. All three screens use `CountDownTimer` with empty `onTick`.
- **Timeout flag or distinct timeout message**: not found. The finish message is also sent on timeout.
- **Correct / incorrect words in the UI** (for example "Correct!" or "Wrong"): not found on any of the three screens. Only the answer text is shown, coloured by result.
- **Per-attempt retries, limits or penalties**: pairs and sorting record attempts with no limit and no penalty. Chain allows unlimited retries of a round with no penalty.
- **`QuestionText` on linking screens**: received (both linking phases) but **not displayed** by `LinkingPairsFragment` or `LinkingAnswersFragment`. There is no `questionText` view in either linking layout. The sorting screen does display it.
- **`QuestionID` / `ChallengeId`**: not read by these screens (the converted ordering `QuestionID` is set from `ChallengeId` but unused).
- **`LayoutId` on ordering data**: declared, not read.
- **`serverTick`**: not read.
- **Shuffle on each sorting item**: not found. The sorting list is shuffled once per phase.
- **Sorting drop vertical limits**: not found. Only horizontal position is checked.
- **Sorting "bucket chosen" feedback**: not found. Feedback shows only the item text.
- **Pause / unpause (`ACTION_PAUSED` 29, `ACTION_UNPAUSED` 30)**: not handled by these screens. They subscribe to holding-screen messages only (`onQuizCommand` is not subscribed here).
- **Colours in `colors.xml` used by these screens**: none (all hex literals).
- **Vibration, sound, haptic feedback**: not found in these files.

---

## 10. Observations from code reading (not device-tested)

1. **Ordering messages while the chain screen is visible.** `NetworkManager` calls `onOrderingMessage` for ordering phases, but `LinkingAnswersFragment` subscribes only to `onLinkingMessage`. A second ordering phase arriving while this screen is on top would only be stored in `pendingLinking` and not start a new round.
2. **Sorting messages while the sorting screen is visible.** `SortingAnswersFragment` does not subscribe to `onSortingMessage`. The same applies: a second sorting phase would be stored in `pendingSorting` only.
3. **Chain round of 1 item.** Cannot be completed by the player (section 4.11).
4. **Hit-box offset for rotated pairs slots.** See section 5.4. Needs a device check. If the offset is real, the visual centre and the touch zone differ by up to about 22 dp on `topSlot0`.
5. **Half-circle geometry.** Depends on Android's corner-radius capping (section 5.3 and 6.2). Verify on device.
