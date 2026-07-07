#!/usr/bin/env node
// Stdio <-> HTTP proxy for the Confidence MCP servers with automatic auth.
//
// Usage: node confidence-mcp-proxy.mjs <flags|docs>
//
// Two auth modes, one server name:
//
// SESSION mode — the onboard-confidence skill persists the user's Confidence
// session token to $TMPDIR/confidence_token after browser login. The proxy
// reads that token on EVERY request and forwards MCP traffic to
// mcp.confidence.dev with the Authorization header set, so MCP auth always
// follows the skill's login session. No interactive flow, no reconnect.
//
// OAUTH mode — when the token file does not exist (user never ran the
// onboarding skill), the proxy delegates to `npx mcp-remote`, which performs
// the standard MCP OAuth browser flow once and silently refreshes cached
// tokens (~/.mcp-auth) on later sessions.
//
// If the skill token appears mid-session (user just logged in), the proxy
// switches from OAUTH to SESSION mode and emits
// notifications/tools/list_changed so the agent re-fetches the tool list.
// A present-but-expired token means the user has logged in before: the proxy
// stays in SESSION mode and hints to re-run the login instead of surprising
// the user with an OAuth browser popup.
//
// Requires Node 18+ (built-in fetch).

import { readFileSync, existsSync } from 'fs';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { createInterface } from 'readline';

const service = process.argv[2] || 'flags';
const url =
  process.env[`CONFIDENCE_MCP_${service.toUpperCase()}_URL`] ||
  `https://mcp.confidence.dev/mcp/${service}`;
const tokenPath = join(process.env.TMPDIR || tmpdir(), 'confidence_token');

const NOT_AUTHENTICATED_MESSAGE =
  'Confidence session expired or not established. Run the onboarding flow ' +
  '(/confidence:onboard-confidence) to log in — MCP tools become available ' +
  'automatically after login.';

const write = obj => process.stdout.write(JSON.stringify(obj) + '\n');

const LOCAL_INITIALIZE_RESULT = {
  protocolVersion: '2025-03-26',
  capabilities: { tools: { listChanged: true } },
  serverInfo: { name: `confidence-${service}-proxy`, version: '1.0.0' },
};

function currentToken() {
  try {
    const t = readFileSync(tokenPath, 'utf8').trim();
    const { exp } = JSON.parse(Buffer.from(t.split('.')[1], 'base64').toString());
    if (exp && exp * 1000 < Date.now() + 30_000) return null;
    return t;
  } catch {
    return null;
  }
}

function parseBody(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed;
  // SSE-framed response: concatenate data lines
  const data = trimmed
    .split('\n')
    .filter(l => l.startsWith('data: '))
    .map(l => l.slice(6))
    .join('');
  return data || null;
}

// ---------------------------------------------------------------------------
// OAUTH mode: delegate to mcp-remote, which handles the browser OAuth dance
// and token caching/refresh itself.
// ---------------------------------------------------------------------------

let child = null;
let childBroken = false;

function startChild() {
  if (child || childBroken) return;
  try {
    child = spawn(
      'npx',
      ['-y', 'mcp-remote@latest', url, '--header', 'x-confidence-mcp-consumer:plugin'],
      { shell: process.platform === 'win32' },
    );
  } catch {
    childBroken = true;
    return;
  }
  child.on('error', () => {
    child = null;
    childBroken = true;
  });
  child.on('exit', () => {
    child = null;
  });
  // Re-emit child output line by line so our own notifications never
  // interleave inside a partially written frame.
  createInterface({ input: child.stdout }).on('line', l => process.stdout.write(l + '\n'));
  child.stderr.pipe(process.stderr);
}

function stopChild() {
  if (child) {
    child.kill();
    child = null;
  }
}

// ---------------------------------------------------------------------------
// Mode selection and switching
// ---------------------------------------------------------------------------

// Token file present (even expired) => the user logs in via the onboarding
// skill; never pop an OAuth browser at them. Absent => classic OAuth flow.
let mode = existsSync(tokenPath) ? 'session' : 'oauth';
if (mode === 'oauth') startChild();

let lastToken = currentToken();
setInterval(() => {
  const token = currentToken();
  if (token === lastToken) return;
  lastToken = token;
  if (mode === 'oauth' && token) {
    mode = 'session';
    stopChild();
  }
  // Login state changed: have the agent re-fetch the tool list.
  write({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
}, 3000).unref?.();

// ---------------------------------------------------------------------------
// SESSION mode request handling: inject the skill token per request.
// ---------------------------------------------------------------------------

function respondLocally(msg) {
  if (msg.method === 'initialize') {
    return write({ jsonrpc: '2.0', id: msg.id, result: LOCAL_INITIALIZE_RESULT });
  }
  if (msg.method === 'tools/list') {
    return write({ jsonrpc: '2.0', id: msg.id, result: { tools: [] } });
  }
  write({
    jsonrpc: '2.0',
    id: msg.id,
    error: { code: -32000, message: NOT_AUTHENTICATED_MESSAGE },
  });
}

async function handleSessionMode(line, msg, isRequest) {
  const token = currentToken();

  // No valid login right now: answer protocol methods locally instead of
  // forwarding — upstream rejects unauthenticated requests.
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
    const res = await fetch(url, { method: 'POST', headers, body: line });

    if (res.status === 401 || res.status === 403) {
      if (isRequest) respondLocally(msg);
      return;
    }

    const body = parseBody(await res.text());
    if (!isRequest) return; // notifications expect no response
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
// Main loop
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

  if (mode === 'oauth') {
    if (!child) startChild();
    if (child) {
      child.stdin.write(line + '\n');
    } else if (isRequest) {
      // mcp-remote unavailable (no npx?): degrade like a logged-out session.
      respondLocally(msg);
    }
    return;
  }

  handleSessionMode(line, msg, isRequest);
});

rl.on('close', () => {
  stopChild();
  process.exit(0);
});
