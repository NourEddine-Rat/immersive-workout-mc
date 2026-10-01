// Loaded before the app: even a failed module download leaves an exportable trace.
// No SDP, ICE credentials, pairing codes, sensor samples or player data are recorded.
(() => {
  if (globalThis.ConnectionDiagnostics || typeof window === 'undefined') return;
  if (new URLSearchParams(location.search).get('controller') === '1') return;
  const KEY = 'inmotion.connection-trace.v2', LIMIT = 600;
  const traceId = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  let events = [], pending = [], sequence = 0, sender, context = {}, role = location.pathname.includes('phone') ? 'phone' : 'host';
  let lastSave = 0, exportWaiter, uploaded = 0, details = [];
  const numbers = new Set('elapsed attempt code status duration localCount remoteCount rejectedCount mdnsCount privateCount publicCount pairCount succeededCount requestsSent responsesReceived bytesSent bytesReceived rttMs ageMs bufferedAmount errorCode line column'.split(' '));
  const booleans = new Set('secure online hidden persisted verified peerVerified direct accepted hint present clean granted'.split(' '));
  const strings = new Set('stage ice connection gathering signaling control motion reason kind channel errorName browser version platform addressType candidateType protocol networkType localType remoteType dtls sctp'.split(' '));
  function clean(data = {}) {
    const out = {};
    for (const [key, value] of Object.entries(data)) {
      if (numbers.has(key) && Number.isFinite(value)) out[key] = Math.round(value * 100) / 100;
      if (booleans.has(key) && typeof value === 'boolean') out[key] = value;
      if (strings.has(key) && typeof value === 'string') out[key] = value.replace(/[^a-zA-Z0-9_. -]/g, '').slice(0, 80);
    }
    return out;
  }
  function save() {
    try { sessionStorage.setItem(KEY, JSON.stringify(events.slice(-LIMIT))); } catch {}
    lastSave = Date.now();
  }
  try { const saved=JSON.parse(sessionStorage.getItem(KEY) || '[]');if(Array.isArray(saved))events=saved.slice(-200).filter(e=>e&&typeof e.event==='string'&&typeof e.traceId==='string'); } catch {}
  function record(event, data = {}) {
    const entry = {event, traceId, seq: ++sequence, at: Date.now(), elapsed: Math.round(performance.now()), data: clean(data)};
    events.push(entry); pending.push(entry);
    if (events.length > LIMIT) events.shift();
    if (pending.length > LIMIT) pending.shift();
    if (Date.now() - lastSave > 2000 || /error|failed|closed|blocked/.test(event)) save();
    return entry;
  }
  function flush() {
    if (!sender || !pending.length) return;
    const batch = pending.slice(0, 24);
    try { if (sender({t: 'connection-log', events: batch}) === true) { pending.splice(0, batch.length); uploaded += batch.length; } } catch {}
  }
  function detail(event, data) {
    // Extra browser error/ICE structure stays on this device until an explicit
    // download. Callers project stats first, never passing SDP or messages.
    details.push({event, at: Date.now(), traceId, data});
    if(details.length>100)details.shift();
  }
  function error(event, error, data={}) {
    record(event,{...data,errorName:error?.name||'Error'});
    const redact = value => String(value||'').replace(/(?:https?|wss?):\/\/[^\s)]+/g,url=>{try{return new URL(url).pathname;}catch{return '[url]';}}).replace(/(?:\d{1,3}\.){3}\d{1,3}/g,'[address]').replace(/a=(?:ice-pwd|ice-ufrag|fingerprint):[^\r\n]+/g,'[credential]').slice(0,2000);
    detail(event,{...clean(data),name:error?.name||'Error',message:redact(error?.message),stack:redact(error?.stack)});
  }
  function bind(nextRole, send) { role = nextRole; sender = send; flush(); }
  function receive(message) {
    if (message.t === 'connection-context') {
      context = message.context || {}; record('server-context'); flush(); return true;
    }
    if (message.t === 'connection-report') { exportWaiter?.(message.report); exportWaiter = null; return true; }
    return false;
  }
  async function report() {
    flush(); save();
    let server = null;
    try {
      if (role === 'host') {
        const response = await fetch('/connection-report', {cache: 'no-store', signal: AbortSignal.timeout(5000)});
        if (response.ok) server = await response.json();
      } else if (sender) {
        server = await new Promise(resolve => {
          const timer = setTimeout(() => { exportWaiter = null; resolve(null); }, 5000);
          exportWaiter = value => { clearTimeout(timer); resolve(value); };
          if (!sender({t: 'connection-report'})) { clearTimeout(timer); exportWaiter = null; resolve(null); }
        });
      }
    } catch {}
    return {schema: 2, exportedAt: new Date().toISOString(), role, traceId, context, uploaded, pending: pending.length,
      serverAvailable: !!server, note: 'Connection metadata only. Motion and game data stay on the direct LAN channel.', events: events.slice(), details: details.slice(), server};
  }
  async function download() {
    const data = await report(), url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'}));
    const a = document.createElement('a'); a.href = url; a.download = `inmotion-connection-${context.session || traceId.slice(0, 8)}-${role}.json`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    return data;
  }
  function mount(parent) {
    const section = document.createElement('div'); section.className = 'connection-diagnostics';
    const label = document.createElement('p'), button = document.createElement('button');
    button.type = 'button'; button.textContent = 'Download connection report';
    button.onclick = async () => { button.disabled = true; try { await download(); } finally { button.disabled = false; } };
    section.append(label, button); parent.append(section);
    const paint = () => { label.textContent = `Connection ID: ${context.session || 'waiting for server'} · ${events.length} events captured. Report includes both devices when paired.`; };
    paint(); setInterval(paint, 2000); return section;
  }
  const ua = navigator.userAgent;
  const browser = /CriOS/.test(ua) ? 'Chrome-iOS' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'unknown';
  const version = ua.match(/(?:CriOS|Edg|Chrome|Firefox|Version)\/([\d.]+)/)?.[1] || '';
  globalThis.ConnectionDiagnostics = {record, detail, error, bind, receive, flush, report, download, mount, get context() { return context; }, get events() { return events.slice(); }};
  record('page-start', {browser, version, platform: /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'macOS' : 'other', secure: isSecureContext, online: navigator.onLine, hidden: document.hidden});
  addEventListener('error', e => error(e.target !== window ? 'resource-error' : 'js-error',e.error||{name:'LoadError',message:e.message}, {kind: e.target?.tagName || 'script', line: e.lineno || 0, column: e.colno || 0}), true);
  addEventListener('unhandledrejection', e => error('promise-error', e.reason));
  addEventListener('online', () => record('network-online', {online: true}));
  addEventListener('offline', () => record('network-offline', {online: false}));
  document.addEventListener('visibilitychange', () => { record('visibility', {hidden: document.hidden}); flush(); save(); });
  addEventListener('pagehide', e => { record('page-hide', {persisted: e.persisted}); flush(); save(); });
  addEventListener('pageshow', e => record('page-show', {persisted: e.persisted}));
  setInterval(flush, 1000);
})();
