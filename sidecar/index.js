const http = require('http');

const TARGET_HOST = '127.0.0.1';
const TARGET_PORT = 3001;
const LISTEN_PORT = Number(process.env.PROXY_PORT) || 3000;
const TRUSTED_ORIGIN = 'http://127.0.0.1:3001';

// HTTP request handler — forwards to DSH with corrected headers.
// SSE streams pipe directly via proxyRes.pipe(res), keeping the connection alive.
const server = http.createServer((req, res) => {
  console.log(`[sidecar] Request: ${req.method} ${req.url}`);

  const outgoingHeaders = { ...req.headers };
  outgoingHeaders.host = '127.0.0.1:3001';
  outgoingHeaders.origin = TRUSTED_ORIGIN;
  outgoingHeaders.referer = TRUSTED_ORIGIN + '/';
  // Strip browser security headers that DSH doesn't expect from loopback
  delete outgoingHeaders['sec-fetch-site'];
  delete outgoingHeaders['sec-websocket-origin'];

  const options = {
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: outgoingHeaders,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    console.log(`[sidecar] Response: ${req.method} ${req.url} -> ${proxyRes.statusCode}`);
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error(`[sidecar] Proxy error: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Bad Gateway');
    }
  });

  req.pipe(proxyReq);
});

// WebSocket upgrade handler — pipes the upgrade request to DSH,
// then bidirectionally pipes the upgraded sockets.
server.on('upgrade', (req, socket, head) => {
  console.log(`[sidecar] WS upgrade: ${req.url}`);

  const outgoingHeaders = { ...req.headers };
  outgoingHeaders.host = '127.0.0.1:3001';
  delete outgoingHeaders.origin;
  delete outgoingHeaders['sec-websocket-origin'];

  const options = {
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: req.url,
    method: 'GET',
    headers: outgoingHeaders,
  };

  const proxyReq = http.request(options);

  // Forward any initial data (WebSocket handshake)
  if (head && head.length > 0) {
    proxyReq.write(head);
  }

  proxyReq.on('response', (proxyRes) => {
    if (proxyRes.statusCode === 101) {
      console.log(`[sidecar] WS upgrade successful: ${req.url}`);
      // Bidirectional pipe: client <-> DSH
      socket.pipe(proxyReq);
      proxyRes.pipe(socket);
    } else {
      console.log(`[sidecar] WS upgrade failed: ${req.url} -> ${proxyRes.statusCode}`);
      proxyRes.on('data', (chunk) => socket.write(chunk));
      proxyRes.on('end', () => socket.end());
    }
  });

  proxyReq.on('error', (err) => {
    console.error(`[sidecar] WS proxy error: ${err.message}`);
    socket.end();
  });

  proxyReq.end();
});

server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(`Sidecar proxy started on 0.0.0.0:${LISTEN_PORT}`);
});
