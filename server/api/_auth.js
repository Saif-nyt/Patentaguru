// Server-side authentication helpers.
//
// - Admin sessions: HMAC-signed short-lived tokens. The admin password hash
//   and admin email list live in MongoDB (`settings.admins` doc) so they can
//   be changed from the admin panel; the ADMIN_PASSWORD / ADMIN_EMAILS env
//   vars act as the bootstrap fallback when the panel config is not set yet.
// - Student sessions: Better Auth session cookies.

import crypto from 'crypto';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../../src/lib/auth';
import { getCollection } from './_db.js';

const DEFAULT_ADMIN_EMAILS = [
  'khshifat@gmail.com',
  'khshifatmanjum@gmail.com',
  'saifulislamnyt@gmail.com',
];

const ADMIN_CONFIG_ID = 'admins';
const ADMIN_CONFIG_TTL_MS = 30_000;

let adminConfigCache = { state: null, fetchedAt: 0 };

function parseEnvEmails() {
  const raw = process.env.ADMIN_EMAILS;
  if (raw && raw.trim()) {
    return raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
  return [...DEFAULT_ADMIN_EMAILS];
}

function normalizeEmails(list) {
  return Array.from(
    new Set(
      (Array.isArray(list) ? list : [])
        .map((s) => String(s || '').trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

/** Effective admin config: panel (MongoDB) wins over env fallback. */
async function loadAdminState() {
  const now = Date.now();
  if (adminConfigCache.state && now - adminConfigCache.fetchedAt < ADMIN_CONFIG_TTL_MS) {
    return adminConfigCache.state;
  }

  let dbState = null;
  try {
    const col = await getCollection('settings');
    const doc = await col.findOne({ _id: ADMIN_CONFIG_ID });
    if (doc && (doc.passwordHash || Array.isArray(doc.emails))) {
      dbState = {
        passwordHash: typeof doc.passwordHash === 'string' && doc.passwordHash ? doc.passwordHash : '',
        emails: normalizeEmails(doc.emails),
      };
    }
  } catch {
    dbState = null;
  }

  const envPassword = (process.env.ADMIN_PASSWORD || '').trim();
  const envHash = envPassword ? sha256(envPassword) : '';
  const state = {
    passwordHash: (dbState && dbState.passwordHash) || envHash,
    passwordSource: dbState && dbState.passwordHash ? 'panel' : envHash ? 'env' : 'none',
    emails: dbState && dbState.emails.length ? dbState.emails : parseEnvEmails(),
  };

  adminConfigCache = { state, fetchedAt: now };
  return state;
}

export function invalidateAdminConfigCache() {
  adminConfigCache = { state: null, fetchedAt: 0 };
}

/** Persist panel-managed admin fields (password hash and/or email list). */
export async function saveAdminConfig({ passwordHash, emails, actorEmail }) {
  const col = await getCollection('settings');
  const update = { updatedAt: new Date().toISOString(), updatedBy: String(actorEmail || '').toLowerCase() };
  if (typeof passwordHash === 'string' && passwordHash) update.passwordHash = passwordHash;
  if (emails) update.emails = normalizeEmails(emails);
  await col.updateOne({ _id: ADMIN_CONFIG_ID }, { $set: update }, { upsert: true });
  invalidateAdminConfigCache();
}

export async function adminEmails() {
  return (await loadAdminState()).emails;
}

export async function passwordMatches(provided, passwordHash) {
  if (typeof provided !== 'string' || typeof passwordHash !== 'string' || !passwordHash) return false;
  return timingSafeEqualStr(sha256(provided), passwordHash);
}

export { sha256 as hashPassword };

function hmac(secret, value) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export async function adminSecret() {
  return (await loadAdminState()).passwordHash;
}

export async function adminAuthConfigured() {
  return Boolean((await loadAdminState()).passwordHash);
}

export async function getAdminPasswordSource() {
  return (await loadAdminState()).passwordSource;
}

const ADMIN_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

export async function signAdminToken(email) {
  const secret = await adminSecret();
  if (!secret) return null;
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!(await adminEmails()).includes(cleanEmail)) return null;
  const exp = Date.now() + ADMIN_TOKEN_TTL_MS;
  const payload = `${exp}.${cleanEmail}`;
  return `${payload}.${hmac(secret, payload)}`;
}

export async function verifyAdminToken(token) {
  const secret = await adminSecret();
  if (!secret || !token || typeof token !== 'string') return null;
  const firstDot = token.indexOf('.');
  const lastDot = token.lastIndexOf('.');
  if (firstDot <= 0 || lastDot <= firstDot + 1 || lastDot >= token.length - 1) return null;
  const expRaw = token.slice(0, firstDot);
  const email = token.slice(firstDot + 1, lastDot);
  const sig = token.slice(lastDot + 1);
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  if (!timingSafeEqualStr(sig, hmac(secret, `${expRaw}.${email}`))) return null;
  const cleanEmail = String(email || '').toLowerCase();
  if (!(await adminEmails()).includes(cleanEmail)) return null;
  return { email: cleanEmail };
}

/** Returns { email } when the request carries a valid admin token, otherwise null. */
export async function requireAdmin(req) {
  const header = req.headers['x-admin-token'] || req.headers['X-Admin-Token'];
  return verifyAdminToken(typeof header === 'string' ? header : '');
}

/** Returns the verified Better Auth user for a request, or null. */
export async function verifyStudentToken(req) {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user?.id || !user.email || user.emailVerified !== true) return null;

    return {
      uid: String(user.id),
      email: user.email.trim().toLowerCase(),
      emailVerified: user.emailVerified,
    };
  } catch (err) {
    console.warn('[auth] Better Auth session verification failed:', err?.message || err);
    return null;
  }
}
