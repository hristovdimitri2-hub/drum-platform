/**
 * QR Code service
 *
 * Uses goqr.me API (free tier, no key needed)
 * https://api.qrserver.com/v1/create-qr-code/
 *
 * For production: use 'qrcode' npm package to generate locally
 * (no API dependency, faster, works offline)
 */

const QRCode = require('qrcode');
const axios = require('axios');

const QR_API_URL = process.env.QR_API_URL || 'https://api.qrserver.com/v1/create-qr-code/';

/**
 * Generate QR code as data URL (local generation — preferred)
 * Returns base64 data URL that can be sent as photo
 */
async function generateLocal(payload, options = {}) {
  const opts = {
    width: options.width || 400,
    margin: options.margin || 2,
    color: {
      dark: options.dark || '#000000',
      light: options.light || '#FFFFFF',
    },
    ...options,
  };

  const dataUrl = await QRCode.toDataURL(payload, opts);
  return dataUrl;
}

/**
 * Generate QR code via goqr.me API (returns URL)
 * Useful for Telegram replyWithPhoto (needs public URL)
 */
async function generate(payload, options = {}) {
  const size = options.size || '400x400';
  const url = `${QR_API_URL}?size=${size}&data=${encodeURIComponent(payload)}`;
  return url;
}

/**
 * Generate QR code and save to file (for attachments)
 */
async function generateFile(payload, filepath, options = {}) {
  await QRCode.toFile(filepath, payload, {
    width: options.width || 400,
    margin: options.margin || 2,
  });
  return filepath;
}

module.exports = {
  generate,
  generateLocal,
  generateFile,
};
