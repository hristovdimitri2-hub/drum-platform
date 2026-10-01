#!/usr/bin/env node
/**
 * Camera-demo prep (batch 3 / T3): creates ONE matched shipment in the
 * local store (DEMO rails) and renders its pickup/delivery QR codes as
 * PNG files under public/demo-qr/ (gitignored) so they can be scanned
 * with the REAL camera via /scan.html — no Telegram required.
 *
 * Usage: npm run demo:camera  → follow the printed steps.
 */
process.env.DEMO_MODE = 'true';

const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const store = require('../src/services/store');

const OUT_DIR = path.join(__dirname, '..', 'public', 'demo-qr');

async function main() {
  console.log('🎬 DRUM camera demo — подготовка на matched заявка\n');

  const sender = await store.findOrCreateUser({
    telegramId: 999001, firstName: '[DEMO]', lastName: 'Изпращач', username: 'demo_cam_sender', language: 'bg',
  });
  const carrier = await store.findOrCreateUser({
    telegramId: 999002, firstName: '[DEMO]', lastName: 'Превозвач', username: 'demo_cam_carrier', language: 'bg',
  });
  await store.updateUser(carrier.telegramId, {
    kycStatus: 'phone_verified',
    stripeConnectAccountId: 'acct_demo_camera',
  });

  const shipment = await store.createShipment({
    senderId: sender.id,
    senderTelegramId: sender.telegramId,
    originCity: 'София',
    destinationCity: 'Пловдив',
    description: '[DEMO] Camera-scan demo пратка',
    parcelValueEur: 50,
    deadline: 'Днес',
    totalEur: 7.98,    // BASE калибровка (B8.2)
    baseEur: 6.20,
    feeEur: 1.16,
    insuranceEur: 0.39,
    stripePaymentIntentId: 'pi_demo_camera',
    status: 'requested',
  });
  // carrier колоните се записват през update (INSERT-ът покрива само изпращача)
  await store.updateShipment(shipment.id, {
    carrierId: carrier.id,
    carrierTelegramId: carrier.telegramId,
    carrierStripeAccountId: 'acct_demo_camera',
    status: 'matched',
    matchedAt: new Date().toISOString(),
  });
  await store.logTrustEvent({
    userId: carrier.id, eventType: 'shipment_accepted', eventValue: 0, shipmentId: shipment.id, metadata: {},
  });

  const pickupPayload = `drum:pickup:${shipment.id}`;
  const deliveryPayload = `drum:delivery:${shipment.id}`;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  await QRCode.toFile(path.join(OUT_DIR, 'pickup.png'), pickupPayload, { width: 480 });
  await QRCode.toFile(path.join(OUT_DIR, 'delivery.png'), deliveryPayload, { width: 480 });
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify({
    note: '[DEMO] — генерирано от scripts/demo-camera.js; изтрива се/пре-генерира се свободно',
    shipmentId: shipment.id,
    pickupPayload,
    deliveryPayload,
    totalEur: 7.98,
    generatedAt: new Date().toISOString(),
  }, null, 2));

  console.log(`✅ Заявка (matched): ${shipment.id} | София → Пловдив | €7.98 [DEMO]`);
  console.log(`   Pickup payload:   ${pickupPayload}`);
  console.log(`   Delivery payload: ${deliveryPayload}`);
  console.log(`\nQR файлове (gitignored):`);
  console.log(`   ${path.join(OUT_DIR, 'pickup.png')}`);
  console.log(`   ${path.join(OUT_DIR, 'delivery.png')}`);
  console.log('\nСледващи стъпки — вж. DEMO_SCRIPT.md «Институционално демо с камера»:');
  console.log('   1. npm start');
  console.log('   2. отвори http://localhost:3000/scan.html (лаптоп камера или телефон с HTTPS тунел)');
  console.log('   3. отвори demo-qr/pickup.png и го сканирай → после delivery.png → capture + CO₂');
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
