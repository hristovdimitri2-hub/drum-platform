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
 * Throws unless the key is a test key (or demo mode is active).
 */
function assertTestMode() {
  if (DEMO_MODE) return;
  const key = secretKey();
  if (!key || key.startsWith('sk_test')) return;
  throw new Error(
    'REFUSING to run: STRIPE_SECRET_KEY is not a TEST key. ' +
      'DRUM MVP runs in Stripe TEST mode only. Use sk_test_... keys.'
  );
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
 * Capture payment and split payout to carrier.
 * Split of the captured total: 80% carrier (Connect transfer),
 * 15% DRUM (stays in platform balance), 5% insurance pool.
 */
async function captureAndSplit({ paymentIntentId, carrierConnectAccountId, totalEur }) {
  assertTestMode();

  const totalCents = money.eurToCents(totalEur);
  // CANONICAL split via services/money.js (single money module — B5 rule)
  const split = money.splitAmounts(totalCents);
  const carrierAmountCents = split.carrierCents;

  const splitEur = {
    carrierPayoutEur: money.centsToEur(split.carrierCents),
    drumRevenueEur: money.centsToEur(split.drumCents),
    insurancePoolEur: money.centsToEur(split.insuranceCents),
  };
  const splitCents = {
    totalCents: split.totalCents,
    carrierCents: split.carrierCents,
    drumCents: split.drumCents,
    insuranceCents: split.insuranceCents,
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
 * Verify Stripe webhook signature
 */
function verifyWebhook(payload, signature) {
  if (DEMO_MODE) {
    // Demo mode: accept unsigned payloads (no real Stripe webhooks)
    return JSON.parse(payload.toString('utf8'));
  }
  return stripe.webhooks.constructEvent(
    payload,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET
  );
}

module.exports = {
  createEscrowCharge,
  captureAndSplit,
  createCarrierConnectAccount,
  createCustomer,
  refundEscrow,
  verifyWebhook,
  assertTestMode,
  money,          // canonical money module re-export (single source of truth)
  DEMO_MODE,
};
