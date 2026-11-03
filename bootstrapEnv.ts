// Imported first by server.ts and the scripts, before anything reads a setting.
//
// 1. Next.js decides between development and production from NODE_ENV when it starts, so it has to be
//    set before Next is loaded. Done here, not in the npm scripts, so the same commands work in Windows
//    Command Prompt, PowerShell and bash.
//      npm start            -> production (needs `npm run build` first)
//      npm run dev          -> development (passes --dev)
//
// 2. Settings in a .env file (PORT, DATABASE_URL, SHEREHE_API_URL, SHEREHE_API_KEY, ...) are read here, with
//    the loader Next.js itself uses, so they are in place before db.ts chooses between PostgreSQL and
//    memory and before server.ts reads PORT. Left to Next alone this happens too late: Next reads .env only
//    when it starts, after those two have already looked. A real environment variable always wins over .env.

import { loadEnvConfig } from '@next/env';

if (!process.env.NODE_ENV) {
  Object.assign(process.env, { NODE_ENV: process.argv.includes('--dev') ? 'development' : 'production' });
}

loadEnvConfig(__dirname, process.env.NODE_ENV === 'development');
