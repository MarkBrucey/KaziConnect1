// Chooses where Kazi Connect keeps its data:
//   DATABASE_URL set (for example a free Neon database)  -> PostgreSQL, data is kept
//   no DATABASE_URL (tests, or running on your computer) -> in memory, resets on restart
// Both stores have exactly the same functions, and every function is async.

module.exports = process.env.DATABASE_URL ? require('./pgStore') : require('./memoryStore');
