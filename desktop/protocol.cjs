const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { isAppUrl, decodedPath, contained, contentSecurityPolicy, FILE_LIMIT } = require('./policy.cjs');
const { readBounded } = require('./storage.cjs');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.webp': 'image/webp', '.avif': 'image/avif', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.txt': 'text/plain; charset=utf-8',
};

async function installProtocol(session, directory) {
  const root = await fs.realpath(directory);
  await readBounded(path.join(root, 'index.html'), FILE_LIMIT);

  async function asset(parts) {
    let target = root;
    for (const part of parts) {
      target = path.join(target, part);
      if (!contained(root, target)) return undefined;
      let stat;
      try { stat = await fs.lstat(target); } catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return undefined; throw error; }
      if (stat.isSymbolicLink() || !contained(root, await fs.realpath(target))) return undefined;
    }
    const stat = await fs.lstat(target);
    return stat.isFile() ? target : undefined;
  }

  session.protocol.handle('sakai-app', async (request) => {
    const headers = {
      'Content-Security-Policy': contentSecurityPolicy(),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), display-capture=(), usb=(), serial=()',
      'Cache-Control': 'no-store',
    };
    try {
      if (!isAppUrl(request.url) || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 403, headers });
      const parts = decodedPath(request.url).split('/').filter(Boolean);
      if (parts.some((part) => part.startsWith('.') || /[\\:\u0000-\u001f]/u.test(part))) {
        return new Response(null, { status: 403, headers });
      }
      let file = await asset(parts.length ? parts : ['index.html']);
      if (!file) file = await asset([...parts, 'index.html']);
      if (!file && parts.length && !path.extname(parts.at(-1))) file = await asset([...parts.slice(0, -1), `${parts.at(-1)}.html`]);
      if (!file && (!parts.length || !path.extname(parts.at(-1)) || request.headers.get('accept')?.includes('text/html'))) {
        // Route fallback is only for documents, never for missing scripts, styles or other known assets.
        if (!Object.hasOwn(MIME, path.extname(parts.at(-1) || '').toLowerCase())) file = await asset(['index.html']);
      }
      if (!file) return new Response(null, { status: 404, headers });
      const extension = path.extname(file).toLowerCase();
      headers['Content-Type'] = MIME[extension] || 'application/octet-stream';
      if (extension === '.html') {
        const html = (await readBounded(file, FILE_LIMIT)).toString('utf8').replace(/\r\n?/g, '\n');
        headers['Content-Security-Policy'] = contentSecurityPolicy(html);
        return new Response(request.method === 'HEAD' ? null : html, { headers });
      }
      if (request.method === 'HEAD') return new Response(null, { headers });
      const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      return new Response(Readable.toWeb(handle.createReadStream({ autoClose: true })), { headers });
    } catch {
      return new Response(null, { status: 404, headers });
    }
  });
}

module.exports = { installProtocol };
