import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(fileURLToPath(new URL('.', import.meta.url)));
const distRoot = resolve(appRoot, 'dist');
const secret = cleanEnv('PSLE_ENG_TUTOR_SESSION_SECRET');
const toolId = cleanEnv('PSLE_ENG_TUTOR_TOOL_ID') ?? 'psle-eng-tutor-brain';
const cookieName = cleanEnv('PSLE_ENG_TUTOR_SESSION_COOKIE') ?? 'psle_eng_tutor_session';
const host = cleanEnv('HOST') ?? cleanEnv('HOSTNAME') ?? '0.0.0.0';
const port = Number(cleanEnv('PORT') ?? 8080);

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp'
};

if (!Number.isInteger(port) || port <= 0) {
  throw new Error('PORT must be a positive integer.');
}

if (secret && Buffer.byteLength(secret) < 32) {
  throw new Error('PSLE_ENG_TUTOR_SESSION_SECRET must be at least 32 bytes.');
}

if (!secret) {
  console.warn('[psle-eng-tutor] PSLE_ENG_TUTOR_SESSION_SECRET is not set; launch auth is disabled.');
}

function cleanEnv(name) {
  const value = process.env[name]?.trim().replace(/^['"]|['"]$/g, '');

  return value || null;
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/g, '');
}

function base64UrlJson(value) {
  return base64Url(JSON.stringify(value));
}

function decodeBase64Url(value) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);

  return Buffer.from(`${normalized}${padding}`, 'base64');
}

function hmac(input) {
  return base64Url(createHmac('sha256', secret).update(input).digest());
}

function signaturesMatch(actual, expected) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function verifyLaunchToken(token) {
  const parts = token.split('.');

  if (parts.length !== 3) {
    throw new Error('Launch token must have three JWT segments.');
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  const header = JSON.parse(decodeBase64Url(headerPart).toString('utf8'));

  if (header.alg !== 'HS256') {
    throw new Error('Launch token must use HS256.');
  }

  const expectedSignature = hmac(`${headerPart}.${payloadPart}`);

  if (!signaturesMatch(signaturePart, expectedSignature)) {
    throw new Error('Launch token signature is invalid.');
  }

  const payload = JSON.parse(decodeBase64Url(payloadPart).toString('utf8'));
  const now = Math.floor(Date.now() / 1000);

  if (!Number.isFinite(payload.exp) || payload.exp + 30 < now) {
    throw new Error('Launch token has expired.');
  }

  if (typeof payload.user_id !== 'string' || !payload.user_id.trim()) {
    throw new Error('Launch token is missing user_id.');
  }

  if (payload.tool_id !== toolId) {
    throw new Error('Launch token tool_id does not match this app.');
  }

  return {
    email: typeof payload.email === 'string' && payload.email.trim() ? payload.email.trim() : null,
    exp: Math.trunc(payload.exp),
    install_id: typeof payload.install_id === 'string' && payload.install_id.trim() ? payload.install_id.trim() : null,
    tool_id: payload.tool_id,
    user_id: payload.user_id.trim()
  };
}

function signSession(session) {
  const payloadPart = base64UrlJson(session);

  return `${payloadPart}.${hmac(payloadPart)}`;
}

function verifySession(value) {
  if (!value) {
    return null;
  }

  const [payloadPart, signaturePart, ...rest] = value.split('.');

  if (!payloadPart || !signaturePart || rest.length > 0) {
    return null;
  }

  if (!signaturesMatch(signaturePart, hmac(payloadPart))) {
    return null;
  }

  const session = JSON.parse(decodeBase64Url(payloadPart).toString('utf8'));
  const now = Math.floor(Date.now() / 1000);

  if (!Number.isFinite(session.exp) || session.exp + 30 < now) {
    return null;
  }

  if (session.tool_id !== toolId || typeof session.user_id !== 'string' || !session.user_id.trim()) {
    return null;
  }

  return session;
}

function cookies(request) {
  return Object.fromEntries(
    (request.headers.cookie ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');

        if (index === -1) {
          return [part, ''];
        }

        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function secureRequest(request) {
  return Boolean(request.socket.encrypted) || request.headers['x-forwarded-proto'] === 'https';
}

function sessionCookie(request, session) {
  const maxAge = Math.max(60, session.exp - Math.floor(Date.now() / 1000));
  const attributes = [
    `${cookieName}=${encodeURIComponent(signSession(session))}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAge}`
  ];

  if (secureRequest(request)) {
    attributes.push('Secure');
  }

  return attributes.join('; ');
}

function clearSessionCookie() {
  return `${cookieName}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

function json(response, status, payload) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(payload));
}

function html(response, status, body) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/html; charset=utf-8'
  });
  response.end(body);
}

function launchRequiredPage(message = 'Launch this tutor from 2ndBrain to continue.') {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>2ndBrain launch required</title>
    <style>
      :root { color: #17202a; background: #eef5f4; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      body { display: grid; min-height: 100vh; place-items: center; margin: 0; padding: 24px; }
      main { width: min(100%, 460px); border: 1px solid #d8e2df; border-radius: 10px; background: #fff; padding: 28px; box-shadow: 0 24px 60px rgba(15, 23, 42, 0.14); }
      p { color: #5f6c76; line-height: 1.55; }
      strong { color: #087c70; }
    </style>
  </head>
  <body>
    <main>
      <strong>2ndBrain launch auth</strong>
      <h1>Launch required</h1>
      <p>${escapeHtml(message)}</p>
    </main>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function launchTokenFromUrl(url) {
  return (
    url.searchParams.get('token')?.trim() ||
    url.searchParams.get('launch_token')?.trim() ||
    url.searchParams.get('2ndbrain_launch_token')?.trim() ||
    ''
  );
}

function stripLaunchParams(url) {
  ['token', 'launch_token', '2ndbrain_launch_token'].forEach((name) => {
    url.searchParams.delete(name);
  });

  return `${url.pathname}${url.search}`;
}

function staticPath(pathname) {
  let decodedPath;

  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const normalized = decodedPath.endsWith('/') ? `${decodedPath}index.html` : decodedPath;
  const candidate = resolve(distRoot, `.${normalized}`);

  if (candidate !== distRoot && !candidate.startsWith(`${distRoot}/`)) {
    return null;
  }

  if (existsSync(candidate) && statSync(candidate).isFile()) {
    return candidate;
  }

  return resolve(distRoot, 'index.html');
}

function serveFile(response, path) {
  const extension = extname(path).toLowerCase();
  const contentType = mimeTypes[extension] ?? 'application/octet-stream';

  response.writeHead(200, {
    'Cache-Control': extension === '.html' ? 'no-store' : 'public, max-age=31536000, immutable',
    'Content-Type': contentType
  });
  createReadStream(path).pipe(response);
}

function authenticatedSession(request) {
  if (!secret) {
    return null;
  }

  try {
    return verifySession(cookies(request)[cookieName]);
  } catch {
    return null;
  }
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (url.pathname === '/healthz') {
    json(response, 200, {
      launchAuthRequired: Boolean(secret),
      ok: true
    });
    return;
  }

  const launchToken = secret ? launchTokenFromUrl(url) : '';

  if (launchToken) {
    try {
      const session = verifyLaunchToken(launchToken);

      response.writeHead(302, {
        'Cache-Control': 'no-store',
        Location: stripLaunchParams(url),
        'Set-Cookie': sessionCookie(request, session)
      });
      response.end();
    } catch (error) {
      response.setHeader('Set-Cookie', clearSessionCookie());
      html(response, 401, launchRequiredPage(error instanceof Error ? error.message : 'Invalid launch token.'));
    }
    return;
  }

  const session = authenticatedSession(request);

  if (url.pathname === '/api/session') {
    if (!secret) {
      json(response, 200, {
        authenticated: false,
        launchAuthRequired: false
      });
      return;
    }

    if (!session) {
      json(response, 401, {
        authenticated: false,
        launchAuthRequired: true
      });
      return;
    }

    json(response, 200, {
      authenticated: true,
      email: session.email ?? null,
      exp: session.exp,
      installId: session.install_id ?? null,
      toolId: session.tool_id,
      userId: session.user_id
    });
    return;
  }

  if (secret && !session) {
    html(response, 401, launchRequiredPage());
    return;
  }

  const path = staticPath(url.pathname);

  if (!path) {
    html(response, 403, launchRequiredPage('Requested path is not allowed.'));
    return;
  }

  serveFile(response, path);
});

server.listen(port, host, () => {
  console.log(`[psle-eng-tutor] serving ${distRoot} on http://${host}:${port}`);
  console.log(`[psle-eng-tutor] launch auth ${secret ? 'enabled' : 'disabled'} for tool ${toolId}`);
});
