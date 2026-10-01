// Preview controls are an explicit local development tool. A query parameter
// must never turn off the real connection or training requirements online.
export function isDevAllowed(page = globalThis.location) {
  if (!page || typeof page.hostname !== 'string') return false;
  const host = page.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const loopback = host === 'localhost' || host === '::1' ||
    /^127(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(host) &&
      host.split('.').every(part => Number(part) <= 255);
  return loopback && new URLSearchParams(page.search || '').get('dev') === '1';
}

export const devAllowed = isDevAllowed();
