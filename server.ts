import './bootstrapEnv';
import { createServer } from './app';
import * as db from './db';
import { startOfferPoller } from './jobs/offerPoller';
import { describeAccess, readConfig } from './lib/apiKeys';

const PORT = process.env.PORT || 3000;

// Prepare the data store first (on a new database this creates the tables and
// loads the sample data), then start answering requests.
db.init()
  .then(() => {
    createServer().listen(PORT, () => {
      console.log(`Kazi Connect API running on http://localhost:${PORT}`);
      console.log(`Swagger UI:           http://localhost:${PORT}/docs`);
      console.log(`Data is stored:       ${db.kind === 'postgres' ? 'in the PostgreSQL database (kept)' : 'in memory (resets on restart)'}`);
      const sherehe = process.env.SHEREHE_API_URL && process.env.SHEREHE_API_KEY;
      const access = readConfig();
      console.log(`API access:          ${describeAccess(access)}`);
      for (const problem of access.problems) console.warn(`API_KEYS: ${problem}`);
      console.log(`Event work (Sherehe): ${sherehe ? process.env.SHEREHE_API_URL : 'not set up (set SHEREHE_API_URL and SHEREHE_API_KEY); everything else works without it'}`);
      startOfferPoller(); // follows pending staffing offers until the organiser decides
    });
  })
  .catch((err: unknown) => {
    console.error('Could not start: the database is not reachable.', err instanceof Error ? err.message : err);
    process.exit(1);
  });
