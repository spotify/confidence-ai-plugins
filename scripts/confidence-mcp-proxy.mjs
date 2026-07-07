#!/usr/bin/env node
// Confidence MCP proxy — stdio server + HTTP reverse proxy.
//
// Usage: node confidence-mcp-proxy.mjs <flags|docs>
//
// Runs as a stdio MCP server (started by Claude Code via .mcp.json) and
// simultaneously starts a local HTTP reverse proxy on port 19741.
//
// Auth sources (checked in order):
//   1. $TMPDIR/confidence_token — written by the onboard-confidence skill
//   2. ~/.confidence/session.json — persistent session with refresh token
//
// Stdio mode (default .mcp.json config):
//   When authenticated: proxies MCP requests to mcp.confidence.dev.
//   When not authenticated: exposes authenticate/complete_authentication tools.
//   After the skill logs in, the proxy detects the new token automatically
//   and sends notifications/tools/list_changed — no reconnect needed.
//
// HTTP mode (for standard "needs authentication" UX):
//   Users can point their MCP client to http://127.0.0.1:19741/mcp/<service>
//   to get the standard MCP HTTP OAuth flow with the "needs authentication"
//   status and Authenticate button.
//   The HTTP server proxies OAuth endpoints to mcp.confidence.dev while
//   caching tokens locally, so the skill's auth and the MCP OAuth share
//   the same token storage.
//
// Requires Node 18+ (built-in fetch).

import { createServer } from 'http';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { spawn, spawnSync } from 'child_process';
import { homedir, tmpdir } from 'os';
import { dirname, join } from 'path';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';

const service = process.argv[2] || 'flags';
const REMOTE_BASE = 'https://mcp.confidence.dev';
const REMOTE_MCP_URL =
  process.env[`CONFIDENCE_MCP_${service.toUpperCase()}_URL`] ||
  `${REMOTE_BASE}/mcp/${service}`;
const MCP_PATH = `/mcp/${service}`;
const HTTP_PORT = parseInt(process.env.CONFIDENCE_MCP_PROXY_PORT || '19741', 10);

const tokenPath = join(process.env.TMPDIR || tmpdir(), 'confidence_token');
const sessionPath = join(homedir(), '.confidence', 'session.json');

const __dirname = dirname(fileURLToPath(import.meta.url));
const authScriptPath = join(__dirname, '..', 'skills', 'onboard-confidence', 'auth.py');
const SIGNUP_CLIENT_ID = '82qMvwZvqd3t3S0gRDvs8R53TehQXSJY';
const LOGIN_CLIENT_ID = '2fG3H4RhlAbIZm9Rfn32zTaILH7w1X4w';

const NOT_AUTHENTICATED_MESSAGE =
  'Not authenticated with Confidence. Run /confidence:onboard-confidence to log in. ' +
  'After logging in, the flag management tools will appear automatically.';

const write = obj => process.stdout.write(JSON.stringify(obj) + '\n');

const LOCAL_INITIALIZE_RESULT = {
  protocolVersion: '2025-03-26',
  capabilities: { tools: { listChanged: true } },
  serverInfo: { name: `confidence-${service}-proxy`, version: '1.0.0' },
};

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

function asValidJwt(t) {
  try {
    const { exp } = JSON.parse(Buffer.from(t.split('.')[1], 'base64').toString());
    if (exp && exp * 1000 < Date.now() + 30_000) return null;
    return t;
  } catch {
    return null;
  }
}

function readTmpToken() {
  try {
    return asValidJwt(readFileSync(tokenPath, 'utf8').trim());
  } catch {
    return null;
  }
}

function readSession() {
  try {
    return JSON.parse(readFileSync(sessionPath, 'utf8'));
  } catch {
    return null;
  }
}

function writeSession(session) {
  try {
    mkdirSync(dirname(sessionPath), { recursive: true });
    writeFileSync(sessionPath, JSON.stringify(session, null, 2) + '\n', { mode: 0o600 });
  } catch {
    /* best effort */
  }
}

function syncTmpToken(token) {
  try {
    writeFileSync(tokenPath, token + '\n');
  } catch {
    /* best effort */
  }
}

function currentToken() {
  const tmp = readTmpToken();
  if (tmp) return tmp;
  const session = readSession();
  return session?.access_token ? asValidJwt(session.access_token) : null;
}

function hasViableSession() {
  if (readTmpToken()) return true;
  const session = readSession();
  return !!(session?.refresh_token && session?.client_id);
}

if (!hasViableSession()) {
  process.stderr.write(
    'No Confidence session. Run /confidence:onboard-confidence to log in.\n'
  );
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

let refreshPromise = null;
let refreshFailedAt = 0;

async function refreshSession(session) {
  const tokenUrl = session.client_id === SIGNUP_CLIENT_ID || session.client_id === LOGIN_CLIENT_ID
    ? 'https://auth.confidence.dev/oauth/token'
    : `${REMOTE_BASE}/token`;
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: session.client_id,
      refresh_token: session.refresh_token,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.access_token) return null;
  writeSession({
    ...session,
    access_token: data.access_token,
    refresh_token: data.refresh_token || session.refresh_token,
  });
  syncTmpToken(data.access_token);
  return data.access_token;
}

async function resolveToken() {
  const tmp = readTmpToken();
  if (tmp) return tmp;

  const session = readSession();
  if (!session) return null;

  const persisted = session.access_token ? asValidJwt(session.access_token) : null;
  if (persisted) {
    syncTmpToken(persisted);
    return persisted;
  }

  if (!session.refresh_token || !session.client_id) return null;
  if (Date.now() - refreshFailedAt < 60_000) return null;

  refreshPromise ??= refreshSession(session)
    .catch(() => null)
    .then(token => {
      if (!token) refreshFailedAt = Date.now();
      return token;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

// ---------------------------------------------------------------------------
// Token change detection — notify Claude Code to re-fetch tools
// ---------------------------------------------------------------------------

let lastToken = currentToken();
setInterval(() => {
  const token = currentToken();
  if (token === lastToken) return;
  lastToken = token;
  write({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
}, 3000).unref?.();

// ---------------------------------------------------------------------------
// HTTP reverse proxy — standard MCP HTTP transport with OAuth
// ---------------------------------------------------------------------------

function httpReadBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function httpBase() {
  return `http://127.0.0.1:${HTTP_PORT}`;
}

function send401(res) {
  const base = httpBase();
  res.writeHead(401, {
    'WWW-Authenticate':
      `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource${MCP_PATH}", ` +
      `as_uri="${base}/.well-known/oauth-authorization-server", ` +
      `error="invalid_token", error_description="Missing or invalid access token"`,
    'Link': [
      `<${base}/.well-known/oauth-authorization-server>; rel="oauth2-authorization-server"`,
      `<${base}/.well-known/oauth-protected-resource${MCP_PATH}>; rel="oauth2-protected-resource"`,
    ].join(', '),
    'Cache-Control': 'no-store',
    'Pragma': 'no-cache',
    'Access-Control-Expose-Headers': 'WWW-Authenticate, Link',
  });
  res.end();
}

async function httpHandleOAuthMetadata(_req, res) {
  try {
    const remote = await fetch(`${REMOTE_BASE}/.well-known/oauth-authorization-server`);
    if (!remote.ok) { res.writeHead(502); res.end(); return; }
    const metadata = await remote.json();
    const base = httpBase();
    metadata.issuer = base;
    metadata.token_endpoint = `${base}/token`;
    metadata.registration_endpoint = `${base}/register`;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(metadata));
  } catch {
    res.writeHead(502); res.end();
  }
}

async function httpHandleResourceMetadata(_req, res) {
  try {
    const remote = await fetch(`${REMOTE_BASE}/.well-known/oauth-protected-resource/mcp`);
    if (!remote.ok) { res.writeHead(502); res.end(); return; }
    const metadata = await remote.json();
    const base = httpBase();
    metadata.resource = `${base}${MCP_PATH}`;
    metadata.authorization_servers = [base];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(metadata));
  } catch {
    res.writeHead(502); res.end();
  }
}

async function httpHandleToken(req, res) {
  try {
    const body = await httpReadBody(req);
    const contentType = req.headers['content-type'] || 'application/x-www-form-urlencoded';
    const remote = await fetch(`${REMOTE_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    });
    const text = await remote.text();
    try {
      const data = JSON.parse(text);
      if (data.access_token) {
        syncTmpToken(data.access_token);
        const params = contentType.includes('json')
          ? (() => { try { return JSON.parse(body.toString()); } catch { return {}; } })()
          : Object.fromEntries(new URLSearchParams(body.toString()));
        writeSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token || null,
          client_id: params.client_id || 'mcp-oauth',
        });
      }
    } catch { /* non-JSON response — forward as-is */ }
    res.writeHead(remote.status, {
      'Content-Type': remote.headers.get('content-type') || 'application/json',
    });
    res.end(text);
  } catch {
    res.writeHead(502); res.end();
  }
}

async function httpHandleRegister(req, res) {
  try {
    const body = await httpReadBody(req);
    const remote = await fetch(`${REMOTE_BASE}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const text = await remote.text();
    res.writeHead(remote.status, {
      'Content-Type': remote.headers.get('content-type') || 'application/json',
    });
    res.end(text);
  } catch {
    res.writeHead(502); res.end();
  }
}

async function httpHandleMcp(req, res) {
  const token = await resolveToken();
  if (!token) return send401(res);

  try {
    const body = await httpReadBody(req);
    const headers = {
      'Content-Type': 'application/json',
      Accept: req.headers['accept'] || 'application/json, text/event-stream',
      'x-confidence-mcp-consumer': 'plugin',
      Authorization: `Bearer ${token}`,
    };
    if (req.headers['mcp-session-id']) {
      headers['Mcp-Session-Id'] = req.headers['mcp-session-id'];
    }

    const remote = await fetch(REMOTE_MCP_URL, { method: 'POST', headers, body });

    if (remote.status === 401 || remote.status === 403) {
      return send401(res);
    }

    const responseHeaders = {
      'Content-Type': remote.headers.get('content-type') || 'application/json',
    };
    const sessionId = remote.headers.get('mcp-session-id');
    if (sessionId) responseHeaders['Mcp-Session-Id'] = sessionId;

    res.writeHead(remote.status, responseHeaders);
    res.end(await remote.text());
  } catch (e) {
    if (!res.headersSent) { res.writeHead(502); res.end(); }
  }
}

const httpServer = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Mcp-Session-Id');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

  if (req.method === 'OPTIONS') {
    res.writeHead(204); res.end(); return;
  }

  try {
    const pathname = new URL(req.url, httpBase()).pathname;

    if (pathname === '/.well-known/oauth-authorization-server' && req.method === 'GET')
      return httpHandleOAuthMetadata(req, res);
    if (pathname.startsWith('/.well-known/oauth-protected-resource') && req.method === 'GET')
      return httpHandleResourceMetadata(req, res);
    if (pathname === '/token' && req.method === 'POST')
      return httpHandleToken(req, res);
    if (pathname === '/register' && req.method === 'POST')
      return httpHandleRegister(req, res);
    if (pathname === MCP_PATH && req.method === 'POST')
      return httpHandleMcp(req, res);

    res.writeHead(404); res.end('Not Found');
  } catch (e) {
    process.stderr.write(`HTTP error: ${e.message}\n`);
    if (!res.headersSent) { res.writeHead(500); res.end(); }
  }
});

httpServer.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    process.stderr.write(`Port ${HTTP_PORT} in use — HTTP proxy skipped.\n`);
  } else {
    process.stderr.write(`HTTP server error: ${e.message}\n`);
  }
});

httpServer.listen(HTTP_PORT, '127.0.0.1', () => {
  process.stderr.write(
    `Confidence MCP HTTP proxy on http://127.0.0.1:${HTTP_PORT}${MCP_PATH}\n`
  );
});
httpServer.unref?.();

// ---------------------------------------------------------------------------
// Stdio MCP server — authenticate / complete_authentication tools
// ---------------------------------------------------------------------------

const AUTHENTICATE_TOOL = {
  name: 'authenticate',
  description:
    'Authenticate with Confidence via browser OAuth. Opens your default ' +
    'browser to complete the login flow.',
  inputSchema: {
    type: 'object',
    properties: {
      workspace: {
        type: 'string',
        description:
          'Your Confidence workspace name (the short identifier in your login URL, ' +
          'e.g. "my-company"). Omit to use the universal login/signup flow.',
      },
    },
  },
};

const COMPLETE_AUTHENTICATION_TOOL = {
  name: 'complete_authentication',
  description:
    'Complete the Confidence authentication flow. Call this after authenticating ' +
    'in your browser if tools have not appeared automatically.',
  inputSchema: { type: 'object', properties: {} },
};

function handleAuthenticate(msg, workspace) {
  const clientId = workspace ? LOGIN_CLIENT_ID : SIGNUP_CLIENT_ID;
  const args = [authScriptPath, clientId];
  if (workspace) args.push(workspace);

  try {
    spawnSync('bash', ['-c', 'lsof -ti:8084 | xargs kill -9 2>/dev/null'], {
      stdio: 'ignore',
    });
  } catch {
    /* best effort */
  }

  const child = spawn('python3', args, { stdio: ['ignore', 'pipe', 'ignore'] });
  let token = null;
  let refreshToken = null;
  let error = null;

  child.stdout.on('data', data => {
    for (const line of data.toString().split('\n')) {
      if (line.startsWith('TOKEN:')) token = line.slice(6);
      else if (line.startsWith('REFRESH_TOKEN:')) refreshToken = line.slice(14);
      else if (line.startsWith('AUTH_ERROR:')) error = line.slice(10);
      else if (line.startsWith('TOKEN_ERROR:')) error = line.slice(12);
    }
  });

  child.on('close', () => {
    if (token) {
      syncTmpToken(token);
      const session = { access_token: token, client_id: clientId };
      if (refreshToken) session.refresh_token = refreshToken;
      writeSession(session);
      write({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [
            { type: 'text', text: 'Authenticated with Confidence. Tools are now available.' },
          ],
        },
      });
      write({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
    } else {
      write({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [
            {
              type: 'text',
              text: `Authentication failed: ${error || 'unknown error'}. Try again.`,
            },
          ],
          isError: true,
        },
      });
    }
  });
}

function handleCompleteAuthentication(msg) {
  const token = currentToken();
  if (token) {
    write({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        content: [
          { type: 'text', text: 'Already authenticated. Confidence tools are available.' },
        ],
      },
    });
    write({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
  } else {
    write({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        content: [
          {
            type: 'text',
            text: 'No authentication in progress or token not yet received. Call authenticate first.',
          },
        ],
        isError: true,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Stdio request handling
// ---------------------------------------------------------------------------

function parseBody(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed;
  const data = trimmed
    .split('\n')
    .filter(l => l.startsWith('data: '))
    .map(l => l.slice(6))
    .join('');
  return data || null;
}

function respondLocally(msg) {
  if (msg.method === 'initialize') {
    return write({ jsonrpc: '2.0', id: msg.id, result: LOCAL_INITIALIZE_RESULT });
  }
  if (msg.method === 'tools/list') {
    return write({
      jsonrpc: '2.0',
      id: msg.id,
      result: { tools: [] },
    });
  }
  if (msg.method === 'tools/call' && msg.params?.name === 'authenticate') {
    return handleAuthenticate(msg, msg.params?.arguments?.workspace);
  }
  if (msg.method === 'tools/call' && msg.params?.name === 'complete_authentication') {
    return handleCompleteAuthentication(msg);
  }
  write({
    jsonrpc: '2.0',
    id: msg.id,
    error: { code: -32000, message: NOT_AUTHENTICATED_MESSAGE },
  });
}

async function handleRequest(line, msg, isRequest) {
  const token = await resolveToken();

  if (!token) {
    if (isRequest) respondLocally(msg);
    return;
  }

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'x-confidence-mcp-consumer': 'plugin',
    Authorization: `Bearer ${token}`,
  };

  try {
    const res = await fetch(REMOTE_MCP_URL, { method: 'POST', headers, body: line });

    if (res.status === 401 || res.status === 403) {
      if (isRequest) respondLocally(msg);
      return;
    }

    const body = parseBody(await res.text());
    if (!isRequest) return;
    if (body) {
      process.stdout.write(body.replace(/\r?\n/g, '') + '\n');
    } else {
      write({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32000, message: `Upstream HTTP ${res.status}` },
      });
    }
  } catch (e) {
    if (isRequest) {
      write({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32000, message: `Proxy error: ${e.message ?? e}` },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Stdio main loop
// ---------------------------------------------------------------------------

const rl = createInterface({ input: process.stdin });

rl.on('line', line => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const isRequest = msg.id !== undefined && msg.id !== null;
  handleRequest(line, msg, isRequest);
});

rl.on('close', () => process.exit(0));
