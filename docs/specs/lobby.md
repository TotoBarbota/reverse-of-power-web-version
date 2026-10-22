# Lobby screens: porting spec (Android Kotlin to HTML/JavaScript)

Source root: `reverse-of-power\app\src\main`
App: "Reverse of Power" phone controller for the PS4 quiz game "Knowledge Is Power" (KIP).
Package: `com.game.remoteclient`. Min SDK 26, target SDK 35, compile SDK 36. Only the `debug` and `release` build types exist; `release` has `isMinifyEnabled = false`.

Short names used below (all relative to the source root):

| Short name | File |
|---|---|
| NM | `java\com\game\remoteclient\network\NetworkManager.kt` |
| PC | `java\com\game\protocol\GameProtocolClient.kt` |
| PE | `java\com\game\protocol\ProtocolEncoder.kt` |
| PD | `java\com\game\protocol\ProtocolDecoder.kt` |
| MSG | `java\com\game\protocol\GameMessages.kt` |
| DDP | `java\com\game\remoteclient\network\DdpDiscovery.kt` |
| UI | `java\com\game\remoteclient\ui\` |

Conventions:
- Kotlin is quoted verbatim. Line numbers are the file lines on disk. Where a line number is not given, the function name is.
- Outgoing JSON examples are **derived** from the Kotlin data classes and kotlinx.serialization defaults (`encodeDefaults = true`, the `Json` instance in PE). They were not captured from a live session. Field order follows the Kotlin declaration order.
- "Not found" means the search of the source tree found no match.
- Colors are given as `#RRGGBB` (or `#AARRGGBB` where the source has alpha). Android `#AARRGGBB` is written in that order in the source.

---

## 0. Lobby flow at a glance

```
ServerDiscovery ──(ClientQuizCommand 31 RESET_TO_NAME, via MainActivity)──> NameEntry
ServerDiscovery ──(RejoiningClientOwnProfileMessage or ClientHoldingScreenCommandMessage)──> HoldingScreen (not in scope)
NameEntry ──(Continue, name 2..8 chars)──> CameraCapture(playerName)
CameraCapture ──(Continue, photo + avatar confirmed; image+profile sent)──> WaitingRoom
WaitingRoom ──(ClientQuizCommand 14 READY shows hold-to-start)──> hold 2 s ──> StartGameButtonPressedResponseMessage
WaitingRoom ──(ClientHoldingScreenCommandMessage)──> HoldingScreen (not in scope)
HoldingScreen ──(ClientQuizCommand 4 CONTINUE)──> ContinueFragment (not in scope but in the Continue screen spec below)
HoldingScreen ──(ClientEndOfGameFactCommandMessage)──> EndOfGameFactFragment
EndOfGameFactFragment ──(Continue button, or interceptor state)──> NameEntry (popBackStack)
Any screen ──(ClientQuizCommand 31 RESET_TO_NAME, global handler)──> NameEntry
```

Navigation graph start destination: `serverDiscoveryFragment` (`res\navigation\nav_graph.xml`).

---

## 1. Global behaviour

### 1.1 Activity and window (`MainActivity.kt`, `res\layout\activity_main.xml`, `AndroidManifest.xml`, `res\values\themes.xml`)

- Single activity `.MainActivity`, `android:exported="true"`, LAUNCHER intent filter, **`android:screenOrientation="landscape"`** (manifest). The app is landscape-only.
- Theme `Theme.GameRemoteClient` parent `Theme.Material3.DayNight.NoActionBar`:
  - `colorPrimary` `#2196F3`, `colorPrimaryDark` `#1976D2`, `colorAccent` `#FF5722`.
  - `android:windowBackground` `#F5F5F5`.
  - `android:windowLayoutInDisplayCutoutMode` `shortEdges`.
  - `materialButtonStyle` = `Widget.App.Button` (parent `Widget.Material3.Button`, shape `ShapeAppearance.App.Rounded` = `cornerSize 8dp`, `cornerFamily rounded`). All shape corners (small..extra-large) map to this 8dp rounded shape.
- Layout `activity_main.xml`: a `ConstraintLayout` containing one `FragmentContainerView` `nav_host_fragment` (`NavHostFragment`, `app:defaultNavHost="true"`, `app:navGraph="@navigation/nav_graph"`), 0dp width and height, constrained to all four parent edges.
- `onCreate`:
```kotlin
WindowCompat.setDecorFitsSystemWindows(window, false)   // edge-to-edge
// Keep screen on during gameplay
window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
hideSystemBars()
```
  - `FLAG_KEEP_SCREEN_ON` is set once in `onCreate` and never cleared. The screen stays on for the whole activity lifetime, including the lobby.
  - System bar insets (`WindowInsetsCompat.Type.systemBars()`) are applied as **padding on the nav host view** (left, top, right, bottom), and the insets are consumed.
- `hideSystemBars()`: `controller.hide(statusBars() or navigationBars())` and `systemBarsBehavior = BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`. Called in `onCreate` and again in `onWindowFocusChanged(true)`.
- **Reset-to-name handler (global)**, set once in `onCreate`:
```kotlin
networkManager.onResetToNameEntry = {
    runOnUiThread {
        if (!navController.popBackStack(R.id.nameEntryFragment, false)) {
            // nameEntryFragment not on back stack (e.g. still on ServerDiscovery) —
            // pop to start and navigate forward
            navController.popBackStack(R.id.serverDiscoveryFragment, false)
            navController.navigate(R.id.action_serverDiscovery_to_nameEntry)
        }
    }
}
```
  - Invoked from NM when a `ClientQuizCommandMessage` with `action == 31` arrives and no fragment-level interceptor is set (NM `handleUIEvents`, `is ClientQuizCommandMessage` branch: `(onResetToNameEntryInterceptor ?: onResetToNameEntry)?.invoke()`).
  - Behaviour when NameEntry is on the back stack: pop back to it (state of screens above it is discarded).
  - Behaviour when it is not: pop to ServerDiscovery and navigate to NameEntry.
  - Edge case: when NameEntry is already the top destination, `popBackStack(nameEntry, false)` is called. The code then depends on the boolean that Navigation returns for "nothing popped". I did not verify that return value against the Navigation library source. If it returns `false`, the fallback re-creates NameEntry (the name input is recreated); if it returns `true`, nothing happens.
- Back button: **no override** (no `OnBackPressedCallback`, no `onBackPressed` override). Standard Navigation behaviour applies (back pops one destination). Not verified against library source.
- `onSupportNavigateUp()` is overridden to `navController.navigateUp() || super...`. The app has no action bar, so this is not reachable from the lobby UI.
- `GameRemoteClientApplication.onCreate` calls `networkManager.init(this)`. `onTerminate` calls `networkManager.disconnect()`.

### 1.2 Navigation graph, lobby subset (`res\navigation\nav_graph.xml`)

| Destination id | Fragment | Label | Arguments | Outgoing actions (as declared in XML) |
|---|---|---|---|---|
| `serverDiscoveryFragment` (start) | ServerDiscoveryFragment | Server Discovery | none | `action_serverDiscovery_to_nameEntry`, `action_serverDiscovery_to_holdingScreen`, `action_serverDiscovery_to_waitingRoom`, `action_serverDiscovery_to_debugLauncher` |
| `nameEntryFragment` | NameEntryFragment | Name Entry | none | `action_nameEntry_to_cameraCapture` |
| `cameraCaptureFragment` | CameraCaptureFragment | Take Photo | `playerName` (string, required) | `action_cameraCapture_to_avatarSelection`, `action_cameraCapture_to_waitingRoom` |
| `avatarSelectionFragment` | AvatarSelectionFragment | Avatar Selection | `playerName` (string, required) | `action_avatarSelection_to_waitingRoom` |
| `waitingRoomFragment` | WaitingRoomFragment | Waiting Room | none | `action_waitingRoom_to_holdingScreen` |
| `holdingScreenFragment` | HoldingScreenFragment | Holding Screen | none | (not in scope) |
| `continueFragment` | ContinueFragment | Continue | none | none |
| `endOfGameFactFragment` | EndOfGameFactFragment | End of Game Fact | none | none |

Actions that exist in XML but are **never invoked in code** (checked: no `navigate` call for them under `java\`):
- `action_serverDiscovery_to_waitingRoom` (not used).
- `action_cameraCapture_to_avatarSelection` (not used). Consequence: `AvatarSelectionFragment` is unreachable (see 2.4).
- `action_avatarSelection_to_waitingRoom` (only reachable from the unreachable screen).

Navigation calls found in the lobby code (quoted):
- `ServerDiscoveryFragment.kt`: `findNavController().navigate(R.id.action_serverDiscovery_to_debugLauncher)` (DEBUG only), `findNavController().navigate(R.id.action_serverDiscovery_to_holdingScreen)` (two places: rejoin and holding-screen callbacks).
- `MainActivity.kt`: `navController.navigate(R.id.action_serverDiscovery_to_nameEntry)`.
- `NameEntryFragment.kt`: `val action = NameEntryFragmentDirections.actionNameEntryToCameraCapture(playerName = name)`.
- `CameraCaptureFragment.kt`: `val action = CameraCaptureFragmentDirections.actionCameraCaptureToWaitingRoom()`.
- `WaitingRoomFragment.kt`: `findNavController().navigate(R.id.action_waitingRoom_to_holdingScreen)`.
- `EndOfGameFactFragment.kt`: `if (!nav.popBackStack(R.id.nameEntryFragment, false)) { nav.popBackStack() }`, and `findNavController().popBackStack(R.id.holdingScreenFragment, false)`.
- `ContinueFragment.kt`: `findNavController().popBackStack(R.id.holdingScreenFragment, false)`.

Back stack when the standard path runs: `[serverDiscovery, nameEntry, cameraCapture, waitingRoom, holdingScreen, ...]`. Note: `action_waitingRoom_to_holdingScreen` has no `popUpTo`, so the back stack grows.

### 1.3 Persistence: SharedPreferences, saved profile, cache

- The only persisted value found anywhere in the app is in `NetworkManager.init`:
```kotlin
val prefs = context.getSharedPreferences("game_prefs", Context.MODE_PRIVATE)
deviceUID = prefs.getString("device_uid", null) ?: run {
    val uid = UUID.randomUUID().toString().replace("-", "")
    prefs.edit().putString("device_uid", uid).apply()
    uid
}
```
  - Preferences file `game_prefs`, key `device_uid`. Value: a random UUID v4 with hyphens removed (32 lowercase hex characters), generated once on first launch.
  - This UID is sent in the handshake (`sendDeviceUID`), in `ClientRequestPlayerIDMessage.UID`, and in `DeviceInfoMessage.DeviceUID`.
- **Saved profile on the phone: not found.** The player name, avatar choice, and captured photo are not written to SharedPreferences, to files, or to a database. Searches for `SharedPreferences`, `getSharedPreferences`, `edit()`, and `saved` in `java\` found only the `device_uid` code and unrelated Android API names.
- Photo file: `CameraCaptureFragment.PHOTO_FILENAME = "avatar_photo.jpg"` is declared in the companion object. **Nothing writes this file.** `AvatarSelectionFragment.loadCapturedPhoto()` reads `File(cacheDir, "avatar_photo.jpg")`, so `capturedBitmap` is always null there. That screen is also unreachable (see 2.4).
- No other `cacheDir`, `filesDir`, or `Room` usage was found in the lobby code.
- Server-side saved profile ("rejoin"): see section 1.4.

### 1.4 Rejoin path and "saved profile" flow

- The app does not decide that it is rejoining. The server sends `RejoiningClientOwnProfileMessage` (fields `Name`, `PortraitGUID`, `Colour` (`ColorTint`), `AvatarID`; see MSG). PD decodes it by `TypeString == "RejoiningClientOwnProfileMessage"`.
- NM handler:
```kotlin
is RejoiningClientOwnProfileMessage -> {
    isRejoining = true
    Log.d(TAG, "Rejoining as ${message.Name} with avatar ${message.AvatarID}")
    onRejoining?.invoke(message)
}
```
- `isRejoining` is set and reset (in `disconnect()`) but **never read** anywhere. The `Name`, `PortraitGUID`, `Colour`, and `AvatarID` fields are not used by any UI.
- The only UI listener is `ServerDiscoveryFragment` (set in `onServerSelected`, cleared in `clearCallbacks()`):
```kotlin
networkManager.onRejoining = { _ ->
    activity?.runOnUiThread {
        if (_binding == null || navigated) return@runOnUiThread
        navigated = true
        findNavController().navigate(R.id.action_serverDiscovery_to_holdingScreen)
    }
}
```
- Result: when the server reports a rejoin during the handshake, ServerDiscovery navigates straight to HoldingScreen. There is no name/avatar/photo screen on this path, and the app does not re-send a profile.
- `navigated` is a per-view boolean that stops a second navigation from the rejoin callback and the holding-screen callback.
- If no ServerDiscovery listener is active (for example, the rejoin message arrives while on another lobby screen), the message only sets `isRejoining = true`. Nothing else happens.

### 1.5 Debug-only behaviour (`BuildConfig.DEBUG`)

`buildFeatures { buildConfig = true }` and the default AGP build types mean `BuildConfig.DEBUG` is true in the debug variant and false in release. Debug-only paths in the lobby:

| Location | Debug behaviour |
|---|---|
| ServerDiscovery `onViewCreated` | `binding.ipAddressInput.setText("192.168.1.152")` (IP prefilled) |
| ServerDiscovery `setupListeners` | `binding.debugButton` visible, click navigates to DebugLauncher. In release: `binding.debugButton.visibility = View.GONE` |
| NameEntry `onViewCreated` | `binding.nameInput.setText(getString(R.string.default_player_name))` ("Player" prefilled) |
| EndOfGameFact scroll click | If `BuildConfig.DEBUG && !canContinue`: sets `canContinue = true` and shows the Continue button (second tap after opening) |

### 1.6 Keep-alive: locks

On successful connect (`connectToServer` returns true), NM calls `acquireLocks()`:
- WiFi lock: `WifiManager.createWifiLock(WIFI_MODE_FULL_LOW_LATENCY (API 29+) or WIFI_MODE_FULL_HIGH_PERF, "KIP:connection")`, not reference counted, acquired.
- Wake lock: `PowerManager.PARTIAL_WAKE_LOCK`, tag `"KIP:connection"`, not reference counted, acquired.
- Released by `disconnect()` only. Not released on connection failure paths (the lock is only acquired in the success branch).

Permissions (`AndroidManifest.xml`): `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `CHANGE_WIFI_MULTICAST_STATE`, `WAKE_LOCK`, `CAMERA`. Camera features declared `required="false"`. No runtime request for anything other than the camera.

### 1.7 Shared visual tokens

Colors from `res\values\colors.xml` used by the lobby:

| Name | Hex | Used for |
|---|---|---|
| `background` | `#F5F5F5` | Screen backgrounds (ServerDiscovery, NameEntry, CameraCapture avatar panel, AvatarSelection, WaitingRoom), window background |
| `primary` | `#2196F3` | Selected avatar stroke, "Selected"/"Available" status text, theme `colorPrimary`, MaterialButton default fill |
| `primary_dark` | `#1976D2` | EndOfGame sunburst secondary ray color (hard-coded, see 2.7) |
| `accent` | `#FF5722` | Host badge background (item_player, orphan) |
| `text_primary` | `#DE000000` (black, 87% alpha) | Titles, labels |
| `text_secondary` | `#99000000` (black, 60% alpha) | Secondary text, "Taken" status, scanning text, no-servers text, instruction text |
| `white` | `#FFFFFF` | Button text on colored fills, badge text |
| `black` | `#000000` | CameraCapture root background (`@android:color/black`) |

Other colors hard-coded in lobby code (hex as written in source):
- `CircularStartButton`: `#1E1E1E` (outer disc), `#4CAF50` (button fill), `#333333` (light off), `#FFEB3B` (light on and progress arc), `#FFFFFF` (text).
- `item_server` badge drawable `console_type_badge.xml`: solid `#003087`, corner radius `12dp`.
- CameraCapture control bar: `android:background="#80000000"` (50% black).
- ContinueFragment Continue button: `app:backgroundTint="#4CAF50"`.
- Sunburst darken overlay (`SunburstBackgroundView`): `#55000000` (33% black), full-screen, drawn after the rays.
- Sunburst default colors (used by ContinueFragment, which does not call `setColors`): primary ray `#C4B8A8`, secondary ray `#D4C8B8`.
- EndOfGame sunburst colors (set in code): `#2196F3` (primary ray) and `#1976D2` (secondary ray).
- Parchment and seal palette (RewardScrollView): see 2.7.

Fonts: no `res\font` folder, no `fontFamily` attributes and no custom typeface in the lobby. Text uses the platform/Material default family (Roboto on stock Android). Bold is set with `android:textStyle="bold"` where noted. Sizes are in `sp`.

Drawables used by lobby layouts: `ic_chevron_down.xml` (manual IP expand icon), `console_type_badge.xml` (server type badge), `circle_background.xml` (fallback avatar icon). Avatar icons: see 2.3.

Material styles used by lobby layouts (library-defined; exact colours are not in project files): `Widget.Material3.Button`, `Widget.Material3.Button.TextButton` (Rescan), `Widget.Material3.Button.OutlinedButton` (Debug, debug-only), `Widget.MaterialComponents.Button.OutlinedButton` (Retake), `MaterialCardView` defaults (card surface colour and elevation as given per view).

### 1.8 Incoming message dispatch (lobby view)

NM `handleUIEvents` is the single entry point after PC decodes the packet. PC calls `handleProtocolMessage` first and then `onMessageReceived` (= NM `handleUIEvents`). A message handled by neither is logged as `Unhandled message`.

| Incoming message | NM effect | Lobby screen effect |
|---|---|---|
| `InterfaceVersionMessage` | `_gameState = CONNECTED`. PC also sets `encoder.decades = InterfaceVersion.startsWith("KIP2_")` | None |
| `SessionStateMessage` | PC sends `ClientRequestPlayerIDMessage(UID = deviceUID)` | None |
| `AssignPlayerIDAndSlotMessage` | PC stores `assignedPlayerId`/`assignedSlotId`, sends `DeviceInfoMessage`, then `ClientRequestAvatarStatusMessage()` | None |
| `ServerAvatarStatusMessage` | Adds/updates `availableAvatars`; calls `onAvatarsChanged` | CameraCapture list refresh (2.3) |
| `ServerAvatarRequestResponseMessage` | If `AvatarID == pendingAvatarRequest && Available`: `isAvatarConfirmed = true`, `pendingAvatarRequest = null`. Then calls `onAvatarRequestResponse` | CameraCapture button state and "Avatar unavailable" toast (2.3) |
| `RejoiningClientOwnProfileMessage` | `isRejoining = true`, calls `onRejoining` | ServerDiscovery navigates to HoldingScreen (1.4) |
| `ClientQuizCommandMessage` action 31 (`ACTION_RESET_TO_NAME`) | Calls `onResetToNameEntryInterceptor ?: onResetToNameEntry` | MainActivity resets to NameEntry (1.1), or EndOfGame interceptor (2.7) |
| `ClientQuizCommandMessage` action 14 (`ACTION_READY`) | Calls `onQuizCommand` | WaitingRoom shows hold-to-start (2.5). Only if WaitingRoom is the current listener; not buffered |
| `ClientQuizCommandMessage` action 4 (`ACTION_CONTINUE`) | Calls `onQuizCommand` | HoldingScreen navigates to ContinueFragment (not lobby) |
| `ClientQuizCommandMessage` actions 15, 29, 30 | Calls `onQuizCommand` | No lobby handler. `ACTION_EXIT` (15), `ACTION_PAUSED` (29) and `ACTION_UNPAUSED` (30) are declared in MSG but not handled in any UI file |
| `ClientHoldingScreenCommandMessage` | Calls `onHoldingScreenMessage` | ServerDiscovery: navigate to HoldingScreen. WaitingRoom: navigate to HoldingScreen. ContinueFragment: pop to HoldingScreen if `HoldingScreenType != 5`. EndOfGame: pop to HoldingScreen. **NameEntry and CameraCapture have no listener, so the message is dropped there.** |
| `ClientEndOfGameFactCommandMessage` | Sets `pendingEndOfGameFact = message`, calls `onEndOfGameFact` | Only HoldingScreen listens and navigates to EndOfGameFact. Otherwise the pending value stays until the next EndOfGame view reads and clears it |
| `ServerRequestEndOfGameFactCount` | PC sends `ClientEndOfGameFactCount(FactCount = 63)` | None (see section 4) |
| `ResourceRequirementsMessage` | PC requests missing resources (`RequestResourceMessage`) or sends `AllResourcesReceivedMessage` | None in lobby (images are stored in `receivedImages`, used later by PowerPlay) |
| `PlayerJoinedMessage`, `PlayerLeftMessage`, `PlayerNameQuizStateMessage` | Decoded by PD, not handled by PC or NM (logged as unhandled) | None. The lobby has no player list (see 2.8) |

---

## 2. Screens

### 2.1 ServerDiscoveryFragment (`UI\ServerDiscoveryFragment.kt`, `res\layout\fragment_server_discovery.xml`, `res\layout\item_server.xml`, `UI\ServerAdapter.kt`, `network\DdpDiscovery.kt`)

#### 2.1.1 Entry
- Start destination of the graph. Also reached by `popBackStack(R.id.serverDiscoveryFragment, false)` in the reset fallback (1.1).
- Lifecycle (`onViewCreated`): `navigated = false`, `setupRecyclerView()`, `setupListeners()`, DEBUG IP prefill, `startServerScan()`.

#### 2.1.2 Layout (top to bottom)
Root: `NestedScrollView`, `match_parent`, `fillViewport="true"`, background `#F5F5F5`. One child `LinearLayout` (vertical), **width fixed `520dp`**, `wrap_content` height, padding `16dp`, `layout_gravity="center_horizontal"`.

1. **Title** `titleText`: text "Find Game Server", 28sp bold, `text_primary`, centered, `layout_marginTop="32dp"`.
2. **Debug button** `debugButton`: "Debug", `Widget.Material3.Button.OutlinedButton`, 12sp, `layout_marginTop="4dp"`, centered. `visibility="gone"` in XML; made visible only in DEBUG.
3. **Header row** (horizontal, `center_vertical`, `layout_marginTop="32dp"`):
   - `discoveredServersLabel`: "Discovered Servers", 18sp bold, `text_primary`, weight 1.
   - `rescanButton`: "Rescan", `Widget.Material3.Button.TextButton`, 14sp.
4. **Scanning indicator** `scanningContainer`: vertical, centered, padding `24dp`, `visibility="gone"` in XML. Contains:
   - `scanningProgress` `ProgressBar` (wrap_content, default indeterminate spinner).
   - `scanningText`: "Scanning for servers…" (ellipsis character U+2026), `text_secondary`, `layout_marginTop="8dp"`, default TextView size.
5. **Server list** `serversRecyclerView`: `RecyclerView`, `LinearLayoutManager` (vertical), `layout_marginTop="8dp"`, `nestedScrollingEnabled="false"`, `wrap_content` height.
6. **No servers** `noServersText`: "No servers found", `text_secondary`, centered, `padding="32dp"`, gone in XML.
7. **Spacer**: `View`, `layout_height="0dp"`, `layout_weight="1"`. Note: the parent is `wrap_content` in a ScrollView, so the weight has no effect.
8. **Manual entry container** `manualEntryContainer`: vertical, `layout_marginTop="24dp"`.
   - Toggle header `manualEntryHeader`: horizontal, `paddingVertical="12dp"`, `?attr/selectableItemBackground`, clickable and focusable. Contains:
     - "Manual IP Address" (`manual_ip_address`), 16sp, `text_secondary`, weight 1.
     - `expandIcon`: `ImageView` 24dp×24dp, `ic_chevron_down`, content description "Expand".
   - Collapsible card `ipEntryCard`: `MaterialCardView`, `cardCornerRadius 8dp`, `cardElevation 4dp`, `layout_marginTop="8dp"`, **`visibility="gone"`** initially. Inside: horizontal `LinearLayout`, padding `16dp`, `center_vertical`:
     - `TextInputLayout` (weight 1) with `TextInputEditText` `ipAddressInput`: hint "192.168.1.100", `inputType="textNoSuggestions"`, `maxLines="1"`.
     - `MaterialButton` `connectButton`: "Connect", 16sp, `layout_marginStart="12dp"`, wrap_content.

Visibility toggling: `ipEntryCard` shown/hidden instantly (no animation). `expandIcon.rotation` is set to `180f` (expanded) or `0f` instantly.

#### 2.1.3 Interaction mechanics
- Discovery scan (`startServerScan`):
```kotlin
binding.scanningContainer.visibility = View.VISIBLE
binding.noServersText.visibility = View.GONE
binding.rescanButton.isEnabled = false
serverAdapter.submitList(emptyList())
```
  - Then `networkManager.scanForServers()` on a coroutine (`lifecycleScope`). On success: hide scanning, re-enable rescan, show "No servers found" if empty, else submit the list. On exception: hide scanning, re-enable rescan, show "No servers found" and toast `scan_failed` with `e.message`.
  - **Quirk:** `startServerScan()` does not reset `scanningText`. After a failed connect (which sets `scanningText` to "Connecting to server..."), a Rescan shows the "Connecting to server..." label on the scanning indicator.
- Discovery protocol (DDP, `DdpDiscovery.kt`):
  - `discover(context, timeoutMs = 3000)`. First tries the WiFi broadcast address computed from `WifiManager.dhcpInfo` (`(ip & mask) | ~mask`). If that returns nothing, it sends again to `255.255.255.255`. Worst case about 6 s total (two passes of up to 3 s each).
  - Each pass opens a `DatagramSocket` with `broadcast = true`, sends two SRCH packets, then collects responses until the deadline:
```kotlin
private val targets = listOf(
    DdpTarget(PS4_PORT, PS4_VERSION),   // 987, "00020020"
    DdpTarget(PS5_PORT, PS5_VERSION)    // 9302, "00030010"
)
private fun buildSrchMessage(version: String): ByteArray {
    return "SRCH * HTTP/1.1\ndevice-discovery-protocol-version:$version\n".toByteArray()
}
```
  - Response parsing (`parseResponse`): first line must start with `HTTP/`; status code is the second token. Headers are `key: value` lines, keys lower-cased. Required header `host-id` (else the response is ignored). `host-type` defaults to `"Unknown"`, `host-name` defaults to the host type. Optional `system-version` and `host-request-port`.
  - Results are de-duplicated by `host-id`. `PlayStationConsole.isAwake` is `statusCode == 200`.
  - `NetworkManager.scanForServers()` returns **only awake consoles**, as `GameServer(ipAddress = senderIp, name = hostName, consoleType = hostType)`. Standby consoles are not shown.
  - Port of the game server is not from discovery: `GameServer.port` defaults to `9066` ("fixed server port").
- Row click (`ServerAdapter`): `binding.root.setOnClickListener { onServerClick(server) }` calls `onServerSelected(server)`.
- Row content (`ServerAdapter.bind`):
```kotlin
binding.serverName.text = server.name ?: "PlayStation"
binding.serverAddress.text = server.ipAddress
binding.consoleType.text = server.consoleType ?: "PS"
```
- `ServerAdapter` diff: `areItemsTheSame` compares `ipAddress`; `areContentsTheSame` compares the data class.
- `item_server.xml` layout: `MaterialCardView`, `layout_margin 8dp`, `cardCornerRadius 8dp`, `cardElevation 2dp`, clickable, `?attr/selectableItemBackground` foreground. Padding `16dp`, `center_vertical`. Left column (weight 1, vertical): `serverName` 18sp bold (`textColorPrimary`, placeholder text "Game Server" overwritten in code), `serverAddress` 14sp `textColorSecondary`, `layout_marginTop="4dp"`. Right: `consoleType` 12sp bold white, background `console_type_badge` (solid `#003087`, radius `12dp`), `paddingHorizontal 10dp`, `paddingVertical 4dp`, placeholder "PS4" overwritten in code.
- Connect button (`connectButton`):
```kotlin
val ipAddress = binding.ipAddressInput.text.toString().trim()
if (ipAddress.isNotEmpty()) {
    val server = GameServer(ipAddress)
    onServerSelected(server)
} else {
    Toast.makeText(requireContext(), getString(R.string.enter_ip_prompt), Toast.LENGTH_SHORT).show()
}
```
  - No IP format validation. Any non-empty trimmed text is used as the address.
- Rescan button: `startServerScan()`.
- Manual header: toggles `manualEntryExpanded` and the card visibility and icon rotation.

#### 2.1.4 `onServerSelected(server)`
```kotlin
binding.connectButton.isEnabled = false
binding.scanningContainer.visibility = View.VISIBLE
binding.scanningText.text = getString(R.string.connecting_to_server)
setServerOptionsVisible(false)
```
- `setServerOptionsVisible(false)` hides `serversRecyclerView`, `manualEntryContainer`, `rescanButton`, `discoveredServersLabel`, and `noServersText`. The header row container itself stays visible (empty row).
- Listeners are attached **before** connecting: `onRejoining` (1.4) and `onHoldingScreenMessage` (navigates to HoldingScreen once, guarded by `navigated`).
- Then `networkManager.connectToServer(server)` on a coroutine:
  - Success: nothing is done. The "Connecting to server..." spinner stays until a rejoin, a holding-screen message, or a reset (`ClientQuizCommandMessage` 31 via the MainActivity handler) arrives. **There is no timeout after a successful connect in this screen.**
  - Failure (returns false): hide scanning, enable connect, show options, `clearCallbacks()`, toast `failed_to_connect` with `server.fullAddress` (`"ip:9066"`), LONG length.
  - Exception: same as failure, but toast `connection_error_detail` with `e.message`, LONG length.
- `clearCallbacks()`: sets `onRejoining = null` and `onHoldingScreenMessage = null`.
- `onDestroyView()`: `clearCallbacks()` and `_binding = null`. This runs on every forward navigation away from this screen, which removes its listeners.

#### 2.1.5 Connect procedure (NM and PC)

`NetworkManager.connectToServer(server)` (on `Dispatchers.IO`):
```kotlin
_gameState.value = GameState.CONNECTING
currentServer = server
availableAvatars.clear()
protocolClient = GameProtocolClient(deviceUID, server.ipAddress, server.port)
setupMessageHandlers()
val connected = protocolClient?.connect() ?: false
```
- `availableAvatars` is cleared here. `selectedAvatarId` is **not** cleared here (only in `disconnect()`).
- A new `GameProtocolClient` is created on every connect. The previous client is not closed in this path.
- On failure: `_connectionError.value = protocolClient?.connectionError ?: "Connection timed out"`. In PC, `connectionError` is initialised to null and never assigned a non-null value, so the user-visible failure text is effectively always the NM fallback. The UI does not read `connectionError`.

PC `connect(timeoutMs = 5000)`:
- Opens `serverSocket = DatagramSocket(0, 0.0.0.0 IPv4)` (ephemeral local port, used for **sending**) and `clientSocket = DatagramSocket(listenPort = 9060, 0.0.0.0)` (used for **receiving**). Server address `serverHost:serverPort` = `<console IP>:9066`.
- A background thread loops while the send socket is open:
```kotlin
if (lastRcvMessageId == null && connectionError == null) {
    sendConnectionRequest()
    // send both protocol magic versions, since we don't know if we're connecting to decades at this point
    sendDeviceUID(deviceUID, false)
    sendDeviceUID(deviceUID, true)
} else if (lastRcvMessageId != null) {
    sendAck(lastRcvMessageId!!)
}
Thread.sleep(1000)
```
  - So: connection request and both UID packets every **1000 ms** until the first message arrives, then an ACK every 1000 ms.
- `connectionDeferred` completes on `DecodedPacket.ConnectionInit` (log comment: "0x8a, 0x33, 0xFF"). Waiting uses `withTimeoutOrNull(5000)`. Timeout means connect failed.
- Message retransmission: **not found** for outgoing game messages. PC ignores `DecodedPacket.Nack` (log line commented out). Outgoing messages are sent once.

Wire details (PE, quoted):
```kotlin
val MAGIC_PACKET_KIP = bytes(0xAE, 0x7F)
val MAGIC_PACKET_DECADES = bytes(0xC1, 0x48)
val MAGIC_ACK = bytes(0x8A, 0x33)
val MAGIC_BODY_KIP = bytes(0x33, 0x29)
val MAGIC_BODY_DECADES = bytes(0xA3, 0xD3)
val MAGIC_UID_KIP = bytes(0x0C, 0x89, 0xE8, 0x84, 0x61, 0x03, 0xF4)
val MAGIC_UID_DECADES = bytes(0xAF, 0xE4, 0x87, 0x3D, 0x82, 0xED, 0x6C)
val TYPE_JSON = bytes(0xB1, 0xE2, 0xFF, 0xFF)
val TYPE_MULTIJSON = bytes(0x84, 0x12, 0x40, 0xEE)
val FOOTER_MULTIJSON = bytes(0x32, 0x90)
```
- Connection request (raw, 38 bytes, little-endian): `8A 33` + int32 `-1` (`FF FF FF FF`) + 32 zero bytes.
- UID packet (raw): `magicUid(7 bytes)` + `0x63` + int32 length + UID UTF-8 bytes. Sent twice per tick, once with KIP magic and once with Decades magic.
- ACK (raw, 38 bytes): `8A 33` + int32 messageId + 32 zero bytes.
- Framed game message: 22-byte header + payload. Header (all little-endian): `packetMagic (2 bytes, AE 7F for KIP)`, int32 `messageId`, int32 `packetNum` (total fragments), int32 `packetIdx`, int32 `payloadLen`, int32 `byteOffset`. Max payload per packet is **1002 bytes** (`fragmentSize = 1002`, total 1024). `messageId` comes from a shared counter `++messageCounter` (starts at 0, so first id is 1).
- JSON message body: `bodyMagic (33 29)` + `TYPE_JSON (B1 E2 FF FF)` + int32 LE JSON byte length + UTF-8 JSON (`json.encodeToString`, `ignoreUnknownKeys = true`, `encodeDefaults = true`), then chunked.

Browser note (for the port): raw UDP cannot be opened from a browser page. Any HTML port needs a bridge (for example a small local relay). The byte layouts above are what that bridge must produce.

#### 2.1.6 Incoming messages handled here
Only `RejoiningClientOwnProfileMessage` (1.4) and `ClientHoldingScreenCommandMessage` (1.8). No `ClientQuizCommandMessage` listener exists on this screen. A reset arrives through the MainActivity global handler, not through this fragment.

#### 2.1.7 Exits
- To NameEntry: only by MainActivity reset handler (`ClientQuizCommandMessage` 31) while this is the top destination (1.1).
- To HoldingScreen: rejoin message, or any `ClientHoldingScreenCommandMessage`, once `navigated` is false.
- To DebugLauncher: DEBUG only, via the debug button.
- Successful connect alone does **not** navigate.

#### 2.1.8 Strings on this screen
- `server_discovery_title`: "Find Game Server" (title)
- `debug`: "Debug" (DEBUG only)
- `discovered_servers`: "Discovered Servers"
- `rescan`: "Rescan"
- `scanning`: "Scanning for servers…" (initial value of the scanning label, from XML)
- `no_servers_found`: "No servers found"
- `manual_ip_address`: "Manual IP Address"
- `cd_expand`: "Expand" (content description, not visible)
- `ip_address_hint`: "192.168.1.100" (edit field hint)
- `connect_button`: "Connect"
- `enter_ip_prompt`: "Please enter an IP address" (toast)
- `scan_failed`: "Scan failed: %1$s" (toast, `%1$s` = exception message)
- `connecting_to_server`: "Connecting to server..." (scanning label during connect)
- `failed_to_connect`: "Failed to connect to %1$s" (toast, `%1$s` = `ip:9066`)
- `connection_error_detail`: "Connection error: %1$s" (toast, `%1$s` = exception message)

Note: the scanning label text is "Connecting to server..." with three ASCII dots, while the initial label "Scanning for servers…" uses a single ellipsis character.

---

### 2.2 NameEntryFragment (`UI\NameEntryFragment.kt`, `res\layout\fragment_name_entry.xml`)

#### 2.2.1 Entry
- From ServerDiscovery (`action_serverDiscovery_to_nameEntry`), only through the MainActivity reset handler (ClientQuizCommandMessage 31).
- Also after EndOfGame's Continue button (`popBackStack(nameEntryFragment, false)`), which returns to an existing NameEntry on the back stack.

#### 2.2.2 Layout
Root: `ConstraintLayout`, `match_parent`, `padding 24dp`, background `#F5F5F5`. Elements (vertical chain, `layout_constraintVertical_chainStyle="packed"` on the title, so the three elements are packed and centred vertically):
1. `titleText`: "What's your name?", 32sp bold, `text_primary`, centred, width 0dp (constrained to parent start and end).
2. `nameInputLayout` (`TextInputLayout`): `layout_marginTop="48dp"`, width `0dp` with `layout_constraintWidth_max="480dp"` (max 480dp wide, centred horizontally).
   - `nameInput` (`TextInputEditText`): hint "Enter your name", `inputType="textPersonName|textCapWords"`, `maxLines="1"`, **`maxLength="8"`**, `padding 16dp`, `textSize 20sp`.
3. `continueButton` (`MaterialButton`): "Continue", `height 64dp`, width 0dp with max 480dp, `textSize 20sp`, `layout_marginTop="32dp"`, constrained to bottom of parent.

Default colours of the text field and button are Material defaults (not set in XML). The button is a filled `MaterialButton` (`Widget.App.Button` → `Widget.Material3.Button`).

#### 2.2.3 Interaction mechanics
- On view creation: `nameInput.requestFocus()`, `selectAll()`, then `post { imm.showSoftInput(nameInput, SHOW_IMPLICIT) }` (keyboard requested). No other focus handling.
- Validation on Continue (`continueButton`):
```kotlin
val name = binding.nameInput.text.toString().trim()

if (name.isEmpty()) {
    Toast.makeText(requireContext(), getString(R.string.name_required), Toast.LENGTH_SHORT).show()
    return@setOnClickListener
}

if (name.length < 2) {
    Toast.makeText(requireContext(), getString(R.string.name_too_short), Toast.LENGTH_SHORT).show()
    return@setOnClickListener
}
```
- Limits:
  - Maximum length in the field: **8** characters (`maxLength`, counted before trimming).
  - Minimum length checked: **2** characters, measured on the trimmed string with Kotlin `String.length` (UTF-16 code units).
  - Passed name is the trimmed string (case preserved, not uppercased here).
  - Allowed characters: **no filter found**. Input type is `textPersonName|textCapWords` (keyboard hint only). Any character is accepted.
  - A name of 8 characters with trailing spaces can be trimmed to fewer characters before it is passed on.
- No network message is sent from this screen. The name is only passed as a navigation argument.

#### 2.2.4 Exits
- To CameraCapture: `NameEntryFragmentDirections.actionNameEntryToCameraCapture(playerName = name)`, only when validation passes.
- Back: Navigation default (1.1).

#### 2.2.5 Incoming messages
None. NameEntry registers no NM listener. `ClientHoldingScreenCommandMessage` is dropped while this screen is shown.

#### 2.2.6 Strings
- `enter_name_title`: "What's your name?"
- `name_hint`: "Enter your name" (edit field hint)
- `continue_button`: "Continue"
- `name_required`: "Please enter your name" (toast)
- `name_too_short`: "Name must be at least 2 characters" (toast)
- `default_player_name`: "Player" (DEBUG prefill only)

---

### 2.3 CameraCaptureFragment (`UI\CameraCaptureFragment.kt`, `res\layout\fragment_camera_capture.xml`, `UI\AvatarAdapter.kt`, `res\layout\item_avatar.xml`)

This screen does three things: camera preview and capture (or stub photo), avatar choice (server-controlled list), and the send of the image and profile. It then navigates to WaitingRoom.

#### 2.3.1 Entry
- From NameEntry with argument `playerName` (non-null string). The DebugLauncher uses `"Debug"`.
- Fragment-level state is fresh each time: `photoConfirmed = false`, `capturedBitmap = null`, `selectedAvatar = null`, `cameraAvailable = false`. NM-level state is **not** reset (see 2.3.9).

#### 2.3.2 Layout (top to bottom, left to right)
Root: `ConstraintLayout`, `match_parent`, background `@android:color/black` (`#000000`). Guideline `guideline65` is vertical at **`layout_constraintGuide_percent="0.55"`** (the XML comments say 65/35, but the value is 0.55; the left camera area is 55%, the right avatar panel 45%).

Left: `cameraContainer` (FrameLayout, 0dp, constrained start to parent and end to guideline, `clipChildren`):
- `cameraPreview`: `androidx.camera.view.PreviewView`, `match_parent`, `implementationMode="compatible"`, `scaleType="fillCenter"`.
- `capturedImage`: `ImageView`, `match_parent`, `scaleType="centerCrop"`, gone in XML, content description "Captured photo".
- Bottom control bar (`layout_gravity="bottom"`, horizontal, centred, `padding 16dp`, background `#80000000`):
  - `retakeButton`: "Retake", `Widget.MaterialComponents.Button.OutlinedButton`, gone in XML (shown after capture).

Right: `avatarPanel` (LinearLayout vertical, 0dp, constrained guideline end to parent end, `padding 12dp`, background `#F5F5F5`):
1. Title: "Select Avatar" (`select_avatar`), 18sp bold, `text_primary`, centred, `layout_marginBottom="8dp"`.
2. List area (FrameLayout, weight 1, height 0dp):
   - `avatarRecyclerView`: RecyclerView, `match_parent`, default vertical `LinearLayoutManager`.
   - `loadingProgress`: `ProgressBar`, centred, gone in XML. Set VISIBLE on observe start and GONE on first list update.
   - `emptyText`: "Waiting for avatars..." (`waiting_for_avatars`), `text_secondary`, centred, gone in XML. Shown when the list is empty.
3. `continueButton`: `MaterialButton`, `match_parent` width, `48dp` height, 16sp, `layout_marginTop="8dp"`. XML text "Continue"; the code overwrites it (see 2.3.5).

Avatar row (`item_avatar.xml`): `MaterialCardView` `match_parent` width, `wrap_content` height, `layout_margin 4dp`, `cardCornerRadius 12dp`, `cardElevation 2dp`. Inside: horizontal `LinearLayout`, `padding 12dp`, `center_vertical`:
- `avatarIcon`: `ImageView` 48dp×48dp, content description "Avatar icon".
- `avatarName`: `TextView`, weight 1, `layout_marginStart="12dp"`, 16sp, `?android:attr/textColorPrimary`.
- `avatarStatus`: `TextView`, 12sp (colour set in code).

Row styling in code (`AvatarAdapter.AvatarViewHolder.bind`):
```kotlin
binding.avatarName.text = avatarDisplayName(avatar.AvatarID)
val isSelected = avatar.AvatarID == selectedAvatarId
if (avatar.Available) {
    binding.avatarStatus.text = binding.root.context.getString(if (isSelected) R.string.avatar_selected else R.string.avatar_available)
    binding.avatarStatus.setTextColor(context.getColor(R.color.primary))
    binding.root.alpha = 1.0f
    binding.root.isEnabled = true
} else {
    binding.avatarStatus.text = binding.root.context.getString(R.string.avatar_taken)
    binding.avatarStatus.setTextColor(context.getColor(R.color.text_secondary))
    binding.root.alpha = 0.5f
    binding.root.isEnabled = false
}
binding.avatarIcon.setImageResource(getAvatarDrawable(avatar.AvatarID))
binding.avatarCard.strokeWidth = if (isSelected) 4 else 0
binding.avatarCard.strokeColor = context.getColor(R.color.primary)
binding.root.setOnClickListener {
    if (avatar.Available) {
        onAvatarClick(avatar)
    }
}
```
- Selected: stroke `#2196F3`, **4 px** (raw integer, not dp). Unselected: stroke 0.
- Display name: `avatarId.split('_').joinToString(" ") { word -> word.lowercase().replaceFirstChar { it.uppercase() } }`. Examples: `HIP_HOP` → "Hip Hop", `HOTDOGMAN` → "Hotdogman".
- Icon mapping (`getAvatarDrawable`, uses `avatarId.uppercase()`):

| Avatar ID | Drawable |
|---|---|
| `COWGIRL` | `ic_avatar_cowgirl` |
| `GOFF` | `ic_avatar_goff` |
| `HOTDOGMAN` | `ic_avatar_hotdogman` |
| `LOVER` | `ic_avatar_lover` |
| `MOUNTAINEER` | `ic_avatar_mountaineer` |
| `SCIENTIST` | `ic_avatar_scientist` |
| `SPACEMAN` | `ic_avatar_spaceman` |
| `MAGICIAN` | `ic_avatar_magician` |
| `COUNTRY` | `ic_avatar_country` |
| `ELECTRO` | `ic_avatar_electro` |
| `FASHION` | `ic_avatar_fashion` |
| `FUTURE` | `ic_avatar_future` |
| `GAMER` | `ic_avatar_gamer` |
| `HIP_HOP` | `ic_avatar_hip_hop` |
| `POPCORN` | `ic_avatar_popcorn` |
| `ROCKER` | `ic_avatar_rocker` |
| any other | `circle_background` (plain circle) |

- Status strings: "Selected" (selected and available), "Available" (not selected and available), "Taken" (unavailable). Row-level DiffUtil: items are the same if `AvatarID` matches; contents compared by data-class equality. `setSelectedAvatar(id)` redraws only the old and new rows.

#### 2.3.3 Camera (startup and capture)
- `onViewCreated` order: `cameraExecutor = Executors.newSingleThreadExecutor()`, `setupCameraListeners()`, `setupAvatarList()`, `setupContinueButton()`, `observeAvatars()`, then camera:
```kotlin
if (PermissionHelper.hasCameraPermission(requireContext())) {
    startCamera()
} else {
    cameraPermissionLauncher.launch(PermissionHelper.CAMERA_PERMISSION)
}
```
- Permission result: granted → `startCamera()`; denied → `useStubPhoto()` **silently** (no toast, no message).
- `startCamera()` (CameraX, `ProcessCameraProvider`):
```kotlin
val preview = Preview.Builder().build().also {
    it.setSurfaceProvider(binding.cameraPreview.surfaceProvider)
}
imageCapture = ImageCapture.Builder()
    .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
    .build()
val cameraSelector = CameraSelector.DEFAULT_FRONT_CAMERA
cameraProvider.unbindAll()
cameraProvider.bindToLifecycle(this, cameraSelector, preview, imageCapture)
cameraAvailable = true
updateContinueButton()
```
  - Front camera. Preview and capture resolution: **not set** (CameraX defaults). No mirror handling and no rotation handling found.
  - Any exception while binding → `useStubPhoto()`.
- `useStubPhoto()`: `cameraAvailable = false`, `capturedBitmap = BitmapFactory.decodeStream(resources.openRawResource(R.raw.avatar_stub))`, `photoConfirmed = true`, preview gone, `capturedImage` visible with the stub, retake gone, `updateContinueButton()`. Stub asset: `res\raw\avatar_stub.jpeg`, 12,344 bytes, **512×512** pixels.
- `capturePhoto()`:
```kotlin
imageCapture.takePicture(
    ContextCompat.getMainExecutor(requireContext()),
    object : ImageCapture.OnImageCapturedCallback() {
        override fun onCaptureSuccess(image: androidx.camera.core.ImageProxy) {
            val buffer = image.planes[0].buffer
            val bytes = ByteArray(buffer.remaining())
            buffer.get(bytes)
            capturedBitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            image.close()
            showCapturedPhoto()
        }
        override fun onError(exception: ImageCaptureException) {
            Toast.makeText(requireContext(), getString(R.string.photo_capture_failed, exception.message), Toast.LENGTH_SHORT).show()
        }
    }
)
```
  - Uses the CameraX default (JPEG) plane buffer as-is. No rotation metadata is read.
- `showCapturedPhoto()`: `photoConfirmed = true`, preview gone, `capturedImage` set to the bitmap (centre-crop shown), `retakeButton` visible, `updateContinueButton()`.
- `retakePhoto()`: `capturedBitmap = null`, `photoConfirmed = false`, preview visible, `capturedImage` gone, retake gone, `updateContinueButton()`. Note: `cameraAvailable` is not changed, so after retake the label becomes "Take Photo" again.
- Tap "Retake": `retakePhoto()` (no confirmation).

#### 2.3.4 Avatar list (server-driven)
- Data source: `networkManager.availableAvatars` (filled by NM from `ServerAvatarStatusMessage`, rules below).
- Listeners set in `observeAvatars()`:
```kotlin
networkManager.onAvatarsChanged = {
    activity?.runOnUiThread {
        if (_binding == null) return@runOnUiThread
        updateAvatarList()
    }
}
networkManager.onAvatarRequestResponse = { response ->
    activity?.runOnUiThread {
        if (_binding == null) return@runOnUiThread
        if (response.AvatarID == selectedAvatar?.AvatarID) {
            updateContinueButton()
            if (!response.Available) {
                Toast.makeText(requireContext(), getString(R.string.avatar_unavailable), Toast.LENGTH_SHORT).show()
            }
        }
    }
}
```
- NM rules for `ServerAvatarStatusMessage` (NM `handleUIEvents`):
  - If the avatar is already in `availableAvatars`, replace it (status update, including to unavailable).
  - Else if `Available` is true, append it.
  - Else (new and unavailable): skip, log "Skipping unavailable avatar".
  - Then `onAvatarsChanged?.invoke()`.
- `updateAvatarList()`: hides `loadingProgress`. If empty: shows `emptyText` and hides the list. Else hides `emptyText`, shows the list, `submitList(avatars.toList())`. Then `updateContinueButton()`.
- Tap an available avatar: `onAvatarSelected(avatar)`:
```kotlin
selectedAvatar = avatar
avatarAdapter.setSelectedAvatar(avatar.AvatarID)
networkManager.requestAvatar(avatar.AvatarID)
updateContinueButton()
```
- NM `requestAvatar(avatarId)`:
```kotlin
val previousAvatarId = selectedAvatarId
selectedAvatarId = avatarId
pendingAvatarRequest = avatarId
isAvatarConfirmed = false
if (protocolClient == null) {
    // No server connection (debug mode) — auto-confirm
    isAvatarConfirmed = true
    pendingAvatarRequest = null
    onAvatarRequestResponse?.invoke(ServerAvatarRequestResponseMessage(RequestID = "", AvatarID = avatarId, Available = true))
    return
}
scope.launch {
    // Release previously selected avatar
    if (previousAvatarId != null && previousAvatarId != avatarId) {
        protocolClient?.sendMessage(ClientRequestAvatarMessage(
            RequestID = UUID.randomUUID().toString(),
            AvatarID = previousAvatarId,
            Request = false
        ))
    }
    protocolClient?.sendMessage(ClientRequestAvatarMessage(
        RequestID = UUID.randomUUID().toString(),
        AvatarID = avatarId,
        Request = true
    ))
}
```
  - Sends: optionally a release of the previous avatar (`Request = false`), then a claim of the new avatar (`Request = true`). Each has a fresh UUID v4 `RequestID`.
  - `selectedAvatarId` is kept across screens and connections (cleared only on `disconnect()`), so a release is sent for an avatar held in an earlier visit.
- Confirmation: NM on `ServerAvatarRequestResponseMessage` sets `isAvatarConfirmed = true` only if `AvatarID == pendingAvatarRequest && Available`. A response with `Available = false` leaves `isAvatarConfirmed` false and `pendingAvatarRequest` set. The fragment then shows the "Avatar unavailable" toast only if the response's `AvatarID` matches the locally selected avatar.
- **Not handled:** if an already-selected avatar later becomes `Available = false` in a status update, nothing clears `selectedAvatar`. The row shows "Taken" and the card is disabled, but the selection and `isAvatarConfirmed` are unchanged.

#### 2.3.5 Continue button logic (`updateContinueButton`, `setupContinueButton`)
```kotlin
private fun updateContinueButton() {
    if (cameraAvailable && !photoConfirmed) {
        binding.continueButton.text = getString(R.string.take_photo)
        binding.continueButton.isEnabled = true
        binding.continueButton.alpha = 1.0f
    } else {
        binding.continueButton.text = getString(R.string.continue_button)
        val avatarReady = selectedAvatar != null && networkManager.isAvatarConfirmed
        binding.continueButton.isEnabled = true
        binding.continueButton.alpha = if (photoConfirmed && avatarReady) 1.0f else 0.65f
    }
}
```
- Label/state table:

| Camera state | Photo state | Label | Alpha |
|---|---|---|---|
| available (`cameraAvailable`) | not confirmed | "Take Photo" | 1.0 |
| not available (before bind, or stub) | not confirmed | "Continue" | 0.65 |
| any | confirmed | "Continue" | 1.0 if avatar confirmed, else 0.65 |

  - The button is always enabled (`isEnabled = true`). The alpha is the only visual cue.
- Click:
```kotlin
if (cameraAvailable && !photoConfirmed) {
    capturePhoto()
} else if (!photoConfirmed) {
    Toast.makeText(requireContext(), getString(R.string.take_photo_first), Toast.LENGTH_SHORT).show()
} else if (selectedAvatar == null || !networkManager.isAvatarConfirmed) {
    Toast.makeText(requireContext(), getString(R.string.pick_avatar_first), Toast.LENGTH_SHORT).show()
} else {
    proceedToWaitingRoom()
}
```
- Quirk: before the camera has bound (`cameraAvailable` false, `photoConfirmed` false), the label reads "Continue" at alpha 0.65. Tapping shows "Take a photo first". Once bound, it changes to "Take Photo".

#### 2.3.6 Image and profile send (`proceedToWaitingRoom`)
```kotlin
private fun encodeAvatarJpeg(source: Bitmap): ByteArray {
    val scaled = Bitmap.createScaledBitmap(source, 512, 512, true)
    val clean = Bitmap.createBitmap(512, 512, Bitmap.Config.ARGB_8888)
    val canvas = android.graphics.Canvas(clean)
    canvas.drawBitmap(scaled, 0f, 0f, null)
    val outputStream = ByteArrayOutputStream()
    clean.compress(Bitmap.CompressFormat.JPEG, 85, outputStream)
    if (scaled != source) scaled.recycle()
    clean.recycle()
    return outputStream.toByteArray()
}

private fun proceedToWaitingRoom() {
    val imageData = capturedBitmap?.let { encodeAvatarJpeg(it) }
        ?: resources.openRawResource(R.raw.avatar_stub).use { it.readBytes() }

    val transferId = 2
    val imageGuid = java.util.UUID.randomUUID().toString()
    networkManager.sendImageProfileImage(imageData, imageGuid, transferId, args.playerName)

    val action = CameraCaptureFragmentDirections.actionCameraCaptureToWaitingRoom()
    findNavController().navigate(action)
}
```
- Image encoding, exact:
  - Source: `capturedBitmap` (camera frame decoded from JPEG, or the stub).
  - **Whole frame stretched to 512×512** with bilinear filter (`createScaledBitmap(..., filter = true)`). Aspect ratio is **not** preserved and nothing is cropped. The on-screen preview uses `fillCenter` / `centerCrop`, so the sent image differs from what the user saw.
  - Drawn onto a 512×512 `ARGB_8888` canvas (no paint), then JPEG-compressed at **quality 85**.
  - Result: 512×512 JPEG, bytes sent as-is.
  - Fallback raw path: only if `capturedBitmap` is null when Continue is tapped (possible if `BitmapFactory.decodeByteArray` returned null after a capture). Then the raw stub file bytes (12,344 bytes, the original JPEG, **not re-encoded**) are sent.
  - Stub path (no camera or permission denied): the stub is decoded and goes through `encodeAvatarJpeg`, so it is also re-encoded to 512×512 JPEG q85.
- ImageGUID: `java.util.UUID.randomUUID().toString()`, a new random v4 UUID with hyphens (36 characters), generated on each Continue tap.
- TransferID: constant `2` for the first send; the second send uses `2 + 1 = 3` (see NM below). Both use the same ImageGUID.
- NM `sendImageProfileImage` (order of operations, all on one `scope.launch` on `Dispatchers.IO`):
```kotlin
fun sendImageProfileImage(imageData: ByteArray, imageGuid: String, transferId: Int, playerName: String, culture: String = "en-US") {
    val avatarId = selectedAvatarId ?: return
    Log.d(TAG, "Sending image+profile+image: $playerName with avatar $avatarId")
    scope.launch {
        protocolClient?.sendImage(imageData, imageGuid, transferId)
        protocolClient?.sendMessage(ClientPlayerProfileMessage(
            playerName = playerName,
            uppercasePlayerName = playerName.uppercase(),
            deviceCultureName = culture,
            playerCardId = avatarId
        ))
        protocolClient?.sendImage(imageData, imageGuid, transferId + 1)
    }
}
```
  - Early return with no error if `selectedAvatarId` is null. The fragment still navigates on to WaitingRoom in that case. In practice the Continue gate prevents this.
  - Order: (1) image transfer `TransferID 2`, (2) `ClientPlayerProfileMessage`, (3) image transfer `TransferID 3`. Navigation happens immediately after the coroutine is launched. It does not wait for the sends to finish.
- `GameProtocolClient.sendImage(imageData, imageGuid, transferId, imgType = 2)` (PC):
```kotlin
fun sendImage(imageData: ByteArray, imageGuid: String, transferId: Int, imgType: Int = 2) = synchronized(sendLock) {
    Log.i(TAG, "> Sending image transfer ID: $transferId (${imageData.size}b)")
    val packets = encoder.encodeImageTransfer(imageData, imageGuid, transferId, imgType)
    packets.forEach { sendRawUDP(it) }
}
```
- `encodeImageTransfer` (PE):
```kotlin
val controlMsg = ClientImageResourceContentTransferMessage(
    TransferID = transferId,
    ImageGUID = imageGuid,
    ImgType = imgType
)
val controlPackets = encodeMessage(controlMsg)

val payloadBuffer = ByteBuffer.allocate(imageData.size + 10).order(ByteOrder.LITTLE_ENDIAN)
payloadBuffer.put(bodyMagic)
payloadBuffer.putInt(transferId)
payloadBuffer.putInt(imageData.size)
payloadBuffer.put(imageData)

val imagePackets = wrapAndChunk(payloadBuffer.array())
return controlPackets + imagePackets
```
  - On the wire: first a framed JSON control message (`ClientImageResourceContentTransferMessage`), then a framed binary block `33 29 | int32 LE TransferID | int32 LE size | JPEG bytes`, chunked into 1002-byte payloads.
- **Profile message** (JSON, derived, `TypeString` has no namespace prefix):
```json
{"TypeString":"ClientPlayerProfileMessage","playerName":"<trimmed name>","uppercasePlayerName":"<NAME IN UPPERCASE>","deviceCultureName":"en-US","playerCardId":"<AvatarID, e.g. COWGIRL>"}
```
  - `playerName` is the trimmed name from NameEntry. `uppercasePlayerName` is Kotlin `String.uppercase()` of it.
  - `deviceCultureName` is always `"en-US"` (NM default; fragments do not pass a culture).
  - `playerCardId` is the selected avatar ID (the `AvatarID` string, for example `"HIP_HOP"`).
  - The profile message contains **no ImageGUID**. The link between the profile and the image is implicit (the image sent just before it).
- **Image control message** (JSON, derived):
```json
{"TypeString":"ClientImageResourceContentTransferMessage","TransferID":2,"ImageGUID":"<uuid v4>","ImgType":2}
```

#### 2.3.7 Saved state
- Nothing is written to SharedPreferences, files, or cache from this screen. `PHOTO_FILENAME` is declared but not used for writing.

#### 2.3.8 Incoming messages handled on this screen
- `ServerAvatarStatusMessage` → list refresh (2.3.4).
- `ServerAvatarRequestResponseMessage` → button refresh and "Avatar unavailable" toast (2.3.4).
- No `ClientQuizCommandMessage` or `ClientHoldingScreenCommandMessage` listener. Those are dropped here.
- `RejoiningClientOwnProfileMessage`: no listener here. Only NM sets `isRejoining`.

#### 2.3.9 Exits and cross-screen state
- Next: WaitingRoom, always via `actionCameraCaptureToWaitingRoom`, when `photoConfirmed` and `isAvatarConfirmed` and `selectedAvatar != null`.
- Back: Navigation default, to NameEntry.
- NM state that survives a reset to NameEntry and is not cleared by it: `selectedAvatarId`, `isAvatarConfirmed`, `pendingAvatarRequest`, `availableAvatars`. The Continue gate here is protected by `selectedAvatar == null` (fragment field), which starts null on each visit, so the user must tap an avatar again. The re-tap sends `Request = true` again, and the previously held avatar is released first only if it differs.

#### 2.3.10 Strings
- `select_avatar`: "Select Avatar" (panel title)
- `waiting_for_avatars`: "Waiting for avatars..." (empty list text)
- `take_photo`: "Take Photo" (button label when camera is ready)
- `continue_button`: "Continue"
- `retake_photo`: "Retake"
- `take_photo_first`: "Take a photo first" (toast)
- `pick_avatar_first`: "Pick an avatar first" (toast)
- `photo_capture_failed`: "Photo capture failed: %1$s" (toast, `%1$s` = exception message)
- `avatar_unavailable`: "Avatar unavailable" (toast)
- `avatar_selected`: "Selected" (row status)
- `avatar_available`: "Available" (row status)
- `avatar_taken`: "Taken" (row status)
- `cd_captured_photo`: "Captured photo" (content description)
- `cd_avatar_icon`: "Avatar icon" (content description)
- Not used here: `camera_permission_required` (no toast on denial), `capture_photo`, `use_this_photo`, `use_camera`, `choose_avatar` (only in the orphan `item_player`).

---

### 2.4 AvatarSelectionFragment (`UI\AvatarSelectionFragment.kt`, `res\layout\fragment_avatar_selection.xml`)

**Status: unreachable in the current code.**
- No navigation call targets `avatarSelectionFragment`. The only action into it (`action_cameraCapture_to_avatarSelection`) is never invoked.
- `DebugLauncherFragment.launchAvatarSelection()` navigates to `actionDebugLauncherToCameraCapture`, not to AvatarSelection.

Documented for completeness (if it is ever re-enabled):
- Args: `playerName`.
- Layout (`fragment_avatar_selection.xml`): root `LinearLayout` vertical, `padding 12dp`, background `#F5F5F5`. Title "Choose Your Avatar" (`avatar_selection_title`, 20sp bold, centred). Label "Select Avatar Type" (`select_avatar_type`, 14sp bold, `layout_marginTop="8dp"`). List area (weight 1, `marginTop/Bottom 4dp`) with `avatarRecyclerView`, `loadingProgress`, `emptyText` "Waiting for avatars...". Continue button (`continueButton`, 48dp height, 16sp, **gone** in XML, text "Continue").
- Screen logic: same avatar observers as CameraCapture. `capturedBitmap` is loaded from `cacheDir/avatar_photo.jpg`, which is never written, so it is always null. Continue is visible only after a selection (`visibility = VISIBLE if selectedAvatar != null`) and enabled only when `isAvatarConfirmed`; alpha 1.0 when enabled, else 0.5.
- On Continue: `sendImageProfileImage` with the raw stub bytes (since `capturedBitmap` is null), `TransferID 2`, a new UUID, then navigate to WaitingRoom.

---

### 2.5 WaitingRoomFragment (`UI\WaitingRoomFragment.kt`, `res\layout\fragment_waiting_room.xml`, `UI\CircularStartButton.kt`)

#### 2.5.1 Entry
- From CameraCapture (`actionCameraCaptureToWaitingRoom`). No arguments.

#### 2.5.2 Layout
Root: `ConstraintLayout`, `match_parent`, background `#F5F5F5`. Two children, one visible at a time:

**Waiting state** `waitingContainer` (visible in XML): vertical LinearLayout, `match_parent`, centred.
- `ProgressBar`: 64dp × 64dp, `layout_marginBottom="24dp"`. Default indeterminate spinner (tint not set in XML).
- `waitingText`: text "Waiting for other players...", 20sp, `text_primary`. Not changed in code.

**Ready state** `readyContainer` (gone in XML): vertical LinearLayout, `match_parent`, centred.
- `readyText`: "Hold to Start!", 24sp bold, `text_primary`, `layout_marginBottom="32dp"`.
- `circularStartButton`: `com.game.remoteclient.ui.CircularStartButton`, **250dp × 250dp**.
- `instructionText`: "Press and hold until the lights fill up", 14sp, `text_secondary`, `layout_marginTop="24dp"`.

There is no player list, no player name and no count on this screen. The `players_joined`, `waiting_for_players`, and `you` strings are not used here.

#### 2.5.3 Interaction and timing
- Show ready state: `ClientQuizCommandMessage` with `action == ACTION_READY (14)` → `activity.runOnUiThread { showReadyButton() }`:
```kotlin
private fun showReadyButton() {
    binding.waitingContainer.visibility = View.GONE
    binding.readyContainer.visibility = View.VISIBLE
}
```
  - One-way: no code path returns to the waiting state.
- Hold-to-start (`CircularStartButton`, full spec in 2.5.4):
  - Hold duration: **2000 ms** to fill (`holdDurationMs = 2000L`).
  - On completion: `networkManager.sendStartGameButtonPressed()`.
  - No disabling after send. The button can complete and send again on the next hold. The progress is reset to 0 by `post` after completion.
- `sendStartGameButtonPressed()` (NM): `scope.launch { protocolClient?.sendMessage(StartGameButtonPressedResponseMessage()) }`.
  - Message (JSON, derived): `{"TypeString":"StartGameButtonPressedResponseMessage","Response":9}`.
  - No local navigation after sending. The screen waits for the server.

#### 2.5.4 CircularStartButton (`UI\CircularStartButton.kt`)

Custom `View` (not a Material button). Fixed parameters:

| Parameter | Value |
|---|---|
| Outer disc colour | `#1E1E1E` (fill) |
| Outer disc radius | `R = min(width, height) / 2 - 20` (px) |
| Light count | 16 (`numLights = 16`) |
| Light centre radius | `0.88 * R` |
| Light radius | `0.08 * R` |
| Light off colour | `#333333` |
| Light on colour | `#FFEB3B` |
| Light angle | `i * 360 / 16 - 90` degrees (light 0 at top, clockwise on screen) |
| Light lit | `i / 16 < progress` |
| Progress arc radius | `0.78 * R`, stroke width `12` px, round cap, colour `#FFEB3B` |
| Progress arc | `drawArc(rect, -90, progress * 360, false)`, only drawn when `progress > 0` |
| Button disc radius | `0.7 * R`, fill `#4CAF50` |
| Pressed scale | `0.95` on the button disc only (no change to the outer disc or lights) |
| Label | "START" (`start_caps`), white, `isFakeBoldText = true`, centred, text size `min(width, height) / 6` px |
| Text baseline | `centerY - (descent + ascent) / 2` |

Touch behaviour (`onTouchEvent`):
- `ACTION_DOWN`: `isPressed = true`, `startProgressAnimation()`, invalidate, return true.
- `ACTION_UP` or `ACTION_CANCEL`: `isPressed = false`, `cancelProgressAnimation()`, invalidate, return true.
- `startProgressAnimation()`:
```kotlin
progressAnimator?.cancel()
progressAnimator = ValueAnimator.ofFloat(progress, 1f).apply {
    duration = ((1f - progress) * holdDurationMs).toLong()
    addUpdateListener { animator ->
        progress = animator.animatedValue as Float
        invalidate()
        if (progress >= 1f) {
            onProgressComplete?.invoke()
            // Reset after completion
            post {
                progress = 0f
                invalidate()
            }
        }
    }
    start()
}
```
  - Duration is proportional to the remaining progress, so re-pressing from a partial value finishes in the remaining time.
  - Interpolator: not set, so the `ValueAnimator` default (AccelerateDecelerate) applies. This is a platform default, not coded.
- `cancelProgressAnimation()`:
```kotlin
progressAnimator?.cancel()
progressAnimator = ValueAnimator.ofFloat(progress, 0f).apply {
    duration = 200
    addUpdateListener { animator ->
        progress = animator.animatedValue as Float
        invalidate()
    }
    start()
}
```
  - Release returns the progress to 0 over **200 ms** (platform default interpolator).
- `reset()` (public, not called from the lobby): cancels the animator and sets progress 0.
- No haptics, no sound, no ripple found.

#### 2.5.5 Incoming messages handled here
- `ClientQuizCommandMessage` action 14 (`ACTION_READY`): show ready state (2.5.3).
- `ClientHoldingScreenCommandMessage` (any type): `runOnUiThread { navigateToHoldingScreen() }`, which calls `findNavController().navigate(R.id.action_waitingRoom_to_holdingScreen)`. No type filter.
- `ClientQuizCommandMessage` other actions: ignored.
- Note: READY arriving before this screen registers its listener is **not buffered**. NM has no pending slot for `ClientQuizCommandMessage` (unlike categories or trivia). A READY sent before WaitingRoom is shown is lost.

#### 2.5.6 Exits
- To HoldingScreen: any `ClientHoldingScreenCommandMessage` while WaitingRoom is the listener.
- Otherwise none (the start button only sends a message).

#### 2.5.7 Strings
- `waiting_for_other_players`: "Waiting for other players..." (waiting label, from XML)
- `hold_to_start`: "Hold to Start!" (ready title)
- `hold_to_start_hint`: "Press and hold until the lights fill up" (ready hint)
- `start_caps`: "START" (drawn on the circle)
- Not used here: `waiting_room_title`, `waiting_for_players`, `players_joined`, `start_game`, `you`, `game_starting`. (`get_ready` is used only by HoldingScreen.)

---

### 2.6 ContinueFragment (`UI\ContinueFragment.kt`, `res\layout\fragment_continue.xml`)

#### 2.6.1 Entry
- From HoldingScreen (`action_holdingScreen_to_continue`) when `ClientQuizCommandMessage` action 4 (`ACTION_CONTINUE`) arrives. Not a lobby entry, but this screen is the lobby-adjacent "Continue" prompt, so it is covered here.

#### 2.6.2 Layout
Root: `FrameLayout`, `match_parent`.
1. `sunburstBackground`: `SunburstBackgroundView` (see 2.7.4), **default colours** (this fragment does not call `setColors`): primary rays `#C4B8A8`, secondary rays `#D4C8B8`, full-screen darken `#55000000`.
2. `continueButton`: `MaterialButton`, style `Widget.Material3.Button`, **200dp × 200dp**, `layout_gravity="center"`, text "CONTINUE" (`continue_caps`), 20sp bold, `insetTop 0dp`, `insetBottom 0dp`, `app:cornerRadius="100dp"` (circle), `app:backgroundTint="#4CAF50"`. Text colour: library default (not set).

#### 2.6.3 Interaction
```kotlin
binding.continueButton.setOnClickListener {
    binding.continueButton.isEnabled = false
    networkManager.sendContinueButtonPressed()
}
```
- Tapping sends `ContinuePressedResponseMessage` and **disables the button permanently**. The button does not navigate.
- NM `sendContinueButtonPressed()`: `scope.launch { protocolClient?.sendMessage(ContinuePressedResponseMessage()) }`.
  - Message (JSON, derived): `{"TypeString":"ContinuePressedResponseMessage","Response":3}`.

Incoming listener:
```kotlin
holdingScreenCb = { message ->
    // HoldingScreenType 5 is a player-join notification — ignore it, the button press should dismiss this screen.
    if (message.HoldingScreenType != 5) {
        activity?.runOnUiThread {
            findNavController().popBackStack(R.id.holdingScreenFragment, false)
        }
    }
}
networkManager.onHoldingScreenMessage = holdingScreenCb
```
- Any `ClientHoldingScreenCommandMessage` with `HoldingScreenType != 5` pops back to HoldingScreen. Type 5 (players joining) is ignored.
- Dismissal therefore happens when the server sends the next holding-screen message, not on tap.

#### 2.6.4 Exits
- Back to HoldingScreen (`popBackStack`) on the server message above. Nothing else.

#### 2.6.5 Strings
- `continue_caps`: "CONTINUE"

---

### 2.7 EndOfGameFactFragment (`UI\EndOfGameFactFragment.kt`, `res\layout\fragment_end_of_game_fact.xml`, `UI\RewardScrollView.kt`, `UI\SunburstBackgroundView.kt`, `res\values\factoids.xml`)

#### 2.7.1 Entry
- From HoldingScreen (`action_holdingScreen_to_endOfGameFact`) when `ClientEndOfGameFactCommandMessage` arrives (HoldingScreen's `endOfGameFactCb` calls `navigateToEndOfGameFact()`).
- `pendingEndOfGameFact` is set by NM before the callback. The fragment reads and clears it in `onViewCreated`:
```kotlin
val factMessage = networkManager.pendingEndOfGameFact
networkManager.pendingEndOfGameFact = null
val factoids = resources.getStringArray(R.array.end_of_game_factoids)
val factIndex = Math.abs(factMessage?.FactNumber ?: 0) % factoids.size
binding.scrollView.factText = factoids[factIndex]
```
- If no pending message exists, `FactNumber` defaults to 0.

#### 2.7.2 Layout
Root: `FrameLayout`, `match_parent`.
1. `sunburstBackground`: `SunburstBackgroundView` with colours set in code:
```kotlin
binding.sunburstBackground.setColors(
    Color.parseColor("#2196F3"),
    Color.parseColor("#1976D2")
)
```
   - Primary rays `#2196F3`, secondary rays `#1976D2`, darken overlay `#55000000`.
2. `scrollView`: `RewardScrollView` (custom view), `match_parent`, full size. Clickable (set in code).
3. `continueButton`: `MaterialButton`, `wrap_content`, `layout_gravity="bottom|end"`, `layout_margin="16dp"`, text "Continue" (`continue_button`), 18sp, **gone** in XML.

#### 2.7.3 Scroll state machine and interaction
- Click on `scrollView`:
```kotlin
binding.scrollView.setOnClickListener {
    if (!isScrollOpened) {
        openScroll()
    } else if (BuildConfig.DEBUG && !canContinue) {
        canContinue = true
        enableContinue()
    }
}
```
- `openScroll()`:
```kotlin
isScrollOpened = true
binding.scrollView.alpha = 0.8f
binding.scrollView.animate().alpha(1f).setDuration(300).start()
binding.scrollView.isOpened = true
if (canContinue) enableContinue()
```
  - Opening: alpha animates from 0.8 to 1.0 over **300 ms** (`ViewPropertyAnimator`, platform default interpolator). The drawing switches instantly from closed to open (`isOpened = true`).
- `enableContinue()`: `continueButton.visibility = View.VISIBLE`.
- `canContinue` is set by:
  - the reset interceptor (below), or
  - the DEBUG second tap (1.5).
- Continue button tap:
```kotlin
binding.continueButton.setOnClickListener {
    val nav = findNavController()
    if (!nav.popBackStack(R.id.nameEntryFragment, false)) {
        nav.popBackStack()
    }
    binding.continueButton.isEnabled = false
}
```
  - Pops back to NameEntry if it is on the stack, else pops one destination.
- Two ways the screen leaves without the button:
  - Any `ClientHoldingScreenCommandMessage` (any type, no filter) → `popBackStack(R.id.holdingScreenFragment, false)`:
```kotlin
holdingScreenCb = { _ ->
    activity?.runOnUiThread {
        findNavController().popBackStack(R.id.holdingScreenFragment, false)
    }
}
networkManager.onHoldingScreenMessage = holdingScreenCb
```
  - (`ClientQuizCommandMessage` 31 is handled by the interceptor below, so it does not reach MainActivity while this screen is active.)
- Reset interceptor (`onResetToNameEntryInterceptor`), set while this screen is alive:
```kotlin
networkManager.onResetToNameEntryInterceptor = {
    activity?.runOnUiThread {
        canContinue = true
        if (isScrollOpened) enableContinue()
    }
}
```
  - A reset from the server does **not** navigate. It only enables the Continue button (once the scroll is opened, or immediately on open).
- `onDestroyView()` clears `onHoldingScreenMessage` (if it is still ours) and `onResetToNameEntryInterceptor`.

#### 2.7.4 SunburstBackgroundView (`UI\SunburstBackgroundView.kt`)
- `numRays = 24`. Ray `i` spans from angle `i*15° - 90°` to `(i+1)*15° - 90°` (starts at top, clockwise). Each ray is a triangle from the centre to a point at radius `max(width, height) * 1.5`.
- Even rays (`i % 2 == 0`) use the primary colour; odd rays use the secondary colour.
- After the rays, a full-screen rectangle `#55000000` (33% black).
- `setColors(primary, secondary)` sets both and invalidates.

#### 2.7.5 RewardScrollView (`UI\RewardScrollView.kt`)
Custom view with two states (`isOpened`). Both states use `w = width`, `h = height` (view size in px).

Palette:
- Parchment `#F5E6C8`, parchment dark `#D4B896`, parchment edge `#C4A876`.
- Text `#4A3728`.
- Seal red `#8B0000`, seal light red `#B22222`, seal gold `#DAA520`.

**Closed (unopened)** (`drawUnopenedScroll`):
- Body: width `0.45 * w`, height `0.35 * h`, centred. End cap width `endCapW = 0.15 * scrollH`.
- Body rounded rect: x from `left + endCapW` to `right - endCapW`, full height, radius 4 px. Fill: vertical linear gradient, stops `[#C4A876 @0, #F5E6C8 @0.25, #D4B896 @0.5, #F5E6C8 @0.75, #C4A876 @1]`.
- Left and right end caps: rounded rects `left..left + 2*endCapW` and `right - 2*endCapW..right`, y from `top - 0.05*scrollH` to `bottom + 0.05*scrollH`, radius `endCapW`. Gradient `[#D4B896 @0, #C4A876 @0.5, #D4B896 @1]`.
- Wax seal at the centre `(w/2, h/2)`:
  - Outer: 16-point wavy polygon, radius alternates `sealR` and `0.88 * sealR` where `sealR = 0.3 * scrollH`. Fill `#8B0000`.
  - Inner disc: radius `0.7 * sealR`, fill `#B22222`.
  - Star: 10 points. Outer radius `starR = 0.35 * sealR`, inner radius `0.45 * starR`, first point at top (`-90°`), fill `#DAA520`.
- No text is drawn in the closed state. The factoid is **not visible** until the scroll is opened.

**Open** (`drawOpenedScroll`):
- Scroll: width `0.6 * w`, height `0.85 * h`, centred. `curlH = 0.08 * scrollH`.
- Body: rounded rect `(left + inset, top + curlH)` to `(right - inset, bottom - curlH)`, radius 4 px, fill `#F5E6C8`. `inset = 10dp` (`10 * density` px).
- Top curl: rounded rect `(left, top)` to `(right, top + curlH)`, radius `curlH / 2`. Fill: vertical gradient `[#C4A876 @0, #D4B896 @0.2, #F5E6C8 @0.5, #D4B896 @0.8, #C4A876 @1]`. Shadow line: `#C4A876` at alpha 60, 2 px, from `left + 8` to `right - 8`, at `y = top + curlH`.
- Bottom curl: same geometry at `bottom - curlH`. Shadow line at its top edge.
- Ornamental swirls (2): at `y1 = top + curlH + 0.12 * scrollH` and `y2 = bottom - curlH - 0.12 * scrollH`, width `0.5 * scrollW`. Stroke `#D4B896`, 2.5 px, round caps. Each is an S-curve with curl end pieces and a filled centre diamond. Curl size `halfW * 0.25`.
- Text: factoid string, `textSize = min(w, h) * 0.045` px, colour `#4A3728`, centred, `StaticLayout` with `ALIGN_CENTER`, line spacing extra `textSize * 0.3` (multiplier 1). Layout width `0.75 * scrollW`. Vertically centred between the two swirls (`textAreaTop = y1 + textSize`, `textAreaBottom = y2 - textSize`). Font family: default.

#### 2.7.6 Factoids (`res\values\factoids.xml`)
- Resource: `<string-array name="end_of_game_factoids">`. Structure:
```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string-array name="end_of_game_factoids">
        <item>Someone born when the Wright Brothers made the first recorded flight in 1903 would have been just 65 years old when man landed on the moon.</item>
        ...
    </string-array>
</resources>
```
- **Count: 251 items** (251 `<item>` elements; each element is on a single line, no nesting).
- Escapes: Android string escapes, for example `Scotland\'s` (apostrophe escaped with a backslash). 22 backslash escapes in the file in total. `&` does not appear. Port by unescaping `\'` to `'` and copying the rest verbatim.
- Index formula: `factoids[Math.abs(FactNumber) % 251]`. In JavaScript: `Math.abs(factNumber) % 251`. Note: Kotlin `Math.abs(Int.MIN_VALUE)` stays negative, which would throw. Not reachable with real data.
- `FactNumber` comes from the server message `ClientEndOfGameFactCommandMessage` (`action`, `time`, `FactNumber`, all fields listed in MSG). The debug path uses `FactNumber = (0..255).random()`.
- Also in the protocol: when the server sends `ServerRequestEndOfGameFactCount`, the app answers `ClientEndOfGameFactCount(FactCount = 63)` with a TODO comment in PC. The count sent (63) is not derived from the 251 factoids.

#### 2.7.7 Exits
- Continue button → NameEntry (or one back step).
- Holding-screen message → HoldingScreen.
- Reset (31) → no navigation; only enables Continue.

#### 2.7.8 Strings
- `continue_button`: "Continue"
- Factoid texts: from `end_of_game_factoids` (251 items, see above). No other English text on this screen.

---

### 2.8 Orphan code in the lobby (not reachable, documented so the port does not copy it by accident)

| Item | Status | Evidence |
|---|---|---|
| `PlayerAdapter` (`UI\PlayerAdapter.kt`) | Not instantiated anywhere | Referenced only in its own file |
| `item_player.xml` | Used only by `PlayerAdapter` | Shows avatar, name, host badge ("HOST", accent background `#FF5722`) |
| `models\Player.kt` | Used only by `PlayerAdapter` | Fields: `id`, `name`, `avatarUrl`, `avatarBitmap`, `isReady`, `isHost` |
| `AvatarSelectionFragment` | Unreachable | See 2.4 |
| `action_serverDiscovery_to_waitingRoom` | Declared, never invoked | `nav_graph.xml` |
| `PermissionHelper.requestCameraPermission` | Never called | CameraCapture calls `cameraPermissionLauncher.launch(...)` directly |
| `avatars.txt` (`java\com\game\protocol\`) | Not referenced by code | Lists 8 IDs: COUNTRY, ELECTRO, FASHION, FUTURE, GAMER, HIP_HOP, POPCORN, ROCKER |
| `NetworkManager.sendPlayerProfile(...)` | Defined, never called | Only `sendImageProfileImage` sends `ClientPlayerProfileMessage` |
| `NetworkManager.sendImage(...)` | Defined, not called by any fragment | Used only inside `sendImageProfileImage` |
| `NetworkManager.gameState`, `connectionError`, `discoveredConsoles` | Written, not read by any UI | |
| `GameState` enum values `LOBBY`, `GET_READY`, `PLAYING`, `WAITING`, `GAME_OVER` | Never referenced in the source | Only `DISCONNECTED`, `CONNECTING`, `CONNECTED` are assigned (NM) |
| `PlayerJoinedMessage`, `PlayerLeftMessage`, `PlayerNameQuizStateMessage` | Decoded, not handled | Logged as unhandled |
| `ClientQuizCommandMessage` actions `ACTION_EXIT` (15), `ACTION_PAUSED` (29), `ACTION_UNPAUSED` (30) | Declared, not handled in any UI | |
| `isRejoining` | Written, never read | |
| `PHOTO_FILENAME` / `avatar_photo.jpg` | Read only (by AvatarSelection), never written | |

Unused string resources (no reference in any `.kt` or layout XML under `src\main`): `enter_ip_address`, `use_camera`, `camera_permission_required`, `capture_photo`, `use_this_photo`, `waiting_room_title`, `players_joined`, `start_game`, `waiting_for_players`, `you`, `game_starting`, `question_placeholder`, `answer_a`, `answer_b`, `answer_c`, `answer_d`, `error_connection`, `error_server_unreachable`, `cancel`, `ok`.

Other string use notes:
- `choose_avatar`, `host`, `avatar_selection_title`, `select_avatar_type`: used only by orphan layouts or AvatarSelection.
- `app_name` "Reverse of Power": used by the manifest label.
- `values-ru\strings.xml` exists and has the same number of string entries (114) as `values\strings.xml`. I did not compare key names one by one. The app declares `locales_config` with `en` and `ru`. The device locale selects the Russian strings. This spec quotes the default (English) values only.

---

## 3. Outgoing messages: complete catalogue (lobby)

Transport: UDP to `<console IP>:9066` (sent from an ephemeral local socket). Every message is a `GameMessage` subclass serialised to JSON (PE `encodeJson`) and framed (1.2). The JSON below is **derived** (see the conventions at the top).

| # | When | Call site | Message / bytes | Fields and values |
|---|---|---|---|---|
| 1 | Connect, every 1000 ms until `ConnectionInit` | PC `connect` loop → `sendConnectionRequest()` | Raw 38 bytes | `8A 33`, int32 LE `-1`, 32 zero bytes |
| 2 | Connect, every 1000 ms until `ConnectionInit` | PC `connect` loop → `sendDeviceUID(uid, false)` and `(uid, true)` | Raw UID packet | Magic UID (KIP or Decades), `0x63`, int32 LE length, UID UTF-8 |
| 3 | Every 1000 ms after any inbound message | PC `connect` loop → `sendAck(lastRcvMessageId)` | Raw 38 bytes | `8A 33`, int32 LE messageId, 32 zero bytes |
| 4 | After `SessionStateMessage` | PC `handleProtocolMessage` | `ClientRequestPlayerIDMessage` | `UID = deviceUID` |
| 5 | After `AssignPlayerIDAndSlotMessage` | PC | `DeviceInfoMessage` | `Response = 10`, `DeviceSize = 2`, `DeviceOS = 1`, `DeviceModel = "<Build.MANUFACTURER> <Build.MODEL>"`, `DeviceType = "Handheld"`, `DeviceUID = deviceUID`, `DeviceOperatingSystem = "Android OS <Build.VERSION.RELEASE> / API-<SDK_INT> (<Build.ID>)"` |
| 6 | After `AssignPlayerIDAndSlotMessage` | PC | `ClientRequestAvatarStatusMessage` | no fields |
| 7 | On `ServerRequestEndOfGameFactCount` | PC | `ClientEndOfGameFactCount` | `FactCount = 63` |
| 8 | Avatar tapped, previous avatar differs | NM `requestAvatar` | `ClientRequestAvatarMessage` | `RequestID` (new UUID), `AvatarID = previous`, `Request = false` |
| 9 | Avatar tapped | NM `requestAvatar` | `ClientRequestAvatarMessage` | `RequestID` (new UUID), `AvatarID = new`, `Request = true` |
| 10 | Continue on CameraCapture (step 1 of 3) | NM `sendImageProfileImage` → PC `sendImage` | Control `ClientImageResourceContentTransferMessage` + binary image | `TransferID = 2`, `ImageGUID = <uuid v4>`, `ImgType = 2`; JPEG 512×512 q85 |
| 11 | Continue on CameraCapture (step 2 of 3) | NM | `ClientPlayerProfileMessage` | `playerName`, `uppercasePlayerName`, `deviceCultureName = "en-US"`, `playerCardId = AvatarID` |
| 12 | Continue on CameraCapture (step 3 of 3) | NM → PC `sendImage` | Control + binary image | `TransferID = 3`, same `ImageGUID`, `ImgType = 2`, same bytes |
| 13 | Hold-to-start filled (2.0 s) | WaitingRoom → NM `sendStartGameButtonPressed` | `StartGameButtonPressedResponseMessage` | `Response = 9` (default) |
| 14 | Continue button tapped on ContinueFragment | NM `sendContinueButtonPressed` | `ContinuePressedResponseMessage` | `Response = 3` (default) |

Derived JSON examples:

```json
{"TypeString":"ClientRequestPlayerIDMessage","UID":"<32 hex chars>"}
```
```json
{"TypeString":"DeviceInfoMessage","Response":10,"DeviceSize":2,"DeviceOS":1,"DeviceModel":"<manufacturer> <model>","DeviceType":"Handheld","DeviceUID":"<32 hex chars>","DeviceOperatingSystem":"Android OS <release> / API-<sdk> (<build id>)"}
```
```json
{"TypeString":"KnowledgeIsPower.ClientRequestAvatarStatusMessage"}
```
```json
{"TypeString":"KnowledgeIsPower.ClientEndOfGameFactCount","FactCount":63}
```
```json
{"TypeString":"KnowledgeIsPower.ClientRequestAvatarMessage","RequestID":"<uuid v4>","AvatarID":"COWGIRL","Request":true}
```
```json
{"TypeString":"ClientImageResourceContentTransferMessage","TransferID":2,"ImageGUID":"<uuid v4>","ImgType":2}
```
```json
{"TypeString":"ClientPlayerProfileMessage","playerName":"Anna","uppercasePlayerName":"ANNA","deviceCultureName":"en-US","playerCardId":"COWGIRL"}
```
```json
{"TypeString":"StartGameButtonPressedResponseMessage","Response":9}
```
```json
{"TypeString":"ContinuePressedResponseMessage","Response":3}
```

Note on TypeString: the kotlinx serialization default for each class is its `TypeString` default value, so the JSON carries the exact strings above (some with the `KnowledgeIsPower.` prefix, some without). Those strings are what the server's decoder dispatches on.

Framed JSON packet (PE `encodeMessage`):
```kotlin
fun encodeMessage(msg: GameMessage): List<ByteArray> {
    val jsonBytes = encodeJson(msg)
    val body = ByteBuffer.allocate(jsonBytes.size + 10).order(ByteOrder.LITTLE_ENDIAN)
    body.put(bodyMagic)
    body.put(TYPE_JSON)
    body.putInt(jsonBytes.size)
    body.put(jsonBytes)
    return wrapAndChunk(body.array())
}
```

Chunking and header (PE `wrapAndChunk`, `buildPacket`):
```kotlin
val fragmentSize = 1002  // Max payload per chunk (1024 total - 22 byte header)
val totalFragments = (payload.size + fragmentSize - 1) / fragmentSize
val messageId = ++messageCounter
// per fragment i:
packets.add(buildPacket(fragment, totalFragments, i, messageId, byteOffset))
// buildPacket: packetMagic, putInt(messageId), putInt(packetNum), putInt(packetIdx),
//              putInt(payload.size), putInt(byteOffset), payload
```

Sends not made from the lobby: `AllResourcesReceivedMessage` and `RequestResourceMessage` (protocol, triggered by server resource lists, not lobby UI); `ClientTriviaAnswer`, `ClientCategorySelectChoice`, and other gameplay messages (other screens).

---

## 4. Factoids summary

- Source: `res\values\factoids.xml`, `<string-array name="end_of_game_factoids">`.
- Items: **251**.
- Used by: EndOfGameFactFragment only (`resources.getStringArray(R.array.end_of_game_factoids)`).
- Index: `Math.abs(FactNumber) % 251`.
- `FactNumber`: from the server's `ClientEndOfGameFactCommandMessage`. It is an Int of any value; the `Math.abs(...) % 251` step keeps the index in range.
- Factoid text is shown only after the scroll is opened (closed state draws no text).
- Escapes: `\'` for apostrophes (22 backslash sequences in total, all in the factoid text).
- `ClientEndOfGameFactCount.FactCount` sent to the server is the constant 63 (PC line 290), not the number of factoids.

---

## 5. Strings used on lobby screens (quoted from `res\values\strings.xml`, English defaults)

| Screen | Key | Text | Where |
|---|---|---|---|
| ServerDiscovery | `server_discovery_title` | Find Game Server | Title |
| ServerDiscovery | `debug` | Debug | Debug button (DEBUG) |
| ServerDiscovery | `discovered_servers` | Discovered Servers | Header label |
| ServerDiscovery | `rescan` | Rescan | Button |
| ServerDiscovery | `scanning` | Scanning for servers… | Scanning label (initial) |
| ServerDiscovery | `no_servers_found` | No servers found | Empty text |
| ServerDiscovery | `manual_ip_address` | Manual IP Address | Toggle |
| ServerDiscovery | `ip_address_hint` | 192.168.1.100 | Edit hint |
| ServerDiscovery | `connect_button` | Connect | Button |
| ServerDiscovery | `enter_ip_prompt` | Please enter an IP address | Toast |
| ServerDiscovery | `scan_failed` | Scan failed: %1$s | Toast |
| ServerDiscovery | `connecting_to_server` | Connecting to server... | Scanning label (connect) |
| ServerDiscovery | `failed_to_connect` | Failed to connect to %1$s | Toast |
| ServerDiscovery | `connection_error_detail` | Connection error: %1$s | Toast |
| ServerDiscovery | `cd_expand` | Expand | Content description |
| NameEntry | `enter_name_title` | What's your name? | Title |
| NameEntry | `name_hint` | Enter your name | Edit hint |
| NameEntry | `continue_button` | Continue | Button |
| NameEntry | `name_required` | Please enter your name | Toast |
| NameEntry | `name_too_short` | Name must be at least 2 characters | Toast |
| NameEntry | `default_player_name` | Player | DEBUG prefill |
| CameraCapture | `select_avatar` | Select Avatar | Panel title |
| CameraCapture | `waiting_for_avatars` | Waiting for avatars... | Empty list |
| CameraCapture | `take_photo` | Take Photo | Button label |
| CameraCapture | `continue_button` | Continue | Button label |
| CameraCapture | `retake_photo` | Retake | Button |
| CameraCapture | `take_photo_first` | Take a photo first | Toast |
| CameraCapture | `pick_avatar_first` | Pick an avatar first | Toast |
| CameraCapture | `photo_capture_failed` | Photo capture failed: %1$s | Toast |
| CameraCapture | `avatar_unavailable` | Avatar unavailable | Toast |
| CameraCapture | `avatar_selected` | Selected | Row status |
| CameraCapture | `avatar_available` | Available | Row status |
| CameraCapture | `avatar_taken` | Taken | Row status |
| CameraCapture | `cd_captured_photo` | Captured photo | Content description |
| CameraCapture | `cd_avatar_icon` | Avatar icon | Content description |
| WaitingRoom | `waiting_for_other_players` | Waiting for other players... | Waiting label |
| WaitingRoom | `hold_to_start` | Hold to Start! | Ready title |
| WaitingRoom | `hold_to_start_hint` | Press and hold until the lights fill up | Ready hint |
| WaitingRoom | `start_caps` | START | Drawn on the circle |
| ContinueFragment | `continue_caps` | CONTINUE | Button |
| EndOfGame | `continue_button` | Continue | Button |

Not used on lobby screens (defined, referenced elsewhere or not at all): see 2.8.

---

## 6. Not found (searched, no match in the source)

- Saved profile (name, avatar, photo) on the phone: **not found** (only `device_uid` is persisted).
- Use of the cached photo file: **written nowhere**; read only by the unreachable AvatarSelection screen.
- Name character whitelist or profanity filter: **not found** (only length limits).
- IP address format validation on manual entry: **not found** (only non-empty after trim).
- Outgoing message retransmission or acknowledgement of game messages: **not found** (only the handshake loop and ACKs for inbound messages).
- Handling of `ClientHoldingScreenCommandMessage` on NameEntry and CameraCapture: **not found** (no listener, message dropped).
- Buffering of `ClientQuizCommandMessage` ACTION_READY before WaitingRoom is shown: **not found** (no pending slot).
- Image rotation, mirroring, or aspect-ratio-preserving crop for the captured photo: **not found**.
- Capture resolution settings for CameraX: **not found** (defaults used).
- Haptic feedback, sound, vibration, system dialogs, snackbars, or confirmation prompts on lobby screens: **not found**.
- Fonts, font files, or custom typefaces: **not found**.
- Animations on ServerDiscovery and CameraCapture and WaitingRoom (beyond the CircularStartButton progress and fade-in for the EndOfGame scroll): **not found**.
- Player list or player count on WaitingRoom: **not found** (the `PlayerAdapter` exists but is not used).
- Use of `ServerAvatarStatusMessage` to clear the local selection when an avatar becomes unavailable: **not found**.
- Reset of avatar state (`selectedAvatarId`, `isAvatarConfirmed`, `availableAvatars`) on reset-to-name: **not found**.
- Timeout after a successful connect in ServerDiscovery: **not found**.
- Handling of `ACTION_EXIT` (15), `ACTION_PAUSED` (29), `ACTION_UNPAUSED` (30) in the lobby: **not found**.
- Culture other than `en-US` sent in the profile: **not found** (always `en-US`).

---

## 7. Factual quirks to keep or fix in the port (decide per item)

1. Rescan after a failed connect shows the "Connecting to server..." label (2.1.3).
2. A successful connect has no timeout on ServerDiscovery; the spinner can stay until the server sends a reset, a holding-screen message or a rejoin (2.1.4).
3. The sent photo is stretched to 512×512 without crop (2.3.6). The on-screen preview is cropped (`fillCenter`).
4. Continue on CameraCapture shows "Continue" at 0.65 alpha before the camera binds, and tapping then shows "Take a photo first" (2.3.5).
5. Hold-to-start can send `StartGameButtonPressedResponseMessage` repeatedly; the button is never disabled after sending (2.5.3).
6. ContinueFragment's Continue button does not navigate; it sends and disables itself, and leaves when the server sends the next holding-screen message (2.6.3).
7. The EndOfGame screen does not leave on a server reset; it only enables the Continue button (2.7.3).
8. `connectToServer` does not close a previous `GameProtocolClient` (2.1.5).
9. Avatar selection and `isAvatarConfirmed` survive a reset to name in NM (2.3.9).
10. The factoid count is 251 but the server-facing `FactCount` is a hard-coded 63 (2.7.6).
11. `CameraCapture` XML comment says 65/35 split but the guideline is 0.55 (2.3.2).
12. `ServerDiscovery` spacer uses `layout_weight` inside a `wrap_content` parent, so it has no effect (2.1.2).
13. The `ServerDiscovery` header row container stays visible when the header label and Rescan button are hidden during connect, which leaves an empty row (2.1.4).
