// api/webhook.js - Stripe webhook listener for guaranteed VIP unlocking
import { getStripe, getStripeWebhookSecret } from './_stripe.js';
import { getCollection } from './_db.js';
import { setCors, readRawBody, rateLimit, clientIp, rateLimited } from './_http.js';

const MIN_PRICE_EUR = Number(process.env.MIN_CHECKOUT_EUR || 1);

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const limit = rateLimit(`webhook:${clientIp(req)}`, 60, 60_000);
  if (!limit.ok) return rateLimited(res, limit.retryAfterSec);

  // 1. Read raw body for Stripe signature validation
  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    console.error('[webhook] Stream read error:', err?.message || err);
    return res.status(400).json({ error: 'Unable to read request body' });
  }

  let event;
  try {
    const webhookSecret = await getStripeWebhookSecret();
    const signature = req.headers['stripe-signature'];

    // SECURITY: never fall back to trusting an unsigned payload. If the secret
    // or the signature header is missing, the event is rejected.
    if (!webhookSecret) {
      console.error('[webhook] STRIPE_WEBHOOK_SECRET is not configured — rejecting event.');
      return res.status(503).json({ error: 'Webhook is not configured' });
    }
    if (!signature) {
      return res.status(400).json({ error: 'Missing stripe-signature header' });
    }
    if (!rawBody || rawBody.length === 0) {
      // The platform already consumed the body, so the signature cannot be verified.
      return res.status(400).json({ error: 'Raw request body unavailable for signature verification' });
    }

    const stripe = await getStripe();
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error('[webhook] Signature verification failed:', err?.message || err);
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  // 2. Handle completed checkout sessions
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    if (session.payment_status === 'paid') {
      const amountTotal = Number(session.amount_total || 0);
      if (amountTotal < Math.round(MIN_PRICE_EUR * 100)) {
        console.error('[webhook] Rejecting session with below-minimum amount:', session.id, amountTotal);
        return res.status(200).json({ received: true, ignored: 'amount_too_low' });
      }

      const meta = session.metadata || {};
      const studentEmail = (meta.studentEmail || session.customer_email || '').trim().toLowerCase();
      const studentName = meta.studentName || session.customer_details?.name || 'Studente Patente B';
      const studentPhone = meta.studentPhone || session.customer_details?.phone || '';
      const codiceFiscale = meta.codiceFiscale || 'REGOLARE';
      const address = meta.address || 'Italia';
      const city = meta.city || 'Bolzano';
      const amount = amountTotal ? amountTotal / 100 : 49.0;
      const transactionId = String(session.payment_intent || session.id);

      const invoicesCol = await getCollection('invoices');
      const existingInvoice = await invoicesCol.findOne({ transactionId }, { projection: { id: 1 } });
      const invoiceNumber = existingInvoice?.id || `PG-2026-${Math.floor(10000 + Math.random() * 90000)}`;
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
        paymentMethodLabel: 'Stripe Webhook (Carta / PostePay / Apple Pay)',
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

      // A. Unlock VIP in MongoDB Atlas (guaranteed even if student closed browser)
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
          console.log(`[Webhook] Student ${studentEmail} unlocked as VIP successfully.`);
        } catch (dbErr) {
          console.error('[Webhook] Failed to update student in MongoDB Atlas:', dbErr);
        }
      }

      // B. Save official invoice in MongoDB Atlas
      try {
        await invoicesCol.updateOne({ transactionId }, { $set: invoice }, { upsert: true });
        console.log(`[Webhook] Invoice ${invoiceNumber} created for ${studentEmail}.`);
      } catch (invErr) {
        console.error('[Webhook] Failed to save invoice in MongoDB Atlas:', invErr);
      }
    }
  }

  return res.status(200).json({ received: true });
}
