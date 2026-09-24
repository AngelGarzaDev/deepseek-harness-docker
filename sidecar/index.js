const http = require('http');
const httpProxy = require('http-proxy');

const LISTEN_PORT = Number(process.env.PROXY_PORT) || 3000;
const TARGET_ORIGIN = process.env.TARGET_ORIGIN || 'http://127.0.0.1:3001';
const TRUSTED_ORIGIN = 'http://127.0.0.1:3001';

const proxy = httpProxy.createProxyServer({
  target: TARGET_ORIGIN,
  ws: true
});

// HTTP request handler — rewrites Host, sets Origin/Referer to trusted target.
// SSE /api routes need Origin AND Referer present for DSH to accept the connection.
proxy.on('proxyReq', (proxyReq, req, res) => {
  proxyReq.setHeader('host', '127.0.0.1:3001');
  proxyReq.setHeader('origin', TRUSTED_ORIGIN);
  proxyReq.setHeader('referer', TRUSTED_ORIGIN + '/');
  proxyReq.removeHeader('sec-fetch-site');
  proxyReq.removeHeader('sec-websocket-origin');
  console.log(`[sidecar] Request: ${req.method} ${req.url}`);
});

// HTTP response handler — logs response status so we can see if DSH replies
proxy.on('proxyRes', (proxyRes, req, res) => {
  console.log(`[sidecar] Response: ${req.method} ${req.url} -> ${proxyRes.statusCode}`);
});

// WebSocket upgrade — correct event is proxyReqWs (NOT wsReq).
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
