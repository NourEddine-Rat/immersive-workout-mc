# InMotion / Pocket Arcade

Open the carousel on a PC and use a phone as its motion controller. All four games and shared training use the same direct WebRTC transport. Motion, controls and game data stay between the phone and PC on the local network, including when the site is hosted on Heroku. Heroku handles only pairing and WebRTC setup. No STUN, TURN, or motion relay is configured.

## Play

1. Double-click `start.command`, or run `python3 serve.py` from this folder. Keep that server running.
2. Open `http://localhost:8000/` on the PC. After the carousel scene, entrance animation and top widgets finish appearing, the glass entry panel shows its QR, six-digit code and phone link. It unlocks the carousel as soon as the phone has a verified direct connection; motion can be enabled afterward. Training and game connection cards also show pairing details.
3. Keep the phone and PC on the same Wi-Fi. Scan the QR with the phone camera. The secure phone address is also printed in the server terminal. Opening the front page on a phone sends it to the controller.
4. Tap **Enable motion**, allow the browser permission, and choose a game on the phone. Complete the short movement training the first time. Put the unlocked phone in your right front pocket, screen toward your leg, top pointing down.
5. The phone shows the PC's current instructions and buttons. Use **Start game** or jump to start. A simple game list appears if the phone cannot load the 3D picker. **Games** returns both devices to the carousel. **Pocket mode** prevents accidental touches; hold two fingers for one second to unlock it.

The PC can also use the LAN address printed in the terminal. The phone needs the HTTPS address for sensors and camera access. A static file server cannot provide the pairing/signaling service. Guest Wi-Fi/client isolation can block devices from reaching one another.

The local server obtains the public local-ip.sh wildcard certificate to enable browser sensors without installing a certificate. The network must resolve local-ip.sh. If certificate retrieval fails, the terminal reports that phone sensing is unavailable; fix that before playing. For the hosted beta, deploy the parent folder to one Heroku web dyno. See [DEPLOY.md](../DEPLOY.md) for exact setup and recovery behavior. Hosted phone/TV links follow the actual domain and do not depend on local-ip.sh.

Games play without sound. The Red Light and Jump Rope launch notices show the supplied Squid Game and Siren logos with their own credits. Track & Field opens directly (or goes to first-time training).

The TV dock explains TV-browser setup and HDMI, with an explicit beta compatibility notice. Its link keeps Android TV browsers on the desktop screen. The phone shows a loading screen while its modules and styles initialize, with Retry on a failed download.

## Recovery and storage

- A phone is connected only after its code is accepted and both browsers verify the direct local route. Unpaired phones cannot send motion or commands or receive session history. One phone owns each screen’s controller slot at a time. Different PC browsers have isolated rooms, so separate testers cannot control each other’s games.
- PC pages in the same browser share a screen cookie; the newest page is active and old pages do not control the phone. Pairing and profile information follow PC navigation automatically.
- A Wi-Fi interruption reconnects automatically. The phone has a short reconnect reservation; **Change screen** releases it immediately. Reloading the same phone or opening a second tab replaces its old connection. The old tab stops sensing and explains how to continue.
- Restarting the server changes the codes. The PC reconnects and shows its new code; the phone returns to code entry. Closing the PC preserves pairing while the room is retained. Rooms with no connected sockets expire after 30 minutes.
- Stopping motion, locking the phone or backgrounding its page pauses active games when samples stop. Return to the phone page and, if requested, enable motion again. Buffered, old movement is not replayed after a network stall.
- Browser permissions are requested with a tap; a saved preference never substitutes for permission. Camera denial has a code-entry alternative. Missing/denied motion displays recovery instructions.
- Screen Wake Lock is requested while sensing, with a silent-video fallback. Browser and operating-system power policies can still suspend a page; keep the phone unlocked and verify it stays awake on your device.
- Profile, preferences, pairing, calibration and dated activity stay in localStorage. Calibration belongs to the player and also syncs to the phone. Profiles remain separate when sharing a PC. Browser/origin changes or clearing site data do not transfer localStorage automatically.
- The PC sends activity every two seconds during play and when a game completes. Session IDs deduplicate repeat/reconnect snapshots. Incomplete sessions retain activity without counting as completed games. History is sent in chunks, and writes merge saved sessions from other tabs.
- If storage is full or blocked, the phone can continue in memory and displays a warning that changes may not survive a reload. Calories use profile weight, or 70 kg until supplied. Distances are game estimates, not GPS measurements.
- The phone's developer design lab is removed from normal startup. Online leaderboards require a shared account/history service and are not provided by local browser storage; real personal results appear under Detailed Stats → Games.

## Layout

- `index.html`, `carousel/`: PC carousel and remote game picker.
- `phone.html`, `phone.js`, `phone/`: phone UI, permissions, sensors and recovery.
- `serve.py`: static files, LAN/Heroku entry, isolated screen sessions, `/where`, `/pair`, `/ws` and `/health`.
- `engine/direct-link.js`, `engine/lib/local-route.js`: direct channels, route verification, reconnect and no-cloud-fallback policy.
- `engine/host-bridge.js`: active PC state, safe remote actions and activity synchronization.
- `engine/motion-controller.js`: motion stream, clock sync and detectors used by games/training.
- `engine/profile.js`, `engine/activity-store.js`: calibration and dated session storage.
- `training/`: shared movement calibration.
- `games/subway/`, `games/squid/{red-light,jump-rope,track}/`: games.

PC game developer tools remain available for design work. Developer previews do not record activity.

## Checks

Node 22+ and Python 3 are required for the unit and signaling tests:

```sh
npm test
```

Browser integration tests run real PC/phone pages and real direct WebRTC connections, with synthetic motion events:

```sh
npm install
npm run test:browser
npx playwright install webkit
npm run test:webkit
```

They use installed Google Chrome by default (`ARCADE_BROWSER` can select another installed Playwright browser channel). Hardware-specific permission prompts, actual pocket movement, and screen-lock behavior must also be checked on Safari/iPhone and Android. Browser simulation does not validate physical sensor accuracy.

See [DIRECT-CONNECTION.md](../DIRECT-CONNECTION.md) for the network guarantees, browser limitations, and physical-device beta checks.
