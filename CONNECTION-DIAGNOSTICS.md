# Investigating the local phone connection

The deployed incident initially showed repeated PC ICE failures after local candidates were exchanged. Those older logs could not identify the iPhone's failure. A successful desktop WebKit test is not proof that an actual iPhone or its Wi-Fi network works.

## Capture a real attempt

1. Reload the PC and phone after deployment. Scan the new PC QR, since deployment replaces the in-memory pairing room.
2. Keep both pages visible on the same Wi-Fi. Open Play on the phone and let the connection attempt run for at least 20 seconds.
3. Open **Connection help** on the PC or the phone's reconnect dialog. Note the **Connection ID**. Choose **Download connection report** on each device.
4. The PC report includes both clients' uploaded timelines and the server's timeline, even if local ICE never connects. Each device's own report also has detailed ICE statistics and browser exception messages/stacks. If signaling is unavailable, the download still contains that device's captured events and explicitly says the server was unavailable.

The loader also offers a report when phone startup fails. If the diagnostics script itself cannot load or the OS kills the page, no JavaScript logger can observe that failure; server HTTP logs and the last saved browser events are the remaining evidence.

## What is captured

- Browser family/version, OS family, secure context, online/offline, visibility, page suspension/restoration, resource errors, uncaught errors and rejected promises.
- Pair lookup result, WebSocket open/error/close code, heartbeat timeout, registration, accepted/expired/busy pairing, and offer/answer/restart forwarding.
- Each negotiation attempt, gathering/ICE/DTLS/SCTP state, candidate acceptance/rejection and address family, offer/answer processing, candidate-add errors, data-channel open/error/close, local verification and peer proof.
- Every five seconds while connecting and fifteen seconds while connected: candidate counts, candidate-pair progress, STUN check request/response counts, transport byte counts, round-trip time and last-received age. These are transport counters, not motion samples.
- Server receipt time, client time and elapsed time, page trace ID, socket ID, connection ID and server boot ID. Compare attempt numbers within one page trace. Client clocks can differ; use server receipt times for cross-device order.

SDP, ICE credentials, pairing codes, raw network addresses, player profiles, gameplay messages and motion samples are excluded. Extended exception and ICE-identity details stay in the originating browser until report download. The server validates a narrow diagnostic schema and does not relay gameplay through it.

Each page keeps 600 timeline events, with a bounded sessionStorage copy for reloads, and 100 detailed local snapshots. The server keeps a shared ring of 6,000 events, exports at most 1,000 relevant events, and clears it when restarted. Reports are accessible only with the PC's screen cookie or through its paired phone socket. This is bounded troubleshooting history, not permanent log storage.

## Heroku logs

```sh
heroku logs --tail --app in-motion | tee connection-capture.log
```

New entries start with `connection_trace`; filter the JSON `session` field using the Connection ID. Heroku's router also logs request paths; `/pair` URLs can contain the temporary pairing code even though application diagnostic records omit it. Keep raw router captures private. For local terminal streaming set `CONNECTION_LOG_STDOUT=1` before starting the server.

## Read the failed stage

| Last stage/evidence | Meaning and next check |
| --- | --- |
| No `ws-open`, HTTP lookup error | Internet, cookies, origin, page loading, server availability. |
| `waiting-offer` / `waiting-answer` | Pairing succeeded but the other device has not processed the SDP. Check its visibility, errors and server forwarding records. |
| No accepted local candidates | Browser/OS permissions, disabled WebRTC, or no supported local interface. |
| Both descriptions set, zero successful candidate pairs | LAN discovery/reachability. Check Local Network permissions on both devices, mDNS, guest/client isolation, UDP firewall and VPN. |
| Requests sent, no responses | Candidate checks are not getting a usable response; logs alone cannot distinguish every firewall/mDNS/router cause. |
| ICE connected, `route-verification` | The route is working but selected-address evidence is hidden or forbidden. Inspect route reason and each browser's detailed ICE snapshot. |
| `peer-verification` | One peer verified its route; the other has not confirmed. Inspect the other report. |
| Both channels open, no motion | Transport is ready; check sensor permission, samples, visibility and phone lock separately. |

If mDNS discovery is blocked, the PC Connection help accepts its private Wi-Fi IPv4 address, obtained from that PC's network settings. It supplements discovery while preserving the original candidates, private-route checks and encrypted WebRTC. A public/Heroku IP is never a substitute. The hint cannot fix client isolation, a denied local-network permission, or blocked UDP.

## Transport choice

WebRTC data channels already use the browser's established ICE, DTLS and SCTP implementations. PeerJS or simple-peer wraps negotiation but does not fix iOS network permission, multicast discovery or Wi-Fi isolation. Their public STUN/TURN defaults must not be adopted for this local-only product. Socket.IO to Heroku would send motion through the cloud. A native/local companion service could avoid browser discovery limitations but would require software installation and a separate product flow.

This update retains WebRTC, isolates individual candidate failures, guards stale asynchronous SDP work, restarts unfinished signaling negotiations after reconnect, and makes failures observable. It keeps `iceServers: []`, independent route verification, unreliable motion packets and no cloud gameplay fallback.
