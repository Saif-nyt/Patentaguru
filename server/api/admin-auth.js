// Admin login endpoint: exchanges the configured admin password for a signed,
// short-lived admin token. The password hash and admin email list are managed
// from the admin panel (stored in MongoDB); ADMIN_PASSWORD / ADMIN_EMAILS act
// as the bootstrap env fallback. Nothing security-sensitive ships to the
// browser.
import {
  adminAuthConfigured,
  adminEmails,
  adminSecret,
  getAdminPasswordSource,
  hashPassword,
  passwordMatches,
  saveAdminConfig,
  signAdminToken,
  requireAdmin,
} from './_auth.js';
import { setCors, parseBody, rateLimit, clientIp, rateLimited, serverError } from './_http.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const admin = await requireAdmin(req);
      if (!admin) return res.status(401).json({ valid: false });
      return res.status(200).json({
        valid: true,
        email: admin.email,
        emails: await adminEmails(),
        passwordSource: await getAdminPasswordSource(),
      });
    }

    // ---- Change password / manage admin emails (admin session required) ----
    if (req.method === 'PUT') {
      const admin = await requireAdmin(req);
      if (!admin) return res.status(401).json({ valid: false, error: 'Admin session required' });

      const limit = rateLimit(`admin-auth-update:${clientIp(req)}`, 6, 60_000);
      if (!limit.ok) return rateLimited(res, limit.retryAfterSec);

      const body = await parseBody(req);
      const password = typeof body?.password === 'string' ? body.password.trim() : '';
      const emailsRaw = body?.emails;
      const passwordChanged = Boolean(password);
      const emailsChanged = emailsRaw !== undefined;

      if (!passwordChanged && !emailsChanged) {
        return res.status(400).json({ error: 'Nothing to update' });
      }

      if (passwordChanged && (password.length < 8 || password.length > 128)) {
        return res.status(400).json({ error: 'Password must be between 8 and 128 characters' });
      }

      let nextEmails;
      if (emailsChanged) {
        if (!Array.isArray(emailsRaw) || emailsRaw.length === 0 || emailsRaw.length > 10) {
          return res.status(400).json({ error: 'Provide 1 to 10 admin emails' });
        }
        nextEmails = Array.from(
          new Set(emailsRaw.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean))
        );
        for (const email of nextEmails) {
          if (!EMAIL_RE.test(email)) return res.status(400).json({ error: `Invalid email: ${email}` });
        }
        if (nextEmails.length === 0) {
          return res.status(400).json({ error: 'At least one admin email is required' });
        }
        if (!nextEmails.includes(admin.email)) {
          return res
            .status(400)
            .json({ error: 'You cannot remove your own admin email. Add another admin first.' });
        }
      }

      await saveAdminConfig({
        passwordHash: passwordChanged ? hashPassword(password) : undefined,
        emails: emailsChanged ? nextEmails : undefined,
        actorEmail: admin.email,
      });

      return res.status(200).json({
        success: true,
        passwordChanged,
        emailsChanged,
        emails: await adminEmails(),
        passwordSource: 'panel',
      });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!(await adminAuthConfigured())) {
      return res
        .status(503)
        .json({ error: 'Admin login is not configured. Set the ADMIN_PASSWORD environment variable.' });
    }

    const limit = rateLimit(`admin-auth:${clientIp(req)}`, 8, 60_000);
    if (!limit.ok) return rateLimited(res, limit.retryAfterSec);

    const body = await parseBody(req);
    const email = String(body?.email || '').trim().toLowerCase();
    const password = typeof body?.password === 'string' ? body.password : '';

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (!(await adminEmails()).includes(email)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!(await passwordMatches(password, await adminSecret()))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = await signAdminToken(email);
    if (!token) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    return res.status(200).json({ success: true, email, token });
  } catch (err) {
    return serverError(res, 'admin-auth', err);
  }
}
