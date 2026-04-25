// Integrated test origin for E2E.
// Serves the configurator, dist, demo, and e2e fixtures as static files
// and proxies /api/* to the local Bun API server.
//
// Same-origin is required so SameSite=Strict session cookies work across
// configurator pages and API requests.
//
// Env:
//   PORT          default 3456
//   API_TARGET    default http://localhost:3100

import { serve, file } from "bun";
import { resolve, join, normalize } from "path";

const PORT = Number(process.env.PORT) || 3456;
const API_TARGET = (process.env.API_TARGET || "http://localhost:3100").replace(/\/$/, "");
const ROOT = resolve(import.meta.dir, "..");

// Path -> on-disk file. Order matters: more-specific first.
const ROUTES = [
  { match: "/test-page.html", path: "e2e/fixtures/test-page.html" },
  { match: "/cookieproof.umd.js", path: "dist/cookieproof.umd.js" },
  { match: "/cookieproof.esm.js", path: "dist/cookieproof.esm.js" },
  { match: "/loader.js", path: "configurator/loader.js" },
  { match: "/loader.min.js", path: "configurator/loader.min.js" },
  { match: "/", path: "configurator/index.html" },
];

const PREFIXES = [
  { prefix: "/configurator/", root: "configurator" },
  { prefix: "/dist/", root: "dist" },
  { prefix: "/demo/", root: "demo" },
  { prefix: "/e2e/fixtures/", root: "e2e/fixtures" },
];

function safeJoin(rootDir, rel) {
  const full = normalize(join(ROOT, rootDir, rel));
  const expected = normalize(join(ROOT, rootDir));
  if (!full.startsWith(expected)) return null;
  return full;
}

async function tryFile(diskPath) {
  if (!diskPath) return null;
  const f = file(diskPath);
  if (await f.exists()) return f;
  return null;
}

async function staticHandler(pathname) {
  for (const r of ROUTES) {
    if (r.match === pathname) {
      const f = await tryFile(join(ROOT, r.path));
      if (f) return f;
    }
  }
  for (const p of PREFIXES) {
    if (pathname.startsWith(p.prefix)) {
      const rel = pathname.slice(p.prefix.length) || "index.html";
      const f = await tryFile(safeJoin(p.root, rel));
      if (f) return f;
    }
  }
  return null;
}

// Per-request unique IPs sidestep per-IP rate limits (5 auth attempts/15min,
// 100 general/hour, etc.) that would otherwise serialize the test suite to a
// crawl. The API trusts X-Forwarded-For when TRUST_PROXY is on.
let ipCounter = 0;
function nextFakeIp() {
  ipCounter += 1;
  const a = (ipCounter >> 16) & 0xff;
  const b = (ipCounter >> 8) & 0xff;
  const c = ipCounter & 0xff;
  return `127.${a}.${b}.${c}`;
}

async function proxyApi(req, url) {
  const target = API_TARGET + url.pathname + url.search;
  const headers = new Headers(req.headers);
  headers.set("host", new URL(API_TARGET).host);
  headers.set("x-forwarded-for", nextFakeIp());
  const init = {
    method: req.method,
    headers,
    redirect: "manual",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer();
  }
  let upstream;
  try {
    upstream = await fetch(target, init);
  } catch (err) {
    return new Response(JSON.stringify({ error: "API unreachable", detail: String(err) }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
  const respHeaders = new Headers(upstream.headers);
  // Bun's fetch decompresses by default; strip stale length/encoding so the
  // re-emitted response doesn't claim a compressed length it no longer has.
  respHeaders.delete("content-encoding");
  respHeaders.delete("content-length");
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}

const server = serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return proxyApi(req, url);
    }
    const f = await staticHandler(url.pathname);
    if (f) return new Response(f);
    return new Response("Not Found: " + url.pathname, { status: 404 });
  },
});

console.log(`[test-server] http://localhost:${server.port}  static=${ROOT}  api->${API_TARGET}`);
