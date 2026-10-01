# InMotion beta on Heroku

Deploy **this folder**, which contains `Procfile`, `requirements.txt`, `.python-version`, `app.json`, and the `arcade/` directory. The root Procfile starts `python -u arcade/serve.py`. There is no database, Node build step, or paid add-on dependency.

## Deploy

With the Heroku CLI installed and signed in:

```sh
# From the folder containing this file:
# If this download is not yet a Git repository:
git init
git add .
git commit -m "Prepare InMotion beta"

# Choose your own available app name:
heroku create YOUR-APP-NAME
heroku buildpacks:set heroku/python --app YOUR-APP-NAME
git push heroku HEAD:main
heroku ps:scale web=1 --app YOUR-APP-NAME
heroku open --app YOUR-APP-NAME
```

Alternatively, connect this repository through the Heroku dashboard and deploy its branch with the Python buildpack. `app.json` provides a single Basic web dyno configuration for app setup. Heroku dynos are paid resources; select the tier in your account. An always-on Basic dyno avoids the first visitor waiting for a sleeping app.

Do not set `PORT` yourself: Heroku provides it. The server binds `0.0.0.0:$PORT`, uses Heroku's HTTPS termination, redirects HTTP visitors to HTTPS, handles WebSocket upgrades, and shuts down on SIGTERM. It does not fetch or serve LAN certificates in this mode. `/health` returns `{"ok":true}` for a health check.

## Share and play

Share `https://YOUR-APP-NAME.herokuapp.com/` with beta testers. Open it on the PC, then scan the QR with the phone. The phone can also open `/phone.html` and enter the six-digit code shown on that PC. Links are generated from the actual request domain, so app names and domains are not hardcoded. Both devices must share a reachable local network, even when opening the hosted site. Internet access loads the site and exchanges pairing/WebRTC setup messages; motion and gameplay travel directly between the browsers over local WebRTC data channels. There is no cloud-motion or TURN fallback. See [DIRECT-CONNECTION.md](DIRECT-CONNECTION.md) for route checks and supported network conditions.

The glass entry panel closes as soon as the phone has a **verified direct local connection**. You can browse the carousel before enabling motion. On the phone, tap **Enable motion** before playing and allow access. Keep the phone unlocked. The first game offers movement training. Missing motion pauses gameplay; a lost direct connection shows the carousel pairing panel again.

For a custom domain, configure it and its TLS certificate in Heroku. Optionally set `PUBLIC_URL=https://play.example.com` (HTTPS origin only, no path). Without this setting, the domain used to open the app determines the phone and TV links.

The TV button shows a link with `?desktop=1`, so Android-based TV browsers stay on the game screen. It also offers HDMI instructions and explains that TV support is a beta preview. Phones must still open the controller link, not the TV link.

## One process, one web dyno

**Keep `web=1`. Do not add multiple web dynos or worker processes.** Independent tester pairs are isolated in separate in-memory rooms inside this process. Each PC browser receives an opaque HttpOnly screen cookie; its QR/code joins only its room. Tabs in the same browser share that screen, with the most recently opened PC page active. Unpaired phones cannot send controls or read a player's history. Idle rooms expire after 30 minutes without connected sockets.

No database means that deploying, restarting, or recycling the dyno clears active rooms and changes their codes. The PC reconnects and shows a fresh code. The phone explains that the old code expired; scan the new QR. A game interrupted by this can use **Reconnect phone** to return to the carousel. Profiles, calibration and completed activity already saved in browser localStorage remain on those browsers. Activity sent to the phone also remains there. This is not cloud backup: clearing site data or changing browser/domain can lose local history.

Heroku WebSockets are kept alive by regular heartbeat traffic. A network interruption can still happen, and mobile operating systems may suspend background pages. Use Safari or Chrome directly rather than a social app's embedded browser. Hardware motion accuracy and power-management behavior need a real iPhone/Android check before broad release.

## Local network play

Use `arcade/start.command` or `python3 arcade/serve.py` without `PORT` set. Open `http://localhost:8000/` on the PC. Scan its generated **HTTPS** phone QR; it points to the PC's LAN address through local-ip.sh. Both devices must be on the same Wi-Fi, with client isolation disabled and the server ports reachable. The local certificate needs periodic renewal and DNS access to local-ip.sh. The terminal and entry panel explain certificate failures. The hosted version uses Heroku HTTPS instead and has no local-ip.sh dependency.

A static hosting service cannot replace this server: the pairing and WebRTC signaling service is required.

## Validate and troubleshoot

```sh
cd arcade
npm install
npm test
npm run test:browser
npx playwright install webkit
npm run test:webkit
```

The browser tests use installed Google Chrome and synthetic motion events. They cover all four games, phone permissions, pause/resume, loader retry, carousel gating, and recovery after a real server restart. The separate WebKit test checks a WebKit phone against Chrome through reconnect and PC navigation. Signaling tests cover room isolation, refusal of gameplay payloads, hosted URLs, protected files and Heroku process startup/shutdown. Direct-connection tests check route restrictions, unreliable motion delivery, reconnect and continued motion after the signaling server stops. They do not establish capacity limits or physical sensor accuracy. See [TEST-REPORT.md](TEST-REPORT.md).

To check a deployed app:

```sh
heroku ps --app YOUR-APP-NAME
heroku logs --tail --app YOUR-APP-NAME
curl https://YOUR-APP-NAME.herokuapp.com/health
```

If pairing fails, check that both devices use the same app/domain, cookies are allowed on the PC, and only one web dyno is running. Use the currently displayed code. If motion is denied, allow Motion & Orientation in the phone browser settings and tap Enable again. If a PC or TV cannot render WebGL, use a current desktop browser with hardware acceleration or connect that PC to the TV by HDMI.

The slug excludes local certificates, logs, node_modules, tests, and the unused design folders. The server blocks private file paths and directory listings. Automatic diagnostic uploads are removed; gameplay data stays between the browsers. No database credentials or application secrets are required.
