/**
 * Photo handler (batch 2 / T3) — a photo message becomes EVIDENCE.
 *
 * Flow: largest photo → resolve shipment (caption `shp-/rec` token or the
 * session set by /refuse) → download bytes → photoProof.saveProofPhoto
 * (sha256 + metadata sidecar under data/evidence/<shipmentId>/) → attach to
 * an OPEN refusal dispute (anomaly 3) when one exists.
 *
 * Security: the Telegram file URL CONTAINS THE BOT TOKEN — it must never
 * reach logs/replies; download errors are sanitized (redacted + truncated).
 * No metadata → no evidence: the photo is rejected before anything is
 * written. DEMO: without a photo/camera nothing here runs at all — the
 * existing [DEMO] placeholder path in anomalies.attachDeliveryProof stays.
 */

const photoProof = require('../services/photoProof');
const anomalies = require('../services/anomalies');

/** Strip anything token-like out of an error message before it is shown/logged. */
function sanitizeErrMessage(msg) {
  return String(msg || 'unknown error')
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot<redacted>')
    .replace(/https?:\/\/\S+/g, (u) => u.slice(0, 40) + '…')
    .slice(0, 200);
}

/** Default downloader for the REAL Telegram bot (network). */
async function defaultDownload(ctx, photo) {
  let link;
  try {
    link = await ctx.telegram.getFileLink(photo.file_id);
    const res = await fetch(link);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    throw new Error('photo download failed: ' + sanitizeErrMessage(err.message));
  }
}

/**
 * @param {{download?: (ctx, photo) => Promise<Buffer>}} [deps] injectable
 * download for headless tests (no network).
 */
function createPhotoHandler({ download } = {}) {
  const dl = download || defaultDownload;

  return async (ctx) => {
    try {
      const photos = (ctx.message && ctx.message.photo) || [];
      if (!photos.length) return;

      const photo = photos.reduce(
        (best, p) => ((p.file_size || 0) > (best.file_size || 0) ? p : best),
        photos[0]
      );

      const shipmentId = photoProof.extractShipmentId(ctx);
      if (!shipmentId) {
        await ctx.reply(
          '⚠️ Снимката НЕ е приета: добави ID на заявка в caption (напр. `shp-000001`) ' +
          'или първо пусни `/refuse <ID>` в този чат.'
        );
        return;
      }

      const shipment = await ctx.airtable.getShipment(shipmentId);
      if (!shipment) {
        await ctx.reply('⚠️ Заявката не е намерена — снимката НЕ е записана.');
        return;
      }

      const buffer = await dl(ctx, photo);
      const chatId = (ctx.chat && ctx.chat.id != null) ? ctx.chat.id : ctx.from.id;
      const saved = photoProof.saveProofPhoto({
        shipmentId,
        chatId,
        buffer,
        caption: (ctx.message && ctx.message.caption) || '',
        source: 'telegram',
      });

      // link to an OPEN refusal (anomaly 3) for this shipment, if any
      let attachNote = 'няма открит отказ — снимката е запазена като доказателство';
      const disputes = ctx.airtable.listDisputes ? await ctx.airtable.listDisputes({}) : [];
      const open = disputes.find((d) => d.shipmentId === shipmentId && d.status === 'open');
      if (open) {
        const res = await anomalies.attachDeliveryProof(ctx.airtable, open.id, { photo: saved.meta });
        attachNote = res.ok
          ? `свързана с отказ ${open.id} — 24ч прозорецът е затворен`
          : `отказ ${open.id}: ${res.reason}`;
      }

      await ctx.reply(
        `✅ *Доказателство записано*\n` +
        `Заявка: ${shipmentId}\n` +
        `SHA-256: \`${saved.sha256}\`\n` +
        `Файл: data/evidence/${shipmentId}/${saved.meta.file}\n` +
        `Метаданни: data/evidence/${shipmentId}/${saved.meta.file.replace(/\.jpg$/, '.json')}\n` +
        `Chat: ${chatId} · ${saved.meta.timestamp}\n` +
        `→ ${attachNote}`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      console.error('Photo proof rejected:', sanitizeErrMessage(err.message));
      await ctx.reply(
        '⚠️ Снимката НЕ е приета (без метаданни няма доказателство): ' +
        sanitizeErrMessage(err.message)
      );
    }
  };
}

module.exports = { createPhotoHandler, defaultDownload, sanitizeErrMessage };
