import { getCollection } from './_db.js';
import { requireAdmin } from './_auth.js';
import { setCors, parseBody, rateLimit, clientIp, rateLimited, serverError } from './_http.js';

const DEFAULT_SETTINGS = {
  freeRoundsLimit: 20,
  academyPriceEur: 49,
  regularPriceEur: 120,
  promoBannerText: 'অফিসিয়াল ইতালিয়ান লাইসেন্স প্রস্তুতি • প্রথম প্রচেষ্টায় পাশের গ্যারান্টি',
  isPromoActive: false,
  freeMockExams: 1,
};

// Only these keys are readable by the public client and writable by an admin.
const ALLOWED_KEYS = [
  'freeRoundsLimit',
  'academyPriceEur',
  'regularPriceEur',
  'promoBannerText',
  'isPromoActive',
  'freeMockExams',
  'lastUpdated',
];

// Secrets must never be stored in (or served from) the settings document.
const BLOCKED_KEYS = [
  'stripeSecretKey',
  'stripeWebhookSecret',
  'geminiApiKey',
  'adminPassword',
  'password',
  'apiKey',
  'secret',
];

function pickPublicSettings(doc) {
  const out = {};
  for (const key of ALLOWED_KEYS) {
    if (doc && doc[key] !== undefined) out[key] = doc[key];
  }
  return out;
}

function sanitizeSettingsInput(data) {
  const out = {};
  if (Number.isFinite(data.freeRoundsLimit)) {
    out.freeRoundsLimit = Math.min(240, Math.max(0, Math.round(data.freeRoundsLimit)));
  }
  if (Number.isFinite(data.academyPriceEur) && data.academyPriceEur > 0) {
    out.academyPriceEur = Math.min(1000, Math.round(data.academyPriceEur * 100) / 100);
  }
  if (Number.isFinite(data.regularPriceEur) && data.regularPriceEur > 0) {
    out.regularPriceEur = Math.min(2000, Math.round(data.regularPriceEur * 100) / 100);
  }
  if (Number.isFinite(data.freeMockExams)) {
    out.freeMockExams = Math.min(10, Math.max(0, Math.round(data.freeMockExams)));
  }
  if (typeof data.promoBannerText === 'string') out.promoBannerText = data.promoBannerText.slice(0, 300);
  if (typeof data.isPromoActive === 'boolean') out.isPromoActive = data.isPromoActive;
  return out;
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const col = await getCollection('settings');

    if (req.method === 'GET') {
      const limit = rateLimit(`settings:${clientIp(req)}`, 120, 60_000);
      if (!limit.ok) return rateLimited(res, limit.retryAfterSec);

      const doc = await col.findOne({ key: 'app_settings' });
      if (doc) {
        return res.status(200).json({ ...DEFAULT_SETTINGS, ...pickPublicSettings(doc) });
      }
      return res.status(200).json(DEFAULT_SETTINGS);
    }

    if (req.method === 'POST') {
      const admin = await requireAdmin(req);
      if (!admin) {
        return res.status(401).json({ error: 'Admin authentication required' });
      }

      const data = await parseBody(req);
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return res.status(400).json({ error: 'Invalid settings body' });
      }

      for (const blocked of BLOCKED_KEYS) {
        if (blocked in data) {
          return res.status(400).json({ error: `Field "${blocked}" is not allowed` });
        }
      }

      const safeInput = sanitizeSettingsInput(data);
      const existing = (await col.findOne({ key: 'app_settings' })) || {};
      const { _id, key, ...existingRest } = existing;
      const merged = {
        ...DEFAULT_SETTINGS,
        ...pickPublicSettings(existingRest),
        ...safeInput,
        lastUpdated: new Date().toISOString(),
      };

      await col.updateOne(
        { key: 'app_settings' },
        {
          $set: { ...merged, key: 'app_settings' },
          // Clean up any secrets that were previously stored in this document.
          $unset: { stripeSecretKey: '', stripeWebhookSecret: '', geminiApiKey: '', adminPassword: '' },
        },
        { upsert: true }
      );

      return res.status(200).json({ success: true, settings: merged });
    }

    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  } catch (err) {
    return serverError(res, 'settings', err);
  }
}
