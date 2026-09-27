const { createServer } = require('./app');

const PORT = process.env.PORT || 3000;

createServer().listen(PORT, () => {
  console.log(`Kazi Connect API running on http://localhost:${PORT}`);
  console.log(`Swagger UI:           http://localhost:${PORT}/docs`);
});
