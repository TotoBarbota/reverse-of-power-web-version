# Porting spec: Holding Screen, Category Selection, Power Pick (Android Kotlin to HTML/JS)

Source root (read-only): `reverse-of-power\app\src\main`
App: phone controller for the PS4 quiz game "Knowledge Is Power" (package `com.game.remoteclient`).
Paths below are relative to the source root unless stated otherwise.
Line numbers refer to the files as read on 2026-10-22. Code blocks are verbatim copies; `...` marks an omitted part.

Files covered:

- `java/com/game/remoteclient/ui/HoldingScreenFragment.kt`
- `java/com/game/remoteclient/ui/CategorySelectionFragment.kt`
- `java/com/game/remoteclient/ui/PowerPickFragment.kt`
- `java/com/game/remoteclient/ui/DoorView.kt`
- `java/com/game/remoteclient/ui/RetroTvView.kt`
- `java/com/game/remoteclient/ui/SunburstBackgroundView.kt`
- `java/com/game/remoteclient/ui/WhirlpoolView.kt` (not used by these three screens; see section 8)
- `res/layout/fragment_holding_screen.xml`, `res/layout/fragment_category_selection.xml`, `res/layout/fragment_power_pick.xml`
- `res/drawable/pentagon_background.xml` (the only drawable used by these screens)
- Supporting: `java/com/game/remoteclient/network/NetworkManager.kt`, `java/com/game/protocol/GameMessages.kt`, `java/com/game/protocol/ProtocolDecoder.kt`, `java/com/game/protocol/ProtocolEncoder.kt`, `java/com/game/protocol/GameProtocolClient.kt`, `res/navigation/nav_graph.xml`, `MainActivity.kt`, `ui/ContinueFragment.kt` (only the holding-screen interaction), `res/values/strings.xml`, `res/values/colors.xml`, `res/values-ru/strings.xml`

Terms used in this spec:

- "Holding screen" = `HoldingScreenFragment` (nav id `holdingScreenFragment`).
- "Category screen" = `CategorySelectionFragment` (nav id `categorySelectionFragment`).
- "Power Pick screen" = `PowerPickFragment` (nav id `powerPickFragment`).
- "Live" = a callback is currently registered on `NetworkManager` by the visible fragment. "Pending" = a value stored on `NetworkManager` for a fragment that is not yet alive.

---

## 0. Summary of the three screens

| Screen | What the user sees | What the user can do | Outgoing messages |
|---|---|---|---|
| Holding screen | Sunburst background with a retro TV in the middle showing one line of server text | Nothing (no touch handlers) | None |
| Category screen | Title "CHOOSE A CATEGORY", four door columns (label above each door) | Tap one door, once | `ClientCategorySelectChoice` |
| Power Pick screen | Category name, gold pentagon button, "POWER PICK" label, description; then "Power Pick accepted!" | Tap the pentagon once | `ClientCategorySelectOverride`, `ClientStopCategorySelectOverrideResponse` |

No screen in this spec uses a client-side timer. No screen runs an animation of its own. The only motion is the `ValueAnimator`/`animate()` code in other screens, which is out of scope.

---

## 1. Shared plumbing

### 1.1 Callback registration model

Every fragment does the same thing:

1. In `onViewCreated` it assigns closures to `networkManager.onXxx` fields. Each closure hops to the UI thread with `activity?.runOnUiThread { ... }`.
2. In `onDestroyView` it clears only its own closures, by identity check, so a newer fragment is not wiped.

Holding screen, registration (`HoldingScreenFragment.kt`, lines 114-126):

```kotlin
        networkManager.onHoldingScreenMessage = holdingScreenCb
        networkManager.onColourMessage = colourCb
        networkManager.onCategoryChoicesMessage = categoryCb
        networkManager.onTriviaMessage = triviaCb
        networkManager.onQuizCommand = quizCb
        networkManager.onPowerPlayMessage = powerPlayCb
        networkManager.onLinkingMessage = linkingCb
        networkManager.onOrderingMessage = orderingCb
        networkManager.onSortingMessage = sortingCb
        networkManager.onEliminationMessage = eliminationCb
        networkManager.onMissingLetterMessage = missingLetterCb
        networkManager.onMatchingMessage = matchingCb
        networkManager.onEndOfGameFact = endOfGameFactCb
```

Holding screen, clearing (`HoldingScreenFragment.kt`, lines 214-230), for example:

```kotlin
    override fun onDestroyView() {
        super.onDestroyView()
        if (networkManager.onHoldingScreenMessage === holdingScreenCb) networkManager.onHoldingScreenMessage = null
        if (networkManager.onColourMessage === colourCb) networkManager.onColourMessage = null
        ...
        _binding = null
    }
```

Consequence: while the holding screen view is destroyed (for example, while another screen is on top), none of its callbacks are registered. Incoming holding-screen messages are then only handled by whichever fragment is on top.

### 1.2 NetworkManager routing (relevant branches)

Source: `java/com/game/remoteclient/network/NetworkManager.kt`, `handleUIEvents`. Quoted branches:

```kotlin
            is ClientQuizCommandMessage -> {                       // line 260
                if (message.action == ClientQuizCommandMessage.ACTION_RESET_TO_NAME) {
                    (onResetToNameEntryInterceptor ?: onResetToNameEntry)?.invoke()
                } else {
                    onQuizCommand?.invoke(message)
                }
            }

            is ClientHoldingScreenCommandMessage -> {              // line 268
                onHoldingScreenMessage?.invoke(message)
            }

            is ServerColourMessage -> {                            // line 272
                onColourMessage?.invoke(message)
            }

            is ServerCategorySelectChoices -> {                    // line 276
                pendingCategoryChoices = message
                onCategoryChoicesMessage?.invoke(message)
            }

            is ServerRequestCategorySelectChoice -> {              // line 281
                Log.d(TAG, "ServerRequestCategorySelectChoice: callback=${onCategorySelectRequest != null}")
                if (onCategorySelectRequest != null) {
                    onCategorySelectRequest?.invoke()
                } else {
                    pendingCategorySelectRequest = true
                }
            }
```

Other branches (same pattern, `pending` set then callback invoked):

- `ServerBeginTriviaAnsweringPhase` (line 290): `pendingTrivia = message`, then `onTriviaMessage`.
- `ServerBeginPowerPlayPhase` (line 295): `pendingPowerPlay`, then `onPowerPlayMessage`.
- `ServerRequestPowerPlayChoice` (line 300): `onPowerPlayRequest?.invoke()`. No pending flag.
- `ServerBeginLinkingAnsweringPhase` (line 304): `pendingLinking`, then `onLinkingMessage`.
- `ServerBeginOrderingAnsweringPhase` (line 309): converted to a linking structure (see 2.5), `pendingLinking = converted`, then `onOrderingMessage`.
- `ServerBeginSortingAnsweringPhase` (line 331), `ServerBeginEliminatingAnsweringPhase` (line 336), `ServerBeginMissingLetterAnsweringPhase` (line 341), `ServerBeginMatchingAnsweringPhase` (line 346): each sets its `pending*` then invokes its callback.
- `ServerBeginCategorySelectOverride` (line 351): `pendingCategoryOverride = message`, then `onCategoryOverrideMessage`.
- `ServerStopCategorySelectOverride` (line 356): `onStopCategoryOverride?.invoke(message)`. No pending flag.
- `ServerCategorySelectOverrideSuccess` (line 360): `onCategoryOverrideSuccess?.invoke(message)`. No pending flag.
- `ClientEndOfGameFactCommandMessage` (line 364): `pendingEndOfGameFact = message`, then `onEndOfGameFact`.
- `else -> return false` (end of `when`).

Outgoing senders used by these screens (`NetworkManager.kt`):

```kotlin
    fun sendCategorySelectOverride(durationSeconds: Double) {   // line 486
        Log.d(TAG, "Category select override after ${durationSeconds}s")
        scope.launch {
            protocolClient?.sendMessage(ClientCategorySelectOverride(DurationSeconds = durationSeconds))
        }
    }

    fun sendStopCategoryOverrideResponse(overrideSent: Boolean) {  // line 493
        Log.d(TAG, "Stop category override response: overrideSent=$overrideSent")
        scope.launch {
            protocolClient?.sendMessage(ClientStopCategorySelectOverrideResponse(OverrideSent = overrideSent))
        }
    }

    fun sendCategorySelection(doorIndex: Int) {                 // line 500
        Log.d(TAG, "Category selected: door $doorIndex")
        scope.launch {
            protocolClient?.sendMessage(ClientCategorySelectChoice(ChosenCategoryIndex = doorIndex))
        }
    }
```

Note: `sendCategorySelection` is a plain pass-through. The name parameter is `doorIndex` but it is put into the field `ChosenCategoryIndex`.

### 1.3 Pending values and who consumes them

Pending fields are declared in `NetworkManager.kt` (lines 116-131). Each is cleared by its consumer, usually in `onViewCreated`.

| Pending field | Set in NetworkManager | Consumed by (file:line) | Behaviour |
|---|---|---|---|
| `pendingCategoryChoices` | line 277 | `CategorySelectionFragment.kt` 63-65 | Applied then set to null, in `onViewCreated` only |
| `pendingCategorySelectRequest` (Boolean) | line 286 | `CategorySelectionFragment.kt` 69-71 | Set to false and triggers a send (see 5.6) |
| `pendingCategoryOverride` | line 352 | `PowerPickFragment.kt` 57-59 | Shown then set to null, in `onViewCreated` only |
| `pendingTrivia` | line 291 | `TriviaAnsweringFragment.kt` 64-66 | Consumed in `onViewCreated` |
| `pendingPowerPlay` | line 296 | `PowerPlayFragment.kt` 92-94 | Consumed in `onViewCreated` |
| `pendingLinking` | lines 305, 327 | `LinkingPairsFragment.kt` 68-70 and `LinkingAnswersFragment.kt` 72-74 | Consumed in `onViewCreated` |
| `pendingSorting` | line 332 | `SortingAnswersFragment.kt` 72-74 | Consumed in `onViewCreated` |
| `pendingElimination` | line 337 | `EliminationAnsweringFragment.kt` 61-63 | Consumed in `onViewCreated` |
| `pendingMissingLetter` | line 342 | `MissingLetterAnsweringFragment.kt` 66-68 | Consumed in `onViewCreated` |
| `pendingMatching` | line 347 | `MatchingAnsweringFragment.kt` 66-68 | Consumed in `onViewCreated` |
| `pendingEndOfGameFact` | line 365 | `EndOfGameFactFragment.kt` 45-46 | Read, then set to null |

Important facts:

- **The holding screen consumes no pending value.** Its file never reads any `pending*` field (verified by grep for every `pending` name across the source tree).
- **There is no pending field for `ClientHoldingScreenCommandMessage`.** A holding-screen text that arrives while no holding screen callback is registered is dropped.
- **There is no pending field for `ServerColourMessage`.** A colour message that arrives while the holding screen is not live is dropped.
- `pendingCategoryChoices` is not cleared by the live callback path (`updateCategoryChoices` from the callback at line 91-93 does not touch the pending field). It is only cleared when a category screen is created.

### 1.4 Wire format (for the JS port)

- JSON payload per message. `ProtocolEncoder.kt` (`json = Json { ignoreUnknownKeys = true; encodeDefaults = true }`, around line 41-43) serialises the whole data class. `encodeDefaults = true` means every property is written, including `TypeString` and defaulted fields. `encodeJson` (around line 137-139) is `json.encodeToString(serializer, msg)`.
- The JSON is wrapped in a binary frame in `encodeMessage` (around line 80-88): body magic, `TYPE_JSON` (`0xB1 0xE2 0xFF 0xFF` at line 23), little-endian int32 length, then the JSON bytes. Frames go over UDP via `wrapAndChunk`. The framing is not part of the UI behaviour; the port needs either the framing or a JSON-level equivalent.
- Decoding: `ProtocolDecoder.kt` dispatches on `TypeString`. Most branches use `typeString.contains("...")`, a few use `==`. A `TypeString` with no branch is logged as `Unknown TypeString` and dropped (the `else -> null` branch around line 309).

Wire examples for the outgoing messages on these screens (derived from the data classes plus `encodeDefaults = true`; not captured from a real packet):

```json
{"TypeString":"KnowledgeIsPower.ClientCategorySelectChoice","ChosenCategoryIndex":2}
{"TypeString":"KnowledgeIsPower.ClientCategorySelectOverride","DurationSeconds":3.412}
{"TypeString":"KnowledgeIsPower.ClientStopCategorySelectOverrideResponse","OverrideSent":true}
```

### 1.5 Global reset (not a screen transition on these screens)

`ClientQuizCommandMessage` with `action == 31` (`ACTION_RESET_TO_NAME`) never reaches the holding screen. `NetworkManager` routes it to `onResetToNameEntryInterceptor ?: onResetToNameEntry`. `MainActivity.kt` sets `onResetToNameEntry`: it pops back to `nameEntryFragment`, or pops to `serverDiscoveryFragment` and navigates to `action_serverDiscovery_to_nameEntry` if the name entry screen is not on the back stack.

### 1.6 Colour conversion (used by holding and category screens)

`HoldingScreenFragment.kt` line 200-207 (identical copy in `CategorySelectionFragment.kt` line 163-170):

```kotlin
    private fun colorTintToInt(tint: ColorTint): Int {
        return Color.argb(
            (tint.a * 255).toInt().coerceIn(0, 255),
            (tint.r * 255).toInt().coerceIn(0, 255),
            (tint.g * 255).toInt().coerceIn(0, 255),
            (tint.b * 255).toInt().coerceIn(0, 255)
        )
    }
```

`ColorTint` (`GameMessages.kt`) is `data class ColorTint(val r: Float, val g: Float, val b: Float, val a: Float)`. Float values are expected in 0..1. Each component is multiplied by 255 and truncated (`toInt()` truncates toward zero, it does not round), then clamped to 0..255. Alpha is kept for the background and primary tints, but not for door colours (see 6.3).

JS equivalent: `rgba(Math.min(255, Math.max(0, Math.trunc(r*255))), ..., Math.min(255, Math.max(0, Math.trunc(a*255)))/255)`. Note that `Color.argb` in Android expects the alpha byte, so `a` is applied as `a*255/255` in CSS.

---

## 2. HoldingScreenFragment (central navigation hub)

### 2.1 Entry

- Nav graph (`res/navigation/nav_graph.xml`): `holdingScreenFragment` is the destination of `action_serverDiscovery_to_holdingScreen` (from `ServerDiscoveryFragment`) and `action_waitingRoom_to_holdingScreen` (from `WaitingRoomFragment`). Other fragments return to it with `popBackStack(R.id.holdingScreenFragment, false)` (see 5.5 and 7.4).
- It is the usual waiting state: the holding screen stays up until a server message navigates away.

### 2.2 Layout (`res/layout/fragment_holding_screen.xml`)

Full XML, verbatim (structure only):

```xml
<FrameLayout android:layout_width="match_parent" android:layout_height="match_parent">
    <com.game.remoteclient.ui.SunburstBackgroundView
        android:id="@+id/sunburstBackground"
        android:layout_width="match_parent"
        android:layout_height="match_parent" />
    <com.game.remoteclient.ui.RetroTvView
        android:id="@+id/retroTv"
        android:layout_width="match_parent"
        android:layout_height="match_parent" />
</FrameLayout>
```

Z-order, back to front: full-screen sunburst, then full-screen TV. No other views, no text views, no buttons. The TV is centred in the full fragment area (its geometry is computed from the view width and height, see section 3).

### 2.3 Colours

Defaults (`HoldingScreenFragment.kt` lines 34-36):

```kotlin
    private var backgroundColor = Color.parseColor("#C4B8A8")
    private var backgroundSecondary = Color.parseColor("#D4C8B8")
    private var foregroundColor = Color.TRANSPARENT
```

`applyColors()` (lines 209-212) is called in `onViewCreated` and after every colour message:

```kotlin
    private fun applyColors() {
        binding.sunburstBackground.setColors(backgroundColor, backgroundSecondary)
        binding.retroTv.setFillColor(foregroundColor)
    }
```

`handleColourMessage` (lines 187-197):

```kotlin
    private fun handleColourMessage(message: ServerColourMessage) {
        if (isBlack(message.BackgroundTint) && isBlack(message.PrimaryTint) && isBlack(message.SecondaryTint)) {
            backgroundColor = Color.parseColor("#C4B8A8")
            backgroundSecondary = Color.parseColor("#D4C8B8")
            foregroundColor = Color.TRANSPARENT
        } else {
            backgroundColor = colorTintToInt(message.BackgroundTint)
            foregroundColor = colorTintToInt(message.PrimaryTint)
            backgroundSecondary = colorTintToInt(message.SecondaryTint)
        }
        applyColors()
    }
```

`isBlack` (lines 184-185): `tint.r == 0f && tint.g == 0f && tint.b == 0f` (alpha is ignored).

Mapping:

| ServerColourMessage field | Used for |
|---|---|
| `BackgroundTint` | Sunburst primary colour (`backgroundColor`, even rays) |
| `SecondaryTint` | Sunburst secondary colour (`backgroundSecondary`, odd rays) |
| `PrimaryTint` | TV face fill (`foregroundColor`; `RetroTvView.setFillColor`). Transparent when the reset path is taken |
| `Rainbow`, `RoundType` | Not read on this screen |

Reset path: if all three tints have r = g = b = 0, the defaults are used and the TV fill becomes transparent.

Colour state is kept in fragment fields. When the fragment's view is recreated (see 2.8), the view gets the same colours back through `applyColors()`.

### 2.4 TV text rule

`handleHoldingScreenMessage` (lines 175-182):

```kotlin
    private fun handleHoldingScreenMessage(message: ClientHoldingScreenCommandMessage) {
        val text = message.HoldingScreenText.replace("\\n", "\n")
        val defaultText = when (message.HoldingScreenType) {
            9 -> getString(R.string.get_ready)
            else -> getString(R.string.look_at_tv)
        }
        binding.retroTv.text = text.ifEmpty { defaultText }
    }
```

Rules derived from this code:

1. The server text is used whenever it is not an empty string. `"\\n"` in Kotlin is the two characters backslash and `n`. Each such pair becomes a real line break. Whitespace-only text is not empty, so it is shown.
2. If the text is empty and `HoldingScreenType == 9`, the text is "Get Ready!" (`get_ready`).
3. If the text is empty and the type is anything else (including 4 and 5), the text is "Look at the TV" (`look_at_tv`).
4. `HoldingScreenType` is compared only against 9. The comments in `GameMessages.kt` say "4 = look at the tv; 9 = get ready, 5 = players joining", but no code branches on 4 or 5 here. `ContinueFragment.kt` line 43-44 has its own check: `// HoldingScreenType 5 is a player-join notification`.
5. `message.action`, `OtherPlayerIndex`, `ShowPortraitPhotoControls` and `serverTick` are not read by this fragment.
6. Initial TV text (before any message): `RetroTvView.text` defaults to `context.getString(R.string.look_at_tv)` (`RetroTvView.kt` line 45-49), i.e. "Look at the TV".

### 2.5 Incoming messages and effects

Callbacks are the `*Cb` closures in `observeMessages()` (lines 69-112). Each one runs `activity?.runOnUiThread`. "Nav" = `findNavController().navigate(...)`. No holding-screen navigation uses `popUpTo`.

| # | Incoming message (TypeString) | NetworkManager branch | Holding screen callback (line) | Effect |
|---|---|---|---|---|
| 1 | `ClientHoldingScreenCommandMessage` | `onHoldingScreenMessage` (268) | `holdingScreenCb` (70-72) | Sets TV text (2.4). No navigation. No pending. |
| 2 | `KnowledgeIsPower.ServerColourMessage` | `onColourMessage` (272) | `colourCb` (73-75) | Updates sunburst and TV fill (2.3). No navigation. No pending. |
| 3 | `KnowledgeIsPower.ServerCategorySelectChoices` | `pendingCategoryChoices` set (277), `onCategoryChoicesMessage` (278) | `categoryCb` (76-78) | Nav `action_holdingScreen_to_categorySelection` to the category screen (line 130). |
| 4 | `KnowledgeIsPower.ServerRequestCategorySelectChoice` | `pendingCategorySelectRequest = true` (286), because `onCategorySelectRequest` is null here | not registered | No navigation. The flag is consumed when a category screen is created (5.6). |
| 5 | `KnowledgeIsPower.ServerBeginTriviaAnsweringPhase` | `pendingTrivia` (291) | `triviaCb` (79-81) | Nav `action_holdingScreen_to_triviaAnswering` (line 134). |
| 6 | `KnowledgeIsPower.ServerBeginPowerPlayPhase` | `pendingPowerPlay` (296) | `powerPlayCb` (89-91) | Nav `action_holdingScreen_to_powerPlay` (line 142). |
| 7 | `KnowledgeIsPower.ServerRequestPowerPlayChoice` | `onPowerPlayRequest` (null here) | not registered | Nothing (no pending). |
| 8 | `KnowledgeIsPower.ServerBeginLinkingAnsweringPhase` | `pendingLinking` (305) | `linkingCb` (92-94) | Nav `action_holdingScreen_to_linkingPairs` (line 146) to `LinkingPairsFragment`. |
| 9 | `KnowledgeIsPower.ServerBeginOrderingAnsweringPhase` | converted to a linking structure, `pendingLinking = converted` (327) | `orderingCb` (95-97) | Nav `action_holdingScreen_to_linkingAnswers` (line 150) to `LinkingAnswersFragment`. **Not** linking pairs. |
| 10 | `KnowledgeIsPower.ServerBeginSortingAnsweringPhase` | `pendingSorting` (332) | `sortingCb` (98-100) | Nav `action_holdingScreen_to_sortingAnswers` (line 154). |
| 11 | `KnowledgeIsPower.ServerBeginEliminatingAnsweringPhase` | `pendingElimination` (337) | `eliminationCb` (101-103) | Nav `action_holdingScreen_to_eliminationAnswering` (line 158). |
| 12 | `KnowledgeIsPower.ServerBeginMissingLetterAnsweringPhase` | `pendingMissingLetter` (342) | `missingLetterCb` (104-106) | Nav `action_holdingScreen_to_missingLetterAnswering` (line 162). |
| 13 | `KnowledgeIsPower.ServerBeginMatchingAnsweringPhase` | `pendingMatching` (347) | `matchingCb` (107-109) | Nav `action_holdingScreen_to_matchingAnswering` (line 166). |
| 14 | `ClientEndOfGameFactCommandMessage` | `pendingEndOfGameFact` (365) | `endOfGameFactCb` (110-112) | Nav `action_holdingScreen_to_endOfGameFact` (line 170). |
| 15 | `ClientQuizCommandMessage`, action 4 (`ACTION_CONTINUE`) | `onQuizCommand` (261-266) | `quizCb` (82-88) | Nav `action_holdingScreen_to_continue` (line 138) to `ContinueFragment`. |
| 16 | `ClientQuizCommandMessage`, actions 14, 15, 29, 30 | `onQuizCommand` | `quizCb` (82-88) | Ignored: the `when` has only the `ACTION_CONTINUE` branch. |
| 17 | `ClientQuizCommandMessage`, action 31 | `onResetToNameEntry` (see 1.5) | not reached | Global reset to name entry. |

Quoted `quizCb` and the ordering conversion:

```kotlin
        quizCb = { message ->                                   // lines 82-88
            activity?.runOnUiThread {
                when (message.action) {
                    ClientQuizCommandMessage.ACTION_CONTINUE -> navigateToContinue()
                }
            }
        }
```

```kotlin
            is ServerBeginOrderingAnsweringPhase -> {              // NetworkManager.kt line 309
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
```

Answer to the "linking pairs?" question: `ServerBeginLinkingAnsweringPhase` goes to `LinkingPairsFragment`. `ServerBeginOrderingAnsweringPhase` goes to `LinkingAnswersFragment` (nav id `linkingAnswersFragment`) with its data converted to `LinkingAnswer` items whose `AnswerID` is `ORD_<matchIndex>_<direction>`.

Messages seen by NetworkManager that the holding screen does not handle:

- `ServerRoomMessage`: decoded by `ProtocolDecoder` (line ~241), but `handleUIEvents` has no branch for it. `GameProtocolClient` logs `Unhandled message`. No effect.
- `ServerAwaitTriviaAnsweringPhaseMessage`: decoded, but no `NetworkManager` branch. Logged as unhandled.
- `ServerBeginCategorySelectOverride`, `ServerStopCategorySelectOverride`, `ServerCategorySelectOverrideSuccess`: no holding-screen callback. The override begin message is stored in `pendingCategoryOverride` and is only shown when a live category screen navigates to Power Pick (see 7.2).

### 2.6 Outgoing messages

None. `HoldingScreenFragment.kt` contains no `networkManager.send*` call.

### 2.7 Timers and animation

None. No `CountDownTimer`, `Handler`, `postDelayed`, `ValueAnimator`, `animate()` or `ObjectAnimator` in this file or in `RetroTvView`/`SunburstBackgroundView`.

### 2.8 View recreation (code-derived, not run on device)

When the holding screen navigates forward (to the category screen, for example), its view is destroyed (`onDestroyView` sets `_binding = null`). The fragment instance stays on the back stack. On `popBackStack(holdingScreenFragment, false)`, `onCreateView` runs again and creates a new `RetroTvView`. That view starts with its constructor default text ("Look at the TV"). `text` is only stored in the view, so the last server text is lost.

Colours survive, because they are fragment fields and `applyColors()` runs again in `onViewCreated`.

### 2.9 Exits

The holding screen has no click listeners and no back-press override. It exits only through the callbacks in 2.5. Destinations: `categorySelection`, `triviaAnswering`, `continue`, `powerPlay`, `linkingPairs`, `linkingAnswers`, `sortingAnswers`, `eliminationAnswering`, `missingLetterAnswering`, `matchingAnswering`, `endOfGameFact`. No `popUpTo` is used on these actions.

### 2.10 User-visible strings (holding screen)

- Server text (any, when not empty), with `\n` converted.
- `get_ready`: "Get Ready!"
- `look_at_tv`: "Look at the TV"

---

## 3. RetroTvView (the TV drawn on the holding screen)

Source: `java/com/game/remoteclient/ui/RetroTvView.kt`. The whole drawing is inside `canvas.save()` / `canvas.restore()`, so everything (antenna, frame, text) is rotated and stretched.

### 3.1 Colours and paints

- `eggshell = #F0EAD6` (line 19). Used for antenna, border, scallops and text.
- `fillColor` starts as `Color.TRANSPARENT` (line 20). Set by `setFillColor(color)` (line 51-55), which updates `fillPaint.color` and invalidates.
- `strokePaint`: anti-aliased, STROKE, default stroke width 8 px, `strokeCap = ROUND`, eggshell.
- `textPaint`: anti-aliased, eggshell, `textAlign = CENTER`, `isFakeBoldText = true`.

### 3.2 Transform and size

Quoted (lines 60-67):

```kotlin
        val centerX = width / 2f
        val centerY = height / 2f
        val size = min(width, height) * 0.6f

        // Rotate and stretch the entire drawing
        canvas.save()
        canvas.rotate(-10f, centerX, centerY)
        canvas.scale(1.2f, 1f, centerX, centerY)
```

- `size = 0.6 * min(W, H)`.
- Rotation: -10 degrees about the centre (Android canvas: positive is clockwise on screen, so this is 10 degrees counter-clockwise).
- Horizontal stretch: x times 1.2 about the centre, applied after the rotation.

### 3.3 Geometry (all values as multiples of `size`)

Quoted (lines 70-79):

```kotlin
        val tvWidth = size * 0.7f
        val tvHeight = size * 0.5f
        val tvLeft = centerX - tvWidth / 2
        val tvTop = centerY - tvHeight / 2 + size * 0.1f
        val tvRight = centerX + tvWidth / 2
        val tvBottom = tvTop + tvHeight

        // Draw antenna
        val antennaBaseY = tvTop - size * 0.02f
        val antennaTopY = tvTop - size * 0.25f
```

Antenna (lines 82-102):

- Pole: stroke width `0.02 * size`, from `(cx, antennaBaseY)` to `(cx, antennaTopY)`, eggshell stroke.
- Top bar: stroke at `y = antennaTopY`, from `cx - 0.2*size` to `cx + 0.2*size`.
- Two balls: fill circles, radius `0.025 * size`, at `(cx ± 0.2*size, antennaTopY)`.
- Base: fill circle, radius `0.03 * size` (`baseWidth * 0.5` with `baseWidth = 0.06*size`), at `(cx, antennaBaseY)`.

TV frame: `drawScallopedRect(canvas, tvLeft, tvTop, tvRight, tvBottom, size * 0.04f)` (line 105).

`drawScallopedRect` (lines 138-195):

- `cornerRadius = scallop * 1.5` = `0.06 * size`.
- Fill: `drawRoundRect(rect, cornerRadius, cornerRadius, fillPaint)`, so the face uses the fill colour.
- Border: a copy of `strokePaint` with `strokeWidth = scallop * 0.6` = `0.024 * size`, round rect, eggshell.
- `scallopRadius = scallop * 0.8` = `0.032 * size`.
- Top and bottom edges: `horizontalScallops = int((tvW - 2*cr) / (2*sr))`. Circles at `x = left + cr + i*spacing` for `i` in `0..horizontalScallops`, with `spacing = (tvW - 2*cr) / (horizontalScallops + 1)`, on `y = top` and `y = bottom`.
- Left and right edges: same with `verticalScallops` and `leftSpacing = (tvH - 2*cr) / (verticalScallops + 1)`, at `x = left` and `x = right`.
- Four corner circles at offsets `0.7 * cr` from each corner, radius `scallopRadius`.
- All scallop circles use the eggshell `paint` (fill).

### 3.4 Text

Quoted (lines 107-132, condensed):

```kotlin
        textPaint.textSize = size * 0.1f
        val maxTextWidth = tvWidth * 0.85f
        ...   // split on "\n", then on " ", greedy word wrap against maxTextWidth
        val lineHeight = textPaint.fontSpacing
        val totalTextHeight = lineHeight * wrappedLines.size
        val tvCenterY = (tvTop + tvBottom) / 2
        val startY = tvCenterY - totalTextHeight / 2 + lineHeight * 0.7f
        for ((index, line) in wrappedLines.withIndex()) {
            canvas.drawText(line, centerX, startY + index * lineHeight, textPaint)
        }
        canvas.restore()
```

- Font size `0.1 * size`, bold (fake bold), eggshell, centred on `cx`.
- Wrap width `0.85 * tvWidth` = `0.595 * size`.
- Word wrap: for each `\n` split line, words are added while `measureText(candidate) <= maxTextWidth`; otherwise a new line starts with the word.
- Line height is `fontSpacing` (Android font metric; the JS port needs a fixed equivalent, which the spec cannot derive from the code).
- Vertical placement: block centred on `tvCenterY`, baseline of first line offset by `0.7 * lineHeight`.

---

## 4. SunburstBackgroundView (background of all three screens)

Source: `java/com/game/remoteclient/ui/SunburstBackgroundView.kt`.

- `numRays = 24` (line 20). Each ray is `360/24 = 15` degrees.
- Default colours: primary `#C4B8A8` (line 23), secondary `#D4C8B8` (line 24).
- `setColors(primary, secondary)` (lines 43-49) updates both paints and invalidates. No animation.

Drawing (lines 54-81):

```kotlin
        val centerX = width / 2f
        val centerY = height / 2f
        val maxRadius = max(width, height) * 1.5f
        val anglePerRay = 360f / numRays
        for (i in 0 until numRays) {
            val startAngle = Math.toRadians((i * anglePerRay - 90).toDouble())
            val endAngle = Math.toRadians(((i + 1) * anglePerRay - 90).toDouble())
            rayPath.reset()
            rayPath.moveTo(centerX, centerY)
            rayPath.lineTo(centerX + (maxRadius * cos(startAngle)).toFloat(), centerY + (maxRadius * sin(startAngle)).toFloat())
            rayPath.lineTo(centerX + (maxRadius * cos(endAngle)).toFloat(), centerY + (maxRadius * sin(endAngle)).toFloat())
            rayPath.close()
            val paint = if (i % 2 == 0) primaryPaint else secondaryPaint
            canvas.drawPath(rayPath, paint)
        }
        // Darken overlay to subdue colors and keep white text readable
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), darkenPaint)
```

- Centre: view centre. Ray length: `1.5 * max(W, H)`.
- Ray `i` spans from angle `15*i - 90` to `15*(i+1) - 90` degrees (screen coordinates, y down). Ray 0 starts at 12 o'clock (-90 degrees) and sweeps clockwise.
- Even rays (0, 2, ...) use primary; odd rays use secondary.
- Darken overlay: full view, `#55000000` (alpha 0x55 = 85/255, about 33% black).
- Rotation speed: none (the drawing is static; there is no rotation code). Animation duration: none.

---

## 5. CategorySelectionFragment (door choice)

Source: `java/com/game/remoteclient/ui/CategorySelectionFragment.kt`, layout `res/layout/fragment_category_selection.xml`.

### 5.1 Entry

- From the holding screen: `categoryCb` (holding screen, line 76-78) navigates with `action_holdingScreen_to_categorySelection` (no `popUpTo`, so a new instance is created).
- From a pending choice: if `ServerCategorySelectChoices` arrived before the fragment existed, `pendingCategoryChoices` is applied in `onViewCreated` (lines 63-66).
- Fragment fields are fresh on each entry: `selectionEnabled = true` (line 27), `selectedDoorIndex = null` (line 28), colours at beige defaults (lines 31-32).

### 5.2 Layout (`fragment_category_selection.xml`)

Structure, outer to inner (the sunburst is drawn first, so it is at the back):

1. `SunburstBackgroundView` (`sunburstBackground`), match parent.
2. Vertical `LinearLayout`, match parent, `gravity="center"`, drawn above the sunburst:
   1. `TextView` `titleText`: `wrap_content`; text `@string/choose_a_category`; `textSize 22sp`; bold; colour `@android:color/white` (`#FFFFFFFF`); shadow colour `#80000000`, dx 2, dy 2, radius 3; `layout_marginTop 16dp`, `layout_marginBottom 8dp`.
   2. Horizontal `LinearLayout`, `layout_height 0dp`, `layout_weight 1`, `gravity="center"`, `paddingHorizontal 8dp`. Four columns:
      - Column `doorColumnN` (N = 0..3): `layout_width 0dp`, `layout_weight 1`, `match_parent` height, vertical, `gravity="center"`, `padding 4dp`.
        - `TextView` `labelN`: `wrap_content`; `textSize 14sp`; bold; white; shadow `#80000000`, dx 1, dy 1, radius 2; `gravity="center"`; `maxLines 2`; `layout_marginBottom 4dp`.
        - `DoorView` `doorN`: `match_parent` width, `layout_height 0dp`, `layout_weight 1`.

Effective sizes: row width = screen width minus 16dp (8dp padding each side), split into four equal columns. Each door is the column width minus 8dp (4dp padding each side). Door height is whatever remains below the label.

`tools:text` values ("Identity", "Competitive\nSports", "Music", "The World\nToday") are preview only; they are not used at runtime.

### 5.3 Colours

Defaults (lines 31-32): `backgroundColor = #C4B8A8`, `backgroundSecondary = #D4C8B8`.

`updateCategoryChoices` (lines 128-154), quoted:

```kotlin
    private fun updateCategoryChoices(message: ServerCategorySelectChoices) {
        categoryChoices = message.CategoryChoices
        message.BackgroundTint?.let { backgroundColor = colorTintToInt(it) }
        message.SecondaryTint?.let { backgroundSecondary = colorTintToInt(it) }

        applyBackgroundColors()

        val columns = listOf(binding.doorColumn0, binding.doorColumn1, binding.doorColumn2, binding.doorColumn3)
        val doors = listOf(binding.door0, binding.door1, binding.door2, binding.door3)
        val labels = listOf(binding.label0, binding.label1, binding.label2, binding.label3)

        columns.forEachIndexed { index, column ->
            if (index < categoryChoices.size) {
                val choice = categoryChoices[index]
                column.visibility = View.VISIBLE
                doors[index].doorIndex = index
                choice.Colour?.let { doors[index].setDoorColor(colorTintToInt(it)) }
                labels[index].text = choice.DisplayText
            } else {
                column.visibility = View.INVISIBLE
            }
        }

        if (selectedDoorIndex != null) {
            highlightSelectedDoor(selectedDoorIndex!!)
        }
    }
```

Rules:

- Background: `BackgroundTint` and `SecondaryTint` are applied only when non-null. When null, the previous value is kept. There is no reset to beige.
- `PrimaryTint` of `ServerCategorySelectChoices` is never read.
- The holding screen's colours are NOT inherited. The category fragment is a new instance with beige defaults, so a `ServerColourMessage` received on the holding screen does not change this screen unless the choices message itself carries tints.
- Per door: `choice.Colour` (a `ColorTint?`) is applied via `setDoorColor` only when non-null. Otherwise the door keeps its default colours (section 6).
- Columns with index >= number of choices are set to `INVISIBLE`, not `GONE`. They keep their layout space, so visible doors are left-aligned in the four-column grid and are not re-centred.
- At most four choices are shown (there are four columns). Choices beyond index 3 are not shown and cannot be selected.

Header text: `ServerCategorySelectChoices.HeaderText` is not read. The title is always the fixed string `CHOOSE A CATEGORY`.

### 5.4 Door tap (the one-shot choice)

Listener setup (lines 75-87):

```kotlin
    private fun setupDoorClickListeners() {
        val columns = listOf(binding.doorColumn0, binding.doorColumn1, binding.doorColumn2, binding.doorColumn3)
        columns.forEachIndexed { index, column ->
            column.setOnClickListener {
                Log.d("CategorySelection", "Door $index tapped, selectionEnabled=$selectionEnabled, choices=${categoryChoices.size}")
                if (selectionEnabled && index < categoryChoices.size) {
                    selectedDoorIndex = index
                    networkManager.sendCategorySelection(index)
                    selectionEnabled = false
                    highlightSelectedDoor(index)
                }
            }
        }
    }
```

- The tap target is the whole column (label plus door).
- Accepted only when `selectionEnabled` is true and `index < categoryChoices.size`.
- The sent value is `index`, the column position (0..3). This is also the position in the `CategoryChoices` array, because `updateCategoryChoices` places `categoryChoices[i]` in column `i`.
- `CategoryChoice.DoorIndex` (server value) is never read. Also `doors[index].doorIndex = index` overwrites the door's style index with the column index (see 6.2).
- `ChoiceType` (on `CategoryChoice`) is never read anywhere in the app.
- Answer to "what is the value?": `ChosenCategoryIndex` is the 0-based column and list index, not the server's `DoorIndex`.
- `selectionEnabled` is never set back to true. It is one-shot for the life of the fragment. Later `ServerCategorySelectChoices` updates do not re-enable it.

Highlight (lines 156-161):

```kotlin
    private fun highlightSelectedDoor(selectedIndex: Int) {
        ...
        columns.forEachIndexed { index, column ->
            column.alpha = if (index == selectedIndex) 1.0f else 0.3f
        }
    }
```

- Applies to all four columns (label and door together). Selected column alpha 1.0, others 0.3.
- Instant change, no animation.
- Re-applied in `updateCategoryChoices` whenever `selectedDoorIndex != null`.
- After a tap there is no "selected" text on this screen. Nothing else changes until the server moves on.

### 5.5 Incoming messages and effects (category screen)

Callbacks registered in `observeMessages()` (lines 90-114):

| Incoming message | Callback (line) | Effect |
|---|---|---|
| `ServerCategorySelectChoices` | `categoryCb` (91-93) | `updateCategoryChoices` (5.3), no navigation. Does not clear `pendingCategoryChoices`. |
| `ServerRequestCategorySelectChoice` (live) | `categorySelectCb` (94-97) | Sends `ClientCategorySelectChoice(selectedDoorIndex ?: -1)` (5.6). |
| `ClientHoldingScreenCommandMessage` | `holdingScreenCb` (99-101) | `popBackStack(R.id.holdingScreenFragment, false)` (line 116-118). The message content is not applied; see 9.2. |
| `ServerBeginTriviaAnsweringPhase` | `triviaCb` (102-104) | Nav `action_categorySelection_to_triviaAnswering`. That action has `popUpTo = holdingScreenFragment` with `popUpToInclusive = false`, so the holding screen stays under the trivia screen. |
| `ServerBeginCategorySelectOverride` | `categoryOverrideCb` (105-107) | Nav `action_categorySelection_to_powerPick` (7.2). |

Navigation back (lines 116-118):

```kotlin
    private fun navigateToHoldingScreen() {
        findNavController().popBackStack(R.id.holdingScreenFragment, false)
    }
```

### 5.6 Server request and pending request

Live path (`NetworkManager`, line 281-288): the request calls `onCategorySelectRequest`, which is `categorySelectCb`. It sends `selectedDoorIndex ?: -1`. Note that it sends the already chosen door again if one was tapped.

Pending path (`CategorySelectionFragment.kt` lines 69-72):

```kotlin
        // Handle category select request that arrived before this fragment was ready
        if (networkManager.pendingCategorySelectRequest) {
            networkManager.pendingCategorySelectRequest = false
            networkManager.sendCategorySelection(selectedDoorIndex ?: -1)
        }
```

`onViewCreated` runs before any tap on a fresh instance, so `selectedDoorIndex` is null and the value sent is **-1**, immediately on creation, before the user has seen the doors. This happens after pending choices are applied (lines 63-66).

Sentinel value: `ChosenCategoryIndex = -1` means "no choice" (inferred from the `?: -1` fallback; the server's meaning is not in the app).

### 5.7 Outgoing messages (category screen)

| Message | Field values | Sent from |
|---|---|---|
| `KnowledgeIsPower.ClientCategorySelectChoice` | `ChosenCategoryIndex` = 0..3 (column), set by the tap | Tap (line 82) |
| `KnowledgeIsPower.ClientCategorySelectChoice` | `ChosenCategoryIndex` = last tapped column, or -1 | Live request (line 96) |
| `KnowledgeIsPower.ClientCategorySelectChoice` | `ChosenCategoryIndex` = -1 | Pending request (line 71) |

### 5.8 Exits (category screen)

- Holding message: back to holding screen (see 5.5 and 9.2).
- Trivia message: to trivia, holding screen kept under it.
- Override message: to Power Pick.
- The screen has no button or back handler of its own.

### 5.9 Timers and animation

None. No `CountDownTimer`, no `postDelayed`, no `animate()`, no `ValueAnimator` in this fragment. The only timing is the instant alpha change in 5.4.

### 5.10 User-visible strings (category screen)

- `choose_a_category`: "CHOOSE A CATEGORY" (title).
- The category labels are the server's `DisplayText`, used as-is (no `\n` conversion here, unlike the holding screen). A real newline in `DisplayText` renders as a line break; the label has `maxLines = 2`.

---

## 6. DoorView (the door drawing)

Source: `java/com/game/remoteclient/ui/DoorView.kt`.

### 6.1 Styles and colours

Enum (lines 15-20): `POINTED_ARCH` (door 0), `DOMED` (door 1), `SCALLOPED` (door 2), `SIMPLE_ARCH` (door 3).

Default colours (lines 22-25):

```kotlin
    private var doorStyle = DoorStyle.POINTED_ARCH
    private var borderColor = Color.parseColor("#D4AF37") // Gold
    private var doorColor = Color.parseColor("#8B7355")   // Brown/taupe
    private var frameColor = Color.parseColor("#F5E6C8")  // Cream/beige
```

Glitter colour (line 45): `#FFD700` at construction, overridden to `#FFFACD` at draw time (line 305).

### 6.2 Style selection

Quoted (lines 48-58):

```kotlin
    var doorIndex: Int = 0
        set(value) {
            field = value
            doorStyle = when (value % 4) {
                0 -> DoorStyle.POINTED_ARCH
                1 -> DoorStyle.DOMED
                2 -> DoorStyle.SCALLOPED
                else -> DoorStyle.SIMPLE_ARCH
            }
            invalidate()
        }
```

The category screen sets `doorIndex` to the column index (0..3), so column N always has style N. The server's `DoorIndex` is not used.

### 6.3 Door colour

Quoted (lines 60-65):

```kotlin
    fun setDoorColor(color: Int) {
        // Derive colors from the base color
        borderColor = Color.parseColor("#D4AF37") // Keep gold border
        doorColor = blendColors(color, Color.parseColor("#5C4033"), 0.5f)
        frameColor = blendColors(color, Color.WHITE, 0.7f)
        invalidate()
    }
```

Quoted `blendColors` (lines 68-74):

```kotlin
    private fun blendColors(color1: Int, color2: Int, ratio: Float): Int {
        val inverseRatio = 1f - ratio
        val r = (Color.red(color1) * ratio + Color.red(color2) * inverseRatio).toInt()
        val g = (Color.green(color1) * ratio + Color.green(color2) * inverseRatio).toInt()
        val b = (Color.blue(color1) * ratio + Color.blue(color2) * inverseRatio).toInt()
        return Color.rgb(r, g, b)
    }
```

Results, for category colour `C = (r, g, b)` in 0..255:

- Border: always `#D4AF37` (gold).
- Door panel: `doorColor = (r*0.5 + 0x5C*0.5, g*0.5 + 0x40*0.5, b*0.5 + 0x33*0.5)`, truncated. Blend with `#5C4033`.
- Frame: `frameColor = (r*0.7 + 255*0.3, g*0.7 + 255*0.3, b*0.7 + 255*0.3)`, truncated. Blend with white.
- Alpha of the category colour is dropped (`Color.rgb`).
- The door's glitter colour does not change.

### 6.4 Drawing (`onDraw`, lines 76-89)

```kotlin
        val w = width.toFloat()
        val h = height.toFloat()
        val padding = min(w, h) * 0.05f
        val borderWidth = min(w, h) * 0.06f
        when (doorStyle) { ... }
```

Let `p = padding = 0.05 * min(w,h)`, `bw = borderWidth = 0.06 * min(w,h)`, `cx = w/2`. Each style draws, in order: border, glitter (on the border path), inner frame, door panel, then decorations.

All paths use Android `Path`. `quadTo(c, e)` is a quadratic Bezier with control point `c` and end point `e`.

**Style 0, POINTED_ARCH (lines 92-136).** Quoted border and door (the rest is in the file):

```kotlin
        path.moveTo(padding, h - padding)
        path.lineTo(padding, h * 0.4f)
        path.lineTo(centerX, padding + h * 0.05f)
        path.lineTo(w - padding, h * 0.4f)
        path.lineTo(w - padding, h - padding)
        path.close()
        canvas.drawPath(path, borderPaint)            // fill borderColor
        drawGlitterEffect(canvas, path)
        // Inner frame: inset = bw, fill frameColor
        innerPath: (p+i, h-p-i) -> (p+i, 0.4h+i) -> (cx, p+0.05h+1.5i) -> (w-p-i, 0.4h+i) -> (w-p-i, h-p-i)
        // Door: doorInset = 2*bw, fill doorColor
        doorPath: (p+d, h-p-d) -> (p+d, 0.45h) -> (cx, p+0.12h) -> (w-p-d, 0.45h) -> (w-p-d, h-p-d)
        drawZigzagDecoration(canvas, centerX, h * 0.35f, w * 0.4f)
        drawDoorPanels(canvas, padding + doorInset, h * 0.5f, w - 2 * (padding + doorInset), h * 0.4f)
```

**Style 1, DOMED (lines 138-182).** Border: `(p, h-p) -> (p, 0.5h)`, quadratic `ctrl (p, 0.2h) -> (cx, p+0.05h)`, quadratic `ctrl (w-p, 0.2h) -> (w-p, 0.5h)`, then `(w-p, h-p)`. Inner frame (`inset = bw`): quadratic ctrl `(p+i, 0.22h) -> (cx, p+0.08h)` and `(w-p-i, 0.22h) -> (w-p-i, 0.5h)`. Door (`d = 2bw`): `(p+d, 0.55h)`, quadratic ctrl `(p+d, 0.3h) -> (cx, 0.2h)`, quadratic ctrl `(w-p-d, 0.3h) -> (w-p-d, 0.55h)`. Decorations: `drawTriangleDecoration(canvas, centerX, h*0.35f, w*0.35f)` then `drawTopOrnament(canvas, centerX, padding + h*0.02f)`.

**Style 2, SCALLOPED (lines 184-245).** Border, verbatim:

```kotlin
        path.moveTo(padding, h - padding)
        path.lineTo(padding, h * 0.5f)
        path.quadTo(padding, h * 0.3f, centerX * 0.6f, h * 0.25f)
        path.quadTo(centerX * 0.7f, h * 0.1f, centerX, padding + h * 0.08f)
        path.quadTo(centerX * 1.3f, h * 0.1f, centerX * 1.4f, h * 0.25f)
        path.quadTo(w - padding, h * 0.3f, w - padding, h * 0.5f)
        path.lineTo(w - padding, h - padding)
        path.close()
```

Inner frame (`inset = bw`) uses the same shape with `h*0.32`, `h*0.27`, `h*0.13`, `h*0.11` and `centerX*0.65`, `centerX*0.72`, `centerX*1.28`, `centerX*1.35` as in the file. Door: `canvas.drawRoundRect(p + d2, 0.4h, w - p - d2, h - p - d2, 0.15w, 0.15w, doorPaint)` with `d2 = 2.5 * bw`, fill `doorColor`. Arch window: `addArc(cx - 0.15w, 0.42h, cx + 0.15w, 0.62h, 180, 180)`, then lines to `(cx + 0.15w, 0.7h)` and `(cx - 0.15w, 0.7h)`, closed, fill `#6B5344`. Triangle in arch: `drawTriangleInArch(canvas, centerX, h*0.45f, w*0.12f)`, colour `#8B7B6B`.

**Style 3, SIMPLE_ARCH (lines 247-300).** Border: `(p, h-p) -> (p, 0.45h)`, quadratic ctrl `(p, 0.25h) -> (cx, p+0.05h)`, quadratic ctrl `(w-p, 0.25h) -> (w-p, 0.45h)`, then `(w-p, h-p)`. Inner frame (`inset = bw`): quadratic ctrl `(p+i, 0.27h) -> (cx, p+0.08h)` and `(w-p-i, 0.27h) -> (w-p-i, 0.45h)`. Door (`d = 2bw`): `(p+d, 0.5h)`, quadratic ctrl `(p+d, 0.32h) -> (cx, 0.18h)`, quadratic ctrl `(w-p-d, 0.32h) -> (w-p-d, 0.5h)`. Inner arch (`a = 3bw`, fill `#6B5344`): `(p+a, 0.55h)`, quadratic ctrl `(p+a, 0.38h) -> (cx, 0.28h)`, quadratic ctrl `(w-p-a, 0.38h) -> (w-p-a, 0.55h)`. Top ornament: `drawTopOrnament(canvas, centerX, padding)`.

### 6.5 Decorations (exact)

- `drawZigzagDecoration(cx, y, width)` (lines 319-336), colour `#7B6B5B`: 5 teeth, `teethWidth = width/5`, `teethHeight = 0.15*width`. Path: start `(cx - width/2, y)`, then for each tooth `(x + tw/2, y + th)` and `(x + tw, y)`, then `(cx + width/2, y + 2*th)`, `(cx - width/2, y + 2*th)`, closed.
- `drawTriangleDecoration(cx, y, width)` (lines 338-352), colour `#7B6B5B`: 3 triangles. `tw = width/3`, `th = 0.3*width`. For each `i` in 0..2, `tx = cx - width/2 + i*tw + tw/2`: triangle `(tx, y)`, `(tx - tw/2.5, y + th)`, `(tx + tw/2.5, y + th)`.
- `drawTriangleInArch(cx, y, size)` (lines 354-362), colour `#8B7B6B`: `(cx, y)`, `(cx - size, y + 1.5*size)`, `(cx + size, y + 1.5*size)`.
- `drawTopOrnament(cx, y)` (lines 364-370), colour `#5C4033`: circles at `(cx, y+10)` r=6, `(cx, y+25)` r=5, `(cx, y+38)` r=4. These offsets are absolute pixels, not scaled.
- `drawDoorPanels(left, top, width, height)` (lines 372-388), colour `#6B5B4B`: `panelW = 0.4*width`, `panelH = 0.4*height`, `gap = 0.1*width`, `vGap = 0.1*height`. Four rectangles: top-left at `(left+gap, top)`, top-right at `(left+width-gap-panelW, top)`, bottom-left at `(left+gap, top+panelH+vGap)`, bottom-right at `(left+width-gap-panelW, top+panelH+vGap)`, each `panelW x panelH`.

### 6.6 Glitter (exact)

Quoted (lines 302-317):

```kotlin
    private fun drawGlitterEffect(canvas: Canvas, path: Path) {
        // Simulate glitter with small bright dots along the border
        val random = java.util.Random(doorIndex.toLong())
        glitterPaint.color = Color.parseColor("#FFFACD")

        val bounds = RectF()
        path.computeBounds(bounds, true)

        for (i in 0..30) {
            val x = bounds.left + random.nextFloat() * bounds.width()
            val y = bounds.top + random.nextFloat() * bounds.height()
            val radius = 1f + random.nextFloat() * 2f
            glitterPaint.alpha = 150 + random.nextInt(105)
            canvas.drawCircle(x, y, radius, glitterPaint)
        }
    }
```

- 31 dots (`i` in 0..30), positioned inside the border path's bounding box (not clipped to the shape).
- Seed = `doorIndex`, so the pattern is the same on every draw for a given column.
- Colour `#FFFACD`, alpha 150..254, radius 1..3 px.
- Draw order per call: x, y, radius, alpha (the Random sequence matters if the port needs identical dots).

### 6.7 Size, animation, touch

- Door size comes from the layout (section 5.2).
- Animation: none. The door is static apart from `invalidate()` on setters.
- Touch: `DoorView` has no touch handling. Taps are caught by the parent column.

### 6.8 Strings

None inside `DoorView`.

---

## 7. PowerPickFragment (Power Pick override)

Source: `java/com/game/remoteclient/ui/PowerPickFragment.kt`, layout `res/layout/fragment_power_pick.xml`, drawable `res/drawable/pentagon_background.xml`.

### 7.1 Entry

Two ways in:

- Live: `categoryOverrideCb` on the category screen (lines 105-107) navigates `action_categorySelection_to_powerPick`. `NetworkManager` has already set `pendingCategoryOverride` before the callback runs.
- Pending: `onViewCreated` (lines 57-60) consumes `pendingCategoryOverride`, calls `showOverrideOffer`, and sets the pending field to null.

Fragment fields on creation: `overrideSent = false`, `phaseStartTime = 0L`. Background: beige defaults `#C4B8A8` / `#D4C8B8` (lines 31-32, set in `onViewCreated` line 54). Accepted colours: `#4A7AB5` and `#3A6AA5` (lines 35-36). The Power Pick screen ignores `ServerColourMessage`.

### 7.2 Offer (`showOverrideOffer`, lines 79-88)

```kotlin
    private fun showOverrideOffer(override: ServerBeginCategorySelectOverride) {
        phaseStartTime = SystemClock.elapsedRealtime()
        binding.categoryNameText.text = override.InitialCategorySelectChoice

        binding.pentagonIcon.setOnClickListener {
            if (!overrideSent) {
                onPowerPickTapped()
            }
        }
    }
```

- Starts the elapsed timer used for `DurationSeconds` (7.3).
- Shows the server's `InitialCategorySelectChoice` as the category name.
- Registers the pentagon tap listener.
- `ServerBeginCategorySelectOverride.DurationSeconds` and `DoorIndex` are not read by this screen. There is no client-side timeout.

### 7.3 Tap (`onPowerPickTapped`, lines 90-98)

```kotlin
    private fun onPowerPickTapped() {
        overrideSent = true
        val elapsed = (SystemClock.elapsedRealtime() - phaseStartTime) / 1000.0

        Log.d("PowerPickFragment", "Power Pick used after ${elapsed}s")
        networkManager.sendCategorySelectOverride(elapsed)

        // Switch to accepted state
        showAcceptedState()
    }
```

- `DurationSeconds` = `(now - phaseStartTime) / 1000.0`, in seconds as a Double, measured from the moment the offer was shown. Millisecond resolution.
- Only one override is sent: the listener checks `overrideSent`. After the tap the pick container is hidden (GONE), so the pentagon is no longer on screen.
- The accepted state is shown immediately on tap. It does not wait for the server.

`showAcceptedState` (lines 101-106):

```kotlin
    private fun showAcceptedState() {
        binding.pickContainer.visibility = View.GONE
        binding.acceptedContainer.visibility = View.VISIBLE
        binding.acceptedCategoryText.text = binding.categoryNameText.text
        binding.sunburstBackground.setColors(acceptedBackground, acceptedSecondary)
    }
```

Background changes instantly to the blue pair (`#4A7AB5` / `#3A6AA5`). No animation.

### 7.4 Stop message (`handleStopOverride`, lines 108-116)

```kotlin
    private fun handleStopOverride() {
        // Always respond with whether we sent an override
        networkManager.sendStopCategoryOverrideResponse(overrideSent = overrideSent)
        if (!overrideSent) {
            // No override used — go back immediately
            navigateToHoldingScreen()
        }
        // If override was sent, wait for ServerCategorySelectOverrideSuccess before navigating
    }
```

- Always sends `ClientStopCategorySelectOverrideResponse(OverrideSent = overrideSent)`.
- If no override was sent: navigates back to the holding screen at once.
- If an override was sent: waits for `ServerCategorySelectOverrideSuccess`.
- If `ServerStopCategorySelectOverride` arrives while this screen is not live, nothing answers it (no pending field and no other handler). See 9.5.

### 7.5 Success message (`handleOverrideSuccess`, lines 118-121)

```kotlin
    private fun handleOverrideSuccess(message: ServerCategorySelectOverrideSuccess) {
        Log.d("PowerPickFragment", "Override success=${message.CategorySelectOverrideSuccess} by ${message.CategorySelectOverridePlayerName}")
        navigateToHoldingScreen()
    }
```

- Navigates to the holding screen regardless of `CategorySelectOverrideSuccess`.
- `CategorySelectOverrideSuccess` (Boolean) and `CategorySelectOverridePlayerName` (String) are only logged. They are not shown.
- The "Power Pick accepted!" text is shown from the tap, not from this message.

### 7.6 Holding message

`holdingScreenCb` (lines 64-66) navigates back to the holding screen on any `ClientHoldingScreenCommandMessage` (`popBackStack(R.id.holdingScreenFragment, false)`, lines 123-125). This also happens while the accepted state is showing. The message content is not applied (see 9.2).

### 7.7 Outgoing messages

| Message | Field values | When |
|---|---|---|
| `KnowledgeIsPower.ClientCategorySelectOverride` | `DurationSeconds` = elapsed seconds since the offer was shown (Double) | On pentagon tap, once |
| `KnowledgeIsPower.ClientStopCategorySelectOverrideResponse` | `OverrideSent` = `overrideSent` (true if the user tapped) | On every `ServerStopCategorySelectOverride` while this screen is live |

### 7.8 Layout (`res/layout/fragment_power_pick.xml`)

Structure, back to front:

1. `SunburstBackgroundView` (`sunburstBackground`), match parent.
2. `pickContainer` (vertical `LinearLayout`, match parent, `gravity="center"`). Visible by default.
   1. `titleText`: `wrap_content`; text `@string/category_selected`; `textSize 20sp`; bold; white; shadow `#80000000` dx 2, dy 2, radius 3; `layout_marginTop 16dp`.
   2. `categoryNameText`: `wrap_content`; `textSize 24sp`; bold; white; shadow `#80000000` dx 2, dy 2, radius 3; `layout_marginTop 8dp`, `layout_marginBottom 16dp`. Text set at runtime from `InitialCategorySelectChoice`. (`tools:text="The World Today"` is preview only.)
   3. `pentagonIcon`: `View`, 120dp x 120dp, `background="@drawable/pentagon_background"`. Empty view (no text, no icon).
   4. `powerPickLabel`: `wrap_content`; text `@string/power_pick`; `textSize 18sp`; bold; colour `#D4AF37`; shadow `#80000000` dx 1, dy 1, radius 2; `layout_marginTop 8dp`.
   5. `descriptionText`: `wrap_content`; text `@string/power_pick_description`; `textSize 14sp`; colour `#CCFFFFFF` (white at 80% opacity); `gravity="center"`; `layout_marginTop 12dp`, `layout_marginBottom 16dp`.
3. `acceptedContainer` (vertical `LinearLayout`, match parent, `gravity="center"`, `visibility="gone"`).
   1. `acceptedTitleText`: `wrap_content`; text `@string/category_selected`; `textSize 20sp`; bold; white; shadow dx 2, dy 2, radius 3.
   2. `acceptedCategoryText`: `wrap_content`; `textSize 24sp`; bold; white; shadow dx 2, dy 2, radius 3; `layout_marginTop 8dp`. Text copied from `categoryNameText` in `showAcceptedState`. (`tools:text="Who's This?"` is preview only.)
   3. Unnamed `TextView`: text `@string/power_pick_accepted`; `wrap_content`; `textSize 22sp`; bold; white; shadow dx 2, dy 2, radius 3; `layout_marginTop 24dp`.

Pentagon drawable (`res/drawable/pentagon_background.xml`), verbatim:

```xml
<vector android:width="120dp" android:height="120dp" android:viewportWidth="100" android:viewportHeight="100">
    <!-- Pentagon fill -->
    <path android:fillColor="#D4AF37" android:pathData="M50,5 L97,37 L79,90 L21,90 L3,37 Z" />
    <!-- Pentagon border -->
    <path android:fillColor="@android:color/transparent" android:strokeColor="#FFD700" android:strokeWidth="3"
          android:pathData="M50,5 L97,37 L79,90 L21,90 L3,37 Z" />
</vector>
```

- Fill `#D4AF37` (gold), stroke `#FFD700`, stroke width 3 viewport units (= 3.6 dp, since 120 dp / 100 units = 1.2 dp per unit).
- Pentagon vertices in viewport units: (50,5), (97,37), (79,90), (21,90), (3,37).
- No pressed state, no ripple, no animation. Only the click listener from 7.2.

### 7.9 Timers and animation

None. `SystemClock.elapsedRealtime()` is used only to measure the time before the tap. There is no `Handler`, `postDelayed`, `animate()` or `ObjectAnimator` in this file. The state change (7.3) and screen change (7.4, 7.5) are instant.

### 7.10 Exits

- Stop message with no override sent: holding screen at once.
- Stop message with an override sent: waits for the success message, then holding screen.
- Success message: holding screen.
- Any holding message: holding screen (see 7.6).
- No back handler of its own.

### 7.11 User-visible strings (Power Pick)

- `category_selected`: "CATEGORY SELECTED" (title, shown twice: normal and accepted states)
- `power_pick`: "POWER PICK"
- `power_pick_description`: "Play a Power Pick once per game" + newline + "to overrule everyone else's choice"
- `power_pick_accepted`: "Power Pick accepted!"
- Category name: the server's `InitialCategorySelectChoice` (runtime text, no fallback)

---

## 8. WhirlpoolView (not used by the three screens)

Source: `java/com/game/remoteclient/ui/WhirlpoolView.kt`.

- Layouts that use it: `fragment_sorting_answers.xml`, `fragment_missing_letter_answering.xml`, `fragment_matching_answering.xml`, `fragment_linking_answers.xml`, `fragment_linking_pairs.xml`, `fragment_elimination_answering.xml`. It is not in `fragment_holding_screen.xml`, `fragment_category_selection.xml` or `fragment_power_pick.xml`. In `fragment_linking_pairs.xml` it sits directly above the sunburst, match parent.
- Constants: `armPaint` colour `#30FFFFFF` (white at about 19% opacity), `rotations = 3.5`, `pointsPerRotation = 120`, so 420 points per arm.
- Geometry, built in `onSizeChanged` / `buildSpiral` (lines 36-90): `cx = w/2`, `cy = h/2`, `maxRadius = 0.38 * min(w,h)`, `maxHalfWidth = 0.15 * maxRadius`, `a = maxRadius / (3.5 * 2π)`.
- Two arms (phase 0 and π). For each point `theta = i/420 * 3.5 * 2π + phase`, `r = a * (theta - phase)` (Archimedean spiral). Ribbon half-width tapers from 0 at the centre to `maxHalfWidth` at the outer end (`fraction = i/totalPoints`). The ribbon is the left edge forward plus the right edge backward, closed.
- Drawn with `drawPath` in `onDraw`. No animation, no rotation: the path is static.

---

## 9. Observed behaviour to reproduce (or consciously fix)

These come directly from the code. Each is stated as what the code does.

1. **TV text is not restored after returning to the holding screen.** The holding screen's view is recreated on return (2.8), so the TV shows "Look at the TV" until the next `ClientHoldingScreenCommandMessage`. Code-derived; not run on device.
2. **The message that causes a return to the holding screen is not applied.** The category screen and the Power Pick screen forward any `ClientHoldingScreenCommandMessage` to `popBackStack`. The text in that message is not shown anywhere (5.5, 7.6).
3. **Power Pick returns to the holding screen on any holding message**, including while the accepted state is showing and a stop/success response is still expected (7.6).
4. **A pending server request is answered with -1 as soon as the category screen is created**, before the doors are visible or tapped (5.6). A live request is answered with the already chosen door (or -1).
5. **Stop messages with no live Power Pick are not answered.** `ServerStopCategorySelectOverride` only calls `onStopCategoryOverride`, which is set only while the Power Pick screen is live. No pending value exists for it (7.4). Whether the server needs an answer is not in the app code.
6. **Power Pick shows "accepted" before the server confirms.** The accepted state appears on tap. The success message only navigates; `CategorySelectOverrideSuccess` and the player name are logged, not shown (7.3, 7.5).
7. **No client-side timeout** on the category choice, the override offer, or the wait for stop/success. If the server never sends a stop or success message after an accepted override, the screen stays on "Power Pick accepted!" (no code path leaves it).
8. **Empty columns keep their space** (`INVISIBLE`, not `GONE`), so one, two or three choices are left-aligned in the four-column grid (5.3).
9. **Holding colour messages received when the holding screen is not live are dropped.** No pending field exists (1.3). Colours survive a return to the holding screen only because they are fragment fields (2.8).
10. **Category and Power Pick ignore `ServerColourMessage`.** The category screen starts with beige and changes only when the choices message carries background tints. The Power Pick screen is always beige, then always blue after accepting (5.3, 7.1, 7.3).
11. **Only holding messages that navigate are acted on.** Text-only holding messages arriving while the holding screen is not live are lost (1.3).
12. **Holding to ordering goes to `LinkingAnswersFragment`, not `LinkingPairsFragment`** (2.5).
13. **Quiz actions 14, 15, 29, 30 are ignored on the holding screen.** Action 14 (`ACTION_READY`) is handled only by `WaitingRoomFragment`. Actions 15 (`ACTION_EXIT`), 29 (`ACTION_PAUSED`) and 30 (`ACTION_UNPAUSED`) are defined as constants but not referenced anywhere in the code.
14. **`ServerRoomMessage` and `ServerAwaitTriviaAnsweringPhaseMessage` have no UI effect**, though both are decoded.

---

## 10. Not found in the code

- Any use of `ChoiceType` (on `CategoryChoice`) by the UI. Its meaning is not defined in the app.
- Any use of `CategoryChoice.DoorIndex` or `ServerBeginCategorySelectOverride.DoorIndex` by the UI.
- Any use of `ServerCategorySelectChoices.HeaderText` by the UI.
- Any use of `ServerCategorySelectChoices.PrimaryTint` by the UI.
- Any use of `ServerColourMessage.Rainbow` or `RoundType` by these screens.
- Any use of `ServerBeginCategorySelectOverride.DurationSeconds` for a timeout.
- Any client-side timer or timeout in the holding, category or Power Pick screens.
- Any animation or transition duration in the holding, category or Power Pick screens, the door, the TV, the sunburst, or the whirlpool.
- Any `DoorView` touch handling or whirlpool usage on these three screens.
- Any use of the `ClientHoldingScreenCommandMessage.action` field, `OtherPlayerIndex`, `ShowPortraitPhotoControls` or `serverTick` in `HoldingScreenFragment`.
- A meaning for `ChosenCategoryIndex = -1` on the server side. The code only uses -1 as the "nothing chosen" fallback.
- The server-side meaning of an unanswered stop request.

---

## 11. Message-to-screen transition map (summary)

| From | Message | To |
|---|---|---|
| Holding | `ServerCategorySelectChoices` | Category |
| Holding | `ServerBeginTriviaAnsweringPhase` | Trivia |
| Holding | `ServerBeginPowerPlayPhase` | Power Play |
| Holding | `ServerBeginLinkingAnsweringPhase` | Linking Pairs |
| Holding | `ServerBeginOrderingAnsweringPhase` | Linking Answers |
| Holding | `ServerBeginSortingAnsweringPhase` | Sorting Answers |
| Holding | `ServerBeginEliminatingAnsweringPhase` | Elimination Answering |
| Holding | `ServerBeginMissingLetterAnsweringPhase` | Missing Letter Answering |
| Holding | `ServerBeginMatchingAnsweringPhase` | Matching Answering |
| Holding | `ClientEndOfGameFactCommandMessage` | End of Game Fact |
| Holding | `ClientQuizCommandMessage` action 4 | Continue |
| Category | `ServerBeginTriviaAnsweringPhase` | Trivia (holding kept under it) |
| Category | `ServerBeginCategorySelectOverride` | Power Pick |
| Category | `ClientHoldingScreenCommandMessage` | Holding (pop) |
| Power Pick | `ClientHoldingScreenCommandMessage` | Holding (pop) |
| Power Pick | `ServerCategorySelectOverrideSuccess` | Holding (pop) |
| Power Pick | `ServerStopCategorySelectOverride` with no override sent | Holding (pop) |

---

## 12. Strings (English, with Russian for reference)

English is `res/values/strings.xml`. Russian is `res/values-ru/strings.xml` (the app has a Russian locale, so the device language decides which applies).

| Key | English (strings.xml) | Russian (values-ru) | Used by |
|---|---|---|---|
| `get_ready` | Get Ready! | Приготовьтесь! | Holding screen (type 9, empty text) |
| `look_at_tv` | Look at the TV | Смотрите на ТВ | Holding screen (empty text), TV default |
| `choose_a_category` | CHOOSE A CATEGORY | ВЫБЕРИТЕ КАТЕГОРИЮ | Category title |
| `category_selected` | CATEGORY SELECTED | КАТЕГОРИЯ ВЫБРАНА | Power Pick title (both states) |
| `power_pick` | POWER PICK | СУПЕРВЫБОР | Power Pick label |
| `power_pick_description` | Play a Power Pick once per game\nto overrule everyone else's choice | Используйте Супервыбор раз за игру,\nчтобы переопределить выбор остальных | Power Pick description |
| `power_pick_accepted` | Power Pick accepted! | Супервыбор принят! | Power Pick accepted state |

Strings that are not used by these screens are not listed.

---

## 13. Colour reference (hex, as in the code)

| Use | Value | Where |
|---|---|---|
| Sunburst default primary (even rays) | `#C4B8A8` | `HoldingScreenFragment`, `CategorySelectionFragment`, `PowerPickFragment`, `SunburstBackgroundView` |
| Sunburst default secondary (odd rays) | `#D4C8B8` | same |
| Sunburst darken overlay | `#55000000` | `SunburstBackgroundView` |
| Power Pick accepted primary | `#4A7AB5` | `PowerPickFragment` |
| Power Pick accepted secondary | `#3A6AA5` | `PowerPickFragment` |
| TV eggshell (antenna, frame, scallops, text) | `#F0EAD6` | `RetroTvView` |
| TV face fill (default) | transparent | `HoldingScreenFragment` (`foregroundColor`) |
| Door border (gold, always) | `#D4AF37` | `DoorView` |
| Door default panel | `#8B7355` | `DoorView` |
| Door default frame | `#F5E6C8` | `DoorView` |
| Door hinge/detail (pointed/domed ornaments) | `#7B6B5B`, `#5C4033`, `#6B5B4B` | `DoorView` |
| Door arch window | `#6B5344` | `DoorView` (styles 2 and 3) |
| Door triangle in arch | `#8B7B6B` | `DoorView` (style 2) |
| Door glitter | `#FFFACD` | `DoorView` |
| Door blend target (panel) | `#5C4033` | `DoorView.setDoorColor` |
| Pentagon fill | `#D4AF37` | `pentagon_background.xml` |
| Pentagon stroke | `#FFD700` | `pentagon_background.xml` |
| Power Pick label | `#D4AF37` | `fragment_power_pick.xml` |
| Power Pick description | `#CCFFFFFF` | `fragment_power_pick.xml` |
| Title, labels, category name (text) | `#FFFFFFFF` (`@android:color/white`) | category and power pick layouts |
| Text shadow | `#80000000` | all text in these layouts |
| Whirlpool arms (not on these screens) | `#30FFFFFF` | `WhirlpoolView` |

---

## 14. Port notes for HTML/JavaScript

- Use one full-viewport canvas (or layered elements) for the holding screen. Draw the sunburst, then the TV, using the geometry in sections 3 and 4.
- TV transform: translate to centre, rotate -10 degrees, scale x by 1.2, then draw everything in the TV's own coordinates. Use `size = 0.6 * min(W, H)`.
- Category screen: use a flex row with four equal columns (each `(W-16dp)/4`), `visibility: hidden` for empty columns (keep the space), a label above a door-shaped element that fills the rest of the column height.
- Door shapes: use `Path2D` with the quadratic curves in section 6.4. The glitter needs a seeded PRNG (a 31-dot pattern per door index), so the port needs an equivalent of `java.util.Random` to match the dot positions exactly; otherwise the dots will differ but the look will be the same.
- Colour conversion: section 1.6. Keep alpha for background and primary, drop it for door colours (6.3).
- Behaviour to keep 1:1: all items in section 9, since they are the current behaviour. Decide per item whether to reproduce or fix.
- Messaging: the outgoing JSON in section 1.4; the wire framing is only needed if the port talks to the real server directly.
