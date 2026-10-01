# Browser-only local connection investigation — 2026-10-01

## Product constraints

- No downloaded PC or phone companion application.
- No requirement for users to discover or enter a private IP address.
- Motion and gameplay stay on the direct local connection, with no internet relay.
- The existing Heroku site supplies the application and pairing/signaling. That is separate from gameplay transport.
- Live site testing belongs to the user. Agent investigation uses logs, source and isolated local tests.

## Evidence from the reported incident

Session `4ff4fe1d43` exchanged its offer and answer successfully. The PC announced an mDNS `.local` candidate and the phone announced a numeric local candidate. Before the address hint, PC diagnostics reported about 170 connectivity checks without replies; phone diagnostics reported no candidate pairs. There was no successful data channel to carry motion.

After the PC's private address was supplied manually, Safari and iPhone Chrome established verified local connections in roughly 0.5–0.7 seconds. Later logs showed sustained traffic and successful connectivity checks. This strongly implicates automatic address discovery or candidate handling. The logs do not distinguish a browser mDNS defect, OS behavior or multicast filtering conclusively.

Manual IP entry is useful diagnostic evidence, not the accepted production experience.

## Local permission experiment

A fresh, isolated desktop Chrome profile with simulated camera hardware was tested on localhost. No real camera or microphone was accessed, no live site was opened, and no product code was changed by this experiment.

1. Without camera permission, Chrome exposed an mDNS host candidate.
2. With camera permission, Chrome exposed numeric IPv4 and IPv6 host candidates.
3. Those candidates remained available after the simulated camera stream was stopped.
4. Revoking the permission restored mDNS candidate exposure.

An integration experiment then ran the existing site locally with desktop Chrome and Playwright WebKit. Both peers deliberately discarded all remote mDNS candidates, modeling failed name discovery. Initial pairing stalled. After granting PC camera permission, opening and immediately stopping a simulated camera stream, and retrying negotiation, the connection succeeded with a verified UDP host/host route. The address hint remained empty and `iceServers` remained empty. It also connected after PC game navigation.

Reproduction artifacts for this investigation:

- `/tmp/inmotion-permission-discovery.mjs`
- `/tmp/inmotion-permission-recovery.mjs`
- `/tmp/inmotion-permission-recovery.log`

This is evidence for a possible browser-only recovery feature, not proof that an actual iPhone or every browser/network will succeed. Local test peers were on the same computer. The simulated mDNS failure approximates the suspected failure; it does not establish the exact cause of the incident.

## Implemented recovery, approved by the user

Ordinary automatic WebRTC pairing runs first. If local discovery stalls, the PC opens Connection help with an explicit **Allow microphone & retry** button. Microphone permission was independently verified to expose numeric local candidates in desktop Chrome and restore the simulated failed-discovery connection to WebKit. The code immediately stops every returned track before a fresh negotiation, never attaches media to WebRTC and never records/transmits audio.

The production interface no longer asks for an IP address. The fallback clears any legacy diagnostic address hint. Permission denial, absent hardware, insecure/unsupported contexts, device errors, duplicate clicks, late permission after navigation and late permission after successful pairing are handled. Normal reconnect and game navigation do not request microphone capture.

Automatic transport recovery now uses disconnect grace, backoff, candidate deduplication, signaling replay and authenticated native ICE restart where channels remain viable. It avoids duplicate phone joins/restarts and preserves a verified local connection during a signaling server restart. Whole-document game navigation still re-establishes the peer connection; it does not preserve the exact transport across documents.

Committed regression tests are in `arcade/tests/microphone-recovery.test.mjs`, `microphone-recovery.e2e.mjs`, `ice-recovery.e2e.mjs`, `direct-state.test.mjs` and `signaling-recovery.e2e.mjs`. Tests use simulated microphone hardware and synthetic motion. The actual iPhone/router behavior remains a user validation step; no live browser interaction was performed for this release.

## Technical limits and alternatives

WebRTC data channels are already the browser technology for direct peer exchange. PeerJS and simple-peer wrap that browser implementation; they do not supply network drivers or bypass mDNS, firewalls or router isolation. A library may simplify application state management, but replacing the wrapper is not an evidenced fix for this incident.

A local-only browser connection cannot be guaranteed on networks that prohibit devices from communicating. No application-level retry or library can override that restriction. An internet TURN relay would change the transport constraint and is not an accepted fallback.

A STUN server discovers addresses rather than relaying gameplay, but public candidate connectivity does not prove a local path. This experiment did not add STUN or weaken local-route validation.

Relevant references:

- RFC 8828, section 5: consent and browser IP exposure; device permission is one possible consent mechanism: https://www.rfc-editor.org/rfc/rfc8828.html#section-5
- Apple TN3179: local network privacy and Safari/WebKit exceptions: https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy
- Chrome Local Network Access announcement: permission coverage is API/version-specific and must not be assumed to expose WebRTC addresses: https://developer.chrome.com/blog/local-network-access
