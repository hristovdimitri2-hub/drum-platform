/**
 * Stripe Connect service
 *
 * Handles:
 *   - Create auth-only PaymentIntent (escrow freeze)
 *   - Capture + split payout (carrier 80%, DRUM 15%, insurance 5%)
 *   - Create Connect Express account (for carriers)
 *   - Verify webhook signatures
 *
 * Best practice: stripe/stripe-node (https://github.com/stripe/stripe-node)
 */

const crypto = require('node:crypto');
const Stripe = require('stripe');
const money = require('./money');

const DEMO_MODE = String(process.env.DEMO_MODE || '').toLowerCase() === 'true';
const API_VERSION = '2025-08-27.basil';

function secretKey() {
  return process.env.STRIPE_SECRET_KEY || '';
}

let stripe = null;
if (!DEMO_MODE && secretKey()) {
  stripe = Stripe(secretKey(), { apiVersion: API_VERSION });
}

/**
 * Guard: DRUM MVP must NEVER run with live keys.
 *
 * P0 hardening (previously `if (DEMO_MODE) return;` made this a no-op whenever
 * demo mode was on — a live key could sit in the environment and every
 * assertTestMode() call would silently pass).
 *
 * The invariant is now enforced UNCONDITIONALLY, in every mode: if
 * STRIPE_SECRET_KEY is present it MUST be a Stripe TEST key. DEMO_MODE excuses
 * only the ABSENCE of a key — never the presence of a live one.
 *
 * Prefix checks are case-insensitive and reject RESTRICTED live keys too:
 * `rk_live_...` used to slip through a bare `startsWith('sk_test')` check.
 */
const ALLOWED_SECRET_PREFIX = 'sk_test';
const REAL_KEY_PREFIXES = ['sk_live', 'rk_live', 'pk_live', 'sk_prod'];

function keyKind(key) {
  const k = String(key || '').trim().toLowerCase();
  if (!k) return 'absent';
  if (REAL_KEY_PREFIXES.some((p) => k.startsWith(p))) return 'live';
  if (k.startsWith(ALLOWED_SECRET_PREFIX)) return 'test';
  return 'unknown';
}

function assertTestMode() {
  assertTestModeFor({ key: secretKey(), demoMode: DEMO_MODE });
}

/**
 * Pure core of the guard — takes its inputs explicitly so the DEMO_MODE /
 * key matrix can be unit-tested without reloading the module (DEMO_MODE is read
 * once at load time). `assertTestMode()` is the thin live wrapper.
 *
 * @param {{key?: string, demoMode?: boolean}} args
 * @throws {Error} when the configured key is not a Stripe TEST key
 */
function assertTestModeFor({ key, demoMode } = {}) {
  const kind = keyKind(key);
  if (kind === 'test') return 'test';
  if (kind === 'absent') {
    if (demoMode) return 'absent-demo'; // no key at all — nothing can be charged
    throw new Error(
      'REFUSING to run: STRIPE_SECRET_KEY is missing outside DEMO_MODE. ' +
        'DRUM runs with sk_test_... keys or with DEMO_MODE=true.'
    );
  }
  if (kind === 'live') {
    throw new Error(
      'REFUSING to run: STRIPE_SECRET_KEY is a LIVE key. ' +
        'DRUM MVP runs in Stripe TEST mode only. Use sk_test_... keys. ' +
        '(DEMO_MODE does not excuse a live key.)'
    );
  }
  throw new Error(
    'REFUSING to run: STRIPE_SECRET_KEY has an unrecognised prefix. ' +
      'DRUM MVP runs in Stripe TEST mode only. Use sk_test_... keys.'
  );
}

/**
 * Unsigned webhook payloads are OFF by default in every mode.
 *
 * Historically verifyWebhook() returned JSON.parse(payload) whenever DEMO_MODE
 * was true, so any public demo deployment accepted forged Stripe events from
 * anyone on the internet. That escape hatch now requires TWO explicit opt-ins
 * (DEMO_MODE=true AND ALLOW_UNSIGNED_WEBHOOKS=true) and is meant for
 * local/keyless demos only.
 */
function unsignedWebhooksAllowed() {
  return DEMO_MODE && String(process.env.ALLOW_UNSIGNED_WEBHOOKS || '').toLowerCase() === 'true';
}

/**
 * HMAC verification matching Stripe's own scheme
 * (header `t=<unix>,v1=HMAC-SHA256(secret, "<t>.<payload>")`).
 * Used in DEMO_MODE so demo deployments still get real integrity checking
 * instead of accepting anything.
 */
function verifyDemoSignature(payload, signature, secret) {
  if (typeof signature !== 'string' || !signature) {
    throw new Error('Missing stripe-signature header');
  }
  const parts = {};
  for (const kv of signature.split(',')) {
    const i = kv.indexOf('=');
    if (i > 0) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) throw new Error('Malformed stripe-signature header');
  const expected = crypto
    .createHmac('sha256', secret)
    .update(t + '.' + payload.toString('utf8'))
    .digest('hex');
  const a = Buffer.from(v1);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('No signatures found matching the expected signature for payload');
  }
  return JSON.parse(payload.toString('utf8'));
}

let demoCounter = 0;

/**
 * Create auth-only PaymentIntent (escrow freeze).
 * In DEMO_MODE no network call is made — a simulated PI is returned.
 * Money is reserved but NOT captured until delivery QR is scanned.
 */
async function createEscrowCharge({ amount, customerId, description, metadata }) {
  assertTestMode();

  if (DEMO_MODE) {
    demoCounter += 1;
    const id = `pi_demo_${String(demoCounter).padStart(6, '0')}`;
    console.log(`[DEMO] Stripe escrow auth: ${id} for €${(amount / 100).toFixed(2)}`);
    return {
      success: true,
      demo: true,
      paymentIntentId: id,
      clientSecret: `${id}_secret_demo`,
      status: 'requires_capture',
    };
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount, // in cents
      currency: 'eur',
      customer: customerId,
      capture_method: 'manual', // auth-only
      description,
      metadata,
      automatic_payment_methods: { enabled: true },
    });

    return {
      success: true,
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      status: paymentIntent.status,
    };
  } catch (err) {
    console.error('Stripe escrow error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Checkout — the client-side payment step (Stripe TEST mode).
 *
 * Returns a clientSecret for the shipment's EXISTING escrow PaymentIntent
 * (retrieved server-side — no duplicate authorisation), creating a fresh
 * auth-only intent only when there is none (or retrieval fails).
 *
 * - assertTestMode() runs FIRST: an sk_live key is refused before any call.
 * - DEMO_MODE: fully simulated (pi_demo_*), ZERO network calls.
 * - Amount arrives in cents from the caller (stored shipment value);
 *   NO money math happens here — the 80/15/5 split stays in money.js
 *   and is applied at CAPTURE time, not at checkout.
 */
async function createCheckoutIntent({ amountCents, existingPaymentIntentId, description, metadata }) {
  assertTestMode();

  if (DEMO_MODE) {
    if (existingPaymentIntentId && String(existingPaymentIntentId).startsWith('pi_demo_')) {
      return {
        success: true,
        demo: true,
        paymentIntentId: existingPaymentIntentId,
        clientSecret: `${existingPaymentIntentId}_secret_demo`,
        status: 'requires_capture',
      };
    }
    return createEscrowCharge({ amount: amountCents, description, metadata });
  }

  // Live-test mode: reuse the existing intent when possible.
  if (existingPaymentIntentId && String(existingPaymentIntentId).startsWith('pi_')) {
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(existingPaymentIntentId);
      return {
        success: true,
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        status: paymentIntent.status,
      };
    } catch (err) {
      console.error('Stripe checkout retrieve error (falling back to a fresh intent):', err.message);
    }
  }

  return createEscrowCharge({ amount: amountCents, description, metadata });
}

/**
 * Capture payment and split payout to carrier.
 * Split of the captured total: 80% carrier (Connect transfer),
 * 15% DRUM (stays in platform balance), 5% insurance pool.
 */
async function captureAndSplit({ paymentIntentId, carrierConnectAccountId, totalEur }) {
  assertTestMode();

  const totalCents = money.eurToCents(totalEur);
  // B8.1/B8.2 canon (see finance.js: "T = the captured amount the 80/15/5
  // split runs on"): the CAPTURED amount IS the ticket, and the split runs on
  // it. There is no separate "ticketEur".
  //
  // P1 fix — the VAT leg used to be `totalCents − (carrier + drum + insurance)`,
  // which is identically 0 by construction (money.splitAmounts always sums to
  // the total). It was therefore dead code that silently reported €0.00 VAT
  // and disagreed with finance.js/b2b.js, which both derive VAT as
  // `vatOnDrumFee(drumCents)` — 20% owed ON TOP of the DRUM fee and absorbed
  // out of that fee. The capture path now uses the same canonical helper, so
  // the transaction record and the financial model finally agree.
  const split = money.splitAmounts(totalCents);
  const carrierAmountCents = split.carrierCents;
  const vatCents = money.vatOnDrumFee(split.drumCents).vatCents;

  const splitEur = {
    carrierPayoutEur: money.centsToEur(split.carrierCents),
    drumRevenueEur: money.centsToEur(split.drumCents),
    insurancePoolEur: money.centsToEur(split.insuranceCents),
    vatEur: money.centsToEur(vatCents),
  };
  const splitCents = {
    totalCents,
    carrierCents: split.carrierCents,
    drumCents: split.drumCents,
    insuranceCents: split.insuranceCents,
    vatCents,
  };

  if (DEMO_MODE || paymentIntentId.startsWith('pi_demo_')) {
    console.log(
      `[DEMO] Stripe capture+split: ${paymentIntentId} — carrier €${splitEur.carrierPayoutEur.toFixed(2)}, ` +
        `DRUM €${splitEur.drumRevenueEur.toFixed(2)}, insurance €${splitEur.insurancePoolEur.toFixed(2)}`
    );
    return {
      success: true,
      demo: true,
      captureId: `ch_demo_${paymentIntentId.replace('pi_demo_', '')}`,
      transferId: carrierConnectAccountId ? `tr_demo_${paymentIntentId.replace('pi_demo_', '')}` : null,
      splitCents,
      ...splitEur,
    };
  }

  try {
    // 1. Capture the full amount
    const capture = await stripe.paymentIntents.capture(paymentIntentId, {
      amount_to_capture: totalCents,
    });

    // 2. Transfer carrier's 80% via Stripe Connect
    let transferId = null;
    if (carrierConnectAccountId) {
      const transfer = await stripe.transfers.create({
        amount: carrierAmountCents,
        currency: 'eur',
        destination: carrierConnectAccountId,
        transfer_group: paymentIntentId,
      });
      transferId = transfer.id;
    } else {
      // MVP: if carrier has no Connect account, log for manual payout
      console.warn(
        `⚠️ Carrier has no Connect account. Manual payout needed: €${(carrierAmountCents / 100).toFixed(2)} for PI ${paymentIntentId}`
      );
    }

    return {
      success: true,
      captureId: capture.id,
      transferId,
      splitCents,
      ...splitEur,
    };
  } catch (err) {
    console.error('Stripe capture+split error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Create Stripe Connect Express account for carrier
 * Carrier must complete KYC via Stripe hosted onboarding
 */
async function createCarrierConnectAccount({ telegramId, email, country = 'BG' }) {
  if (DEMO_MODE) {
    demoCounter += 1;
    const id = `acct_demo_${String(demoCounter).padStart(6, '0')}`;
    console.log(`[DEMO] Stripe Connect account created: ${id}`);
    return {
      success: true,
      demo: true,
      accountId: id,
      onboardingUrl: `${process.env.APP_URL || 'http://localhost:3000'}/demo/stripe-onboarding`,
    };
  }

  try {
    const account = await stripe.accounts.create({
      type: 'express',
      country,
      email,
      metadata: { telegram_id: String(telegramId) },
      capabilities: {
        transfers: { requested: true },
      },
    });

    // Generate onboarding link
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${process.env.APP_URL}/stripe/refresh`,
      return_url: `${process.env.APP_URL}/stripe/return`,
      type: 'account_onboarding',
    });

    return {
      success: true,
      accountId: account.id,
      onboardingUrl: accountLink.url,
    };
  } catch (err) {
    console.error('Stripe Connect account creation error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Create or retrieve Stripe Customer for sender
 */
async function createCustomer({ telegramId, email, name, phone }) {
  if (DEMO_MODE) {
    demoCounter += 1;
    const id = `cus_demo_${String(demoCounter).padStart(6, '0')}`;
    console.log(`[DEMO] Stripe customer created: ${id}`);
    return { success: true, demo: true, customerId: id };
  }

  try {
    const customer = await stripe.customers.create({
      email,
      name,
      phone,
      metadata: { telegram_id: String(telegramId) },
    });
    return { success: true, customerId: customer.id };
  } catch (err) {
    console.error('Stripe customer creation error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Refund (cancel shipment before pickup)
 */
async function refundEscrow(paymentIntentId, amountEur = null) {
  if (DEMO_MODE || paymentIntentId.startsWith('pi_demo_')) {
    console.log(`[DEMO] Stripe refund: ${paymentIntentId}`);
    return { success: true, demo: true, refundId: `re_demo_${paymentIntentId.replace('pi_demo_', '')}`, amount: amountEur };
  }

  try {
    const refundData = { payment_intent: paymentIntentId };
    if (amountEur) {
      refundData.amount = Math.round(amountEur * 100);
    }
    const refund = await stripe.refunds.create(refundData);
    return { success: true, refundId: refund.id, amount: refund.amount };
  } catch (err) {
    console.error('Stripe refund error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Verify a Stripe webhook. Signature verification is MANDATORY.
 *
 * - Non-demo (default): Stripe's own `constructEvent` against
 *   STRIPE_WEBHOOK_SECRET. Unsigned/forged payloads are rejected.
 * - DEMO_MODE: unsigned payloads are rejected UNLESS
 *   ALLOW_UNSIGNED_WEBHOOKS=true. If STRIPE_WEBHOOK_SECRET is configured the
 *   HMAC signature is verified instead, so demo deployments get real integrity
 *   checking too.
 *
 * @throws {Error} when there is no valid signature / no verification material
 */
function verifyWebhook(payload, signature) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (DEMO_MODE) {
    if (secret) return verifyDemoSignature(payload, signature, secret);
    if (unsignedWebhooksAllowed()) {
      console.warn(
        '⚠️  ALLOW_UNSIGNED_WEBHOOKS=true — accepting an UNSIGNED webhook. ' +
          'Local demos only; never enable this on a reachable deployment.'
      );
      return JSON.parse(payload.toString('utf8'));
    }
    throw new Error(
      'REFUSING unsigned webhook: STRIPE_WEBHOOK_SECRET is not configured. ' +
        'Set STRIPE_WEBHOOK_SECRET (recommended) or, for a local demo only, ' +
        'ALLOW_UNSIGNED_WEBHOOKS=true.'
    );
  }

  if (!secret) {
    throw new Error('REFUSING webhook: STRIPE_WEBHOOK_SECRET is not configured');
  }
  if (!stripe) {
    throw new Error('REFUSING webhook: Stripe client is not initialised');
  }
  return stripe.webhooks.constructEvent(payload, signature, secret);
}

module.exports = {
  createEscrowCharge,
  createCheckoutIntent,
  captureAndSplit,
  createCarrierConnectAccount,
  createCustomer,
  refundEscrow,
  verifyWebhook,
  verifyDemoSignature,
  assertTestMode,
  assertTestModeFor,
  unsignedWebhooksAllowed,
  keyKind,
  money,          // canonical money module re-export (single source of truth)
  DEMO_MODE,
};
