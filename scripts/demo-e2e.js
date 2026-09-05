/**
 * DRUM 3.0 — End-to-End demo (P2)
 *
 * Simulates ONE full transaction in test/demo mode, headless (no Telegram):
 *   заявка → escrow (auth) → carrier acceptance → pickup QR →
 *   delivery QR → capture + split 80/15/5 → Trust Score → Carbon Ledger
 *
 * Uses exactly the same services as the live bot (store facade, stripe
 * service in DEMO_MODE, trust service, carbon service) — so what you see
 * here is the real production code path, only with simulated payment rails.
 *
 * Usage:  npm run demo:e2e
 */

require('dotenv').config();
process.env.DEMO_MODE = 'true';

const store = require('../src/services/store');
const stripe = require('../src/services/stripe');
const carbon = require('../src/services/carbon');
const money = require('../src/services/money');
const QRCode = require('qrcode');

const hr = (t) => console.log('\n' + '═'.repeat(60) + `\n  ${t}\n` + '═'.repeat(60));
const step = (n, t) => console.log(`\n── Стъпка ${n}: ${t} ` + '─'.repeat(Math.max(0, 40 - t.length)));

async function main() {
  hr('🥁 DRUM 3.0 — E2E ДЕМО (DEMO MODE, Stripe TEST logic, симулирани рейлсове)');

  // NOTE: this run APPENDS to the existing demo data (data/demo-state.json).
  // For a fresh dataset run `npm run seed:demo` first.

  // ── Участници (фиктивни) ──
  step(0, 'Участници (GDPR: само фиктивни имена)');
  const sender = await store.findOrCreateUser({
    telegramId: 700100001,
    firstName: 'Иван',
    lastName: 'П.',
    username: 'demo_sender',
    language: 'bg',
  });
  await store.updateUser(sender.telegramId, { kycStatus: 'phone_verified' });
  const carrier = await store.findOrCreateUser({
    telegramId: 700100002,
    firstName: 'Мария',
    lastName: 'Д.',
    username: 'demo_carrier',
    language: 'bg',
  });
  await store.updateUser(carrier.telegramId, {
    kycStatus: 'phone_verified',
    stripeConnectAccountId: 'acct_demo_e2e_carrier',
  });
  console.log(`  Изпращач: ${sender.firstName} ${sender.lastName} (@${sender.username}) — Trust ${sender.trustScore}`);
  console.log(`  Превозвач: ${carrier.firstName} ${carrier.lastName} (@${carrier.username}) — Trust ${carrier.trustScore}`);

  // ── 1. Заявка ── (B8.2 BASE калибровка: T = €7.75, клиент плаща €7.98 вкл. ДДС)
  step(1, 'Изпращачът създава заявка (като /new)');
  const ticketEur = 7.75;  // BASE калибровка (T) — виж src/services/finance.js
  const baseEur = 6.20;    // carrier pool (80% от T)
  const feeEur = 1.16;     // DRUM такса (15% от T)
  const insuranceEur = 0.39; // застраховка (5% от T) — ПУЛ РЕЗЕРВ (не приход)
  const totalEur = +(ticketEur + money.vatOnDrumFee(money.eurToCents(feeEur)).vatCents / 100).toFixed(2);
  console.log(`  Коридор: София → Пловдив | Пратка: [DEMO] Документи в плик`);
  console.log(`  Ticket T: €${ticketEur.toFixed(2)} = превозвач €${baseEur.toFixed(2)} + такса €${feeEur.toFixed(2)} + застраховка €${insuranceEur.toFixed(2)}`);
  console.log(`  Клиент плаща: €${totalEur.toFixed(2)} (T + ДДС €${(totalEur - ticketEur).toFixed(2)} върху таксата)`);

  // ── 2. Escrow (auth-only) ──
  step(2, 'Stripe escrow — auth-only замразяване');
  const escrow = await stripe.createEscrowCharge({
    amount: Math.round(totalEur * 100),
    customerId: sender.stripeCustomerId,
    description: 'DRUM София → Пловдив (E2E demo)',
    metadata: { demo: 'true' },
  });
  if (!escrow.success) throw new Error('Escrow failed: ' + escrow.error);
  console.log(`  PaymentIntent: ${escrow.paymentIntentId} | статус: ${escrow.status}`);
  console.log('  💶 Парите са замразени, НЕ са уловени (capture_method=manual).');

  const shipment = await store.createShipment({
    senderId: sender.id,
    senderTelegramId: sender.telegramId,
    originCity: 'София',
    destinationCity: 'Пловдив',
    description: '[DEMO] Документи в плик',
    parcelValueEur: 50,
    deadline: 'Днес',
    totalEur,
    baseEur,
    feeEur,
    insuranceEur,
    stripePaymentIntentId: escrow.paymentIntentId,
    status: 'requested',
  });
  await store.logTrustEvent({ userId: sender.id, eventType: 'shipment_created', eventValue: 0, shipmentId: shipment.id, metadata: {} });
  console.log(`  Заявка записана: ${shipment.id} (статус: ${shipment.status})`);
  console.log('  📣 Ops канал: "Намери превозвач и го насочи към /accept ' + shipment.id + '"');

  // ── 3. Превозвачът избира да приеме (Strict Agent Model) ──
  step(3, 'Превозвачът приема (като /accept) — ПОТРЕБИТЕЛЯТ ИЗИРА, ботът не назначава');
  const carrierFresh = await store.findUserByTelegramId(carrier.telegramId);
  await store.updateShipment(shipment.id, {
    carrierId: carrier.id,
    carrierTelegramId: carrier.telegramId,
    carrierStripeAccountId: carrierFresh.stripeConnectAccountId,
    status: 'matched',
    matchedAt: new Date().toISOString(),
  });
  await store.logTrustEvent({ userId: carrier.id, eventType: 'shipment_accepted', eventValue: 0, shipmentId: shipment.id, metadata: {} });

  const pickupQr = await QRCode.toDataURL(`drum:pickup:${shipment.id}`, { width: 300 });
  const deliveryQr = await QRCode.toDataURL(`drum:delivery:${shipment.id}`, { width: 300 });
  await store.updateShipment(shipment.id, { pickupQrCode: pickupQr, deliveryQrCode: deliveryQr });
  console.log(`  Статус: matched | Превозвач: @${carrier.username}`);
  console.log(`  📷 Pickup QR генериран (${pickupQr.length} bytes, data URL)`);
  console.log(`  📷 Delivery QR генериран (${deliveryQr.length} bytes, data URL)`);

  // ── 4. Pickup QR scan ──
  step(4, 'Pickup QR сканиран (drum:pickup:' + shipment.id + ')');
  await store.updateShipment(shipment.id, {
    status: 'picked_up',
    pickupScannedAt: new Date().toISOString(),
  });
  console.log('  Статус: picked_up | Изпращачът е уведомен.');

  // ── 5. Delivery QR scan → capture + split ──
  step(5, 'Delivery QR сканиран → Stripe capture + split 80/15/5');
  const capture = await stripe.captureAndSplit({
    paymentIntentId: escrow.paymentIntentId,
    carrierConnectAccountId: carrierFresh.stripeConnectAccountId,
    totalEur,
    ticketEur, // B8.2: split върху ticket T; разликата = ДДС върху таксата
  });
  if (!capture.success) throw new Error('Capture failed: ' + capture.error);
  console.log(`  Capture: ${capture.captureId}`);
  console.log(`  💰 Превозвач (80%): €${capture.carrierPayoutEur.toFixed(2)} → transfer ${capture.transferId}`);
  console.log(`  🏢 DRUM (15%):       €${capture.drumRevenueEur.toFixed(2)} (остава в платформата)`);
  console.log(`  🛡️  Застраховка (5%): €${capture.insurancePoolEur.toFixed(2)} (pool)`);

  await store.updateShipment(shipment.id, {
    status: 'delivered',
    deliveryScannedAt: new Date().toISOString(),
    stripeTransferId: capture.transferId,
  });

  // Canonical transaction record (B1 schema, split from services/money.js)
  await store.recordTransaction({
    shipmentId: shipment.id,
    type: 'capture',
    amountCents: capture.splitCents.totalCents,
    currency: 'eur',
    stripeId: capture.captureId,
    splitCarrierCents: capture.splitCents.carrierCents,
    splitDrumCents: capture.splitCents.drumCents,
    splitInsuranceCents: capture.splitCents.insuranceCents,
    isDemo: true,
  });

  // ── 6. Trust Score ──
  step(6, 'Trust Score (event-sourced, прагове 31/50/70/90)');
  const senderTrust = await store.updateTrustScore(sender.id, 'delivery_success_sender');
  const carrierTrust = await store.updateTrustScore(carrier.id, 'delivery_success_carrier');
  console.log(`  Изпращач: 50 → ${senderTrust.score} (${senderTrust.tier})`);
  console.log(`  Превозвач: 50 → ${carrierTrust.score} (${carrierTrust.tier})`);

  // ── 7. Carbon Ledger ──
  step(7, 'Carbon Ledger (GHG Protocol Scope 3, Cat. 4)');
  const co2 = carbon.calculateCo2Saved({ originCity: 'София', destinationCity: 'Пловдив' });
  await store.createCarbonEntry({
    shipmentId: shipment.id,
    originCity: 'София',
    destinationCity: 'Пловдив',
    baselineCo2Kg: co2.baselineCo2Kg,
    actualCo2Kg: co2.actualCo2Kg,
    savedCo2Kg: co2.savedCo2Kg,
    distanceKm: co2.distanceKm,
    methodology: co2.methodology,
    factors: co2.factors,
  });
  console.log(`  Разстояние: ${co2.distanceKm} km`);
  console.log(`  Baseline (куриерска кола): ${co2.baselineCo2Kg.toFixed(2)} kg CO₂e`);
  console.log(`  Actual (споделен превоз):  ${co2.actualCo2Kg.toFixed(2)} kg CO₂e`);
  console.log(`  🌿 СПЕСТЕНО: ${co2.savedCo2Kg.toFixed(2)} kg CO₂e | методология: ${co2.methodology}`);
  console.log(`  Audit trail: factors=${JSON.stringify(co2.factors)}`);

  // ── Резултат ──
  hr('✅ ТРАНЗАКЦИЯТА Е ЗАВЪРШЕНА (DEMO)');
  const final = await store.getShipment(shipment.id);
  console.log(`  Заявка ${final.id}: ${final.status} | escrow ${escrow.paymentIntentId} → capture ${capture.captureId}`);
  console.log(`  🌿 ${co2.savedCo2Kg.toFixed(2)} kg CO₂ спестено · Trust: ${carrierTrust.score}/100`);
  console.log('\n  Отвори дашборда: npm start → http://localhost:3000/dashboard/carbon');
  console.log('  (състоянието на тази транзакция е в data/demo-state.json)\n');
}

main().catch((err) => {
  console.error('\n❌ E2E demo failed:', err);
  process.exit(1);
});
