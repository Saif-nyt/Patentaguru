// Shared HTTP helpers: CORS, body parsing, rate limiting and safe error responses.

const DEFAULT_ALLOWED_ORIGINS = [
  'https://www.patenteguru.it',
  'https://patenteguru.it',
  'https://patente-bangla-italia.vercel.app',
];

function allowedOrigins(req) {
  const fromEnv = (process.env.SITE_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const host = req.headers.host ? `https://${req.headers.host}` : '';
  return [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...fromEnv, host].filter(Boolean))];
}

/**
 * Reflects only explicitly allowed origins. Never sends `*` together with
 * credentials, and simply omits CORS headers for foreign origins (same-origin
 * browser calls from this app do not need CORS at all).
 */
export function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && allowedOrigins(req).includes(origin.replace(/\/$/, ''))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, X-Admin-Token, X-Requested-With, Accept'
    );
    res.setHeader('Access-Control-Max-Age', '86400');
  }
}

export async function parseBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  try {
    const buffers = [];
    for await (const chunk of req) {
      buffers.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const raw = Buffer.concat(buffers).toString('utf8');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return null;
  }
}

export async function readRawBody(req) {
  if (req.rawBody && Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.rawBody === 'string') return Buffer.from(req.rawBody);
  const buffers = [];
  for await (const chunk of req) {
    buffers.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(buffers);
}

// Best-effort in-memory rate limiter (per serverless instance).
const buckets = globalThis.__rateLimitBuckets || (globalThis.__rateLimitBuckets = new Map());

export function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const bucketKey = `${key}`;
  const entry = buckets.get(bucketKey);
  if (!entry || now - entry.start > windowMs) {
    buckets.set(bucketKey, { start: now, count: 1 });
    return { ok: true, remaining: limit - 1 };
  }
  entry.count += 1;
  if (entry.count > limit) {
    return { ok: false, retryAfterSec: Math.ceil((windowMs - (now - entry.start)) / 1000) };
  }
  if (buckets.size > 5000) buckets.clear();
  return { ok: true, remaining: limit - entry.count };
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

export function rateLimited(res, retryAfterSec) {
  res.setHeader('Retry-After', String(retryAfterSec || 60));
  return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
}

export function serverError(res, label, err) {
  console.error(`[${label}]`, err);
  return res.status(500).json({ error: 'Internal server error' });
}
