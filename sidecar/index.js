const http = require('http');
const zlib = require('zlib');

const TARGET_HOST = '127.0.0.1';
const TARGET_PORT = 3001;
const LISTEN_PORT = Number(process.env.PROXY_PORT) || 3000;
const TRUSTED_ORIGIN = 'http://127.0.0.1:3001';

// Patch DSH's isLoopback check so the browser thinks it's on loopback.
// DSH's ui-settings plugin uses isLoopback to decide settings persistence:
// only loopback origins get 'host' persistence; non-loopback gets 'memory'
// which renders settings as unavailable.  When this proxy is in front, the
// browser page origin is always non-loopback (e.g. https://dsh.petr.ie),
// but the DSH server trusts it because the proxy rewrites Host/Origin.
// The fix: replace the isLoopbackHostname(pageLocation.hostname) call with
// true so the settings mirror uses 'host' persistence and the Models page
// stops showing "settings are unavailable in this browser".
const LOOPBACK_JS_NEEDLE = 'isLoopbackHostname(pageLocation.hostname)';
const LOOPBACK_JS_REPLACEMENT = 'true';

// crypto.randomUUID polyfill.
// DSH frontend uses crypto.randomUUID() to generate rpcId. This API is only
// available in secure contexts (https/localhost). When accessed via a tunnel
// domain (non-secure origin), it's undefined → RPC calls fail → WS connection
// never establishes. Inject a polyfill before the main bundle loads.
const POLYFILL = `<script>(function(){try{if(typeof crypto!=="undefined"&&crypto&&typeof crypto.randomUUID!=="function"){crypto.randomUUID=function(){var b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;var h="";for(var i=0;i<16;i++){h+=b[i].toString(16).padStart(2,"0")}return h.slice(0,8)+"-"+h.slice(8,12)+"-"+h.slice(12,16)+"-"+h.slice(16,20)+"-"+h.slice(20)}}}catch(e){}})();</script>`;

/**
 * Compress a buffer using the same encoding the client sent.
 * Respects the client's Accept-Encoding to preserve bandwidth savings.
 */
function compressBuffer(data, encoding) {
  switch (encoding) {
    case 'br':
      return zlib.brotliCompressSync(data);
    case 'deflate':
      return zlib.deflateSync(data);
    case 'gzip':
    default:
      return zlib.gzipSync(data);
  }
}

/**
 * Parse Accept-Encoding header into a sorted list of encodings with quality.
 */
function parseAcceptEncoding(header) {
  if (!header) return [];
  return header.split(',')
    .map(part => {
      const [name, q = '1'] = part.trim().split(';').map(s => s.trim());
      const qVal = q.startsWith('q=') ? parseFloat(q.slice(2)) : 1;
      return { encoding: name, quality: qVal };
    })
    .sort((a, b) => b.quality - a.quality);
}

/**
 * Transform response body: decompress → patch → recompress.
 * Handles all combinations of upstream encoding and client encoding.
 */
function transformBody(res, proxyRes, req, plainText) {
  const text = plainText.toString('utf8');

  // HTML: inject crypto.randomUUID polyfill
  const ct = String(res.getHeader?.('content-type') || proxyRes.headers['content-type'] || '');
  if (ct.includes('text/html')) {
    return {
      body: injectIntoHead(text, POLYFILL),
      encoding: null, // don't re-compress the response headers
    };
  }

  // JS: patch isLoopback check if present
  if (ct.includes('javascript') && text.includes(LOOPBACK_JS_NEEDLE)) {
    return {
      body: text.split(LOOPBACK_JS_NEEDLE).join(LOOPBACK_JS_REPLACEMENT),
      encoding: null,
    };
  }

  // No changes needed
  return null;
}

function injectIntoHead(html, fragment) {
  const headClose = '</head>';
  if (html.includes(headClose)) {
    return html.replace(headClose, fragment + headClose);
  }
  // Fallback: if no </head>, inject before </html> or at the start
  const htmlClose = '</html>';
  if (html.includes(htmlClose)) {
    return html.replace(htmlClose, fragment + htmlClose);
  }
  return fragment + html;
}

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

    // Only transform non-streaming responses (not SSE, not 101)
    if (proxyRes.statusCode !== 101 && proxyRes.statusCode !== 200) {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
      return;
    }

    const ct = String(proxyRes.headers['content-type'] || '');
    const isHtml = ct.includes('text/html');
    const isJs = ct.includes('javascript');
    if (!isHtml && !isJs) {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
      return;
    }

    // Collect the full response body
    const chunks = [];
    const clientAcceptEncoding = req.headers['accept-encoding'] || '';
    const clientEncodings = parseAcceptEncoding(clientAcceptEncoding);

    // Determine what encoding the upstream used (if any)
    const upstreamEncoding = proxyRes.headers['content-encoding'];

    proxyRes.on('data', (chunk) => chunks.push(chunk));
    proxyRes.on('end', () => {
      const rawBody = Buffer.concat(chunks);

      // Step 1: Decompress to plaintext if upstream sent compressed content
      let plaintext;
      if (upstreamEncoding) {
        try {
          switch (upstreamEncoding) {
            case 'br':
              plaintext = zlib.brotliDecompressSync(rawBody);
              break;
            case 'deflate':
              plaintext = zlib.inflateSync(rawBody);
              break;
            case 'gzip':
              plaintext = zlib.gunzipSync(rawBody);
              break;
            default:
              plaintext = rawBody;
          }
        } catch (err) {
          console.error(`[sidecar] Failed to decompress: ${err.message}`);
          plaintext = rawBody;
        }
      } else {
        plaintext = rawBody;
      }

      // Step 2: Apply patches
      const result = transformBody(res, proxyRes, req, plaintext);

      if (result) {
        let body = result.body;
        // Recompress if client accepted compressed encoding
        let encoding = null;
        if (clientEncodings.length > 0) {
          const best = clientEncodings[0];
          if (best.encoding !== 'identity') {
            try {
              body = compressBuffer(Buffer.from(body, 'utf8'), best.encoding);
              encoding = best.encoding;
            } catch (err) {
              console.error(`[sidecar] Failed to recompress: ${err.message}`);
              body = Buffer.from(body, 'utf8');
            }
          }
        }

        const headers = { ...proxyRes.headers };
        headers['content-length'] = Buffer.byteLength(body);
        if (encoding) {
          headers['content-encoding'] = encoding;
        } else {
          delete headers['content-encoding'];
        }
        // Remove transfer-encoding so the body is sent as-is
        delete headers['transfer-encoding'];

        res.writeHead(proxyRes.statusCode, headers);
        res.end(body);
      } else {
        // No changes: forward as-is
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        res.end(rawBody);
      }
    });
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
