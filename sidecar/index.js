const http = require('http');
const httpProxy = require('http-proxy');

const LISTEN_PORT = Number(process.env.PROXY_PORT) || 3000;
const TARGET_ORIGIN = process.env.TARGET_ORIGIN || 'http://127.0.0.1:3001';

const proxy = httpProxy.createProxyServer({
  target: TARGET_ORIGIN,
  ws: true
  // No changeOrigin: we manually set Host header in proxyReq / proxyReqWs
});

// HTTP request handler — rewrites Host for DSH /api security fence.
// Set Origin to the trusted target (not strip it) so SSE /api routes
// that validate origin against host will accept the connection.
proxy.on('proxyReq', (proxyReq, req, res) => {
  proxyReq.setHeader('host', '127.0.0.1:3001');
  proxyReq.setHeader('origin', 'http://127.0.0.1:3001');
  proxyReq.removeHeader('referer');
  proxyReq.removeHeader('sec-fetch-site');
  proxyReq.removeHeader('sec-websocket-origin');
  console.log(`[sidecar] Request: ${req.method} ${req.url}`);
});

// WebSocket upgrade — correct event is proxyReqWs (NOT wsReq).
// changeOrigin is not set, so we must set Host here too.
// Also strip origin headers that would mismatch the rewritten Host.
proxy.on('proxyReqWs', (proxyReq, req, socket, options, head) => {
  proxyReq.setHeader('host', '127.0.0.1:3001');
  proxyReq.removeHeader('origin');
  proxyReq.removeHeader('sec-websocket-origin');
  console.log(`[sidecar] WS upgrade: ${req.url} -> ${options.target.href}`);

  // Guard against ECONNRESET crashes when client disconnects
  // during non-101 responses (e.g. DSH returning 401).
  socket.on('error', (err) => {
    console.log(`[sidecar] WS socket error (ignored): ${err.code || err.message}`);
  });
});

// Forward WebSocket upgrade connections from server to proxy
proxy.on('error', (err, req, res) => {
  console.error(`[sidecar] Proxy error: ${err.code || err.message}`);
  if (!res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('502 Bad Gateway: Upstream DSH unreachable');
  }
});

const server = http.createServer((req, res) => {
  proxy.web(req, res);
});

// WebSocket upgrade handler — required for ws: true to work
server.on('upgrade', (req, socket, head) => {
  console.log(`[sidecar] WS upgrade received: ${req.url}`);
  proxy.ws(req, socket, head);
});

server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(`Sidecar proxy started, listening on 0.0.0.0:${LISTEN_PORT}, forwarding to ${TARGET_ORIGIN}`);
});
