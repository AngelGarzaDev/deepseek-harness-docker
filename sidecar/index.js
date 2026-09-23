const http = require('http');
const httpProxy = require('http-proxy');

const LISTEN_PORT = Number(process.env.PROXY_PORT) || 3000;
const TARGET_ORIGIN = process.env.TARGET_ORIGIN || 'http://dsh-main:3000';

const proxy = httpProxy.createProxyServer({
  target: TARGET_ORIGIN,
  ws: true,
  changeOrigin: true
});

proxy.on('proxyReq', (proxyReq, req, res) => {
  // DSH /api Host fence: Host must be loopback (or a --trusted-host entry),
  // and an Origin header, if present, must match Host. The sidecar sits
  // between the browser and loopback-only DSH, so present the request as
  // coming from loopback and drop browser markers that would conflict.
  proxyReq.headers['host'] = '127.0.0.1:3001';
  delete proxyReq.headers['origin'];
  delete proxyReq.headers['referer'];
  delete proxyReq.headers['sec-fetch-site'];

  console.log(`[sidecar] Request: ${req.method} ${req.url}`);
});

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

server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(`Sidecar proxy started, listening on 0.0.0.0:${LISTEN_PORT}, forwarding to ${TARGET_ORIGIN}`);
});
