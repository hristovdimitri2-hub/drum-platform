/**
 * B2 — Telegram MOCK adapter for headless demo/tests (no token, no network).
 *
 * Produces Telegraf-like ctx objects that the real command handlers
 * (src/commands/*.js) accept unchanged — so the FULL user flows are
 * exercised against the real services (store + stripe-demo + qr + carbon).
 * Captures replies/photos/sent messages for assertions.
 */

function createMockCtx({ from = { id: 1, first_name: 'Test' }, text = '', contact = null } = {}) {
  const ctx = {
    from,
    message: { text, contact },
    session: {},
    __replies: [],
    __photos: [],
    __sent: [],
    async reply(msg, extra) { this.__replies.push({ text: msg, extra }); },
    async replyWithPhoto(url) { this.__photos.push(url); },
    telegram: {
      async sendMessage(chatId, msg) { ctx.__sent.push({ chatId, text: msg }); },
    },
  };
  return ctx;
}

/** All captured text (replies + sent), lowercased, for assertions. */
function transcript(ctx) {
  return [
    ...ctx.__replies.map((r) => (typeof r.text === 'string' ? r.text : '')),
    ...ctx.__sent.map((s) => (typeof s.text === 'string' ? s.text : '')),
  ].join('\n');
}

module.exports = { createMockCtx, transcript };
