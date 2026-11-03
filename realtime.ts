// ENDPOINT 6: WebSocket at /api/applications/{applicationId}/subscribe   (Statement 5)
// Sends the current status once on connect, then a new message every time the
// status changes. Every message is an ApplicationStatus object. If the
// application is cancelled (DELETE), a final message with status "cancelled"
// is sent and the connection is closed.
//
// Route handlers cannot accept a WebSocket upgrade, so app.ts attaches this to the http.Server
// that sits around the Next app.

import type { IncomingMessage, Server } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer } from 'ws';
import * as db from './db';
import { toApplicationStatus } from './mappers';
import type { ApplicationEvent } from './lib/storeTypes';
import { clientAddress, gate } from './lib/apiGate';
import { KEY_SUBPROTOCOL, keyFromSubprotocols } from './lib/apiKeys';

const SUBSCRIBE_PATH = /^\/api\/applications\/([^/]+)\/subscribe\/?$/;

function refuse(socket: Duplex, statusLine: string, extraHeaders = ''): void {
  socket.write(`HTTP/1.1 ${statusLine}\r\nConnection: close\r\n${extraHeaders}Content-Length: 0\r\n\r\n`);
  socket.destroy();
}

// Takes over ALL of the server's upgrade requests.
//
// Next.js attaches its own 'upgrade' listener to the server on the first HTTP request it handles, and
// that listener ends the socket of any URL Next has a route for, which includes this endpoint's path.
// Left alone, a WebSocket would be accepted and then dropped (code 1006) as soon as any page or API
// call had been served. So upgrades are not delivered to listeners at all: they come here, subscribe
// requests are handled, and anything else is refused, as it always was. passOn lets app.ts give an
// upgrade to Next on purpose (the Next dev server needs its own for hot reloading); it returns true
// if it dealt with it.
export function attachRealtime(server: Server, { passOn }: { passOn?: (req: IncomingMessage, socket: Duplex, head: Buffer) => boolean } = {}): WebSocketServer {
  // A browser cannot set headers on a WebSocket, so it sends its API key as the subprotocol "kazi-key.<key>".
  // The handshake must answer with the subprotocol it chose, or the browser drops the connection.
  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => [...protocols].find((p) => p.startsWith(KEY_SUBPROTOCOL)) ?? false,
  });

  const upgrade = async (req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> => {
    let applicationId: string | null = null;
    try {
      const match = SUBSCRIBE_PATH.exec(new URL(req.url || '/', 'http://localhost').pathname);
      if (match) applicationId = decodeURIComponent(match[1]);
    } catch {
      applicationId = null;
    }
    // Anything that is not a subscribe request can be handed on (the Next dev server needs its own
    // upgrade for hot reloading). Everything else is refused, as it always was.
    if (!applicationId && passOn && passOn(req, socket, head)) return;

    // The key and the rate limit, before anything is looked up, so a caller without a key learns nothing about which ids exist.
    if (applicationId) {
      const result = gate({
        key: (req.headers['x-api-key'] as string | undefined) ?? keyFromSubprotocols(req.headers['sec-websocket-protocol']),
        address: clientAddress(req.headers['x-forwarded-for'], req.socket.remoteAddress),
      });
      if (!result.ok) {
        refuse(socket, result.status === 401 ? '401 Unauthorized' : '429 Too Many Requests', result.retryAfter === undefined ? '' : `Retry-After: ${result.retryAfter}\r\n`);
        return;
      }
    }

    const existing = applicationId ? await db.findApplicationById(applicationId).catch(() => null) : null;
    if (!existing || !applicationId) {
      refuse(socket, '404 Not Found');
      return;
    }
    const id = applicationId;

    // Completes the handshake, which answers 101 Switching Protocols.
    wss.handleUpgrade(req, socket, head, async (ws) => {
      const send = (row: ApplicationEvent): void => ws.send(JSON.stringify(toApplicationStatus(row)));
      const current = await db.findApplicationById(id);
      if (current && ws.readyState === ws.OPEN) send(current);

      const onChange = (changedId: string, row: ApplicationEvent): void => {
        if (changedId === id && ws.readyState === ws.OPEN) send(row);
      };
      const onRemoved = (removedId: string, row: ApplicationEvent): void => {
        if (removedId !== id || ws.readyState !== ws.OPEN) return;
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
  };

  const deliver = server.emit.bind(server) as (event: string | symbol, ...args: unknown[]) => boolean;
  server.emit = ((event: string | symbol, ...args: unknown[]): boolean => {
    if (event !== 'upgrade') return deliver(event, ...args);
    const [req, socket, head] = args as [IncomingMessage, Duplex, Buffer];
    upgrade(req, socket, head).catch(() => socket.destroy());
    return true;
  }) as typeof server.emit;

  return wss;
}
