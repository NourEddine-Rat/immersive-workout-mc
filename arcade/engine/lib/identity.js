// LAN consoles may use HTTP, where randomUUID is unavailable.
export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    return [...bytes].map((n,i) => ([4,6,8,10].includes(i)?'-':'') + n.toString(16).padStart(2,'0')).join('');
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
