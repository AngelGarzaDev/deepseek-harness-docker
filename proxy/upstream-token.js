#!/bin/sh
# 上游自动授权（前向兼容官方 DSH 0.1.2+ 的 launch-token 机制）。
#
# 设计目标：token 完全由本镜像处理，LAN 用户经 Basic Auth 通过后，不再需要任何额外动作。
# 关键点：绝不在每次转发时注入 token——官方模型是「launch token 换取浏览器会话 cookie」，
# 若每请求都带 token，上游会为每个请求签发一个全新身份，出现身份错乱。
const fs = require('fs');

const LOG_FILE = process.env.DSH_WEB_LOG || '/app/.dsh-web.log';
const TOKEN_FILE_AUTO = process.env.DSH_TOKEN_FILE_AUTO || '/app/.dsh-launch-token';
const TOKEN_QUERY_KEY = process.env.DSH_TOKEN_QUERY_KEY || 'token';

const HARD_TOKEN = process.env.DSH_TOKEN || '';
const HARD_TOKEN_FILE = process.env.DSH_TOKEN_FILE || '';

let PATTERN = null;
if (process.env.DSH_LAUNCH_TOKEN_PATTERN) {
  try { PATTERN = new RegExp(process.env.DSH_LAUNCH_TOKEN_PATTERN); } catch {}
}
const DEFAULT_TOKEN_RE = /(?:[?&,]|^)token[=:]\s*["']?([A-Za-z0-9._~-]{16,})/i;

let state = { token: '', source: null, scanning: false, attempts: 0, done: false };
const SCAN_INTERVAL = 2000;
const MAX_SCAN_ATTEMPTS = 30;

function readTail(p, maxBytes) {
  try {
    const st = fs.statSync(p);
    if (!st.size) return '';
    const start = Math.max(0, st.size - maxBytes);
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(st.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch {
    return '';
  }
}

function lastMatch(text, regex) {
  let re;
  try {
    re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
  } catch {
    return null;
  }
  let last = null;
  let m;
  while ((m = re.exec(text)) !== null) {
    last = m;
    if (m[0] === '') re.lastIndex += 1;
  }
  return last;
}

function maskToken(t) {
  const s = String(t || '');
  if (s.length <= 8) return s ? s.slice(0, 1) + '****' : '(empty)';
  return s.slice(0, 4) + '****' + s.slice(-4);
}

function extractFromText(text) {
  if (PATTERN) {
    const m = lastMatch(text, PATTERN);
    if (m) return (m[1] !== undefined ? m[1] : m[0]).trim();
  }
  const m = lastMatch(text, DEFAULT_TOKEN_RE);
  return m ? m[1] : null;
}

function scanOnce() {
  const token = extractFromText(readTail(LOG_FILE, 512 * 1024));
  if (token) {
    const t = token.trim();
    try { fs.writeFileSync(TOKEN_FILE_AUTO, t); } catch {}
    state.token = t;
    state.source = 'auto';
    state.done = true;
    console.log(`[upstream-token] 已自动捕获 DSH launch token（长度 ${t.length}），仅用于根目录 401 时换取会话 cookie`);
    return t;
  }
  return null;
}

function readHardToken() {
  if (HARD_TOKEN) return HARD_TOKEN;
  if (HARD_TOKEN_FILE) {
    try { return fs.readFileSync(HARD_TOKEN_FILE, 'utf8').trim(); } catch {}
  }
  return '';
}

function ensureToken() {
  if (state.done && state.token) return state.token;
  const hard = readHardToken();
  if (hard) {
    state.token = hard;
    state.source = 'manual';
    state.done = true;
    return hard;
  }
  const fromLog = scanOnce();
  if (fromLog) return fromLog;
  if (state.scanning) return state.token;
  if (state.attempts >= MAX_SCAN_ATTEMPTS) {
    state.done = true;
    return '';
  }
  state.scanning = true;
  const timer = setInterval(() => {
    const t = scanOnce();
    state.attempts += 1;
    if (t || state.attempts >= MAX_SCAN_ATTEMPTS) {
      clearInterval(timer);
      state.scanning = false;
      state.done = true;
    }
  }, SCAN_INTERVAL);
  timer.unref();
  return state.token;
}

const VERSION_PATHS = [
  process.env.DSH_VERSION,
  '/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json',
  '/opt/dsh/lib/node_modules/@deepseek-ai/dsh/package.json',
];
function detectDshVersion() {
  for (const p of VERSION_PATHS) {
    if (!p) continue;
    if (String(p).includes('package.json')) {
      try { return JSON.parse(fs.readFileSync(p, 'utf8')).version || null; } catch {}
    } else {
      return p;
    }
  }
  return null;
}

const FORWARD_HEADERS = [
  'accept', 'accept-language', 'user-agent', 'cookie', 'referer',
  'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site',
  'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform',
  ];
function pickIndexHeaders(req, dropCookie) {
  const src = req.headers || {};
  const out = { accept: '*/*', 'accept-encoding': 'identity' };
  for (let i = 0; i < FORWARD_HEADERS.length; i++) {
    const n = FORWARD_HEADERS[i];
    if (dropCookie && n === 'cookie') continue;
    if (src[n]) out[n] = src[n];
  }
  return out;
}

async function fetchRaw(origin, headers, path) {
  const url = path && path !== '/' ? origin + path : origin + '/';
  const res = await fetch(url, { method: 'GET', headers, redirect: 'manual' });
  const getSetCache = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return {
    status: res.status,
    headers: res.headers,
    setCookies: Array.isArray(getSetCache) ? getSetCache : [],
    body: await res.text(),
  };
}

function injectIntoHead(content, snippet) {
  const i = content.toLowerCase().indexOf('<head');
  if (i !== -1) {
    const e = content.indexOf('>', i);
    return e !== -1 ? content.slice(0, e + 1) + snippet + content.slice(e + 1) : snippet + content;
  }
  return snippet + content;
}

function sendRaw(r, res, transformHtml) {
  const hs = {};
  for (const [k, v] of r.headers) {
    const lk = k.toLowerCase();
    if (['content-length', 'content-encoding', 'connection', 'transfer-encoding', 'keep-alive', 'upgrade', 'set-cookie'].includes(lk)) continue;
    hs[k] = v;
  }
  hs['Cache-Control'] = hs['Cache-Control'] || 'no-store';
  if (r.setCookies.length) hs['Set-Cookie'] = r.setCookies;
  
  let body = r.body;
  const ct = String(r.headers.get ? r.headers.get('content-type') : '').toLowerCase();
  if (ct.includes('text/html') && transformHtml) body = transformHtml(body);
  if (body && body.length) {
    hs['Content-Type'] = ct || 'text/html; charset=utf-8';
  }
  
  res.writeHead(r.status, hs);
  res.end(body);
  return true;
}

async function serveIndex(req, res, ctx) {
  const origin = ctx.origin;
  const transformHtml = ctx.transformHtml;
  const reqUrl = req.url || '/';
  let first;
  try {
    first = await fetchRaw(origin, pickIndexHeaders(req), reqUrl);
  } catch {
    return false;
  }
  if (first.status === 401) {
    const token = ensureToken();
    if (token) {
      console.log(`[upstream-token] 根目录首次请求返回 401，尝试携带 launch token（${maskToken(token)}）重发以换取会话 cookie`);
      const sep = reqUrl.includes('?') ? '&' : '?';
      const authUrl = `${reqUrl}${sep}${TOKEN_QUERY_KEY}=${encodeURIComponent(token)}`;
      let retry;
      try { retry = await fetchRaw(origin, pickIndexHeaders(req, true), authUrl); } catch { retry = null; }
      if (retry) {
        const sc = retry.setCookies.length;
        console.log(`[upstream-token] 自动登录成功：上游 ${retry.status} 重定向到「${retry.headers.get ? retry.headers.get('location') || ''}」，下发 ${sc} 个会话 cookie，透传后由浏览器自动跟随并携带 cookie`);
        if (retry.status === 401) {
          console.log(`[upstream-token] 自动登录失败：携带 launch token（${maskToken(token)}）重发仍返回 401（token 可能已过期/失效，或该上游版本不支持 query token 方式）`);
        } else if (retry.status >= 300 && retry.status < 400) {
          const loc = String(retry.headers.get ? retry.headers.get('location') || '');
          console.log(`[upstream-token] 自动登录成功：上游 ${retry.status} 重定向到「${loc}」，下发 ${sc} 个会话 cookie，透传后由浏览器自动跟随并携带 cookie`);
        }
        return sendRaw(retry, res, transformHtml);
      }
      console.log('[upstream-token] 携带 token 重发失败（网络异常或上游无响应），回退透传首次 401');
    } else {
      console.log('[upstream-token] 未获取到 launch token，跳过重发，透传首次 401');
    }
  } else if (first.status !== 200) {
    console.log(`[upstream-token] 根目录首次请求返回 ${first.status}（非 401），直接透传`);
  }
  return sendRaw(first, res, transformHtml);
}

module.exports = { serveIndex, ensureToken, injectIntoHead, detectDshVersion };
