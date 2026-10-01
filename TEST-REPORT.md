# Beta verification — 1 October 2026

The connection now uses encrypted WebRTC data channels directly between the phone and PC. The hosted server provides files, pairing and signaling. It does not relay motion, controls, profiles, calibration or game history. No STUN/TURN service or WebSocket gameplay fallback is configured. Play requires a verified local route and fresh motion.

## Map loading, training and production controls

Validation: **91 unit/signaling/hosting checks, 35 browser scenarios, and one additional Chrome/WebKit scenario passed.** The complete browser suite passed all 34 scenarios then present. After the final training graphics-failure guard, five focused training/production scenarios passed, including the new 35th scenario. The diagnostic schema's additional asset-event assertions also passed separately. Tests ran locally; the live website was not opened or interacted with.

- All four actual maps load and render before being revealed. All 13 packaged models, their buffers, textures, exact filename case and Meshopt data pass integrity checks. A transient Red Light HTTP 503 recovers automatically; missing required files and corrupt textures stop startup with Retry.
- Shared glass loading screens report measured bytes, use an indeterminate bar when the total is unknown, distinguish downloading from graphics preparation, and keep unfinished content inert. Desktop and narrow screenshots were reviewed. Module-download failure, keyboard-accessible recovery and graphics loss during the ready transition are covered.
- Required training room, coach, hands and guides finish loading before calibration can begin. An interrupted guide retries; a missing coach blocks with recovery. Local pairing remains active during loading, with no premature remote actions or unsolicited microphone requests.
- Production origins ignore developer and cheat queries on every map. Developer controls and keyboard bypasses are absent. Local preview mode requires explicit opt-in on loopback.
- A real local WebRTC pair completes game selection → training → save → the intended game without another scan. The test substitutes repetition timing at the profiling boundary; motion events, warm-up, calibration fitting, storage, user identity and transport remain real. Storage failure stays on the result screen until saving succeeds; ISO-dated phone calibration can restore on the PC.
- A separate race regression holds the phone's selection update while delivering an older PC echo. Immediate Play still opens the chosen game, and PC-driven selection continues to synchronize.
- Graphics failure stops game simulation and training behind the error screen instead of allowing hidden play or results. Pending training transitions, calibration callbacks and a startup that finishes after failure cannot resume the routine.

The retained Heroku log window contained no Red Light download request, so it does not establish the exact cause of the reported incident. Code inspection found unbounded downloads, absent GLB progress, unawaited assets and swallowed required-asset failures; these paths now have bounded retries, validation and actionable errors. New sanitized asset failure categories enter the existing connection timeline, while detailed exceptions remain in the browser's downloaded report.

Actual iPhone/PC hardware, the user's Wi-Fi and live map behavior still require the user's check after reloading both devices. Synthetic tests do not guarantee every browser, router or graphics driver.

## Microphone fallback and connection recovery

Current local validation: **65 unit/signaling/hosting checks, 22 browser integration scenarios, and one additional Chrome/WebKit scenario passed.** The complete browser run passed 21 scenarios and exposed an older server-restart expectation; after updating that scenario for intentional connection preservation, its focused rerun passed. No application change was needed for that test correction.

The added checks cover:

- An explicit PC microphone action restores a real Chrome-to-WebKit UDP connection with mDNS candidates deliberately unavailable and no manual IP hint. Every simulated microphone track ends before retry; peer connections have no media senders or audio/video SDP sections.
- No microphone request occurs automatically, on the phone, during ordinary reconnect, or during navigation through training and game pages. Denial remains actionable. Late permission cannot replace a connection that already recovered.
- A transient interruption triggers native ICE restart while retaining both existing peer connections and data channels, followed by verified local traffic and synthetic motion.
- An actual Python signaling process restart clears server rooms but preserves ongoing local motion. A later hard failure or PC reload requires a fresh QR and retains the phone's identity.
- Repeated phone Retry sends one restart without duplicate pairing joins. Stale credentials, candidates, descriptions, statistics and proofs do not validate replacement attempts.
- Public/relay routes remain blocked; ICE server configuration remains empty; the server refuses gameplay payloads.

Desktop and narrow fallback screenshots were inspected. These tests use simulated microphone hardware and synthetic motion on one Mac. Real iPhone Safari/Chrome, microphone permission behavior, router conditions and Android still require device validation by the user. The live website was not opened or interacted with during this change.

The records below describe earlier beta verification and retain their original counts.

## Competition filename cleanup

Standardized 89 asset/module paths and moved 13 older root-level prototype files into `archive/prototype/`. Model buffers, textures, imports, icons, styles and generated carousel background paths were updated together. Public game routes and saved game identifiers remain stable. Third-party library filenames and attribution files are preserved.

Verification: 21 unit/hosting tests, all 8 browser integration scenarios and the WebKit scenario pass. The all-games browser check now rejects missing asset responses. All 34 external glTF resource references resolve, all 69 application JavaScript files pass syntax checks, and the model data is unchanged apart from resource paths. The deployment smoke check fetched 218 runtime files successfully. A handled WebKit channel-close error found during reconnect testing is now prevented from surfacing as an unhandled page error; direct reconnect and no-cloud-fallback checks pass.

## Latest interface update

Three targeted browser integration tests passed after the silent-game and pairing changes. They exercise all four games and assert zero audio-context creation, speech playback or unmuted media playback; motion-loss pause/resume remains working. They also confirm the carousel unlocks before motion is enabled, stays available when motion stops, and still waits for the finished entrance before showing the QR panel.

A separate browser review checked both supplied logos in Red Light and Jump Rope, their game-specific credit text, restoration of Subway credits, and Track & Field skipping the notice. Desktop and narrow-screen captures confirm the pairing panel has no decorative icons or status dot. No page errors were observed.

The earlier complete connection verification is recorded below. These UI changes do not alter the WebRTC transport or server protocol.

## Passed

| Check | Result |
| --- | --- |
| `npm test` | 21 unit, storage, signaling and hosting tests passed. |
| `npm run test:browser` | 8 browser integration tests passed with real Chrome pages and WebRTC connections. |
| `npm run test:webkit` | 1 cross-browser test passed: WebKit phone to Chrome PC, synthetic motion, channel loss/reconnect and PC navigation to training. |
| Actual local HTTPS QR | Decoded the displayed QR image, opened its matching `local-ip.sh` HTTPS URL, connected, sent synthetic motion and unlocked the carousel. No page errors. Certificate validation remained enabled. |
| Clean upload folder | Started with Heroku-style `PORT`, checked health and dynamic hosted links, fetched 217 runtime files, checked protected paths and clean SIGTERM shutdown. |

The browser checks cover all four game pages, phone actions, pause/resume, history and identity after reload, permission/storage failures, competing phones, loading retry, expired codes, server restart, and QR generation. The pairing modal waits until the carousel entrance and widgets finish before appearing.

The transport checks verify an empty `iceServers` list, host UDP routes, one motion sample per packet, unordered motion with zero retransmissions, and local candidate matching when browser statistics hide addresses. Simulated relay statistics block play and send zero motion packets. Captured WebSocket messages contain setup/heartbeat traffic only, with no gameplay payloads or diagnostic POST uploads.

In the server-outage test, the Python signaling server is terminated after pairing. Fresh motion continues for five seconds, with more than 80 additional packets received and the PC remaining ready. A separate reconnect test closes the direct connection and checks that the game blocks until the local link recovers.

## Performance observations

The previous six-sample application batch is removed. Samples leave the phone immediately; motion uses an unordered channel without retransmissions, with a bounded send buffer. Game input rejects duplicate/out-of-order timestamps and stale samples after clock synchronization.

Same-machine browser runs observed median sample age between approximately 0 and 0.7 ms, with 95th-percentile values from 0.5 to 49.9 ms as machine/browser load varied. These are synthetic test measurements on one Mac, **not physical Wi-Fi latency, sensor-to-display latency, or a performance guarantee**. Sensor scheduling, browser load, radio conditions and rendering still take time.

## Still to verify on real hardware and hosting

1. Keep the deployed Heroku app on exactly one web dyno. After a release, reload both devices and scan its fresh HTTPS QR to validate actual hardware behavior.
2. Test an actual iPhone in Safari and Android phone in Chrome. Allow Motion; if local pairing stalls, test the explicit PC microphone fallback. Calibrate and play each game with the phone in the intended pocket position. An absent native Local Network prompt is not proof of denial.
3. Test phone lock/unlock, background/return, denied permissions and Wi-Fi changes. Mobile OS power policies and actual motion detection cannot be validated by synthetic desktop events.
4. Try two independent player pairs and the expected number of simultaneous beta users on the chosen dyno. Room isolation is tested; capacity has not been load-tested.
5. Confirm guest Wi-Fi/device isolation produces the blocked/retry instructions. Use a normal shared LAN with VPNs disabled. Browsers cannot inspect SSIDs or prove the underlying physical path of an undisclosed VPN; see [DIRECT-CONNECTION.md](DIRECT-CONNECTION.md).

The folder is prepared for a beta deployment. No application can guarantee zero delay or work on every Wi-Fi/router/browser combination. This implementation keeps the local-connection requirement: an unavailable or unverifiable route blocks play instead of sending motion through Heroku.
