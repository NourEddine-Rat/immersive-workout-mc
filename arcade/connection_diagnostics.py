"""Bounded, metadata-only connection timelines. No sensor or profile payloads."""
from collections import deque
import json
import math
import os
import re
import secrets
import sys
import threading
import time

BOOT = secrets.token_hex(6)
RELEASE = os.environ.get('HEROKU_RELEASE_VERSION', 'connection-v2')
EVENTS = deque(maxlen=6000)
LOCK = threading.RLock()
CLIENT_EVENTS = set('page-start server-context resource-error js-error promise-error network-online network-offline visibility page-hide page-show ws-open ws-opening ws-close ws-error ws-timeout signal-send signal-received signal-dropped pair-request pair-result peer-change rtc-create rtc-state ice-candidate ice-error sdp-local sdp-remote rtc-error channel-open channel-close channel-error route-check proof-received link-state retry timeout stats motion-permission microphone-request microphone-granted microphone-failed microphone-cancelled'.split())
CLIENT_EVENTS.update(('asset-load-failed', 'asset-load-ready'))
NUMBERS = set('elapsed attempt code status duration localCount remoteCount rejectedCount mdnsCount privateCount publicCount pairCount succeededCount requestsSent responsesReceived bytesSent bytesReceived rttMs ageMs bufferedAmount errorCode line column'.split())
BOOLEANS = set('secure online hidden persisted verified peerVerified direct accepted hint present clean granted'.split())
STRINGS = set('stage ice connection gathering signaling control motion reason kind channel errorName browser version platform addressType candidateType protocol networkType localType remoteType dtls sctp'.split())


def clean_data(data):
    if not isinstance(data, dict):
        return {}
    out = {}
    for key, value in data.items():
        if key in NUMBERS and type(value) in (int, float) and math.isfinite(value) and abs(value) <= 1e16:
            out[key] = value
        elif key in BOOLEANS and type(value) is bool:
            out[key] = value
        elif key in STRINGS and isinstance(value, str) and re.fullmatch(r'[a-zA-Z0-9_. -]{0,80}', value):
            out[key] = value
    return out


def client_events(value):
    if not isinstance(value, list) or len(value) > 24:
        return []
    result = []
    for entry in value:
        if not isinstance(entry, dict) or entry.get('event') not in CLIENT_EVENTS:
            continue
        if not isinstance(entry.get('traceId'), str) or not re.fullmatch(r'[a-zA-Z0-9-]{1,64}', entry['traceId']):
            continue
        if any(type(entry.get(k)) not in (int, float) or not math.isfinite(entry[k]) or not 0 <= entry[k] <= 1e16 for k in ('seq', 'at', 'elapsed')):
            continue
        result.append({k: entry[k] for k in ('event', 'traceId', 'seq', 'at', 'elapsed')} | {'data': clean_data(entry.get('data'))})
    return result


def record(event, *, session=None, role='server', socket_id=None, data=None, client=None):
    row = {'serverAt': round(time.time() * 1000), 'boot': BOOT, 'session': session, 'role': role, 'socketId': socket_id, 'event': event, 'data': clean_data(data or {})}
    if client:
        row.update(client)
    with LOCK:
        EVENTS.append(row)
    # Hosted stdout is collected by Heroku. Local tests use the in-memory report;
    # opt in to terminal streaming with CONNECTION_LOG_STDOUT=1.
    if os.environ.get('DYNO') or os.environ.get('CONNECTION_LOG_STDOUT') == '1':
        print('connection_trace ' + json.dumps(row, separators=(',', ':')), file=sys.stderr, flush=True)


def context(session, socket_id):
    return {'session': session, 'socketId': socket_id, 'boot': BOOT, 'release': RELEASE}


def report(session):
    with LOCK:
        # Include each associated socket's pre-pairing events as well.
        sockets = {r['socketId'] for r in EVENTS if r['session'] == session and r['socketId']}
        rows = [r for r in EVENTS if r['session'] == session or r['socketId'] in sockets][-1000:]
    return {'schema': 2, 'context': context(session, None), 'events': rows, 'capacity': 6000, 'retention': 'Bounded in memory; cleared by server restart.'}
