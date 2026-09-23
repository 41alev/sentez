// @ts-nocheck
/** Durable per-subscriber event queue; enqueue in the same transaction as the business change. */
module.exports = {
  name: 'webhook_outbox',
  up(db) {
    db.exec(`
      CREATE TABLE webhook_outbox (
        id TEXT PRIMARY KEY,
        webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
        company_id INTEGER NOT NULL,
        event TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER,
        leased_until INTEGER,
        delivered_at INTEGER,
        last_error TEXT
      );
      CREATE INDEX idx_webhook_outbox_due ON webhook_outbox(next_attempt_at, leased_until)
        WHERE delivered_at IS NULL AND next_attempt_at IS NOT NULL;
    `);
  }
};
