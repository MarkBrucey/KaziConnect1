// Sends the requests in parityCases.js to a running server and returns the answers in a form that two
// servers can be compared by. Used to record the Express answers (parity.golden.json) and to check the
// Next.js app against them.

const zlib = require('zlib');
const { specs } = require('./parityCases');

// Tokens, ports and nothing else that changes between runs are made the same.
const normalise = (text) => text
  .replace(/[a-f0-9]{64}/g, '<64hex>')
  .replace(/localhost:\d+/g, 'localhost:<port>')
  .replace(/127\.0\.0\.1:\d+/g, '127.0.0.1:<port>');

function encodeBody(spec) {
  const headers = { Accept: 'application/json', ...(spec.headers || {}) };
  let body = spec.raw;
  if (body === undefined && spec.json !== undefined) {
    body = JSON.stringify(spec.json);
    headers['Content-Type'] = 'application/json';
  }
  if (spec.raw !== undefined && !(spec.headers && spec.headers['Content-Type'])) headers['Content-Type'] = 'application/json';
  if (spec.gz === 'gzip') { body = zlib.gzipSync(body); headers['Content-Encoding'] = 'gzip'; }
  if (spec.gz === 'deflate') { body = zlib.deflateSync(body); headers['Content-Encoding'] = 'deflate'; }
  if (spec.gz === 'br') { body = zlib.brotliCompressSync(body); headers['Content-Encoding'] = 'br'; }
  if (spec.gz === 'fake-gzip') headers['Content-Encoding'] = 'gzip'; // says gzip, is not
  if (spec.gz === 'unknown') headers['Content-Encoding'] = 'compress';
  return { body, headers };
}

async function send(base, spec, tokens) {
  const { body, headers } = encodeBody(spec);
  if (spec.auth) headers.Authorization = `Bearer ${tokens[spec.auth]}`;
  const res = await fetch(`${base}${spec.path}`, { method: spec.method || 'GET', headers, body, redirect: 'manual' });
  const text = await res.text();
  const seen = {};
  res.headers.forEach((value, name) => { if (name !== 'date') seen[name] = normalise(value); });
  if (spec.keep) { try { tokens[spec.keep] = JSON.parse(text).token; } catch (err) { /* the answer was not a login */ } }
  if (spec.keepId) { try { tokens[spec.keepId] = JSON.parse(text)[spec.keepField || 'id']; } catch (err) { /* nothing to keep */ } }
  return { status: res.status, headers: seen, body: normalise(text) };
}

// Runs every request in order and returns { request, answer } for each.
async function runSpecs(base) {
  const tokens = {};
  const results = [];
  for (const spec of specs) {
    results.push({ request: `${spec.method || 'GET'} ${spec.path.slice(0, 80)}`, answer: await send(base, spec, tokens) });
  }
  return results;
}

module.exports = { runSpecs };
