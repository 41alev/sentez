// @ts-nocheck
/**
 * Playwright starts its own server against an owned, temporary sandbox.
 * Customer data, uploads and backups are never used or removed by this runner.
 */
const { createSandbox } = require('../helpers/sandbox');
const sandbox = createSandbox();
Object.assign(process.env, sandbox.env, { PORT: process.env.PLAYWRIGHT_PORT || '3301' });
// Forced OS termination can leave disposable temp data, never customer data.
process.on('exit', () => {
  try { require('../../server/db').close(); sandbox.cleanup(); }
  catch (err) { console.error('Test cleanup retained temporary data:', err.message); }
});
require('../../server/index.js');
