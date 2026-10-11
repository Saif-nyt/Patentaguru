import Stripe from 'stripe';
import fs from 'fs';
import path from 'path';

let cachedStripeKey = '';

async function getStripeSecretKey() {
  if (process.env.STRIPE_SECRET_KEY) {
    return process.env.STRIPE_SECRET_KEY.trim();
  }

  if (cachedStripeKey) {
    return cachedStripeKey;
  }

  // Gracefully fallback to local .env in development
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const match = content.match(/STRIPE_SECRET_KEY\s*=\s*([^\s\r\n]+)/);
      if (match && match[1]) {
        cachedStripeKey = match[1].trim();
        return cachedStripeKey;
      }
    }
  } catch {}

  return '';
}

let cachedWebhookSecret = '';

export async function getStripeWebhookSecret() {
  if (process.env.STRIPE_WEBHOOK_SECRET) {
    return process.env.STRIPE_WEBHOOK_SECRET.trim();
  }

  if (cachedWebhookSecret) {
    return cachedWebhookSecret;
  }

  // Gracefully fallback to local .env in development
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const match = content.match(/STRIPE_WEBHOOK_SECRET\s*=\s*([^\s\r\n]+)/);
      if (match && match[1]) {
        cachedWebhookSecret = match[1].trim();
        return cachedWebhookSecret;
      }
    }
  } catch {}

  return '';
}

export async function getStripe() {
  const secretKey = await getStripeSecretKey();
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured in environment variables or database');
  }
  return new Stripe(secretKey);
}
