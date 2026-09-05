/**
 * Seed script — creates Airtable tables automatically
 *
 * Използва Airtable Metadata API (beta).
 * https://airtable.com/developers/web/api/introduction
 *
 * Забележка: Airtable Metadata API изисква специален token с
 * `schema.bases:write` scope. Създай го на airtable.com/create/tokens
 *
 * Usage:
 *   node scripts/seed-airtable.js
 */

require('dotenv').config();
const axios = require('axios');

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const BASE_ID = process.env.AIRTABLE_BASE_ID;

if (!AIRTABLE_API_KEY || !BASE_ID) {
  console.error('❌ Missing AIRTABLE_API_KEY or AIRTABLE_BASE_ID in .env');
  process.exit(1);
}

const api = axios.create({
  baseURL: `https://api.airtable.com/v0/meta/bases/${BASE_ID}`,
  headers: {
    Authorization: `Bearer ${AIRTABLE_API_KEY}`,
    'Content-Type': 'application/json',
  },
});

const tables = [
  {
    name: 'Users',
    description: 'Потребители — изпращачи и превозвачи',
    fields: [
      { name: 'Telegram ID', type: 'number', options: { precision: 0 } },
      { name: 'First Name', type: 'singleLineText' },
      { name: 'Last Name', type: 'singleLineText' },
      { name: 'Username', type: 'singleLineText' },
      { name: 'Phone', type: 'phoneNumber' },
      { name: 'Language', type: 'singleLineText' },
      {
        name: 'KYC Status',
        type: 'singleSelect',
        options: {
          choices: [
            { name: 'pending' },
            { name: 'phone_verified' },
            { name: 'id_verified' },
            { name: 'rejected' },
          ],
        },
      },
      { name: 'Stripe Customer ID', type: 'singleLineText' },
      { name: 'Stripe Connect Account ID', type: 'singleLineText' },
      { name: 'Trust Score', type: 'number', options: { precision: 0 } },
      {
        name: 'Trust Tier',
        type: 'singleSelect',
        options: {
          choices: [
            { name: 'banned' },
            { name: 'limited' },
            { name: 'standard' },
            { name: 'verified' },
            { name: 'premium' },
          ],
        },
      },
      { name: 'Created At', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' } },
    ],
  },
  {
    name: 'Shipments',
    description: 'Заявки за доставки',
    fields: [
      { name: 'Sender ID', type: 'singleLineText' }, // ще стане link след като Users съществува
      { name: 'Sender Telegram ID', type: 'number', options: { precision: 0 } },
      { name: 'Carrier ID', type: 'singleLineText' },
      { name: 'Carrier Telegram ID', type: 'number', options: { precision: 0 } },
      { name: 'Origin City', type: 'singleLineText' },
      { name: 'Destination City', type: 'singleLineText' },
      { name: 'Description', type: 'multilineText' },
      { name: 'Parcel Value (EUR)', type: 'number', options: { precision: 2 } },
      {
        name: 'Deadline',
        type: 'singleSelect',
        options: {
          choices: [
            { name: 'Днес' },
            { name: 'Утре' },
            { name: 'До 3 дни' },
            { name: 'До 7 дни' },
          ],
        },
      },
      { name: 'Total (EUR)', type: 'number', options: { precision: 2 } },
      { name: 'Base (EUR)', type: 'number', options: { precision: 2 } },
      { name: 'Fee (EUR)', type: 'number', options: { precision: 2 } },
      { name: 'Insurance (EUR)', type: 'number', options: { precision: 2 } },
      { name: 'Stripe Payment Intent ID', type: 'singleLineText' },
      { name: 'Stripe Transfer ID', type: 'singleLineText' },
      { name: 'Pickup QR Code', type: 'multipleAttachments' },
      { name: 'Delivery QR Code', type: 'multipleAttachments' },
      {
        name: 'Status',
        type: 'singleSelect',
        options: {
          choices: [
            { name: 'requested' },
            { name: 'matched' },
            { name: 'picked_up' },
            { name: 'in_transit' },
            { name: 'delivered' },
            { name: 'cancelled' },
            { name: 'disputed' },
          ],
        },
      },
      { name: 'Matched At', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' } },
      { name: 'Pickup Scanned At', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' } },
      { name: 'Delivery Scanned At', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' } },
      { name: 'Created At', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' } },
    ],
  },
  {
    name: 'Trust Events',
    description: 'Event-sourced trust log (ebay/reputation-system pattern)',
    fields: [
      { name: 'User ID', type: 'singleLineText' },
      {
        name: 'Event Type',
        type: 'singleSelect',
        options: {
          choices: [
            { name: 'shipment_created' },
            { name: 'shipment_accepted' },
            { name: 'delivery_success' },
            { name: 'delivery_failed' },
            { name: 'dispute_raised' },
            { name: 'dispute_resolved' },
            { name: 'kyc_verified' },
            { name: 'rating_given' },
          ],
        },
      },
      { name: 'Event Value', type: 'number', options: { precision: 0 } },
      { name: 'Shipment ID', type: 'singleLineText' },
      { name: 'Metadata', type: 'multilineText' },
      { name: 'Created At', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' } },
    ],
  },
  {
    name: 'Carbon Ledger',
    description: 'GHG Protocol Scope 3 Cat 4 — CO2 спестявания',
    fields: [
      { name: 'Shipment ID', type: 'singleLineText' },
      { name: 'Baseline CO2 (kg)', type: 'number', options: { precision: 2 } },
      { name: 'Actual CO2 (kg)', type: 'number', options: { precision: 2 } },
      { name: 'Saved CO2 (kg)', type: 'number', options: { precision: 2 } },
      { name: 'Distance (km)', type: 'number', options: { precision: 0 } },
      { name: 'Methodology', type: 'singleLineText' },
      {
        name: 'Verification Status',
        type: 'singleSelect',
        options: {
          choices: [
            { name: 'pending' },
            { name: 'verified' },
            { name: 'rejected' },
          ],
        },
      },
      { name: 'Created At', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' } },
    ],
  },
];

async function createTables() {
  console.log('🌱 Seeding Airtable base...\n');

  for (const table of tables) {
    try {
      console.log(`  Creating table: ${table.name}...`);
      const response = await api.post('/tables', {
        name: table.name,
        description: table.description,
        fields: table.fields,
      });
      console.log(`  ✅ Created: ${table.name} (${response.data.id})`);
    } catch (err) {
      if (err.response?.status === 422 && err.response?.data?.error?.message?.includes('already exists')) {
        console.log(`  ⚠️  Table ${table.name} already exists — skipping`);
      } else {
        console.error(`  ❌ Error creating ${table.name}:`, err.response?.data || err.message);
      }
    }
  }

  console.log('\n✅ Seed complete!');
  console.log('\nЗабележка: Този скрипт създава таблиците, но НЕ настройва link fields.');
  console.log('Трябва ръчно да промениш:');
  console.log('  - Shipments.Sender ID → Link to Users');
  console.log('  - Shipments.Carrier ID → Link to Users');
  console.log('  - Trust Events.User ID → Link to Users');
  console.log('  - Trust Events.Shipment ID → Link to Shipments');
  console.log('  - Carbon Ledger.Shipment ID → Link to Shipments');
}

createTables().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
