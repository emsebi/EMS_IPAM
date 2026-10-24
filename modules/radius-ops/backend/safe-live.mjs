/** Boundary sanitizer: only protocol metadata may leave the RADIUS sidecar. */
const TYPES = new Set(['authentication', 'accounting', 'transport', 'service']);
const RESULTS = new Set(['ACCEPT', 'REJECT', 'DROP', 'START', 'STOP', 'INTERIM', 'INFO']);
const FIELDS = [
  'username', 'sourceIp', 'nasIp', 'nasIdentifier', 'callingStationId',
  'calledStationId', 'framedIpAddress', 'nasPort', 'nasPortId',
  'authMethod', 'clientShortname',
];
const clean = value => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 160)
  : '';

export function safeLiveEvent(event) {
  if (!event || typeof event !== 'object' || !TYPES.has(event.type)) return null;
  const out = {
    type: event.type,
    result: RESULTS.has(event.result) ? event.result : 'INFO',
    seq: Number.isSafeInteger(event.seq) && event.seq >= 0 ? event.seq : 0,
    at: Number.isFinite(event.at) && event.at >= 0 ? event.at : 0,
  };
  for (const field of FIELDS) out[field] = clean(event[field]);
  if (event.type === 'authentication' && out.result === 'REJECT') {
    out.reason = 'authentication rejected';
  } else if (event.type === 'transport' &&
             ['unknown RADIUS client', 'shared secret mismatch'].includes(event.reason)) {
    out.reason = event.reason;
  }
  // Never forward attemptedPassword, passwordAvailable, raw message, or arbitrary reason.
  return out;
}

export function safeLiveDiagnostics(data) {
  const src = data && typeof data === 'object' ? data : {};
  const out = {ok: src.ok === true};
  for (const field of ['running', 'databaseReady', 'configReady', 'processAlive',
    'auth1812Ready', 'accounting1813Ready', 'liveCollectorReady']) {
    out[field] = src[field] === true;
  }
  for (const field of ['liveSubscribers', 'liveBufferedEvents']) {
    out[field] = Number.isSafeInteger(src[field]) && src[field] >= 0 ? src[field] : 0;
  }
  for (const field of ['lastAuthAt', 'lastEventAt']) {
    out[field] = Number.isFinite(src[field]) && src[field] >= 0 ? src[field] : null;
  }
  out.serviceMessages = []; // Raw FreeRADIUS diagnostics are never a public API.
  return out;
}
