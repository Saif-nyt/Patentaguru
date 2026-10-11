import { generateTutorResponse } from './_gemini.js';
import { setCors, parseBody, rateLimit, clientIp, rateLimited, serverError } from './_http.js';

const MAX_PROMPT_LENGTH = 2000;

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // AI calls cost money: limit each client to 10 messages/minute.
    const limit = rateLimit(`ai-tutor:${clientIp(req)}`, 10, 60_000);
    if (!limit.ok) return rateLimited(res, limit.retryAfterSec);

    const body = await parseBody(req);
    const prompt = body?.prompt || body?.query || body?.message;

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'Valid prompt or query is required' });
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      return res.status(400).json({ error: `Message too long (max ${MAX_PROMPT_LENGTH} characters)` });
    }

    const history = Array.isArray(body?.history) ? body.history.slice(-8) : [];
    const reply = await generateTutorResponse(prompt.trim(), history);

    return res.status(200).json({ success: true, reply });
  } catch (err) {
    return serverError(res, 'ai-tutor', err);
  }
}
