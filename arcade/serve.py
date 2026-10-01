#!/usr/bin/env python3
"""
Pocket Arcade — the carousel and every game, one server.

    python3 serve.py            (or double-click start.command)

The carousel is the front door (http://localhost:8000/); every game lives
under /games/ and shares one phone link, so the phone connects once and stays
connected while you move between games. The phone needs
https before iOS will hand a web page its motion sensors, which is the only
reason this file is longer than twenty lines: it borrows the public
local-ip.sh certificate so that any phone, iPhone or Android, can connect
with nothing to install.
"""

import json
import math
import secrets
from urllib.parse import urlparse, parse_qs, unquote
from http.cookies import SimpleCookie
import signal
import re
import weakref
import os
import socket
import ssl
import struct
import base64
import hashlib
import subprocess
import sys
import threading
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
CERT_DIR = os.path.join(HERE, ".certs")
LOGS = os.path.join(HERE, "logs")
# the older standalone servers fetched the same certificate; share it rather than ask twice
SIBLINGS = [os.path.join(os.path.dirname(HERE), d, ".certs") for d in ("subway", "squidgames", "geometry-testing")]
WS_GUID = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

HTTP_PORT = 8000
HTTPS_PORT = 8443

# short names for typing into a TV; each is a redirect so the page's own relative links keep working
ALIASES = {"/subway": "/games/subway/", "/play": "/games/subway/",
           "/red-light": "/games/squid/red-light/", "/redlight": "/games/squid/red-light/",
           "/jump-rope": "/games/squid/jump-rope/", "/jumprope": "/games/squid/jump-rope/",
           "/track": "/games/squid/track/"}
PHONE_HOST = None
PHONE_SECURE = None
LOCAL_WARNING = None
TV_URL = None      # the address to type on a TV: the bare IP when port 80 was free

# Heroku terminates TLS and forwards WebSocket upgrades to this single process.
HOSTED = bool(os.environ.get("PORT") or os.environ.get("DYNO"))
PUBLIC_URL = os.environ.get("PUBLIC_URL", "").rstrip("/")
MAX_FRAME = 1024 * 1024
ROOMS = {}
CODES = {}
ROOMS_LOCK = threading.RLock()
SEND_LOCKS = weakref.WeakKeyDictionary()
CONNECTIONS = set()
ATTEMPTS = {}
ROOM_TTL = 30 * 60


class Room:
    def __init__(self):
        self.token = secrets.token_urlsafe(32)
        self.code = f"{secrets.randbelow(1000000):06d}"
        while self.code in CODES:
            self.code = f"{secrets.randbelow(1000000):06d}"
        self.peers = {"console": set(), "phone": set()}
        self.hosts, self.channels, self.phones = {}, {}, {}
        self.active = self.profile = self.owner = None
        self.owner_until = self.last_sample = self.first_sample = self.last_status = 0
        self.peer_id = self.phone_instance = None
        self.diagnostics = {}
        self.diagnostic_times = {}
        self.touched = time.monotonic()
        self.lock = threading.RLock()

    def status(self, force=False):
        now = time.monotonic()
        if not force and now - self.last_status < 1:
            return
        self.last_status = now
        message = {"t": "room-status", "paired": bool(self.phones)}
        for peer in list(self.peers["console"]):
            _send_json(peer, message)


def find_room(token=None, code=None, create=False):
    with ROOMS_LOCK:
        now = time.monotonic()
        for key, room in list(ROOMS.items()):
            if not any(room.peers.values()) and now - room.touched > ROOM_TTL:
                ROOMS.pop(key, None)
                CODES.pop(room.code, None)
        room = ROOMS.get(token) if token else CODES.get(code)
        if not room and create and len(ROOMS) < 1024:
            room = Room()
            ROOMS[room.token] = CODES[room.code] = room
        if room:
            room.touched = now
        return room


def pairing_allowed(address):
    # Bound code guessing and memory; only failed attempts use this budget.
    now = time.monotonic()
    with ROOMS_LOCK:
        for key, (started, _) in list(ATTEMPTS.items()):
            if now - started > 60:
                ATTEMPTS.pop(key, None)
        started, count = ATTEMPTS.get(address, (now, 0))
        if count >= 30 or (address not in ATTEMPTS and len(ATTEMPTS) >= 4096):
            return False
        ATTEMPTS[address] = (started, count + 1)
        return True


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def localip_host(ip):
    """192.168.1.112 -> 192-168-1-112.local-ip.sh, which resolves right back."""
    return ip.replace(".", "-") + ".local-ip.sh"


def monitor_local_link():
    """Refresh LAN links after a network change; DNS trouble must be visible to the PC."""
    global PHONE_HOST, TV_URL, LOCAL_WARNING
    while True:
        ip = lan_ip()
        PHONE_HOST = localip_host(ip) if PHONE_SECURE else ip
        if TV_URL:
            port = urlparse(TV_URL).port
            TV_URL = f"http://{ip}" + (f":{port}" if port else "") + "/"
        if PHONE_SECURE:
            try:
                if socket.gethostbyname(PHONE_HOST) != ip:
                    raise OSError("Unexpected DNS address")
                LOCAL_WARNING = None
            except OSError:
                LOCAL_WARNING = "This PC cannot resolve the secure local phone address. If the QR will not open on your phone, try another Wi-Fi network or use the hosted HTTPS site."
        time.sleep(30)


# --------------------------------------------------------------- certificate

def cert_ok(cert, days=3):
    if not os.path.exists(cert):
        return False
    try:
        r = subprocess.run(["openssl", "x509", "-in", cert, "-noout", "-checkend", str(days * 86400)],
                           capture_output=True, timeout=5)
        return r.returncode == 0
    except Exception:
        return False


def get_cert():
    """
    A certificate the phone already trusts, with nothing to install.

    local-ip.sh publishes a real Let's Encrypt wildcard for *.local-ip.sh —
    private key and all — and runs DNS that maps <dashed-ip>.local-ip.sh back
    to that address. Because the key is public it proves nothing about who we
    are; it exists purely to satisfy the browser rule that sensors need a
    secure page. The traffic still never leaves this network.
    """
    os.makedirs(CERT_DIR, exist_ok=True)
    cert = os.path.join(CERT_DIR, "cert.pem")
    key = os.path.join(CERT_DIR, "key.pem")
    if cert_ok(cert) and os.path.exists(key):
        return cert, key
    # the rig or the old game may already have a fresh copy
    for sib in SIBLINGS:
        sc, sk = os.path.join(sib, "cert.pem"), os.path.join(sib, "key.pem")
        if not (cert_ok(sc) and os.path.exists(sk)):
            continue
        for src, dst in ((sc, cert), (sk, key)):
            with open(src, "rb") as a, open(dst, "wb") as b:
                b.write(a.read())
        print("reusing the certificate already fetched")
        return cert, key
    for url, path in (("https://local-ip.sh/server.pem", cert), ("https://local-ip.sh/server.key", key)):
        # curl, not urllib: a python.org build carries its own CA bundle and
        # usually cannot verify anything, while curl uses the system's
        r = subprocess.run(["curl", "-fsSL", "--retry", "2", "-m", "20", "-o", path, url],
                           capture_output=True, text=True)
        if r.returncode != 0:
            print(f"could not fetch the certificate: {r.stderr.strip()}", file=sys.stderr)
            return None, None
    print("fetched the public local-ip.sh certificate — the phone needs nothing installed")
    return cert, key


# ---------------------------------------------------------------- websockets

def _recv_exact(conn, n):
    buf = b""
    while len(buf) < n:
        chunk = conn.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("closed")
        buf += chunk
    return buf


def _send_frame(conn, opcode, payload=b""):
    head = bytes([0x80 | opcode])
    ln = len(payload)
    if ln < 126:
        head += bytes([ln])
    elif ln < 65536:
        head += bytes([126]) + struct.pack("!H", ln)
    else:
        head += bytes([127]) + struct.pack("!Q", ln)
    with SEND_LOCKS.setdefault(conn, threading.RLock()):
        conn.sendall(head + payload)


def _send_json(conn, message):
    try:
        _send_frame(conn, 0x1, json.dumps(message, allow_nan=False).encode())
    except (OSError, ValueError):
        pass


def _activate_hosts(room):
    for host_conn, identity in room.hosts.items():
        _send_json(host_conn, {"t": "host-active", "hostId": identity, "active": identity == room.active})
    for phone in room.phones:
        _send_json(phone, {"t": "peer-host", "hostId": room.active, "peerId": room.peer_id, "clientId": room.owner})
    if room.phones:
        for host_conn, identity in room.hosts.items():
            if identity == room.active:
                _send_json(host_conn, {"t": "peer-phone", "hostId": identity, "clientId": room.owner, "peerId": room.peer_id})


def rtc_message(message):
    """Only connection setup crosses this server. Never forward gameplay payloads."""
    kind = message.get("kind")
    result = {key: message.get(key) for key in ("hostId", "clientId", "peerId")}
    result.update(t="rtc-signal", kind=kind)
    if kind == "restart":
        return result
    negotiation = message.get("negotiationId")
    if not isinstance(negotiation, str) or not 1 <= len(negotiation) <= 100:
        return None
    result["negotiationId"] = negotiation
    if kind == "diagnostic":
        data = message.get("diagnostic")
        if not isinstance(data, dict):
            return None
        phases = {"gathered", "verifying", "connected", "blocked"}
        states = {"new", "checking", "connecting", "connected", "completed", "disconnected", "failed", "closed"}
        reasons = {""} | {side + reason for side in ("local-", "remote-") for reason in
                         ("candidate-pending", "candidate-hidden", "vpn-route", "nonlocal-type", "non-udp-route", "nonlocal-address")}
        if data.get("phase") not in phases or data.get("ice") not in states or data.get("connection") not in states or data.get("reason") not in reasons:
            return None
        counts = {key: data.get(key) for key in ("localCount", "remoteCount")}
        if any(type(value) is not int or not 0 <= value <= 128 for value in counts.values()):
            return None
        result["diagnostic"] = {key: data[key] for key in ("phase", "ice", "connection", "reason", "localCount", "remoteCount")}
    elif kind in ("offer", "answer"):
        description = message.get("description")
        if not isinstance(description, dict) or description.get("type") != kind:
            return None
        sdp = description.get("sdp")
        if not isinstance(sdp, str) or not sdp.startswith("v=0") or len(sdp) > 65536:
            return None
        result["description"] = {"type": kind, "sdp": sdp}
    elif kind == "candidate":
        candidate = message.get("candidate")
        if not isinstance(candidate, dict) or not isinstance(candidate.get("candidate"), str) or len(candidate["candidate"]) > 2048:
            return None
        result["candidate"] = {key: candidate.get(key) for key in ("candidate", "sdpMid", "sdpMLineIndex", "usernameFragment")}
    else:
        return None
    return result


class WSMixin:
    """One paired phone, one active PC page, with secondary game channels."""

    def ws_upgrade(self, role, channel_host=None):
        room = self.screen_room() if role == "console" else None
        if role == "console" and not room:
            return self.send_error(409, "Open the connection screen first")
        self.close_connection = True
        key = self.headers.get("Sec-WebSocket-Key")
        if not key or self.headers.get("Upgrade", "").lower() != "websocket":
            return self.send_error(400)
        accept = base64.b64encode(hashlib.sha1(key.encode() + WS_GUID).digest()).decode()
        self.send_response(101)
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()
        conn = self.connection
        conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        # Abandoned phone sockets cannot hold the controller slot forever.
        conn.settimeout(15 if role == "phone" else 30)
        with ROOMS_LOCK:
            CONNECTIONS.add(conn)
        if room:
            with room.lock:
                room.peers[role].add(conn)
                if channel_host:
                    room.channels[conn] = channel_host
                room.status(force=True)
        fragmented = bytearray()
        fragment_opcode = None
        try:
            while True:
                b1, b2 = _recv_exact(conn, 2)
                opcode, masked, ln = b1 & 0x0F, b2 & 0x80, b2 & 0x7F
                if ln == 126:
                    ln = struct.unpack("!H", _recv_exact(conn, 2))[0]
                elif ln == 127:
                    ln = struct.unpack("!Q", _recv_exact(conn, 8))[0]
                if not masked or b1 & 0x70 or ln > MAX_FRAME or len(fragmented) + ln > MAX_FRAME:
                    _send_frame(conn, 0x8, struct.pack("!H", 1009 if ln > MAX_FRAME else 1002))
                    break
                if opcode >= 8 and (ln > 125 or not b1 & 0x80):
                    break
                mask = _recv_exact(conn, 4)
                payload = _recv_exact(conn, ln)
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
                if opcode == 0x8:
                    _send_frame(conn, 0x8, payload)
                    break
                if opcode == 0x9:
                    _send_frame(conn, 0xA, payload)
                    continue
                if opcode == 0xA:
                    continue
                if opcode == 0:
                    if fragment_opcode is None:
                        break
                    fragmented.extend(payload)
                    if not b1 & 0x80:
                        continue
                    opcode, payload = fragment_opcode, bytes(fragmented)
                    fragment_opcode = None
                    fragmented.clear()
                elif opcode in (1, 2):
                    if fragment_opcode is not None:
                        break
                    if not b1 & 0x80:
                        fragment_opcode = opcode
                        fragmented.extend(payload)
                        continue
                if opcode != 1:
                    continue
                try:
                    message = json.loads(payload)
                except (ValueError, UnicodeDecodeError):
                    continue
                if not isinstance(message, dict):
                    continue
                kind = message.get("t")
                if kind == "heartbeat":
                    _send_json(conn, {"t": "heartbeat"})
                    if room:
                        with room.lock:
                            room.status()
                    continue
                if role == "phone" and kind == "phone-join":
                    code = message.get("pairCode", "")
                    target = find_room(code=code) if isinstance(code, str) and re.fullmatch(r"[0-9]{6}", code) else None
                    if not target:
                        allowed = pairing_allowed(self.client_ip())
                        _send_json(conn, {"t": "pair-expired", "message": "This code has expired. Scan the new QR code on your PC." if allowed else "Too many attempts. Wait one minute, then scan the PC QR code."})
                        if not allowed:
                            break
                        continue
                    if room and room != target:
                        # Release the previous screen before changing rooms on the same socket.
                        with room.lock:
                            room.peers["phone"].discard(conn)
                            if room.phones.pop(conn, None):
                                room.owner_until = time.monotonic() + 10
                            room.status(force=True)
                    room = target
                    with room.lock:
                        room.peers["phone"].add(conn)
                if room is None:
                    continue
                with room.lock:
                    room.touched = time.monotonic()
                    if role == "phone":
                        client_id = message.get("clientId")
                        if kind == "phone-join":
                            instance = message.get("instanceId")
                            if not isinstance(client_id, str) or not 1 <= len(client_id) <= 100 or not isinstance(instance, str) or not 1 <= len(instance) <= 100:
                                continue
                            if room.owner and room.owner != client_id and (room.phones or time.monotonic() < room.owner_until):
                                _send_json(conn, {"t": "host-busy", "clientId": client_id})
                                continue
                            for old_conn in list(room.phones):
                                if old_conn != conn:
                                    room.phones.pop(old_conn, None)
                                    _send_json(old_conn, {"t": "phone-replaced"})
                            if room.owner != client_id or room.phone_instance != instance or not room.peer_id:
                                room.peer_id = secrets.token_urlsafe(24)
                            room.phone_instance = instance
                            room.owner = client_id
                            room.phones[conn] = client_id
                            _send_json(conn, {"t": "phone-paired", "clientId": client_id, "hostId": room.active, "peerId": room.peer_id})
                            _activate_hosts(room)
                            continue
                        if conn not in room.phones or room.phones[conn] != client_id:
                            continue
                        if kind == "phone-release":
                            room.phones.pop(conn, None)
                            room.owner = room.peer_id = room.phone_instance = None
                            room.owner_until = 0
                            for host_conn, identity in room.hosts.items():
                                if identity == room.active:
                                    _send_json(host_conn, {"t": "peer-phone", "hostId": identity, "clientId": None, "peerId": None})
                            continue
                        peers = [peer for peer, identity in room.hosts.items() if identity == room.active]
                    elif role == "console":
                        if kind == "host-register":
                            identity = message.get("hostId")
                            if not isinstance(identity, str) or not 1 <= len(identity) <= 100:
                                continue
                            room.hosts[conn] = identity
                            room.active = identity
                            _activate_hosts(room)
                            continue
                        if room.hosts.get(conn) != room.active or message.get("clientId") != room.owner:
                            continue
                        peers = list(room.phones)
                    else:
                        continue
                    if kind != "rtc-signal" or message.get("hostId") != room.active or message.get("peerId") != room.peer_id:
                        continue
                    outgoing = rtc_message(message)
                    if not outgoing:
                        continue
                    if outgoing["kind"] == "diagnostic":
                        # Bounded connection metadata only. Never log codes, network
                        # addresses, SDP, identity, profile information or motion.
                        data = outgoing["diagnostic"]
                        now = time.monotonic()
                        if room.diagnostics.get(role) != data and now - room.diagnostic_times.get(role, 0) >= 2:
                            room.diagnostics[role] = data
                            room.diagnostic_times[role] = now
                            session = hashlib.sha256(room.token.encode()).hexdigest()[:10]
                            print("connection_diagnostic " + json.dumps({"session": session, "role": role, **data}), flush=True)
                        continue
                    if role == "phone" and outgoing["kind"] == "offer" or role == "console" and outgoing["kind"] == "answer":
                        continue
                    for peer in peers:
                        _send_json(peer, outgoing)
        except (ConnectionError, OSError, struct.error):
            pass
        finally:
            with ROOMS_LOCK:
                CONNECTIONS.discard(conn)
            if room:
                with room.lock:
                    room.touched = time.monotonic()
                    room.peers[role].discard(conn)
                    room.channels.pop(conn, None)
                    if room.phones.pop(conn, None):
                        room.owner_until = time.monotonic() + 10
                        room.first_sample = room.last_sample = 0
                    departed = room.hosts.pop(conn, None)
                    if departed == room.active:
                        room.active = next(reversed(room.hosts.values()), None) if room.hosts else None
                        _activate_hosts(room)
                    room.status(force=True)
            try:
                conn.close()
            except OSError:
                pass


# --------------------------------------------------------------------- http

class Handler(WSMixin, SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".mjs": "text/javascript",
                      ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".wasm": "application/wasm",
                      ".webp": "image/webp", ".mp4": "video/mp4",
                      ".webmanifest": "application/manifest+json"}
    protocol_version = "HTTP/1.1"

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=HERE, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        super().end_headers()

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        if getattr(self, "new_screen_token", None):
            secure = "; Secure" if HOSTED or isinstance(self.connection, ssl.SSLSocket) else ""
            self.send_header("Set-Cookie", f"arcade-screen={self.new_screen_token}; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax{secure}")
        self.end_headers()
        self.wfile.write(body)

    def client_ip(self):
        # Only trust proxy headers in the managed deployment mode.
        return self.headers.get("X-Forwarded-For", self.client_address[0]).split(",")[0].strip() if HOSTED else self.client_address[0]

    def screen_room(self, create=False):
        cookies = SimpleCookie()
        try:
            cookies.load(self.headers.get("Cookie", ""))
        except Exception:
            pass
        token = cookies.get("arcade-screen")
        room = find_room(token=token.value if token else None, create=create)
        if room and (not token or token.value != room.token):
            self.new_screen_token = room.token
        return room

    def request_origin(self):
        if PUBLIC_URL:
            return PUBLIC_URL
        host = self.headers.get("Host", "")
        if not re.fullmatch(r"[a-zA-Z0-9.\[\]:-]+", host):
            raise ValueError("Invalid host")
        scheme = "https" if HOSTED or isinstance(self.connection, ssl.SSLSocket) else "http"
        return f"{scheme}://{host}"

    def public_file(self):
        path = unquote(urlparse(self.path).path)
        parts = path.split("/")
        if any(part.startswith(".") for part in parts if part):
            return False
        if any(part in ("logs", "tests", "node_modules", "__pycache__") for part in parts):
            return False
        if path.endswith((".py", ".pyc", ".pem", ".key", ".command", ".test.mjs")) or parts[-1] in ("package.json", "package-lock.json"):
            return False
        real = os.path.realpath(self.translate_path(self.path))
        return os.path.commonpath([HERE, real]) == HERE

    def list_directory(self, path):
        return self.send_error(404)

    def do_HEAD(self):
        if not self.public_file():
            return self.send_error(404)
        return super().do_HEAD()

    def do_GET(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        if parsed.path == "/health":
            return self._json({"ok": True})
        if HOSTED and self.headers.get("X-Forwarded-Proto", "https").split(",")[0].strip() == "http":
            try:
                origin = self.request_origin()
            except ValueError:
                return self.send_error(400)
            self.send_response(302)
            self.send_header("Location", origin + self.path)
            self.send_header("Content-Length", "0")
            return self.end_headers()
        if parsed.path == "/phone.html" and not HOSTED and PHONE_SECURE and not isinstance(self.connection, ssl.SSLSocket) and self.headers.get("Host", "").split(":")[0] not in ("localhost", "127.0.0.1"):
            self.send_response(302)
            self.send_header("Location", f"https://{PHONE_HOST}:{HTTPS_PORT}/phone.html" + ("?" + parsed.query if parsed.query else ""))
            self.send_header("Content-Length", "0")
            return self.end_headers()
        if parsed.path == "/ws":
            role = query.get("role", [""])[0]
            if role not in ("phone", "console"):
                return self.send_error(400)
            origin = self.headers.get("Origin")
            if origin and urlparse(origin).netloc != self.headers.get("Host"):
                return self.send_error(403)
            return self.ws_upgrade(role, query.get("hostId", [None])[0])
        if parsed.path.rstrip("/") in ALIASES:
            self.send_response(301)
            self.send_header("Location", ALIASES[parsed.path.rstrip("/")] + ("?" + parsed.query if parsed.query else ""))
            self.send_header("Content-Length", "0")
            return self.end_headers()
        if parsed.path == "/pair":
            code = query.get("code", [""])[0]
            room = find_room(code=code) if re.fullmatch(r"[0-9]{6}", code) else None
            if not room:
                allowed = pairing_allowed(self.client_ip())
                return self._json({"ok": False, "error": "That code does not match a screen. Scan its current QR code." if allowed else "Too many attempts. Wait one minute and try again."}, 400 if allowed else 429)
            with room.lock:
                active = bool(room.hosts)
            if not active:
                return self._json({"ok": False, "error": "Open the carousel on your PC or TV first."}, 409)
            return self._json({"ok": True})
        if parsed.path == "/screen-check":
            return self._json({"ok": bool(self.screen_room())}, 200 if self.screen_room() else 409)
        if parsed.path == "/where":
            room = self.screen_room(create=True)
            if not room:
                return self._json({"error": "All beta sessions are busy. Please try again shortly."}, 503)
            try:
                origin = self.request_origin()
            except ValueError:
                return self.send_error(400)
            phone_origin = origin if HOSTED or PHONE_SECURE is None else f"https://{PHONE_HOST}:{HTTPS_PORT}"
            return self._json({"pairCode": room.code, "connectionId": hashlib.sha256(room.token.encode()).hexdigest()[:10], "phoneUrl": f"{phone_origin}/phone.html?connect={room.code}",
                               "phoneEntry": f"{phone_origin}/phone.html", "hosted": HOSTED, "phoneWarning": None if HOSTED else LOCAL_WARNING,
                               "phoneError": "The secure phone connection is unavailable. Check the PC internet connection and restart start.command to fetch its certificate." if not HOSTED and PHONE_SECURE is False else None,
                               "tv": (origin + "/" if HOSTED else TV_URL or f"http://{lan_ip()}:{HTTP_PORT}/") + "?desktop=1"})
        if not self.public_file():
            return self.send_error(404)
        if self.headers.get("Range", "").startswith("bytes=") and self._ranged():
            return
        return super().do_GET()

    def _ranged(self):
        """Safari plays video only from a server that answers byte ranges (the carousel intro)."""
        path = self.translate_path(self.path)
        if not os.path.isfile(path):
            return False
        size = os.path.getsize(path)
        first, _, last = self.headers["Range"][6:].split(",")[0].strip().partition("-")
        try:
            start = int(first) if first else max(0, size - int(last))
            end = min(int(last), size - 1) if first and last else size - 1
        except ValueError:
            return False
        if start < 0 or end < 0 or start > end or start >= size:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return True
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        with open(path, "rb") as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(left, 1 << 16))
                if not chunk:
                    break
                self.wfile.write(chunk)
                left -= len(chunk)
        return True

    def do_POST(self):
        # This service accepts setup messages over /ws only. No gameplay uploads.
        self.close_connection = True
        self.send_error(404)

    def log_message(self, fmt, *args):
        if len(args) > 1 and str(args[1]).startswith(("4", "5")):
            super().log_message(fmt, *args)


class Dual(ThreadingHTTPServer):
    """One port, either protocol — a TLS ClientHello always starts 0x16."""

    daemon_threads = True
    ssl_ctx = None

    def process_request_thread(self, request, client_address):
        # TLS handshakes/preconnects must not block the accept loop for other devices.
        request.settimeout(10)
        try:
            if self.ssl_ctx is not None and request.recv(1, socket.MSG_PEEK) == b"\x16":
                request = self.ssl_ctx.wrap_socket(request, server_side=True)
            request.settimeout(30)
            super().process_request_thread(request, client_address)
        except (OSError, ssl.SSLError):
            self.shutdown_request(request)

    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionResetError, BrokenPipeError, TimeoutError,
                            BlockingIOError, ssl.SSLError)):
            return          # a phone walking out of range is not an error
        super().handle_error(request, client_address)


def serve(port, cert=None, key=None):
    httpd = Dual(("0.0.0.0", port), Handler)
    if cert and key:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(cert, key)
        httpd.ssl_ctx = ctx
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def busy(port):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.4)
    try:
        return s.connect_ex(("127.0.0.1", port)) == 0
    finally:
        s.close()


def main():
    global PHONE_HOST, PHONE_SECURE, HTTP_PORT, HTTPS_PORT, TV_URL
    if HOSTED:
        if PUBLIC_URL and (urlparse(PUBLIC_URL).scheme != "https" or not urlparse(PUBLIC_URL).netloc or urlparse(PUBLIC_URL).path):
            raise SystemExit("PUBLIC_URL must be an HTTPS origin, for example https://your-app.herokuapp.com")
        port = int(os.environ.get("PORT", "8000"))
        server = serve(port)
        print(f"InMotion beta listening on 0.0.0.0:{port}; one web dyno, isolated in-memory sessions", flush=True)
        stopped = threading.Event()
        def stop(*_):
            stopped.set()
        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        stopped.wait()
        server.shutdown()
        with ROOMS_LOCK:
            peers = list(CONNECTIONS)
        for conn in peers:
            try:
                conn.shutdown(socket.SHUT_RDWR)
                conn.close()
            except OSError:
                pass
        server.server_close()
        return
    # optional: python3 serve.py 8101 8544  (a second copy on other ports)
    if len(sys.argv) >= 3 and sys.argv[1].isdigit() and sys.argv[2].isdigit():
        HTTP_PORT, HTTPS_PORT = int(sys.argv[1]), int(sys.argv[2])
    for p in (HTTP_PORT, HTTPS_PORT):
        if busy(p):
            print(f"\nPort {p} is already in use — another server is probably running (this one, or an old")
            print("  subway/squidgames/carousel one). Stop it first (Ctrl-C in that terminal), or:  pkill -f serve.py\n")
            return

    cert, key = get_cert()
    PHONE_SECURE = bool(cert and key)
    ip = lan_ip()
    PHONE_HOST = localip_host(ip) if cert else ip

    serve(HTTP_PORT)
    if cert:
        serve(HTTPS_PORT, cert, key)
    # The TV: the shortest address is the bare IP on port 80, which only root
    # may bind. Take it when we can (run with sudo); the
    # 8000 address works on the TV either way.
    short = None
    if not busy(80):
        try:
            serve(80)
            short = f"http://{ip}/"
        except OSError:
            short = None

    TV_URL = short or f"http://{ip}:{HTTP_PORT}/"
    threading.Thread(target=monitor_local_link, daemon=True).start()
    print("\nPocket Arcade")
    print(f"  carousel  http://localhost:{HTTP_PORT}/            (pick a game)")
    print(f"  on the TV {short or f'http://{ip}:{HTTP_PORT}/'}   (same Wi-Fi; type it in the TV browser)")
    if not short:
        print(f"            for the shorter  http://{ip}/  run:  sudo python3 serve.py")
    print(f"  phone     https://{PHONE_HOST}:{HTTPS_PORT}/phone.html"
          if cert else "  phone     unavailable — no certificate, so iOS will not give up the sensors")
    print("  The game shows the phone link on screen. Nothing to install on the phone.\n")

    if not os.environ.get("ARCADE_NO_OPEN"):
        threading.Timer(0.6, lambda: webbrowser.open(f"http://localhost:{HTTP_PORT}/")).start()
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
