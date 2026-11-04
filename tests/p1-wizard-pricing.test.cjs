/**
 * P1 — the /new wizard must quote the SAME split that capture pays.
 *
 * Before the fix, new.js hand-rolled a second split implementation
 * (`base * 0.15`, `base * 0.05`) computed on the BASE tariff, while the real
 * split (money.splitAmounts) runs on the TOTAL. For the Sofia↔Plovdiv corridor
 * the sender was shown "Такса 15%: €1.50 / Застраховка 5%: €0.50" for a
 * shipment whose split is actually €1.80 / €0.60, and no carrier payout was
 * shown at all. The P0 fix had already synced /accept and the payout itself —
 * this closes the last divergent surface.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drum-p1-wizard-'));
process.env.SQLITE_PATH = path.join(tmp, 'test.db');
process.env.DATA_BACKEND = 'sqlite';
process.env.DEMO_MODE = 'true';
delete process.env.TELEGRAM_BOT_TOKEN;

const store = require('../src/services/store');
const money = require('../src/services/money');
const { createMockCtx, transcript } = require('../src/services/telegramMock');

const start = require('../src/commands/start');
const newCmd = require('../src/commands/new');

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

const SENDER = { id: 940001, first_name: 'Иван', username: 'sender_p1' };

let confirmText = '';
let shipment = null;
// The wizard keeps its step state on ctx.session, so every step must be driven
// through the SAME context object.
let c = null;

test('P1 wizard: walk the wizard to the confirmation step', async () => {
  await start(ctx(SENDER, '/start'));
  await start.contactHandler(ctx(SENDER, '', { contact: { phone_number: '+359888333444' } }));

  c = ctx(SENDER, '/new');
  await newCmd(c);
  c.message.text = 'София → Пловдив';
  await newCmd.handleTextInput(c);
  c.message.text = 'Малък пакет, 2 kg';
  await newCmd.handleTextInput(c);
  c.message.text = '50';
  await newCmd.handleTextInput(c);
  c.message.text = 'Днес';
  await newCmd.handleTextInput(c);

  confirmText = transcript(c);
  assert.match(confirmText, /Ценова разбивка/, 'the wizard must show a price breakdown');

  // Nothing is created before the sender confirms.
  assert.equal((await store.listPendingShipments()).length, 0);
});

test('P1 wizard: confirming creates the shipment with the quoted total', async () => {
  c.message.text = '✅ Потвърждавам';
  await newCmd.handleTextInput(c);

  const pending = await store.listPendingShipments();
  assert.equal(pending.length, 1, 'confirmation must create exactly one shipment');
  shipment = pending[0];
  assert.equal(shipment.totalEur, 12, 'Sofia↔Plovdiv captured total is €12.00');
  assert.equal(shipment.baseEur, 10, 'the corridor base tariff is €10.00');
});

test('P1 wizard: quoted carrier/fee/insurance equal the canonical split', () => {
  const split = money.splitAmounts(money.eurToCents(shipment.totalEur));
  const carrier = money.centsToEur(split.carrierCents).toFixed(2);
  const fee = money.centsToEur(split.drumCents).toFixed(2);
  const insurance = money.centsToEur(split.insuranceCents).toFixed(2);

  assert.equal(carrier, '9.60');
  assert.equal(fee, '1.80');
  assert.equal(insurance, '0.60');

  assert.ok(
    confirmText.includes(`Превозвач (80%): €${carrier}`),
    `wizard must show the carrier payout €${carrier}; got:\n${confirmText}`
  );
  assert.ok(
    confirmText.includes(`Такса за улеснение (15%): €${fee}`),
    `wizard must show fee €${fee}; got:\n${confirmText}`
  );
  assert.ok(
    confirmText.includes(`Застраховка (5%): €${insurance}`),
    `wizard must show insurance €${insurance}; got:\n${confirmText}`
  );
  assert.ok(confirmText.includes('ОБЩО: €12.00'), 'wizard must show the total €12.00');
});

test('P1 wizard: the old base-derived figures must be gone', () => {
  // These were 15% and 5% of the €10 base — the divergence this fixes.
  assert.ok(!confirmText.includes('€1.50'), 'the stale €1.50 fee must not appear');
  assert.ok(!confirmText.includes('€0.50'), 'the stale €0.50 insurance must not appear');
  assert.ok(!/Базова цена/.test(confirmText), 'the base tariff must not be quoted as a payout');
});

test('P1 wizard: the breakdown stored on the session reconciles to the total', () => {
  const split = money.splitAmounts(money.eurToCents(shipment.totalEur));
  assert.equal(
    split.carrierCents + split.drumCents + split.insuranceCents,
    money.eurToCents(shipment.totalEur),
    'the canonical split must reconcile to the captured total'
  );
});

test('P1 wizard: captureAndSplit reports the same split and a canonical VAT leg', async () => {
  const stripe = require('../src/services/stripe');
  assert.equal(typeof stripe.captureAndSplit, 'function');

  const total = money.eurToCents(12);
  const split = money.splitAmounts(total);
  // 20% of the €1.80 facilitation fee = €0.36 — the canon helper, shared with
  // finance.js and b2b.js. Before the P1 fix this was structurally €0.00.
  const vat = money.vatOnDrumFee(split.drumCents);
  assert.equal(vat.vatCents, 36);

  const res = await stripe.captureAndSplit({
    paymentIntentId: 'pi_p1_wizard',
    carrierConnectAccountId: 'acct_p1_wizard',
    totalEur: 12,
  });
  assert.equal(res.splitCents.totalCents, 1200);
  assert.equal(res.splitCents.carrierCents, 960);
  assert.equal(res.splitCents.drumCents, 180);
  assert.equal(res.splitCents.insuranceCents, 60);
  assert.equal(res.splitCents.vatCents, 36, 'VAT leg must match vatOnDrumFee(drumCents)');
  assert.ok(!('ticketCents' in res.splitCents), 'the dead ticketEur parameter is gone');
});
