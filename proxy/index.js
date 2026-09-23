#!/bin/sh
// index.js
const http = require('http');
const httpProxy = require('http-proxy');
const crypto = require('crypto');
const { serveIndex, injectIntoHead } = require('./upstream-token.js');
const { attachBodyTransform } = require('./compression.js');

// User environment variables mapping
const DSH_PORT = Number(process.env.DSH_INTERNAL_PORT) || 3079;
const LISTEN_PORT = Number(process.env.DSH_HTTP_PORT) || 3000;
const TARGET_ORIGIN = `http://127.0.0.1:${DSH_PORT}`;
const AUTH_REALM = 'dsh-proxy';

const AUTH_USER = process.env.PROXY_USERNAME || '';
const AUTH_PASS = process.env.PROXY_PASSWORD || '';

const PUBLIC_PATHS = new Set(['/manifest.webmanifest', '/favicon.svg', '/favicon.ico']);

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function checkAuth(req) {
  if (!AUTH_USER || !AUTH_PASS) return true;
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

proxy.on('error', (err, req, res) => {
  console.error(`[proxy] 转发上游 ${TARGET_ORIGIN} 出错：${err.code || err.message}`, err.stack || '');
  if (res && res.writeHead) {
    if (res.headersSent) {
      res.end();
    } else {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('502 Bad Gateway: 上游 DSH 不可达或已退出');
    }
  } else if (res && res.destroy) {
    res.destroy();
  }
});

const POLYFILL = '<script>(function(){try{if(typeof crypto!=="undefined"&&crypto&&typeof crypto.randomUUID!=="function"){crypto.randomUUID=function(){var b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;var h="";for(var i=0;i<16;i++){h+=b[i].toString(16).padStart(2,"0")}return h.slice(0,8)+"-"+h.slice(8,12)+"-"+h.slice(12,16)+"-"+h.slice(16,20)+"-"+h.slice(20)}}}catch(e){}})();</script>';

const LOOPBACK_JS_NEEDLE = 'isLoopbackHostname(pageLocation.hostname)';
const LOOPBACK_JS_REPLACEMENT = 'true';

proxy.on('proxyRes', (proxyRes, req, res) => {
  const ct = String(proxyRes.headers['content-type'] || '');
  const isHtml = ct.includes('text/html');
  const isJs = ct.includes('javascript');
  if (!isHtml && !isJs) return;

  attachBodyTransform(res, proxyRes, plain => {
    const text = plain.toString('utf8');
    if (isHtml) {
      return Buffer.from(injectIntoHead(text, POLYFILL));
    }
    if (text.includes(LOOPBACK_JS_NEEDLE)) {
      return Buffer.from(text.split(LOOPBACK_JS_NEEDLE).join(LOOPBACK_JS_REPLACEMENT));
    }
    return null;
  });
});

function alignOrigin(req) {
  if (req.headers.origin) req.headers.origin = TARGET_ORIGIN;
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://proxy').pathname;
  if (!PUBLIC_PATHS.has(pathname) && !checkAuth(req)) {
    rejectUnauthorized(res);
    return;
  }
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
  console.log(`代理已启动，监听 0.0.0.0:${LISTEN_PORT}，转发到 ${TARGET_ORIGIN}${process.env.PROXY_USERNAME && process.env.PROXY_PASSWORD ? '（Basic Auth 已启用）' : '（未启用认证）'}`);
});
