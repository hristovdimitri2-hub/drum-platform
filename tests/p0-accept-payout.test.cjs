/**
 * P0 — /accept must DISPLAY the payout that will actually be paid.
 *
 * Before the fix, accept.js advertised `shipment.baseEur * 0.8` (80% of the
 * BASE fare) while delivery-time capture pays 80% of the CAPTURED TOTAL
 * (money.splitAmounts). For the bot's premium basket that showed €8.00 and then
 * paid €9.60 — a 20% discrepancy shown to the carrier at accept time.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drum-p0-accept-'));
process.env.SQLITE_PATH = path.join(tmp, 'test.db');
process.env.DATA_BACKEND = 'sqlite';
process.env.DEMO_MODE = 'true';
delete process.env.TELEGRAM_BOT_TOKEN;

const store = require('../src/services/store');
const money = require('../src/services/money');
const { createMockCtx, transcript } = require('../src/services/telegramMock');

const start = require('../src/commands/start');
const newCmd = require('../src/commands/new');
const accept = require('../src/commands/accept');

const SERVICES = {
  airtable: store,
  stripe: require('../src/services/stripe'),
  qr: require('../src/services/qr'),
  carbon: require('../src/services/carbon'),
};

function ctx(user, text, extra = {}) {
  const c = createMockCtx({ from: user, text, ...extra });
  Object.assign(c, SERVICES);
  return c;
}

const SENDER = { id: 930001, first_name: 'Иван', username: 'sender_p0' };
const CARRIER = { id: 930002, first_name: 'Петър', username: 'carrier_p0' };

let shipment;

test('P0 accept: set up a €12.00 premium shipment via the /new wizard', async () => {
  await start(ctx(SENDER, '/start'));
  await start.contactHandler(ctx(SENDER, '', { contact: { phone_number: '+359888111222' } }));

  const c = ctx(SENDER, '/new');
  await newCmd(c);
  c.message.text = 'София → Пловдив';
  await newCmd.handleTextInput(c);
  c.message.text = 'Малък пакет, 2 kg';
  await newCmd.handleTextInput(c);
  c.message.text = '50';
  await newCmd.handleTextInput(c);
  c.message.text = 'Днес';
  await newCmd.handleTextInput(c);
  c.message.text = '✅ Потвърждавам';
  await newCmd.handleTextInput(c);

  const pending = await store.listPendingShipments();
  assert.equal(pending.length, 1);
  shipment = pending[0];
  assert.equal(shipment.totalEur, 12);
  assert.equal(shipment.baseEur, 10);
});

test('P0 accept: advertised payout equals money.splitAmounts(total)', async () => {
  await start(ctx(CARRIER, '/start'));
  await start.contactHandler(ctx(CARRIER, '', { contact: { phone_number: '+359888222333' } }));

  const c = ctx(CARRIER, '/accept ' + shipment.id);
  await accept(c);
  const shown = transcript(c);
  const expected = money.centsToEur(money.splitAmounts(money.eurToCents(shipment.totalEur)).carrierCents);

  assert.equal(expected, 9.6, 'canonical carrier share of €12.00 is €9.60');
  assert.ok(
    shown.includes('€' + expected.toFixed(2)),
    `accept message must advertise €${expected.toFixed(2)}; got:\n${shown}`
  );
  // The old (buggy) figure must be gone.
  assert.ok(!shown.includes('€8.00'), 'accept message must not advertise the base-fare 80%');
  assert.ok(!/80% от €10\.00/.test(shown), 'must not claim 80% of the base fare');
});

test('P0 accept: the displayed figure matches the amount actually captured on delivery', async () => {
  const scan = require('../src/commands/scan');
  const c = ctx(CARRIER, '/scan drum:pickup:' + shipment.id);
  await scan(c);
  const d = ctx(CARRIER, '/scan drum:delivery:' + shipment.id);
  await scan(d);

  const txs = await store.listTransactionsByShipment(shipment.id);
  assert.equal(txs.length, 1);
  assert.equal(txs[0].splitCarrierCents, 960);

  const paid = money.centsToEur(txs[0].splitCarrierCents);
  const advertised = money.centsToEur(
    money.splitAmounts(money.eurToCents(shipment.totalEur)).carrierCents
  );
  assert.equal(paid, advertised, 'advertised payout must equal the real payout');
});
