const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yaml');

const jobsRouter = require('./jobsRoutes');
const applicationsRouter = require('./applicationsRoutes');
const { attachRealtime } = require('./realtime');

const CONTRACT_PATH = path.join(__dirname, 'openapi.yaml');

function createServer() {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false); // always send a real 200, never a cached 304

  // Allows Swagger Editor (editor.swagger.io) to call this local server as well.
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  // Week 6: read JSON request bodies for POST and PUT.
  app.use(express.json());

  // Swagger UI, built straight from the contract file. Try it out always
  // sends requests to the address this page was opened from, so it works the
  // same on localhost and when the app is hosted online.
  const contract = YAML.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
  app.set('trust proxy', true); // behind a host's proxy, report https correctly
  app.use('/docs', (req, res, next) => {
    req.swaggerDoc = { ...contract, servers: [{ url: `${req.protocol}://${req.get('host')}`, description: 'This server' }] };
    next();
  }, swaggerUi.serveFiles(), swaggerUi.setup());
  app.get('/openapi.yaml', (req, res) => res.sendFile(CONTRACT_PATH));
  app.get('/', (req, res) => res.redirect('/docs'));

  app.use('/api/jobs', jobsRouter);
  app.use('/api/applications', applicationsRouter);

  // Anything else: 404 with no body.
  app.use((req, res) => res.status(404).end());

  // A body that is not valid JSON is rejected with 400 before any route runs.
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ message: 'Request body is not valid JSON' });
    }
    console.error(err);
    res.status(500).json({ message: 'Internal server error' });
  });

  const server = http.createServer(app);
  attachRealtime(server);
  return server;
}

module.exports = { createServer };
