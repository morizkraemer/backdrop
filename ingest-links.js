/**
 * Share links from mails (setup/INGEST.md): one small resolver per provider
 * that turns a share link into the request that downloads the file.
 *
 * `match(url)` only parses the URL (no network) and returns what the provider
 * needs, or null. `request(parsed, fetchFn)` returns { url, init } for the
 * download; only WeTransfer needs a network call for that.
 */
const dns = require('dns').promises;
const net = require('net');
const path = require('path');

const MEDIA_MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'video/x-msvideo': 'avi',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
};

const ZIP_MIME = ['application/zip', 'application/x-zip-compressed', 'application/x-zip'];

function parseUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function hostIs(url, ...domains) {
  const host = url.hostname.toLowerCase();
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

// --- WeTransfer: we.tl/<code> (a redirect to the downloads page) or
// wetransfer.com/downloads/<transferId>[/<recipientId>]/<securityHash> ---

const wetransfer = {
  name: 'wetransfer',
  match(url) {
    if (hostIs(url, 'we.tl')) {
      return url.pathname.length > 1 ? { shortUrl: url.href } : null;
    }
    if (!hostIs(url, 'wetransfer.com')) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'downloads') return null;
    const ok = (s) => /^[a-zA-Z0-9]{4,128}$/.test(s || '');
    if (parts.length === 3 && ok(parts[1]) && ok(parts[2])) {
      return { transferId: parts[1], securityHash: parts[2] };
    }
    if (parts.length === 4 && ok(parts[1]) && ok(parts[2]) && ok(parts[3])) {
      return { transferId: parts[1], recipientId: parts[2], securityHash: parts[3] };
    }
    return null;
  },
  // What their web page sends; unofficial, so errors are spelled out
  apiRequest({ transferId, securityHash, recipientId }) {
    const body = { security_hash: securityHash, intent: 'entire_transfer' };
    if (recipientId) body.recipient_id = recipientId;
    return {
      url: `https://wetransfer.com/api/v4/transfers/${transferId}/download`,
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-requested-with': 'XMLHttpRequest',
        },
        body: JSON.stringify(body),
      },
    };
  },
  async request(parsed, fetchFn) {
    let p = parsed;
    if (p.shortUrl) {
      // we.tl only redirects to the downloads page
      const res = await fetchFn(p.shortUrl, { method: 'GET' });
      res.body?.cancel?.().catch(() => {});
      const target = parseUrl(res.url);
      p = target && wetransfer.match(target);
      if (!p || p.shortUrl) throw new IngestError('Link abgelaufen');
    }
    const { url, init } = wetransfer.apiRequest(p);
    const res = await fetchFn(url, init);
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (res.status === 404 || res.status === 410 || /expired|not.?found|deleted/i.test(JSON.stringify(data?.error ?? data?.message ?? ''))) {
      throw new IngestError('Link abgelaufen');
    }
    if (!res.ok) throw new IngestError(`WeTransfer lehnt den Download ab (HTTP ${res.status})`);
    if (!data?.direct_link || !parseUrl(data.direct_link)) throw new IngestError('Link abgelaufen');
    return { url: data.direct_link, init: { method: 'GET' } };
  },
};

// --- Dropbox: /s/..., /scl/fi/... (a file) and /scl/fo/... (a folder, as a zip):
// the same link with dl=1 ---

const dropbox = {
  name: 'dropbox',
  match(url) {
    if (!hostIs(url, 'dropbox.com')) return null;
    if (!/^\/(s|sh|scl\/fi|scl\/fo)\/./.test(url.pathname)) return null;
    const direct = new URL(url.href);
    direct.searchParams.set('dl', '1');
    return { url: direct.href };
  },
  async request(parsed) {
    return { url: parsed.url, init: { method: 'GET' } };
  },
  htmlError: 'Dropbox-Link ist nicht öffentlich oder abgelaufen',
};

// --- Google Drive: /file/d/<id>/... and open?id=<id> (also uc?id=<id>);
// only works when shared with "anyone with the link" ---

const gdrive = {
  name: 'gdrive',
  match(url) {
    if (!hostIs(url, 'drive.google.com', 'docs.google.com')) return null;
    const m = url.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/);
    let id = m ? m[1] : null;
    if (!id && /^\/(open|uc)\/?$/.test(url.pathname)) id = url.searchParams.get('id');
    if (!id || !/^[a-zA-Z0-9_-]{10,}$/.test(id)) return null;
    return { id };
  },
  downloadUrl(id) {
    return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
  },
  async request(parsed) {
    return { url: gdrive.downloadUrl(parsed.id), init: { method: 'GET' } };
  },
  htmlError: 'Datei ist nicht öffentlich freigegeben',
};

// --- Direct: any other http(s) link whose path ends in an allowed extension
// (or .zip); otherwise the response's Content-Type decides (probeDirect) ---

function createDirect(allowedExt) {
  return {
    name: 'direct',
    match(url) {
      const ext = path.extname(decodeURIComponentSafe(url.pathname)).slice(1).toLowerCase();
      return allowedExt.includes(ext) || ext === 'zip' ? { url: url.href } : null;
    },
    async request(parsed) {
      return { url: parsed.url, init: { method: 'GET' } };
    },
    htmlError: 'Link zeigt auf keine Bild- oder Videodatei',
  };
}

function decodeURIComponentSafe(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

/**
 * The provider for a link, without touching the network, or null.
 * Direct links without a media extension aren't matched here; see isMediaType.
 */
function createResolvers(allowedExt) {
  const direct = createDirect(allowedExt);
  const providers = [wetransfer, dropbox, gdrive, direct];
  return {
    providers,
    direct,
    match(raw) {
      const url = parseUrl(raw);
      if (!url) return null;
      for (const p of providers) {
        const parsed = p.match(url);
        if (parsed) return { provider: p, parsed };
      }
      return null;
    },
  };
}

function mimeOf(contentType) {
  return String(contentType || '').split(';')[0].trim().toLowerCase();
}

function isMediaType(contentType) {
  return /^(image|video)\//.test(mimeOf(contentType));
}

function isZipType(contentType) {
  return ZIP_MIME.includes(mimeOf(contentType));
}

// The file name a server suggests: filename*=UTF-8''... wins over filename="..."
function filenameFromDisposition(header) {
  if (!header) return null;
  const star = header.match(/filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i);
  if (star) {
    try { return decodeURIComponent(star[2].trim().replace(/^"|"$/g, '')); } catch (_) {}
  }
  const plain = header.match(/filename\s*=\s*("((?:[^"\\]|\\.)*)"|[^;]+)/i);
  if (plain) {
    const name = plain[2] !== undefined ? plain[2].replace(/\\(.)/g, '$1') : plain[1].trim();
    // Some servers send UTF-8 bytes in a plain header; undici hands them over as latin1
    try {
      const utf8 = Buffer.from(name, 'latin1').toString('utf8');
      if (!utf8.includes('�')) return utf8;
    } catch (_) {}
    return name;
  }
  return null;
}

function filenameFromUrl(raw) {
  const url = parseUrl(raw);
  if (!url) return null;
  const last = url.pathname.split('/').filter(Boolean).pop();
  return last ? decodeURIComponentSafe(last) : null;
}

// --- Private address check (the server sits on the venue LAN) ---

function isPrivateAddress(ip) {
  let addr = ip;
  if (net.isIPv6(addr)) {
    const lower = addr.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    // The URL parser writes [::ffff:127.0.0.1] as [::ffff:7f00:1]
    const hex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mapped) addr = mapped[1];
    else if (hex) {
      const n = (parseInt(hex[1], 16) << 16) + parseInt(hex[2], 16); // eslint-disable-line no-bitwise
      addr = [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join('.'); // eslint-disable-line no-bitwise
    } else {
      if (lower === '::' || lower === '::1') return true;
      if (/^f[cd]/.test(lower)) return true; // fc00::/7 unique local
      if (/^fe[89ab]/.test(lower)) return true; // fe80::/10 link local
      if (lower.startsWith('64:ff9b:')) return true; // NAT64 can reach IPv4 private
      return false;
    }
  }
  if (!net.isIPv4(addr)) return true;
  const [a, b] = addr.split('.').map(Number);
  return a === 0 || a === 10 || a === 127
    || (a === 100 && b >= 64 && b <= 127) // CGNAT, Tailscale
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

async function assertPublicHost(hostname, lookup = dns.lookup) {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (/^localhost$/i.test(host) || /\.(local|lan|internal|home\.arpa)$/i.test(host)) {
    throw new IngestError('Adresse im lokalen Netz ist nicht erlaubt');
  }
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true })
    .catch(() => { throw new IngestError('Server nicht gefunden'); });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new IngestError('Adresse im lokalen Netz ist nicht erlaubt');
  }
}

// An error whose message is shown to Zentrale (and the control UI) as is
class IngestError extends Error {}

module.exports = {
  createResolvers,
  wetransfer,
  dropbox,
  gdrive,
  parseUrl,
  isMediaType,
  isZipType,
  mimeOf,
  MEDIA_MIME_EXT,
  filenameFromDisposition,
  filenameFromUrl,
  isPrivateAddress,
  assertPublicHost,
  IngestError,
};
