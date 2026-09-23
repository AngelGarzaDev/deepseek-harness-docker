const http = require('http');
const httpProxy = require('http-proxy');
const crypto = require('crypto');
const { serveIndex, injectIntoHead } = require('./upstream-token.js');
const { attachBodyTransform } = require('./compression.js');

// Source port (DSH listening port, default 3079) and proxy port (external proxy listening port, default 3080).
// Both must be different (only one process can listen on a single port); both can be overridden via environment variables:
//   DSH_PORT=Source Port (DSH)   PROXY_PORT=Proxy Port (External)
const DSH_PORT = Number(process.env.DSH_PORT) || 3079;
const LISTEN_PORT = Number(process.env.PROXY_PORT) || 3080;
const TARGET_ORIGIN = `http://127.0.0.1:${DSH_PORT}`;
const AUTH_REALM = 'dsh-proxy';

// Basic Auth: Username/Password set via environment variables.
// Authentication is enabled only if both are set; if either is missing, access is fully allowed (no auth required).
const AUTH_USER = process.env.PROXY_USERNAME || '';
const AUTH_PASS = process.env.PROXY_PASSWORD || '';

// Public static resource whitelist: contains only non-sensitive data like app name/icons (PWA manifest, site icons).
// When browser fetches <link rel="manifest"> (tag without crossorigin="use-credentials"),
// it won't carry Basic Auth credentials; if these paths also enforce auth, console will keep reporting
// /manifest.webmanifest 401. Thus skip auth for whitelisted paths; pages, APIs, and WS still require auth.
const PUBLIC_PATHS = new Set(['/manifest.webmanifest', '/favicon.svg', '/favicon.ico']);
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function checkAuth(req) {
  if (!AUTH_USER || !AUTH_PASS) return true; // Not configured -> No auth required
  const m = /^Basic\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!m) return false;
  let decoded;
  try {
    decoded = Buffer.from(m[1], 'base64').toString('utf8');
  } catch {
    return false;
  }
  const i = decoded.indexOf(':');
  if (i === -1) return false;
  return safeEqual(decoded.slice(0, i), AUTH_USER) && safeEqual(decoded.slice(i + 1), AUTH_PASS);
}

function rejectUnauthorized(res) {
  res.writeHead(401, {
    'WWW-Authenticate': `Basic realm="${AUTH_REALM}"`,
    'Content-Type': 'text/plain; charset=utf-8',
  });
  res.end('401 Unauthorized');
}

function rejectUpgrade(socket) {
  socket.end(`HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="${AUTH_REALM}"\r\nConnection: close\r\n\r\n`);
}

const proxy = httpProxy.createProxyServer({
  target: TARGET_ORIGIN,
  ws: true,
  changeOrigin: true,
});

// Error fallback: If upstream (DSH) is unreachable/crashed, http-proxy defaults to throwing without error listener.
// Uncaught exceptions lead to proxy process hanging. Here we handle all forwarding errors: HTTP requests get 502,
// WS upgrades destroy socket, and print error for easier debugging (DSH offline no longer causes process crash).
proxy.on('error', (err, req, res) => {
  console.error(`[proxy] Forwarding to upstream ${TARGET_ORIGIN} failed: ${err.code || err.message}`, err.stack || '');
  if (res && res.writeHead) {
    // Normal HTTP connection: Try returning 502 as much as possible; if response already sent, just end.
    if (res.headersSent) {
      res.end();
    } else {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('502 Bad Gateway: Upstream DSH unreachable or exited');
    }
  } else if (res && res.destroy) {
    // WS upgrade: res is underlying socket, no writeHead, directly destroy.
    res.destroy();
  }
});

// Core fix: crypto.randomUUID polyfill.
// DSH frontend uses crypto.randomUUID() to generate rpcId, but this API is only available in secure contexts (https/localhost).
// When accessing via LAN IP, page is insecure context -> randomUUID doesn't exist -> RPC requests fail -> WS setup fails.
// Proxy injects compatibility implementation based on getRandomValues during HTML forwarding (available in non-secure sources).
const POLYFILL = '<script>(function(){try{if(typeof crypto!=="undefined"&&crypto&&typeof crypto.randomUUID!=="function"){crypto.randomUUID=function(){var b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;var h="";for(var i=0;i<16;i++){h+=b[i].toString(16).padStart(2,"0")}return h.slice(0,8)+"-"+h.slice(8,12)+"-"+h.slice(12,16)+"-"+h.slice(16,20)+"-"+h.slice(20)}}}catch(e){}})();</script>';

// DSH frontend uses connection.isLoopback to determine availability of class features (plugin config cards, settings buttons, etc.):
// Only true when accessed via localhost/127.0.0.1 loopback addresses; hidden for hostname/LAN access.
// This proxy is the sole entry point for external access, browser always initiates from non-loopback address, so we
// rewrite `isLoopbackHostname(pageLocation.hostname)` to always be true, allowing settings functionality for LAN access.
const LOOPBACK_JS_NEEDLE = 'isLoopbackHostname(pageLocation.hostname)';
const LOOPBACK_JS_REPLACEMENT = 'true';

proxy.on('proxyRes', (proxyRes, req, res) => {
  const ct = String(proxyRes.headers['content-type'] || '');
  const isHtml = ct.includes('text/html');
  const isJs = ct.includes('javascript');
  if (!isHtml && !isJs) return;

  // Compatibility with all browser/upstream compression types (gzip / deflate / br, and uncompressed identity):
  // Buffer entire response body -> Decompress into plaintext via Content-Encoding -> Complete HTML/JS transformation -> Recompress
  // back using original encoding. This ensures transformation logic works regardless of whether the upstream used compression or what type it was.
  // (Previous approach stripped Accept-Encoding to force upstream plaintext, here we no longer rely on that premise)
  attachBodyTransform(res, proxyRes, plain => {
    const text = plain.toString('utf8');
    if (isHtml) {
      // HTML: Inject crypto.randomUUID polyfill
      return Buffer.from(injectIntoHead(text, POLYFILL));
    }
    // JS: Only transform if target needle hit (otherwise return null -> forward as-is, avoid unnecessary recompression)
    if (text.includes(LOOPBACK_JS_NEEDLE)) {
      return Buffer.from(text.split(LOOPBACK_JS_NEEDLE).join(LOOPBACK_JS_REPLACEMENT));
    }
    return null;
  });
});

// changeOrigin rewrites Host to target address, browser's Origin must match similarly,
// otherwise DSH same-origin checks (/api must have Origin == Host) will reject (403).
// WS handshake also undergoes this check.
// Note: No longer stripping Accept-Encoding. Regardless of whether upstream compresses (gzip/deflate/br are all okay),
// proxyRes's compression pipeline will [Decompress -> Transform -> Recompress], preserving bandwidth benefits.
function alignOrigin(req) {
  if (req.headers.origin) req.headers.origin = TARGET_ORIGIN;
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://proxy').pathname;
  if (!PUBLIC_PATHS.has(pathname) && !checkAuth(req)) {
    rejectUnauthorized(res);
    return;
  }
  // Root directory GET goes to serveIndex: when official DSH 0.1.2+ returns 401 with launch token on reload,
  // it exchanges for session cookie; if returns false (error), falls back to normal reverse proxy.
  if (req.method === 'GET' && pathname === '/') {
    serveIndex(req, res, { origin: TARGET_ORIGIN, transformHtml: html => injectIntoHead(html, POLYFILL) })
      .then((handled) => {
        if (handled) return;
        alignOrigin(req);
        proxy.web(req, res);
      });
    return;
  }
  alignOrigin(req);
  proxy.web(req, res);
});

server.on('upgrade', (req, socket, head) => {
  if (!checkAuth(req)) {
    rejectUpgrade(socket);
    return;
  }
  alignOrigin(req);
  proxy.ws(req, socket, head);
});

server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(`Proxy started, listening on 0.0.0.0:${LISTEN_PORT}, forwarding to ${TARGET_ORIGIN}${AUTH_USER && AUTH_PASS ? ' (Basic Auth enabled)' : ' (No auth enabled)'}`);
});
