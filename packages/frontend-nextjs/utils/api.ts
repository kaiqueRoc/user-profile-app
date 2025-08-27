export function getApi() {
  // Prefer build-time env; sanitize literal string values some bundlers inject
  const raw = typeof process !== 'undefined' ? (process.env.NEXT_PUBLIC_API_URL as any) : '';
  const env = raw && raw !== 'undefined' && raw !== 'null' ? String(raw).trim() : '';
  if (env) return env.replace(/\/+$/, '');
  // Browser fallback (dev / no env injected yet)
  if (typeof window !== 'undefined') {
    const proto = window.location.protocol || 'http:';
    const host = window.location.hostname || 'localhost';
    return `${proto}//${host}:3001`;
  }
  // Server-side (SSR/build) fallback so pre-rendered pages still have a base
  return 'http://localhost:3001';
}

// Derive websocket base (ws or wss) aligning with API fallback logic
export function getWsUrl() {
  const raw = typeof process !== 'undefined' ? (process.env.NEXT_PUBLIC_WS_URL as any) : '';
  const env = raw && raw !== 'undefined' && raw !== 'null' ? String(raw).trim() : '';
  if (env) return env.replace(/\/+$/, '');
  if (typeof window !== 'undefined') {
    const secure = window.location.protocol === 'https:';
    const host = window.location.hostname || 'localhost';
    // assume ws server co-located on api gateway port 3001 unless overridden
    return `${secure ? 'wss' : 'ws'}://${host}:3001/ws`;
  }
  return '';
}
