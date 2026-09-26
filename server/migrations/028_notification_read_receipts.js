// @ts-nocheck
/** Per-user notification read state. A global alert remains shared; only its receipt is personal. */
module.exports = {
  name: 'per-user notification read receipts',
  up(db) {
    db.exec(`
      CREATE TABLE notification_reads (
        notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        read_at INTEGER NOT NULL,
        PRIMARY KEY(notification_id,user_id)
      );
      CREATE INDEX idx_notification_reads_user ON notification_reads(user_id,read_at DESC);

      INSERT OR IGNORE INTO notification_reads(notification_id,user_id,read_at)
      SELECT n.id,u.id,COALESCE(n.created_at,CAST(strftime('%s','now') AS INTEGER)*1000)
      FROM notifications n CROSS JOIN users u
      WHERE n.is_read=1;
    `);
  }
};
