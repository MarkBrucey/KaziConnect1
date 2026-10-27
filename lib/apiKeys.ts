// API keys: who is calling. Week 9.
//
// Keys come from the environment, never from source code:
//   API_KEYS=ujuzi:<key>,website:<key>,team:<key>       one key per consumer, "name:key", comma separated
//   (a bare key with no "name:" gets the name key1, key2, ...)
//   REQUIRE_API_KEY=true                                refuse every call until at least one valid key is configured
//
// With no API_KEYS and no REQUIRE_API_KEY the API stays open, exactly as it was (the original tests and a clean
// clone run that way), and it says so when it starts. Setting API_KEYS turns on the key check AND the rate limit.
//
// A key is compared by its SHA-256, with no early exit, so how long a wrong key takes says nothing about how
// close it was. Keys are never written to a log; only their count and the consumers' names are.

import { createHash, timingSafeEqual } from 'node:crypto';

export interface Consumer {
  name: string;
  key: string; // kept in memory so the website's own key can be handed to its pages; never logged
  digest: Buffer;
}

export interface KeyConfig {
  consumers: Consumer[];
  required: boolean; // keys (and the rate limit) are enforced
  problems: string[]; // entries that were ignored, said at startup
}

export const MIN_KEY_LENGTH = 16;
export const WEBSITE_CONSUMER = 'website';
const NAME = /^[A-Za-z0-9_-]{1,40}$/;

const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest();

export function parseKeys(raw: string | undefined): { consumers: Consumer[]; problems: string[] } {
  const consumers: Consumer[] = [];
  const problems: string[] = [];
  const entries = (raw || '').split(',').map((entry) => entry.trim()).filter(Boolean);
  entries.forEach((entry, index) => {
    const colon = entry.indexOf(':');
    const name = colon === -1 ? `key${index + 1}` : entry.slice(0, colon).trim();
    const key = colon === -1 ? entry : entry.slice(colon + 1).trim();
    if (!NAME.test(name)) { problems.push(`entry ${index + 1} ignored: the consumer name must be 1 to 40 letters, digits, - or _`); return; }
    if (key.length < MIN_KEY_LENGTH) { problems.push(`the key for "${name}" ignored: it is shorter than ${MIN_KEY_LENGTH} characters`); return; }
    if (consumers.some((c) => c.name === name)) { problems.push(`a second key named "${name}" ignored`); return; }
    if (consumers.some((c) => c.key === key)) { problems.push(`the key for "${name}" ignored: it repeats another consumer's key`); return; }
    consumers.push({ name, key, digest: sha256(key) });
  });
  return { consumers, problems };
}

// Parsed once per distinct setting, not on every request.
let memo: { raw: string; parsed: ReturnType<typeof parseKeys> } | null = null;

export function readConfig(env: Record<string, string | undefined> = process.env): KeyConfig {
  const raw = env.API_KEYS || '';
  if (!memo || memo.raw !== raw) memo = { raw, parsed: parseKeys(raw) };
  const { consumers, problems } = memo.parsed;
  return { consumers, problems, required: consumers.length > 0 || (env.REQUIRE_API_KEY || '').trim().toLowerCase() === 'true' };
}

// Who the key belongs to, or null. Every key is compared, with no early exit.
export function identify(presented: string | null | undefined, config: KeyConfig): Consumer | null {
  if (!presented) return null;
  const candidate = sha256(presented);
  let found: Consumer | null = null;
  for (const consumer of config.consumers) {
    if (timingSafeEqual(candidate, consumer.digest)) found = consumer;
  }
  return found;
}

// The key the website's own pages send. It is handed to every visitor, so it identifies the website and is not a secret.
export function websiteKey(config: KeyConfig = readConfig()): string | null {
  return config.consumers.find((c) => c.name === WEBSITE_CONSUMER)?.key ?? null;
}

// One line for the startup log, with no key in it.
export function describeAccess(config: KeyConfig = readConfig()): string {
  if (config.consumers.length > 0) return `API keys required: ${config.consumers.length} loaded (${config.consumers.map((c) => c.name).join(', ')}); rate limit on`;
  if (config.required) return 'API keys required, but none are configured (REQUIRE_API_KEY is set and API_KEYS is empty): every call is refused';
  return 'open: no API_KEYS set, so no key is required (set API_KEYS before deploying)';
}

// A browser cannot set headers on a WebSocket, so it offers the key as a subprotocol: "kazi-key.<key>".
export const KEY_SUBPROTOCOL = 'kazi-key.';
export function keyFromSubprotocols(header: string | string[] | undefined): string | null {
  const text = Array.isArray(header) ? header.join(',') : header || '';
  for (const part of text.split(',')) {
    const protocol = part.trim();
    if (protocol.startsWith(KEY_SUBPROTOCOL)) return protocol.slice(KEY_SUBPROTOCOL.length) || null;
  }
  return null;
}
