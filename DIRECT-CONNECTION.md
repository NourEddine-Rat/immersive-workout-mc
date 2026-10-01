# Direct local play

The hosted website loads from Heroku, but motion and gameplay messages do not travel through Heroku. Both devices must be on the same reachable local network. A PC on Ethernet and a phone on the same router's Wi-Fi can also connect.

## Connection path

1. The PC gets a private screen session and six-digit pairing code over HTTPS.
2. The phone joins that session. The signaling WebSocket exchanges WebRTC offers, answers, and local ICE candidates.
3. Each browser independently checks the selected candidate pair. Only UDP with private, link-local, loopback or local mDNS endpoints is accepted. Public/server-reflexive and TURN relay routes are rejected. When browsers hide addresses in statistics, the exact selected candidate must match the foundation and port of a permitted candidate from this negotiation. Unknown routes remain blocked.
4. Both peers confirm that check over the encrypted data channel. The carousel unlocks after this confirmation. Gameplay additionally waits for fresh motion samples; stopping motion does not reopen the carousel pairing modal.
5. Motion is sent immediately, one sample per unordered packet with zero retransmissions. Late/lost packets are dropped. Buttons, profile, calibration, game state and activity use the separate reliable channel on the same direct connection.

`iceServers` is empty: no STUN or TURN service is configured. There is no WebSocket fallback for motion or gameplay. The server accepts only screen registration, pairing/release, heartbeats, and validated WebRTC setup messages. It rejects gameplay payloads. Automatic diagnostic screenshot/log uploads are removed.

`engine/direct-link.js` owns the shared connection. `engine/lib/local-route.js` enforces route validation. `engine/host-bridge.js` distributes direct messages to the carousel, training, and game sensor engine. `phone.js` sends fresh motion through this connection. Each game page rebuilds its connection automatically when the PC navigates.

## Network limits

Browsers cannot inspect your Wi-Fi SSID or prove the underlying physical path through a VPN or routed network. This implementation verifies the available local ICE route and never uses an application-server or TURN relay. Known VPN interfaces are rejected when the browser reports them. Turn VPNs off for the supported setup.

Guest Wi-Fi, AP/client isolation, blocked multicast/mDNS, UDP firewalls, or denied browser/OS Local Network permission can prevent direct communication. The game stays blocked and offers Retry with instructions. It does not send motion through the internet to hide the failure. Supported browsers must provide working WebRTC data channels and sufficient route information; older TV browsers may not. HDMI from a supported PC remains the TV fallback.

No network can promise zero latency. Sensor delivery, browser scheduling, Wi-Fi contention and game rendering take time. The previous six-sample application batch is removed, and unreliable motion packets avoid retransmission backlog. Automated latency measurements are test-environment observations, not a physical-device or worldwide latency guarantee.

Internet is needed to load the hosted site, pair devices, and establish a new connection after navigation. An already-established direct connection can continue when the signaling server temporarily goes offline. A server restart clears pairing rooms; a new pairing code may be needed after reconnection. Browser backgrounding or phone screen lock may suspend sensors, so keep the phone page visible and unlocked.

## Before inviting a wider beta

- Deploy the folder root to one Heroku web dyno with the Python buildpack. No database or TURN service is needed.
- On an actual iPhone/Safari and Android/Chrome, scan the PC QR, allow Motion and Local Network access, complete calibration, and test each game.
- Test phone background/return, screen lock, reconnect, PC navigation, and two independent tester pairs.
- Verify that guest Wi-Fi/different networks produce a clear blocked state, never a cloud-motion fallback.
- Check the site over your real Heroku HTTPS domain. Automated hosted-URL checks do not replace that live deployment check.
