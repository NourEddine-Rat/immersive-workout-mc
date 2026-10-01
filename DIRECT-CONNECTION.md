# Direct local play

The hosted website loads from Heroku, but motion and gameplay messages do not travel through Heroku. Both devices must be on the same reachable local network. A PC on Ethernet and a phone on the same router's Wi-Fi can also connect.

## Connection path

1. The PC gets a private screen session and six-digit pairing code over HTTPS.
2. The phone joins that session. The signaling WebSocket exchanges WebRTC offers, answers, and local ICE candidates.
3. Each browser independently checks the selected candidate pair. Only UDP with private, link-local, loopback or local mDNS endpoints is accepted. Public/server-reflexive and TURN relay routes are rejected. When browsers hide addresses in statistics, the exact selected candidate must match the foundation and port of a permitted candidate from this negotiation. Unknown routes remain blocked.
4. Both peers confirm that check over the encrypted data channel. The carousel unlocks after this confirmation. Gameplay additionally waits for fresh motion samples; stopping motion does not reopen the carousel pairing modal.
5. Motion is sent immediately, one sample per unordered packet with zero retransmissions. Late/lost packets are dropped. Buttons, profile, calibration, game state and activity use the separate reliable channel on the same direct connection.

`iceServers` is empty: no STUN or TURN service is configured. There is no WebSocket fallback for motion or gameplay. The server accepts only screen registration, pairing/release, heartbeats, and validated WebRTC setup messages. It rejects gameplay payloads. Bounded connection metadata is collected for troubleshooting; motion, profile data and screenshots are never uploaded. See [CONNECTION-DIAGNOSTICS.md](CONNECTION-DIAGNOSTICS.md).

`engine/direct-link.js` owns the shared connection. `engine/lib/local-route.js` enforces route validation. `engine/host-bridge.js` distributes direct messages to the carousel, training, and game sensor engine. `phone.js` sends fresh motion through this connection. Each game page rebuilds its connection automatically when the PC navigates.

## Microphone permission fallback

Pairing starts automatically without requesting a microphone. If local discovery stalls, the PC opens **Connection help** and offers **Allow microphone & retry**. After an explicit click, `getUserMedia({audio:true,video:false})` requests microphone access. Every returned track is immediately stopped before retrying WebRTC. No audio track is attached to the connection, recorded or transmitted. Pending requests are cancelled logically when pairing completes, ownership changes or the page exits; any late stream is still stopped without restarting a healthy connection.

On tested desktop Chrome, microphone permission exposes numeric local ICE addresses and can recover a connection when mDNS discovery is unavailable. This is a real microphone permission, not a Local Network prompt. It needs a supported browser and microphone hardware, and does not override Wi-Fi isolation or firewalls. Denial, missing hardware and OS restrictions have explicit recovery messages. The production interface no longer asks users to find or enter a PC IP address. Older saved diagnostic address hints are cleared when this fallback runs.

The permission may remain valid across game navigation; the application does not capture the microphone again on page load or normal reconnect. Browser permission lifetime varies. Real PC/iPhone testing remains required.

## Recovery

Brief disconnections receive a five-second grace period before the PC attempts recovery; the phone waits slightly longer so both devices do not replace the same negotiation. When usable channels remain, the PC first restarts ICE on the existing peer with fresh credentials and a new proof/negotiation ID. Closed transports get a new peer. Failed attempts back off, candidates are deduplicated, and stale descriptions, proofs and candidate generations cannot validate a new attempt. Explicit microphone recovery always starts fresh so the browser can expose newly permitted addresses.

Repeated phone Retry actions are coalesced and do not also rejoin an authenticated session. Signaling recovery replays descriptions when appropriate. Backgrounded pages get a fresh heartbeat deadline when visible again. Game navigation still replaces the document and re-establishes its local connection; retaining the same peer through navigation would require a persistent application shell.

## Network limits

Browsers cannot inspect your Wi-Fi SSID or prove the underlying physical path through a VPN or routed network. This implementation verifies the available local ICE route and never uses an application-server or TURN relay. Known VPN interfaces are rejected when the browser reports them. Turn VPNs off for the supported setup.

Guest Wi-Fi, AP/client isolation, blocked multicast/mDNS, UDP firewalls, or denied browser/OS Local Network permission can prevent direct communication. The game stays blocked and offers Retry with instructions. It does not send motion through the internet to hide the failure. Supported browsers must provide working WebRTC data channels and sufficient route information; older TV browsers may not. HDMI from a supported PC remains the TV fallback.

No network can promise zero latency. Sensor delivery, browser scheduling, Wi-Fi contention and game rendering take time. The previous six-sample application batch is removed, and unreliable motion packets avoid retransmission backlog. Automated latency measurements are test-environment observations, not a physical-device or worldwide latency guarantee.

Internet is needed to load the hosted site, pair devices, and establish a new connection after navigation. An already-established direct connection continues through a signaling outage or server restart while it remains usable. A server restart clears pairing rooms; if local recovery later requires signaling, scan the PC's new pairing code. Explicit phone replacement/release still terminates its authority immediately. Browser backgrounding or phone screen lock may suspend sensors, so keep the phone page visible and unlocked.

## Before inviting a wider beta

- Deploy the folder root to one Heroku web dyno with the Python buildpack. No database or TURN service is needed.
- On an actual iPhone/Safari and Android/Chrome, scan the PC QR, allow Motion, complete calibration, and test each game. Test the PC microphone fallback with both Allow and Deny. An absent native Local Network prompt does not by itself indicate denial; Safari does not require that prompt for ordinary web traffic.
- Test phone background/return, screen lock, reconnect, PC navigation, and two independent tester pairs.
- Verify that guest Wi-Fi/different networks produce a clear blocked state, never a cloud-motion fallback.
- Check the site over your real Heroku HTTPS domain. Automated hosted-URL checks do not replace that live deployment check.
