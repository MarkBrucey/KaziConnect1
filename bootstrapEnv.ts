// Imported first by server.ts and the scripts. Next.js decides between development and production
// from NODE_ENV when it starts, so it has to be set before Next is loaded. Done here, not in the
// npm scripts, so the same commands work in Windows Command Prompt, PowerShell and bash.
//   npm start            -> production (needs `npm run build` first)
//   npm run dev          -> development (passes --dev)

if (!process.env.NODE_ENV) {
  Object.assign(process.env, { NODE_ENV: process.argv.includes('--dev') ? 'development' : 'production' });
}
