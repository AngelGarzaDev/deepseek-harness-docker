const http = require('http');
const httpProxy = require('http-proxy');

const LISTEN_PORT = Number(process.env.PROXY_PORT) || 3000;
const TARGET_ORIGIN = process.env.TARGET_ORIGIN || 'http://127.0.0.1:3001';

const proxy = httpProxy.createProxyServer({
  target: TARGET_ORIGIN,
  ws: true,
  changeOrigin: true
});

// HTTP request handler — rewrites Host header for DSH /api security fence
proxy.on('proxyReq', (proxyReq, req, res) => {
  proxyReq.setHeader('host', '127.0.0.1:3001');
  proxyReq.removeHeader('origin');
  proxyReq.removeHeader('referer');
  proxyReq.removeHeader('sec-fetch-site');
  console.log(`[sidecar] Request: ${req.method} ${req.url}`);
});

// WebSocket upgrade request — apply same Host-header rewriting before upgrade
proxy.on('wsReq', (proxyReq) => {
  proxyReq.setHeader('host', '127.0.0.1:3001');
  proxyReq.removeHeader('origin');
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
  console.log(`[sidecar] WS upgrade: ${req.url}`);
  proxy.ws(req, socket, head);
});

server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(`Sidecar proxy started, listening on 0.0.0.0:${LISTEN_PORT}, forwarding to ${TARGET_ORIGIN}`);
});
