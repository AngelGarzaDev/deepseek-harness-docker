'use strict';
// Lightweight TCP proxy: bridges 0.0.0.0 -> 127.0.0.1 so Docker port
// mapping works while DSH binds only to localhost.
// Uses Node.js event loop — no fork per connection.

const net = require('net');

const PORT = parseInt(process.env.DSH_HTTP_PORT || '3000', 10);

const server = new net.Server((socket) => {
  const dest = new net.Socket();

  socket.pipe(dest);
  dest.pipe(socket);

  dest.connect(PORT, '127.0.0.1');

  socket.on('error', () => dest.destroy());
  dest.on('error', () => socket.destroy());
});

server.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(
    `Proxy listening on 0.0.0.0:${PORT} -> 127.0.0.1:${PORT}`
  );
});
