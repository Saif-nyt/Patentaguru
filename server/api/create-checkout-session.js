import { getStripe } from './_stripe.js';
import { getCollection } from './_db.js';
import { setCors, parseBody, rateLimit, clientIp, rateLimited, serverError } from './_http.js';

const DEFAULT_PRICE_EUR = 49;
const MIN_PRICE_EUR = Number(process.env.MIN_CHECKOUT_EUR || 1);

async function resolveServerPriceEur() {
  let priceEur = DEFAULT_PRICE_EUR;
  try {
    const settingsCol = await getCollection('settings');
    const settingsDoc = await settingsCol.findOne({ key: 'app_settings' });
    if (
      settingsDoc &&
      typeof settingsDoc.academyPriceEur === 'number' &&
      settingsDoc.academyPriceEur > 0
    ) {
      priceEur = settingsDoc.academyPriceEur;
    }
  } catch (e) {
    console.warn('Could not read price from settings, using default price:', e?.message || e);
  }
  // Guard against a mis-configured (near-zero) price.
  if (!Number.isFinite(priceEur) || priceEur < MIN_PRICE_EUR) {
    priceEur = Math.max(DEFAULT_PRICE_EUR, MIN_PRICE_EUR);
  }
  return priceEur;
}

function resolveOrigin(req) {
  const allowed = (process.env.SITE_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean)
    .concat(['https://www.patenteguru.it', 'https://patenteguru.it']);

  const origin = req.headers.origin ? String(req.headers.origin).replace(/\/$/, '') : '';
  if (origin && allowed.includes(origin)) return origin;
  if (req.headers.host) {
    const hostOrigin = `https://${req.headers.host}`;
    if (allowed.includes(hostOrigin)) return hostOrigin;
  }
  return allowed[0];
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const limit = rateLimit(`checkout:${clientIp(req)}`, 10, 60_000);
    if (!limit.ok) return rateLimited(res, limit.retryAfterSec);

    const stripe = await getStripe();
    const body = await parseBody(req);
    if (!body) {
      return res.status(400).json({ error: 'Missing request body' });
    }

    const {
      studentName = 'Studente Patente B',
      studentEmail,
      studentPhone = '',
      codiceFiscale = '',
      address = '',
      city = 'Bolzano',
    } = body;

    if (!studentEmail || !studentEmail.includes('@')) {
      return res.status(400).json({ error: 'Valid student email is required' });
    }

    // SECURITY: the price always comes from the server (DB settings), never
    // from the request body — a client-supplied priceEur is ignored on purpose.
    const priceEur = await resolveServerPriceEur();
    const origin = resolveOrigin(req);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card', 'link'],
      mode: 'payment',
      customer_email: studentEmail.trim().toLowerCase(),
      client_reference_id: studentEmail.trim().toLowerCase(),
      line_items: [
        {
          price_data: {
            currency: 'eur',
            unit_amount: Math.round(priceEur * 100),
            product_data: {
              name: 'Corso Completo Patente B 2026 - PatenteGuru.it',
              description:
                'Accesso Illimitato a 240 Round con spiegazioni in Bengali, Simulatore Orale e Assistenza Didattica fino al superamento dell’esame.',
              images: ['https://www.patenteguru.it/patente-guru-logo.jpg'],
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        studentName: String(studentName).trim().slice(0, 120),
        studentEmail: studentEmail.trim().toLowerCase(),
        studentPhone: String(studentPhone).trim().slice(0, 40),
        codiceFiscale: String(codiceFiscale || '').trim().toUpperCase().slice(0, 30),
        address: String(address).trim().slice(0, 200),
        city: String(city).trim().slice(0, 100),
        amount: String(priceEur),
      },
      success_url: `${origin}/?payment_success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?payment_cancelled=true`,
    });

    return res.status(200).json({
      success: true,
      url: session.url,
      sessionId: session.id,
    });
  } catch (err) {
    return serverError(res, 'create-checkout-session', err);
  }
}
