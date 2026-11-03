// Reads a .env file into a plain object. It does not touch process.env, so it can be read again each
// time (the ring watcher does, to pick up an address pasted in while it runs). A real environment
// variable still wins: callers put process.env after this.

import fs from 'fs';

export function readDotEnv(file: string): Record<string, string> {
  const values: Record<string, string> = {};
  if (!fs.existsSync(file)) return values;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && !line.trim().startsWith('#')) values[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return values;
}
