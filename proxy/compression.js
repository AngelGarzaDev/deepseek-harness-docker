#!/bin/sh
# 応答体圧縮兼容管线：解压 → 改写 → 重压。
#
# 背景：DSH 0.1.2+ 的 web server 默认开启 gzip（compression: gzip），压缩后的响应
# 是二进制字节流，任何基于明文字符串的改写（HTML polyfill 注入、isLoopbackHostname
# 替换）都无法匹配。上一版方案是转发时剥离 Accept-Encoding、强制上游返回明文，
# 依赖「上游遵循 HTTP 协商」这一前提。
#
# 本模块改为完整兼容浏览器/上游的所有压缩形态（gzip / deflate / br，以及不压缩的
# identity）：转发时保留上游的压缩响应，缓冲完整 body → 按 Content-Encoding 解压成
# 明文 → 执行改写 → 再按原编码重压回传。这样无论上游是否压缩、压缩成哪种格式，
# 改写逻辑都能生效；遇到不支持的编码（如 zstd）或解压失败时，原样透传、绝不破坏响应。
const zlib = require('zlib');

function parseEncoding(ce) {
  if (!ce) return 'identity';
  const first = String(ce).split(',')[0].trim().toLowerCase();
  return first || 'identity';
}

function decompress(buf, encoding) {
  if (!encoding || encoding === 'identity') return buf;
  try {
    switch (encoding) {
      case 'gzip':
        return zlib.gunzipSync(buf);
      case 'deflate':
        try {
          return zlib.inflateSync(buf);
        } catch {
          return zlib.inflateRawSync(buf);
        }
      case 'br':
        return zlib.brotliDecompressSync(buf);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function recompress(buf, encoding) {
  if (!encoding || encoding === 'identity') return buf;
  try {
    switch (encoding) {
      case 'gzip':
        return zlib.gzipSync(buf);
      case 'deflate':
        return zlib.deflateSync(buf);
      case 'br':
        return zlib.brotliCompressSync(buf);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function attachBodyTransform(res, proxyRes, transform) {
  const encoding = parseEncoding(proxyRes.headers['content-encoding']);
  delete proxyRes.headers['content-length'];
  res.removeHeader('content-length');

  const chunks = [];
  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);
  res.write = function (chunk, ...rest) {
    if (chunk !== undefined && chunk !== null) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return true;
  };
  res.end = function (chunk, ...rest) {
    if (chunk !== undefined && chunk !== null) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    res.write = origWrite;
    res.end = origEnd;

    const raw = Buffer.concat(chunks);
    let out = raw;
    const plain = decompress(raw, encoding);
    if (plain !== null) {
      const rewritten = transform(plain);
      if (rewritten !== null) {
        const compressed = recompress(rewritten, encoding);
        if (compressed !== null) {
          out = compressed;
        } else {
          out = rewritten;
          delete proxyRes.headers['content-encoding'];
        }
      }
    }
    origEnd(out, ...rest);
  };
}

module.exports = { parseEncoding, decompress, recompress, attachBodyTransform };
