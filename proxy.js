'use strict';
// Lightweight TCP proxy: bridges 0.0.0.0:EXT_PORT -> 127.0.0.1:INT_PORT
// so Docker port mapping works while DSH binds only to localhost.
// Uses Node.js event loop — no fork per connection.

const net = require('net');

// External port exposed via Docker -p mapping
const EXT_PORT = parseInt(process.env.DSH_HTTP_PORT || '3000', 10);
// Internal port where DSH listens on 127.0.0.1
const INT_PORT = parseInt(process.env.DSH_INTERNAL_PORT || '3001', 10);

const server = new net.Server((socket) => {
  const dest = new net.Socket();

  socket.pipe(dest);
  dest.pipe(socket);

  dest.connect(INT_PORT, '127.0.0.1');

  socket.on('error', () => dest.destroy());
  dest.on('error', () => socket.destroy());
});

server.listen(EXT_PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`Proxy listening on 0.0.0.0:${EXT_PORT} -> 127.0.0.1:${INT_PORT}`);
});
