// Small HTTP helpers for the route handlers, built to answer exactly as the Express version did
// (Endpoints 1 to 21 keep their headers, status codes and bodies byte for byte):
//
//   json(body, status)   JSON with "application/json; charset=utf-8" and a Content-Length, like res.json
//   fail(status, text)   { "message": text }
//   noContent()          204 with no body
//   empty(status)        an empty body, for the read endpoints' 400 and 404
//   readJson<T>(req)     the request body, read the way express.json({ limit: '20kb' }) read it
//   readQuery(...)       the query string, read the way the Express routes read req.query

import zlib from 'zlib';

export const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
export const BODY_LIMIT_BYTES = 20 * 1024;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  const text = JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { 'Content-Type': JSON_CONTENT_TYPE, 'Content-Length': String(Buffer.byteLength(text)), ...headers },
  });
}

export const fail = (status: number, message: string): Response => json({ message }, status);
export const noContent = (): Response => new Response(null, { status: 204 });
export const empty = (status: number, headers: Record<string, string> = {}): Response => new Response(null, { status, headers });

// Thrown by readJson when the body cannot be used. The route wrapper turns it into its response.
export class HttpFailure extends Error {
  readonly response: Response;

  constructor(response: Response) {
    super(`HTTP ${response.status}`);
    this.name = 'HttpFailure';
    this.response = response;
  }
}

const mediaType = (value: string | null): string => (value || '').split(';')[0].trim().toLowerCase();

function charsetOf(value: string | null): string | null {
  const match = /;\s*charset\s*=\s*"?([^";\s]+)"?/i.exec(value || '');
  return match ? match[1].toLowerCase() : null;
}

// Reads at most `limit` bytes. Returns null as soon as there are more.
async function readLimited(stream: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array | null> {
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  return all;
}

const tooLarge = (): HttpFailure => new HttpFailure(fail(413, 'Request body is too large'));
const notJson = (): HttpFailure => new HttpFailure(fail(400, 'Request body is not valid JSON'));
// What Express answered when body-parser refused the charset or encoding: its error handler's 500.
const unsupported = (): HttpFailure => new HttpFailure(fail(500, 'Internal server error'));

// A compressed body (gzip, deflate or br) is inflated like body-parser did: the 20 KB limit applies to
// what comes out, and a body that cannot be inflated (or an encoding we do not know) is Express's JSON 500.
// The compressed bytes themselves are read up to 1 MiB, so a small request cannot make us read forever.
async function inflate(req: Request, encoding: string): Promise<Uint8Array | null> {
  const inflater = { gzip: zlib.gunzipSync, deflate: zlib.inflateSync, br: zlib.brotliDecompressSync }[encoding as 'gzip' | 'deflate' | 'br'];
  if (!inflater) throw unsupported();
  let compressed: Uint8Array | null;
  try {
    compressed = await readLimited(req.body, 1024 * 1024);
  } catch {
    throw unsupported();
  }
  if (compressed === null) return null;
  try {
    const inflated = inflater(compressed, { maxOutputLength: BODY_LIMIT_BYTES + 1 });
    return inflated.byteLength > BODY_LIMIT_BYTES ? null : new Uint8Array(inflated);
  } catch (err) {
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') return null;
    throw unsupported();
  }
}

// Reads the JSON body like express.json({ limit: '20kb' }) did:
//   * only a body sent as application/json is read; anything else leaves the body undefined
//   * an empty JSON body is {}
//   * only objects and arrays are accepted (strict mode), so "abc", 12 and null are refused
//   * a body over 20 KB is refused with 413, a body that does not parse with 400
// Throws HttpFailure for those. Returns undefined when there is no JSON body to read.
export async function readJson<T = unknown>(req: Request): Promise<T | undefined> {
  const contentType = req.headers.get('content-type');
  const declared = req.headers.get('content-length');
  const hasBody = req.headers.has('transfer-encoding') || (declared !== null && !Number.isNaN(Number(declared)));
  if (!hasBody || mediaType(contentType) !== 'application/json') return undefined;

  const charset = charsetOf(contentType) || 'utf-8';
  if (!charset.startsWith('utf-')) throw unsupported();

  const encoding = (req.headers.get('content-encoding') || 'identity').trim().toLowerCase();
  let bytes: Uint8Array | null;
  if (encoding === 'identity') {
    if (declared !== null && Number(declared) > BODY_LIMIT_BYTES) throw tooLarge(); // refused before any of it is read
    try {
      bytes = await readLimited(req.body, BODY_LIMIT_BYTES);
    } catch {
      throw notJson();
    }
  } else {
    bytes = await inflate(req, encoding);
  }
  if (bytes === null) throw tooLarge();

  let text: string;
  try {
    text = new TextDecoder(charset).decode(bytes);
  } catch {
    throw unsupported();
  }
  if (text.length === 0) return {} as T; // express.json treated an empty body as {}
  const first = /^[\x20\x09\x0a\x0d]*([^\x20\x09\x0a\x0d])/.exec(text);
  if (!first || (first[1] !== '{' && first[1] !== '[')) throw notJson();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw notJson();
  }
}

// Reads the query parameters. Returns null if a required one is missing or blank, or if an
// optional one was sent but left empty, or if any was sent more than once (Express gave an
// array for that, which was refused the same way).
export function readQuery(req: Request, required: string[], optional: string[]): Record<string, string> | null {
  const params = new URL(req.url).searchParams;
  const values: Record<string, string> = {};
  for (const name of required.concat(optional)) {
    const all = params.getAll(name);
    if (all.length === 0 && optional.includes(name)) continue;
    if (all.length !== 1 || all[0].trim() === '') return null;
    values[name] = all[0].trim();
  }
  return values;
}
