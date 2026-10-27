/**
 * ezcoo EZ-MX44HAS2 4x4 HDMI matrix over its raw TCP control port (setup/HDMI-MATRIX.md).
 *
 * The matrix allows only two TCP sockets and echoes replies to every open one, so
 * this opens a short-lived connection per job and runs one job at a time.
 */
const net = require('net');

const PORT = 23;
const CONNECT_TIMEOUT_MS = 3000;
const IDLE_MS = 400; // a reply is done once the matrix stops sending for this long
const MAX_REPLY_MS = 4000; // EZSTA takes ~1.6 s

function readReply(sock, buf) {
  return new Promise((resolve) => {
    let idleTimer = null;
    const done = () => {
      clearTimeout(idleTimer);
      clearTimeout(maxTimer);
      sock.off('data', onData);
      sock.off('close', done);
      resolve(buf.text);
      buf.text = '';
    };
    const onData = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(done, IDLE_MS);
    };
    const maxTimer = setTimeout(done, MAX_REPLY_MS);
    idleTimer = setTimeout(done, MAX_REPLY_MS / 2); // nothing at all yet
    sock.on('data', onData);
    sock.on('close', done);
  });
}

// Sends each command in turn on one connection and returns the replies
function session(host, commands) {
  return new Promise((resolve, reject) => {
    const [name, port] = host.split(':');
    const sock = net.connect({ host: name, port: Number(port) || PORT });
    const buf = { text: '' };
    sock.setEncoding('ascii');
    sock.on('data', (d) => { buf.text += d; });
    sock.setTimeout(CONNECT_TIMEOUT_MS, () => sock.destroy(new Error('HDMI matrix timed out')));
    sock.on('error', reject);
    sock.on('connect', async () => {
      sock.setTimeout(0);
      const replies = [];
      for (const cmd of commands) {
        sock.write(`${cmd}\r`);
        replies.push(await readReply(sock, buf));
      }
      sock.end();
      resolve(replies);
    });
  });
}

// Parses EZSTA (table with link state) or EZG STA (one value per line)
function parseStatus(text, size) {
  const routes = Array(size).fill(null);
  const inputLink = Array(size).fill(null);
  const outputLink = Array(size).fill(null);
  for (const m of text.matchAll(/Output\s*(\d+)\s*:\s*Input\s*=\s*(\d+)[^\n]*?Link\s*=\s*(ON|OFF)/gi)) {
    const o = Number(m[1]) - 1;
    if (o >= 0 && o < size) {
      routes[o] = Number(m[2]);
      outputLink[o] = m[3].toUpperCase() === 'ON';
    }
  }
  for (const m of text.matchAll(/Input\s*(\d+)\s*:[^\n]*?Link\s*=\s*(ON|OFF)/gi)) {
    const i = Number(m[1]) - 1;
    if (i >= 0 && i < size) inputLink[i] = m[2].toUpperCase() === 'ON';
  }
  for (const m of text.matchAll(/OUT(\d+)\s+VS\s+IN(\d+)/gi)) {
    const o = Number(m[1]) - 1;
    if (o >= 0 && o < size) routes[o] = Number(m[2]);
  }
  return { routes, inputLink, outputLink };
}

function createMatrix(hosts, size = 4) {
  let current = hosts[0];
  let queue = Promise.resolve();

  // Tries the last host that answered first, then the others (the matrix may move on DHCP)
  async function run(commands) {
    const order = [current, ...hosts.filter((h) => h !== current)];
    for (const host of order) {
      try {
        const replies = await session(host, commands);
        current = host;
        return replies;
      } catch {
        // try the next host
      }
    }
    throw new Error(`HDMI matrix unreachable at ${hosts.join(', ')}`);
  }

  function enqueue(fn) {
    const job = queue.then(fn, fn);
    queue = job.catch(() => {});
    return job;
  }

  return {
    size,
    get host() { return current; },

    status() {
      return enqueue(async () => {
        const [reply] = await run(['EZSTA']);
        const st = parseStatus(reply, size);
        if (st.routes.some((r) => r === null)) {
          const [compact] = await run(['EZG STA']);
          const fallback = parseStatus(compact, size);
          st.routes = st.routes.map((r, i) => r ?? fallback.routes[i]);
        }
        if (st.routes.every((r) => r === null)) throw new Error('No status from HDMI matrix');
        return st;
      });
    },

    // output 0 routes every output. Reads the routes back afterwards.
    route(output, input) {
      return enqueue(async () => {
        const [, reply] = await run([`EZS OUT${output} VS IN${input}`, 'EZG STA']);
        return parseStatus(reply, size).routes;
      });
    },
  };
}

module.exports = { createMatrix, parseStatus };
