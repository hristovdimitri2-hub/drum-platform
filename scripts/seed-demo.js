/**
 * Seed demo data — ~100 simulated shipments, clearly marked as DEMO.
 *
 * ⚠️ ПРИНЦИП: Демо данните СИМУЛИРАТ транзакции за демонстрация.
 * Те НЕ са реален traction и всеки запис е маркиран с isDemo: true
 * и описанията започват с "[DEMO]".
 *
 * GDPR: в демо режима се съхраняват само измислени имена и IDs —
 * никакви реални лични данни.
 *
 * Usage:
 *   npm run seed:demo            # writes to demo store (data/demo-state.json)
 *   npm run seed:demo -- --wipe  # clears demo data instead
 */

require('dotenv').config();
process.env.DEMO_MODE = 'true';

const demoStore = require('../src/services/demo-store');
const carbon = require('../src/services/carbon');
const trust = require('../src/services/trust');

const SHIPMENTS_TARGET = 100;
const DAYS = 60;

const CORRIDORS = [
  { from: 'София', to: 'Пловдив', baseEur: 10 },
  { from: 'Пловдив', to: 'София', baseEur: 10 },
  { from: 'София', to: 'Варна', baseEur: 15 },
  { from: 'Варна', to: 'София', baseEur: 15 },
];

const FIRST_NAMES = ['Иван', 'Мария', 'Георги', 'Елена', 'Николай', 'Стоян', 'Пенелопа', 'Даниела', 'Кирил', 'Радост', 'Виктор', 'Теодора', 'Мартин', 'Йорданка', 'Петър', 'Албена', 'Димитър', 'Лилия', 'Борис', 'Силвия'];
const LAST_INITIALS = ['И.', 'П.', 'Д.', 'С.', 'К.', 'М.', 'Т.', 'В.', 'Г.', 'Н.'];
const PARCEL_TYPES = ['Документи в плик', 'Малък пакет, 2 kg', 'Книга, 1 kg', 'Електроника, 3 kg', 'Козметика, 1 kg', 'Сувенири, 4 kg', 'Части за кола, 5 kg', 'Дрехи, 2 kg'];
const DEADLINES = ['Днес', 'Утре', 'До 3 дни', 'До 7 дни'];

let seed = 42;
function rand() {
  // deterministic LCG so the demo dataset is reproducible
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const randInt = (min, max) => min + Math.floor(rand() * (max - min + 1));

function isoDaysAgo(days, hour = 12) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(hour, randInt(0, 59), 0, 0);
  return d.toISOString();
}

function buildSeed() {
  const users = {};
  const shipments = {};
  const trustEvents = [];
  const carbonEntries = [];
  let userNo = 0;
  let shipmentNo = 0;
  let trustNo = 0;
  let carbonNo = 0;

  // ---- Users (senders + carriers, fictional) ----
  for (let i = 0; i < 40; i++) {
    userNo += 1;
    const id = `demo-usr-${String(userNo).padStart(4, '0')}`;
    const role = i < 24 ? 'sender' : 'carrier';
    const score = role === 'carrier' ? randInt(52, 88) : randInt(48, 72);
    users[id] = {
      id,
      telegramId: 700000000 + userNo, // fictional IDs, not real users
      firstName: pick(FIRST_NAMES),
      lastName: pick(LAST_INITIALS),
      username: `demo_user_${userNo}`,
      phone: null, // GDPR: no phone numbers in demo data
      language: 'bg',
      kycStatus: 'phone_verified',
      stripeCustomerId: `cus_demo_${String(userNo).padStart(6, '0')}`,
      stripeConnectAccountId: role === 'carrier' ? `acct_demo_${String(userNo).padStart(6, '0')}` : null,
      trustScore: score,
      trustTier: trust.tierForScore(score),
      isDemo: true,
      createdAt: isoDaysAgo(DAYS - randInt(0, 5)),
    };
  }

  const userIds = Object.keys(users);
  const carriers = userIds.filter((id) => users[id].stripeConnectAccountId);

  // ---- Shipments over the last DAYS days ----
  for (let i = 0; i < SHIPMENTS_TARGET; i++) {
    shipmentNo += 1;
    const id = `demo-shp-${String(shipmentNo).padStart(4, '0')}`;
    const corridor = pick(CORRIDORS);
    const senderId = pick(userIds.filter((u) => !users[u].stripeConnectAccountId));
    const carrierId = pick(carriers);
    const daysAgo = Math.round(((DAYS - 2) * i) / SHIPMENTS_TARGET);
    const createdAt = isoDaysAgo(daysAgo, randInt(8, 20));

    const base = corridor.baseEur;
    const fee = +(base * 0.15).toFixed(2);
    const insurance = +(base * 0.05).toFixed(2);
    const total = +(base + fee + insurance).toFixed(2);

    // status distribution: ~80% delivered, ~8% picked_up, ~6% matched, ~6% requested
    const roll = rand();
    let status = 'delivered';
    if (roll > 0.94) status = 'requested';
    else if (roll > 0.88) status = 'matched';
    else if (roll > 0.80) status = 'picked_up';

    const pickupAt = status === 'picked_up' || status === 'delivered'
      ? isoDaysAgo(Math.max(0, daysAgo - 1), randInt(9, 18))
      : null;
    const deliveryAt = status === 'delivered'
      ? isoDaysAgo(Math.max(0, daysAgo - 1), randInt(19, 22))
      : null;

    shipments[id] = {
      id,
      senderId,
      senderTelegramId: users[senderId].telegramId,
      carrierId: status === 'requested' ? null : carrierId,
      carrierTelegramId: status === 'requested' ? null : users[carrierId].telegramId,
      carrierStripeAccountId: status === 'requested' ? null : users[carrierId].stripeConnectAccountId,
      originCity: corridor.from,
      destinationCity: corridor.to,
      description: `[DEMO] ${pick(PARCEL_TYPES)}`,
      parcelValueEur: randInt(10, 150),
      deadline: pick(DEADLINES),
      totalEur: total,
      baseEur: base,
      feeEur: fee,
      insuranceEur: insurance,
      stripePaymentIntentId: `pi_demo_${String(shipmentNo).padStart(6, '0')}`,
      stripeTransferId: status === 'delivered' ? `tr_demo_${String(shipmentNo).padStart(6, '0')}` : null,
      pickupQrCode: status === 'requested' ? null : `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=drum%3Apickup%3A${id}`,
      deliveryQrCode: status === 'requested' ? null : `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=drum%3Adelivery%3A${id}`,
      status,
      isDemo: true,
      matchedAt: status === 'requested' ? null : isoDaysAgo(daysAgo, randInt(10, 14)),
      pickupScannedAt: pickupAt,
      deliveryScannedAt: deliveryAt,
      createdAt,
    };

    if (status === 'delivered') {
      const co2 = carbon.calculateCo2Saved({
        originCity: corridor.from,
        destinationCity: corridor.to,
      });
      carbonNo += 1;
      carbonEntries.push({
        id: `demo-carbon-${String(carbonNo).padStart(4, '0')}`,
        shipmentId: id,
        originCity: corridor.from,
        destinationCity: corridor.to,
        baselineCo2Kg: co2.baselineCo2Kg,
        actualCo2Kg: co2.actualCo2Kg,
        savedCo2Kg: co2.savedCo2Kg,
        distanceKm: co2.distanceKm,
        methodology: co2.methodology,
        factors: co2.factors,
        verificationStatus: 'pending',
        isDemo: true,
        createdAt: deliveryAt,
      });

      trustNo += 1;
      trustEvents.push({
        id: `demo-trust-${trustNo}`,
        userId: carrierId,
        eventType: 'delivery_success',
        eventValue: 5,
        shipmentId: id,
        metadata: JSON.stringify({ co2_saved: co2.savedCo2Kg.toFixed(2) }),
        isDemo: true,
        createdAt: deliveryAt,
      });
      trustNo += 1;
      trustEvents.push({
        id: `demo-trust-${trustNo}`,
        userId: senderId,
        eventType: 'delivery_success',
        eventValue: 5,
        shipmentId: id,
        metadata: JSON.stringify({}),
        isDemo: true,
        createdAt: deliveryAt,
      });
    }
  }

  return { users, shipments, trustEvents, carbonEntries, counters: { user: userNo, shipment: shipmentNo } };
}

function printSummary(seedData) {
  const all = Object.values(seedData.shipments);
  const delivered = all.filter((s) => s.status === 'delivered');
  const summary = carbon.summarize(seedData.carbonEntries);
  console.log('─'.repeat(56));
  console.log('  DEMO ДАННИ — симулирани транзакции (НЕ реален traction)');
  console.log('─'.repeat(56));
  console.log(`  Потребители (фиктивни):  ${Object.keys(seedData.users).length}`);
  console.log(`  Доставки:                ${all.length}`);
  console.log(`    delivered:             ${delivered.length}`);
  console.log(`    matched:               ${all.filter((s) => s.status === 'matched').length}`);
  console.log(`    picked_up:             ${all.filter((s) => s.status === 'picked_up').length}`);
  console.log(`    requested (отворени):  ${all.filter((s) => s.status === 'requested').length}`);
  console.log(`  Trust Events:            ${seedData.trustEvents.length}`);
  console.log(`  Carbon Ledger записи:    ${seedData.carbonEntries.length}`);
  console.log(`  CO2 спестено (DEMO):     ${summary.savedCo2Kg.toFixed(2)} kg на ${summary.distanceKm} km`);
  console.log('─'.repeat(56));
}

function main() {
  if (process.argv.includes('--wipe')) {
    demoStore.clear();
    console.log('Demo data cleared (data/demo-state.json).');
    return;
  }

  const seedData = buildSeed();
  demoStore.resetSeed(seedData);
  printSummary(seedData);
  console.log('\nOK: записано в data/demo-state.json. Стартирай npm start и отвори /dashboard/carbon');
}

main();

