// ENDPOINT 6: WebSocket at /api/applications/{applicationId}/subscribe   (Statement 5)
// Sends the current status once on connect, then a new message every time the
// status changes. Every message is an ApplicationStatus object. If the
// application is cancelled (DELETE), a final message with status "cancelled"
// is sent and the connection is closed.

const { WebSocketServer } = require('ws');
const db = require('./db');
const { toApplicationStatus } = require('./mappers');

const SUBSCRIBE_PATH = /^\/api\/applications\/([^/]+)\/subscribe\/?$/;

function refuse(socket, statusLine) {
  socket.write(`HTTP/1.1 ${statusLine}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function attachRealtime(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    let applicationId = null;
    try {
      const match = SUBSCRIBE_PATH.exec(new URL(req.url, 'http://localhost').pathname);
      if (match) applicationId = decodeURIComponent(match[1]);
    } catch (err) {
      applicationId = null;
    }
    if (!applicationId || !db.findApplicationById(applicationId)) {
      return refuse(socket, '404 Not Found');
    }

    // Completes the handshake, which answers 101 Switching Protocols.
    wss.handleUpgrade(req, socket, head, (ws) => {
      const send = (row) => ws.send(JSON.stringify(toApplicationStatus(row)));
      send(db.findApplicationById(applicationId));

      const onChange = (changedId, row) => {
        if (changedId === applicationId && ws.readyState === ws.OPEN) send(row);
      };
      const onRemoved = (removedId, row) => {
        if (removedId !== applicationId || ws.readyState !== ws.OPEN) return;
        send(row);
        ws.close(1000, 'Application cancelled');
      };
      db.events.on('statusChanged', onChange);
      db.events.on('removed', onRemoved);
      ws.on('close', () => {
        db.events.off('statusChanged', onChange);
        db.events.off('removed', onRemoved);
      });
    });
  });

  return wss;
}

module.exports = { attachRealtime };
