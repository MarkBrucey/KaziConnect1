const { createServer } = require('./app');
const db = require('./db');

const PORT = process.env.PORT || 3000;

// Prepare the data store first (on a new database this creates the tables and
// loads the sample data), then start answering requests.
db.init()
  .then(() => {
    createServer().listen(PORT, () => {
      console.log(`Kazi Connect API running on http://localhost:${PORT}`);
      console.log(`Swagger UI:           http://localhost:${PORT}/docs`);
      console.log(`Data is stored:       ${db.kind === 'postgres' ? 'in the PostgreSQL database (kept)' : 'in memory (resets on restart)'}`);
    });
  })
  .catch((err) => {
    console.error('Could not start: the database is not reachable.', err.message);
    process.exit(1);
  });
