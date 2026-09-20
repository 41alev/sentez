module.exports = {
  name: 'mobile_idempotency',
  up(db) {
    db.exec(`CREATE TABLE mobile_sync_results (
      user_id INTEGER NOT NULL REFERENCES users(id),
      client_id TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, client_id)
    );`);
  }
};
