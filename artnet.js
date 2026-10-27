/**
 * Art-Net receiver (setup/DMX.md). Listens for ArtDmx packets on UDP 6454 and
 * hands each frame to the caller.
 */
const dgram = require('dgram');

const PORT = 6454;
const ID = Buffer.from('Art-Net\0', 'ascii');
const OP_DMX = 0x5000;

// Parses an ArtDmx packet into { universe, data }, or null for anything else
function parseArtDmx(msg) {
  if (msg.length < 18 || !msg.subarray(0, 8).equals(ID)) return null;
  if (msg.readUInt16LE(8) !== OP_DMX) return null;
  const universe = msg.readUInt16LE(14) & 0x7fff; // SubUni + Net = 15-bit port address
  const length = Math.min(msg.readUInt16BE(16), msg.length - 18, 512);
  return { universe, data: msg.subarray(18, 18 + length) };
}

// Calls onFrame(universe, data) for every ArtDmx packet; data[0] is channel 1
function listenArtNet({ onFrame, onError }) {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  sock.on('message', (msg) => {
    const pkt = parseArtDmx(msg);
    if (pkt) onFrame(pkt.universe, pkt.data);
  });
  sock.on('error', (err) => onError?.(err));
  sock.bind(PORT);
  return sock;
}

module.exports = { listenArtNet, parseArtDmx };
