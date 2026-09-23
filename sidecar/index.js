const http = require('http');
const httpProxy = require('http-proxy');

const LISTEN_PORT = Number(process.env.PROXY_PORT) || 3000;
const TARGET_ORIGIN = process.env.TARGET_ORIGIN || 'http://dsh-main:3000';

const proxy = httpProxy.createProxyServer({
  target: TARGET_ORIGIN,
  ws: true,
  changeOrigin: true,
});

proxy.on('error', (err, req, res) => {
  console.error(`[sidecar] Proxy error: ${err.code || err.message}`);
  if (!res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('502 Bad Gateway: Upstream DSH unreachable');
  }
});

const server = http.createServer((req, res) => {
  // Ensure host header matches target origin to avoid 403s
  try {
    req.headers['host'] = new URL(req.url, TARGET_ORIGIN).hostname;
  } catch (e) {
    // Fallback if URL parsing fails
    req.headers['host'] = new URL(TARGET_ORIGIN).hostname;
  }
  proxy.web(req, res);
});

server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(`Sidecar proxy started, listening on 0.0.0.0:${LISTEN_PORT}, forwarding to ${TARGET_ORIGIN}`);
});
