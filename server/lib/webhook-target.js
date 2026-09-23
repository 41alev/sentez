// @ts-nocheck
const dns = require('node:dns').promises;
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const { AppError } = require('./core');

const blocked = new net.BlockList();
for (const [base, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
]) blocked.addSubnet(base, prefix, 'ipv4');
for (const [base, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
  ['2001:db8::', 32], ['2001::', 32], ['2002::', 16], ['64:ff9b::', 96]
]) blocked.addSubnet(base, prefix, 'ipv6');

// Only isolated test sandboxes may send to their local HTTP receiver.
const testPrivateAllowed = () => process.env.NODE_ENV === 'test' && process.env.WEBHOOK_ALLOW_PRIVATE === '1';
const invalid = () => new AppError('Güvenli, genel internete açık HTTPS adresi gerekli / A public HTTPS endpoint is required', 422);

function parseTarget(raw) {
  let url;
  try { url = new URL(raw); } catch { throw invalid(); }
  if (url.username || url.password || url.hash || !url.hostname ||
      (url.protocol !== 'https:' && !(testPrivateAllowed() && url.protocol === 'http:'))) throw invalid();
  return url;
}

function isBlockedAddress(address, family) {
  return blocked.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

async function resolveTarget(raw) {
  const url = parseTarget(raw);
  let addresses;
  let timer;
  try {
    addresses = await Promise.race([
      dns.lookup(url.hostname, { all: true, verbatim: true }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('DNS timeout')), 4000); })
    ]);
  } catch { throw invalid(); } finally { clearTimeout(timer); }
  if (!addresses.length || (!testPrivateAllowed() && addresses.some(a => isBlockedAddress(a.address, a.family)))) throw invalid();
  return { url, address: addresses[0] };
}

async function postWebhook(raw, body, headers, timeoutMs) {
  const { url, address } = await resolveTarget(raw);
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(url, {
      method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
      timeout: timeoutMs
    }, res => {
      const status = res.statusCode || 0;
      res.destroy(); // The response body is not part of the delivery contract.
      resolve(status);
    });
    req.on('timeout', () => req.destroy(new Error('Zaman aşımı / Timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

module.exports = { parseTarget, resolveTarget, postWebhook, isBlockedAddress };
