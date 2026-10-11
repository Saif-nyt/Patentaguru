import { getCollection } from './_db.js';
import { requireAdmin, verifyStudentToken } from './_auth.js';
import { setCors, parseBody, rateLimit, clientIp, rateLimited, serverError } from './_http.js';

// Fields a student may write about their own profile. Privileged flags
// (isVip, transactionId, vipUnlockedAt, ...) can only ever be set by an
// admin token or by the payment/webhook endpoints.
const STUDENT_WRITABLE_FIELDS = [
  'name',
  'displayName',
  'phone',
  'address',
  'city',
  'unlockedRound',
  'totalQuestionsAnswered',
  'completedRounds',
  'mistakeIds',
  'lastLoginAt',
];

function sanitizeStudentWrite(data) {
  const out = {};
  if (typeof data.name === 'string') out.name = data.name.slice(0, 120);
  if (typeof data.displayName === 'string') out.displayName = data.displayName.slice(0, 120);
  if (typeof data.phone === 'string') out.phone = data.phone.slice(0, 40);
  if (typeof data.address === 'string') out.address = data.address.slice(0, 200);
  if (typeof data.city === 'string') out.city = data.city.slice(0, 100);
  if (Number.isFinite(data.unlockedRound)) {
    out.unlockedRound = Math.min(240, Math.max(1, Math.round(data.unlockedRound)));
  }
  if (Number.isFinite(data.totalQuestionsAnswered)) {
    out.totalQuestionsAnswered = Math.max(0, Math.round(data.totalQuestionsAnswered));
  }
  if (data.completedRounds && typeof data.completedRounds === 'object' && !Array.isArray(data.completedRounds)) {
    out.completedRounds = data.completedRounds;
  }
  if (Array.isArray(data.mistakeIds)) {
    out.mistakeIds = data.mistakeIds.filter((id) => typeof id === 'string').slice(0, 5000);
  }
  if (typeof data.lastLoginAt === 'string') out.lastLoginAt = data.lastLoginAt.slice(0, 40);
  if (typeof data.createdAt === 'string') out.createdAt = data.createdAt.slice(0, 40);
  return out;
}

function stripPrivate(doc) {
  const { _id, ...rest } = doc;
  // Never expose stored API keys or other secrets through this endpoint.
  delete rest.stripeSecretKey;
  delete rest.stripeWebhookSecret;
  delete rest.geminiApiKey;
  delete rest.adminPassword;
  return rest;
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const col = await getCollection('students');
    const admin = await requireAdmin(req);
    const student = admin ? null : await verifyStudentToken(req);

    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      const email = (url.searchParams.get('email') || '').trim().toLowerCase();
      const uid = url.searchParams.get('uid');
      const phone = url.searchParams.get('phone');

      // ---- Admin: full read access -------------------------------------
      if (admin) {
        if (email || uid || phone) {
          const filter = email
            ? { email }
            : uid
            ? { uid: String(uid) }
            : { phone: { $regex: String(phone).replace(/\D/g, '').slice(-8) } };
          const doc = await col.findOne(filter);
          if (!doc) return res.status(404).json({ error: 'Student not found' });
          return res.status(200).json({ ...stripPrivate(doc), _id: doc._id.toString() });
        }
        const docs = await col.find({}).sort({ createdAt: -1 }).toArray();
        return res
          .status(200)
          .json(docs.map((d) => ({ ...stripPrivate(d), _id: d._id.toString() })));
      }

      // ---- Logged-in student: own record only --------------------------
      if (student) {
        const ownsEmail = email && student.email && email === student.email;
        const ownsUid = uid && student.uid && String(uid) === student.uid;
        if (ownsEmail || ownsUid || (!email && !uid && !phone)) {
          const filter = ownsEmail ? { email } : { uid: student.uid };
          const doc = await col.findOne(filter);
          if (!doc) return res.status(404).json({ error: 'Student not found' });
          return res.status(200).json({ ...stripPrivate(doc), _id: doc._id.toString() });
        }
        return res.status(403).json({ error: 'Not allowed' });
      }

      // ---- Anonymous: existence probe only (no PII) --------------------
      if (email) {
        const limit = rateLimit(`students-probe:${clientIp(req)}`, 40, 60_000);
        if (!limit.ok) return rateLimited(res, limit.retryAfterSec);
        const exists = await col.findOne({ email }, { projection: { email: 1 } });
        if (!exists) return res.status(404).json({ error: 'Student not found' });
        return res.status(200).json({ exists: true, email });
      }
      if (phone) {
        const limit = rateLimit(`students-probe:${clientIp(req)}`, 40, 60_000);
        if (!limit.ok) return rateLimited(res, limit.retryAfterSec);
        const digits = String(phone).replace(/\D/g, '').slice(-8);
        if (digits.length < 6) return res.status(404).json({ error: 'Student not found' });
        const exists = await col.findOne({ phone: { $regex: digits } }, { projection: { phone: 1 } });
        if (!exists) return res.status(404).json({ error: 'Student not found' });
        return res.status(200).json({ exists: true, phone: exists.phone });
      }

      return res.status(401).json({ error: 'Authentication required' });
    }

    if (req.method === 'POST') {
      const data = await parseBody(req);
      if (!data || typeof data !== 'object') {
        return res.status(400).json({ error: 'Invalid or missing JSON payload' });
      }

      // ---- Admin: full upserts (including VIP grants) ------------------
      if (admin) {
        const items = Array.isArray(data) ? data : [data];
        let count = 0;
        for (const item of items) {
          if (!item || typeof item !== 'object') continue;
          const email = item.email ? String(item.email).trim().toLowerCase() : null;
          const uid = item.uid ? String(item.uid) : null;
          if (!email && !uid) continue;
          const filter = email ? { email } : { uid };
          const { createdAt, _id, ...rest } = item;
          if (email) rest.email = email;
          await col.updateOne(
            filter,
            {
              $set: { ...rest, updatedAt: new Date().toISOString() },
              $setOnInsert: { createdAt: createdAt || new Date().toISOString() },
            },
            { upsert: true }
          );
          count += 1;
        }
        return res.status(200).json({ success: true, count });
      }

      // ---- Student: single self-update with whitelisted fields ---------
      if (student) {
        if (Array.isArray(data)) {
          return res.status(403).json({ error: 'Bulk updates require admin access' });
        }
        const selfEmail = student.email;
        if (!selfEmail) {
          return res.status(403).json({ error: 'Account email required' });
        }
        const providedEmail = data.email ? String(data.email).trim().toLowerCase() : selfEmail;
        if (providedEmail !== selfEmail) {
          return res.status(403).json({ error: 'Not allowed' });
        }
        const safe = sanitizeStudentWrite(data);
        await col.updateOne(
          { email: selfEmail },
          {
            $set: {
              ...safe,
              email: selfEmail,
              uid: student.uid,
              updatedAt: new Date().toISOString(),
            },
            $setOnInsert: { createdAt: new Date().toISOString(), isVip: false },
          },
          { upsert: true }
        );
        return res.status(200).json({ success: true, student: { ...safe, email: selfEmail } });
      }

      return res.status(401).json({ error: 'Authentication required' });
    }

    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  } catch (err) {
    return serverError(res, 'students', err);
  }
}
