/**
 * Art-Net receiver (setup/DMX.md). Listens for ArtDmx packets on UDP 6454 and
 * reports the channels of one universe whenever they change.
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

/**
 * Calls onChange(values, prev) with the `count` channels starting at `address`
 * (1-based) each time one of them changes. The first packet only primes the
 * values, so a fader left up when the server starts does not fire anything.
 * onPacket(values) is called for every packet on the universe.
 */
function listenArtNet({ universe, address, count, onChange, onPacket, onError }) {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  let last = null;
  sock.on('message', (msg) => {
    const pkt = parseArtDmx(msg);
    if (!pkt || pkt.universe !== universe) return;
    const values = [];
    for (let i = 0; i < count; i++) values.push(pkt.data[address - 1 + i] ?? 0);
    const prev = last;
    last = values;
    onPacket?.(values);
    if (prev && values.some((v, i) => v !== prev[i])) onChange(values, prev);
  });
  sock.on('error', (err) => onError?.(err));
  sock.bind(PORT);
  return sock;
}

module.exports = { listenArtNet, parseArtDmx };
