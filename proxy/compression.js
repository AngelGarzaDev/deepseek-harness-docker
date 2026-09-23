// Response body compression compatibility pipeline: Decompress -> Transform -> Recompress.
//
// Background: DSH 0.1.2+ web servers enable gzip by default (compression: gzip). Compressed responses
// are binary byte streams, making any transformations based on plain strings (e.g., HTML polyfills,
// isLoopbackHostname replacement) impossible to match. Previous solutions involved stripping Accept-Encoding
// during forwarding and forcing upstream to return plaintext, relying on "upstream following HTTP negotiation".
//
// This module provides full compatibility with all browser/upstream compression types (gzip / deflate / br,
// as well as uncompressed identity): Forwarding retains the upstream's original compression format,
// buffers the complete body -> decompresses into plaintext via Content-Encoding -> executes transformation ->
// re-compresses back using the original encoding. This ensures transformation logic works regardless of whether
// the upstream used compression or what type it was; if an unsupported codec (like zstd) is met or decompression
// fails, the response is forwarded as-is without being corrupted.
const zlib = require('zlib');

// Parse encoding from Content-Encoding header. May be "gzip", "br", "gzip, br"; takes first valid value.
// Empty/identity means uncompressed. If unrecognizable, returns the original string (treated as unsupported by caller).
function parseEncoding(ce) {
  if (!ce) return 'identity';
  const first = String(ce).split(',')[0].trim().toLowerCase();
  return first || 'identity';
}

// Decompress into plaintext. Identity returns original buffer; supports gzip/deflate/br; others or failures return null.
function decompress(buf, encoding) {
  if (!encoding || encoding === 'identity') return buf;
  try {
    switch (encoding) {
      case 'gzip':
        return zlib.gunzipSync(buf);
      case 'deflate':
        // Prefer standard zlib wrapper; some servers send raw deflate (RFC 1951), fall back after failure
        try {
          return zlib.inflateSync(buf);
        } catch {
          return zlib.inflateRawSync(buf);
        }
      case 'br':
        return zlib.brotliDecompressSync(buf);
      default:
        return null; // Unsupported codecs (e.g. zstd) -> Cannot transform
    }
  } catch {
    return null;
  }
}

// Recompress using original encoding. Identity returns original buffer; supports gzip/deflate/br; others or failures return null.
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

// Attach the [buffer -> decompress -> transform(plaintext) -> recompress -> output] pipeline to res,
// used by http-proxy's proxyRes event. Since length changes after transformation, we delete content-length and send as chunked.
//   transform(plainBuffer) -> returns transformed Buffer; returns null if no transformation needed (forward as-is).
// Fallback strategy (ensures response integrity in all cases):
//   - Upstream compressed but decompression fails / unsupported codec -> forward compressed bytes as-is, keeping upstream's Content-Encoding;
//   - Transformation succeeded but recompression failed -> fallback to plaintext sending and remove Content-Encoding, letting browser read as plaintext;
//   - Uncompressed (identity) -> direct transformation, no compression overhead.
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
          out = compressed; // Decompress -> Transform -> Recompress success, Content-Encoding remains original
        } else {
          out = rewritten; // Recompression failed: fallback to plaintext, must remove Content-Encoding otherwise browser decodes garbage
          delete proxyRes.headers['content-encoding'];
        }
      }
    }
    origEnd(out, ...rest);
  };
}

module.exports = { parseEncoding, decompress, recompress, attachBodyTransform };
