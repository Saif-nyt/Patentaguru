import { getStripe } from './_stripe.js';
import { getCollection } from './_db.js';
import { setCors, rateLimit, clientIp, rateLimited, serverError } from './_http.js';

const DEFAULT_PRICE_EUR = 49;
const MIN_PRICE_EUR = Number(process.env.MIN_CHECKOUT_EUR || 1);

async function expectedPriceEur() {
  try {
    const settingsCol = await getCollection('settings');
    const doc = await settingsCol.findOne({ key: 'app_settings' });
    if (doc && typeof doc.academyPriceEur === 'number' && doc.academyPriceEur > 0) {
      return doc.academyPriceEur;
    }
  } catch {}
  return DEFAULT_PRICE_EUR;
}

async function nextInvoiceNumber(invoicesCol, transactionId) {
  // Keep the invoice number stable across repeated verifications of the same session.
  const existing = await invoicesCol.findOne({ transactionId }, { projection: { id: 1 } });
  if (existing?.id) return existing.id;
  return `PG-2026-${Math.floor(10000 + Math.random() * 90000)}`;
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const limit = rateLimit(`verify-payment:${clientIp(req)}`, 30, 60_000);
    if (!limit.ok) return rateLimited(res, limit.retryAfterSec);

    const stripe = await getStripe();
    let sessionId = null;
    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      sessionId = url.searchParams.get('session_id') || url.searchParams.get('sessionId');
    } else if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch {}
      }
      sessionId = body?.sessionId || body?.session_id;
    }

    if (!sessionId || typeof sessionId !== 'string' || !sessionId.startsWith('cs_')) {
      return res.status(400).json({ error: 'Missing session_id parameter' });
    }

    // Session data is read straight from Stripe, so it cannot be forged by the client.
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid') {
      return res.status(200).json({
        success: false,
        paid: false,
        status: session.payment_status,
      });
    }

    // ---- Amount sanity checks -----------------------------------------
    const amountTotal = Number(session.amount_total || 0);
    const metaAmount = Number(session.metadata?.amount);
    const minCents = Math.round(Math.max(MIN_PRICE_EUR, 0) * 100);

    if (amountTotal < minCents) {
      console.warn('[verify-payment] rejected session with below-minimum amount:', sessionId, amountTotal);
      return res.status(402).json({ error: 'Payment amount does not match the course price' });
    }
    if (Number.isFinite(metaAmount) && metaAmount > 0) {
      const expectedCents = Math.round(metaAmount * 100);
      if (amountTotal < expectedCents) {
        console.warn('[verify-payment] rejected underpaid session:', sessionId, amountTotal, expectedCents);
        return res.status(402).json({ error: 'Payment amount does not match the course price' });
      }
    } else {
      // Sessions created by the fixed checkout endpoint always carry metadata.amount.
      const serverPrice = await expectedPriceEur();
      if (amountTotal < Math.round(serverPrice * 100)) {
        console.warn('[verify-payment] rejected session below current price:', sessionId, amountTotal);
        return res.status(402).json({ error: 'Payment amount does not match the course price' });
      }
    }

    const meta = session.metadata || {};
    const studentEmail = (meta.studentEmail || session.customer_email || '').trim().toLowerCase();
    const studentName = meta.studentName || session.customer_details?.name || 'Studente Patente B';
    const studentPhone = meta.studentPhone || session.customer_details?.phone || '';
    const codiceFiscale = meta.codiceFiscale || 'REGOLARE';
    const address = meta.address || 'Italia';
    const city = meta.city || 'Bolzano';
    const amount = amountTotal ? amountTotal / 100 : DEFAULT_PRICE_EUR;
    const transactionId = String(session.payment_intent || session.id);

    const invoicesCol = await getCollection('invoices');
    const invoiceNumber = await nextInvoiceNumber(invoicesCol, transactionId);
    const now = new Date();
    const formattedDate = now.toLocaleDateString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const invoice = {
      id: invoiceNumber,
      date: now.toISOString(),
      formattedDate,
      studentName,
      studentEmail,
      studentPhone,
      codiceFiscale,
      address,
      city,
      amount,
      currency: 'EUR',
      taxExemptionNote:
        "Operazione didattico-formativa esente da IVA ai sensi dell'art. 10, comma 1, n. 20 del D.P.R. 633/1972.",
      paymentMethod: 'card',
      paymentMethodLabel: 'Stripe Checkout (Carta / PostePay / Apple Pay)',
      transactionId,
      status: 'PAGATO',
      courseDescription:
        "Corso Completo Ufficiale Patente B 2026 - Accesso Illimitato a tutti i 240 Round con spiegazioni in Bengali, Simulatore Orale e Assistenza Didattica.",
      issuer: {
        name: 'PatenteGuru.it / Patente Bangla Italia',
        brand: 'PatenteGuru Autoscuola Digitale',
        instructor: 'Shifat Manjum (Founder & Lead Instructor)',
        location: 'Bolzano (BZ), Trentino-Alto Adige, Italia',
        email: 'khshifat@gmail.com',
        website: 'https://patenteguru.it',
      },
    };

    // 1. Update student in MongoDB Atlas to VIP (all 240 rounds unlocked)
    if (studentEmail) {
      try {
        const studentsCol = await getCollection('students');
        await studentsCol.updateOne(
          { email: studentEmail },
          {
            $set: {
              name: studentName,
              phone: studentPhone || undefined,
              isVip: true,
              vipUnlockedAt: now.toISOString(),
              transactionId,
              updatedAt: now.toISOString(),
            },
            $setOnInsert: {
              uid: 'std_' + Date.now(),
              email: studentEmail,
              unlockedRound: 1,
              totalQuestionsAnswered: 0,
              completedRounds: {},
              mistakeIds: [],
              createdAt: now.toISOString(),
            },
          },
          { upsert: true }
        );
      } catch (dbErr) {
        console.warn('MongoDB Atlas student update warning on payment verification:', dbErr);
      }
    }

    // 2. Save invoice in MongoDB Atlas (idempotent per transaction)
    try {
      await invoicesCol.updateOne({ transactionId }, { $set: invoice }, { upsert: true });
    } catch (invErr) {
      console.warn('MongoDB Atlas invoice save warning:', invErr);
    }

    return res.status(200).json({
      success: true,
      paid: true,
      studentEmail,
      studentName,
      transactionId,
      invoice,
    });
  } catch (err) {
    return serverError(res, 'verify-payment', err);
  }
}
