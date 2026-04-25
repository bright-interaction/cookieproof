import { Database } from "bun:sqlite";
import { randomUUID, createHash, createHmac, randomBytes, timingSafeEqual, createCipheriv, createDecipheriv } from "crypto";
import { scanHtml } from "./scanner/scanner.js";

const PORT = Number(process.env.PORT) || 3100;
const DB_PATH = process.env.DB_PATH || "/data/consent-proofs.db";
const ENV_API_KEY = process.env.API_KEY || "";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";

// Enterprise Edition license key — gates agency, billing, admin, and team features.
// See ee/LICENSE for terms. Obtain a key at https://brightinteraction.com
const EE_LICENSE_KEY = process.env.COOKIEPROOF_LICENSE_KEY || "";
const EE_PUBLIC_KEY = "O/isFGNuoIiV5VVd1/0OfvjPf6F2Ld4DxwZ5J+qsQFc=";

interface EELicensePayload {
  org: string;
  features: string[];
  expires: string;
  issued_at: string;
}

let EE_ENABLED = false;
let EE_LICENSE: EELicensePayload | null = null;

if (EE_LICENSE_KEY) {
  try {
    const signedJSON = Buffer.from(EE_LICENSE_KEY, "base64");
    const signed = JSON.parse(signedJSON.toString());
    const licJSON = Buffer.from(signed.license, "base64");
    const sigBytes = Buffer.from(signed.signature, "base64");
    const pubKey = Buffer.from(EE_PUBLIC_KEY, "base64");

    // Ed25519 verification using Node crypto
    const { verify } = await import("crypto");
    const isValid = verify(
      null,
      licJSON,
      { key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), pubKey]), format: "der", type: "spki" },
      sigBytes
    );

    if (isValid) {
      const lic: EELicensePayload = JSON.parse(licJSON.toString());
      const expiry = new Date(lic.expires + "T23:59:59Z");
      if (expiry > new Date()) {
        EE_ENABLED = true;
        EE_LICENSE = lic;
        console.log(`[cookieproof-api] Enterprise license active: org=${lic.org}, expires=${lic.expires}`);
      } else {
        console.error(`[cookieproof-api] Enterprise license EXPIRED: ${lic.expires}`);
      }
    } else {
      console.error("[cookieproof-api] Enterprise license INVALID: signature verification failed");
    }
  } catch (e) {
    console.error("[cookieproof-api] Enterprise license INVALID: could not parse key");
  }
} else {
  console.log("[cookieproof-api] Running in open-source mode (agency/billing/admin/team disabled)");
}

// SECURITY: Dynamic dummy hash for timing attack prevention
// Generated at startup with same Argon2id parameters as real passwords
let DUMMY_PASSWORD_HASH: string = "";
(async () => {
  DUMMY_PASSWORD_HASH = await Bun.password.hash("dummy_timing_attack_prevention_password", { algorithm: "argon2id" });
  console.log("[cookieproof-api] Timing attack prevention initialized");
})();

// SMTP config for sending email reports (Phase B)
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || "";

// AES-256-GCM encryption for agency SMTP passwords at rest
const SMTP_ENCRYPTION_KEY = process.env.SMTP_ENCRYPTION_KEY || "";
let smtpEncryptionKeyBuf: Buffer | null = null;
if (SMTP_ENCRYPTION_KEY) {
  const keyBuf = Buffer.from(SMTP_ENCRYPTION_KEY, "hex");
  if (keyBuf.length === 32) {
    smtpEncryptionKeyBuf = keyBuf;
    console.log("[cookieproof-api] SMTP password encryption enabled (AES-256-GCM)");
  } else {
    console.error("[cookieproof-api] WARNING: SMTP_ENCRYPTION_KEY must be 64 hex chars (32 bytes). SMTP passwords will be stored in plaintext.");
  }
} else {
  console.warn("[cookieproof-api] WARNING: SMTP_ENCRYPTION_KEY not set. Agency SMTP passwords stored in plaintext.");
}

/** Encrypt a plaintext string with AES-256-GCM. Returns "enc:iv:ciphertext:tag" */
function encryptSmtpPass(plaintext: string): string {
  if (!smtpEncryptionKeyBuf || !plaintext) return plaintext;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", smtpEncryptionKeyBuf, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString("hex")}:${encrypted.toString("hex")}:${tag.toString("hex")}`;
}

/** Decrypt an AES-256-GCM encrypted string. Returns plaintext or original string if not encrypted. */
function decryptSmtpPass(stored: string): string {
  if (!stored || !stored.startsWith("enc:")) return stored;
  if (!smtpEncryptionKeyBuf) {
    console.error("[cookieproof-api] Cannot decrypt SMTP password: SMTP_ENCRYPTION_KEY not set");
    return "";
  }
  try {
    const parts = stored.split(":");
    if (parts.length !== 4) return stored;
    const iv = Buffer.from(parts[1], "hex");
    const encrypted = Buffer.from(parts[2], "hex");
    const tag = Buffer.from(parts[3], "hex");
    const decipher = createDecipheriv("aes-256-gcm", smtpEncryptionKeyBuf, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch (e: any) {
    console.error("[cookieproof-api] Failed to decrypt SMTP password:", e.message);
    return "";
  }
}

/** Check if a stored value looks like it's already encrypted */
function isEncryptedSmtpPass(stored: string): boolean {
  return !!stored && stored.startsWith("enc:");
}

// Resend API (preferred over SMTP when configured)
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM = process.env.RESEND_FROM || "CookieProof <noreply@send.brightinteraction.com>";

// Gotenberg PDF generation
const GOTENBERG_URL = process.env.GOTENBERG_URL || "http://gotenberg:3000";

// Mollie payment config
const MOLLIE_API_KEY = process.env.MOLLIE_API_KEY || "";
const MOLLIE_WEBHOOK_URL = process.env.MOLLIE_WEBHOOK_URL || ""; // e.g., https://api.cookieproof.io/api/billing/webhook
const MOLLIE_REDIRECT_URL = process.env.MOLLIE_REDIRECT_URL || ""; // e.g., https://app.cookieproof.io/billing

// Bright per-client costs in cents (öre) for agency profit calculations
const BRIGHT_COST_CENTS: Record<string, number> = { starter: 9900, unlimited: 29900 };

// SECURITY: Validate Mollie URLs on startup to prevent misconfiguration
if (MOLLIE_REDIRECT_URL) {
  try {
    const parsed = new URL(MOLLIE_REDIRECT_URL);
    if (parsed.protocol !== "https:") {
      console.error("[cookieproof-api] CRITICAL: MOLLIE_REDIRECT_URL must use HTTPS");
      process.exit(1);
    }
  } catch {
    console.error("[cookieproof-api] CRITICAL: MOLLIE_REDIRECT_URL is not a valid URL");
    process.exit(1);
  }
}
if (MOLLIE_WEBHOOK_URL) {
  try {
    const parsed = new URL(MOLLIE_WEBHOOK_URL);
    if (parsed.protocol !== "https:" && process.env.NODE_ENV === "production") {
      console.warn("[cookieproof-api] WARNING: MOLLIE_WEBHOOK_URL should use HTTPS in production");
    }
  } catch {
    console.error("[cookieproof-api] CRITICAL: MOLLIE_WEBHOOK_URL is not a valid URL");
    process.exit(1);
  }
}

// Alert system config
const ALERT_CHECK_INTERVAL_HOURS = Number(process.env.ALERT_CHECK_INTERVAL_HOURS) || 6;
const ALERT_EMAIL_ENABLED = process.env.ALERT_EMAIL_ENABLED !== "false";

// ---------------------------------------------------------------------------
// Graceful shutdown state
// ---------------------------------------------------------------------------
let _shuttingDown = false;
let _server: ReturnType<typeof Bun.serve> | null = null;

// ---------------------------------------------------------------------------
// Background Gotenberg health status (non-blocking for /api/health)
// ---------------------------------------------------------------------------
let _gotenbergStatus: "ok" | "error" | "unknown" = "unknown";

// ---------------------------------------------------------------------------
// Cookie Auth Configuration (httpOnly secure cookies)
// ---------------------------------------------------------------------------
const COOKIE_NAME = "ce_session";
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds
const CSRF_COOKIE_NAME = "ce_csrf";
const CSRF_HEADER_NAME = "X-CSRF-Token";
// Secure cookies in production, allow non-secure in dev
const COOKIE_SECURE = process.env.NODE_ENV === "production";
// Domain for cookies - set via env or auto-detect from ALLOWED_ORIGINS
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || "";

// Parse cookies from request
function parseCookies(req: Request): Record<string, string> {
  const cookieHeader = req.headers.get("Cookie");
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  for (const pair of cookieHeader.split(";")) {
    const [name, ...rest] = pair.trim().split("=");
    if (name) cookies[name] = decodeURIComponent(rest.join("="));
  }
  return cookies;
}

// Build Set-Cookie header for auth token
function buildAuthCookie(token: string, maxAge: number = COOKIE_MAX_AGE): string {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Strict`,
    `Max-Age=${maxAge}`,
  ];
  if (COOKIE_SECURE) parts.push("Secure");
  if (COOKIE_DOMAIN) parts.push(`Domain=${COOKIE_DOMAIN}`);
  return parts.join("; ");
}

// Build Set-Cookie header to clear auth cookie (logout)
function buildClearAuthCookie(): string {
  const parts = [
    `${COOKIE_NAME}=`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Strict`,
    `Max-Age=0`,
  ];
  if (COOKIE_SECURE) parts.push("Secure");
  if (COOKIE_DOMAIN) parts.push(`Domain=${COOKIE_DOMAIN}`);
  return parts.join("; ");
}

// Generate CSRF token (stored in non-httpOnly cookie so JS can read it)
function generateCsrfToken(): string {
  return randomBytes(32).toString("hex");
}

// Build CSRF cookie (readable by JS, used to set header)
function buildCsrfCookie(token: string): string {
  const parts = [
    `${CSRF_COOKIE_NAME}=${token}`,
    `Path=/`,
    `SameSite=Strict`,
    `Max-Age=${COOKIE_MAX_AGE}`,
  ];
  if (COOKIE_SECURE) parts.push("Secure");
  if (COOKIE_DOMAIN) parts.push(`Domain=${COOKIE_DOMAIN}`);
  return parts.join("; ");
}

// Validate CSRF token (compare cookie value with header value)
function validateCsrf(req: Request): boolean {
  // Skip CSRF check for safe methods
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;

  const cookies = parseCookies(req);
  const cookieToken = cookies[CSRF_COOKIE_NAME];
  const headerToken = req.headers.get(CSRF_HEADER_NAME);

  if (!cookieToken || !headerToken) return false;

  try {
    return timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken));
  } catch {
    return false; // Length mismatch
  }
}

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------
function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

// ---------------------------------------------------------------------------
// SRI hash (fetched from pre-computed file at startup, fallback to lazy compute)
// ---------------------------------------------------------------------------
let _sriHash: string | null = null;
let _sriLoading = false;

function loadSriHashAsync(): void {
  if (_sriHash || _sriLoading) return;
  _sriLoading = true;
  // Try pre-computed .sri file first (generated at build time in web container)
  fetch("http://web:80/dist/cookieproof.sri", { signal: AbortSignal.timeout(5000) })
    .then(res => {
      if (res.ok) return res.text().then(hash => {
        const trimmed = hash.trim();
        if (trimmed.startsWith("sha384-")) {
          _sriHash = trimmed;
          console.log(`[cookieproof-api] SRI hash (pre-computed): ${_sriHash}`);
        } else {
          throw new Error("Invalid SRI hash format");
        }
      });
      // Fallback: compute from bundle
      return fetch("http://web:80/dist/cookieproof.umd.js", { signal: AbortSignal.timeout(5000) })
        .then(r => r.ok ? r.arrayBuffer() : Promise.reject())
        .then(buf => {
          _sriHash = "sha384-" + createHash("sha384").update(Buffer.from(buf)).digest("base64");
          console.log(`[cookieproof-api] SRI hash (computed): ${_sriHash}`);
        });
    })
    .catch(() => { _sriLoading = false; }); // retry on next request
}

function generateApiKey(): string {
  return randomBytes(32).toString("hex");
}
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS) || 1095; // 3 years default
const ENV_ORIGINS: string[] = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
  : [];
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------
// JWT_SECRET is resolved lazily after DB init (see getJwtSecret() below)
let _jwtSecret: string | null = null;

function getJwtSecret(): string {
  if (_jwtSecret) return _jwtSecret;
  if (process.env.JWT_SECRET) { _jwtSecret = process.env.JWT_SECRET; return _jwtSecret; }
  const row = db.prepare("SELECT value FROM settings WHERE key = 'jwt_secret'").get() as { value: string } | null;
  if (row) { _jwtSecret = row.value; return _jwtSecret; }
  const secret = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO settings (key, value) VALUES ('jwt_secret', ?)").run(secret);
  _jwtSecret = secret;
  return secret;
}

function signJwt(payload: Record<string, unknown>, expiresInSec = 7 * 24 * 3600): string {
  const secret = getJwtSecret();
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ ...payload, iat, exp: iat + expiresInSec })).toString("base64url");
  const sig = createHmac("sha256", secret).update(header + "." + body).digest("base64url");
  return header + "." + body + "." + sig;
}

function verifyJwt(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    // SECURITY: Validate algorithm from header to prevent algorithm confusion attacks
    const headerObj = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    if (headerObj.alg !== "HS256" || headerObj.typ !== "JWT") return null;

    const secret = getJwtSecret();
    const sig = createHmac("sha256", secret).update(parts[0] + "." + parts[1]).digest("base64url");
    try { if (!timingSafeEqual(Buffer.from(sig), Buffer.from(parts[2]))) return null; } catch { return null; }
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Rate limiter – 100 requests per IP per rolling hour window (in-memory)
// ---------------------------------------------------------------------------
const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAP_MAX = 10_000; // Max distinct IPs tracked to prevent memory DoS

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now >= entry.resetAt) {
    if (rateLimitMap.size >= RATE_LIMIT_MAP_MAX) {
      for (const [key, val] of rateLimitMap) {
        if (now >= val.resetAt) rateLimitMap.delete(key);
      }
      if (rateLimitMap.size >= RATE_LIMIT_MAP_MAX) return true;
    }
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
}

// Periodically clean up expired entries (every 2 minutes for tighter memory control)
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now >= entry.resetAt) {
      rateLimitMap.delete(ip);
    }
  }
}, 2 * 60 * 1000);

// ---------------------------------------------------------------------------
// Per-domain proof rate limiter – 1000 proofs per domain per hour
// Prevents abuse even if attacker controls a configured domain
// ---------------------------------------------------------------------------
const DOMAIN_PROOF_RATE_LIMIT_MAX = 1000;
const DOMAIN_PROOF_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const domainProofRateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isDomainProofRateLimited(domain: string): boolean {
  const now = Date.now();
  const entry = domainProofRateLimitMap.get(domain);

  if (!entry || now >= entry.resetAt) {
    // Clean up if map is getting too large
    if (domainProofRateLimitMap.size >= 5000) {
      for (const [key, val] of domainProofRateLimitMap) {
        if (now >= val.resetAt) domainProofRateLimitMap.delete(key);
      }
    }
    domainProofRateLimitMap.set(domain, { count: 1, resetAt: now + DOMAIN_PROOF_RATE_LIMIT_WINDOW_MS });
    return false;
  }

  entry.count += 1;
  return entry.count > DOMAIN_PROOF_RATE_LIMIT_MAX;
}

// ---------------------------------------------------------------------------
// Scan rate limiter – 10 scans per IP per hour (separate from proof limiter)
// ---------------------------------------------------------------------------
const SCAN_RATE_LIMIT_MAX = 10;
const scanRateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isScanRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = scanRateLimitMap.get(ip);
  if (!entry || now >= entry.resetAt) {
    if (scanRateLimitMap.size >= RATE_LIMIT_MAP_MAX) {
      for (const [key, val] of scanRateLimitMap) {
        if (now >= val.resetAt) scanRateLimitMap.delete(key);
      }
      if (scanRateLimitMap.size >= RATE_LIMIT_MAP_MAX) return true;
    }
    scanRateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > SCAN_RATE_LIMIT_MAX;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of scanRateLimitMap) {
    if (now >= entry.resetAt) scanRateLimitMap.delete(ip);
  }
}, 2 * 60 * 1000);

// ---------------------------------------------------------------------------
// Telemetry rate limiter – 20 reports per IP per hour
// ---------------------------------------------------------------------------
const TELEMETRY_RATE_LIMIT_MAX = 20;
const telemetryRateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isTelemetryRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = telemetryRateLimitMap.get(ip);
  if (!entry || now >= entry.resetAt) {
    if (telemetryRateLimitMap.size >= RATE_LIMIT_MAP_MAX) {
      for (const [key, val] of telemetryRateLimitMap) {
        if (now >= val.resetAt) telemetryRateLimitMap.delete(key);
      }
      if (telemetryRateLimitMap.size >= RATE_LIMIT_MAP_MAX) return true;
    }
    telemetryRateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > TELEMETRY_RATE_LIMIT_MAX;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of telemetryRateLimitMap) {
    if (now >= entry.resetAt) telemetryRateLimitMap.delete(ip);
  }
}, 2 * 60 * 1000);

// ---------------------------------------------------------------------------
// Config fetch counter (in-memory, flushed to DB every 5 minutes)
// ---------------------------------------------------------------------------
const configFetchCounts = new Map<string, number>();

function incrementConfigFetch(domain: string): void {
  configFetchCounts.set(domain, (configFetchCounts.get(domain) || 0) + 1);
}

function flushConfigFetchCounts(): void {
  if (configFetchCounts.size === 0) return;
  try {
    const today = new Date().toISOString().slice(0, 10);
    db.transaction(() => {
      for (const [domain, count] of configFetchCounts) {
        db.prepare(`
          INSERT INTO config_fetch_daily (domain, day, fetch_count) VALUES (?, ?, ?)
          ON CONFLICT(domain, day) DO UPDATE SET fetch_count = fetch_count + ?
        `).run(domain, today, count, count);
      }
    })();
    configFetchCounts.clear();
  } catch (e: any) {
    console.error("[cookieproof-api] Config fetch flush failed:", e.message);
  }
}

setInterval(flushConfigFetchCounts, 5 * 60 * 1000);

// ---------------------------------------------------------------------------
// Auth rate limiter – 5 attempts per IP per 15 minutes (login, register, etc.)
// Reduced from 10 to 5 to better protect against brute force attacks
// ---------------------------------------------------------------------------
const AUTH_RATE_LIMIT_MAX = 5;
const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const authRateLimitMap = new Map<string, { count: number; resetAt: number }>();

// ---------------------------------------------------------------------------
// Report-email rate limiter – 10 emails per user per hour
// ---------------------------------------------------------------------------
const REPORT_EMAIL_LIMIT_MAX = 10;
const REPORT_EMAIL_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const reportEmailLimitMap = new Map<string, { count: number; resetAt: number }>();

function isReportEmailRateLimited(userId: string): boolean {
  const now = Date.now();
  const entry = reportEmailLimitMap.get(userId);
  if (!entry || now >= entry.resetAt) {
    if (reportEmailLimitMap.size >= RATE_LIMIT_MAP_MAX) {
      for (const [key, val] of reportEmailLimitMap) {
        if (now >= val.resetAt) reportEmailLimitMap.delete(key);
      }
      if (reportEmailLimitMap.size >= RATE_LIMIT_MAP_MAX) return true;
    }
    reportEmailLimitMap.set(userId, { count: 1, resetAt: now + REPORT_EMAIL_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > REPORT_EMAIL_LIMIT_MAX;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of reportEmailLimitMap) { if (now >= v.resetAt) reportEmailLimitMap.delete(k); } }, 2 * 60 * 1000);

function isAuthRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = authRateLimitMap.get(ip);
  if (!entry || now >= entry.resetAt) {
    // Evict only expired entries when map is full
    if (authRateLimitMap.size >= RATE_LIMIT_MAP_MAX) {
      for (const [key, val] of authRateLimitMap) {
        if (now >= val.resetAt) authRateLimitMap.delete(key);
      }
      // If still full after purging expired, reject to prevent memory abuse
      if (authRateLimitMap.size >= RATE_LIMIT_MAP_MAX) return true;
    }
    authRateLimitMap.set(ip, { count: 1, resetAt: now + AUTH_RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > AUTH_RATE_LIMIT_MAX;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of authRateLimitMap) {
    if (now >= entry.resetAt) authRateLimitMap.delete(ip);
  }
}, 2 * 60 * 1000);

// ---------------------------------------------------------------------------
// Config endpoint rate limiter – 100 requests per IP per hour (CDN use case)
// ---------------------------------------------------------------------------
const CONFIG_RATE_LIMIT_MAX = 100;
const CONFIG_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const configRateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isConfigRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = configRateLimitMap.get(ip);
  if (!entry || now >= entry.resetAt) {
    if (configRateLimitMap.size >= RATE_LIMIT_MAP_MAX) {
      for (const [key, val] of configRateLimitMap) {
        if (now >= val.resetAt) configRateLimitMap.delete(key);
      }
      if (configRateLimitMap.size >= RATE_LIMIT_MAP_MAX) return true;
    }
    configRateLimitMap.set(ip, { count: 1, resetAt: now + CONFIG_RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > CONFIG_RATE_LIMIT_MAX;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of configRateLimitMap) {
    if (now >= entry.resetAt) configRateLimitMap.delete(ip);
  }
}, 5 * 60 * 1000);

// ---------------------------------------------------------------------------
// Export endpoint rate limiter – 10 exports per user per hour (expensive queries)
// ---------------------------------------------------------------------------
const EXPORT_RATE_LIMIT_MAX = 10;
const EXPORT_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const exportRateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isExportRateLimited(userId: string): boolean {
  const now = Date.now();
  const entry = exportRateLimitMap.get(userId);
  if (!entry || now >= entry.resetAt) {
    if (exportRateLimitMap.size >= RATE_LIMIT_MAP_MAX) {
      for (const [key, val] of exportRateLimitMap) {
        if (now >= val.resetAt) exportRateLimitMap.delete(key);
      }
      if (exportRateLimitMap.size >= RATE_LIMIT_MAP_MAX) return true;
    }
    exportRateLimitMap.set(userId, { count: 1, resetAt: now + EXPORT_RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > EXPORT_RATE_LIMIT_MAX;
}

setInterval(() => {
  const now = Date.now();
  for (const [userId, entry] of exportRateLimitMap) {
    if (now >= entry.resetAt) exportRateLimitMap.delete(userId);
  }
}, 5 * 60 * 1000);

// ---------------------------------------------------------------------------
// Webhook operations rate limiter – 30 operations per user per hour
// ---------------------------------------------------------------------------
const WEBHOOK_RATE_LIMIT_MAX = 30;
const WEBHOOK_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const webhookRateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isWebhookRateLimited(userId: string): boolean {
  const now = Date.now();
  const entry = webhookRateLimitMap.get(userId);
  if (!entry || now >= entry.resetAt) {
    if (webhookRateLimitMap.size >= RATE_LIMIT_MAP_MAX) {
      for (const [key, val] of webhookRateLimitMap) {
        if (now >= val.resetAt) webhookRateLimitMap.delete(key);
      }
      if (webhookRateLimitMap.size >= RATE_LIMIT_MAP_MAX) return true;
    }
    webhookRateLimitMap.set(userId, { count: 1, resetAt: now + WEBHOOK_RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > WEBHOOK_RATE_LIMIT_MAX;
}

setInterval(() => {
  const now = Date.now();
  for (const [userId, entry] of webhookRateLimitMap) {
    if (now >= entry.resetAt) webhookRateLimitMap.delete(userId);
  }
}, 5 * 60 * 1000);

// ---------------------------------------------------------------------------
// SSRF protection – block private/internal IP ranges in /api/scan
// ---------------------------------------------------------------------------
/** Parse an IPv4 octet that may use octal (0-prefix) or hex (0x-prefix) notation */
function parseIpOctet(s: string): number {
  if (/^0x/i.test(s)) return parseInt(s, 16);
  if (s.startsWith("0") && s.length > 1) return parseInt(s, 8);
  return parseInt(s, 10);
}

/** Expand a compressed IPv6 address to its full 8-group form, or null if invalid */
function expandIPv6(addr: string): string | null {
  // Remove zone ID (%eth0, etc.)
  const zoneIdx = addr.indexOf('%');
  if (zoneIdx !== -1) addr = addr.slice(0, zoneIdx);

  // Handle :: expansion
  const parts = addr.split('::');
  if (parts.length > 2) return null; // multiple :: not allowed

  let groups: string[];
  if (parts.length === 2) {
    const left = parts[0] ? parts[0].split(':') : [];
    const right = parts[1] ? parts[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    if (missing < 0) return null;
    groups = [...left, ...Array(missing).fill('0'), ...right];
  } else {
    groups = addr.split(':');
  }

  if (groups.length !== 8) return null;

  // Pad each group to 4 hex digits
  return groups.map(g => g.padStart(4, '0').toLowerCase()).join(':');
}

function isPrivateHost(hostname: string): boolean {
  // Normalise to lowercase to prevent case-bypass (e.g. "LocalHost")
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  // Block obviously internal hostnames
  if (h === "localhost" || h === "api" || h === "web") return true;
  if (h.endsWith(".internal") || h.endsWith(".local") || h.endsWith(".localhost")) return true;

  // Block IPv4 private ranges (supports decimal, octal, and hex notation)
  const ipv4Match = h.match(/^([0-9a-fx]{1,6})\.([0-9a-fx]{1,6})\.([0-9a-fx]{1,6})\.([0-9a-fx]{1,6})$/i);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map(parseIpOctet);
    if (octets.some((o) => isNaN(o) || o < 0 || o > 255)) return true; // malformed
    const [a, b] = octets;
    if (a === 10) return true;                          // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16.0.0/12
    if (a === 192 && b === 168) return true;             // 192.168.0.0/16
    if (a === 127) return true;                          // 127.0.0.0/8
    if (a === 169 && b === 254) return true;             // 169.254.0.0/16 (link-local / cloud metadata)
    if (a === 0) return true;                            // 0.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return true;   // 100.64.0.0/10 (Carrier-grade NAT / shared)
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 (benchmark testing)
  }

  // Block IPv6 — normalise compressed forms before checking
  // Expand :: shorthand to full form for reliable matching
  let ipv6 = h;

  // Handle IPv6-mapped IPv4 (multiple formats)
  // ::ffff:127.0.0.1, ::ffff:a]00:1, 0:0:0:0:0:ffff:127.0.0.1
  const mappedV4Patterns = [
    /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i,
    /^0{0,4}(:0{0,4}){0,4}:ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i,
  ];
  for (const pat of mappedV4Patterns) {
    const m = ipv6.match(pat);
    if (m) {
      const mapped = m[1] || m[2];
      if (mapped && isPrivateHost(mapped)) return true;
    }
  }

  // Normalise IPv6 for consistent comparison
  if (ipv6.includes(':')) {
    // Expand :: to full form for reliable matching
    const expanded = expandIPv6(ipv6);
    if (expanded) {
      // Loopback — 0000:0000:0000:0000:0000:0000:0000:0001
      if (expanded === '0000:0000:0000:0000:0000:0000:0000:0001') return true;
      // All-zeros — 0000:...:0000
      if (/^(0000:){7}0000$/.test(expanded)) return true;
      // Link-local fe80::/10
      if (/^fe[89ab]/i.test(expanded)) return true;
      // Unique-local fc00::/7
      if (/^f[cd]/i.test(expanded)) return true;
      // Discard prefix 100::/64
      if (expanded.startsWith('0100:0000:0000:0000:')) return true;
    }
  }

  return false;
}

/**
 * Resolve a hostname via DNS and check all resolved IPs against private ranges.
 * Prevents DNS rebinding where a hostname resolves to a public IP during the
 * string check but to a private IP during the actual fetch.
 * Returns the first resolved IP if safe, or null if any resolved IP is private.
 */
async function resolveAndCheckHost(hostname: string): Promise<string | null> {
  // Skip resolution for raw IP addresses (already checked by isPrivateHost)
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) || hostname.includes(':')) {
    return isPrivateHost(hostname) ? null : hostname;
  }
  try {
    const results = await Bun.dns.resolve(hostname, "A");
    if (!results || results.length === 0) return null;
    for (const record of results) {
      const addr = typeof record === 'string' ? record : (record as any).address;
      if (!addr || isPrivateHost(addr)) return null;
    }
    // Return the first resolved IP for pinning
    const first = results[0];
    return typeof first === 'string' ? first : (first as any).address;
  } catch {
    return null; // DNS resolution failed — treat as unsafe
  }
}

// Auto-purge consent proofs older than RETENTION_DAYS (GDPR Art. 5(1)(e))
// Runs once daily at a random offset to avoid thundering herd
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// GDPR: Mask email addresses in log output (data minimization)
// ---------------------------------------------------------------------------
function maskEmail(email: string): string {
  return email.replace(/^(.{2}).*(@.*)$/, "$1***$2");
}

// ---------------------------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------------------------
const VALID_METHODS = new Set(["accept-all", "reject-all", "custom", "gpc", "dns", "do-not-sell"]);
const POISONED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_EMAIL_LEN = 254; // RFC 5321
const MAX_BODY_SIZE = 10 * 1024; // 10 KB
const MAX_JSON_BODY = 1024 * 1024; // 1 MB — general cap for JSON endpoints

// SECURITY: Password strength validation
// Top 100 most common passwords (sourced from SecLists/rockyou analysis)
const COMMON_PASSWORDS = new Set([
  // Original set
  "password", "123456", "12345678", "qwerty", "abc123", "letmein", "admin",
  "welcome", "password1", "p@ssword", "passw0rd", "iloveyou", "sunshine",
  // Extended common passwords
  "123456789", "1234567", "12345", "1234567890", "password123", "monkey",
  "dragon", "master", "login", "football", "baseball", "princess", "shadow",
  "trustno1", "superman", "michael", "ashley", "bailey", "daniel", "charlie",
  "thomas", "whatever", "soccer", "batman", "passw0rd1", "hello", "hockey",
  "ranger", "harley", "jennifer", "jordan", "george", "andrew", "pepper",
  "hunter", "joshua", "matthew", "robert", "access", "buster", "ginger",
  "maggie", "dakota", "summer", "tigger", "buttercup", "computer", "amanda",
  "freedom", "secret", "flower", "thunder", "nathan", "william", "silver",
  "jessica", "michelle", "nicole", "elizabeth", "hannah", "samantha", "killer",
  "corvette", "mustang", "asshole", "fuckyou", "fuckme", "cookie", "cheese",
  "internet", "martin", "coffee", "mercedes", "sparky", "chicken", "cowboy",
  "orange", "banana", "qwerty123", "qwertyuiop", "zxcvbnm", "asdfghjkl",
  "1q2w3e4r", "1qaz2wsx", "q1w2e3r4", "abcd1234", "pass1234", "test1234",
]);

function validatePassword(password: string): { valid: boolean; error?: string } {
  if (password.length < 10) {
    return { valid: false, error: "Password must be at least 10 characters" };
  }
  if (password.length > 128) {
    return { valid: false, error: "Password must be less than 128 characters" };
  }

  // Check character diversity
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password);
  const diversity = [hasLower, hasUpper, hasDigit, hasSpecial].filter(Boolean).length;

  if (diversity < 2) {
    return { valid: false, error: "Password must contain at least 2 of: lowercase, uppercase, numbers, special characters" };
  }

  // Check against common passwords
  const lower = password.toLowerCase();
  for (const common of COMMON_PASSWORDS) {
    if (lower.includes(common)) {
      return { valid: false, error: "Password is too common" };
    }
  }

  return { valid: true };
}

/** Safe JSON body parser with size limit. Returns parsed data or null on failure. */
async function safeJson(req: Request, maxSize = MAX_JSON_BODY): Promise<{ data: any } | { error: string }> {
  const cl = Number(req.headers.get("Content-Length") || 0);
  if (cl > maxSize) return { error: "Request body too large" };
  let raw: string;
  try { raw = await req.text(); } catch { return { error: "Failed to read body" }; }
  if (raw.length > maxSize) return { error: "Request body too large" };
  try { return { data: JSON.parse(raw) }; } catch { return { error: "Invalid JSON" }; }
}

function validateConsentPayload(
  consent: unknown
): { valid: true } | { valid: false; reason: string } {
  if (!consent || typeof consent !== "object") {
    return { valid: false, reason: "Missing or invalid 'consent' object" };
  }

  const c = consent as Record<string, unknown>;

  // method
  if (typeof c.method !== "string" || !VALID_METHODS.has(c.method)) {
    return {
      valid: false,
      reason: `Invalid consent.method. Must be one of: ${[...VALID_METHODS].join(", ")}`,
    };
  }

  // categories must be a plain object with only boolean values
  if (!c.categories || typeof c.categories !== "object" || Array.isArray(c.categories)) {
    return { valid: false, reason: "consent.categories must be a non-array object" };
  }
  const categoryKeys = Object.keys(c.categories as Record<string, unknown>);
  if (categoryKeys.length > 20) {
    return { valid: false, reason: "Too many categories (max 20)" };
  }
  for (const [key, val] of Object.entries(c.categories as Record<string, unknown>)) {
    if (POISONED_KEYS.has(key)) {
      return { valid: false, reason: `Category key "${key}" is not allowed` };
    }
    if (key.length > 64) {
      return { valid: false, reason: `Category key "${key.slice(0, 20)}..." exceeds 64 character limit` };
    }
    if (typeof val !== "boolean") {
      return {
        valid: false,
        reason: `consent.categories.${key} must be a boolean, got ${typeof val}`,
      };
    }
  }

  // version (optional, but if present must be a positive integer)
  if (c.version !== undefined && c.version !== null) {
    if (!Number.isInteger(c.version) || (c.version as number) < 1) {
      return { valid: false, reason: "consent.version must be a positive integer if provided" };
    }
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// SQL LIKE escape helper – prevents injection via % and _ in domain param
// ---------------------------------------------------------------------------
function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------
const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode=WAL");
db.exec("PRAGMA busy_timeout=5000");

// Checkpoint WAL every 5 minutes to prevent data loss on container restart
setInterval(() => {
  try { db.exec("PRAGMA wal_checkpoint(PASSIVE)"); }
  catch (_) { /* non-critical */ }
}, 5 * 60 * 1000);

// Checkpoint on shutdown
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); db.close(); }
    catch (_) { /* best effort */ }
    process.exit(0);
  });
}

db.exec(`
  CREATE TABLE IF NOT EXISTS consent_proofs (
    id          TEXT PRIMARY KEY,
    domain      TEXT NOT NULL,
    url         TEXT,
    method      TEXT NOT NULL,
    categories  TEXT NOT NULL,
    version     INTEGER,
    ip          TEXT,
    user_agent  TEXT,
    created_at  INTEGER NOT NULL
  )
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_domain ON consent_proofs(domain)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_created ON consent_proofs(created_at)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_method  ON consent_proofs(method)`);

// API keys table (for auto-generated / rotatable keys)
db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id         TEXT PRIMARY KEY,
    key_hash   TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    is_active  INTEGER NOT NULL DEFAULT 1
  )
`);

// Allowed domains table (for API-managed domains alongside env var)
db.exec(`
  CREATE TABLE IF NOT EXISTS allowed_domains (
    id         TEXT PRIMARY KEY,
    origin     TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  )
`);

// Domain configs table (stores consent banner config per domain)
db.exec(`
  CREATE TABLE IF NOT EXISTS domain_configs (
    domain     TEXT PRIMARY KEY,
    config     TEXT NOT NULL,
    css_vars   TEXT,
    updated_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )
`);

// Settings table (key-value store for server config like JWT secret)
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

// Users table (email + password auth)
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  )
`);

// Organizations table (multi-tenant isolation boundary)
db.exec(`
  CREATE TABLE IF NOT EXISTS orgs (
    id         TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  )
`);

// Org members table (maps users to orgs with roles)
db.exec(`
  CREATE TABLE IF NOT EXISTS org_members (
    org_id  TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role    TEXT NOT NULL DEFAULT 'member',
    PRIMARY KEY (org_id, user_id)
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members(user_id)`);

// Invite tokens table (for team invitations)
db.exec(`
  CREATE TABLE IF NOT EXISTS invite_tokens (
    id         TEXT PRIMARY KEY,
    org_id     TEXT NOT NULL,
    email      TEXT NOT NULL COLLATE NOCASE,
    token_hash TEXT NOT NULL,
    created_by TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at    INTEGER,
    created_at INTEGER NOT NULL
  )
`);

// Password reset tokens table
db.exec(`
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    used_at    INTEGER,
    created_at INTEGER NOT NULL
  )
`);
db.exec("CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id)");

// Email verification tokens table
db.exec(`
  CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    used_at    INTEGER,
    created_at INTEGER NOT NULL
  )
`);
db.exec("CREATE INDEX IF NOT EXISTS idx_email_verification_user ON email_verification_tokens(user_id)");

// 2FA backup codes table
db.exec(`
  CREATE TABLE IF NOT EXISTS totp_backup_codes (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    code_hash  TEXT NOT NULL,
    used_at    INTEGER,
    created_at INTEGER NOT NULL
  )
`);
db.exec("CREATE INDEX IF NOT EXISTS idx_totp_backup_user ON totp_backup_codes(user_id)");

// TOTP replay protection - track recently used codes to prevent replay attacks
db.exec(`
  CREATE TABLE IF NOT EXISTS totp_used_codes (
    user_id    TEXT NOT NULL,
    code_hash  TEXT NOT NULL,
    used_at    INTEGER NOT NULL,
    PRIMARY KEY (user_id, code_hash)
  )
`);
db.exec("CREATE INDEX IF NOT EXISTS idx_totp_used_at ON totp_used_codes(used_at)");

// Clean up old TOTP codes every minute (codes older than 2 minutes)
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 1000;
  db.prepare("DELETE FROM totp_used_codes WHERE used_at < ?").run(cutoff);
}, 60 * 1000);

// TOTP failure tracking table - prevent brute force on 2FA codes
db.exec(`
  CREATE TABLE IF NOT EXISTS totp_failures (
    user_id    TEXT PRIMARY KEY,
    failures   INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER,
    updated_at INTEGER NOT NULL
  )
`);

// SECURITY: Per-user TOTP failure tracking
// Lock account for 15 minutes after 5 failed attempts
const TOTP_MAX_FAILURES = 5;
const TOTP_LOCKOUT_MS = 15 * 60 * 1000;

function isTotpLocked(userId: string): boolean {
  const row = db.prepare("SELECT locked_until FROM totp_failures WHERE user_id = ?")
    .get(userId) as { locked_until: number | null } | null;
  if (!row || !row.locked_until) return false;
  return Date.now() < row.locked_until;
}

function recordTotpFailure(userId: string): void {
  const now = Date.now();
  const row = db.prepare("SELECT failures, locked_until FROM totp_failures WHERE user_id = ?")
    .get(userId) as { failures: number; locked_until: number | null } | null;

  if (!row) {
    db.prepare("INSERT INTO totp_failures (user_id, failures, updated_at) VALUES (?, 1, ?)")
      .run(userId, now);
    return;
  }

  // If already locked, don't increment
  if (row.locked_until && now < row.locked_until) return;

  const newFailures = row.failures + 1;
  if (newFailures >= TOTP_MAX_FAILURES) {
    // Lock the account
    db.prepare("UPDATE totp_failures SET failures = ?, locked_until = ?, updated_at = ? WHERE user_id = ?")
      .run(newFailures, now + TOTP_LOCKOUT_MS, now, userId);
    console.warn(`[SECURITY] TOTP locked for user ${userId} after ${newFailures} failures`);
  } else {
    db.prepare("UPDATE totp_failures SET failures = ?, updated_at = ? WHERE user_id = ?")
      .run(newFailures, now, userId);
  }
}

function resetTotpFailures(userId: string): void {
  db.prepare("DELETE FROM totp_failures WHERE user_id = ?").run(userId);
}

// Clean up old TOTP failure records every hour
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours old
  db.prepare("DELETE FROM totp_failures WHERE updated_at < ? AND locked_until IS NULL").run(cutoff);
}, 60 * 60 * 1000);

// Audit log table
db.exec(`
  CREATE TABLE IF NOT EXISTS audit_log (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    org_id     TEXT,
    action     TEXT NOT NULL,
    details    TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at INTEGER NOT NULL
  )
`);
db.exec("CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_audit_log_org ON audit_log(org_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action)");
db.exec("CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at)");

// Customer webhooks table
db.exec(`
  CREATE TABLE IF NOT EXISTS webhooks (
    id          TEXT PRIMARY KEY,
    org_id      TEXT NOT NULL,
    url         TEXT NOT NULL,
    secret      TEXT,
    events      TEXT NOT NULL DEFAULT '["consent.recorded"]',
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_by  TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    last_triggered_at INTEGER,
    last_status INTEGER,
    failure_count INTEGER DEFAULT 0
  )
`);
db.exec("CREATE INDEX IF NOT EXISTS idx_webhooks_org ON webhooks(org_id)");

// ---------------------------------------------------------------------------
// Migrations (idempotent ALTERs + data migration)
// ---------------------------------------------------------------------------
{
  const safeAlter = (sql: string) => {
    try { db.exec(sql); } catch (e: any) {
      if (!e.message?.includes("duplicate column")) throw e;
    }
  };
  safeAlter("ALTER TABLE users ADD COLUMN last_login_at INTEGER");
  safeAlter("ALTER TABLE users ADD COLUMN password_changed_at INTEGER");
  safeAlter("ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 0");
  safeAlter("ALTER TABLE users ADD COLUMN email_verified_at INTEGER");
  safeAlter("ALTER TABLE users ADD COLUMN totp_secret TEXT");
  safeAlter("ALTER TABLE users ADD COLUMN totp_enabled_at INTEGER");
  safeAlter("ALTER TABLE users ADD COLUMN email_pref_alerts INTEGER DEFAULT 1");
  safeAlter("ALTER TABLE users ADD COLUMN email_pref_billing INTEGER DEFAULT 1");
  safeAlter("ALTER TABLE users ADD COLUMN email_pref_security INTEGER DEFAULT 1");
  safeAlter("ALTER TABLE domain_configs ADD COLUMN org_id TEXT");
  safeAlter("ALTER TABLE allowed_domains ADD COLUMN org_id TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_domain_configs_org ON domain_configs(org_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_allowed_domains_org ON allowed_domains(org_id)");

  // --- Phase A: Trial system, agency, admin ---
  safeAlter("ALTER TABLE users ADD COLUMN account_type TEXT NOT NULL DEFAULT 'user'");
  safeAlter("ALTER TABLE users ADD COLUMN display_name TEXT");
  safeAlter("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  safeAlter("ALTER TABLE invite_tokens ADD COLUMN account_type TEXT NOT NULL DEFAULT 'user'");
  safeAlter("ALTER TABLE orgs ADD COLUMN name TEXT");
  safeAlter("ALTER TABLE orgs ADD COLUMN plan TEXT NOT NULL DEFAULT 'active'");
  safeAlter("ALTER TABLE orgs ADD COLUMN trial_started_at INTEGER");
  safeAlter("ALTER TABLE orgs ADD COLUMN trial_ends_at INTEGER");
  safeAlter("ALTER TABLE orgs ADD COLUMN grace_ends_at INTEGER");
  safeAlter("ALTER TABLE orgs ADD COLUMN created_by_agency TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_orgs_plan ON orgs(plan)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_orgs_created_by_agency ON orgs(created_by_agency)");

  // --- Phase B: Agency branding ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS agency_branding (
      user_id    TEXT PRIMARY KEY,
      logo_b64   TEXT,
      logo_mime  TEXT,
      brand_name TEXT,
      brand_color TEXT,
      updated_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS agency_smtp (
      user_id    TEXT PRIMARY KEY,
      smtp_host  TEXT,
      smtp_port  INTEGER DEFAULT 587,
      smtp_user  TEXT,
      smtp_pass  TEXT,
      smtp_from  TEXT,
      updated_at INTEGER NOT NULL
    )
  `);

  // Migrate existing plaintext SMTP passwords to AES-256-GCM encryption
  if (smtpEncryptionKeyBuf) {
    const rows = db.prepare("SELECT user_id, smtp_pass FROM agency_smtp WHERE smtp_pass IS NOT NULL AND smtp_pass != ''").all() as { user_id: string; smtp_pass: string }[];
    let migrated = 0;
    for (const row of rows) {
      if (!isEncryptedSmtpPass(row.smtp_pass)) {
        const encrypted = encryptSmtpPass(row.smtp_pass);
        db.prepare("UPDATE agency_smtp SET smtp_pass = ? WHERE user_id = ?").run(encrypted, row.user_id);
        migrated++;
      }
    }
    if (migrated > 0) {
      console.log(`[cookieproof-api] Migrated ${migrated} plaintext SMTP password(s) to AES-256-GCM`);
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS alert_log (
      id          TEXT PRIMARY KEY,
      org_id      TEXT NOT NULL,
      alert_type  TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      notified_at INTEGER
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_alert_log_org ON alert_log(org_id)");

  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_reports (
      id              TEXT PRIMARY KEY,
      org_id          TEXT NOT NULL,
      created_by      TEXT NOT NULL,
      frequency       TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      next_run_at     INTEGER NOT NULL,
      last_run_at     INTEGER,
      enabled         INTEGER NOT NULL DEFAULT 1,
      created_at      INTEGER NOT NULL
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_scheduled_reports_next ON scheduled_reports(next_run_at, enabled)");

  db.exec(`
    CREATE TABLE IF NOT EXISTS telemetry_events (
      id         TEXT PRIMARY KEY,
      domain     TEXT NOT NULL,
      event_type TEXT NOT NULL,
      message    TEXT,
      user_agent TEXT,
      page_url   TEXT,
      ip_hash    TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_telemetry_domain_created ON telemetry_events(domain, created_at)");

  db.exec(`
    CREATE TABLE IF NOT EXISTS config_fetch_daily (
      domain      TEXT NOT NULL,
      day         TEXT NOT NULL,
      fetch_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (domain, day)
    )
  `);

  // Auto-create orgs for existing users that lack one
  const orphanUsers = db.prepare(
    "SELECT u.id FROM users u WHERE NOT EXISTS (SELECT 1 FROM org_members om WHERE om.user_id = u.id)"
  ).all() as { id: string }[];

  if (orphanUsers.length > 0) {
    const insertOrg = db.prepare("INSERT INTO orgs (id, created_at) VALUES (?, ?)");
    const insertMember = db.prepare("INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, 'owner')");

    db.transaction(() => {
      for (const user of orphanUsers) {
        const orgId = randomUUID();
        insertOrg.run(orgId, Date.now());
        insertMember.run(orgId, user.id);
      }
    })();

    // If single orphan user, assign unscoped data to their org
    if (orphanUsers.length === 1) {
      const orgRow = db.prepare("SELECT org_id FROM org_members WHERE user_id = ?")
        .get(orphanUsers[0].id) as { org_id: string } | null;
      if (orgRow) {
        db.prepare("UPDATE domain_configs SET org_id = ? WHERE org_id IS NULL").run(orgRow.org_id);
        db.prepare("UPDATE allowed_domains SET org_id = ? WHERE org_id IS NULL").run(orgRow.org_id);
      }
    }
    console.log(`[cookieproof-api] Migrated ${orphanUsers.length} user(s) to org(s).`);
  }

  // Auto-name unnamed orgs from owner's email
  const unnamedOrgs = db.prepare(
    "SELECT o.id, u.email FROM orgs o JOIN org_members om ON om.org_id = o.id AND om.role = 'owner' JOIN users u ON u.id = om.user_id WHERE o.name IS NULL"
  ).all() as { id: string; email: string }[];
  if (unnamedOrgs.length > 0) {
    const nameOrg = db.prepare("UPDATE orgs SET name = ? WHERE id = ? AND name IS NULL");
    db.transaction(() => {
      for (const row of unnamedOrgs) {
        const prefix = row.email.split("@")[0] || "unnamed";
        nameOrg.run(`${prefix}'s org`, row.id);
      }
    })();
    console.log(`[cookieproof-api] Named ${unnamedOrgs.length} org(s).`);
  }

  // Sync display_name → org name for users who have set one
  const displayNameSyncs = db.prepare(`
    SELECT u.display_name, o.id AS org_id FROM users u
    JOIN org_members om ON om.user_id = u.id AND om.role = 'owner'
    JOIN orgs o ON o.id = om.org_id
    WHERE u.display_name IS NOT NULL AND u.display_name != '' AND o.name != u.display_name
    ORDER BY om.rowid ASC
  `).all() as { display_name: string; org_id: string }[];
  if (displayNameSyncs.length > 0) {
    const syncOrg = db.prepare("UPDATE orgs SET name = ? WHERE id = ?");
    db.transaction(() => {
      for (const row of displayNameSyncs) syncOrg.run(row.display_name, row.org_id);
    })();
    console.log(`[cookieproof-api] Synced display_name → org name for ${displayNameSyncs.length} org(s).`);
  }

  // Bootstrap super_admin from ADMIN_EMAIL env var
  if (ADMIN_EMAIL) {
    const adminUser = db.prepare("SELECT id, account_type FROM users WHERE email = ?").get(ADMIN_EMAIL.trim().toLowerCase()) as { id: string; account_type: string } | null;
    if (adminUser && adminUser.account_type !== "super_admin") {
      db.prepare("UPDATE users SET account_type = 'super_admin' WHERE id = ?").run(adminUser.id);
      console.log(`[cookieproof-api] Bootstrapped super_admin: ${maskEmail(ADMIN_EMAIL)}`);
    }
  }

  // Lockout fallback: if no super_admin exists and there's only one user, promote them
  if (!ADMIN_EMAIL) {
    db.transaction(() => {
      const hasSuperAdmin = db.prepare("SELECT 1 FROM users WHERE account_type = 'super_admin' LIMIT 1").get();
      if (!hasSuperAdmin) {
        const userCount = db.prepare("SELECT COUNT(*) as cnt FROM users").get() as { cnt: number };
        if (userCount.cnt === 1) {
          const onlyUser = db.prepare("SELECT id, email FROM users LIMIT 1").get() as { id: string; email: string };
          db.prepare("UPDATE users SET account_type = 'super_admin' WHERE id = ?").run(onlyUser.id);
          console.log(`[cookieproof-api] No ADMIN_EMAIL set — auto-promoted sole user to super_admin: ${maskEmail(onlyUser.email)}`);
        }
      }
    })();
  }

  // --- Phase C: Billing & Subscriptions (Mollie-ready) ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS pricing_plans (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      price_cents  INTEGER NOT NULL,
      currency     TEXT NOT NULL DEFAULT 'EUR',
      interval     TEXT NOT NULL DEFAULT 'month',
      features     TEXT,
      is_active    INTEGER NOT NULL DEFAULT 1,
      created_at   INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id                    TEXT PRIMARY KEY,
      org_id                TEXT NOT NULL,
      plan_id               TEXT NOT NULL,
      status                TEXT NOT NULL DEFAULT 'pending',
      mollie_customer_id    TEXT,
      mollie_subscription_id TEXT,
      mollie_mandate_id     TEXT,
      current_period_start  INTEGER,
      current_period_end    INTEGER,
      cancel_at_period_end  INTEGER NOT NULL DEFAULT 0,
      canceled_at           INTEGER,
      created_at            INTEGER NOT NULL,
      updated_at            INTEGER NOT NULL
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_subscriptions_org ON subscriptions(org_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_subscriptions_mollie_sub ON subscriptions(mollie_subscription_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status)");

  db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id                 TEXT PRIMARY KEY,
      org_id             TEXT NOT NULL,
      subscription_id    TEXT,
      mollie_payment_id  TEXT UNIQUE,
      amount_cents       INTEGER NOT NULL,
      currency           TEXT NOT NULL DEFAULT 'EUR',
      status             TEXT NOT NULL DEFAULT 'pending',
      description        TEXT,
      metadata           TEXT,
      paid_at            INTEGER,
      created_at         INTEGER NOT NULL,
      updated_at         INTEGER NOT NULL
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_payments_org ON payments(org_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_payments_mollie ON payments(mollie_payment_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_payments_subscription ON payments(subscription_id)");

  // Billing lifecycle events tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS billing_lifecycle_events (
      id            TEXT PRIMARY KEY,
      org_id        TEXT NOT NULL,
      event_type    TEXT NOT NULL,
      email_sent_to TEXT,
      data          TEXT,
      created_at    INTEGER NOT NULL
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_billing_lifecycle_org ON billing_lifecycle_events(org_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_billing_lifecycle_type ON billing_lifecycle_events(event_type)");

  // Agency client pricing (profit dashboard)
  db.exec(`
    CREATE TABLE IF NOT EXISTS agency_client_pricing (
      org_id        TEXT NOT NULL,
      agency_id     TEXT NOT NULL,
      client_fee_cents INTEGER NOT NULL DEFAULT 0,
      bright_tier   TEXT NOT NULL DEFAULT 'starter',
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      PRIMARY KEY (org_id, agency_id)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_agency_client_pricing_agency ON agency_client_pricing(agency_id)");

  // Add deletion_scheduled_at to orgs for 30-day account deletion grace period
  safeAlter("ALTER TABLE orgs ADD COLUMN deletion_scheduled_at INTEGER");

  // Custom domains for white-label agency deployments
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_domains (
      id          TEXT PRIMARY KEY,
      agency_id   TEXT NOT NULL,
      domain      TEXT NOT NULL UNIQUE,
      cname_target TEXT NOT NULL DEFAULT 'consent.brightinteraction.com',
      verified    INTEGER NOT NULL DEFAULT 0,
      verified_at INTEGER,
      created_at  INTEGER NOT NULL
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_custom_domains_agency ON custom_domains(agency_id)");

  // Primary contact email for agency-managed client orgs
  safeAlter("ALTER TABLE orgs ADD COLUMN primary_contact_email TEXT");

  // Seed default pricing plans if none exist
  const planCount = db.prepare("SELECT COUNT(*) as cnt FROM pricing_plans").get() as { cnt: number };
  if (planCount.cnt === 0) {
    const now = Date.now();
    const insertPlan = db.prepare(`
      INSERT INTO pricing_plans (id, name, price_cents, currency, interval, features, is_active, created_at)
      VALUES (?, ?, ?, 'EUR', ?, ?, 1, ?)
    `);
    db.transaction(() => {
      insertPlan.run("starter", "Starter", 990, "month", JSON.stringify({ domains: 1, proofs_per_month: 10000, team_members: 2 }), now);
      insertPlan.run("professional", "Professional", 2990, "month", JSON.stringify({ domains: 5, proofs_per_month: 100000, team_members: 10, agency_features: false }), now);
      insertPlan.run("agency", "Agency", 9900, "month", JSON.stringify({ domains: 50, proofs_per_month: 1000000, team_members: -1, agency_features: true }), now);
    })();
    console.log("[cookieproof-api] Seeded default pricing plans.");
  }
}

const listDomainsStmt = db.prepare(
  "SELECT id, origin, created_at FROM allowed_domains ORDER BY created_at ASC"
);

const getConfigStmt = db.prepare(
  "SELECT config, css_vars, updated_at FROM domain_configs WHERE domain = ?"
);

const upsertConfigStmt = db.prepare(`
  INSERT INTO domain_configs (domain, config, css_vars, updated_at, created_at)
  VALUES ($domain, $config, $css_vars, $now, $now)
  ON CONFLICT(domain) DO UPDATE SET
    config = $config,
    css_vars = $css_vars,
    updated_at = $now
`);

const listConfigsStmt = db.prepare(
  "SELECT domain, config, css_vars, updated_at, created_at FROM domain_configs ORDER BY updated_at DESC"
);

// ---------------------------------------------------------------------------
// Seed default config for brightinteraction.com (only if no config exists)
// ---------------------------------------------------------------------------
{
  const existing = getConfigStmt.get("brightinteraction.com") as { config: string | null } | null;
  if (!existing) {
    const seedConfig = {
      position: "bottom",
      theme: "light",
      language: "en",
      revision: 1,
      gcmEnabled: true,
      respectGPC: true,
      floatingTrigger: "left",
      keyboardShortcut: "Alt+C",
      privacyPolicyUrl: "https://brightinteraction.com/privacy",
      proofEndpoint: "https://consent.brightinteraction.com/api/proof",
      cookieDomain: ".brightinteraction.com",
      cookieExpiry: 365,
      expiryNotifyDays: 30,
      expiryNotifyUI: true,
      languageSelector: ["en", "sv"],
      categories: [
        {
          id: "necessary",
          required: true,
          enabled: true,
          services: [{
            id: "cookieproof",
            label: "CookieProof",
            description: "Stores your cookie consent preferences",
            cookies: ["ce_consent"],
          }],
          declarations: [{
            name: "ce_consent",
            provider: "This site",
            purpose: "Stores consent preferences",
            expiry: "1 year",
          }],
        },
        {
          id: "analytics",
          required: false,
          enabled: false,
          services: [{
            id: "ga4",
            label: "Google Analytics 4",
            description: "Website usage analytics by Google",
            cookies: ["_ga", "_ga_*", "_gid", "_gac_*"],
          }],
          declarations: [
            { name: "_ga", provider: "Google", purpose: "Distinguishes unique users", expiry: "2 years" },
            { name: "_ga_*", provider: "Google", purpose: "Stores session state", expiry: "2 years" },
            { name: "_gid", provider: "Google", purpose: "Distinguishes users", expiry: "24 hours" },
            { name: "_gac_*", provider: "Google", purpose: "Campaign information", expiry: "90 days" },
          ],
        },
        {
          id: "marketing",
          required: false,
          enabled: false,
        },
        {
          id: "preferences",
          required: false,
          enabled: false,
          declarations: [
            { name: "lang", provider: "This site", purpose: "Stores language preference", expiry: "1 year" },
          ],
        },
      ],
    };
    const seedCssVars = {
      "--cc-bg": "#ffffff",
      "--cc-bg-secondary": "#fafaf9",
      "--cc-text": "#18181b",
      "--cc-text-secondary": "#52525b",
      "--cc-border": "#e7e5e4",
      "--cc-btn-primary-bg": "#0891B2",
      "--cc-btn-primary-text": "#ffffff",
      "--cc-btn-reject-bg": "#0891B2",
      "--cc-btn-reject-text": "#ffffff",
      "--cc-btn-secondary-bg": "#18181b",
      "--cc-btn-secondary-text": "#ffffff",
      "--cc-btn-secondary-hover": "#3f3f46",
      "--cc-toggle-on": "#0891B2",
      "--cc-toggle-off": "#d6d3d1",
      "--cc-overlay": "rgba(0, 0, 0, 0.4)",
      "--cc-radius": "12px",
      "--cc-radius-sm": "8px",
      "--cc-font": "'Inter', system-ui, sans-serif",
      "--cc-shadow": "0 8px 24px rgba(0, 0, 0, 0.06)",
    };
    const now = Date.now();
    upsertConfigStmt.run({
      $domain: "brightinteraction.com",
      $config: JSON.stringify(seedConfig),
      $css_vars: JSON.stringify(seedCssVars),
      $now: now,
    });
    console.log("[cookieproof-api] Seeded default config for brightinteraction.com");
  }
}

/** Derive https origins from a bare domain, including www variant */
function deriveOrigins(domain: string): string[] {
  const origins = [`https://${domain}`];
  if (domain.startsWith("www.")) {
    // www.example.com → also allow example.com
    origins.push(`https://${domain.slice(4)}`);
  } else {
    // Only add www variant for bare domains (example.com), not subdomains (app.example.com)
    const parts = domain.split(".");
    if (parts.length === 2) {
      origins.push(`https://www.${domain}`);
    }
  }
  return origins;
}

/** Merged runtime list: env var origins + DB-managed origins + domain config origins, deduplicated.
 *  Cached with 60s TTL to avoid 2 table scans per request. Invalidated on writes. */
let _originsCache: string[] | null = null;
let _originsCacheExpiry = 0;
function invalidateOriginCache() { _originsCache = null; _originsCacheExpiry = 0; }

function getAllowedOrigins(): string[] {
  const now = Date.now();
  if (_originsCache && now < _originsCacheExpiry) return _originsCache;
  const dbRows = listDomainsStmt.all() as { origin: string }[];
  const dbOrigins = dbRows.map(r => r.origin);
  const configRows = db.prepare("SELECT domain FROM domain_configs").all() as { domain: string }[];
  const configOrigins = configRows.flatMap(r => deriveOrigins(r.domain));
  _originsCache = [...new Set([...ENV_ORIGINS, ...dbOrigins, ...configOrigins])];
  _originsCacheExpiry = now + 60_000;
  return _originsCache;
}

/** Get allowed origins for a specific domain's org (for proof submission scoping) */
function getAllowedOriginsForDomain(domain: string): string[] {
  const config = db.prepare("SELECT org_id FROM domain_configs WHERE domain = ?").get(domain) as { org_id: string | null } | null;
  // Auto-derive origins from the domain config itself (+ www variant)
  const autoOrigins = config ? deriveOrigins(domain) : [];
  if (!config) {
    // Domain not configured at all — only allow env-managed origins
    return [...ENV_ORIGINS];
  }
  if (!config.org_id) {
    // Unscoped domain (migration data) — allow env origins + auto-derived + unscoped DB origins
    const unscopedOrigins = db.prepare("SELECT origin FROM allowed_domains WHERE org_id IS NULL").all() as { origin: string }[];
    return [...new Set([...ENV_ORIGINS, ...autoOrigins, ...unscopedOrigins.map(r => r.origin)])];
  }
  const orgOrigins = db.prepare("SELECT origin FROM allowed_domains WHERE org_id = ?").all(config.org_id) as { origin: string }[];
  return [...new Set([...ENV_ORIGINS, ...autoOrigins, ...orgOrigins.map(r => r.origin)])];
}

// ---------------------------------------------------------------------------
// Resolve active API key: env var > DB key > none (setup via dashboard)
// ---------------------------------------------------------------------------
let keySource: "env" | "database" | "none" = ENV_API_KEY ? "env" : "none";

if (!ENV_API_KEY) {
  const existing = db.prepare(
    "SELECT id FROM api_keys WHERE is_active = 1 LIMIT 1"
  ).get() as { id: string } | null;

  if (existing) {
    keySource = "database";
    console.log("[cookieproof-api] Using API key from database.");
  } else {
    keySource = "none";
    console.log("[cookieproof-api] No API key configured. Visit the dashboard Settings to generate one.");
  }
} else {
  console.log("[cookieproof-api] Using API key from environment variable.");
}

const insertStmt = db.prepare(`
  INSERT INTO consent_proofs (id, domain, url, method, categories, version, ip, user_agent, created_at)
  VALUES ($id, $domain, $url, $method, $categories, $version, $ip, $user_agent, $created_at)
`);

const listStmt = db.prepare(`
  SELECT * FROM consent_proofs
  WHERE domain LIKE $domain ESCAPE '\\'
    AND created_at >= $from
    AND created_at <= $to
    AND ($method IS NULL OR method = $method)
  ORDER BY created_at DESC
  LIMIT $limit OFFSET $offset
`);

const countStmt = db.prepare(`
  SELECT COUNT(*) as total FROM consent_proofs
  WHERE domain LIKE $domain ESCAPE '\\'
    AND created_at >= $from
    AND created_at <= $to
    AND ($method IS NULL OR method = $method)
`);

const getStmt = db.prepare(`SELECT * FROM consent_proofs WHERE id = $id`);

const statsStmtAll = db.prepare(`
  SELECT
    COUNT(*) as total,
    COALESCE(SUM(CASE WHEN method = 'accept-all' THEN 1 ELSE 0 END), 0) as accept_all,
    COALESCE(SUM(CASE WHEN method = 'reject-all' THEN 1 ELSE 0 END), 0) as reject_all,
    COALESCE(SUM(CASE WHEN method = 'custom' THEN 1 ELSE 0 END), 0) as custom,
    COALESCE(SUM(CASE WHEN method = 'gpc' THEN 1 ELSE 0 END), 0) as gpc,
    COALESCE(SUM(CASE WHEN method IN ('dns', 'do-not-sell') THEN 1 ELSE 0 END), 0) as do_not_sell
  FROM consent_proofs
  WHERE domain LIKE $domain ESCAPE '\\'
    AND created_at >= $from
    AND created_at <= $to
`);

const statsStmtMethod = db.prepare(`
  SELECT
    COUNT(*) as total,
    COALESCE(SUM(CASE WHEN method = 'accept-all' THEN 1 ELSE 0 END), 0) as accept_all,
    COALESCE(SUM(CASE WHEN method = 'reject-all' THEN 1 ELSE 0 END), 0) as reject_all,
    COALESCE(SUM(CASE WHEN method = 'custom' THEN 1 ELSE 0 END), 0) as custom,
    COALESCE(SUM(CASE WHEN method = 'gpc' THEN 1 ELSE 0 END), 0) as gpc,
    COALESCE(SUM(CASE WHEN method IN ('dns', 'do-not-sell') THEN 1 ELSE 0 END), 0) as do_not_sell
  FROM consent_proofs
  WHERE domain LIKE $domain ESCAPE '\\'
    AND created_at >= $from
    AND created_at <= $to
    AND method = $method
`);

const dailyStmtAll = db.prepare(`
  SELECT
    date(created_at / 1000, 'unixepoch') as day,
    COUNT(*) as total,
    COALESCE(SUM(CASE WHEN method = 'accept-all' THEN 1 ELSE 0 END), 0) as accept_all,
    COALESCE(SUM(CASE WHEN method = 'reject-all' THEN 1 ELSE 0 END), 0) as reject_all,
    COALESCE(SUM(CASE WHEN method = 'custom' THEN 1 ELSE 0 END), 0) as custom,
    COALESCE(SUM(CASE WHEN method = 'gpc' THEN 1 ELSE 0 END), 0) as gpc,
    COALESCE(SUM(CASE WHEN method IN ('dns', 'do-not-sell') THEN 1 ELSE 0 END), 0) as do_not_sell
  FROM consent_proofs
  WHERE domain LIKE $domain ESCAPE '\\'
    AND created_at >= $from
    AND created_at <= $to
  GROUP BY day
  ORDER BY day DESC
  LIMIT 90
`);

const dailyStmtMethod = db.prepare(`
  SELECT
    date(created_at / 1000, 'unixepoch') as day,
    COUNT(*) as total,
    COALESCE(SUM(CASE WHEN method = 'accept-all' THEN 1 ELSE 0 END), 0) as accept_all,
    COALESCE(SUM(CASE WHEN method = 'reject-all' THEN 1 ELSE 0 END), 0) as reject_all,
    COALESCE(SUM(CASE WHEN method = 'custom' THEN 1 ELSE 0 END), 0) as custom,
    COALESCE(SUM(CASE WHEN method = 'gpc' THEN 1 ELSE 0 END), 0) as gpc,
    COALESCE(SUM(CASE WHEN method IN ('dns', 'do-not-sell') THEN 1 ELSE 0 END), 0) as do_not_sell
  FROM consent_proofs
  WHERE domain LIKE $domain ESCAPE '\\'
    AND created_at >= $from
    AND created_at <= $to
    AND method = $method
  GROUP BY day
  ORDER BY day DESC
  LIMIT 90
`);

const deleteStmt = db.prepare(`
  DELETE FROM consent_proofs WHERE created_at < $before
`);

const deleteDomainStmt = db.prepare(`
  DELETE FROM consent_proofs WHERE created_at < $before AND domain LIKE $domain ESCAPE '\\'
`);

const exportStmt = db.prepare(`
  SELECT * FROM consent_proofs
  WHERE domain LIKE $domain ESCAPE '\\'
    AND created_at >= $from
    AND created_at <= $to
    AND ($method IS NULL OR method = $method)
  ORDER BY created_at DESC
  LIMIT 100000
`);

// ---------------------------------------------------------------------------
// Retention purge – defined here so deleteStmt is already in scope
// ---------------------------------------------------------------------------
function purgeExpiredProofs(): void {
  try {
    const cutoff = Date.now() - RETENTION_MS;
    const result = deleteStmt.run({ $before: cutoff });
    if (result.changes > 0) {
      console.log(`[retention] Purged ${result.changes} consent proofs older than ${RETENTION_DAYS} days`);
    }
  } catch (e) {
    console.error('[retention] Failed to purge expired proofs:', e);
  }
}

// Run on startup after a short delay, then every 24 hours
setTimeout(purgeExpiredProofs, 10_000);
setInterval(purgeExpiredProofs, 24 * 60 * 60 * 1000);

// ---------------------------------------------------------------------------
// Email verification helper
// ---------------------------------------------------------------------------
async function sendVerificationEmail(userId: string, email: string, origin: string): Promise<string | null> {
  // Rate limit: max 3 verification emails per user per hour
  const recentVerifications = db.prepare(
    "SELECT COUNT(*) as cnt FROM email_verification_tokens WHERE user_id = ? AND created_at > ?"
  ).get(userId, Date.now() - 3600 * 1000) as { cnt: number };
  if (recentVerifications.cnt >= 3) {
    return null; // Silently fail to prevent abuse
  }

  // Invalidate any existing tokens for this user
  db.prepare("DELETE FROM email_verification_tokens WHERE user_id = ?").run(userId);

  // Generate secure token
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const tokenId = randomUUID();
  const now = Date.now();
  const expiresAt = now + 24 * 60 * 60 * 1000; // 24 hours

  db.prepare(
    "INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(tokenId, userId, tokenHash, expiresAt, now);

  if (!RESEND_API_KEY && (!SMTP_HOST || !SMTP_FROM)) {
    // SECURITY: Never log actual tokens - only log that email is not configured
    console.warn(`[cookieproof-api] Email not configured — verification token generated for ${maskEmail(email)} (check DB to retrieve)`);
    return rawToken;
  }

  const verifyUrl = `${origin || "https://app.cookieproof.io"}/#verify-email/${rawToken}`;
  const subject = "Verify your CookieProof email address";
  const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;padding:40px 20px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e2e8f0;">
    <h1 style="font-size:20px;color:#0f172a;margin:0 0 16px;">Welcome to CookieProof!</h1>
    <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 24px;">
      Please verify your email address to complete your account setup.
    </p>
    <p style="margin:0 0 24px;">
      <a href="${escAttr(verifyUrl)}" style="display:inline-block;background:#0d9488;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;">
        Verify Email Address
      </a>
    </p>
    <p style="color:#64748b;font-size:13px;line-height:1.6;margin:0 0 16px;">
      This link will expire in 24 hours. If you didn't create an account with CookieProof, you can safely ignore this email.
    </p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
    <p style="color:#94a3b8;font-size:12px;margin:0;">
      CookieProof — GDPR Compliant Cookie Consent
    </p>
  </div>
</body>
</html>`;
  const textBody = `Welcome to CookieProof!\n\nPlease verify your email address by clicking the link below:\n\n${verifyUrl}\n\nThis link expires in 24 hours.\n\nIf you didn't create this account, you can safely ignore this email.`;

  sendEmail(email, subject, htmlBody, textBody)
    .then(() => console.log(`[cookieproof-api] Verification email sent to ${maskEmail(email)}`))
    .catch(e => console.error(`[cookieproof-api] Failed to send verification email to ${maskEmail(email)}:`, e.message));

  return rawToken;
}

// ---------------------------------------------------------------------------
// TOTP (Time-based One-Time Password) helpers for 2FA
// ---------------------------------------------------------------------------
function generateTotpSecret(): string {
  // Generate 20 bytes of random data, base32 encode it
  const bytes = randomBytes(20);
  return base32Encode(bytes);
}

function base32Encode(buffer: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let output = "";
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(str: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  str = str.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const idx = alphabet.indexOf(str[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function generateTotp(secret: string, timeStep = 30, digits = 6, counter?: number): string {
  const key = base32Decode(secret);
  const time = counter ?? Math.floor(Date.now() / 1000 / timeStep);
  const timeBuffer = Buffer.alloc(8);
  timeBuffer.writeBigUInt64BE(BigInt(time));

  const hmac = createHmac("sha1", key).update(timeBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = (code % Math.pow(10, digits)).toString().padStart(digits, "0");
  return otp;
}

function verifyTotp(secret: string, code: string, window = 1): boolean {
  // Allow codes from the past `window` and future `window` time steps
  // SECURITY: Use timing-safe comparison to prevent timing attacks
  const timeStep = 30;
  const currentCounter = Math.floor(Date.now() / 1000 / timeStep);
  for (let i = -window; i <= window; i++) {
    const expected = generateTotp(secret, timeStep, 6, currentCounter + i);
    // Use timing-safe comparison to prevent timing side-channel attacks
    try {
      if (timingSafeEqual(Buffer.from(expected), Buffer.from(code))) {
        return true;
      }
    } catch {
      // Buffers of different length - code is wrong
      continue;
    }
  }
  return false;
}

// SECURITY: Verify TOTP with replay protection to prevent code reuse
function verifyTotpWithReplayProtection(userId: string, secret: string, code: string): boolean {
  // First verify the code is valid
  if (!verifyTotp(secret, code)) return false;

  // Check if this code was already used (replay attack prevention)
  const codeHash = createHash("sha256").update(code).digest("hex");
  const used = db.prepare(
    "SELECT 1 FROM totp_used_codes WHERE user_id = ? AND code_hash = ?"
  ).get(userId, codeHash);

  if (used) {
    console.warn(`[SECURITY] TOTP replay attempt blocked for user ${userId}`);
    return false;
  }

  // Mark code as used
  try {
    db.prepare(
      "INSERT INTO totp_used_codes (user_id, code_hash, used_at) VALUES (?, ?, ?)"
    ).run(userId, codeHash, Date.now());
  } catch {
    // Ignore duplicate key errors (race condition protection)
  }

  return true;
}

function generateTotpUri(secret: string, email: string, issuer = "CookieProof"): string {
  const encodedEmail = encodeURIComponent(email);
  const encodedIssuer = encodeURIComponent(issuer);
  return `otpauth://totp/${encodedIssuer}:${encodedEmail}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
}

function generateBackupCodes(): string[] {
  // Generate 10 backup codes, each 8 characters (alphanumeric)
  const codes: string[] = [];
  for (let i = 0; i < 10; i++) {
    const code = randomBytes(4).toString("hex").toUpperCase();
    codes.push(code.slice(0, 4) + "-" + code.slice(4));
  }
  return codes;
}

// ---------------------------------------------------------------------------
// Automatic alert checker – sends email digests to agency/admin users
// ---------------------------------------------------------------------------
async function sendAlertDigestEmail(
  to: string, orgAlerts: { orgName: string; alerts: string[] }[], agencyUserId?: string
): Promise<void> {
  const smtp = getSmtpConfig(agencyUserId);
  const boundary = "----=_AlertDigest_" + randomUUID().replace(/-/g, "");
  const nowStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const htmlBody = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;padding:24px;max-width:600px;margin:0 auto;">
<h2 style="color:#0d9488;margin:0 0 8px;">CookieProof Alert Digest</h2>
<p style="color:#64748b;margin:0 0 24px;">${nowStr}</p>
${orgAlerts.map(o => `<div style="margin:0 0 16px;padding:16px;border:1px solid #e2e8f0;border-radius:8px;">
<h3 style="margin:0 0 8px;font-size:16px;">${escHtml(o.orgName)}</h3>
<ul style="margin:0;padding-left:20px;">${o.alerts.map(a => `<li style="color:#dc2626;margin:4px 0;">${escHtml(a)}</li>`).join("")}</ul>
</div>`).join("")}
<p style="color:#94a3b8;font-size:12px;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:16px;">This is an automated alert from CookieProof. <a href="https://consent.brightinteraction.com/configurator/" style="color:#0d9488;">Open Dashboard</a></p>
</body></html>`;

  const plainText = `Alert Digest — ${nowStr}\n\n` +
    orgAlerts.map(o => `${o.orgName.replace(/[\r\n]/g, "")}:\n${o.alerts.map(a => `  - ${a.replace(/[\r\n]/g, "")}`).join("\n")}`).join("\n\n") +
    `\n\nThis is an automated alert from CookieProof.`;

  const message = [
    `From: ${smtp.from}`, `To: ${to}`,
    `Subject: CookieProof Alert Digest — ${nowStr}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``, `--${boundary}`,
    `Content-Type: text/plain; charset=utf-8`, `Content-Transfer-Encoding: 7bit`,
    ``, plainText,
    ``, `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`, `Content-Transfer-Encoding: 7bit`,
    ``, htmlBody,
    ``, `--${boundary}--`,
  ].join("\r\n");

  await sendSmtpEmail(smtp.host, smtp.port, smtp.user, smtp.pass, smtp.from, to, message);
  console.log(`[cookieproof-api] Alert digest sent to ${to} (${orgAlerts.length} org(s))`);
}

let _alertCheckRunning = false;
async function checkAndNotifyAlerts(): Promise<void> {
  if (_alertCheckRunning) return;
  if (!ALERT_EMAIL_ENABLED || !SMTP_HOST || !SMTP_FROM) return;
  _alertCheckRunning = true;

  try {
    const agencyUsers = db.prepare(
      `SELECT DISTINCT u.id, u.email FROM users u WHERE u.account_type IN ('agency', 'admin', 'super_admin') AND u.status != 'archived'`
    ).all() as { id: string; email: string }[];

    for (const user of agencyUsers) {
      const ownedOrgs = db.prepare(`
        SELECT o.id, o.name FROM org_members om
        JOIN orgs o ON o.id = om.org_id
        WHERE om.user_id = ? AND om.role = 'owner' AND o.plan != 'archived'
      `).all(user.id) as { id: string; name: string | null }[];

      const newAlerts: { orgName: string; alerts: string[] }[] = [];

      for (const org of ownedOrgs) {
        const currentAlerts = computeOrgAlerts(org.id);
        for (const alert of currentAlerts) {
          const existing = db.prepare(
            `SELECT 1 FROM alert_log WHERE org_id = ? AND alert_type = ? AND notified_at > ?`
          ).get(org.id, alert.type, Date.now() - 24 * 3600 * 1000);

          if (!existing) {
            db.prepare(`INSERT INTO alert_log (id, org_id, alert_type, created_at, notified_at) VALUES (?, ?, ?, ?, ?)`)
              .run(randomUUID(), org.id, alert.type, Date.now(), Date.now());

            const entry = newAlerts.find(a => a.orgName === (org.name || "Unnamed"));
            if (entry) entry.alerts.push(alert.message);
            else newAlerts.push({ orgName: org.name || "Unnamed", alerts: [alert.message] });
          }
        }
      }

      if (newAlerts.length > 0) {
        try {
          await sendAlertDigestEmail(user.email, newAlerts, user.id);
        } catch (e: any) {
          console.error(`[cookieproof-api] Failed to send alert digest to ${maskEmail(user.email)}:`, e.message);
        }
      }
    }

    // Purge old alert_log entries (older than 30 days)
    db.prepare("DELETE FROM alert_log WHERE created_at < ?").run(Date.now() - 30 * 24 * 3600 * 1000);

    // Purge old telemetry events (older than 30 days)
    db.prepare("DELETE FROM telemetry_events WHERE created_at < ?").run(Date.now() - 30 * 24 * 3600 * 1000);

    // Purge old config fetch daily entries (older than 90 days)
    db.prepare("DELETE FROM config_fetch_daily WHERE day < date('now', '-90 days')").run();

    // Purge expired/used invite tokens (older than 30 days)
    db.prepare("DELETE FROM invite_tokens WHERE (used_at IS NOT NULL AND used_at < ?) OR (expires_at < ?)").run(
      Date.now() - 30 * 24 * 3600 * 1000,
      Date.now() - 7 * 24 * 3600 * 1000
    );
  } catch (e: any) {
    console.error("[cookieproof-api] Alert check failed:", e.message);
  } finally {
    _alertCheckRunning = false;
  }
}

setTimeout(checkAndNotifyAlerts, 5 * 60 * 1000);
setInterval(checkAndNotifyAlerts, ALERT_CHECK_INTERVAL_HOURS * 3600 * 1000);

// ---------------------------------------------------------------------------
// Billing lifecycle email templates and functions
// ---------------------------------------------------------------------------
type BillingEventType =
  | "subscription_canceled"      // User canceled (immediate notification)
  | "period_ending_7d"           // 7 days before period ends (canceled sub)
  | "period_ending_3d"           // 3 days before period ends (canceled sub)
  | "period_ending_1d"           // 1 day before period ends (canceled sub)
  | "subscription_expired"       // Period ended, access locked
  | "deletion_warning_14d"       // 14 days until account deletion
  | "deletion_warning_7d"        // 7 days until account deletion
  | "deletion_warning_1d"        // 1 day until account deletion
  | "account_deleted";           // Final deletion notice with PDF report

function getBillingEmailHtml(
  eventType: BillingEventType,
  orgName: string,
  data: { periodEndDate?: string; deletionDate?: string; daysLeft?: number; reactivateUrl?: string }
): { subject: string; htmlBody: string; plainText: string } {
  const reactivateLink = data.reactivateUrl || "https://consent.brightinteraction.com/configurator/#billing";
  const supportEmail = "support@brightinteraction.com";

  const templates: Record<BillingEventType, { subject: string; heading: string; body: string }> = {
    subscription_canceled: {
      subject: `Subscription canceled for ${orgName}`,
      heading: "Your Subscription Has Been Canceled",
      body: `<p>Your CookieProof subscription for <strong>${escHtml(orgName)}</strong> has been canceled as requested.</p>
        <p>Your access will continue until <strong>${data.periodEndDate || "the end of your billing period"}</strong>. After that date:</p>
        <ul>
          <li>Your cookie consent banner will stop working</li>
          <li>Dashboard access will be restricted</li>
          <li>Your data will be retained for 30 days before permanent deletion</li>
        </ul>
        <p>Changed your mind? You can reactivate your subscription anytime before the period ends:</p>
        <p style="margin:20px 0;"><a href="${escAttr(reactivateLink)}" style="display:inline-block;padding:12px 28px;background:#0d9488;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Reactivate Subscription</a></p>`
    },
    period_ending_7d: {
      subject: `7 days left on your CookieProof subscription — ${orgName}`,
      heading: "Your Subscription Ends in 7 Days",
      body: `<p>This is a friendly reminder that your CookieProof subscription for <strong>${escHtml(orgName)}</strong> will end on <strong>${data.periodEndDate}</strong>.</p>
        <p>To avoid service interruption, please reactivate your subscription:</p>
        <p style="margin:20px 0;"><a href="${escAttr(reactivateLink)}" style="display:inline-block;padding:12px 28px;background:#0d9488;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Reactivate Now</a></p>`
    },
    period_ending_3d: {
      subject: `3 days left — Your CookieProof subscription is ending — ${orgName}`,
      heading: "Only 3 Days Left on Your Subscription",
      body: `<p>Your CookieProof subscription for <strong>${escHtml(orgName)}</strong> will expire on <strong>${data.periodEndDate}</strong>.</p>
        <p>After this date, your cookie consent banner will stop working on your website(s). Don't let your visitors see a broken experience!</p>
        <p style="margin:20px 0;"><a href="${escAttr(reactivateLink)}" style="display:inline-block;padding:12px 28px;background:#0d9488;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Reactivate Subscription</a></p>`
    },
    period_ending_1d: {
      subject: `URGENT: Your CookieProof subscription expires tomorrow — ${orgName}`,
      heading: "Your Subscription Expires Tomorrow",
      body: `<p><strong>Final reminder:</strong> Your CookieProof subscription for <strong>${escHtml(orgName)}</strong> expires tomorrow (<strong>${data.periodEndDate}</strong>).</p>
        <p>Starting tomorrow, your cookie consent banner will stop working. Reactivate now to maintain compliance:</p>
        <p style="margin:20px 0;"><a href="${escAttr(reactivateLink)}" style="display:inline-block;padding:12px 28px;background:#dc2626;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Reactivate Immediately</a></p>`
    },
    subscription_expired: {
      subject: `Your CookieProof subscription has expired — ${orgName}`,
      heading: "Your Subscription Has Expired",
      body: `<p>Your CookieProof subscription for <strong>${escHtml(orgName)}</strong> has now expired.</p>
        <p><strong>What this means:</strong></p>
        <ul>
          <li>Your cookie consent banner is no longer active on your website(s)</li>
          <li>Dashboard access has been restricted</li>
          <li>Your account data will be permanently deleted on <strong>${data.deletionDate}</strong> (30 days from today)</li>
        </ul>
        <p>You can still reactivate your subscription and restore full access. Your data is safe until the deletion date.</p>
        <p style="margin:20px 0;"><a href="${escAttr(reactivateLink)}" style="display:inline-block;padding:12px 28px;background:#0d9488;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Reactivate &amp; Restore Access</a></p>`
    },
    deletion_warning_14d: {
      subject: `Account deletion in 14 days — ${orgName}`,
      heading: "Your Account Will Be Deleted in 14 Days",
      body: `<p>Your CookieProof account for <strong>${escHtml(orgName)}</strong> is scheduled for permanent deletion on <strong>${data.deletionDate}</strong>.</p>
        <p>Once deleted, all your configuration, consent proof history, and account data will be permanently removed and cannot be recovered.</p>
        <p>If you'd like to keep your account, simply reactivate your subscription:</p>
        <p style="margin:20px 0;"><a href="${escAttr(reactivateLink)}" style="display:inline-block;padding:12px 28px;background:#0d9488;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Reactivate Subscription</a></p>`
    },
    deletion_warning_7d: {
      subject: `Account deletion in 7 days — ${orgName}`,
      heading: "Your Account Will Be Deleted in 7 Days",
      body: `<p>This is a reminder that your CookieProof account for <strong>${escHtml(orgName)}</strong> will be permanently deleted on <strong>${data.deletionDate}</strong>.</p>
        <p>All your consent proof history, banner configurations, and account data will be permanently removed.</p>
        <p style="margin:20px 0;"><a href="${escAttr(reactivateLink)}" style="display:inline-block;padding:12px 28px;background:#f59e0b;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Reactivate to Cancel Deletion</a></p>`
    },
    deletion_warning_1d: {
      subject: `FINAL WARNING: Account deletion tomorrow — ${orgName}`,
      heading: "Your Account Will Be Deleted Tomorrow",
      body: `<p><strong>Final notice:</strong> Your CookieProof account for <strong>${escHtml(orgName)}</strong> will be permanently deleted tomorrow (<strong>${data.deletionDate}</strong>).</p>
        <p>This is your last chance to save your account data. After deletion:</p>
        <ul>
          <li>All consent proofs will be permanently deleted</li>
          <li>All banner configurations will be lost</li>
          <li>Your account cannot be recovered</li>
        </ul>
        <p style="margin:20px 0;"><a href="${escAttr(reactivateLink)}" style="display:inline-block;padding:12px 28px;background:#dc2626;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Save My Account Now</a></p>`
    },
    account_deleted: {
      subject: `Your CookieProof account has been deleted — ${orgName}`,
      heading: "Your Account Has Been Deleted",
      body: `<p>Your CookieProof account for <strong>${escHtml(orgName)}</strong> has been permanently deleted as scheduled.</p>
        <p>Attached to this email is your final consent proof history report — a PDF containing all consent records from your subscription period.</p>
        <p>If you'd like to use CookieProof again in the future, you're welcome to create a new account at any time.</p>
        <p>Thank you for using CookieProof. We wish you all the best!</p>`
    },
  };

  const template = templates[eventType];
  const htmlBody = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;padding:24px;max-width:600px;margin:0 auto;">
<h2 style="color:#0d9488;margin:0 0 20px;">${template.heading}</h2>
${template.body}
<p style="color:#94a3b8;font-size:12px;margin-top:32px;border-top:1px solid #e2e8f0;padding-top:16px;">
Questions? Contact us at <a href="mailto:${supportEmail}" style="color:#0d9488;">${supportEmail}</a><br>
CookieProof by Bright Interaction
</p>
</body></html>`;

  // Generate plain text version
  const plainText = template.heading + "\n\n" +
    template.body
      .replace(/<p[^>]*>/gi, "").replace(/<\/p>/gi, "\n\n")
      .replace(/<ul[^>]*>/gi, "").replace(/<\/ul>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ").replace(/<\/li>/gi, "\n")
      .replace(/<strong>/gi, "").replace(/<\/strong>/gi, "")
      .replace(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi, "$2: $1")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .trim() +
    `\n\nQuestions? Contact us at ${supportEmail}\nCookieProof by Bright Interaction`;

  return { subject: template.subject, htmlBody, plainText };
}

async function sendBillingLifecycleEmail(
  orgId: string,
  eventType: BillingEventType,
  pdfAttachment?: { filename: string; content: Buffer }
): Promise<void> {
  const org = db.prepare("SELECT name FROM orgs WHERE id = ?").get(orgId) as { name: string | null } | null;
  if (!org) return;
  const orgName = org.name || "Your Organization";

  // Get all owners of this org
  const owners = db.prepare(`
    SELECT u.email FROM org_members om
    JOIN users u ON u.id = om.user_id
    WHERE om.org_id = ? AND om.role = 'owner' AND u.status != 'archived'
  `).all(orgId) as { email: string }[];

  if (owners.length === 0) return;

  // Check if we already sent this exact event type recently (prevent spam)
  // Use 20 hours for warnings (job runs every 6h, so this prevents duplicates within same "day")
  // Use 6 hours for one-time events like subscription_canceled
  const dedupeWindowMs = eventType === "subscription_canceled" || eventType === "account_deleted"
    ? 6 * 3600 * 1000
    : 20 * 3600 * 1000;
  const recentEvent = db.prepare(
    `SELECT 1 FROM billing_lifecycle_events WHERE org_id = ? AND event_type = ? AND created_at > ?`
  ).get(orgId, eventType, Date.now() - dedupeWindowMs);

  if (recentEvent) {
    console.log(`[billing-lifecycle] Skipping ${eventType} for org ${orgId} - already sent recently`);
    return;
  }

  // Get period end date from subscription
  const sub = db.prepare(
    `SELECT current_period_end FROM subscriptions WHERE org_id = ? ORDER BY created_at DESC LIMIT 1`
  ).get(orgId) as { current_period_end: number | null } | null;

  // Get deletion date from org
  const orgData = db.prepare("SELECT deletion_scheduled_at FROM orgs WHERE id = ?")
    .get(orgId) as { deletion_scheduled_at: number | null } | null;

  const periodEndDate = sub?.current_period_end
    ? new Date(sub.current_period_end).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : undefined;

  const deletionDate = orgData?.deletion_scheduled_at
    ? new Date(orgData.deletion_scheduled_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : undefined;

  const { subject, htmlBody, plainText } = getBillingEmailHtml(eventType, orgName, { periodEndDate, deletionDate });

  const smtp = getSmtpConfig();
  if (!smtp.host || !smtp.from) {
    console.warn(`[billing-lifecycle] Cannot send ${eventType} email - SMTP not configured`);
    return;
  }

  for (const owner of owners) {
    try {
      const boundary = "----=_BillingEmail_" + randomUUID().replace(/-/g, "");

      let message: string;
      if (pdfAttachment) {
        // Multipart email with attachment
        const pdfBase64 = pdfAttachment.content.toString("base64");
        message = [
          `From: ${smtp.from}`, `To: ${maskEmail(owner.email)}`,
          `Subject: ${subject}`,
          `MIME-Version: 1.0`,
          `Content-Type: multipart/mixed; boundary="${boundary}"`,
          ``,
          `--${boundary}`,
          `Content-Type: multipart/alternative; boundary="${boundary}_alt"`,
          ``,
          `--${boundary}_alt`,
          `Content-Type: text/plain; charset=utf-8`,
          `Content-Transfer-Encoding: 7bit`,
          ``, plainText,
          ``,
          `--${boundary}_alt`,
          `Content-Type: text/html; charset=utf-8`,
          `Content-Transfer-Encoding: 7bit`,
          ``, htmlBody,
          ``,
          `--${boundary}_alt--`,
          ``,
          `--${boundary}`,
          `Content-Type: application/pdf; name="${pdfAttachment.filename}"`,
          `Content-Disposition: attachment; filename="${pdfAttachment.filename}"`,
          `Content-Transfer-Encoding: base64`,
          ``,
          pdfBase64.match(/.{1,76}/g)?.join("\r\n") || "",
          ``,
          `--${boundary}--`,
        ].join("\r\n");
      } else {
        // Simple multipart alternative (HTML + plain text)
        message = [
          `From: ${smtp.from}`, `To: ${maskEmail(owner.email)}`,
          `Subject: ${subject}`,
          `MIME-Version: 1.0`,
          `Content-Type: multipart/alternative; boundary="${boundary}"`,
          ``,
          `--${boundary}`,
          `Content-Type: text/plain; charset=utf-8`,
          `Content-Transfer-Encoding: 7bit`,
          ``, plainText,
          ``,
          `--${boundary}`,
          `Content-Type: text/html; charset=utf-8`,
          `Content-Transfer-Encoding: 7bit`,
          ``, htmlBody,
          ``,
          `--${boundary}--`,
        ].join("\r\n");
      }

      await sendSmtpEmail(smtp.host, smtp.port, smtp.user, smtp.pass, smtp.from, owner.email, message);
      console.log(`[billing-lifecycle] Sent ${eventType} email to ${maskEmail(owner.email)} for org ${orgId}`);

      // Log the event
      db.prepare(`INSERT INTO billing_lifecycle_events (id, org_id, event_type, email_sent_to, created_at) VALUES (?, ?, ?, ?, ?)`)
        .run(randomUUID(), orgId, eventType, owner.email, Date.now());
    } catch (e: any) {
      console.error(`[billing-lifecycle] Failed to send ${eventType} email to ${maskEmail(owner.email)}:`, e.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Generate final consent proof PDF report using Gotenberg
// ---------------------------------------------------------------------------
async function generateFinalConsentReportPdf(orgId: string): Promise<Buffer | null> {
  if (!GOTENBERG_URL) {
    console.warn("[billing-lifecycle] GOTENBERG_URL not configured - cannot generate PDF");
    return null;
  }

  // Get org details
  const org = db.prepare("SELECT name FROM orgs WHERE id = ?").get(orgId) as { name: string | null } | null;
  const orgName = org?.name || "Organization";

  // Get all domains for this org
  const domains = db.prepare(`SELECT domain FROM domain_configs WHERE org_id = ?`).all(orgId) as { domain: string }[];
  const domainList = domains.map(d => d.domain);

  if (domainList.length === 0) {
    console.log(`[billing-lifecycle] No domains found for org ${orgId} - skipping PDF generation`);
    return null;
  }

  // Get consent proof stats
  const ph = domainList.map(() => "?").join(",");
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      MIN(created_at) as first_consent,
      MAX(created_at) as last_consent,
      SUM(CASE WHEN method = 'accept-all' THEN 1 ELSE 0 END) as accept_all,
      SUM(CASE WHEN method = 'reject-all' THEN 1 ELSE 0 END) as reject_all,
      SUM(CASE WHEN method = 'custom' THEN 1 ELSE 0 END) as custom
    FROM consent_proofs WHERE domain IN (${ph})
  `).get(...domainList) as any;

  // Get recent consent samples (last 100)
  const samples = db.prepare(`
    SELECT id, domain, method, categories, created_at FROM consent_proofs
    WHERE domain IN (${ph}) ORDER BY created_at DESC LIMIT 100
  `).all(...domainList) as any[];

  const now = new Date();
  const formatDate = (ts: number) => new Date(ts).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  const htmlContent = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b; padding: 40px; font-size: 12px; }
h1 { color: #0d9488; margin: 0 0 8px; font-size: 24px; }
.subtitle { color: #64748b; margin: 0 0 24px; }
h2 { color: #334155; font-size: 16px; margin: 24px 0 12px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; }
.stats { display: flex; gap: 16px; margin-bottom: 24px; }
.stat { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; flex: 1; text-align: center; }
.stat-value { font-size: 28px; font-weight: 700; color: #0d9488; }
.stat-label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 16px; }
th { background: #f1f5f9; text-align: left; padding: 8px 12px; font-weight: 600; color: #475569; }
td { padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #334155; }
.domains { margin-bottom: 24px; }
.domain-badge { display: inline-block; background: #f0fdfa; color: #0d9488; padding: 4px 12px; border-radius: 4px; margin: 4px; font-weight: 500; }
.footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 10px; }
</style>
</head>
<body>
<h1>Consent Proof History Report</h1>
<p class="subtitle">Final export for ${escHtml(orgName)} — Generated ${now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>

<h2>Domains Covered</h2>
<div class="domains">
${domainList.map(d => `<span class="domain-badge">${escHtml(d)}</span>`).join("")}
</div>

<h2>Summary Statistics</h2>
<div class="stats">
<div class="stat"><div class="stat-value">${(stats.total || 0).toLocaleString()}</div><div class="stat-label">Total Consents</div></div>
<div class="stat"><div class="stat-value">${(stats.accept_all || 0).toLocaleString()}</div><div class="stat-label">Accept All</div></div>
<div class="stat"><div class="stat-value">${(stats.reject_all || 0).toLocaleString()}</div><div class="stat-label">Reject All</div></div>
<div class="stat"><div class="stat-value">${(stats.custom || 0).toLocaleString()}</div><div class="stat-label">Custom</div></div>
</div>

<p><strong>First consent recorded:</strong> ${stats.first_consent ? formatDate(stats.first_consent) : "N/A"}</p>
<p><strong>Last consent recorded:</strong> ${stats.last_consent ? formatDate(stats.last_consent) : "N/A"}</p>

<h2>Recent Consent Records (Last 100)</h2>
<table>
<thead><tr><th>Date</th><th>Domain</th><th>Method</th><th>Categories</th><th>Proof ID</th></tr></thead>
<tbody>
${samples.map((s: any) => `<tr>
<td>${formatDate(s.created_at)}</td>
<td>${escHtml(s.domain)}</td>
<td>${escHtml(s.method)}</td>
<td>${escHtml(s.categories || "-")}</td>
<td style="font-family:monospace;font-size:10px;">${escHtml(s.id.substring(0, 8))}</td>
</tr>`).join("")}
</tbody>
</table>

<div class="footer">
This report was automatically generated by CookieProof upon account closure.
For questions, contact support@brightinteraction.com.<br>
CookieProof by Bright Interaction — GDPR &amp; IMY 2026 Compliant Cookie Consent
</div>
</body>
</html>`;

  try {
    const formData = new FormData();
    formData.append("files", new Blob([htmlContent], { type: "text/html" }), "index.html");

    const pdfRes = await fetch(`${GOTENBERG_URL}/forms/chromium/convert/html`, {
      method: "POST",
      body: formData,
    });

    if (!pdfRes.ok) {
      console.error(`[billing-lifecycle] Gotenberg PDF generation failed: ${pdfRes.status}`);
      return null;
    }

    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
    console.log(`[billing-lifecycle] Generated PDF report for org ${orgId} (${pdfBuffer.length} bytes)`);
    return pdfBuffer;
  } catch (e: any) {
    console.error(`[billing-lifecycle] PDF generation error:`, e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Billing lifecycle checker — runs periodically to handle subscriptions
// ---------------------------------------------------------------------------
let _billingLifecycleRunning = false;
async function runBillingLifecycleCheck(): Promise<void> {
  if (_billingLifecycleRunning) return;
  _billingLifecycleRunning = true;

  try {
    const now = Date.now();
    const DAY_MS = 24 * 3600 * 1000;

    // 1. Check canceled subscriptions approaching period end
    const canceledSubs = db.prepare(`
      SELECT s.*, o.id as org_id, o.name as org_name, o.deletion_scheduled_at
      FROM subscriptions s
      JOIN orgs o ON o.id = s.org_id
      WHERE s.cancel_at_period_end = 1 AND s.status = 'active' AND s.current_period_end IS NOT NULL
    `).all() as any[];

    for (const sub of canceledSubs) {
      const daysUntilEnd = Math.ceil((sub.current_period_end - now) / DAY_MS);

      // Send reminders at 7, 3, and 1 day before period ends
      if (daysUntilEnd <= 7 && daysUntilEnd > 3) {
        await sendBillingLifecycleEmail(sub.org_id, "period_ending_7d");
      } else if (daysUntilEnd <= 3 && daysUntilEnd > 1) {
        await sendBillingLifecycleEmail(sub.org_id, "period_ending_3d");
      } else if (daysUntilEnd === 1) {
        await sendBillingLifecycleEmail(sub.org_id, "period_ending_1d");
      } else if (daysUntilEnd <= 0) {
        // Period has ended — expire the subscription and set up 30-day deletion
        db.prepare(`UPDATE subscriptions SET status = 'canceled', updated_at = ? WHERE id = ?`)
          .run(now, sub.id);
        db.prepare(`UPDATE orgs SET plan = 'expired', deletion_scheduled_at = ? WHERE id = ?`)
          .run(now + 30 * DAY_MS, sub.org_id);

        await sendBillingLifecycleEmail(sub.org_id, "subscription_expired");
        console.log(`[billing-lifecycle] Subscription ${sub.id} expired for org ${sub.org_id}`);
      }
    }

    // 2. Check orgs with scheduled deletions (send reminders)
    const orgsWithDeletion = db.prepare(`
      SELECT id, name, deletion_scheduled_at FROM orgs
      WHERE deletion_scheduled_at IS NOT NULL AND plan = 'expired'
    `).all() as { id: string; name: string | null; deletion_scheduled_at: number }[];

    for (const org of orgsWithDeletion) {
      const daysUntilDeletion = Math.ceil((org.deletion_scheduled_at - now) / DAY_MS);

      if (daysUntilDeletion <= 14 && daysUntilDeletion > 7) {
        await sendBillingLifecycleEmail(org.id, "deletion_warning_14d");
      } else if (daysUntilDeletion <= 7 && daysUntilDeletion > 1) {
        await sendBillingLifecycleEmail(org.id, "deletion_warning_7d");
      } else if (daysUntilDeletion === 1) {
        await sendBillingLifecycleEmail(org.id, "deletion_warning_1d");
      } else if (daysUntilDeletion <= 0) {
        // Time to delete — generate final PDF and send deletion email
        console.log(`[billing-lifecycle] Starting account deletion for org ${org.id}`);

        // Generate final PDF report
        const pdfBuffer = await generateFinalConsentReportPdf(org.id);
        const pdfAttachment = pdfBuffer ? {
          filename: `cookieproof-consent-history-${org.name?.replace(/[^a-zA-Z0-9]/g, "-") || org.id}-final.pdf`,
          content: pdfBuffer,
        } : undefined;

        // Send final email with PDF
        await sendBillingLifecycleEmail(org.id, "account_deleted", pdfAttachment);

        // Delete all org data
        const orgDomains = db.prepare(`SELECT domain FROM domain_configs WHERE org_id = ?`).all(org.id) as { domain: string }[];
        const domainList = orgDomains.map(d => d.domain);

        db.transaction(() => {
          // Delete domain-scoped data
          if (domainList.length > 0) {
            const ph = domainList.map(() => "?").join(",");
            db.prepare(`DELETE FROM consent_proofs WHERE domain IN (${ph})`).run(...domainList);
            db.prepare(`DELETE FROM telemetry_events WHERE domain IN (${ph})`).run(...domainList);
            db.prepare(`DELETE FROM config_fetch_daily WHERE domain IN (${ph})`).run(...domainList);
          }

          // Delete org-scoped data
          db.prepare("DELETE FROM domain_configs WHERE org_id = ?").run(org.id);
          db.prepare("DELETE FROM allowed_domains WHERE org_id = ?").run(org.id);
          db.prepare("DELETE FROM subscriptions WHERE org_id = ?").run(org.id);
          db.prepare("DELETE FROM payments WHERE org_id = ?").run(org.id);
          db.prepare("DELETE FROM alert_log WHERE org_id = ?").run(org.id);
          db.prepare("DELETE FROM billing_lifecycle_events WHERE org_id = ?").run(org.id);
          db.prepare("DELETE FROM scheduled_reports WHERE org_id = ?").run(org.id);
          db.prepare("DELETE FROM invite_tokens WHERE org_id = ?").run(org.id);

          // Remove org members (but keep users — they may belong to other orgs)
          db.prepare("DELETE FROM org_members WHERE org_id = ?").run(org.id);

          // Archive the org instead of deleting (for audit trail)
          db.prepare(`UPDATE orgs SET plan = 'archived', deletion_scheduled_at = NULL, name = ? WHERE id = ?`)
            .run(`[DELETED] ${org.name || org.id}`, org.id);
        })();

        console.log(`[billing-lifecycle] Account deleted for org ${org.id} (${org.name})`);
      }
    }

    // 3. Handle failed payment grace periods (when Mollie webhook marks payment failed)
    const failedPaymentOrgs = db.prepare(`
      SELECT DISTINCT o.id, o.name, o.grace_ends_at
      FROM orgs o
      JOIN subscriptions s ON s.org_id = o.id
      WHERE o.plan = 'grace' AND o.grace_ends_at IS NOT NULL AND o.grace_ends_at < ?
    `).all(now) as { id: string; name: string | null; grace_ends_at: number }[];

    for (const org of failedPaymentOrgs) {
      // Grace period ended without payment — expire and schedule deletion
      db.prepare(`UPDATE orgs SET plan = 'expired', deletion_scheduled_at = ? WHERE id = ?`)
        .run(now + 30 * DAY_MS, org.id);
      db.prepare(`UPDATE subscriptions SET status = 'canceled', updated_at = ? WHERE org_id = ? AND status = 'active'`)
        .run(now, org.id);

      await sendBillingLifecycleEmail(org.id, "subscription_expired");
      console.log(`[billing-lifecycle] Grace period ended for org ${org.id} - marked for deletion`);
    }

    // 4. Clean up expired password reset tokens (older than 24 hours)
    const expiredResetTokens = db.prepare(
      "DELETE FROM password_reset_tokens WHERE (expires_at < ?) OR (used_at IS NOT NULL AND created_at < ?)"
    ).run(now, now - 24 * 3600 * 1000);
    if (expiredResetTokens.changes > 0) {
      console.log(`[billing-lifecycle] Cleaned up ${expiredResetTokens.changes} expired password reset tokens`);
    }

    // 5. Clean up expired email verification tokens (older than 48 hours)
    const expiredVerifyTokens = db.prepare(
      "DELETE FROM email_verification_tokens WHERE (expires_at < ?) OR (used_at IS NOT NULL AND created_at < ?)"
    ).run(now, now - 48 * 3600 * 1000);
    if (expiredVerifyTokens.changes > 0) {
      console.log(`[billing-lifecycle] Cleaned up ${expiredVerifyTokens.changes} expired email verification tokens`);
    }

  } catch (e: any) {
    console.error("[billing-lifecycle] Check failed:", e.message);
  } finally {
    _billingLifecycleRunning = false;
  }
}

// Run billing lifecycle check every 6 hours (starting 10 minutes after boot)
setTimeout(runBillingLifecycleCheck, 10 * 60 * 1000);
setInterval(runBillingLifecycleCheck, 6 * 3600 * 1000);

// ---------------------------------------------------------------------------
// Background Gotenberg health checker (updates _gotenbergStatus every 60s)
// ---------------------------------------------------------------------------
async function checkGotenbergHealth(): Promise<void> {
  try {
    const res = await fetch(`${GOTENBERG_URL}/health`, { signal: AbortSignal.timeout(5000) });
    _gotenbergStatus = res.ok ? "ok" : "error";
  } catch {
    _gotenbergStatus = "error";
  }
}
// First check after 5s, then every 60s
setTimeout(checkGotenbergHealth, 5_000);
setInterval(checkGotenbergHealth, 60_000);

// ---------------------------------------------------------------------------
// Scheduled report runner
// ---------------------------------------------------------------------------
function computeNextRun(frequency: string): number {
  const now = new Date();
  if (frequency === "weekly") {
    const d = new Date(now);
    d.setUTCHours(8, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + ((1 + 7 - d.getUTCDay()) % 7 || 7));
    return d.getTime();
  }
  // monthly
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() + 1, 1);
  d.setUTCHours(8, 0, 0, 0);
  return d.getTime();
}

let _scheduledReportsRunning = false;
async function runScheduledReports(): Promise<void> {
  if (_scheduledReportsRunning) return;
  _scheduledReportsRunning = true;

  try {
    const now = Date.now();
    const dueSchedules = db.prepare(`
      SELECT sr.*, u.email as owner_email FROM scheduled_reports sr
      JOIN users u ON u.id = sr.created_by
      WHERE sr.enabled = 1 AND sr.next_run_at <= ?
        AND u.status != 'archived'
        AND EXISTS (SELECT 1 FROM org_members om WHERE om.org_id = sr.org_id AND om.user_id = sr.created_by)
    `).all(now) as any[];

    for (const schedule of dueSchedules) {
      try {
        const org = db.prepare("SELECT id, name, plan FROM orgs WHERE id = ?")
          .get(schedule.org_id) as { id: string; name: string | null; plan: string } | null;
        if (!org || org.plan === "archived") {
          // Disable schedule for archived orgs
          if (org?.plan === "archived") db.prepare("UPDATE scheduled_reports SET enabled = 0 WHERE id = ?").run(schedule.id);
          continue;
        }

        const periodDays = schedule.frequency === "weekly" ? 7 : 30;
        const fromTs = now - periodDays * 24 * 3600 * 1000;
        const orgName = (org.name || "Organization").replace(/[\r\n]/g, "");
        const safeFilename = orgName.replace(/[^a-zA-Z0-9_-]/g, "_");

        const reportHtml = generateReportHtml({
          orgId: org.id, orgName, orgPlan: org.plan,
          fromTs, toTs: now, agencyUserId: schedule.created_by,
        });

        let reportBase64: string;
        let attachMime = "application/pdf";
        let attachExt = "pdf";
        try {
          const pdfBuffer = await htmlToPdf(reportHtml, CONSENT_FOOTER_HTML);
          reportBase64 = pdfBuffer.toString("base64");
        } catch {
          reportBase64 = Buffer.from(reportHtml).toString("base64");
          attachMime = "text/html; charset=utf-8";
          attachExt = "html";
        }

        const fromDate = new Date(fromTs).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
        const toDate = new Date(now).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
        const boundary = "----=_Scheduled_" + randomUUID().replace(/-/g, "");

        const branding = db.prepare("SELECT brand_name FROM agency_branding WHERE user_id = ?")
          .get(schedule.created_by) as { brand_name: string | null } | null;
        const brandName = (branding?.brand_name || "CookieProof").replace(/[\r\n]/g, "");

        const smtp = getSmtpConfig(schedule.created_by);
        if (!smtp.host || !smtp.from) continue; // Skip if no SMTP available (system or agency)
        const safeRecipient = schedule.recipient_email.replace(/[\r\n]/g, "");
        const schedSubject = `${schedule.frequency === "weekly" ? "Weekly" : "Monthly"} Consent Report: ${orgName} (${fromDate} — ${toDate})`.replace(/[\r\n\t]/g, " ").slice(0, 200);
        const emailBody = [
          `From: ${smtp.from}`, `To: ${safeRecipient}`,
          `Subject: ${schedSubject}`,
          `MIME-Version: 1.0`,
          `Content-Type: multipart/mixed; boundary="${boundary}"`,
          ``, `--${boundary}`,
          `Content-Type: text/plain; charset=utf-8`, `Content-Transfer-Encoding: 7bit`,
          ``, `Hello,`, ``,
          `Please find attached the ${schedule.frequency} consent compliance report for ${orgName}.`,
          `Period: ${fromDate} — ${toDate}`, ``,
          `Best regards,`, `${brandName}`,
          ``, `--${boundary}`,
          `Content-Type: ${attachMime}; name="consent-report-${safeFilename}.${attachExt}"`,
          `Content-Transfer-Encoding: base64`,
          `Content-Disposition: attachment; filename="consent-report-${safeFilename}.${attachExt}"`,
          ``, reportBase64,
          ``, `--${boundary}--`,
        ].join("\r\n");

        await sendSmtpEmail(smtp.host, smtp.port, smtp.user, smtp.pass, smtp.from, safeRecipient, emailBody);

        const nextRun = computeNextRun(schedule.frequency);
        db.prepare("UPDATE scheduled_reports SET last_run_at = ?, next_run_at = ? WHERE id = ?")
          .run(now, nextRun, schedule.id);
        console.log(`[cookieproof-api] Scheduled ${schedule.frequency} report sent for org ${org.id} to ${maskEmail(schedule.recipient_email)}`);
      } catch (e: any) {
        console.error(`[cookieproof-api] Scheduled report failed for ${schedule.id}:`, e.message);
      }
    }
  } catch (e: any) {
    console.error("[cookieproof-api] Scheduled reports runner failed:", e.message);
  } finally {
    _scheduledReportsRunning = false;
  }
}

setTimeout(runScheduledReports, 60 * 1000);
setInterval(runScheduledReports, 60 * 60 * 1000);

// ---------------------------------------------------------------------------
// Webhook helper – fire-and-forget POST when a new consent proof is recorded
// ---------------------------------------------------------------------------
// Validate webhook URL once at startup (not on every call)
let webhookValidated = false;
if (WEBHOOK_URL) {
  try {
    const parsed = new URL(WEBHOOK_URL);
    if (parsed.protocol !== "https:" && process.env.NODE_ENV === "production") {
      console.warn("[cookieproof-api] WEBHOOK_URL should use HTTPS in production to protect the secret.");
    }
    if (isPrivateHost(parsed.hostname)) {
      console.error("[cookieproof-api] WEBHOOK_URL points to a private/internal address. Webhooks disabled.");
    } else {
      webhookValidated = true;
    }
  } catch {
    console.error("[cookieproof-api] WEBHOOK_URL is not a valid URL. Webhooks disabled.");
  }
}

function fireWebhook(proof: { id: string; domain: string; url: string; method: string; categories: Record<string, boolean>; timestamp: number }): void {
  if (!WEBHOOK_URL || !webhookValidated) return;
  try {
    const body = JSON.stringify({ event: "consent.recorded", data: proof, timestamp: Date.now() });
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (WEBHOOK_SECRET) {
      headers["X-Webhook-Signature"] = createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
    }
    const controller = new AbortController();
    const webhookTimeout = setTimeout(() => controller.abort(), 10_000);
    fetch(WEBHOOK_URL, {
      method: "POST",
      headers,
      body,
      redirect: "manual",
      signal: controller.signal,
    }).then(res => {
      if (!res.ok) console.warn(`[webhook] POST failed: ${res.status} ${res.statusText}`);
    }).catch((err) => {
      if (err?.name !== 'AbortError') {
        console.warn(`[webhook] POST error: ${err?.message || 'unknown'}`);
      }
    }).finally(() => clearTimeout(webhookTimeout));
  } catch (e: any) { console.warn(`[webhook] Error: ${e?.message || 'unknown'}`); }
}

// ---------------------------------------------------------------------------
// Customer webhook helper – triggers webhooks configured by customers per-org
// ---------------------------------------------------------------------------
function fireCustomerWebhooks(
  orgId: string,
  eventType: string,
  payload: Record<string, any>
): void {
  try {
    const webhooks = db.prepare(
      "SELECT id, url, secret, events FROM webhooks WHERE org_id = ? AND enabled = 1"
    ).all(orgId) as { id: string; url: string; secret: string | null; events: string }[];

    for (const webhook of webhooks) {
      // Check if webhook is subscribed to this event
      let events: string[];
      try {
        events = JSON.parse(webhook.events);
      } catch {
        events = ["consent.recorded"];
      }
      if (!events.includes(eventType) && !events.includes("*")) continue;

      // Validate URL isn't internal
      try {
        const parsed = new URL(webhook.url);
        if (isPrivateHost(parsed.hostname)) {
          console.warn(`[customer-webhook] Skipping ${webhook.id}: URL points to private address`);
          continue;
        }
      } catch {
        continue;
      }

      const body = JSON.stringify({
        event: eventType,
        data: payload,
        timestamp: Date.now(),
        webhook_id: webhook.id,
      });
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (webhook.secret) {
        headers["X-Webhook-Signature"] = createHmac("sha256", webhook.secret).update(body).digest("hex");
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      fetch(webhook.url, {
        method: "POST",
        headers,
        body,
        redirect: "manual",
        signal: controller.signal,
      }).then(res => {
        const now = Date.now();
        if (res.ok) {
          db.prepare(
            "UPDATE webhooks SET last_triggered_at = ?, last_status = ?, failure_count = 0 WHERE id = ?"
          ).run(now, res.status, webhook.id);
        } else {
          const failures = (db.prepare("SELECT failure_count FROM webhooks WHERE id = ?")
            .get(webhook.id) as { failure_count: number } | null)?.failure_count || 0;
          db.prepare(
            "UPDATE webhooks SET last_triggered_at = ?, last_status = ?, failure_count = ? WHERE id = ?"
          ).run(now, res.status, failures + 1, webhook.id);
          // Auto-disable after 10 consecutive failures
          if (failures >= 9) {
            db.prepare("UPDATE webhooks SET enabled = 0 WHERE id = ?").run(webhook.id);
            console.warn(`[customer-webhook] Disabled ${webhook.id} after 10 consecutive failures`);
          }
        }
      }).catch(err => {
        if (err?.name !== "AbortError") {
          const failures = (db.prepare("SELECT failure_count FROM webhooks WHERE id = ?")
            .get(webhook.id) as { failure_count: number } | null)?.failure_count || 0;
          db.prepare(
            "UPDATE webhooks SET last_triggered_at = ?, last_status = 0, failure_count = ? WHERE id = ?"
          ).run(Date.now(), failures + 1, webhook.id);
          if (failures >= 9) {
            db.prepare("UPDATE webhooks SET enabled = 0 WHERE id = ?").run(webhook.id);
            console.warn(`[customer-webhook] Disabled ${webhook.id} after 10 consecutive failures`);
          }
        }
      }).finally(() => clearTimeout(timeout));
    }
  } catch (e: any) {
    console.warn(`[customer-webhook] Error: ${e?.message || 'unknown'}`);
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "default-src 'none'",
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      ...headers,
    },
  });
}

function cors(res: Response, origin: string): Response {
  // Always set Vary: Origin to prevent CDN/proxy cache poisoning
  res.headers.set("Vary", "Origin");

  // If allowed origins exist (env + DB), only reflect the origin when it is
  // in the allow-list. If none configured, restrict to same-origin only in
  // production (no CORS headers = browser blocks cross-origin).
  let allowedOrigin: string;
  const allowedOrigins = getAllowedOrigins();
  if (allowedOrigins.length > 0) {
    if (allowedOrigins.includes(origin)) {
      allowedOrigin = origin;
    } else {
      // Origin not allowed – return response without CORS headers so the
      // browser blocks the cross-origin request.
      return res;
    }
  } else if (process.env.NODE_ENV === "production") {
    // In production with no allow-list, block cross-origin requests
    return res;
  } else {
    allowedOrigin = origin;
  }

  res.headers.set("Access-Control-Allow-Origin", allowedOrigin);
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", `Content-Type, Authorization, ${CSRF_HEADER_NAME}`);
  res.headers.set("Access-Control-Allow-Credentials", "true");
  return res;
}

// Helper to create auth response with httpOnly cookie + CSRF token
function authResponse(
  data: Record<string, unknown>,
  token: string,
  origin: string,
  status: number = 200
): Response {
  const csrfToken = generateCsrfToken();
  const res = json({ ...data, csrf_token: csrfToken }, status, {
    "Set-Cookie": buildAuthCookie(token),
  });
  // Add CSRF cookie as second Set-Cookie (need to append)
  res.headers.append("Set-Cookie", buildCsrfCookie(csrfToken));
  return cors(res, origin);
}

// Helper to create logout response (clears cookies)
function logoutResponse(origin: string): Response {
  const res = json({ ok: true }, 200, {
    "Set-Cookie": buildClearAuthCookie(),
  });
  // Also clear CSRF cookie
  res.headers.append("Set-Cookie", `${CSRF_COOKIE_NAME}=; Path=/; Max-Age=0${COOKIE_SECURE ? "; Secure" : ""}`);
  return cors(res, origin);
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

type AuthContext = {
  type: "jwt";
  userId: string;
  orgId: string;
  email: string;
  role: "owner" | "member";
  accountType: "user" | "agency" | "admin" | "super_admin";
} | {
  type: "apikey";
};

function getAuthContext(req: Request): AuthContext | null {
  // Try Authorization header first (for API clients and backwards compat)
  let token: string | null = null;
  const raw = req.headers.get("Authorization");
  if (raw && raw.startsWith("Bearer ")) {
    token = raw.slice(7);
  }

  // Fall back to httpOnly cookie (for browser sessions)
  if (!token) {
    const cookies = parseCookies(req);
    token = cookies[COOKIE_NAME] || null;
  }

  if (!token) return null;

  // Try JWT first (tokens with dots are JWTs)
  if (token.includes(".")) {
    const payload = verifyJwt(token);
    if (payload && payload.sub) {
      // Reject JWTs with stale token_version (bumped on password change)
      const userRow = db.prepare("SELECT token_version, account_type, status FROM users WHERE id = ?").get(payload.sub as string) as { token_version: number | null; account_type: string; status: string } | null;
      if (!userRow || userRow.status === 'archived') return null;
      const dbTv = userRow.token_version ?? 0;
      const jwtTv = typeof payload.tv === "number" ? payload.tv : 0;
      if (jwtTv !== dbTv) return null;

      const accountType = (userRow.account_type || "user") as "user" | "agency" | "admin" | "super_admin";
      const jwtOrgId = payload.org_id as string | undefined;

      // 1. If JWT carries org_id, try that specific org first
      if (jwtOrgId) {
        const membership = db.prepare(
          "SELECT org_id, role FROM org_members WHERE user_id = ? AND org_id = ?"
        ).get(payload.sub as string, jwtOrgId) as { org_id: string; role: string } | null;
        if (membership) {
          return {
            type: "jwt",
            userId: payload.sub as string,
            orgId: membership.org_id,
            email: (payload.email as string) || "",
            role: membership.role as "owner" | "member",
            accountType,
          };
        }
        // Admin/super_admin override: view any org even without membership
        if (accountType === "admin" || accountType === "super_admin") {
          const orgExists = db.prepare("SELECT 1 FROM orgs WHERE id = ?").get(jwtOrgId);
          if (orgExists) {
            return {
              type: "jwt",
              userId: payload.sub as string,
              orgId: jwtOrgId,
              email: (payload.email as string) || "",
              role: "owner", // virtual owner role for admin
              accountType,
            };
          }
        }
      }

      // 2. Fallback: first membership (backwards compat for old JWTs without org_id)
      const membership = db.prepare(
        "SELECT org_id, role FROM org_members WHERE user_id = ? ORDER BY role = 'owner' DESC, rowid ASC LIMIT 1"
      ).get(payload.sub as string) as { org_id: string; role: string } | null;
      if (membership) {
        return {
          type: "jwt",
          userId: payload.sub as string,
          orgId: membership.org_id,
          email: (payload.email as string) || "",
          role: membership.role as "owner" | "member",
          accountType,
        };
      }
      return null;
    }
  }

  // Constant-time comparison against env var to prevent timing oracle
  if (ENV_API_KEY) {
    try {
      if (timingSafeEqual(Buffer.from(token), Buffer.from(ENV_API_KEY)))
        return { type: "apikey" };
    } catch {
      // Length mismatch — fall through to DB check
    }
  }

  // Check DB-stored key by hash (comparison done in SQLite, not JS)
  const hash = hashKey(token);
  const row = db.prepare(
    "SELECT 1 FROM api_keys WHERE key_hash = ? AND is_active = 1"
  ).get(hash);
  if (row) return { type: "apikey" };
  return null;
}

function requireAuth(req: Request): boolean {
  return getAuthContext(req) !== null;
}

// SECURITY: Get auth context with CSRF validation for state-changing requests
// Returns null if auth fails OR if CSRF validation fails for JWT sessions
// API key auth doesn't need CSRF (it's bearer token based, not cookie-based)
function getAuthContextWithCsrf(req: Request): AuthContext | null {
  const ctx = getAuthContext(req);
  if (!ctx) return null;

  // API key auth is stateless/bearer - no CSRF needed
  if (ctx.type === "apikey") return ctx;

  // JWT cookie auth requires CSRF validation for state-changing methods
  const method = req.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    if (!validateCsrf(req)) {
      console.warn("[cookieproof-api] CSRF validation failed for JWT session");
      return null;
    }
  }

  return ctx;
}

function isSuperAdmin(ctx: AuthContext | null): boolean {
  return ctx !== null && ctx.type === "jwt" && ctx.accountType === "super_admin";
}

function isAdmin(ctx: AuthContext | null): boolean {
  return ctx !== null && ctx.type === "jwt" && (ctx.accountType === "admin" || ctx.accountType === "super_admin");
}

function isAgencyOrAdmin(ctx: AuthContext | null): boolean {
  return ctx !== null && ctx.type === "jwt" && (ctx.accountType === "agency" || ctx.accountType === "admin" || ctx.accountType === "super_admin");
}

function getOrgFilter(ctx: AuthContext): string | null {
  return ctx.type === "jwt" ? ctx.orgId : null;
}

type OrgPlanStatus = {
  plan: "trial" | "active" | "grace" | "expired" | "archived";
  daysLeft?: number;
};

function getOrgPlanStatus(orgId: string): OrgPlanStatus {
  const org = db.prepare("SELECT plan, trial_ends_at, grace_ends_at FROM orgs WHERE id = ?")
    .get(orgId) as { plan: string; trial_ends_at: number | null; grace_ends_at: number | null } | null;
  if (!org) return { plan: "expired" };

  if (org.plan === "archived") return { plan: "archived" };
  if (org.plan === "active") return { plan: "active" };
  if (org.plan === "expired") return { plan: "expired" };

  // Trial logic
  if (org.plan === "trial") {
    const now = Date.now();
    if (org.trial_ends_at && now < org.trial_ends_at) {
      const daysLeft = Math.ceil((org.trial_ends_at - now) / (24 * 3600 * 1000));
      return { plan: "trial", daysLeft };
    }
    if (org.grace_ends_at && now < org.grace_ends_at) {
      const daysLeft = Math.ceil((org.grace_ends_at - now) / (24 * 3600 * 1000));
      return { plan: "grace", daysLeft };
    }
    // Auto-expire
    db.prepare("UPDATE orgs SET plan = 'expired' WHERE id = ?").run(orgId);
    return { plan: "expired" };
  }

  return { plan: "active" };
}

/** Get the set of domains owned by an org (for scoping proof queries) */
const MAX_ORG_DOMAINS = 500;
function getOrgDomains(orgId: string): string[] {
  return (db.prepare("SELECT domain FROM domain_configs WHERE org_id = ? LIMIT ?").all(orgId, MAX_ORG_DOMAINS) as { domain: string }[]).map(d => d.domain);
}

/** Check if a specific domain belongs to the given org */
function isOrgDomain(orgId: string, domain: string): boolean {
  const row = db.prepare("SELECT 1 FROM domain_configs WHERE domain = ? AND org_id = ?").get(domain, orgId);
  return !!row;
}

// ---------------------------------------------------------------------------
// Alert computation (reusable by dashboard + background checker)
// ---------------------------------------------------------------------------
type AlertType = "stale_config" | "no_activity" | "low_acceptance" | "trial_expiring" | "proof_gap";

function computeOrgAlerts(orgId: string): { type: AlertType; message: string }[] {
  const now = Date.now();
  const DAY_MS = 24 * 3600 * 1000;
  const alerts: { type: AlertType; message: string }[] = [];

  // Check which alert types have been dismissed in the last 24 hours
  const dismissedRows = db.prepare(
    `SELECT DISTINCT alert_type FROM alert_log WHERE org_id = ? AND created_at >= ?`
  ).all(orgId, now - DAY_MS) as { alert_type: string }[];
  const dismissedTypes = new Set(dismissedRows.map(r => r.alert_type));

  const domains = db.prepare("SELECT domain, updated_at FROM domain_configs WHERE org_id = ?")
    .all(orgId) as { domain: string; updated_at: number }[];
  const domainNames = domains.map(d => d.domain);
  const lastConfigUpdate = domains.length > 0 ? Math.max(...domains.map(d => d.updated_at)) : null;

  if (lastConfigUpdate && (now - lastConfigUpdate) > 30 * DAY_MS) {
    alerts.push({ type: "stale_config", message: "Config not updated in 30+ days" });
  }

  if (domainNames.length > 0) {
    const ph = domainNames.map(() => "?").join(",");
    const recent = db.prepare(`SELECT 1 FROM consent_proofs WHERE domain IN (${ph}) AND created_at >= ? LIMIT 1`)
      .get(...domainNames, now - 7 * DAY_MS);
    if (!recent) alerts.push({ type: "no_activity", message: "No recent activity" });

    const stats = db.prepare(`
      SELECT COUNT(*) as total,
        COALESCE(SUM(CASE WHEN method = 'accept-all' THEN 1 ELSE 0 END), 0) as accept_all
      FROM consent_proofs WHERE domain IN (${ph}) AND created_at >= ?
    `).get(...domainNames, now - 30 * DAY_MS) as { total: number; accept_all: number };
    if (stats.total > 0 && stats.accept_all / stats.total < 0.5) {
      alerts.push({ type: "low_acceptance", message: "Low acceptance rate" });
    }

    // Proof gap: config loads (demand) vs proof count (supply) over last 7 days
    const sevenDaysAgo = new Date(now - 7 * DAY_MS).toISOString().slice(0, 10);
    const fetchSum = db.prepare(
      `SELECT COALESCE(SUM(fetch_count), 0) as total FROM config_fetch_daily WHERE domain IN (${ph}) AND day >= ?`
    ).get(...domainNames, sevenDaysAgo) as { total: number };
    const proofCount = db.prepare(
      `SELECT COUNT(*) as total FROM consent_proofs WHERE domain IN (${ph}) AND created_at >= ?`
    ).get(...domainNames, now - 7 * DAY_MS) as { total: number };

    if (fetchSum.total >= 100 && proofCount.total < Math.max(5, fetchSum.total * 0.05)) {
      alerts.push({
        type: "proof_gap",
        message: `Proof gap: ${fetchSum.total} config loads but only ${proofCount.total} proofs in 7 days`,
      });
    }
  }

  const ps = getOrgPlanStatus(orgId);
  if (ps.plan === "trial" && ps.daysLeft !== undefined && ps.daysLeft <= 3) {
    alerts.push({ type: "trial_expiring", message: "Trial expiring soon" });
  }

  // Filter out alerts that were dismissed in the last 24 hours
  return alerts.filter(a => !dismissedTypes.has(a.type));
}

// ---------------------------------------------------------------------------
// Org health score (0-100)
// ---------------------------------------------------------------------------
function computeHealthScore(orgId: string): number {
  let score = 0;
  const now = Date.now();
  const DAY_MS = 24 * 3600 * 1000;

  const domains = db.prepare("SELECT domain, updated_at FROM domain_configs WHERE org_id = ?")
    .all(orgId) as { domain: string; updated_at: number }[];

  // Banner deployed: 20 pts
  if (domains.length > 0) score += 20;

  // Config freshness: 20 pts (14d=20, 30d=10)
  if (domains.length > 0) {
    const maxUpdate = Math.max(...domains.map(d => d.updated_at));
    const daysSince = (now - maxUpdate) / DAY_MS;
    if (daysSince <= 14) score += 20;
    else if (daysSince <= 30) score += 10;
  }

  const domainNames = domains.map(d => d.domain);
  if (domainNames.length > 0) {
    const ph = domainNames.map(() => "?").join(",");

    // Recent consents (7d): 20 pts
    const recentCount = (db.prepare(`SELECT COUNT(*) as c FROM consent_proofs WHERE domain IN (${ph}) AND created_at >= ?`)
      .get(...domainNames, now - 7 * DAY_MS) as any).c;
    if (recentCount > 10) score += 20;
    else if (recentCount > 0) score += 10;

    // Acceptance rate (30d): 20 pts
    const stats = db.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN method = 'accept-all' THEN 1 ELSE 0 END) as accept_all
      FROM consent_proofs WHERE domain IN (${ph}) AND created_at >= ?
    `).get(...domainNames, now - 30 * DAY_MS) as { total: number; accept_all: number };
    if (stats.total > 0) {
      const rate = stats.accept_all / stats.total;
      if (rate >= 0.7) score += 20;
      else if (rate >= 0.5) score += 15;
      else if (rate >= 0.3) score += 10;
    }
  }

  // Categories configured: 20 pts
  try {
    const firstConfig = db.prepare("SELECT config FROM domain_configs WHERE org_id = ? LIMIT 1")
      .get(orgId) as { config: string } | null;
    if (firstConfig) {
      const cats = (JSON.parse(firstConfig.config).categories || []).filter((c: any) => c.enabled !== false);
      if (cats.length >= 3) score += 20;
      else if (cats.length >= 1) score += 10;
    }
  } catch {}

  return score;
}

// TRUST_PROXY should be enabled when behind a reverse proxy (Traefik, nginx, etc.)
// Default to true if not explicitly set to "false" - safer for most deployments
const TRUST_PROXY = process.env.TRUST_PROXY !== "false";

function clientIp(req: Request): string {
  if (TRUST_PROXY) {
    // X-Real-IP is set by the reverse proxy and is trusted
    const realIp = req.headers.get("X-Real-IP")?.trim();
    if (realIp && realIp.length <= 45 && /^[\da-fA-F.:]+$/.test(realIp)) return realIp;
    // X-Forwarded-For: use leftmost entry (original client IP)
    // When behind a single trusted proxy, leftmost is the real client
    // Format: client, proxy1, proxy2, ... (leftmost = original)
    const xff = req.headers.get("X-Forwarded-For");
    if (xff) {
      const parts = xff.split(",").map(s => s.trim()).filter(Boolean);
      if (parts.length && parts[0].length <= 45 && /^[\da-fA-F.:]+$/.test(parts[0])) {
        return parts[0];
      }
    }
    // Cloudflare-specific header
    const cfIp = req.headers.get("CF-Connecting-IP")?.trim();
    if (cfIp && cfIp.length <= 45 && /^[\da-fA-F.:]+$/.test(cfIp)) return cfIp;
  }
  // Fallback: generate a unique identifier per request to still enable some rate limiting
  // This is not ideal but better than grouping all requests as "unknown"
  const fallbackId = req.headers.get("User-Agent")?.slice(0, 50) || "direct";
  return `unknown-${fallbackId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20)}`;
}

// SECURITY: Hash IP addresses before storage to protect user privacy (GDPR PII)
// Uses first 16 chars of SHA-256 hash - enough for analytics, not reversible
function hashIpForStorage(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Audit log helper
// ---------------------------------------------------------------------------
type AuditAction =
  | "login"
  | "login_failed"
  | "logout"
  | "register"
  | "password_change"
  | "password_reset"
  | "2fa_enable"
  | "2fa_disable"
  | "2fa_backup_used"
  | "email_verified"
  | "email_prefs_update"
  | "display_name_update"
  | "team_invite"
  | "team_join"
  | "team_remove"
  | "org_create"
  | "org_delete"
  | "domain_add"
  | "domain_remove"
  | "config_update"
  | "account_delete"
  | "api_key_generate"
  | "api_key_revoke"
  | "webhook_create"
  | "webhook_delete"
  | "data_export"
  | "admin_subscription_update";

function logAuditEvent(
  userId: string,
  action: AuditAction,
  details?: Record<string, any>,
  req?: Request,
  orgId?: string
): void {
  try {
    const ip = req ? clientIp(req) : null;
    const ua = req ? (req.headers.get("user-agent") || null) : null;
    db.prepare(`
      INSERT INTO audit_log (id, user_id, org_id, action, details, ip_address, user_agent, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      userId,
      orgId || null,
      action,
      details ? JSON.stringify(details) : null,
      ip ? hashIpForStorage(ip) : null, // SECURITY: Hash IP for privacy protection
      ua?.substring(0, 500) || null,
      Date.now()
    );
  } catch (e: any) {
    console.error(`[cookieproof-api] Audit log error: ${e?.message}`);
  }
}

// ---------------------------------------------------------------------------
// Prepare the domain parameter for LIKE queries.
// When the caller passes a specific domain we do an exact match (escaped).
// When no domain is provided we use the bare "%" wildcard to match all rows.
// ---------------------------------------------------------------------------
function domainParam(raw: string | null): string {
  if (!raw) return "%";
  // Never allow raw wildcards — always escape user input
  return escapeLike(raw);
}

// ---------------------------------------------------------------------------
// CSV helper
// ---------------------------------------------------------------------------
function csvEscape(value: string): string {
  // Prevent formula injection in spreadsheet applications (Excel, Sheets, LibreOffice)
  // Covers: = + - @ TAB CR LF | % (some apps treat | and % as formula triggers)
  if (/^[=+\-@\t\r\n|%]/.test(value)) {
    value = "'" + value;
  }
  if (/[",\n\r]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** HTML-escape for server-side report generation */
function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Escape string for use in HTML attributes (href, src, etc.) */
function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Generate a branded HTML consent compliance report */
function generateReportHtml(opts: {
  orgId: string; orgName: string; orgPlan: string;
  fromTs: number; toTs: number; agencyUserId: string;
}): string {
  const orgDomains = getOrgDomains(opts.orgId);
  let consentStats = { total: 0, accept_all: 0, reject_all: 0, custom: 0 };
  let dailyStats: { day: string; count: number }[] = [];

  if (orgDomains.length > 0) {
    const ph = orgDomains.map(() => "?").join(",");
    consentStats = db.prepare(`
      SELECT COUNT(*) as total,
        COALESCE(SUM(CASE WHEN method = 'accept-all' THEN 1 ELSE 0 END), 0) as accept_all,
        COALESCE(SUM(CASE WHEN method = 'reject-all' THEN 1 ELSE 0 END), 0) as reject_all,
        COALESCE(SUM(CASE WHEN method NOT IN ('accept-all', 'reject-all') THEN 1 ELSE 0 END), 0) as custom
      FROM consent_proofs WHERE domain IN (${ph}) AND created_at >= ? AND created_at <= ?
    `).get(...orgDomains, opts.fromTs, opts.toTs) as any;

    dailyStats = db.prepare(`
      SELECT date(created_at / 1000, 'unixepoch') as day, COUNT(*) as count
      FROM consent_proofs WHERE domain IN (${ph}) AND created_at >= ? AND created_at <= ?
      GROUP BY day ORDER BY day
    `).all(...orgDomains, opts.fromTs, opts.toTs) as any[];
  }

  let categories: { id: string; enabled: boolean }[] = [];
  let ccpaEnabled = false;
  if (orgDomains.length > 0) {
    try {
      const firstConfig = db.prepare("SELECT config FROM domain_configs WHERE org_id = ? LIMIT 1").get(opts.orgId) as { config: string } | null;
      if (firstConfig) {
        const parsed = JSON.parse(firstConfig.config);
        categories = (parsed.categories || []).map((c: any) => ({ id: c.id, enabled: c.enabled !== false }));
        ccpaEnabled = !!parsed.ccpaEnabled;
      }
    } catch {}
  }

  const branding = db.prepare("SELECT logo_b64, logo_mime, brand_name, brand_color FROM agency_branding WHERE user_id = ?")
    .get(opts.agencyUserId) as { logo_b64: string | null; logo_mime: string | null; brand_name: string | null; brand_color: string | null } | null;

  const acceptanceRate = consentStats.total > 0 ? Math.round((consentStats.accept_all / consentStats.total) * 100) : 0;
  const rawColor = branding?.brand_color || "#0d9488";
  const brandColor = /^#[0-9a-fA-F]{6}$/.test(rawColor) ? rawColor : "#0d9488";
  const brandName = (branding?.brand_name || "CookieProof").replace(/[\r\n]/g, "");
  const safeMime = /^image\/(png|jpeg|webp)$/.test(branding?.logo_mime ?? "") ? branding!.logo_mime : "image/png";
  const logoHtml = branding?.logo_b64 && branding.logo_mime
    ? `<img src="data:${safeMime};base64,${branding.logo_b64}" style="max-height:48px;max-width:200px;" />`
    : `<div style="font-size:20px;font-weight:700;color:${brandColor};">${escHtml(brandName)}</div>`;

  const fromDate = new Date(opts.fromTs).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const toDate = new Date(opts.toTs).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const generatedDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  let chartSvg = "";
  if (dailyStats.length > 0) {
    const maxCount = Math.max(...dailyStats.map(d => d.count), 1);
    const barWidth = Math.max(4, Math.floor(500 / dailyStats.length) - 2);
    const bars = dailyStats.map((d, i) => {
      const h = Math.max(2, Math.round((d.count / maxCount) * 150));
      return `<rect x="${i * (barWidth + 2)}" y="${160 - h}" width="${barWidth}" height="${h}" fill="${brandColor}" rx="2"/>`;
    }).join("");
    const svgW = dailyStats.length * (barWidth + 2);
    chartSvg = `<svg width="${svgW}" height="170" viewBox="0 0 ${svgW} 170" style="display:block;margin:0 auto;">${bars}</svg>`;
  }

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Consent Report — ${escHtml(opts.orgName)}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;color:#1e293b;font-size:14px;line-height:1.6;background:#f8fafc;}
  .wrap{max-width:720px;margin:0 auto;background:#fff;}
  .header{padding:32px 40px;border-bottom:3px solid ${brandColor};display:flex;justify-content:space-between;align-items:center;}
  .content{padding:32px 40px;}
  h1{font-size:24px;font-weight:700;margin:0 0 4px;}
  h2{font-size:16px;font-weight:600;margin:32px 0 12px;color:${brandColor};letter-spacing:0.3px;text-transform:uppercase;font-size:13px;}
  .subtitle{font-size:13px;color:#64748b;margin:0;}
  .stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0 24px;}
  .stat-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;text-align:center;}
  .stat-val{font-size:28px;font-weight:700;color:${brandColor};}
  .stat-lbl{font-size:11px;color:#64748b;margin-top:4px;text-transform:uppercase;letter-spacing:0.3px;}
  table{width:100%;border-collapse:collapse;margin:12px 0;}
  th,td{padding:10px 16px;text-align:left;border-bottom:1px solid #e2e8f0;font-size:13px;}
  th{background:#f8fafc;font-weight:600;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:0.3px;}
  td:nth-child(2),th:nth-child(2){text-align:right;}
  td:nth-child(3),th:nth-child(3){text-align:right;}
  .badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;}
  .badge-active{background:#dcfce7;color:#166534;} .badge-trial{background:#fef9c3;color:#854d0e;}
  .footer{padding:24px 40px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center;}
  .chart-container{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:12px 0;text-align:center;overflow-x:auto;}
  body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .section{page-break-inside:avoid;break-inside:avoid;}
  .no-break{page-break-inside:avoid;break-inside:avoid;}
  h2{page-break-after:avoid;break-after:avoid;}
  @media print{body{background:#fff;}.wrap{max-width:none;}.header{padding:20px 24px;}.content{padding:20px 24px;}.stat-val{font-size:22px;}}
</style></head><body>
<div class="wrap">
<div class="header">
  ${logoHtml}
  <div style="text-align:right;">
    <div style="font-size:12px;color:#64748b;">Consent Compliance Report</div>
    <div style="font-size:11px;color:#94a3b8;">Generated ${generatedDate}</div>
  </div>
</div>
<div class="content">
  <h1>${escHtml(opts.orgName)}</h1>
  <p class="subtitle">Period: ${fromDate} — ${toDate}</p>
  <h2>Summary</h2>
  <div class="stats-grid no-break">
    <div class="stat-box"><div class="stat-val">${consentStats.total.toLocaleString()}</div><div class="stat-lbl">Total Consents</div></div>
    <div class="stat-box"><div class="stat-val">${acceptanceRate}%</div><div class="stat-lbl">Acceptance Rate</div></div>
    <div class="stat-box"><div class="stat-val">${orgDomains.length}</div><div class="stat-lbl">Domains</div></div>
    <div class="stat-box"><div class="stat-val">${categories.filter(c => c.enabled).length}</div><div class="stat-lbl">Active Categories</div></div>
  </div>
  ${chartSvg ? `<div class="section"><h2>Daily Consent Activity</h2><div class="chart-container no-break">${chartSvg}</div></div>` : ""}
  <div class="section">
  <h2>Consent Breakdown</h2>
  <table>
    <thead><tr><th>Action</th><th>Count</th><th>Percentage</th></tr></thead>
    <tbody>
      <tr><td>Accept All</td><td>${consentStats.accept_all.toLocaleString()}</td><td>${consentStats.total > 0 ? Math.round(consentStats.accept_all / consentStats.total * 100) : 0}%</td></tr>
      <tr><td>Reject All</td><td>${consentStats.reject_all.toLocaleString()}</td><td>${consentStats.total > 0 ? Math.round(consentStats.reject_all / consentStats.total * 100) : 0}%</td></tr>
      <tr><td>Custom Selection</td><td>${consentStats.custom.toLocaleString()}</td><td>${consentStats.total > 0 ? Math.round(consentStats.custom / consentStats.total * 100) : 0}%</td></tr>
    </tbody>
  </table>
  </div>
  <div class="section">
  <h2>Domain Configuration</h2>
  <table>
    <thead><tr><th>Domain</th><th>Status</th></tr></thead>
    <tbody>
      ${orgDomains.map(d => `<tr><td>${escHtml(d)}</td><td><span class="badge badge-active">Active</span></td></tr>`).join("") || '<tr><td colspan="2" style="color:#94a3b8;">No domains configured</td></tr>'}
    </tbody>
  </table>
  </div>
  <div class="section">
  <h2>Category Configuration</h2>
  <table>
    <thead><tr><th>Category</th><th>Status</th></tr></thead>
    <tbody>
      ${categories.map(c => `<tr><td>${escHtml(c.id)}</td><td>${c.enabled ? "Enabled" : "Disabled"}</td></tr>`).join("") || '<tr><td colspan="2" style="color:#94a3b8;">No categories configured</td></tr>'}
      <tr><td>CCPA / Do Not Sell</td><td>${ccpaEnabled ? "Enabled" : "Disabled"}</td></tr>
    </tbody>
  </table>
  </div>
  <div class="section">
  <h2>Compliance Status</h2>
  <table>
    <thead><tr><th>Check</th><th>Status</th></tr></thead>
    <tbody>
      <tr><td>Consent banner deployed</td><td>${orgDomains.length > 0 ? "✓ Yes" : "✗ No"}</td></tr>
      <tr><td>Proof of consent collected</td><td>${consentStats.total > 0 ? "✓ Yes" : "✗ No"}</td></tr>
      <tr><td>Reject option available</td><td>${consentStats.reject_all > 0 ? "✓ Yes" : "⚠ Not observed"}</td></tr>
      <tr><td>CCPA compliance</td><td>${ccpaEnabled ? "✓ Enabled" : "— Not enabled"}</td></tr>
    </tbody>
  </table>
  </div>
</div>
<div class="footer">
  ${escHtml(brandName)} — Consent Compliance Report &mdash; Confidential
</div>
</div>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Gotenberg PDF conversion
// ---------------------------------------------------------------------------
const CONSENT_FOOTER_HTML = `<html><head><style>
@page{margin:0;}html,body{margin:0;padding:0;width:100%;font-family:-apple-system,sans-serif;}
table{width:100%;border-collapse:collapse;border-top:1px solid #E5E7EB;}
td{text-align:center;padding:8px 10mm 0;font-size:7px;letter-spacing:0.3px;}
.brand{letter-spacing:2px;text-transform:uppercase;font-weight:600;color:#2B3A5C;}
</style></head><body>
<table><tr><td>
<span class="brand">CookieProof</span>
<span>&middot;</span>
<span>consent.brightinteraction.com</span>
<span>&middot;</span>
<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
</td></tr></table>
</body></html>`;

async function htmlToPdf(html: string, footerHtml?: string): Promise<Buffer> {
  const form = new FormData();

  // Main HTML file
  form.append("files", new Blob([html], { type: "text/html" }), "index.html");

  // Footer (Gotenberg v8 identifies it by filename "footer.html")
  if (footerHtml) {
    form.append("files", new Blob([footerHtml], { type: "text/html" }), "footer.html");
  }

  // A4 paper settings (generous margins for clean look)
  form.append("paperWidth", "8.27");
  form.append("paperHeight", "11.69");
  form.append("marginTop", "0.75");
  form.append("marginBottom", footerHtml ? "0.75" : "0.5");
  form.append("marginLeft", "1.0");
  form.append("marginRight", "1.0");
  form.append("printBackground", "true");
  form.append("preferCssPageSize", "false");

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30_000);
  let resp: Response;
  try {
    resp = await fetch(`${GOTENBERG_URL}/forms/chromium/convert/html`, {
      method: "POST",
      body: form,
      signal: ac.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Gotenberg returned ${resp.status}: ${errText.slice(0, 200)}`);
  }
  return Buffer.from(await resp.arrayBuffer());
}

/** Minimal SMTP client — sends a pre-built email message via STARTTLS */
async function sendSmtpEmail(
  host: string, port: number, user: string, pass: string,
  from: string, to: string, message: string
): Promise<void> {
  // Sanitize CRLF in SMTP envelope addresses to prevent header/command injection
  const safeFrom = from.replace(/[\r\n]/g, "");
  const safeTo = to.replace(/[\r\n]/g, "");
  const net = await import("net");
  const tls = await import("tls");

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket?.destroy(); reject(new Error("SMTP timeout")); }, 30_000);

    let socket: any = net.createConnection({ host, port }, () => {});
    let buffer = "";
    let step = 0; // 0=connect, 1=ehlo, 2=starttls, 3=ehlo2, 4=auth, 5=user, 6=pass, 7=from, 8=rcpt, 9=data, 10=body, 11=quit

    function send(cmd: string) { socket.write(cmd + "\r\n"); }

    function handleLine(line: string) {
      const code = parseInt(line.slice(0, 3), 10);
      // Multi-line responses: continue reading if 4th char is '-'
      if (line.length > 3 && line[3] === "-") return;

      if (step === 0 && code === 220) { step = 1; send("EHLO cookieproof"); }
      else if (step === 1 && code === 250) { step = 2; send("STARTTLS"); }
      else if (step === 2 && code === 220) {
        // Upgrade to TLS — remove raw socket listener first to prevent
        // encrypted bytes from corrupting the shared buffer (Bun compat)
        step = 3;
        socket.removeAllListeners("data");
        buffer = "";
        const tlsSocket = tls.connect({ socket, host, servername: host }, () => {
          socket = tlsSocket;
          socket.on("data", onData);
          send("EHLO cookieproof");
        });
        tlsSocket.on("error", (e: Error) => { clearTimeout(timeout); reject(e); });
      }
      else if (step === 3 && code === 250) {
        if (user && pass) {
          step = 4; send("AUTH LOGIN");
        } else {
          step = 7; send(`MAIL FROM:<${safeFrom}>`);
        }
      }
      else if (step === 4 && code === 334) { step = 5; send(Buffer.from(user).toString("base64")); }
      else if (step === 5 && code === 334) { step = 6; send(Buffer.from(pass).toString("base64")); }
      else if (step === 6 && code === 235) { step = 7; send(`MAIL FROM:<${safeFrom}>`); }
      else if (step === 7 && code === 250) { step = 8; send(`RCPT TO:<${safeTo}>`); }
      else if (step === 8 && code === 250) { step = 9; send("DATA"); }
      else if (step === 9 && code === 354) { step = 10; send(message.replace(/\r\n\./g, "\r\n..") + "\r\n."); }
      else if (step === 10 && code === 250) { step = 11; send("QUIT"); clearTimeout(timeout); resolve(); }
      else if (code >= 400) { clearTimeout(timeout); socket.destroy(); reject(new Error(`SMTP error ${code}: ${line}`)); }
    }

    function onData(chunk: Buffer) {
      buffer += chunk.toString();
      let idx;
      while ((idx = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        handleLine(line);
      }
    }

    socket.on("data", onData);
    socket.on("error", (e: Error) => { clearTimeout(timeout); reject(e); });
    socket.on("close", () => { clearTimeout(timeout); if (step < 11) reject(new Error("SMTP connection closed unexpectedly")); });
  });
}

// ---------------------------------------------------------------------------
// Agency SMTP config resolver — returns custom SMTP if configured, else system defaults
// ---------------------------------------------------------------------------
function getSmtpConfig(agencyUserId?: string): { host: string; port: number; user: string; pass: string; from: string } {
  if (agencyUserId) {
    const row = db.prepare(
      "SELECT smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from FROM agency_smtp WHERE user_id = ?"
    ).get(agencyUserId) as { smtp_host: string; smtp_port: number; smtp_user: string; smtp_pass: string; smtp_from: string } | null;
    if (row?.smtp_host) return { host: row.smtp_host, port: row.smtp_port, user: row.smtp_user, pass: decryptSmtpPass(row.smtp_pass), from: row.smtp_from };
  }
  return { host: SMTP_HOST, port: SMTP_PORT, user: SMTP_USER, pass: SMTP_PASS, from: SMTP_FROM };
}

// ---------------------------------------------------------------------------
// Resend API email sender
// ---------------------------------------------------------------------------
async function sendResendEmail(to: string, subject: string, html: string, text?: string): Promise<void> {
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [to],
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, ""),
    }),
  });
  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    throw new Error(`Resend API error ${resp.status}: ${err.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// Unified email sender — prefers Resend, falls back to SMTP
// ---------------------------------------------------------------------------
async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text?: string,
  agencyUserId?: string
): Promise<void> {
  const MAX_RETRIES = 3;
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Agency users with custom SMTP always use SMTP
      if (agencyUserId) {
        const agencySmtp = getSmtpConfig(agencyUserId);
        if (agencySmtp.host && agencySmtp.host !== SMTP_HOST) {
          const message = [
            `From: ${agencySmtp.from}`,
            `To: ${to}`,
            `Subject: ${subject}`,
            `MIME-Version: 1.0`,
            `Content-Type: text/html; charset=utf-8`,
            ``,
            html,
          ].join("\r\n");
          await sendSmtpEmail(agencySmtp.host, agencySmtp.port, agencySmtp.user, agencySmtp.pass, agencySmtp.from, to, message);
          return;
        }
      }

      // Prefer Resend when API key is configured
      if (RESEND_API_KEY) {
        try {
          await sendResendEmail(to, subject, html, text);
          return;
        } catch (resendErr: any) {
          console.warn(`[cookieproof-api] Resend failed, falling back to SMTP:`, resendErr.message);
          // Fall through to SMTP if available
          if (SMTP_HOST && SMTP_FROM) {
            const message = [
              `From: CookieProof <${SMTP_FROM}>`,
              `To: ${to}`,
              `Subject: ${subject}`,
              `MIME-Version: 1.0`,
              `Content-Type: text/html; charset=utf-8`,
              ``,
              html,
            ].join("\r\n");
            await sendSmtpEmail(SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, to, message);
            return;
          }
          throw resendErr; // No SMTP fallback available
        }
      }

      // SMTP only (no Resend configured)
      if (SMTP_HOST && SMTP_FROM) {
        const message = [
          `From: CookieProof <${SMTP_FROM}>`,
          `To: ${to}`,
          `Subject: ${subject}`,
          `MIME-Version: 1.0`,
          `Content-Type: text/html; charset=utf-8`,
          ``,
          html,
        ].join("\r\n");
        await sendSmtpEmail(SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, to, message);
        return;
      }

      throw new Error("No email provider configured (set RESEND_API_KEY or SMTP_HOST)");
    } catch (e: any) {
      lastErr = e;
      // Don't retry config errors (no provider configured)
      if (e.message?.includes("No email provider configured")) throw e;
      if (attempt < MAX_RETRIES - 1) {
        const delayMs = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
        console.warn(`[cookieproof-api] Email send failed (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delayMs}ms:`, e.message);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }

  console.error(`[cookieproof-api] Email send failed after ${MAX_RETRIES} attempts to ${maskEmail(to)}`);
  throw lastErr!;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
_server = Bun.serve({
  port: PORT,

  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const origin = req.headers.get("Origin") || "";

    // ---- Preflight --------------------------------------------------------
    if (req.method === "OPTIONS") {
      // Open CORS for config endpoint (CDN-like, read-only)
      if (path.startsWith("/api/config/") || path === "/api/config") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }
      // Open CORS for telemetry endpoint (fires from customer sites)
      if (path === "/api/telemetry") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }
      return cors(new Response(null, { status: 204 }), origin);
    }

    // ---- Enterprise Edition gate --------------------------------------------
    // Block EE routes when no license key is configured.
    const EE_PATHS = ["/api/agency/", "/api/billing/", "/api/admin/", "/api/team/"];
    if (!EE_ENABLED && EE_PATHS.some(p => path.startsWith(p))) {
      return cors(json({
        error: "This feature requires a CookieProof Enterprise license.",
        docs: "https://github.com/bright-interaction/cookieproof/blob/main/ee/LICENSE"
      }, 403), origin);
    }

    // ---- GET /api/license ---------------------------------------------------
    if (req.method === "GET" && path === "/api/license") {
      return cors(json({
        licensed: EE_ENABLED,
        org: EE_LICENSE?.org || null,
        features: EE_LICENSE?.features || [],
        expires: EE_LICENSE?.expires || null,
      }), origin);
    }

    // ---- POST /api/proof ---------------------------------------------------
    if (req.method === "POST" && path === "/api/proof") {
      try {
        // Content-Type validation
        const contentType = req.headers.get("Content-Type") || "";
        if (!contentType.includes("application/json")) {
          return cors(json({ error: "Content-Type must be application/json" }, 415), origin);
        }

        // Rate limiting
        const ip = clientIp(req);
        if (isRateLimited(ip)) {
          return cors(
            json({ error: "Too many requests. Try again later." }, 429),
            origin
          );
        }

        // Parse body safely (handles size limits + JSON errors)
        const _body = await safeJson(req, MAX_BODY_SIZE);
        if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
        const data = _body.data;
        const consent = data.consent;

        // Validate consent payload
        const validation = validateConsentPayload(consent);
        if (!validation.valid) {
          return cors(
            json(
              { error: (validation as { valid: false; reason: string }).reason },
              400
            ),
            origin
          );
        }

        const id = randomUUID();
        const pageUrl = typeof data.url === 'string' ? data.url.slice(0, 2048) : '';
        if (pageUrl && !/^https?:\/\//i.test(pageUrl)) {
          return cors(json({ error: "url must use http or https" }, 400), origin);
        }
        const domain = extractDomain(pageUrl);

        // Validate domain against allowed origins scoped to the domain's owning org
        if (domain === 'unknown') {
          return cors(json({ error: "Could not determine domain from URL" }, 400), origin);
        }
        const proofAllowedOrigins = getAllowedOriginsForDomain(domain);
        const isDomainAllowed = proofAllowedOrigins.some(o => {
          try { return new URL(o).hostname === domain; } catch { return false; }
        });
        if (!isDomainAllowed) {
          return cors(json({ error: "Domain not in allowed origins" }, 403), origin);
        }

        // Per-domain rate limiting to prevent abuse from compromised domains
        if (isDomainProofRateLimited(domain)) {
          return cors(json({ error: "Too many consent records for this domain. Try again later." }, 429), origin);
        }

        // Always use server timestamp for audit integrity — client timestamp
        // is stored as metadata only, never as the authoritative record time.
        const createdAt = Date.now();

        insertStmt.run({
          $id: id,
          $domain: domain,
          $url: pageUrl,
          $method: consent.method,
          $categories: JSON.stringify(consent.categories),
          $version: consent.version ?? 1,
          $ip: hashIpForStorage(ip), // SECURITY: Hash IP for privacy protection
          $user_agent: (req.headers.get("User-Agent") || "").replace(/[\x00-\x1f\x7f]/g, "").slice(0, 512),
          $created_at: createdAt,
        });

        const proofPayload = {
          id,
          domain,
          url: pageUrl,
          method: consent.method,
          categories: consent.categories as Record<string, boolean>,
          timestamp: createdAt,
        };
        fireWebhook(proofPayload);

        // Fire customer-configured webhooks
        const domainConfig = db.prepare("SELECT org_id FROM domain_configs WHERE domain = ?")
          .get(domain) as { org_id: string | null } | null;
        if (domainConfig?.org_id) {
          fireCustomerWebhooks(domainConfig.org_id, "consent.recorded", proofPayload);
        }

        return cors(json({ id }, 201), origin);
      } catch (e) {
        return cors(json({ error: "Bad request" }, 400), origin);
      }
    }

    // ---- POST /api/telemetry (public, open CORS, rate-limited) -------------
    if (req.method === "POST" && path === "/api/telemetry") {
      const ip = clientIp(req);
      if (isTelemetryRateLimited(ip)) {
        return new Response(null, { status: 429, headers: { "Access-Control-Allow-Origin": "*" } });
      }
      try {
        const raw = await req.text();
        if (raw.length > 1024) {
          return new Response(null, { status: 413, headers: { "Access-Control-Allow-Origin": "*" } });
        }
        let data: any;
        try { data = JSON.parse(raw); } catch {
          return new Response(null, { status: 400, headers: { "Access-Control-Allow-Origin": "*" } });
        }
        const domain = typeof data.d === "string" ? data.d.slice(0, 253).toLowerCase() : "";
        const eventType = typeof data.t === "string" ? data.t.slice(0, 30) : "";
        const message = typeof data.m === "string" ? data.m.slice(0, 200) : "";
        const pageUrl = typeof data.u === "string" ? data.u.slice(0, 2048) : "";

        const VALID_TELEMETRY_TYPES = new Set(["config_fetch_error", "umd_load_error", "init_error"]);
        if (!domain || !VALID_TELEMETRY_TYPES.has(eventType)) {
          return new Response(null, { status: 400, headers: { "Access-Control-Allow-Origin": "*" } });
        }

        const ipHash = createHash("sha256").update(ip).digest("hex").slice(0, 16);
        const ua = (req.headers.get("User-Agent") || "").replace(/[\x00-\x1f\x7f]/g, "").slice(0, 512);

        db.prepare(
          `INSERT INTO telemetry_events (id, domain, event_type, message, user_agent, page_url, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(randomUUID(), domain, eventType, message, ua, pageUrl, ipHash, Date.now());

        return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
      } catch {
        return new Response(null, { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
      }
    }

    // ---- GET /api/health (public, no auth) ---------------------------------
    if (path === "/api/health") {
      try {
        db.prepare("SELECT 1").get();
        // Report Gotenberg status from background check (non-blocking)
        return cors(json({ status: "ok", gotenberg: _gotenbergStatus }), origin);
      } catch (e) {
        return cors(json({ status: "error" }, 503), origin);
      }
    }

    // ---- GET /api/config/:domain (public, no auth, open CORS) ----------------
    // This is a CDN-like endpoint serving read-only config JSON.
    // Uses Access-Control-Allow-Origin: * so any website can load its own config
    // without needing to be in allowed_domains first.
    if (req.method === "GET" && path.startsWith("/api/config/")) {
      const configDomain = path.slice("/api/config/".length).toLowerCase();

      if (!configDomain || configDomain.includes("/") || configDomain.length > 253 ||
          !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(configDomain)) {
        return new Response(JSON.stringify({ error: "Invalid domain format" }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }

      incrementConfigFetch(configDomain);
      loadSriHashAsync(); // trigger lazy SRI hash computation

      const row = db.prepare("SELECT config, css_vars, updated_at, org_id FROM domain_configs WHERE domain = ?")
        .get(configDomain) as { config: string; css_vars: string | null; updated_at: number; org_id: string | null } | null;
      if (!row) {
        return new Response(JSON.stringify({ error: "No config found for this domain" }), {
          status: 404,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }

      // Hard lock: expired/archived orgs cannot serve config (banner stops)
      if (row.org_id) {
        const ps = getOrgPlanStatus(row.org_id);
        if (ps.plan === "expired" || ps.plan === "archived") {
          return new Response(JSON.stringify({ error: "Configuration unavailable", locked: true }), {
            status: 403,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          });
        }
      }

      // ETag for client-side caching
      const etag = `"${createHash("md5").update(row.config + (row.css_vars || "")).digest("hex")}"`;
      const ifNoneMatch = req.headers.get("If-None-Match");
      if (ifNoneMatch === etag) {
        return new Response(null, {
          status: 304,
          headers: { "ETag": etag, "Cache-Control": "public, max-age=300, stale-while-revalidate=60", "Access-Control-Allow-Origin": "*" },
        });
      }

      let configData, cssVars;
      try { configData = JSON.parse(row.config); } catch { configData = {}; }
      try { cssVars = row.css_vars ? JSON.parse(row.css_vars) : null; } catch { cssVars = null; }

      const responseBody: Record<string, unknown> = { config: configData, cssVars, updatedAt: row.updated_at };
      if (_sriHash) responseBody.integrity = _sriHash;

      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
          "ETag": etag,
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // ---- POST /api/settings/key/setup (no auth, first-time only) -----------
    if (req.method === "POST" && path === "/api/settings/key/setup") {
      if (isAuthRateLimited(clientIp(req))) return cors(json({ error: "Too many attempts. Try again later." }, 429), origin);
      // Only works when NO key is configured anywhere
      if (ENV_API_KEY) {
        return cors(json({ error: "API key already configured via environment variable" }, 409), origin);
      }

      // Atomic check-and-insert in a transaction to prevent TOCTOU race
      const newKey = generateApiKey();
      const id = randomUUID();
      const setupTransaction = db.transaction(() => {
        const existing = db.prepare(
          "SELECT 1 FROM api_keys WHERE is_active = 1 LIMIT 1"
        ).get();
        if (existing) return false;
        db.prepare(
          "INSERT INTO api_keys (id, key_hash, created_at, is_active) VALUES (?, ?, ?, 1)"
        ).run(id, hashKey(newKey), Date.now());
        return true;
      });

      const created = setupTransaction();
      if (!created) {
        return cors(json({ error: "API key already exists. Use rotate endpoint to change it." }, 409), origin);
      }
      keySource = "database";

      console.log("[cookieproof-api] API key generated via setup endpoint.");
      return cors(json({
        key: newKey,
        message: "Save this key — it will not be shown again.",
      }, 201), origin);
    }

    // ---- GET /api/settings/key (owner/admin only) ---------------------------
    if (req.method === "GET" && path === "/api/settings/key") {
      const ctx = getAuthContextWithCsrf(req);
      if (!ctx) return cors(json({ error: "Unauthorized" }, 401), origin);
      if (ctx.type === "jwt" && ctx.role !== "owner" && !isAdmin(ctx)) {
        return cors(json({ error: "Owner or admin access required" }, 403), origin);
      }

      if (ENV_API_KEY) {
        return cors(json({
          has_key: true,
          source: "env",
          preview: "***env***",
          created_at: null,
        }), origin);
      }

      const row = db.prepare(
        "SELECT id, key_hash, created_at FROM api_keys WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1"
      ).get() as { id: string; key_hash: string; created_at: number } | null;

      if (!row) {
        return cors(json({ has_key: false, source: "none" }), origin);
      }

      return cors(json({
        has_key: true,
        source: "database",
        preview: "..." + row.key_hash.slice(-8),
        created_at: row.created_at,
      }), origin);
    }

    // ---- POST /api/settings/key/rotate (owner/admin only) -------------------
    if (req.method === "POST" && path === "/api/settings/key/rotate") {
      const ctx = getAuthContextWithCsrf(req);
      if (!ctx) return cors(json({ error: "Unauthorized" }, 401), origin);
      if (ctx.type === "jwt" && ctx.role !== "owner" && !isAdmin(ctx)) {
        return cors(json({ error: "Owner or admin access required" }, 403), origin);
      }

      if (ENV_API_KEY && keySource === "env") {
        return cors(json({
          error: "Cannot rotate — key is managed via environment variable. Change API_KEY env var and restart.",
        }, 400), origin);
      }

      // Atomic rotation: deactivate old + insert new in a single transaction
      const newKey = generateApiKey();
      const id = randomUUID();
      const rotateTransaction = db.transaction(() => {
        db.prepare("UPDATE api_keys SET is_active = 0").run();
        db.prepare(
          "INSERT INTO api_keys (id, key_hash, created_at, is_active) VALUES (?, ?, ?, 1)"
        ).run(id, hashKey(newKey), Date.now());
      });
      rotateTransaction();

      console.log("[cookieproof-api] API key rotated.");
      return cors(json({
        key: newKey,
        message: "New key active. Previous key has been invalidated.",
        previous_deactivated: true,
      }, 200), origin);
    }

    // ---- POST /api/auth/register -------------------------------------------
    if (req.method === "POST" && path === "/api/auth/register") {
      if (isAuthRateLimited(clientIp(req))) return cors(json({ error: "Too many attempts. Try again later." }, 429), origin);
      let data: any;
      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      data = _body.data;

      const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
      const password = typeof data.password === "string" ? data.password : "";
      const displayName = typeof data.display_name === "string" ? data.display_name.trim().slice(0, 255) : null;
      const workspaceName = typeof data.workspace_name === "string" ? data.workspace_name.trim().slice(0, 255) : null;

      if (!email || email.length > MAX_EMAIL_LEN || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return cors(json({ error: "Invalid email address" }, 400), origin);
      }
      const pwCheck = validatePassword(password);
      if (!pwCheck.valid) {
        return cors(json({ error: pwCheck.error }, 400), origin);
      }

      // Always hash before checking existence to prevent timing oracle
      const passwordHash = await Bun.password.hash(password, { algorithm: "argon2id" });
      const userId = randomUUID();
      const orgId = randomUUID();
      const now = Date.now();
      const trialEndsAt = now + 7 * 24 * 3600 * 1000;   // 7 days
      const graceEndsAt = now + 14 * 24 * 3600 * 1000;   // 14 days
      // Use provided workspace name, or fall back to default
      const orgName = workspaceName || `${email.split("@")[0]}'s org`;
      try {
        db.transaction(() => {
          db.prepare("INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)").run(userId, email, passwordHash, displayName, now);
          db.prepare("INSERT INTO orgs (id, name, plan, trial_started_at, trial_ends_at, grace_ends_at, created_at) VALUES (?, ?, 'trial', ?, ?, ?, ?)").run(orgId, orgName, now, trialEndsAt, graceEndsAt, now);
          db.prepare("INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, 'owner')").run(orgId, userId);
        })();
      } catch (e: any) {
        if (e?.code === "SQLITE_CONSTRAINT_UNIQUE") {
          // SECURITY: Return generic error to prevent account enumeration
          return cors(json({ error: "Unable to create account. Please try again or use a different email." }, 400), origin);
        }
        throw e;
      }

      // Send verification email
      await sendVerificationEmail(userId, email, origin);

      // Audit log
      logAuditEvent(userId, "register", { email }, req, orgId);
      logAuditEvent(userId, "org_create", { org_name: orgName }, req, orgId);

      const planStatus = getOrgPlanStatus(orgId);
      const token = signJwt({ sub: userId, email, org_id: orgId, role: "owner", tv: 0 });
      console.log(`[cookieproof-api] User registered: ${maskEmail(email)} (trial, pending verification)`);
      // Set httpOnly cookie with JWT + CSRF token
      return authResponse({
        account_type: "user",
        email_verified: false,
        display_name: displayName,
        user: { id: userId, email, created_at: now, org_id: orgId, role: "owner" },
        org: { id: orgId, name: orgName, plan: planStatus.plan, daysLeft: planStatus.daysLeft },
      }, token, origin, 201);
    }

    // ---- POST /api/auth/login ----------------------------------------------
    if (req.method === "POST" && path === "/api/auth/login") {
      if (isAuthRateLimited(clientIp(req))) return cors(json({ error: "Too many attempts. Try again later." }, 429), origin);
      let data: any;
      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      data = _body.data;

      const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
      const password = typeof data.password === "string" ? data.password : "";

      if (!email || email.length > MAX_EMAIL_LEN || !password) {
        return cors(json({ error: "Email and password are required" }, 400), origin);
      }

      const user = db.prepare("SELECT id, email, password_hash, created_at, token_version, account_type, display_name, status, email_verified_at, totp_secret, totp_enabled_at FROM users WHERE email = ?").get(email) as { id: string; email: string; password_hash: string; created_at: number; token_version: number | null; account_type: string; display_name: string | null; status: string; email_verified_at: number | null; totp_secret: string | null; totp_enabled_at: number | null } | null;
      // SECURITY: Always verify a hash to prevent timing-based user enumeration
      // Uses dynamically generated dummy hash with same Argon2id parameters
      const hashToVerify = user ? user.password_hash : DUMMY_PASSWORD_HASH;
      const valid = await Bun.password.verify(password, hashToVerify).catch(() => false);
      if (!valid || !user) {
        // SECURITY: Log failed login attempts for forensics (without revealing if user exists)
        if (user) {
          logAuditEvent(user.id, "login_failed", { reason: "invalid_password" }, req);
        }
        return cors(json({ error: "Invalid email or password" }, 401), origin);
      }
      if (user.status === 'archived') {
        return cors(json({ error: "Account is suspended. Contact your administrator." }, 403), origin);
      }

      // Check if 2FA is enabled
      if (user.totp_enabled_at && user.totp_secret) {
        // SECURITY: Check if user is locked out due to too many TOTP failures
        if (isTotpLocked(user.id)) {
          return cors(json({ error: "Too many failed attempts. Please try again in 15 minutes." }, 429), origin);
        }

        const totpCode = typeof data.totp_code === "string" ? data.totp_code.replace(/\s/g, "") : "";

        // If no code provided, tell client that 2FA is required
        if (!totpCode) {
          return cors(json({ requires_2fa: true, error: "Two-factor authentication code required" }, 401), origin);
        }

        // Check if it's a backup code (8 chars, may have dash)
        const cleanCode = totpCode.replace(/-/g, "").toUpperCase();
        let isValidCode = false;

        if (/^\d{6}$/.test(totpCode)) {
          // Standard TOTP code with replay protection
          isValidCode = verifyTotpWithReplayProtection(user.id, user.totp_secret, totpCode);
        } else if (/^[A-F0-9]{8}$/i.test(cleanCode)) {
          // Backup code - use HMAC with per-user salt for security
          const codeHash = createHash("sha256").update(cleanCode).digest("hex");
          const backupCode = db.prepare(
            "SELECT id FROM totp_backup_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL"
          ).get(user.id, codeHash) as { id: string } | null;

          if (backupCode) {
            db.prepare("UPDATE totp_backup_codes SET used_at = ? WHERE id = ?").run(Date.now(), backupCode.id);
            isValidCode = true;
            // Get org for audit log
            const mem = db.prepare("SELECT org_id FROM org_members WHERE user_id = ? ORDER BY role = 'owner' DESC, rowid ASC LIMIT 1")
              .get(user.id) as { org_id: string } | null;
            logAuditEvent(user.id, "2fa_backup_used", null, req, mem?.org_id);
            console.log(`[cookieproof-api] Backup code used for ${maskEmail(user.email)}`);
          }
        }

        if (!isValidCode) {
          // SECURITY: Record TOTP failure for brute-force protection
          recordTotpFailure(user.id);
          return cors(json({ error: "Invalid two-factor authentication code" }, 401), origin);
        }

        // Reset failure counter on successful verification
        resetTotpFailures(user.id);
      }

      db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(Date.now(), user.id);
      const membership = db.prepare("SELECT org_id, role FROM org_members WHERE user_id = ? ORDER BY role = 'owner' DESC, rowid ASC LIMIT 1")
        .get(user.id) as { org_id: string; role: string } | null;
      const orgId = membership?.org_id || "";
      const role = membership?.role || "owner";

      const org = db.prepare("SELECT id, name, plan, trial_ends_at, grace_ends_at FROM orgs WHERE id = ?").get(orgId) as { id: string; name: string | null; plan: string; trial_ends_at: number | null; grace_ends_at: number | null } | null;
      const planStatus = orgId ? getOrgPlanStatus(orgId) : { plan: "active" as const };

      const token = signJwt({ sub: user.id, email: user.email, org_id: orgId, role, tv: user.token_version ?? 0 });
      logAuditEvent(user.id, "login", { method: user.totp_enabled_at ? "2fa" : "password" }, req, orgId);
      console.log(`[cookieproof-api] User logged in: ${maskEmail(user.email)}`);
      // Set httpOnly cookie with JWT + CSRF token
      return authResponse({
        account_type: user.account_type || "user",
        display_name: user.display_name || null,
        email_verified: !!user.email_verified_at,
        user: { id: user.id, email: user.email, created_at: user.created_at, last_login_at: Date.now(), org_id: orgId, role },
        org: org ? { id: org.id, name: org.name, plan: planStatus.plan, daysLeft: planStatus.daysLeft } : null,
      }, token, origin);
    }

    // ---- GET /api/auth/me --------------------------------------------------
    if (req.method === "GET" && path === "/api/auth/me") {
      const ctx = getAuthContextWithCsrf(req);
      if (!ctx || ctx.type !== "jwt") {
        return cors(json({ error: "Unauthorized" }, 401), origin);
      }
      const user = db.prepare("SELECT id, email, created_at, last_login_at, display_name, email_verified_at, totp_enabled_at FROM users WHERE id = ?")
        .get(ctx.userId) as { id: string; email: string; created_at: number; last_login_at: number | null; display_name: string | null; email_verified_at: number | null; totp_enabled_at: number | null } | null;
      if (!user) {
        return cors(json({ error: "User not found" }, 404), origin);
      }

      // Current org details
      const currentOrg = db.prepare("SELECT id, name, plan, trial_ends_at, grace_ends_at FROM orgs WHERE id = ?")
        .get(ctx.orgId) as { id: string; name: string | null; plan: string; trial_ends_at: number | null; grace_ends_at: number | null } | null;
      const planStatus = getOrgPlanStatus(ctx.orgId);

      // Org list depends on account_type
      let orgs: { id: string; name: string | null; plan: string; role: string; domain_count: number }[];
      if (isAdmin(ctx)) {
        // Admin/super_admin sees ALL orgs
        orgs = db.prepare(`
          SELECT o.id, o.name, o.plan,
            COALESCE((SELECT om2.role FROM org_members om2 WHERE om2.org_id = o.id AND om2.user_id = ?), 'admin') as role,
            (SELECT COUNT(*) FROM domain_configs dc WHERE dc.org_id = o.id) as domain_count
          FROM orgs o ORDER BY o.created_at DESC
        `).all(ctx.userId) as any[];
      } else {
        // User/agency: only their memberships
        orgs = db.prepare(`
          SELECT o.id, o.name, o.plan, om.role,
            (SELECT COUNT(*) FROM domain_configs dc WHERE dc.org_id = o.id) as domain_count
          FROM org_members om JOIN orgs o ON o.id = om.org_id
          WHERE om.user_id = ? ORDER BY om.role = 'owner' DESC, o.created_at DESC
        `).all(ctx.userId) as any[];
      }

      // Home org: first actual membership where role=owner (not virtual admin role)
      const homeMembership = db.prepare(
        "SELECT org_id FROM org_members WHERE user_id = ? ORDER BY role = 'owner' DESC, rowid ASC LIMIT 1"
      ).get(ctx.userId) as { org_id: string } | null;

      return cors(json({
        user: { ...user, org_id: ctx.orgId, role: ctx.role },
        account_type: ctx.accountType,
        display_name: user.display_name || null,
        email_verified: !!user.email_verified_at,
        totp_enabled: !!user.totp_enabled_at,
        org: currentOrg ? { id: currentOrg.id, name: currentOrg.name, plan: planStatus.plan, daysLeft: planStatus.daysLeft, role: ctx.role } : null,
        orgs,
        home_org_id: homeMembership?.org_id || null,
      }), origin);
    }

    // ---- POST /api/auth/logout ---------------------------------------------
    if (req.method === "POST" && path === "/api/auth/logout") {
      const ctx = getAuthContextWithCsrf(req);
      if (ctx && ctx.type === "jwt") {
        logAuditEvent(ctx.userId, "logout", null, req, ctx.orgId);
      }
      // Clear httpOnly auth cookie
      return logoutResponse(origin);
    }

    // ---- PUT /api/auth/display-name ----------------------------------------
    if (req.method === "PUT" && path === "/api/auth/display-name") {
      const ctx = getAuthContextWithCsrf(req);
      if (!ctx || ctx.type !== "jwt") {
        return cors(json({ error: "Unauthorized" }, 401), origin);
      }
      let data: any;
      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      data = _body.data;
      const displayName = typeof data.display_name === "string" ? data.display_name.trim().slice(0, 100) : null;
      db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(displayName || null, ctx.userId);
      // Sync display name to home org name (only if user is owner)
      if (displayName) {
        const homeOrg = db.prepare(
          "SELECT org_id FROM org_members WHERE user_id = ? AND role = 'owner' ORDER BY rowid ASC LIMIT 1"
        ).get(ctx.userId) as { org_id: string } | null;
        if (homeOrg) {
          db.prepare("UPDATE orgs SET name = ? WHERE id = ?").run(displayName, homeOrg.org_id);
        }
      }
      logAuditEvent(ctx.userId, "display_name_update", { display_name: displayName }, req, ctx.orgId);
      return cors(json({ ok: true, display_name: displayName || null }), origin);
    }

    // ---- DELETE /api/auth/account -------------------------------------------
    if (req.method === "DELETE" && path === "/api/auth/account") {
      const ctx = getAuthContextWithCsrf(req);
      if (!ctx || ctx.type !== "jwt") {
        return cors(json({ error: "Unauthorized" }, 401), origin);
      }

      let data: any;
      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      data = _body.data;

      // Require password confirmation
      const password = typeof data.password === "string" ? data.password : "";
      if (!password) return cors(json({ error: "Password is required to delete your account" }, 400), origin);

      const user = db.prepare("SELECT id, email, password_hash FROM users WHERE id = ?")
        .get(ctx.userId) as { id: string; email: string; password_hash: string } | null;
      if (!user) return cors(json({ error: "User not found" }, 404), origin);

      const valid = await Bun.password.verify(password, user.password_hash);
      if (!valid) return cors(json({ error: "Incorrect password" }, 401), origin);

      // Refuse deletion if user owns any org with other members (require ownership transfer first)
      const allOwnedOrgs = db.prepare(
        "SELECT org_id FROM org_members WHERE user_id = ? AND role = 'owner'"
      ).all(ctx.userId) as { org_id: string }[];
      for (const { org_id } of allOwnedOrgs) {
        const otherMembers = db.prepare(
          "SELECT COUNT(*) as cnt FROM org_members WHERE org_id = ? AND user_id != ?"
        ).get(org_id, ctx.userId) as { cnt: number };
        if (otherMembers.cnt > 0) {
          return cors(json({ error: "You own organizations with other members. Transfer ownership or remove members before deleting your account." }, 400), origin);
        }
      }

      // Audit log BEFORE deletion (user_id will be deleted)
      logAuditEvent(ctx.userId, "account_delete", { email: user.email }, req, ctx.orgId);

      try {
        db.transaction(() => {
          // Delete ALL owned orgs and their data (safe: no other members verified above)
          for (const { org_id: oid } of allOwnedOrgs) {
            db.prepare("DELETE FROM consent_proofs WHERE domain IN (SELECT domain FROM domain_configs WHERE org_id = ?)").run(oid);
            db.prepare("DELETE FROM domain_configs WHERE org_id = ?").run(oid);
            db.prepare("DELETE FROM allowed_domains WHERE org_id = ?").run(oid);
            db.prepare("DELETE FROM alert_log WHERE org_id = ?").run(oid);
            db.prepare("DELETE FROM scheduled_reports WHERE org_id = ?").run(oid);
            db.prepare("DELETE FROM invite_tokens WHERE org_id = ?").run(oid);
            db.prepare("DELETE FROM org_members WHERE org_id = ?").run(oid);
            db.prepare("DELETE FROM orgs WHERE id = ?").run(oid);
          }
          invalidateOriginCache();
          // Remove user from any other orgs they're a member of
          db.prepare("DELETE FROM org_members WHERE user_id = ?").run(ctx.userId);
          // Delete agency branding and SMTP credentials
          db.prepare("DELETE FROM agency_branding WHERE user_id = ?").run(ctx.userId);
          db.prepare("DELETE FROM agency_smtp WHERE user_id = ?").run(ctx.userId);
          // Delete scheduled reports and invites created by this user
          db.prepare("DELETE FROM scheduled_reports WHERE created_by = ?").run(ctx.userId);
          db.prepare("DELETE FROM invite_tokens WHERE created_by = ?").run(ctx.userId);
          // Delete 2FA backup codes, password reset tokens, and email verification tokens
          db.prepare("DELETE FROM totp_backup_codes WHERE user_id = ?").run(ctx.userId);
          db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(ctx.userId);
          db.prepare("DELETE FROM email_verification_tokens WHERE user_id = ?").run(ctx.userId);
          // Delete the user account
          db.prepare("DELETE FROM users WHERE id = ?").run(ctx.userId);
        })();
      } catch (e: any) {
        console.error(`[cookieproof-api] Account deletion failed for ${maskEmail(user.email)}:`, e?.message);
        return cors(json({ error: "Account deletion failed. Please try again." }, 500), origin);
      }

      console.log(`[cookieproof-api] User ${maskEmail(user.email)} deleted their account`);
      return cors(json({ ok: true, deleted: true }), origin);
    }

    // ---- POST /api/auth/switch-org -----------------------------------------
    if (req.method === "POST" && path === "/api/auth/switch-org") {
      const ctx = getAuthContextWithCsrf(req);
      if (!ctx || ctx.type !== "jwt") {
        return cors(json({ error: "Unauthorized" }, 401), origin);
      }
      let data: any;
      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      data = _body.data;
      const targetOrgId = typeof data.org_id === "string" ? data.org_id : "";
      if (!targetOrgId || !UUID_RE.test(targetOrgId)) return cors(json({ error: "Valid org_id required" }, 400), origin);

      // Validate access to target org
      let role = "member";
      if (isAdmin(ctx)) {
        // Admin/super_admin can switch to any org
        const orgExists = db.prepare("SELECT 1 FROM orgs WHERE id = ?").get(targetOrgId);
        if (!orgExists) return cors(json({ error: "Organization not found" }, 404), origin);
        // Use real membership role if exists, otherwise virtual owner
        const mem = db.prepare("SELECT role FROM org_members WHERE org_id = ? AND user_id = ?").get(targetOrgId, ctx.userId) as { role: string } | null;
        role = mem?.role || "owner";
      } else {
        // Regular/agency: must be member
        const mem = db.prepare("SELECT role FROM org_members WHERE org_id = ? AND user_id = ?").get(targetOrgId, ctx.userId) as { role: string } | null;
        if (!mem) return cors(json({ error: "Not a member of that organization" }, 403), origin);
        role = mem.role;
      }

      const org = db.prepare("SELECT id, name, plan, trial_ends_at, grace_ends_at FROM orgs WHERE id = ?")
        .get(targetOrgId) as { id: string; name: string | null; plan: string; trial_ends_at: number | null; grace_ends_at: number | null } | null;
      const planStatus = getOrgPlanStatus(targetOrgId);
      const tv = (db.prepare("SELECT token_version FROM users WHERE id = ?").get(ctx.userId) as { token_version: number | null })?.token_version ?? 0;
      const token = signJwt({ sub: ctx.userId, email: ctx.email, org_id: targetOrgId, role, tv });

      // Set httpOnly cookie with new JWT for org context
      return authResponse({
        org: org ? { id: org.id, name: org.name, plan: planStatus.plan, daysLeft: planStatus.daysLeft, role } : null,
      }, token, origin);
    }

    // ---- GET /api/auth/orgs ------------------------------------------------
    if (req.method === "GET" && path === "/api/auth/orgs") {
      const ctx = getAuthContextWithCsrf(req);
      if (!ctx || ctx.type !== "jwt") {
        return cors(json({ error: "Unauthorized" }, 401), origin);
      }

      let orgs: any[];
      if (isAdmin(ctx)) {
        orgs = db.prepare(`
          SELECT o.id, o.name, o.plan, o.trial_ends_at, o.grace_ends_at, o.created_by_agency, o.created_at,
            COALESCE((SELECT om2.role FROM org_members om2 WHERE om2.org_id = o.id AND om2.user_id = ?), 'admin') as role,
            (SELECT COUNT(*) FROM domain_configs dc WHERE dc.org_id = o.id) as domain_count,
            (SELECT COUNT(*) FROM org_members om3 WHERE om3.org_id = o.id) as member_count
          FROM orgs o ORDER BY o.created_at DESC
        `).all(ctx.userId);
      } else {
        orgs = db.prepare(`
          SELECT o.id, o.name, o.plan, o.trial_ends_at, o.grace_ends_at, o.created_at, om.role,
            (SELECT COUNT(*) FROM domain_configs dc WHERE dc.org_id = o.id) as domain_count,
            (SELECT COUNT(*) FROM org_members om3 WHERE om3.org_id = o.id) as member_count
          FROM org_members om JOIN orgs o ON o.id = om.org_id
          WHERE om.user_id = ? ORDER BY om.role = 'owner' DESC, o.created_at DESC
        `).all(ctx.userId);
      }

      // Enrich with plan status
      const enriched = orgs.map((o: any) => {
        const ps = getOrgPlanStatus(o.id);
        return { ...o, plan: ps.plan, daysLeft: ps.daysLeft };
      });

      return cors(json({ orgs: enriched }), origin);
    }

    // ---- GET /api/alerts (JWT auth) — current alerts for user's org --------
    if (req.method === "GET" && path === "/api/alerts") {
      const ctx = getAuthContextWithCsrf(req);
      if (!ctx || ctx.type !== "jwt") {
        return cors(json({ error: "Unauthorized" }, 401), origin);
      }
      if (!ctx.orgId) {
        return cors(json({ alerts: [], health: 100 }), origin);
      }

      const alerts = computeOrgAlerts(ctx.orgId);
      const health = computeHealthScore(ctx.orgId);

      return cors(json({ alerts, health }), origin);
    }

    // ---- GET /api/alerts/history (JWT auth) — alert history for user's org -
    if (req.method === "GET" && path === "/api/alerts/history") {
      const ctx = getAuthContextWithCsrf(req);
      if (!ctx || ctx.type !== "jwt") {
        return cors(json({ error: "Unauthorized" }, 401), origin);
      }
      if (!ctx.orgId) {
        return cors(json({ history: [] }), origin);
      }

      const limit = Math.min(parseInt(String(url.searchParams.get("limit"))) || 50, 200);
      const offset = parseInt(String(url.searchParams.get("offset"))) || 0;

      const history = db.prepare(`
        SELECT id, alert_type as type, created_at, notified_at
        FROM alert_log
        WHERE org_id = ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `).all(ctx.orgId, limit, offset) as { id: string; type: string; created_at: number; notified_at: number }[];

      const total = (db.prepare("SELECT COUNT(*) as cnt FROM alert_log WHERE org_id = ?")
        .get(ctx.orgId) as { cnt: number }).cnt;

      return cors(json({ history, total, limit, offset }), origin);
    }

    // ---- POST /api/alerts/dismiss (JWT auth) — dismiss an alert ------------
    if (req.method === "POST" && path === "/api/alerts/dismiss") {
      const ctx = getAuthContextWithCsrf(req);
      if (!ctx || ctx.type !== "jwt") {
        return cors(json({ error: "Unauthorized" }, 401), origin);
      }
      if (!ctx.orgId) {
        return cors(json({ error: "No organization selected" }, 400), origin);
      }

      let data: any;
      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      data = _body.data;

      const alertType = typeof data.type === "string" ? data.type : "";
      const validTypes: AlertType[] = ["stale_config", "no_activity", "low_acceptance", "trial_expiring", "proof_gap"];
      if (!validTypes.includes(alertType as AlertType)) {
        return cors(json({ error: "Invalid alert type" }, 400), origin);
      }

      // Log dismissal - this prevents the alert from being re-sent for 24 hours
      db.prepare(`INSERT INTO alert_log (id, org_id, alert_type, created_at, notified_at) VALUES (?, ?, ?, ?, ?)`)
        .run(randomUUID(), ctx.orgId, alertType, Date.now(), Date.now());

      console.log(`[cookieproof-api] Alert ${alertType} dismissed for org ${ctx.orgId} by ${maskEmail(ctx.email)}`);
      return cors(json({ ok: true }), origin);
    }

    // ---- POST /api/alerts/dismiss-all (JWT auth) — dismiss all current alerts
    if (req.method === "POST" && path === "/api/alerts/dismiss-all") {
      const ctx = getAuthContextWithCsrf(req);
      if (!ctx || ctx.type !== "jwt") {
        return cors(json({ error: "Unauthorized" }, 401), origin);
      }
      if (!ctx.orgId) {
        return cors(json({ error: "No organization selected" }, 400), origin);
      }

      const alerts = computeOrgAlerts(ctx.orgId);
      const now = Date.now();
      const insertStmt = db.prepare(
        `INSERT INTO alert_log (id, org_id, alert_type, created_at, notified_at) VALUES (?, ?, ?, ?, ?)`
      );
      db.transaction(() => {
        for (const alert of alerts) {
          insertStmt.run(randomUUID(), ctx.orgId, alert.type, now, now);
        }
      })();

      console.log(`[cookieproof-api] All ${alerts.length} alerts dismissed for org ${ctx.orgId} by ${maskEmail(ctx.email)}`);
      return cors(json({ ok: true, dismissed: alerts.length }), origin);
    }

    // ---- GET /api/alerts/all (JWT auth, admin) — all orgs' alerts ----------
    if (req.method === "GET" && path === "/api/alerts/all") {
      const ctx = getAuthContextWithCsrf(req);
      if (!ctx || ctx.type !== "jwt") {
        return cors(json({ error: "Unauthorized" }, 401), origin);
      }

      // For agency users, show alerts for orgs they created
      // For admin users, show all orgs
      let orgIds: string[] = [];
      if (isAdmin(ctx)) {
        orgIds = (db.prepare("SELECT id FROM orgs").all() as { id: string }[]).map(o => o.id);
      } else if (ctx.accountType === "agency") {
        orgIds = (db.prepare(
          "SELECT org_id FROM org_members WHERE user_id = ? AND role = 'owner'"
        ).all(ctx.userId) as { org_id: string }[]).map(o => o.org_id);
      } else {
        // Regular users just see their own org
        if (ctx.orgId) orgIds = [ctx.orgId];
      }

      const allAlerts: { orgId: string; orgName: string; alerts: { type: string; message: string }[]; health: number }[] = [];
      for (const orgId of orgIds) {
        const org = db.prepare("SELECT name FROM orgs WHERE id = ?").get(orgId) as { name: string | null } | null;
        const alerts = computeOrgAlerts(orgId);
        const health = computeHealthScore(orgId);
        if (alerts.length > 0) {
          allAlerts.push({
            orgId,
            orgName: org?.name || "Unnamed",
            alerts,
            health,
          });
        }
      }

      return cors(json({ orgs: allAlerts, total: allAlerts.length }), origin);
    }

    // ---- POST /api/auth/change-password (JWT auth) -------------------------
    if (req.method === "POST" && path === "/api/auth/change-password") {
      if (isAuthRateLimited(clientIp(req))) return cors(json({ error: "Too many attempts. Try again later." }, 429), origin);
      const ctx = getAuthContextWithCsrf(req);
      if (!ctx || ctx.type !== "jwt") {
        return cors(json({ error: "Unauthorized" }, 401), origin);
      }
      let data: any;
      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      data = _body.data;

      const currentPw = typeof data.current_password === "string" ? data.current_password : "";
      const newPw = typeof data.new_password === "string" ? data.new_password : "";
      if (!currentPw || !newPw) {
        return cors(json({ error: "Both current_password and new_password are required" }, 400), origin);
      }
      const pwCheck = validatePassword(newPw);
      if (!pwCheck.valid) {
        return cors(json({ error: pwCheck.error }, 400), origin);
      }

      const user = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(ctx.userId) as { password_hash: string } | null;
      if (!user) return cors(json({ error: "User not found" }, 404), origin);

      const valid = await Bun.password.verify(currentPw, user.password_hash);
      if (!valid) {
        return cors(json({ error: "Current password is incorrect" }, 403), origin);
      }

      const newHash = await Bun.password.hash(newPw, { algorithm: "argon2id" });
      const currentTv = db.prepare("SELECT token_version FROM users WHERE id = ?").get(ctx.userId) as { token_version: number | null } | null;
      const newTv = (currentTv?.token_version ?? 0) + 1;
      db.prepare("UPDATE users SET password_hash = ?, password_changed_at = ?, token_version = ? WHERE id = ?").run(newHash, Date.now(), newTv, ctx.userId);
      const newToken = signJwt({ sub: ctx.userId, email: ctx.email, org_id: ctx.orgId, role: ctx.role, tv: newTv });
      logAuditEvent(ctx.userId, "password_change", null, req, ctx.orgId);
      console.log(`[cookieproof-api] Password changed for user ${maskEmail(ctx.email)}`);
      // Set new httpOnly cookie with refreshed token
      return authResponse({ ok: true }, newToken, origin);
    }

    // ---- GET /api/auth/email-preferences (JWT auth) ------------------------
    if (req.method === "GET" && path === "/api/auth/email-preferences") {
      const ctx = getAuthContextWithCsrf(req);
      if (!ctx || ctx.type !== "jwt") {
        return cors(json({ error: "Unauthorized" }, 401), origin);
      }

      const user = db.prepare(
        "SELECT email_pref_alerts, email_pref_billing, email_pref_security FROM users WHERE id = ?"
      ).get(ctx.userId) as { email_pref_alerts: number | null; email_pref_billing: number | null; email_pref_security: number | null } | null;

      return cors(json({
        alerts: user?.email_pref_alerts !== 0,
        billing: user?.email_pref_billing !== 0,
        security: user?.email_pref_security !== 0,
      }), origin);
    }

    // ---- POST /api/auth/email-preferences (JWT auth) -----------------------
    if (req.method === "POST" && path === "/api/auth/email-preferences") {
      const ctx = getAuthContextWithCsrf(req);
      if (!ctx || ctx.type !== "jwt") {
        return cors(json({ error: "Unauthorized" }, 401), origin);
      }

      let data: any;
      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      data = _body.data;

      const alerts = data.alerts === true ? 1 : 0;
      const billing = data.billing === true ? 1 : 0;
      const security = data.security === true ? 1 : 0;

      db.prepare(
        "UPDATE users SET email_pref_alerts = ?, email_pref_billing = ?, email_pref_security = ? WHERE id = ?"
      ).run(alerts, billing, security, ctx.userId);

      logAuditEvent(ctx.userId, "email_prefs_update", { alerts: !!alerts, billing: !!billing, security: !!security }, req, ctx.orgId);
      console.log(`[cookieproof-api] Email preferences updated for ${maskEmail(ctx.email)}`);
      return cors(json({ ok: true }), origin);
    }

    // ---- GET /api/auth/export-data (JWT auth) — GDPR personal data export ---
    if (req.method === "GET" && path === "/api/auth/export-data") {
      const ctx = getAuthContextWithCsrf(req);
      if (!ctx || ctx.type !== "jwt") {
        return cors(json({ error: "Unauthorized" }, 401), origin);
      }

      // Gather all personal data for the user
      const user = db.prepare(`
        SELECT id, email, display_name, account_type, status, created_at, last_login_at,
               email_verified_at, totp_enabled_at, email_pref_alerts, email_pref_billing, email_pref_security
        FROM users WHERE id = ?
      `).get(ctx.userId) as any;

      if (!user) {
        return cors(json({ error: "User not found" }, 404), origin);
      }

      // Get org memberships
      const memberships = db.prepare(`
        SELECT o.id, o.name, o.plan, om.role, om.created_at as joined_at
        FROM org_members om
        JOIN orgs o ON o.id = om.org_id
        WHERE om.user_id = ?
      `).all(ctx.userId) as any[];

      // Get consent proofs for user's orgs (limited to most recent 1000)
      const orgIds = memberships.map(m => m.id);
      let consentProofs: any[] = [];
      if (orgIds.length > 0) {
        const domains = db.prepare(
          `SELECT domain FROM domain_configs WHERE org_id IN (${orgIds.map(() => '?').join(',')})`
        ).all(...orgIds) as { domain: string }[];
        const domainNames = domains.map(d => d.domain);
        if (domainNames.length > 0) {
          consentProofs = db.prepare(`
            SELECT id, domain, method, categories, user_agent, created_at
            FROM consent_proofs
            WHERE domain IN (${domainNames.map(() => '?').join(',')})
            ORDER BY created_at DESC LIMIT 1000
          `).all(...domainNames) as any[];
        }
      }

      // Get alert history
      const alertHistory = db.prepare(`
        SELECT id, alert_type, created_at, notified_at
        FROM alert_log
        WHERE org_id IN (${orgIds.length > 0 ? orgIds.map(() => '?').join(',') : "''"})
        ORDER BY created_at DESC LIMIT 500
      `).all(...orgIds) as any[];

      const exportData = {
        export_date: new Date().toISOString(),
        user: {
          id: user.id,
          email: user.email,
          display_name: user.display_name,
          account_type: user.account_type,
          status: user.status,
          created_at: user.created_at ? new Date(user.created_at).toISOString() : null,
          last_login_at: user.last_login_at ? new Date(user.last_login_at).toISOString() : null,
          email_verified: !!user.email_verified_at,
          two_factor_enabled: !!user.totp_enabled_at,
          email_preferences: {
            alerts: user.email_pref_alerts !== 0,
            billing: user.email_pref_billing !== 0,
            security: user.email_pref_security !== 0,
          },
        },
        organizations: memberships.map(m => ({
          id: m.id,
          name: m.name,
          plan: m.plan,
          role: m.role,
          joined_at: m.joined_at ? new Date(m.joined_at).toISOString() : null,
        })),
        consent_proofs_count: consentProofs.length,
        consent_proofs_sample: consentProofs.slice(0, 100).map(p => ({
          id: p.id,
          domain: p.domain,
          method: p.method,
          categories: p.categories ? JSON.parse(p.categories) : null,
          created_at: p.created_at ? new Date(p.created_at).toISOString() : null,
        })),
        alert_history: alertHistory.map(a => ({
          id: a.id,
          type: a.alert_type,
          created_at: a.created_at ? new Date(a.created_at).toISOString() : null,
          notified_at: a.notified_at ? new Date(a.notified_at).toISOString() : null,
        })),
      };

      console.log(`[cookieproof-api] Personal data exported for ${maskEmail(ctx.email)}`);

      // Return as downloadable JSON
      return cors(new Response(JSON.stringify(exportData, null, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="cookieproof-data-export-${new Date().toISOString().slice(0, 10)}.json"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      }), origin);
    }

    // ---- POST /api/auth/forgot-password (public) ---------------------------
    if (req.method === "POST" && path === "/api/auth/forgot-password") {
      if (isAuthRateLimited(clientIp(req))) return cors(json({ error: "Too many attempts. Try again later." }, 429), origin);
      let data: any;
      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      data = _body.data;

      const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
      if (!email || email.length > MAX_EMAIL_LEN || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return cors(json({ error: "Invalid email address" }, 400), origin);
      }

      // Always return success to prevent email enumeration
      const successResponse = cors(json({ ok: true, message: "If an account with that email exists, a password reset link has been sent." }), origin);

      const user = db.prepare("SELECT id, email, status FROM users WHERE email = ?").get(email) as { id: string; email: string; status: string } | null;

      // SECURITY: Constant-time response - always do password hash work to prevent timing attacks
      // This makes response time indistinguishable whether user exists or not
      await Bun.password.verify("dummy-password-for-timing", DUMMY_PASSWORD_HASH).catch(() => false);

      if (!user || user.status === "archived") {
        return successResponse;
      }

      // Rate limit: max 3 reset requests per user per hour
      const recentResets = db.prepare(
        "SELECT COUNT(*) as cnt FROM password_reset_tokens WHERE user_id = ? AND created_at > ?"
      ).get(user.id, Date.now() - 3600 * 1000) as { cnt: number };
      if (recentResets.cnt >= 3) {
        return successResponse; // Silent fail to prevent enumeration
      }

      // Invalidate any existing tokens for this user
      db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(user.id);

      // Generate secure token (64 hex chars = 32 bytes)
      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      const tokenId = randomUUID();
      const now = Date.now();
      const expiresAt = now + 60 * 60 * 1000; // 1 hour

      db.prepare(
        "INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)"
      ).run(tokenId, user.id, tokenHash, expiresAt, now);

      // Send password reset email
      if (RESEND_API_KEY || (SMTP_HOST && SMTP_FROM)) {
        const resetUrl = `${origin || "https://app.cookieproof.io"}/#reset-password/${rawToken}`;
        const subject = "Reset your CookieProof password";
        const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;padding:40px 20px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e2e8f0;">
    <h1 style="font-size:20px;color:#0f172a;margin:0 0 16px;">Reset Your Password</h1>
    <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 24px;">
      We received a request to reset your password for the CookieProof account associated with <strong>${escHtml(user.email)}</strong>.
    </p>
    <p style="margin:0 0 24px;">
      <a href="${escAttr(resetUrl)}" style="display:inline-block;background:#0d9488;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;">
        Reset Password
      </a>
    </p>
    <p style="color:#64748b;font-size:13px;line-height:1.6;margin:0 0 16px;">
      This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.
    </p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
    <p style="color:#94a3b8;font-size:12px;margin:0;">
      CookieProof — GDPR Compliant Cookie Consent
    </p>
  </div>
</body>
</html>`;
        const textBody = `Reset your CookieProof password\n\nWe received a request to reset your password for ${maskEmail(user.email)}.\n\nClick here to reset your password:\n${resetUrl}\n\nThis link expires in 1 hour.\n\nIf you didn't request this, you can safely ignore this email.`;

        sendEmail(user.email, subject, htmlBody, textBody)
          .then(() => console.log(`[cookieproof-api] Password reset email sent to ${maskEmail(user.email)}`))
          .catch(e => console.error(`[cookieproof-api] Failed to send password reset email to ${maskEmail(user.email)}:`, e.message));
      } else {
        // SECURITY: Never log actual tokens - only log that email is not configured
        console.warn(`[cookieproof-api] Email not configured — password reset token generated for ${maskEmail(user.email)} (check DB to retrieve)`);
      }

      return successResponse;
    }

    // ---- POST /api/auth/reset-password (public) ----------------------------
    if (req.method === "POST" && path === "/api/auth/reset-password") {
      if (isAuthRateLimited(clientIp(req))) return cors(json({ error: "Too many attempts. Try again later." }, 429), origin);
      let data: any;
      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      data = _body.data;

      const rawToken = typeof data.token === "string" ? data.token : "";
      const newPassword = typeof data.password === "string" ? data.password : "";

      if (!rawToken || !/^[0-9a-f]{64}$/i.test(rawToken)) {
        return cors(json({ error: "Invalid or expired reset link" }, 400), origin);
      }
      const pwCheck = validatePassword(newPassword);
      if (!pwCheck.valid) {
        return cors(json({ error: pwCheck.error }, 400), origin);
      }

      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      const resetToken = db.prepare(
        "SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ?"
      ).get(tokenHash) as { id: string; user_id: string; expires_at: number; used_at: number | null } | null;

      if (!resetToken) {
        return cors(json({ error: "Invalid or expired reset link" }, 400), origin);
      }
      if (resetToken.used_at) {
        return cors(json({ error: "This reset link has already been used" }, 400), origin);
      }
      if (resetToken.expires_at < Date.now()) {
        return cors(json({ error: "This reset link has expired" }, 400), origin);
      }

      const user = db.prepare("SELECT id, email, token_version, status FROM users WHERE id = ?")
        .get(resetToken.user_id) as { id: string; email: string; token_version: number | null; status: string } | null;
      if (!user || user.status === "archived") {
        return cors(json({ error: "Account not found" }, 404), origin);
      }

      // Hash new password and invalidate all existing sessions
      const newHash = await Bun.password.hash(newPassword, { algorithm: "argon2id" });
      const newTv = (user.token_version ?? 0) + 1;
      const now = Date.now();

      db.transaction(() => {
        db.prepare("UPDATE users SET password_hash = ?, password_changed_at = ?, token_version = ? WHERE id = ?")
          .run(newHash, now, newTv, user.id);
        db.prepare("UPDATE password_reset_tokens SET used_at = ? WHERE id = ?")
          .run(now, resetToken.id);
        // Clean up old tokens for this user
        db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ? AND id != ?")
          .run(user.id, resetToken.id);
      })();

      // Get org info for the new token
      const membership = db.prepare("SELECT org_id, role FROM org_members WHERE user_id = ? ORDER BY role = 'owner' DESC, rowid ASC LIMIT 1")
        .get(user.id) as { org_id: string; role: string } | null;
      const orgId = membership?.org_id || "";
      const role = membership?.role || "owner";

      // Audit log
      logAuditEvent(user.id, "password_reset", null, req, orgId);

      const token = signJwt({ sub: user.id, email: user.email, org_id: orgId, role, tv: newTv });
      console.log(`[cookieproof-api] Password reset completed for ${maskEmail(user.email)}`);
      // Set httpOnly cookie for auto-login after reset
      return authResponse({ ok: true }, token, origin);
    }

    // ---- GET /api/auth/reset-password/:token (public) — validate token ----
    if (req.method === "GET" && path.startsWith("/api/auth/reset-password/")) {
      if (isAuthRateLimited(clientIp(req))) return cors(json({ valid: false, error: "Too many attempts" }, 429), origin);
      const rawToken = path.slice("/api/auth/reset-password/".length);
      if (!rawToken || !/^[0-9a-f]{64}$/i.test(rawToken)) {
        return cors(json({ valid: false, error: "Invalid reset link" }), origin);
      }

      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      const resetToken = db.prepare(
        "SELECT user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ?"
      ).get(tokenHash) as { user_id: string; expires_at: number; used_at: number | null } | null;

      if (!resetToken) return cors(json({ valid: false, error: "Invalid reset link" }), origin);
      if (resetToken.used_at) return cors(json({ valid: false, error: "This reset link has already been used" }), origin);
      if (resetToken.expires_at < Date.now()) return cors(json({ valid: false, error: "This reset link has expired" }), origin);

      const user = db.prepare("SELECT email FROM users WHERE id = ?").get(resetToken.user_id) as { email: string } | null;
      return cors(json({ valid: true, email: user?.email || "" }), origin);
    }

    // ---- POST /api/auth/verify-email (public) ------------------------------
    if (req.method === "POST" && path === "/api/auth/verify-email") {
      if (isAuthRateLimited(clientIp(req))) return cors(json({ error: "Too many attempts. Try again later." }, 429), origin);
      let data: any;
      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      data = _body.data;

      const rawToken = typeof data.token === "string" ? data.token : "";
      if (!rawToken || !/^[0-9a-f]{64}$/i.test(rawToken)) {
        return cors(json({ error: "Invalid verification link" }, 400), origin);
      }

      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      const verifyToken = db.prepare(
        "SELECT id, user_id, expires_at, used_at FROM email_verification_tokens WHERE token_hash = ?"
      ).get(tokenHash) as { id: string; user_id: string; expires_at: number; used_at: number | null } | null;

      if (!verifyToken) {
        return cors(json({ error: "Invalid verification link" }, 400), origin);
      }
      if (verifyToken.used_at) {
        return cors(json({ error: "This link has already been used" }, 400), origin);
      }
      if (verifyToken.expires_at < Date.now()) {
        return cors(json({ error: "This verification link has expired. Please request a new one." }, 400), origin);
      }

      const user = db.prepare("SELECT id, email, email_verified_at, token_version, status FROM users WHERE id = ?")
        .get(verifyToken.user_id) as { id: string; email: string; email_verified_at: number | null; token_version: number | null; status: string } | null;
      // SECURITY: Return generic error to prevent account enumeration
      if (!user || user.status === "archived") {
        return cors(json({ error: "Invalid verification link" }, 400), origin);
      }
      if (user.email_verified_at) {
        return cors(json({ ok: true, message: "Email already verified" }), origin);
      }

      const now = Date.now();
      db.transaction(() => {
        db.prepare("UPDATE users SET email_verified_at = ? WHERE id = ?").run(now, user.id);
        db.prepare("UPDATE email_verification_tokens SET used_at = ? WHERE id = ?").run(now, verifyToken.id);
        db.prepare("DELETE FROM email_verification_tokens WHERE user_id = ? AND id != ?").run(user.id, verifyToken.id);
      })();

      // Generate fresh token for auto-login
      const membership = db.prepare("SELECT org_id, role FROM org_members WHERE user_id = ? ORDER BY role = 'owner' DESC, rowid ASC LIMIT 1")
        .get(user.id) as { org_id: string; role: string } | null;
      const orgId = membership?.org_id || "";
      const role = membership?.role || "owner";
      const token = signJwt({ sub: user.id, email: user.email, org_id: orgId, role, tv: user.token_version ?? 0 });

      // Audit log
      logAuditEvent(user.id, "email_verified", null, req, orgId);

      console.log(`[cookieproof-api] Email verified for ${maskEmail(user.email)}`);
      // Set httpOnly cookie for auto-login after verification
      return authResponse({ ok: true, email: user.email }, token, origin);
    }

    // ---- GET /api/auth/verify-email/:token (public) — validate token -------
    if (req.method === "GET" && path.startsWith("/api/auth/verify-email/")) {
      if (isAuthRateLimited(clientIp(req))) return cors(json({ valid: false, error: "Too many attempts" }, 429), origin);
      const rawToken = path.slice("/api/auth/verify-email/".length);
      if (!rawToken || !/^[0-9a-f]{64}$/i.test(rawToken)) {
        return cors(json({ valid: false, error: "Invalid verification link" }), origin);
      }

      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      const verifyToken = db.prepare(
        "SELECT user_id, expires_at, used_at FROM email_verification_tokens WHERE token_hash = ?"
      ).get(tokenHash) as { user_id: string; expires_at: number; used_at: number | null } | null;

      // SECURITY: Return generic errors to prevent token/account enumeration
      if (!verifyToken) return cors(json({ valid: false, error: "Invalid verification link" }), origin);
      if (verifyToken.used_at) return cors(json({ valid: false, error: "Invalid verification link" }), origin);
      if (verifyToken.expires_at < Date.now()) return cors(json({ valid: false, error: "This verification link has expired. Please request a new one." }), origin);

      const user = db.prepare("SELECT email, email_verified_at FROM users WHERE id = ?")
        .get(verifyToken.user_id) as { email: string; email_verified_at: number | null } | null;
      if (user?.email_verified_at) return cors(json({ valid: false, error: "Invalid verification link" }), origin);

      return cors(json({ valid: true, email: user?.email || "" }), origin);
    }

    // ---- POST /api/auth/resend-verification (JWT auth) ---------------------
    if (req.method === "POST" && path === "/api/auth/resend-verification") {
      if (isAuthRateLimited(clientIp(req))) return cors(json({ error: "Too many attempts. Try again later." }, 429), origin);
      const ctx = getAuthContextWithCsrf(req);
      if (!ctx || ctx.type !== "jwt") {
        return cors(json({ error: "Unauthorized" }, 401), origin);
      }

      const user = db.prepare("SELECT id, email, email_verified_at FROM users WHERE id = ?")
        .get(ctx.userId) as { id: string; email: string; email_verified_at: number | null } | null;
      if (!user) {
        return cors(json({ error: "User not found" }, 404), origin);
      }
      if (user.email_verified_at) {
        return cors(json({ ok: true, message: "Email already verified" }), origin);
      }

      // Check if email is configured (Resend or SMTP)
      if (!RESEND_API_KEY && (!SMTP_HOST || !SMTP_FROM)) {
        console.warn(`[cookieproof-api] Email not configured — cannot send verification email to ${maskEmail(user.email)}`);
        return cors(json({ error: "Email delivery is not configured. Please contact support." }, 503), origin);
      }

      const sent = await sendVerificationEmail(user.id, user.email, origin);
      if (!sent) {
        return cors(json({ error: "Too many verification emails sent. Please try again later." }, 429), origin);
      }

      return cors(json({ ok: true, message: "Verification email sent" }), origin);
    }

    // ---- GET /api/auth/2fa/setup (JWT auth) — generate TOTP secret ---------
    if (req.method === "GET" && path === "/api/auth/2fa/setup") {
      // SECURITY: Rate limit to prevent abuse of secret generation
      if (isAuthRateLimited(clientIp(req))) return cors(json({ error: "Too many attempts. Try again later." }, 429), origin);
      const ctx = getAuthContextWithCsrf(req);
      if (!ctx || ctx.type !== "jwt") {
        return cors(json({ error: "Unauthorized" }, 401), origin);
      }

      const user = db.prepare("SELECT id, email, totp_enabled_at FROM users WHERE id = ?")
        .get(ctx.userId) as { id: string; email: string; totp_enabled_at: number | null } | null;
      if (!user) {
        return cors(json({ error: "User not found" }, 404), origin);
      }
      if (user.totp_enabled_at) {
        return cors(json({ error: "2FA is already enabled" }, 400), origin);
      }

      // Generate a new secret (will be stored when user confirms with valid code)
      const secret = generateTotpSecret();
      const uri = generateTotpUri(secret, user.email);

      // Store temporarily (not enabled yet) — will be confirmed via /2fa/enable
      db.prepare("UPDATE users SET totp_secret = ? WHERE id = ?").run(secret, user.id);

      return cors(json({ secret, uri }), origin);
    }

    // ---- POST /api/auth/2fa/enable (JWT auth) — verify code and enable -----
    if (req.method === "POST" && path === "/api/auth/2fa/enable") {
      if (isAuthRateLimited(clientIp(req))) return cors(json({ error: "Too many attempts. Try again later." }, 429), origin);
      const ctx = getAuthContextWithCsrf(req);
      if (!ctx || ctx.type !== "jwt") {
        return cors(json({ error: "Unauthorized" }, 401), origin);
      }

      let data: any;
      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      data = _body.data;

      const code = typeof data.code === "string" ? data.code.replace(/\s/g, "") : "";
      if (!code || !/^\d{6}$/.test(code)) {
        return cors(json({ error: "Invalid verification code" }, 400), origin);
      }

      const user = db.prepare("SELECT id, totp_secret, totp_enabled_at, token_version FROM users WHERE id = ?")
        .get(ctx.userId) as { id: string; totp_secret: string | null; totp_enabled_at: number | null; token_version: number | null } | null;
      if (!user) {
        return cors(json({ error: "User not found" }, 404), origin);
      }
      if (user.totp_enabled_at) {
        return cors(json({ error: "2FA is already enabled" }, 400), origin);
      }
      if (!user.totp_secret) {
        return cors(json({ error: "Please set up 2FA first" }, 400), origin);
      }

      // Verify the code with replay protection
      if (!verifyTotpWithReplayProtection(ctx.userId, user.totp_secret, code)) {
        return cors(json({ error: "Invalid verification code. Please try again." }, 400), origin);
      }

      // Generate backup codes
      const backupCodes = generateBackupCodes();
      const now = Date.now();

      db.transaction(() => {
        // Enable 2FA
        db.prepare("UPDATE users SET totp_enabled_at = ? WHERE id = ?").run(now, user.id);

        // Store hashed backup codes
        for (const backupCode of backupCodes) {
          const codeHash = createHash("sha256").update(backupCode.replace(/-/g, "")).digest("hex");
          db.prepare("INSERT INTO totp_backup_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)")
            .run(randomUUID(), user.id, codeHash, now);
        }
      })();

      logAuditEvent(ctx.userId, "2fa_enable", null, req, ctx.orgId);
      console.log(`[cookieproof-api] 2FA enabled for ${maskEmail(ctx.email)}`);
      return cors(json({ ok: true, backup_codes: backupCodes }), origin);
    }

    // ---- POST /api/auth/2fa/disable (JWT auth) — disable 2FA ---------------
    if (req.method === "POST" && path === "/api/auth/2fa/disable") {
      if (isAuthRateLimited(clientIp(req))) return cors(json({ error: "Too many attempts. Try again later." }, 429), origin);
      const ctx = getAuthContextWithCsrf(req);
      if (!ctx || ctx.type !== "jwt") {
        return cors(json({ error: "Unauthorized" }, 401), origin);
      }

      let data: any;
      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      data = _body.data;

      const password = typeof data.password === "string" ? data.password : "";
      if (!password) {
        return cors(json({ error: "Password is required" }, 400), origin);
      }

      const user = db.prepare("SELECT id, password_hash, totp_enabled_at FROM users WHERE id = ?")
        .get(ctx.userId) as { id: string; password_hash: string; totp_enabled_at: number | null } | null;
      if (!user) {
        return cors(json({ error: "User not found" }, 404), origin);
      }
      if (!user.totp_enabled_at) {
        return cors(json({ error: "2FA is not enabled" }, 400), origin);
      }

      // Verify password
      const valid = await Bun.password.verify(password, user.password_hash);
      if (!valid) {
        return cors(json({ error: "Invalid password" }, 403), origin);
      }

      db.transaction(() => {
        db.prepare("UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL WHERE id = ?").run(user.id);
        db.prepare("DELETE FROM totp_backup_codes WHERE user_id = ?").run(user.id);
        // SECURITY: Invalidate all existing JWTs when 2FA is disabled
        db.prepare("UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = ?").run(user.id);
      })();

      logAuditEvent(ctx.userId, "2fa_disable", null, req, ctx.orgId);
      console.log(`[cookieproof-api] 2FA disabled for ${maskEmail(ctx.email)}`);
      return cors(json({ ok: true }), origin);
    }

    // ---- GET /api/auth/2fa/status (JWT auth) — check if 2FA is enabled -----
    if (req.method === "GET" && path === "/api/auth/2fa/status") {
      const ctx = getAuthContextWithCsrf(req);
      if (!ctx || ctx.type !== "jwt") {
        return cors(json({ error: "Unauthorized" }, 401), origin);
      }

      const user = db.prepare("SELECT totp_enabled_at FROM users WHERE id = ?")
        .get(ctx.userId) as { totp_enabled_at: number | null } | null;
      if (!user) {
        return cors(json({ error: "User not found" }, 404), origin);
      }

      const backupCodesRemaining = (db.prepare(
        "SELECT COUNT(*) as cnt FROM totp_backup_codes WHERE user_id = ? AND used_at IS NULL"
      ).get(ctx.userId) as { cnt: number }).cnt;

      return cors(json({
        enabled: !!user.totp_enabled_at,
        enabled_at: user.totp_enabled_at,
        backup_codes_remaining: user.totp_enabled_at ? backupCodesRemaining : 0,
      }), origin);
    }

    // ---- POST /api/auth/2fa/regenerate-backup (JWT auth) — get new codes ---
    if (req.method === "POST" && path === "/api/auth/2fa/regenerate-backup") {
      if (isAuthRateLimited(clientIp(req))) return cors(json({ error: "Too many attempts. Try again later." }, 429), origin);
      const ctx = getAuthContextWithCsrf(req);
      if (!ctx || ctx.type !== "jwt") {
        return cors(json({ error: "Unauthorized" }, 401), origin);
      }

      let data: any;
      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      data = _body.data;

      const code = typeof data.code === "string" ? data.code.replace(/\s/g, "") : "";
      if (!code || !/^\d{6}$/.test(code)) {
        return cors(json({ error: "Invalid verification code" }, 400), origin);
      }

      const user = db.prepare("SELECT id, totp_secret, totp_enabled_at FROM users WHERE id = ?")
        .get(ctx.userId) as { id: string; totp_secret: string | null; totp_enabled_at: number | null } | null;
      if (!user || !user.totp_enabled_at || !user.totp_secret) {
        return cors(json({ error: "2FA is not enabled" }, 400), origin);
      }

      // Verify current TOTP code with replay protection
      if (!verifyTotpWithReplayProtection(ctx.userId, user.totp_secret, code)) {
        return cors(json({ error: "Invalid verification code" }, 400), origin);
      }

      // Generate new backup codes
      const backupCodes = generateBackupCodes();
      const now = Date.now();

      db.transaction(() => {
        // Delete old backup codes
        db.prepare("DELETE FROM totp_backup_codes WHERE user_id = ?").run(user.id);

        // Store new hashed backup codes
        for (const backupCode of backupCodes) {
          const codeHash = createHash("sha256").update(backupCode.replace(/-/g, "")).digest("hex");
          db.prepare("INSERT INTO totp_backup_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)")
            .run(randomUUID(), user.id, codeHash, now);
        }
      })();

      console.log(`[cookieproof-api] Backup codes regenerated for ${maskEmail(ctx.email)}`);
      return cors(json({ ok: true, backup_codes: backupCodes }), origin);
    }

    // ---- GET /api/team/invite/:token/info (public) -------------------------
    if (req.method === "GET" && path.startsWith("/api/team/invite/") && path.endsWith("/info")) {
      if (isAuthRateLimited(clientIp(req))) return cors(json({ error: "Too many attempts. Try again later." }, 429), origin);
      const rawToken = path.slice("/api/team/invite/".length, -"/info".length);
      if (!rawToken || !/^[0-9a-f]{64}$/i.test(rawToken)) return cors(json({ error: "Invalid token format" }, 400), origin);

      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      const invite = db.prepare(
        "SELECT email, expires_at, used_at FROM invite_tokens WHERE token_hash = ?"
      ).get(tokenHash) as { email: string; expires_at: number; used_at: number | null } | null;

      if (!invite) return cors(json({ valid: false, error: "Invalid invite link" }), origin);
      if (invite.used_at) return cors(json({ valid: false, error: "This invite has already been used" }), origin);
      if (invite.expires_at < Date.now()) return cors(json({ valid: false, error: "This invite has expired" }), origin);

      return cors(json({ valid: true, email: invite.email }), origin);
    }

    // ---- POST /api/team/invite/:token/accept (public) ----------------------
    if (req.method === "POST" && path.startsWith("/api/team/invite/") && path.endsWith("/accept")) {
      if (isAuthRateLimited(clientIp(req))) return cors(json({ error: "Too many attempts. Try again later." }, 429), origin);
      const rawToken = path.slice("/api/team/invite/".length, -"/accept".length);
      if (!rawToken || !/^[0-9a-f]{64}$/i.test(rawToken)) return cors(json({ error: "Invalid token format" }, 400), origin);

      let data: any;
      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      data = _body.data;
      const password = typeof data.password === "string" ? data.password : "";
      const pwCheck = validatePassword(password);
      if (!pwCheck.valid) {
        return cors(json({ error: pwCheck.error }, 400), origin);
      }

      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      const invite = db.prepare(
        "SELECT id, org_id, email, expires_at, used_at, account_type FROM invite_tokens WHERE token_hash = ?"
      ).get(tokenHash) as { id: string; org_id: string; email: string; expires_at: number; used_at: number | null; account_type: string } | null;

      if (!invite) return cors(json({ error: "Invalid invite link" }, 400), origin);
      if (invite.used_at) return cors(json({ error: "This invite has already been used" }, 400), origin);
      if (invite.expires_at < Date.now()) return cors(json({ error: "This invite has expired" }, 400), origin);

      // Verify the target org still exists
      const targetOrg = db.prepare("SELECT 1 FROM orgs WHERE id = ?").get(invite.org_id);
      if (!targetOrg) return cors(json({ error: "This organization no longer exists" }, 410), origin);

      const passwordHash = await Bun.password.hash(password, { algorithm: "argon2id" });
      const now = Date.now();

      // Check if user already exists — if so, add them to the org (verify password)
      const existingUser = db.prepare("SELECT id, password_hash, token_version FROM users WHERE email = ?").get(invite.email) as { id: string; password_hash: string; token_version: number | null } | null;

      if (existingUser) {
        // Existing user: verify password, then add to org
        const valid = await Bun.password.verify(password, existingUser.password_hash);
        if (!valid) {
          return cors(json({ error: "Incorrect password. Use your existing account password to join this team." }, 401), origin);
        }
        // Check not already in this org
        const alreadyMember = db.prepare("SELECT 1 FROM org_members WHERE org_id = ? AND user_id = ?").get(invite.org_id, existingUser.id);
        if (alreadyMember) {
          return cors(json({ error: "You are already a member of this organization" }, 409), origin);
        }
        // Atomically claim the invite and add membership in one transaction
        const claimed = db.transaction(() => {
          const r = db.prepare("UPDATE invite_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL").run(now, invite.id);
          if (r.changes === 0) return false;
          db.prepare("INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, 'member')").run(invite.org_id, existingUser.id);
          // Note: account_type is NOT upgraded here — existing users keep their current
          // account_type. Only admins can change account types via the admin panel.
          // This prevents privilege escalation via invite acceptance.
          return true;
        })();
        if (!claimed) {
          return cors(json({ error: "This invite has already been used" }, 400), origin);
        }
        const token = signJwt({ sub: existingUser.id, email: invite.email, org_id: invite.org_id, role: "member", tv: existingUser.token_version ?? 0 });
        console.log(`[cookieproof-api] Existing user ${maskEmail(invite.email)} joined org ${invite.org_id}`);
        // Set httpOnly cookie for existing user joining org
        return authResponse({ user: { id: existingUser.id, email: invite.email, created_at: now, org_id: invite.org_id, role: "member" } }, token, origin);
      }

      // New user: create account and add to org atomically
      const userId = randomUUID();
      try {
        db.transaction(() => {
          // Atomically claim the invite token first
          const claimed = db.prepare("UPDATE invite_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL").run(now, invite.id);
          if (claimed.changes === 0) throw new Error("INVITE_ALREADY_USED");
          db.prepare("INSERT INTO users (id, email, password_hash, created_at, account_type) VALUES (?, ?, ?, ?, ?)").run(userId, invite.email, passwordHash, now, invite.account_type || "user");
          db.prepare("INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, 'member')").run(invite.org_id, userId);
        })();
      } catch (e: any) {
        if (e?.message === "INVITE_ALREADY_USED") {
          return cors(json({ error: "This invite has already been used" }, 400), origin);
        }
        if (e?.code === "SQLITE_CONSTRAINT_UNIQUE") {
          // SECURITY: Return generic error to prevent account enumeration
          return cors(json({ error: "Unable to accept invite. Please contact your administrator." }, 400), origin);
        }
        throw e;
      }

      const token = signJwt({ sub: userId, email: invite.email, org_id: invite.org_id, role: "member", tv: 0 });
      console.log(`[cookieproof-api] Invite accepted: ${maskEmail(invite.email)} joined org ${invite.org_id}`);
      // Set httpOnly cookie for new user from invite
      return authResponse({ user: { id: userId, email: invite.email, created_at: now, org_id: invite.org_id, role: "member" } }, token, origin, 201);
    }

    // ---- POST /api/billing/webhook (BEFORE auth gate — Mollie sends no auth) ---
    if (req.method === "POST" && path === "/api/billing/webhook") {
      // Cap request body size for unauthenticated webhook endpoint
      const cl = Number(req.headers.get("Content-Length") || 0);
      if (cl > 4096) return cors(json({ error: "Request too large" }, 413), origin);

      // Mollie sends payment ID in body as form data
      const formData = await req.formData().catch(() => null);
      const paymentId = formData?.get("id") as string | null;

      if (!paymentId) {
        return cors(json({ error: "Missing payment ID" }, 400), origin);
      }

      if (!MOLLIE_API_KEY) {
        console.warn("[cookieproof-api] Mollie webhook received but MOLLIE_API_KEY not configured");
        return cors(json({ ok: true }), origin);
      }

      // Fetch payment details from Mollie (standard Mollie verification pattern)
      try {
        const mollieRes = await fetch(`https://api.mollie.com/v2/payments/${encodeURIComponent(paymentId)}`, {
          headers: { "Authorization": `Bearer ${MOLLIE_API_KEY}` },
        });

        if (!mollieRes.ok) {
          console.error("[cookieproof-api] Mollie payment fetch failed:", await mollieRes.text());
          return cors(json({ error: "Failed to verify payment" }, 500), origin);
        }

        const payment = await mollieRes.json() as any;
        const now = Date.now();

        // Find our payment record
        const localPayment = db.prepare("SELECT * FROM payments WHERE mollie_payment_id = ?")
          .get(paymentId) as any;

        if (!localPayment) {
          console.warn(`[cookieproof-api] Webhook for unknown payment: ${paymentId}`);
          return cors(json({ ok: true }), origin);
        }

        // SECURITY: Idempotency check — skip if already processed
        if (localPayment.status === "paid" && payment.status === "paid") {
          console.log(`[cookieproof-api] Webhook idempotency: payment ${paymentId} already processed`);
          return cors(json({ ok: true }), origin);
        }

        // Map Mollie status to known internal statuses
        const KNOWN_PAYMENT_STATUSES = new Set(["paid", "failed", "pending", "canceled", "expired", "open"]);
        const newStatus = KNOWN_PAYMENT_STATUSES.has(payment.status) ? payment.status : "unknown";
        db.prepare("UPDATE payments SET status = ?, paid_at = ?, updated_at = ? WHERE id = ?")
          .run(newStatus, payment.status === "paid" ? now : null, now, localPayment.id);

        // If this is a first payment and it succeeded, activate subscription
        if (payment.status === "paid" && localPayment.subscription_id) {
          const sub = db.prepare("SELECT * FROM subscriptions WHERE id = ?")
            .get(localPayment.subscription_id) as any;

          if (sub && sub.status === "pending") {
            const plan = db.prepare("SELECT interval FROM pricing_plans WHERE id = ?")
              .get(sub.plan_id) as { interval: string } | null;
            const periodMs = plan?.interval === "year" ? 365 * 24 * 3600 * 1000 : 30 * 24 * 3600 * 1000;
            const periodEnd = now + periodMs;

            // Store mandate ID for recurring payments (validate Mollie field formats)
            const rawMandateId = payment.mandateId || null;
            const mandateId = rawMandateId && /^mdt_[a-zA-Z0-9]+$/.test(rawMandateId) ? rawMandateId : null;
            const rawCustomerId = payment.customerId || null;
            const customerId = rawCustomerId && /^cst_[a-zA-Z0-9]+$/.test(rawCustomerId) ? rawCustomerId : null;

            db.prepare(`
              UPDATE subscriptions SET
                status = 'active',
                mollie_mandate_id = COALESCE(?, mollie_mandate_id),
                mollie_customer_id = COALESCE(?, mollie_customer_id),
                current_period_start = ?,
                current_period_end = ?,
                updated_at = ?
              WHERE id = ?
            `).run(mandateId, customerId, now, periodEnd, now, sub.id);

            // Activate org plan
            db.prepare("UPDATE orgs SET plan = 'active', trial_ends_at = NULL, grace_ends_at = NULL WHERE id = ?")
              .run(sub.org_id);

            // Create Mollie subscription for recurring payments if we have mandate
            if (mandateId && customerId && MOLLIE_WEBHOOK_URL) {
              try {
                const planDetails = db.prepare("SELECT * FROM pricing_plans WHERE id = ?").get(sub.plan_id) as any;
                const mollieSubRes = await fetch(`https://api.mollie.com/v2/customers/${encodeURIComponent(customerId)}/subscriptions`, {
                  method: "POST",
                  headers: {
                    "Authorization": `Bearer ${MOLLIE_API_KEY}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    amount: { currency: planDetails.currency, value: (planDetails.price_cents / 100).toFixed(2) },
                    interval: planDetails.interval === "year" ? "1 year" : "1 month",
                    description: `CookieProof ${planDetails.name}`,
                    webhookUrl: MOLLIE_WEBHOOK_URL,
                    metadata: { org_id: sub.org_id, subscription_id: sub.id },
                  }),
                });

                if (mollieSubRes.ok) {
                  const mollieSub = await mollieSubRes.json() as any;
                  db.prepare("UPDATE subscriptions SET mollie_subscription_id = ?, updated_at = ? WHERE id = ?")
                    .run(mollieSub.id, now, sub.id);
                  console.log(`[cookieproof-api] Created Mollie recurring subscription ${mollieSub.id}`);
                }
              } catch (e: any) {
                console.error("[cookieproof-api] Failed to create Mollie subscription:", e.message);
              }
            }

            console.log(`[cookieproof-api] Activated subscription ${sub.id} for org ${sub.org_id}`);
          }
        }

        // Handle subscription payments (recurring) — with idempotency check
        if (payment.status === "paid" && payment.subscriptionId) {
          const sub = db.prepare("SELECT * FROM subscriptions WHERE mollie_subscription_id = ?")
            .get(payment.subscriptionId) as any;

          if (sub) {
            const plan = db.prepare("SELECT interval FROM pricing_plans WHERE id = ?")
              .get(sub.plan_id) as { interval: string } | null;
            const periodMs = plan?.interval === "year" ? 365 * 24 * 3600 * 1000 : 30 * 24 * 3600 * 1000;

            // Only update period if the payment is newer than current period start
            if (!sub.current_period_start || now > sub.current_period_start) {
              db.prepare(`
                UPDATE subscriptions SET
                  current_period_start = ?,
                  current_period_end = ?,
                  updated_at = ?
                WHERE id = ?
              `).run(now, now + periodMs, now, sub.id);

              console.log(`[cookieproof-api] Renewed subscription ${sub.id} until ${new Date(now + periodMs).toISOString()}`);
            }
          }
        }

        // Handle failed recurring payment
        if (payment.status === "failed" && payment.subscriptionId) {
          const sub = db.prepare("SELECT * FROM subscriptions WHERE mollie_subscription_id = ?")
            .get(payment.subscriptionId) as any;

          if (sub) {
            // Move org to grace period
            const gracePeriodMs = 7 * 24 * 3600 * 1000; // 7 days
            db.prepare("UPDATE orgs SET plan = 'trial', grace_ends_at = ? WHERE id = ?")
              .run(now + gracePeriodMs, sub.org_id);
            console.log(`[cookieproof-api] Payment failed for subscription ${sub.id}, org ${sub.org_id} in grace period`);
          }
        }

        return cors(json({ ok: true }), origin);
      } catch (e: any) {
        console.error("[cookieproof-api] Webhook processing error:", e.message);
        return cors(json({ error: "Webhook processing failed" }, 500), origin);
      }
    }

    // ---- Auth-gated endpoints below ---------------------------------------
    // SECURITY: Use CSRF-protected auth context for state-changing requests
    const authCtx = getAuthContextWithCsrf(req);
    if (!authCtx) {
      // Could be auth failure OR CSRF validation failure for JWT sessions
      return cors(json({ error: "Unauthorized" }, 401), origin);
    }

    // Trial/grace gating for JWT-authed dashboard endpoints
    // Exceptions: /api/auth/*, /api/proof/export, /api/admin/*, /api/agency/* are always allowed
    if (authCtx.type === "jwt") {
      const isExempt = path.startsWith("/api/auth/") || path === "/api/proof/export"
        || path.startsWith("/api/admin/") || path.startsWith("/api/agency/");
      if (!isExempt) {
        const ps = getOrgPlanStatus(authCtx.orgId);
        if (ps.plan === "grace" || ps.plan === "expired" || ps.plan === "archived") {
          return cors(json({ error: ps.plan === "archived" ? "Organization archived" : "Trial expired", plan: ps.plan, daysLeft: ps.daysLeft }, 402), origin);
        }
      }
    }

    // ---- GET /api/team/members (JWT auth) ----------------------------------
    if (req.method === "GET" && path === "/api/team/members") {
      if (authCtx.type !== "jwt") return cors(json({ error: "JWT auth required" }, 403), origin);
      const members = db.prepare(
        "SELECT u.id, u.email, om.role, u.created_at FROM org_members om JOIN users u ON u.id = om.user_id WHERE om.org_id = ? ORDER BY u.created_at ASC"
      ).all(authCtx.orgId) as { id: string; email: string; role: string; created_at: number }[];
      return cors(json({ members }), origin);
    }

    // ---- DELETE /api/team/members/:userId (JWT auth, owner only) -----------
    if (req.method === "DELETE" && path.startsWith("/api/team/members/")) {
      if (authCtx.type !== "jwt") return cors(json({ error: "JWT auth required" }, 403), origin);
      if (authCtx.role !== "owner") return cors(json({ error: "Only the owner can remove team members" }, 403), origin);

      const targetId = path.slice("/api/team/members/".length);
      if (!targetId || !UUID_RE.test(targetId)) {
        return cors(json({ error: "Invalid user ID" }, 400), origin);
      }
      if (targetId === authCtx.userId) return cors(json({ error: "Cannot remove yourself" }, 400), origin);

      const target = db.prepare(
        "SELECT role FROM org_members WHERE org_id = ? AND user_id = ?"
      ).get(authCtx.orgId, targetId) as { role: string } | null;
      if (!target) return cors(json({ error: "User not found in your organization" }, 404), origin);

      // Prevent removing the last owner
      if (target.role === "owner") {
        const ownerCount = (db.prepare(
          "SELECT COUNT(*) as cnt FROM org_members WHERE org_id = ? AND role = 'owner'"
        ).get(authCtx.orgId) as { cnt: number }).cnt;
        if (ownerCount <= 1) {
          return cors(json({ error: "Cannot remove the only owner. Transfer ownership first." }, 400), origin);
        }
      }

      // Only remove from this org — do NOT delete the user record (they may belong to other orgs)
      // Also revoke pending invites and disable scheduled reports they created for this org
      // Bump token_version to invalidate the removed member's existing JWTs
      db.transaction(() => {
        db.prepare("DELETE FROM org_members WHERE org_id = ? AND user_id = ?").run(authCtx.orgId, targetId);
        db.prepare("DELETE FROM invite_tokens WHERE org_id = ? AND created_by = ? AND used_at IS NULL").run(authCtx.orgId, targetId);
        db.prepare("UPDATE scheduled_reports SET enabled = 0 WHERE org_id = ? AND created_by = ?").run(authCtx.orgId, targetId);
        db.prepare("UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = ?").run(targetId);
      })();
      console.log(`[cookieproof-api] User ${targetId} removed from org ${authCtx.orgId} by ${maskEmail(authCtx.email)}`);
      return cors(json({ removed: targetId }), origin);
    }

    // ---- POST /api/team/invite (JWT auth, owner only) ----------------------
    if (req.method === "POST" && path === "/api/team/invite") {
      if (authCtx.type !== "jwt") return cors(json({ error: "JWT auth required" }, 403), origin);
      if (authCtx.role !== "owner") return cors(json({ error: "Only the owner can invite team members" }, 403), origin);

      let data: any;
      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      data = _body.data;

      const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
      if (!email || email.length > MAX_EMAIL_LEN || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return cors(json({ error: "Invalid email address" }, 400), origin);
      }

      // Validate invite account_type based on inviter's role hierarchy
      const inviteType = typeof data.account_type === "string" ? data.account_type : "user";
      const VALID_TYPES = ["user", "agency", "admin", "super_admin"];
      if (!VALID_TYPES.includes(inviteType)) {
        return cors(json({ error: "account_type must be 'user', 'agency', 'admin', or 'super_admin'" }, 400), origin);
      }
      // Hierarchical check: you can only invite at or below your own level
      const ROLE_LEVEL: Record<string, number> = { user: 0, agency: 1, admin: 2, super_admin: 3 };
      const inviterLevel = ROLE_LEVEL[authCtx.accountType] ?? 0;
      const inviteeLevel = ROLE_LEVEL[inviteType] ?? 0;
      if (inviteeLevel > inviterLevel) {
        return cors(json({ error: "You cannot invite someone with a higher role than your own" }, 403), origin);
      }

      // Check if already in org
      const existingMember = db.prepare(
        "SELECT 1 FROM users u JOIN org_members om ON om.user_id = u.id WHERE u.email = ? AND om.org_id = ?"
      ).get(email, authCtx.orgId);
      if (existingMember) {
        return cors(json({ error: "This email is already a member of your team" }, 409), origin);
      }

      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      const now = Date.now();
      const expiresAt = now + 7 * 24 * 3600 * 1000; // 7 days
      const id = randomUUID();

      db.prepare(
        "INSERT INTO invite_tokens (id, org_id, email, token_hash, created_by, expires_at, created_at, account_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(id, authCtx.orgId, email, tokenHash, authCtx.userId, expiresAt, now, inviteType);

      // Build invite URL from validated request origin
      const rawOrigin = req.headers.get("Origin") || "";
      const reqOrigin = getAllowedOrigins().includes(rawOrigin) ? rawOrigin : url.origin;
      const inviteUrl = `${reqOrigin}/#invite/${rawToken}`;

      console.log(`[cookieproof-api] Invite created for ${maskEmail(email)} as ${inviteType} by ${maskEmail(authCtx.email)}`);

      // Optionally send invite email
      let emailSent = false;
      const smtp = getSmtpConfig(authCtx.userId);
      if (data.send_email && smtp.host && smtp.from) {
        const orgRow = db.prepare("SELECT name FROM orgs WHERE id = ?").get(authCtx.orgId) as { name: string | null } | null;
        const orgName = (orgRow?.name || "your team").replace(/[\r\n]/g, "");
        const inviterRow = db.prepare("SELECT display_name FROM users WHERE id = ?").get(authCtx.userId) as { display_name: string | null } | null;
        const inviterName = (inviterRow?.display_name || authCtx.email.split("@")[0]).replace(/[\r\n]/g, "");
        const subject = `${inviterName} invited you to join ${orgName}`.replace(/[\r\n\t]/g, " ").slice(0, 200);
        const emailBody = [
          `From: ${smtp.from}`,
          `To: ${email}`,
          `Subject: ${subject}`,
          `MIME-Version: 1.0`,
          `Content-Type: text/html; charset=UTF-8`,
          ``,
          `<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;">`,
          `<div style="max-width:480px;margin:40px auto;background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">`,
          `<div style="padding:32px 32px 0;">`,
          `<div style="font-size:18px;font-weight:700;color:#0f172a;margin-bottom:8px;">You're invited!</div>`,
          `<p style="font-size:14px;color:#475569;line-height:1.6;margin:0 0 24px;"><strong>${escHtml(inviterName)}</strong> has invited you to join <strong>${escHtml(orgName)}</strong> on CookieProof.</p>`,
          `<a href="${escHtml(inviteUrl)}" style="display:inline-block;padding:12px 28px;background:#0d9488;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">Accept Invitation</a>`,
          `<p style="font-size:12px;color:#94a3b8;margin:20px 0 0;word-break:break-all;">Or copy this link: ${escHtml(inviteUrl)}</p>`,
          `</div>`,
          `<div style="padding:16px 32px;margin-top:24px;background:#f8fafc;border-top:1px solid #e2e8f0;">`,
          `<p style="font-size:11px;color:#94a3b8;margin:0;">This invitation expires in 7 days. If you didn't expect this email, you can safely ignore it.</p>`,
          `</div>`,
          `</div>`,
          `</body></html>`,
        ].join("\r\n");

        try {
          await sendSmtpEmail(smtp.host, smtp.port, smtp.user, smtp.pass, smtp.from, email, emailBody);
          emailSent = true;
          console.log(`[cookieproof-api] Invite email sent to ${maskEmail(email)}`);
        } catch (e: any) {
          console.error("[cookieproof-api] Failed to send invite email:", e.message);
        }
      }

      return cors(json({ invite_url: inviteUrl, email, account_type: inviteType, expires_at: expiresAt, email_sent: emailSent }, 201), origin);
    }

    // ---- GET /api/team/invites (JWT auth, owner only) ----------------------
    if (req.method === "GET" && path === "/api/team/invites") {
      if (authCtx.type !== "jwt") return cors(json({ error: "JWT auth required" }, 403), origin);
      if (authCtx.role !== "owner") return cors(json({ error: "Only the owner can view invites" }, 403), origin);

      const invites = db.prepare(
        "SELECT id, email, account_type, created_at, expires_at FROM invite_tokens WHERE org_id = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC"
      ).all(authCtx.orgId, Date.now()) as { id: string; email: string; account_type: string; created_at: number; expires_at: number }[];
      return cors(json({ invites }), origin);
    }

    // ---- DELETE /api/team/invites/:id (JWT auth, owner only) ---------------
    if (req.method === "DELETE" && path.startsWith("/api/team/invites/")) {
      if (authCtx.type !== "jwt") return cors(json({ error: "JWT auth required" }, 403), origin);
      if (authCtx.role !== "owner") return cors(json({ error: "Only the owner can revoke invites" }, 403), origin);

      const inviteId = path.slice("/api/team/invites/".length);
      if (!inviteId || !UUID_RE.test(inviteId)) {
        return cors(json({ error: "Invalid invite ID" }, 400), origin);
      }

      const result = db.prepare("DELETE FROM invite_tokens WHERE id = ? AND org_id = ?").run(inviteId, authCtx.orgId);
      if (result.changes === 0) return cors(json({ error: "Invite not found" }, 404), origin);
      return cors(json({ revoked: inviteId }), origin);
    }

    // ---- PUT /api/config (auth required) -----------------------------------
    if (req.method === "PUT" && path === "/api/config") {
      try {
        const contentType = req.headers.get("Content-Type") || "";
        if (!contentType.includes("application/json")) {
          return cors(json({ error: "Content-Type must be application/json" }, 415), origin);
        }

        const _cfgBody = await safeJson(req, 64 * 1024);
        if ("error" in _cfgBody) return cors(json({ error: _cfgBody.error }, 400), origin);
        const data = _cfgBody.data;
        const configDomain = typeof data.domain === "string" ? data.domain.trim().toLowerCase() : "";

        if (!configDomain || configDomain.length > 253 ||
            !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(configDomain)) {
          return cors(json({ error: "Invalid or missing 'domain'" }, 400), origin);
        }

        if (!data.config || typeof data.config !== "object") {
          return cors(json({ error: "Missing or invalid 'config' object" }, 400), origin);
        }

        if (data.config.categories && !Array.isArray(data.config.categories)) {
          return cors(json({ error: "config.categories must be an array" }, 400), origin);
        }

        // Validate cssVars: must be a flat object with string values, max 50 keys
        if (data.cssVars) {
          if (typeof data.cssVars !== "object" || Array.isArray(data.cssVars)) {
            return cors(json({ error: "cssVars must be an object" }, 400), origin);
          }
          const cssKeys = Object.keys(data.cssVars);
          if (cssKeys.length > 50) {
            return cors(json({ error: "Too many CSS variables (max 50)" }, 400), origin);
          }
          for (const k of cssKeys) {
            // SECURITY: Validate key length to prevent DoS via excessively long keys
            if (k.length > 100) {
              return cors(json({ error: "CSS variable names must be max 100 chars" }, 400), origin);
            }
            if (typeof data.cssVars[k] !== "string" || data.cssVars[k].length > 200) {
              return cors(json({ error: "CSS variable values must be strings (max 200 chars)" }, 400), origin);
            }
          }
        }

        const configStr = JSON.stringify(data.config);
        const cssVarsStr = data.cssVars ? JSON.stringify(data.cssVars) : null;
        const now = Date.now();

        const orgId = getOrgFilter(authCtx);

        // Atomic ownership check + upsert inside transaction
        db.transaction(() => {
          const existingConfig = db.prepare("SELECT org_id FROM domain_configs WHERE domain = ?").get(configDomain) as { org_id: string | null } | null;
          if (existingConfig) {
            // Domain exists: only the owning org (or API key for unowned domains) can update
            if (existingConfig.org_id && orgId && existingConfig.org_id !== orgId) {
              throw new Error("DOMAIN_OWNED_BY_OTHER_ORG");
            }
            if (existingConfig.org_id && !orgId) {
              // API key trying to overwrite an org-owned domain — block it
              throw new Error("DOMAIN_OWNED_BY_OTHER_ORG");
            }
            db.prepare(
              "UPDATE domain_configs SET config = ?, css_vars = ?, org_id = COALESCE(?, org_id), updated_at = ? WHERE domain = ?"
            ).run(configStr, cssVarsStr, orgId, now, configDomain);
          } else {
            db.prepare(
              "INSERT INTO domain_configs (domain, config, css_vars, org_id, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)"
            ).run(configDomain, configStr, cssVarsStr, orgId, now, now);
          }
        })();

        invalidateOriginCache();
        console.log(`[cookieproof-api] Config saved for domain: ${configDomain}`);
        return cors(json({ domain: configDomain, updatedAt: now }, 200), origin);
      } catch (e: any) {
        if (e?.message === "DOMAIN_OWNED_BY_OTHER_ORG") {
          return cors(json({ error: "This domain is owned by another organization" }, 403), origin);
        }
        return cors(json({ error: "Bad request" }, 400), origin);
      }
    }

    // ---- GET /api/config (auth required, list all) -------------------------
    if (req.method === "GET" && path === "/api/config") {
      // Rate limit config requests to prevent enumeration
      if (isConfigRateLimited(clientIp(req))) {
        return cors(json({ error: "Too many requests. Try again later." }, 429), origin);
      }
      const orgId = getOrgFilter(authCtx);
      const rows = orgId
        ? db.prepare("SELECT domain, config, css_vars, updated_at, created_at FROM domain_configs WHERE org_id = ? ORDER BY updated_at DESC").all(orgId) as any[]
        : listConfigsStmt.all() as any[];
      const configs = rows.map((r: any) => {
        let config, cssVars;
        try { config = JSON.parse(r.config); } catch { config = {}; }
        try { cssVars = r.css_vars ? JSON.parse(r.css_vars) : null; } catch { cssVars = null; }
        return { domain: r.domain, config, cssVars, updatedAt: r.updated_at, createdAt: r.created_at };
      });
      return cors(json({ configs }), origin);
    }

    // ---- GET /api/settings/domains ------------------------------------------
    if (req.method === "GET" && path === "/api/settings/domains") {
      const orgId = getOrgFilter(authCtx);
      const dbRows = orgId
        ? db.prepare("SELECT id, origin, created_at FROM allowed_domains WHERE org_id = ? ORDER BY created_at ASC").all(orgId) as { id: string; origin: string; created_at: number }[]
        : listDomainsStmt.all() as { id: string; origin: string; created_at: number }[];
      const domains: { origin: string; source: "env" | "database" | "auto"; created_at: number | null }[] = [];

      // Only show env-managed domains to admins — they're server-level, not per-org
      const isAdmin = authCtx.type === "jwt" && (authCtx.accountType === "admin" || authCtx.accountType === "super_admin");
      const seen = new Set<string>();
      if (isAdmin) {
        for (const o of ENV_ORIGINS) {
          domains.push({ origin: o, source: "env", created_at: null });
          seen.add(o);
        }
      }

      // Auto-derived origins from domain configs (domain + www variant)
      const configRows = orgId
        ? db.prepare("SELECT domain FROM domain_configs WHERE org_id = ?").all(orgId) as { domain: string }[]
        : db.prepare("SELECT domain FROM domain_configs").all() as { domain: string }[];
      for (const row of configRows) {
        for (const o of deriveOrigins(row.domain)) {
          if (!seen.has(o)) {
            domains.push({ origin: o, source: "auto", created_at: null });
            seen.add(o);
          }
        }
      }

      for (const row of dbRows) {
        if (!seen.has(row.origin)) {
          domains.push({ origin: row.origin, source: "database", created_at: row.created_at });
          seen.add(row.origin);
        }
      }

      return cors(json({ domains }), origin);
    }

    // ---- POST /api/settings/domains -----------------------------------------
    if (req.method === "POST" && path === "/api/settings/domains") {
      try {
        const contentType = req.headers.get("Content-Type") || "";
        if (!contentType.includes("application/json")) {
          return cors(json({ error: "Content-Type must be application/json" }, 415), origin);
        }

        const _domBody = await safeJson(req, MAX_BODY_SIZE);
        if ("error" in _domBody) return cors(json({ error: _domBody.error }, 400), origin);
        const data = _domBody.data;
        const newOrigin = typeof data.origin === "string" ? data.origin.trim() : "";

        if (!newOrigin) {
          return cors(json({ error: "Missing 'origin' field" }, 400), origin);
        }

        let parsed: URL;
        try {
          parsed = new URL(newOrigin);
        } catch {
          return cors(json({ error: "Invalid origin URL" }, 400), origin);
        }

        if (parsed.protocol !== "https:") {
          return cors(json({ error: "Origin must use https:// scheme" }, 400), origin);
        }

        // Normalize: keep origin only (strips path, query, hash, lowercases)
        const normalized = parsed.origin;

        const allOrigins = getAllowedOrigins();
        if (allOrigins.includes(normalized)) {
          return cors(json({ error: "Origin already exists" }, 409), origin);
        }

        const id = randomUUID();
        const createdAt = Date.now();
        const orgId = getOrgFilter(authCtx);
        db.prepare(
          "INSERT INTO allowed_domains (id, origin, org_id, created_at) VALUES (?, ?, ?, ?)"
        ).run(id, normalized, orgId, createdAt);

        invalidateOriginCache();
        // SECURITY: Log domain additions for audit trail
        if (authCtx.type === "jwt") {
          logAuditEvent(authCtx.userId, "domain_add", { origin: normalized }, req, authCtx.orgId);
        }
        console.log(`[cookieproof-api] Domain added: ${normalized}`);
        return cors(json({ id, origin: normalized, created_at: createdAt }, 201), origin);
      } catch {
        return cors(json({ error: "Bad request" }, 400), origin);
      }
    }

    // ---- DELETE /api/settings/domains ---------------------------------------
    if (req.method === "DELETE" && path === "/api/settings/domains") {
      try {
        const contentType = req.headers.get("Content-Type") || "";
        if (!contentType.includes("application/json")) {
          return cors(json({ error: "Content-Type must be application/json" }, 415), origin);
        }

        const _delBody = await safeJson(req, MAX_BODY_SIZE);
        if ("error" in _delBody) return cors(json({ error: _delBody.error }, 400), origin);
        const data = _delBody.data;
        const targetOrigin = typeof data.origin === "string" ? data.origin.trim() : "";

        if (!targetOrigin) {
          return cors(json({ error: "Missing 'origin' field" }, 400), origin);
        }

        if (ENV_ORIGINS.includes(targetOrigin)) {
          return cors(json({ error: "Cannot remove environment-managed domain. Remove it from ALLOWED_ORIGINS env var and restart." }, 400), origin);
        }

        const orgId = getOrgFilter(authCtx);
        const result = orgId
          ? db.prepare("DELETE FROM allowed_domains WHERE origin = ? AND org_id = ?").run(targetOrigin, orgId)
          : db.prepare("DELETE FROM allowed_domains WHERE origin = ?").run(targetOrigin);

        if (result.changes === 0) {
          return cors(json({ error: "Domain not found" }, 404), origin);
        }

        invalidateOriginCache();
        // SECURITY: Log domain removals for audit trail
        if (authCtx.type === "jwt") {
          logAuditEvent(authCtx.userId, "domain_remove", { origin: targetOrigin }, req, authCtx.orgId);
        }
        console.log(`[cookieproof-api] Domain removed: ${targetOrigin}`);
        return cors(json({ removed: targetOrigin }), origin);
      } catch {
        return cors(json({ error: "Bad request" }, 400), origin);
      }
    }

    // ---- GET /api/proof ----------------------------------------------------
    if (req.method === "GET" && path === "/api/proof") {
      const orgId = getOrgFilter(authCtx);
      const rawDomain = url.searchParams.get("domain");
      const method = url.searchParams.get("method");
      if (method && !VALID_METHODS.has(method)) {
        return cors(json({ error: `Invalid method. Must be one of: ${[...VALID_METHODS].join(", ")}` }, 400), origin);
      }
      const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 500);
      const offset = Math.min(Math.max(Number(url.searchParams.get("offset")) || 0, 0), 100000);
      const from = Math.max(0, Number(url.searchParams.get("from")) || 0);
      const to = Math.min(Date.now() + 86400000, Number(url.searchParams.get("to")) || Date.now() + 86400000);

      if (from > to) {
        return cors(json({ error: "'from' must be before 'to'" }, 400), origin);
      }

      // Org-scoped domain filtering
      let rows: any[];
      let total: number;
      if (orgId) {
        const orgDomains = getOrgDomains(orgId);
        // Validate domain param against org ownership
        if (rawDomain && !orgDomains.includes(rawDomain)) {
          return cors(json({ data: [], total: 0, limit, offset }), origin);
        }
        const targetDomains = rawDomain ? [rawDomain] : orgDomains;
        if (targetDomains.length === 0) {
          return cors(json({ data: [], total: 0, limit, offset }), origin);
        }
        const placeholders = targetDomains.map(() => "?").join(",");
        rows = db.prepare(`
          SELECT * FROM consent_proofs
          WHERE domain IN (${placeholders})
            AND created_at >= ? AND created_at <= ?
            AND (? IS NULL OR method = ?)
          ORDER BY created_at DESC LIMIT ? OFFSET ?
        `).all(...targetDomains, from, to, method || null, method || null, limit, offset);
        const countRow = db.prepare(`
          SELECT COUNT(*) as total FROM consent_proofs
          WHERE domain IN (${placeholders})
            AND created_at >= ? AND created_at <= ?
            AND (? IS NULL OR method = ?)
        `).get(...targetDomains, from, to, method || null, method || null) as { total: number };
        total = countRow.total;
      } else {
        // API key: service-level
        const domainFilter = domainParam(rawDomain);
        rows = listStmt.all({ $domain: domainFilter, $from: from, $to: to, $method: method || null, $limit: limit, $offset: offset });
        total = (countStmt.get({ $domain: domainFilter, $from: from, $to: to, $method: method || null }) as { total: number }).total;
      }

      const data = (rows as any[]).map((r) => {
        let categories;
        try { categories = JSON.parse(r.categories); } catch { categories = []; }
        return { ...r, categories };
      });

      return cors(json({ data, total, limit, offset }), origin);
    }

    // ---- GET /api/proof/stats ----------------------------------------------
    if (req.method === "GET" && path === "/api/proof/stats") {
      const orgId = getOrgFilter(authCtx);
      const rawDomain = url.searchParams.get("domain");
      const method = url.searchParams.get("method");
      if (method && !VALID_METHODS.has(method)) {
        return cors(json({ error: `Invalid method. Must be one of: ${[...VALID_METHODS].join(", ")}` }, 400), origin);
      }
      const from = Math.max(0, Number(url.searchParams.get("from")) || 0);
      const to = Math.min(Date.now() + 86400000, Number(url.searchParams.get("to")) || Date.now() + 86400000);

      try {
        const defaultSummary = { total: 0, accept_all: 0, reject_all: 0, custom: 0, gpc: 0, do_not_sell: 0 };

        // Resolve org-scoped domain list
        if (orgId) {
          const orgDomains = getOrgDomains(orgId);
          // If a specific domain is requested, verify ownership
          if (rawDomain && !orgDomains.includes(rawDomain)) {
            return cors(json({ summary: defaultSummary, daily: [] }), origin);
          }
          const targetDomains = rawDomain ? [rawDomain] : orgDomains;
          if (targetDomains.length === 0) {
            return cors(json({ summary: defaultSummary, daily: [] }), origin);
          }
          const placeholders = targetDomains.map(() => "?").join(",");
          const domainValues = targetDomains;
          const methodClause = method ? "AND method = ?" : "";
          const params = [...domainValues, from, to, ...(method ? [method] : [])];

          const summary = db.prepare(`
            SELECT COUNT(*) as total,
              COALESCE(SUM(CASE WHEN method = 'accept-all' THEN 1 ELSE 0 END), 0) as accept_all,
              COALESCE(SUM(CASE WHEN method = 'reject-all' THEN 1 ELSE 0 END), 0) as reject_all,
              COALESCE(SUM(CASE WHEN method = 'custom' THEN 1 ELSE 0 END), 0) as custom,
              COALESCE(SUM(CASE WHEN method = 'gpc' THEN 1 ELSE 0 END), 0) as gpc,
              COALESCE(SUM(CASE WHEN method IN ('dns', 'do-not-sell') THEN 1 ELSE 0 END), 0) as do_not_sell
            FROM consent_proofs
            WHERE domain IN (${placeholders}) AND created_at >= ? AND created_at <= ? ${methodClause}
          `).get(...params);
          const daily = db.prepare(`
            SELECT date(created_at / 1000, 'unixepoch') as day, COUNT(*) as total,
              COALESCE(SUM(CASE WHEN method = 'accept-all' THEN 1 ELSE 0 END), 0) as accept_all,
              COALESCE(SUM(CASE WHEN method = 'reject-all' THEN 1 ELSE 0 END), 0) as reject_all,
              COALESCE(SUM(CASE WHEN method = 'custom' THEN 1 ELSE 0 END), 0) as custom,
              COALESCE(SUM(CASE WHEN method = 'gpc' THEN 1 ELSE 0 END), 0) as gpc,
              COALESCE(SUM(CASE WHEN method IN ('dns', 'do-not-sell') THEN 1 ELSE 0 END), 0) as do_not_sell
            FROM consent_proofs
            WHERE domain IN (${placeholders}) AND created_at >= ? AND created_at <= ? ${methodClause}
            GROUP BY day ORDER BY day ASC LIMIT 90
          `).all(...params);
          return cors(json({ summary: summary ?? defaultSummary, daily: daily ?? [] }), origin);
        }

        // API key: service-level (no org scoping)
        const domain = domainParam(rawDomain);
        const baseParams = { $domain: domain, $from: from, $to: to };
        const summary = method
          ? statsStmtMethod.get({ ...baseParams, $method: method })
          : statsStmtAll.get(baseParams);
        const daily = method
          ? dailyStmtMethod.all({ ...baseParams, $method: method })
          : dailyStmtAll.all(baseParams);

        return cors(json({ summary: summary ?? defaultSummary, daily: daily ?? [] }), origin);
      } catch (e: any) {
        console.error(`[cookieproof-api] Stats query error: ${e?.message || e}`);
        return cors(json({ error: "Stats query failed" }, 500), origin);
      }
    }

    // ---- GET /api/proof/analytics — enhanced analytics with trends ----------
    if (req.method === "GET" && path === "/api/proof/analytics") {
      const orgId = getOrgFilter(authCtx);
      if (!orgId) {
        return cors(json({ error: "Organization required" }, 400), origin);
      }

      const orgDomains = getOrgDomains(orgId);
      if (orgDomains.length === 0) {
        return cors(json({
          summary: { total: 0, accept_all: 0, reject_all: 0, custom: 0, gpc: 0 },
          trends: { week_over_week: 0, month_over_month: 0 },
          categories: {},
          browsers: {},
          platforms: {},
          hourly: [],
        }), origin);
      }

      const ph = orgDomains.map(() => "?").join(",");
      const now = Date.now();
      const sevenDaysAgo = now - 7 * 24 * 3600 * 1000;
      const fourteenDaysAgo = now - 14 * 24 * 3600 * 1000;
      const thirtyDaysAgo = now - 30 * 24 * 3600 * 1000;
      const sixtyDaysAgo = now - 60 * 24 * 3600 * 1000;

      try {
        // Summary for last 30 days (includes all method types for accurate totals)
        const summary = db.prepare(`
          SELECT COUNT(*) as total,
            COALESCE(SUM(CASE WHEN method = 'accept-all' THEN 1 ELSE 0 END), 0) as accept_all,
            COALESCE(SUM(CASE WHEN method = 'reject-all' THEN 1 ELSE 0 END), 0) as reject_all,
            COALESCE(SUM(CASE WHEN method = 'custom' THEN 1 ELSE 0 END), 0) as custom,
            COALESCE(SUM(CASE WHEN method = 'gpc' THEN 1 ELSE 0 END), 0) as gpc,
            COALESCE(SUM(CASE WHEN method IN ('dns', 'do-not-sell') THEN 1 ELSE 0 END), 0) as do_not_sell
          FROM consent_proofs WHERE domain IN (${ph}) AND created_at >= ?
        `).get(...orgDomains, thirtyDaysAgo) as { total: number; accept_all: number; reject_all: number; custom: number; gpc: number; do_not_sell: number };

        // Week-over-week trend
        const thisWeek = (db.prepare(`SELECT COUNT(*) as cnt FROM consent_proofs WHERE domain IN (${ph}) AND created_at >= ?`)
          .get(...orgDomains, sevenDaysAgo) as { cnt: number }).cnt;
        const lastWeek = (db.prepare(`SELECT COUNT(*) as cnt FROM consent_proofs WHERE domain IN (${ph}) AND created_at >= ? AND created_at < ?`)
          .get(...orgDomains, fourteenDaysAgo, sevenDaysAgo) as { cnt: number }).cnt;
        const weekOverWeek = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : (thisWeek > 0 ? 100 : 0);

        // Month-over-month trend
        const thisMonth = (db.prepare(`SELECT COUNT(*) as cnt FROM consent_proofs WHERE domain IN (${ph}) AND created_at >= ?`)
          .get(...orgDomains, thirtyDaysAgo) as { cnt: number }).cnt;
        const lastMonth = (db.prepare(`SELECT COUNT(*) as cnt FROM consent_proofs WHERE domain IN (${ph}) AND created_at >= ? AND created_at < ?`)
          .get(...orgDomains, sixtyDaysAgo, thirtyDaysAgo) as { cnt: number }).cnt;
        const monthOverMonth = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : (thisMonth > 0 ? 100 : 0);

        // Category breakdown (parse JSON categories)
        const categoryRows = db.prepare(`
          SELECT categories FROM consent_proofs WHERE domain IN (${ph}) AND created_at >= ? AND categories IS NOT NULL
        `).all(...orgDomains, thirtyDaysAgo) as { categories: string }[];

        const categoryCounts: Record<string, { granted: number; denied: number }> = {};
        for (const row of categoryRows) {
          try {
            const cats = JSON.parse(row.categories);
            for (const [key, value] of Object.entries(cats)) {
              if (!categoryCounts[key]) categoryCounts[key] = { granted: 0, denied: 0 };
              if (value) categoryCounts[key].granted++;
              else categoryCounts[key].denied++;
            }
          } catch {}
        }

        // Browser/platform stats from user_agent
        const uaRows = db.prepare(`
          SELECT user_agent FROM consent_proofs WHERE domain IN (${ph}) AND created_at >= ? AND user_agent IS NOT NULL LIMIT 5000
        `).all(...orgDomains, thirtyDaysAgo) as { user_agent: string }[];

        const browserCounts: Record<string, number> = {};
        const platformCounts: Record<string, number> = {};
        for (const row of uaRows) {
          const ua = row.user_agent.toLowerCase();
          // Simple browser detection
          let browser = "Other";
          if (ua.includes("edg/")) browser = "Edge";
          else if (ua.includes("chrome/") && !ua.includes("edg/")) browser = "Chrome";
          else if (ua.includes("firefox/")) browser = "Firefox";
          else if (ua.includes("safari/") && !ua.includes("chrome/")) browser = "Safari";
          else if (ua.includes("opera/") || ua.includes("opr/")) browser = "Opera";
          browserCounts[browser] = (browserCounts[browser] || 0) + 1;

          // Simple platform detection
          let platform = "Other";
          if (ua.includes("android")) platform = "Android";
          else if (ua.includes("iphone") || ua.includes("ipad")) platform = "iOS";
          else if (ua.includes("windows")) platform = "Windows";
          else if (ua.includes("macintosh") || ua.includes("mac os")) platform = "macOS";
          else if (ua.includes("linux")) platform = "Linux";
          platformCounts[platform] = (platformCounts[platform] || 0) + 1;
        }

        // Hourly distribution (last 7 days)
        const hourlyRows = db.prepare(`
          SELECT strftime('%H', datetime(created_at/1000, 'unixepoch')) as hour, COUNT(*) as count
          FROM consent_proofs WHERE domain IN (${ph}) AND created_at >= ?
          GROUP BY hour ORDER BY hour ASC
        `).all(...orgDomains, sevenDaysAgo) as { hour: string; count: number }[];

        // Fill in missing hours with 0
        const hourly: { hour: number; count: number }[] = [];
        for (let h = 0; h < 24; h++) {
          const row = hourlyRows.find(r => parseInt(r.hour) === h);
          hourly.push({ hour: h, count: row?.count || 0 });
        }

        return cors(json({
          summary,
          trends: { week_over_week: weekOverWeek, month_over_month: monthOverMonth },
          categories: categoryCounts,
          browsers: browserCounts,
          platforms: platformCounts,
          hourly,
        }), origin);
      } catch (e: any) {
        console.error(`[cookieproof-api] Analytics query error: ${e?.message || e}`);
        return cors(json({ error: "Analytics query failed" }, 500), origin);
      }
    }

    // ---- GET /api/telemetry/stats -------------------------------------------
    if (req.method === "GET" && path === "/api/telemetry/stats") {
      const orgId = getOrgFilter(authCtx);
      const orgDomains = orgId ? getOrgDomains(orgId) : [];
      if (orgDomains.length === 0) {
        return cors(json({ telemetry: [], configFetches: [] }), origin);
      }
      const ph = orgDomains.map(() => "?").join(",");

      const telemetry = db.prepare(`
        SELECT domain, event_type, COUNT(*) as count, MAX(created_at) as last_seen
        FROM telemetry_events WHERE domain IN (${ph}) AND created_at >= ?
        GROUP BY domain, event_type ORDER BY count DESC
      `).all(...orgDomains, Date.now() - 30 * 24 * 3600 * 1000);

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const configFetches = db.prepare(`
        SELECT domain, day, fetch_count FROM config_fetch_daily
        WHERE domain IN (${ph}) AND day >= ? ORDER BY day DESC
      `).all(...orgDomains, thirtyDaysAgo);

      return cors(json({ telemetry, configFetches }), origin);
    }

    // ---- GET /api/audit — audit log for user/org ----------------------------
    if (req.method === "GET" && path === "/api/audit") {
      const ctx = getAuthContextWithCsrf(req);
      if (!ctx || ctx.type !== "jwt") {
        return cors(json({ error: "Unauthorized" }, 401), origin);
      }

      const limit = Math.min(parseInt(String(url.searchParams.get("limit"))) || 50, 200);
      const offset = parseInt(String(url.searchParams.get("offset"))) || 0;
      const actionFilter = url.searchParams.get("action") || null;

      // Users see their own audit log, owners see org-wide audit log
      let whereClause = "user_id = ?";
      let params: any[] = [ctx.userId];

      // If user is owner/admin, show full org audit log
      if (ctx.orgId && (ctx.role === "owner" || isAdmin(ctx))) {
        whereClause = "(user_id = ? OR org_id = ?)";
        params = [ctx.userId, ctx.orgId];
      }

      if (actionFilter) {
        whereClause += " AND action = ?";
        params.push(actionFilter);
      }

      const events = db.prepare(`
        SELECT a.id, a.user_id, a.org_id, a.action, a.details, a.ip_address, a.created_at,
               u.email as user_email
        FROM audit_log a
        LEFT JOIN users u ON u.id = a.user_id
        WHERE ${whereClause}
        ORDER BY a.created_at DESC
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset) as any[];

      const total = (db.prepare(`SELECT COUNT(*) as cnt FROM audit_log WHERE ${whereClause}`)
        .get(...params) as { cnt: number }).cnt;

      // Parse details JSON
      const enrichedEvents = events.map(e => ({
        ...e,
        details: e.details ? JSON.parse(e.details) : null,
      }));

      return cors(json({ events: enrichedEvents, total, limit, offset }), origin);
    }

    // ---- GET /api/webhooks — list webhooks for org --------------------------
    if (req.method === "GET" && path === "/api/webhooks") {
      const ctx = getAuthContextWithCsrf(req);
      if (!ctx || ctx.type !== "jwt") {
        return cors(json({ error: "Unauthorized" }, 401), origin);
      }

      const webhooks = db.prepare(`
        SELECT w.id, w.url, w.events, w.enabled, w.created_at, w.updated_at,
               w.last_triggered_at, w.last_status, w.failure_count,
               u.email as created_by_email
        FROM webhooks w
        LEFT JOIN users u ON u.id = w.created_by
        WHERE w.org_id = ?
        ORDER BY w.created_at DESC
      `).all(ctx.orgId) as any[];

      return cors(json({
        webhooks: webhooks.map(w => ({
          ...w,
          events: JSON.parse(w.events || '["consent.recorded"]'),
          secret: undefined, // Never expose secret
        })),
      }), origin);
    }

    // ---- POST /api/webhooks — create webhook --------------------------------
    if (req.method === "POST" && path === "/api/webhooks") {
      const ctx = getAuthContextWithCsrf(req);
      if (!ctx || ctx.type !== "jwt") {
        return cors(json({ error: "Unauthorized" }, 401), origin);
      }
      // Rate limit webhook operations
      if (isWebhookRateLimited(ctx.userId)) {
        return cors(json({ error: "Webhook rate limit exceeded. Try again later." }, 429), origin);
      }

      // Only owners/admins can create webhooks
      if (ctx.role !== "owner" && !isAdmin(ctx)) {
        return cors(json({ error: "Only organization owners can manage webhooks" }, 403), origin);
      }

      let data: any;
      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      data = _body.data;

      const webhookUrl = typeof data.url === "string" ? data.url.trim() : "";
      const secret = typeof data.secret === "string" ? data.secret.trim() : "";
      const events = Array.isArray(data.events) ? data.events.filter((e: any) => typeof e === "string") : ["consent.recorded"];

      // Validate URL
      if (!webhookUrl) {
        return cors(json({ error: "Webhook URL is required" }, 400), origin);
      }
      // SECURITY: Prevent DoS via excessively long URLs
      if (webhookUrl.length > 2048) {
        return cors(json({ error: "Webhook URL too long (max 2048 chars)" }, 400), origin);
      }
      try {
        const parsed = new URL(webhookUrl);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          return cors(json({ error: "Webhook URL must use http or https" }, 400), origin);
        }
        if (isPrivateHost(parsed.hostname)) {
          return cors(json({ error: "Webhook URL cannot point to private/internal addresses" }, 400), origin);
        }
      } catch {
        return cors(json({ error: "Invalid webhook URL" }, 400), origin);
      }

      // Validate events
      const validEvents = ["consent.recorded", "*"];
      for (const event of events) {
        if (!validEvents.includes(event)) {
          return cors(json({ error: `Invalid event type: ${event}` }, 400), origin);
        }
      }

      // SECURITY: Webhook secret minimum length (32 chars = 256 bits for HMAC-SHA256)
      if (secret && secret.length < 32) {
        return cors(json({ error: "Webhook secret must be at least 32 characters for secure HMAC signing" }, 400), origin);
      }

      // Limit webhooks per org
      const existing = (db.prepare("SELECT COUNT(*) as cnt FROM webhooks WHERE org_id = ?")
        .get(ctx.orgId) as { cnt: number }).cnt;
      if (existing >= 10) {
        return cors(json({ error: "Maximum of 10 webhooks per organization" }, 400), origin);
      }

      const id = randomUUID();
      const now = Date.now();

      db.prepare(`
        INSERT INTO webhooks (id, org_id, url, secret, events, enabled, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
      `).run(id, ctx.orgId, webhookUrl, secret || null, JSON.stringify(events), ctx.userId, now, now);

      logAuditEvent(ctx.userId, "webhook_create", { webhook_id: id, url: webhookUrl }, req, ctx.orgId);
      console.log(`[cookieproof-api] Webhook created: ${id} for org ${ctx.orgId}`);

      return cors(json({
        id,
        url: webhookUrl,
        events,
        enabled: true,
        created_at: now,
      }, 201), origin);
    }

    // ---- PUT /api/webhooks/:id — update webhook -----------------------------
    if (req.method === "PUT" && path.startsWith("/api/webhooks/") && path.split("/").length === 4) {
      const ctx = getAuthContextWithCsrf(req);
      if (!ctx || ctx.type !== "jwt") {
        return cors(json({ error: "Unauthorized" }, 401), origin);
      }
      // Rate limit webhook operations
      if (isWebhookRateLimited(ctx.userId)) {
        return cors(json({ error: "Webhook rate limit exceeded. Try again later." }, 429), origin);
      }

      if (ctx.role !== "owner" && !isAdmin(ctx)) {
        return cors(json({ error: "Only organization owners can manage webhooks" }, 403), origin);
      }

      const webhookId = path.split("/")[3];
      const webhook = db.prepare("SELECT id, org_id FROM webhooks WHERE id = ?")
        .get(webhookId) as { id: string; org_id: string } | null;

      if (!webhook || webhook.org_id !== ctx.orgId) {
        return cors(json({ error: "Webhook not found" }, 404), origin);
      }

      let data: any;
      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      data = _body.data;

      const updates: string[] = [];
      const values: any[] = [];

      if (typeof data.url === "string") {
        const webhookUrl = data.url.trim();
        try {
          const parsed = new URL(webhookUrl);
          if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
            return cors(json({ error: "Webhook URL must use http or https" }, 400), origin);
          }
          if (isPrivateHost(parsed.hostname)) {
            return cors(json({ error: "Webhook URL cannot point to private/internal addresses" }, 400), origin);
          }
        } catch {
          return cors(json({ error: "Invalid webhook URL" }, 400), origin);
        }
        updates.push("url = ?");
        values.push(webhookUrl);
      }

      if (typeof data.secret === "string") {
        const newSecret = data.secret.trim();
        // SECURITY: Webhook secret minimum length (32 chars = 256 bits for HMAC-SHA256)
        if (newSecret && newSecret.length < 32) {
          return cors(json({ error: "Webhook secret must be at least 32 characters for secure HMAC signing" }, 400), origin);
        }
        updates.push("secret = ?");
        values.push(newSecret || null);
      }

      if (Array.isArray(data.events)) {
        const validEvents = ["consent.recorded", "*"];
        for (const event of data.events) {
          if (!validEvents.includes(event)) {
            return cors(json({ error: `Invalid event type: ${event}` }, 400), origin);
          }
        }
        updates.push("events = ?");
        values.push(JSON.stringify(data.events));
      }

      if (typeof data.enabled === "boolean") {
        updates.push("enabled = ?");
        values.push(data.enabled ? 1 : 0);
        // Reset failure count when re-enabling
        if (data.enabled) {
          updates.push("failure_count = 0");
        }
      }

      if (updates.length === 0) {
        return cors(json({ error: "No fields to update" }, 400), origin);
      }

      updates.push("updated_at = ?");
      values.push(Date.now());
      values.push(webhookId);

      db.prepare(`UPDATE webhooks SET ${updates.join(", ")} WHERE id = ?`).run(...values);

      return cors(json({ ok: true }), origin);
    }

    // ---- DELETE /api/webhooks/:id — delete webhook --------------------------
    if (req.method === "DELETE" && path.startsWith("/api/webhooks/") && path.split("/").length === 4) {
      const ctx = getAuthContextWithCsrf(req);
      if (!ctx || ctx.type !== "jwt") {
        return cors(json({ error: "Unauthorized" }, 401), origin);
      }
      // Rate limit webhook operations
      if (isWebhookRateLimited(ctx.userId)) {
        return cors(json({ error: "Webhook rate limit exceeded. Try again later." }, 429), origin);
      }

      if (ctx.role !== "owner" && !isAdmin(ctx)) {
        return cors(json({ error: "Only organization owners can manage webhooks" }, 403), origin);
      }

      const webhookId = path.split("/")[3];
      const webhook = db.prepare("SELECT id, org_id, url FROM webhooks WHERE id = ?")
        .get(webhookId) as { id: string; org_id: string; url: string } | null;

      if (!webhook || webhook.org_id !== ctx.orgId) {
        return cors(json({ error: "Webhook not found" }, 404), origin);
      }

      db.prepare("DELETE FROM webhooks WHERE id = ?").run(webhookId);
      logAuditEvent(ctx.userId, "webhook_delete", { webhook_id: webhookId, url: webhook.url }, req, ctx.orgId);
      console.log(`[cookieproof-api] Webhook deleted: ${webhookId}`);

      return cors(json({ ok: true, deleted: true }), origin);
    }

    // ---- POST /api/webhooks/:id/test — test webhook -------------------------
    if (req.method === "POST" && path.match(/^\/api\/webhooks\/[^/]+\/test$/)) {
      const ctx = getAuthContextWithCsrf(req);
      if (!ctx || ctx.type !== "jwt") {
        return cors(json({ error: "Unauthorized" }, 401), origin);
      }
      // Rate limit webhook operations (tests count toward limit)
      if (isWebhookRateLimited(ctx.userId)) {
        return cors(json({ error: "Webhook rate limit exceeded. Try again later." }, 429), origin);
      }

      const webhookId = path.split("/")[3];
      const webhook = db.prepare("SELECT id, org_id, url, secret FROM webhooks WHERE id = ?")
        .get(webhookId) as { id: string; org_id: string; url: string; secret: string | null } | null;

      if (!webhook || webhook.org_id !== ctx.orgId) {
        return cors(json({ error: "Webhook not found" }, 404), origin);
      }

      // Send test payload
      const testPayload = {
        event: "test",
        data: {
          message: "This is a test webhook from CookieProof",
          webhook_id: webhookId,
          org_id: ctx.orgId,
        },
        timestamp: Date.now(),
      };

      const body = JSON.stringify(testPayload);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (webhook.secret) {
        headers["X-Webhook-Signature"] = createHmac("sha256", webhook.secret).update(body).digest("hex");
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);

        const res = await fetch(webhook.url, {
          method: "POST",
          headers,
          body,
          redirect: "manual",
          signal: controller.signal,
        });
        clearTimeout(timeout);

        db.prepare("UPDATE webhooks SET last_triggered_at = ?, last_status = ? WHERE id = ?")
          .run(Date.now(), res.status, webhookId);

        if (res.ok) {
          return cors(json({ ok: true, status: res.status }), origin);
        } else {
          return cors(json({ ok: false, status: res.status, error: `HTTP ${res.status}` }), origin);
        }
      } catch (e: any) {
        const errorMsg = e?.name === "AbortError" ? "Request timed out" : (e?.message || "Connection failed");
        return cors(json({ ok: false, error: errorMsg }), origin);
      }
    }

    // ---- GET /api/proof/export ----------------------------------------------
    if (req.method === "GET" && path === "/api/proof/export") {
      // Rate limit exports to prevent DoS via expensive queries
      if (authCtx.type === "jwt" && isExportRateLimited(authCtx.userId)) {
        return cors(json({ error: "Export rate limit exceeded. Try again later." }, 429), origin);
      }
      const orgId = getOrgFilter(authCtx);
      const rawDomain = url.searchParams.get("domain");
      const method = url.searchParams.get("method");
      if (method && !VALID_METHODS.has(method)) {
        return cors(json({ error: "Invalid method filter" }, 400), origin);
      }
      const from = Math.max(0, Number(url.searchParams.get("from")) || 0);
      const to = Math.min(Date.now() + 86400000, Number(url.searchParams.get("to")) || Date.now() + 86400000);

      let rows: any[];
      if (orgId) {
        // JWT auth: scope to org-owned domains
        const orgDomains = getOrgDomains(orgId);
        if (rawDomain && !orgDomains.includes(rawDomain)) {
          rows = [];
        } else {
          const targetDomains = rawDomain ? [rawDomain] : orgDomains;
          if (targetDomains.length === 0) {
            rows = [];
          } else {
            const placeholders = targetDomains.map(() => "?").join(",");
            const methodClause = method ? "AND method = ?" : "";
            rows = db.prepare(`
              SELECT * FROM consent_proofs
              WHERE domain IN (${placeholders}) AND created_at >= ? AND created_at <= ? ${methodClause}
              ORDER BY created_at DESC LIMIT 100000
            `).all(...[...targetDomains, from, to, ...(method ? [method] : [])]) as any[];
          }
        }
      } else {
        // API key: service-level
        const domain = domainParam(rawDomain);
        rows = exportStmt.all({ $domain: domain, $from: from, $to: to, $method: method || null }) as any[];
      }

      const header = "id,domain,url,method,categories,version,ip,user_agent,created_at\n";
      const csvRows = rows.map(r => {
        const cats = r.categories; // already JSON string
        return [
          csvEscape(r.id),
          csvEscape(r.domain),
          csvEscape(r.url || ""),
          csvEscape(r.method),
          csvEscape(cats),
          csvEscape(String(r.version)),
          csvEscape(r.ip || ""),
          csvEscape(r.user_agent || ""),
          csvEscape(String(r.created_at)),
        ].join(",");
      }).join("\n");

      const csv = header + csvRows;

      // SECURITY: Log data export for audit trail
      if (authCtx.type === "jwt") {
        logAuditEvent(authCtx.userId, "data_export", {
          format: "csv",
          records: rows.length,
          domain: rawDomain || "all",
          from,
          to,
        }, req, authCtx.orgId);
      }

      const res = new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="consent-proofs-${Date.now()}.csv"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
        },
      });
      return cors(res, origin);
    }

    // ---- GET /api/proof/:id ------------------------------------------------
    if (req.method === "GET" && path.startsWith("/api/proof/")) {
      const id = path.slice("/api/proof/".length);
      if (!id || id.includes("/") || !UUID_RE.test(id)) {
        return cors(json({ error: "Invalid proof ID format" }, 400), origin);
      }
      const row = getStmt.get({ $id: id }) as any;
      if (!row) return cors(json({ error: "Not found" }, 404), origin);
      // Org scoping: verify the proof's domain belongs to the requesting org
      const orgId = getOrgFilter(authCtx);
      if (orgId && !isOrgDomain(orgId, row.domain)) {
        return cors(json({ error: "Not found" }, 404), origin);
      }
      try { row.categories = JSON.parse(row.categories); } catch { row.categories = []; }
      return cors(json(row), origin);
    }

    // ---- DELETE /api/proof --------------------------------------------------
    if (req.method === "DELETE" && path === "/api/proof") {
      const beforeStr = url.searchParams.get("before");
      const before = beforeStr ? Number(beforeStr) : NaN;
      if (!beforeStr || isNaN(before) || before <= 0)
        return cors(json({ error: "Missing or invalid 'before' timestamp" }, 400), origin);
      const MIN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
      if (before > Date.now()) {
        return cors(json({ error: "'before' must be in the past" }, 400), origin);
      }
      if (before > Date.now() - MIN_RETENTION_MS) {
        return cors(json({ error: "Cannot delete records less than 30 days old" }, 400), origin);
      }
      const domain = url.searchParams.get("domain");
      if (!domain) {
        return cors(json({ error: "Missing 'domain' parameter. Pass domain=* to delete across all domains." }, 400), origin);
      }
      const orgId = getOrgFilter(authCtx);
      let result;
      if (orgId) {
        // JWT auth: restrict deletion to org-owned domains
        const ownedDomains = getOrgDomains(orgId);
        if (ownedDomains.length === 0) {
          return cors(json({ deleted: 0 }), origin);
        }
        if (domain !== "*" && !ownedDomains.includes(domain)) {
          return cors(json({ error: "Domain not found in your organization" }, 403), origin);
        }
        const targetDomains = domain === "*" ? ownedDomains : [domain];
        const placeholders = targetDomains.map(() => "?").join(",");
        result = db.prepare(
          `DELETE FROM consent_proofs WHERE created_at < ? AND domain IN (${placeholders})`
        ).run(before, ...targetDomains);
      } else {
        // API key: service-level (all domains)
        if (domain === "*") {
          result = deleteStmt.run({ $before: before });
        } else {
          result = deleteDomainStmt.run({ $before: before, $domain: escapeLike(domain) });
        }
      }
      return cors(json({ deleted: result.changes }), origin);
    }

    // ---- GET /api/scan -----------------------------------------------------
    if (req.method === "GET" && path === "/api/scan") {
      // Rate limit scans (10/hour/IP)
      const scanIp = clientIp(req);
      if (isScanRateLimited(scanIp)) {
        return cors(json({ error: "Too many scan requests. Try again later." }, 429), origin);
      }

      const targetUrl = url.searchParams.get("url");
      if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
        return cors(json({ error: "Missing or invalid 'url' parameter. Must start with http:// or https://" }, 400), origin);
      }

      // SSRF protection – block private/internal addresses + DNS rebinding
      let resolvedIp: string | null = null;
      let parsedScanUrl: URL;
      try {
        parsedScanUrl = new URL(targetUrl);
        if (isPrivateHost(parsedScanUrl.hostname)) {
          return cors(json({ error: "Scanning internal/private addresses is not allowed" }, 403), origin);
        }
        // Resolve DNS and pin the IP to prevent DNS rebinding attacks
        resolvedIp = await resolveAndCheckHost(parsedScanUrl.hostname);
        if (!resolvedIp) {
          return cors(json({ error: "Hostname resolves to a private/internal address or could not be resolved" }, 403), origin);
        }
      } catch {
        return cors(json({ error: "Invalid URL" }, 400), origin);
      }

      try {
        const MAX_HTML_SIZE = 10 * 1024 * 1024; // 10 MB
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000); // 15s timeout

        // Pin the resolved IP to prevent DNS rebinding between check and fetch
        const pinnedUrl = new URL(targetUrl);
        pinnedUrl.hostname = resolvedIp;
        const response = await fetch(pinnedUrl.toString(), {
          headers: {
            'User-Agent': 'cookieproof-scanner/1.0',
            'Host': parsedScanUrl.hostname, // Preserve original Host header
          },
          redirect: 'manual', // Don't follow redirects — prevents SSRF via redirect chain
          signal: controller.signal,
        });
        clearTimeout(timeout);

        // If the server redirects, verify the target isn't private before following
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("Location");
          if (location) {
            try {
              const redirectUrl = new URL(location, targetUrl);
              if (isPrivateHost(redirectUrl.hostname)) {
                return cors(json({ error: "Redirect target is a private/internal address" }, 403), origin);
              }
            } catch {
              return cors(json({ error: "Invalid redirect URL in Location header" }, 400), origin);
            }
          }
          return cors(json({ error: `URL redirected (${response.status}). Redirect scanning is disabled for security.` }, 400), origin);
        }

        if (!response.ok) {
          return cors(json({ error: `Failed to fetch URL: ${response.status} ${response.statusText}` }, 502), origin);
        }

        // Only scan HTML responses — reject PDFs, images, binaries, etc.
        const contentType = response.headers.get("Content-Type") || "";
        if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
          return cors(json({ error: `URL returned non-HTML content (${contentType.split(";")[0].trim() || "unknown"})` }, 400), origin);
        }

        const contentLength = Number(response.headers.get("Content-Length") || 0);
        if (contentLength > MAX_HTML_SIZE) {
          return cors(json({ error: `HTML too large (${(contentLength / 1024 / 1024).toFixed(1)} MB, max 10 MB)` }, 413), origin);
        }

        const html = await response.text();
        if (html.length > MAX_HTML_SIZE) {
          return cors(json({ error: "HTML too large (max 10 MB)" }, 413), origin);
        }
        const result = scanHtml(html, targetUrl);

        return cors(json(result), origin);
      } catch (e: any) {
        const msg = e.name === "AbortError" ? "Scan timed out (15s)" : "Internal scan error";
        return cors(json({ error: msg }, 502), origin);
      }
    }

    // ---- POST /api/agency/create-client-org --------------------------------
    if (req.method === "POST" && path === "/api/agency/create-client-org") {
      if (authCtx.type !== "jwt") return cors(json({ error: "JWT auth required" }, 403), origin);
      if (!isAgencyOrAdmin(authCtx)) return cors(json({ error: "Agency or admin access required" }, 403), origin);

      let data: any;
      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      data = _body.data;
      const name = typeof data.name === "string" ? data.name.trim().slice(0, 100) : "";
      if (!name) return cors(json({ error: "Name is required (max 100 chars)" }, 400), origin);

      const inviteEmail = typeof data.invite_email === "string" ? data.invite_email.trim().toLowerCase() : "";
      if (inviteEmail && (inviteEmail.length > MAX_EMAIL_LEN || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail))) {
        return cors(json({ error: "Invalid invite email address" }, 400), origin);
      }

      const newOrgId = randomUUID();
      const now = Date.now();
      let inviteUrl: string | null = null;

      db.transaction(() => {
        db.prepare("INSERT INTO orgs (id, name, plan, created_by_agency, created_at) VALUES (?, ?, 'active', ?, ?)").run(newOrgId, name, authCtx.userId, now);
        db.prepare("INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, 'owner')").run(newOrgId, authCtx.userId);

        // Optionally create an invite for a client member
        if (inviteEmail) {
          const rawToken = randomBytes(32).toString("hex");
          const tokenHash = createHash("sha256").update(rawToken).digest("hex");
          const expiresAt = now + 7 * 24 * 3600 * 1000;
          const inviteId = randomUUID();
          db.prepare(
            "INSERT INTO invite_tokens (id, org_id, email, token_hash, created_by, expires_at, created_at, account_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
          ).run(inviteId, newOrgId, inviteEmail, tokenHash, authCtx.userId, expiresAt, now, "user");
          const rawO = req.headers.get("Origin") || "";
          const reqOrigin = getAllowedOrigins().includes(rawO) ? rawO : url.origin;
          inviteUrl = `${reqOrigin}/#invite/${rawToken}`;
        }
      })();

      console.log(`[cookieproof-api] Agency ${maskEmail(authCtx.email)} created client org: ${name}${inviteEmail ? ` with invite for ${maskEmail(inviteEmail)}` : ""}`);
      return cors(json({ org: { id: newOrgId, name, plan: "active", created_at: now }, invite_url: inviteUrl }, 201), origin);
    }

    // ---- POST /api/agency/invite-to-org -------------------------------------
    if (req.method === "POST" && path === "/api/agency/invite-to-org") {
      if (authCtx.type !== "jwt") return cors(json({ error: "JWT auth required" }, 403), origin);
      if (!isAgencyOrAdmin(authCtx)) return cors(json({ error: "Agency or admin access required" }, 403), origin);

      let data: any;
      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      data = _body.data;

      const targetOrgId = typeof data.org_id === "string" ? data.org_id : "";
      if (!targetOrgId || !UUID_RE.test(targetOrgId)) {
        return cors(json({ error: "Invalid org_id" }, 400), origin);
      }

      const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
      if (!email || email.length > MAX_EMAIL_LEN || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return cors(json({ error: "Invalid email address" }, 400), origin);
      }

      // Verify the org exists and user has access (must be a member)
      const org = db.prepare("SELECT id, name FROM orgs WHERE id = ?").get(targetOrgId) as { id: string; name: string | null } | null;
      if (!org) return cors(json({ error: "Organization not found" }, 404), origin);

      const membership = db.prepare("SELECT 1 FROM org_members WHERE org_id = ? AND user_id = ?").get(targetOrgId, authCtx.userId);
      if (!membership) return cors(json({ error: "You don't have access to this organization" }, 403), origin);

      // Check if already a member
      const existing = db.prepare(
        "SELECT 1 FROM users u JOIN org_members om ON om.user_id = u.id WHERE u.email = ? AND om.org_id = ?"
      ).get(email, targetOrgId);
      if (existing) return cors(json({ error: "This email is already a member of this organization" }, 409), origin);

      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      const now = Date.now();
      const expiresAt = now + 7 * 24 * 3600 * 1000;
      const id = randomUUID();

      db.prepare(
        "INSERT INTO invite_tokens (id, org_id, email, token_hash, created_by, expires_at, created_at, account_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(id, targetOrgId, email, tokenHash, authCtx.userId, expiresAt, now, "user");

      const rawO2 = req.headers.get("Origin") || "";
      const reqOrigin = getAllowedOrigins().includes(rawO2) ? rawO2 : url.origin;
      const inviteUrl = `${reqOrigin}/#invite/${rawToken}`;

      console.log(`[cookieproof-api] Agency ${maskEmail(authCtx.email)} invited ${maskEmail(email)} to org ${org.name || targetOrgId}`);

      // Optionally send invite email
      let emailSent = false;
      const smtp = getSmtpConfig(authCtx.userId);
      if (data.send_email && smtp.host && smtp.from) {
        const orgName = (org.name || "your team").replace(/[\r\n]/g, "");
        const inviterRow = db.prepare("SELECT display_name FROM users WHERE id = ?").get(authCtx.userId) as { display_name: string | null } | null;
        const inviterName = (inviterRow?.display_name || authCtx.email.split("@")[0]).replace(/[\r\n]/g, "");
        const subject = `${inviterName} invited you to join ${orgName}`.replace(/[\r\n\t]/g, " ").slice(0, 200);
        const emailBody = [
          `From: ${smtp.from}`,
          `To: ${email}`,
          `Subject: ${subject}`,
          `MIME-Version: 1.0`,
          `Content-Type: text/html; charset=UTF-8`,
          ``,
          `<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;">`,
          `<div style="max-width:480px;margin:40px auto;background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">`,
          `<div style="padding:32px 32px 0;">`,
          `<div style="font-size:18px;font-weight:700;color:#0f172a;margin-bottom:8px;">You're invited!</div>`,
          `<p style="font-size:14px;color:#475569;line-height:1.6;margin:0 0 24px;"><strong>${escHtml(inviterName)}</strong> has invited you to join <strong>${escHtml(orgName)}</strong> on CookieProof.</p>`,
          `<a href="${escHtml(inviteUrl)}" style="display:inline-block;padding:12px 28px;background:#0d9488;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">Accept Invitation</a>`,
          `<p style="font-size:12px;color:#94a3b8;margin:20px 0 0;word-break:break-all;">Or copy this link: ${escHtml(inviteUrl)}</p>`,
          `</div>`,
          `<div style="padding:16px 32px;margin-top:24px;background:#f8fafc;border-top:1px solid #e2e8f0;">`,
          `<p style="font-size:11px;color:#94a3b8;margin:0;">This invitation expires in 7 days. If you didn't expect this email, you can safely ignore it.</p>`,
          `</div>`,
          `</div>`,
          `</body></html>`,
        ].join("\r\n");

        try {
          await sendSmtpEmail(smtp.host, smtp.port, smtp.user, smtp.pass, smtp.from, email, emailBody);
          emailSent = true;
          console.log(`[cookieproof-api] Invite email sent to ${maskEmail(email)}`);
        } catch (e: any) {
          console.error("[cookieproof-api] Failed to send invite email:", e.message);
        }
      }

      return cors(json({ invite_url: inviteUrl, email, org_name: org.name, expires_at: expiresAt, email_sent: emailSent }, 201), origin);
    }

    // ---- GET /api/agency/dashboard ------------------------------------------
    if (req.method === "GET" && path === "/api/agency/dashboard") {
      if (authCtx.type !== "jwt") return cors(json({ error: "JWT auth required" }, 403), origin);
      if (!isAgencyOrAdmin(authCtx)) return cors(json({ error: "Agency or admin access required" }, 403), origin);

      // Determine user's home org to exclude from client list
      const homeOrg = db.prepare(
        "SELECT org_id FROM org_members WHERE user_id = ? ORDER BY role = 'owner' DESC, rowid ASC LIMIT 1"
      ).get(authCtx.userId) as { org_id: string } | null;
      const homeOrgId = homeOrg?.org_id || "";

      // Get client orgs where this user is owner (excluding their home org)
      // Must be owner, not just member — prevents cross-agency data exposure
      const clientOrgs = db.prepare(`
        SELECT o.id, o.name, o.plan, o.trial_ends_at, o.grace_ends_at, o.created_by_agency, o.created_at,
          o.primary_contact_email,
          (SELECT COUNT(*) FROM org_members om WHERE om.org_id = o.id) as member_count
        FROM org_members om2 JOIN orgs o ON o.id = om2.org_id
        WHERE om2.user_id = ? AND om2.role = 'owner' AND o.id != ? ORDER BY o.created_at DESC
      `).all(authCtx.userId, homeOrgId) as any[];

      const now = Date.now();
      const DAY_MS = 24 * 3600 * 1000;
      let totalConsents = 0;
      let totalAcceptance = 0;
      let acceptanceCount = 0;

      const clients = clientOrgs.map((org: any) => {
        const ps = getOrgPlanStatus(org.id);
        const domains = (db.prepare("SELECT domain, updated_at FROM domain_configs WHERE org_id = ?").all(org.id) as { domain: string; updated_at: number }[]);
        const domainNames = domains.map(d => d.domain);
        const lastConfigUpdate = domains.length > 0 ? Math.max(...domains.map(d => d.updated_at)) : null;

        // Consent stats (last 30 days)
        let consentTotal = 0;
        let acceptAll = 0;
        if (domainNames.length > 0) {
          const ph = domainNames.map(() => "?").join(",");
          const from30d = now - 30 * DAY_MS;
          const stats = db.prepare(`
            SELECT COUNT(*) as total,
              COALESCE(SUM(CASE WHEN method = 'accept-all' THEN 1 ELSE 0 END), 0) as accept_all
            FROM consent_proofs WHERE domain IN (${ph}) AND created_at >= ?
          `).get(...domainNames, from30d) as { total: number; accept_all: number };
          consentTotal = stats.total;
          acceptAll = stats.accept_all;
        }

        const acceptanceRate = consentTotal > 0 ? acceptAll / consentTotal : 0;
        totalConsents += consentTotal;
        if (consentTotal > 0) { totalAcceptance += acceptanceRate; acceptanceCount++; }

        // Config analysis
        let categoriesEnabled: string[] = [];
        let ccpaEnabled = false;
        if (domains.length > 0) {
          try {
            const firstConfig = db.prepare("SELECT config FROM domain_configs WHERE org_id = ? LIMIT 1").get(org.id) as { config: string } | null;
            if (firstConfig) {
              const parsed = JSON.parse(firstConfig.config);
              categoriesEnabled = (parsed.categories || []).filter((c: any) => c.enabled !== false).map((c: any) => c.id);
              ccpaEnabled = !!parsed.ccpaEnabled;
            }
          } catch {}
        }

        // Alerts (reuse extracted function)
        const orgAlerts = computeOrgAlerts(org.id);
        const alerts = orgAlerts.map(a => a.message);

        // Member details for display in client cards (exclude the agency user)
        const members = (db.prepare(
          "SELECT u.email, u.display_name, om.role FROM org_members om JOIN users u ON u.id = om.user_id WHERE om.org_id = ? AND om.user_id != ?"
        ).all(org.id, authCtx.userId) as { email: string; display_name: string | null; role: string }[])
          .map(m => ({ email: m.email, name: m.display_name || m.email.split("@")[0], role: m.role }));

        return {
          org_id: org.id,
          name: org.name,
          plan: ps.plan,
          daysLeft: ps.daysLeft,
          domains: domainNames,
          total_consents: consentTotal,
          acceptance_rate: Math.round(acceptanceRate * 100) / 100,
          last_config_update: lastConfigUpdate,
          categories_enabled: categoriesEnabled,
          ccpa_enabled: ccpaEnabled,
          member_count: members.length,
          members,
          alerts,
          health_score: computeHealthScore(org.id),
          primary_contact_email: org.primary_contact_email || "",
        };
      });

      return cors(json({
        clients,
        totals: {
          total_clients: clients.length,
          total_consents: totalConsents,
          avg_acceptance_rate: acceptanceCount > 0 ? Math.round((totalAcceptance / acceptanceCount) * 100) / 100 : 0,
        },
      }), origin);
    }

    // ---- GET /api/agency/client-pricing — profit dashboard data -------------
    if (req.method === "GET" && path === "/api/agency/client-pricing") {
      if (authCtx.type !== "jwt") return cors(json({ error: "JWT auth required" }, 403), origin);
      if (!isAgencyOrAdmin(authCtx)) return cors(json({ error: "Agency or admin access required" }, 403), origin);

      const rows = db.prepare(
        "SELECT org_id, client_fee_cents, bright_tier, updated_at FROM agency_client_pricing WHERE agency_id = ?"
      ).all(authCtx.userId) as { org_id: string; client_fee_cents: number; bright_tier: string; updated_at: number }[];

      const pricing: Record<string, { client_fee_cents: number; bright_tier: string }> = {};
      let totalRevenue = 0;
      let totalBrightCost = 0;

      for (const row of rows) {
        pricing[row.org_id] = { client_fee_cents: row.client_fee_cents, bright_tier: row.bright_tier };
        totalRevenue += row.client_fee_cents;
        totalBrightCost += BRIGHT_COST_CENTS[row.bright_tier] || BRIGHT_COST_CENTS.starter;
      }

      return cors(json({
        pricing,
        summary: {
          total_revenue_cents: totalRevenue,
          total_bright_cost_cents: totalBrightCost,
          net_profit_cents: totalRevenue - totalBrightCost,
          client_count: rows.length,
        },
        bright_tiers: BRIGHT_COST_CENTS,
      }), origin);
    }

    // ---- PUT /api/agency/client-pricing — set per-client fee & tier ---------
    if (req.method === "PUT" && path === "/api/agency/client-pricing") {
      if (authCtx.type !== "jwt") return cors(json({ error: "JWT auth required" }, 403), origin);
      if (!isAgencyOrAdmin(authCtx)) return cors(json({ error: "Agency or admin access required" }, 403), origin);

      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      const data = _body.data;

      const orgId = typeof data.org_id === "string" ? data.org_id.trim() : "";
      if (!orgId) return cors(json({ error: "org_id required" }, 400), origin);
      if (!UUID_RE.test(orgId)) return cors(json({ error: "Invalid org_id format" }, 400), origin);

      // Verify this agency owns the client org
      const isOwner = db.prepare(
        "SELECT 1 FROM org_members WHERE org_id = ? AND user_id = ? AND role = 'owner'"
      ).get(orgId, authCtx.userId);
      if (!isOwner) return cors(json({ error: "Not authorized for this organization" }, 403), origin);

      const clientFeeCents = typeof data.client_fee_cents === "number" ? Math.max(0, Math.round(data.client_fee_cents)) : 0;
      const brightTier = data.bright_tier === "unlimited" ? "unlimited" : "starter";
      const now = Date.now();

      const existing = db.prepare(
        "SELECT 1 FROM agency_client_pricing WHERE org_id = ? AND agency_id = ?"
      ).get(orgId, authCtx.userId);

      if (existing) {
        db.prepare(
          "UPDATE agency_client_pricing SET client_fee_cents = ?, bright_tier = ?, updated_at = ? WHERE org_id = ? AND agency_id = ?"
        ).run(clientFeeCents, brightTier, now, orgId, authCtx.userId);
      } else {
        db.prepare(
          "INSERT INTO agency_client_pricing (org_id, agency_id, client_fee_cents, bright_tier, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(orgId, authCtx.userId, clientFeeCents, brightTier, now, now);
      }

      console.log(`[cookieproof-api] Agency pricing set for org ${orgId}: fee=${clientFeeCents}, tier=${brightTier}`);
      return cors(json({ ok: true }), origin);
    }

    // ---- PUT /api/agency/primary-contact — set primary contact email --------
    if (req.method === "PUT" && path === "/api/agency/primary-contact") {
      if (authCtx.type !== "jwt") return cors(json({ error: "JWT auth required" }, 403), origin);
      if (!isAgencyOrAdmin(authCtx)) return cors(json({ error: "Agency or admin access required" }, 403), origin);

      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      const data = _body.data;

      const orgId = typeof data.org_id === "string" ? data.org_id.trim() : "";
      if (!orgId) return cors(json({ error: "org_id required" }, 400), origin);
      if (!UUID_RE.test(orgId)) return cors(json({ error: "Invalid org_id format" }, 400), origin);

      const isOwner = db.prepare(
        "SELECT 1 FROM org_members WHERE org_id = ? AND user_id = ? AND role = 'owner'"
      ).get(orgId, authCtx.userId);
      if (!isOwner) return cors(json({ error: "Not authorized for this organization" }, 403), origin);

      const email = typeof data.email === "string" ? data.email.trim().toLowerCase().replace(/[\r\n]/g, "") : "";
      if (email && email.length > 320) return cors(json({ error: "Email too long" }, 400), origin);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return cors(json({ error: "Invalid email address" }, 400), origin);
      }

      db.prepare("UPDATE orgs SET primary_contact_email = ? WHERE id = ?").run(email || null, orgId);
      console.log(`[cookieproof-api] Primary contact set for org ${orgId}: ${email || "(cleared)"}`);
      return cors(json({ ok: true }), origin);
    }

    // ---- GET /api/agency/custom-domains — list agency's custom domains ------
    if (req.method === "GET" && path === "/api/agency/custom-domains") {
      if (authCtx.type !== "jwt") return cors(json({ error: "JWT auth required" }, 403), origin);
      if (!isAgencyOrAdmin(authCtx)) return cors(json({ error: "Agency or admin access required" }, 403), origin);

      const rows = db.prepare(
        "SELECT id, domain, cname_target, verified, verified_at, created_at FROM custom_domains WHERE agency_id = ? ORDER BY created_at DESC"
      ).all(authCtx.userId) as { id: string; domain: string; cname_target: string; verified: number; verified_at: number | null; created_at: number }[];

      return cors(json({
        domains: rows.map(r => ({
          id: r.id,
          domain: r.domain,
          cname_target: r.cname_target,
          verified: !!r.verified,
          verified_at: r.verified_at,
          created_at: r.created_at,
        })),
      }), origin);
    }

    // ---- POST /api/agency/custom-domains — add a custom domain --------------
    if (req.method === "POST" && path === "/api/agency/custom-domains") {
      if (authCtx.type !== "jwt") return cors(json({ error: "JWT auth required" }, 403), origin);
      if (!isAgencyOrAdmin(authCtx)) return cors(json({ error: "Agency or admin access required" }, 403), origin);

      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      const data = _body.data;

      // Per-agency domain limit
      const domainCount = db.prepare("SELECT COUNT(*) as cnt FROM custom_domains WHERE agency_id = ?").get(authCtx.userId) as { cnt: number };
      if (domainCount.cnt >= 50) return cors(json({ error: "Maximum 50 custom domains per agency" }, 400), origin);

      const domain = typeof data.domain === "string" ? data.domain.trim().toLowerCase().replace(/[\r\n]/g, "") : "";
      if (!domain || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
        return cors(json({ error: "Invalid domain format" }, 400), origin);
      }
      if (domain.length > 253) {
        return cors(json({ error: "Domain too long" }, 400), origin);
      }

      // Check if domain is already registered
      const existing = db.prepare("SELECT id, agency_id FROM custom_domains WHERE domain = ?").get(domain) as { id: string; agency_id: string } | null;
      if (existing) {
        return cors(json({ error: "Domain is already registered" }, 409), origin);
      }

      const id = randomUUID();
      const now = Date.now();
      db.prepare(
        "INSERT INTO custom_domains (id, agency_id, domain, cname_target, verified, created_at) VALUES (?, ?, ?, 'consent.brightinteraction.com', 0, ?)"
      ).run(id, authCtx.userId, domain, now);

      console.log(`[cookieproof-api] Custom domain added: ${domain} by agency ${authCtx.userId}`);
      return cors(json({
        id,
        domain,
        cname_target: "consent.brightinteraction.com",
        verified: false,
        created_at: now,
      }), origin);
    }

    // ---- POST /api/agency/custom-domains/verify — check DNS CNAME -----------
    if (req.method === "POST" && path === "/api/agency/custom-domains/verify") {
      if (authCtx.type !== "jwt") return cors(json({ error: "JWT auth required" }, 403), origin);
      if (!isAgencyOrAdmin(authCtx)) return cors(json({ error: "Agency or admin access required" }, 403), origin);

      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      const data = _body.data;

      const domainId = typeof data.id === "string" ? data.id.trim() : "";
      if (!domainId) return cors(json({ error: "id required" }, 400), origin);

      const row = db.prepare(
        "SELECT id, domain, cname_target FROM custom_domains WHERE id = ? AND agency_id = ?"
      ).get(domainId, authCtx.userId) as { id: string; domain: string; cname_target: string } | null;
      if (!row) return cors(json({ error: "Domain not found" }, 404), origin);

      // DNS CNAME verification via DNS-over-HTTPS (works in any runtime)
      let verified = false;
      let dnsResult: string[] = [];
      try {
        const dohRes = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(row.domain)}&type=CNAME`, {
          headers: { Accept: "application/dns-json" },
        });
        if (dohRes.ok) {
          const doh = await dohRes.json() as { Answer?: { type: number; data: string }[] };
          dnsResult = (doh.Answer || [])
            .filter((a: { type: number }) => a.type === 5) // CNAME record type
            .map((a: { data: string }) => a.data.replace(/\.$/, "").toLowerCase());
          verified = dnsResult.includes(row.cname_target);
        }
      } catch {
        dnsResult = ["DNS_ERROR"];
      }

      if (verified) {
        db.prepare("UPDATE custom_domains SET verified = 1, verified_at = ? WHERE id = ?").run(Date.now(), row.id);
        console.log(`[cookieproof-api] Custom domain verified: ${row.domain}`);
      }

      return cors(json({
        verified,
        dns_records: dnsResult,
        expected: row.cname_target,
      }), origin);
    }

    // ---- DELETE /api/agency/custom-domains — remove a custom domain ---------
    if (req.method === "DELETE" && path === "/api/agency/custom-domains") {
      if (authCtx.type !== "jwt") return cors(json({ error: "JWT auth required" }, 403), origin);
      if (!isAgencyOrAdmin(authCtx)) return cors(json({ error: "Agency or admin access required" }, 403), origin);

      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      const data = _body.data;

      const domainId = typeof data.id === "string" ? data.id.trim() : "";
      if (!domainId) return cors(json({ error: "id required" }, 400), origin);

      const row = db.prepare(
        "SELECT domain FROM custom_domains WHERE id = ? AND agency_id = ?"
      ).get(domainId, authCtx.userId) as { domain: string } | null;
      if (!row) return cors(json({ error: "Domain not found" }, 404), origin);

      db.prepare("DELETE FROM custom_domains WHERE id = ? AND agency_id = ?").run(domainId, authCtx.userId);
      console.log(`[cookieproof-api] Custom domain removed: ${row.domain}`);
      return cors(json({ ok: true }), origin);
    }

    // ---- POST /api/agency/bulk-update (Phase B) ----------------------------
    if (req.method === "POST" && path === "/api/agency/bulk-update") {
      if (authCtx.type !== "jwt") return cors(json({ error: "JWT auth required" }, 403), origin);
      if (!isAgencyOrAdmin(authCtx)) return cors(json({ error: "Agency or admin access required" }, 403), origin);

      let data: any;
      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      data = _body.data;

      const orgIds = data.org_ids;
      if (!Array.isArray(orgIds) || orgIds.length === 0 || orgIds.length > 100) {
        return cors(json({ error: "org_ids must be an array (1-100 items)" }, 400), origin);
      }
      // Validate all org_ids are UUIDs
      if (!orgIds.every((id: unknown) => typeof id === "string" && UUID_RE.test(id))) {
        return cors(json({ error: "Invalid org_id format" }, 400), origin);
      }

      const configPatch = typeof data.config_patch === "object" && data.config_patch ? data.config_patch : null;
      const addCategories = Array.isArray(data.add_categories) ? data.add_categories.filter((c: unknown) => typeof c === "string" && c.length <= 50) : [];
      const removeCategories = Array.isArray(data.remove_categories) ? data.remove_categories.filter((c: unknown) => typeof c === "string" && c.length <= 50) : [];

      if (!configPatch && addCategories.length === 0 && removeCategories.length === 0) {
        return cors(json({ error: "Nothing to update. Provide config_patch, add_categories, or remove_categories." }, 400), origin);
      }

      // Verify user owns all target orgs (must be owner, not just member)
      const ownedOrgs = db.prepare(
        `SELECT org_id FROM org_members WHERE user_id = ? AND role = 'owner'`
      ).all(authCtx.userId) as { org_id: string }[];
      const ownedSet = new Set(ownedOrgs.map(o => o.org_id));
      const unauthorized = orgIds.filter((id: string) => !ownedSet.has(id));
      if (unauthorized.length > 0) {
        return cors(json({ error: "Not authorized for org(s): " + unauthorized.join(", ") }, 403), origin);
      }

      const now = Date.now();
      let updated = 0;
      let skipped = 0;

      db.transaction(() => {
        for (const orgId of orgIds) {
          // Get all domains for this org
          const domains = db.prepare("SELECT domain, config FROM domain_configs WHERE org_id = ?")
            .all(orgId) as { domain: string; config: string }[];

          if (domains.length === 0) { skipped++; continue; }

          for (const domRow of domains) {
            let cfg: any;
            try { cfg = JSON.parse(domRow.config); } catch { continue; }

            // Apply config_patch (shallow merge at top-level keys, allowlisted only)
            if (configPatch) {
              const ALLOWED_PATCH_KEYS = new Set([
                'position', 'theme', 'language', 'revision', 'gcmEnabled',
                'respectGPC', 'floatingTrigger', 'keyboardShortcut',
                'privacyPolicyUrl', 'cookieExpiry', 'expiryNotifyDays',
                'expiryNotifyUI', 'languageSelector', 'ccpaEnabled', 'ccpaUrl',
                'headless', 'cookieName', 'cookieDomain',
              ]);
              for (const key of Object.keys(configPatch)) {
                if (!ALLOWED_PATCH_KEYS.has(key)) continue;
                cfg[key] = configPatch[key];
              }
            }

            // Add categories
            if (addCategories.length > 0) {
              if (!Array.isArray(cfg.categories)) cfg.categories = [];
              const existingIds = new Set(cfg.categories.map((c: any) => c.id));
              for (const catId of addCategories) {
                if (!existingIds.has(catId)) {
                  cfg.categories.push({ id: catId, enabled: true });
                }
              }
            }

            // Remove categories
            if (removeCategories.length > 0) {
              if (Array.isArray(cfg.categories)) {
                const removeSet = new Set(removeCategories);
                cfg.categories = cfg.categories.filter((c: any) => !removeSet.has(c.id));
              }
            }

            db.prepare("UPDATE domain_configs SET config = ?, updated_at = ? WHERE domain = ?")
              .run(JSON.stringify(cfg), now, domRow.domain);
          }
          updated++;
        }
      })();

      console.log(`[cookieproof-api] Bulk update by ${maskEmail(authCtx.email)}: ${updated} org(s) updated, ${skipped} skipped`);
      return cors(json({ ok: true, updated, skipped, total: orgIds.length }), origin);
    }

    // ---- POST /api/agency/branding (Phase B) --------------------------------
    if (req.method === "POST" && path === "/api/agency/branding") {
      if (authCtx.type !== "jwt") return cors(json({ error: "JWT auth required" }, 403), origin);
      if (!isAgencyOrAdmin(authCtx)) return cors(json({ error: "Agency or admin access required" }, 403), origin);

      const parsed = await safeJson(req, 700_000); // ~500KB logo + metadata
      if ("error" in parsed) return cors(json({ error: parsed.error }, 400), origin);
      const data = parsed.data;

      const logoB64 = typeof data.logo_b64 === "string" ? data.logo_b64.slice(0, 500_000) : null; // ~375KB max image
      const logoMime = typeof data.logo_mime === "string" && /^image\/(png|jpeg|webp)$/.test(data.logo_mime) ? data.logo_mime : null;
      const brandName = typeof data.brand_name === "string" ? data.brand_name.trim().slice(0, 100) : null;
      const brandColor = typeof data.brand_color === "string" && /^#[0-9a-fA-F]{6}$/.test(data.brand_color) ? data.brand_color : null;

      if (!logoB64 && !brandName && !brandColor) {
        return cors(json({ error: "Provide logo_b64, brand_name, or brand_color" }, 400), origin);
      }
      if (logoB64 && !logoMime) {
        return cors(json({ error: "logo_mime required when uploading logo (image/png, image/jpeg, image/webp)" }, 400), origin);
      }
      // Validate base64 format to prevent XSS via attribute breakout in data URLs
      if (logoB64 && !/^[A-Za-z0-9+/]*={0,2}$/.test(logoB64)) {
        return cors(json({ error: "Invalid base64 format" }, 400), origin);
      }

      const now = Date.now();
      const existing = db.prepare("SELECT user_id FROM agency_branding WHERE user_id = ?").get(authCtx.userId);
      if (existing) {
        const sets: string[] = [];
        const params: any[] = [];
        if (logoB64 !== null) { sets.push("logo_b64 = ?"); params.push(logoB64); }
        if (logoMime !== null) { sets.push("logo_mime = ?"); params.push(logoMime); }
        if (brandName !== null) { sets.push("brand_name = ?"); params.push(brandName); }
        if (brandColor !== null) { sets.push("brand_color = ?"); params.push(brandColor); }
        sets.push("updated_at = ?"); params.push(now);
        params.push(authCtx.userId);
        db.prepare(`UPDATE agency_branding SET ${sets.join(", ")} WHERE user_id = ?`).run(...params);
      } else {
        db.prepare(
          "INSERT INTO agency_branding (user_id, logo_b64, logo_mime, brand_name, brand_color, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(authCtx.userId, logoB64, logoMime, brandName, brandColor, now);
      }

      return cors(json({ ok: true }), origin);
    }

    // ---- GET /api/agency/branding (Phase B) ---------------------------------
    if (req.method === "GET" && path === "/api/agency/branding") {
      if (authCtx.type !== "jwt") return cors(json({ error: "JWT auth required" }, 403), origin);
      if (!isAgencyOrAdmin(authCtx)) return cors(json({ error: "Agency or admin access required" }, 403), origin);

      const row = db.prepare("SELECT (logo_b64 IS NOT NULL AND logo_b64 != '') as has_logo, logo_mime, brand_name, brand_color, updated_at FROM agency_branding WHERE user_id = ?")
        .get(authCtx.userId) as { has_logo: number; logo_mime: string | null; brand_name: string | null; brand_color: string | null; updated_at: number } | null;

      return cors(json({
        branding: row ? {
          has_logo: !!row.has_logo,
          logo_mime: row.logo_mime,
          brand_name: row.brand_name,
          brand_color: row.brand_color,
          updated_at: row.updated_at,
        } : null,
      }), origin);
    }

    // ---- GET /api/agency/smtp ------------------------------------------------
    if (req.method === "GET" && path === "/api/agency/smtp") {
      if (authCtx.type !== "jwt") return cors(json({ error: "JWT auth required" }, 403), origin);
      if (!isAgencyOrAdmin(authCtx)) return cors(json({ error: "Agency or admin access required" }, 403), origin);

      const row = db.prepare("SELECT smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, updated_at FROM agency_smtp WHERE user_id = ?")
        .get(authCtx.userId) as { smtp_host: string; smtp_port: number; smtp_user: string; smtp_pass: string; smtp_from: string; updated_at: number } | null;

      return cors(json({
        smtp: row ? {
          smtp_host: row.smtp_host,
          smtp_port: row.smtp_port,
          smtp_user: row.smtp_user,
          smtp_pass_configured: !!row.smtp_pass,
          smtp_from: row.smtp_from,
          configured: true,
        } : { configured: false },
      }), origin);
    }

    // ---- PUT /api/agency/smtp ------------------------------------------------
    if (req.method === "PUT" && path === "/api/agency/smtp") {
      if (authCtx.type !== "jwt") return cors(json({ error: "JWT auth required" }, 403), origin);
      if (!isAgencyOrAdmin(authCtx)) return cors(json({ error: "Agency or admin access required" }, 403), origin);

      let data: any;
      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      data = _body.data;

      const smtpHost = typeof data.smtp_host === "string" ? data.smtp_host.trim().slice(0, 255) : "";
      const smtpPort = typeof data.smtp_port === "number" ? Math.min(Math.max(data.smtp_port, 1), 65535) : 587;
      const smtpUser = typeof data.smtp_user === "string" ? data.smtp_user.trim().slice(0, 255) : "";
      const smtpFrom = typeof data.smtp_from === "string" ? data.smtp_from.trim().toLowerCase().slice(0, 255) : "";

      if (!smtpHost) return cors(json({ error: "smtp_host is required" }, 400), origin);
      if (isPrivateHost(smtpHost)) return cors(json({ error: "SMTP host cannot be a private or internal address" }, 400), origin);
      if (!smtpFrom || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(smtpFrom)) return cors(json({ error: "Valid smtp_from email is required" }, 400), origin);

      const now = Date.now();
      const existing = db.prepare("SELECT user_id, smtp_pass FROM agency_smtp WHERE user_id = ?").get(authCtx.userId) as { user_id: string; smtp_pass: string } | null;
      // Keep existing password if not provided in update; encrypt new passwords before storing
      const rawPass = typeof data.smtp_pass === "string" && data.smtp_pass ? data.smtp_pass.slice(0, 500) : "";
      const smtpPass = rawPass ? encryptSmtpPass(rawPass) : (existing?.smtp_pass || "");
      if (existing) {
        db.prepare("UPDATE agency_smtp SET smtp_host = ?, smtp_port = ?, smtp_user = ?, smtp_pass = ?, smtp_from = ?, updated_at = ? WHERE user_id = ?")
          .run(smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom, now, authCtx.userId);
      } else {
        db.prepare("INSERT INTO agency_smtp (user_id, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(authCtx.userId, smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom, now);
      }

      console.log(`[cookieproof-api] Agency SMTP configured by ${maskEmail(authCtx.email)}: ${smtpHost}:${smtpPort}`);
      return cors(json({ ok: true }), origin);
    }

    // ---- POST /api/agency/smtp/test ------------------------------------------
    if (req.method === "POST" && path === "/api/agency/smtp/test") {
      if (authCtx.type !== "jwt") return cors(json({ error: "JWT auth required" }, 403), origin);
      if (!isAgencyOrAdmin(authCtx)) return cors(json({ error: "Agency or admin access required" }, 403), origin);

      const row = db.prepare("SELECT smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from FROM agency_smtp WHERE user_id = ?")
        .get(authCtx.userId) as { smtp_host: string; smtp_port: number; smtp_user: string; smtp_pass: string; smtp_from: string } | null;
      if (!row || !row.smtp_host) return cors(json({ error: "No SMTP configured. Save your settings first." }, 400), origin);

      const testMessage = [
        `From: ${row.smtp_from}`,
        `To: ${maskEmail(authCtx.email)}`,
        `Subject: CookieProof SMTP Test`,
        `MIME-Version: 1.0`,
        `Content-Type: text/plain; charset=UTF-8`,
        ``,
        `This is a test email from your CookieProof SMTP configuration.`,
        ``,
        `If you received this, your SMTP settings are working correctly.`,
        `Host: ${row.smtp_host}:${row.smtp_port}`,
        `From: ${row.smtp_from}`,
      ].join("\r\n");

      try {
        await sendSmtpEmail(row.smtp_host, row.smtp_port, row.smtp_user, decryptSmtpPass(row.smtp_pass), row.smtp_from, authCtx.email, testMessage);
        return cors(json({ ok: true, sent_to: authCtx.email }), origin);
      } catch (e: any) {
        console.error(`[cookieproof-api] SMTP test failed for ${maskEmail(authCtx.email)}:`, e.message);
        return cors(json({ error: "SMTP test failed. Check your host, port, and credentials." }, 502), origin);
      }
    }

    // ---- DELETE /api/agency/smtp ----------------------------------------------
    if (req.method === "DELETE" && path === "/api/agency/smtp") {
      if (authCtx.type !== "jwt") return cors(json({ error: "JWT auth required" }, 403), origin);
      if (!isAgencyOrAdmin(authCtx)) return cors(json({ error: "Agency or admin access required" }, 403), origin);

      db.prepare("DELETE FROM agency_smtp WHERE user_id = ?").run(authCtx.userId);
      console.log(`[cookieproof-api] Agency SMTP removed by ${maskEmail(authCtx.email)}`);
      return cors(json({ ok: true }), origin);
    }

    // ---- POST /api/agency/report (Phase B) — generate report -----------------
    if (req.method === "POST" && path === "/api/agency/report") {
      if (authCtx.type !== "jwt") return cors(json({ error: "JWT auth required" }, 403), origin);
      if (!isAgencyOrAdmin(authCtx)) return cors(json({ error: "Agency or admin access required" }, 403), origin);

      let data: any;
      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      data = _body.data;

      const targetOrgId = data.org_id;
      if (!targetOrgId || !UUID_RE.test(targetOrgId)) {
        return cors(json({ error: "Valid org_id is required" }, 400), origin);
      }

      // Must be owner of the target org (no admin bypass — agency feature, not admin feature)
      const membership = db.prepare("SELECT 1 FROM org_members WHERE user_id = ? AND org_id = ? AND role = 'owner'").get(authCtx.userId, targetOrgId);
      if (!membership) return cors(json({ error: "Not authorized for this org" }, 403), origin);

      const fromTs = Math.max(0, typeof data.from === "number" && Number.isFinite(data.from) ? data.from : Date.now() - 30 * 24 * 3600 * 1000);
      const toTs = Math.min(Date.now() + 86400000, typeof data.to === "number" && Number.isFinite(data.to) ? data.to : Date.now());

      const org = db.prepare("SELECT id, name, plan FROM orgs WHERE id = ?").get(targetOrgId) as { id: string; name: string | null; plan: string } | null;
      if (!org) return cors(json({ error: "Organization not found" }, 404), origin);

      const reportHtml = generateReportHtml({
        orgId: targetOrgId, orgName: org.name || "Organization", orgPlan: org.plan,
        fromTs, toTs, agencyUserId: authCtx.userId,
      });

      const safeFilename = (org.name || targetOrgId).replace(/[^a-zA-Z0-9_-]/g, "_");
      const format = typeof data.format === "string" ? data.format : "html";

      if (format === "pdf") {
        try {
          const pdfBuffer = await htmlToPdf(reportHtml, CONSENT_FOOTER_HTML);
          return cors(new Response(pdfBuffer, {
            status: 200,
            headers: {
              "Content-Type": "application/pdf",
              "Content-Disposition": `attachment; filename="consent-report-${safeFilename}-${Date.now()}.pdf"`,
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
            },
          }), origin);
        } catch (e: any) {
          console.error("[cookieproof-api] Gotenberg PDF generation failed:", e.message);
          return cors(json({ error: "PDF generation failed. Try format=html as fallback." }, 500), origin);
        }
      }

      return cors(new Response(reportHtml, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": `attachment; filename="consent-report-${safeFilename}-${Date.now()}.html"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      }), origin);
    }

    // ---- POST /api/agency/report/send (Phase B) — email report ---------------
    if (req.method === "POST" && path === "/api/agency/report/send") {
      if (authCtx.type !== "jwt") return cors(json({ error: "JWT auth required" }, 403), origin);
      if (!isAgencyOrAdmin(authCtx)) return cors(json({ error: "Agency or admin access required" }, 403), origin);

      // Rate limit email sending (10 per user per hour)
      if (isReportEmailRateLimited(authCtx.userId)) {
        return cors(json({ error: "Too many report emails. Try again later." }, 429), origin);
      }

      // Check SMTP after resolving agency config (agency may have custom SMTP even when system is empty)
      const smtp = getSmtpConfig(authCtx.userId);
      if (!smtp.host || !smtp.from) {
        return cors(json({ error: "SMTP not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM env vars or configure agency SMTP." }, 503), origin);
      }

      let data: any;
      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      data = _body.data;

      const targetOrgId = data.org_id;
      if (!targetOrgId || !UUID_RE.test(targetOrgId)) {
        return cors(json({ error: "Valid org_id is required" }, 400), origin);
      }
      const recipientEmail = typeof data.recipient_email === "string" ? data.recipient_email.trim().toLowerCase().replace(/[\r\n]/g, "") : "";
      if (!recipientEmail || recipientEmail.length > MAX_EMAIL_LEN || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
        return cors(json({ error: "Valid recipient_email is required" }, 400), origin);
      }

      // Must be owner of the target org
      const membership = db.prepare("SELECT 1 FROM org_members WHERE user_id = ? AND org_id = ? AND role = 'owner'").get(authCtx.userId, targetOrgId);
      if (!membership) return cors(json({ error: "Not authorized for this org" }, 403), origin);

      const fromTs = Math.max(0, typeof data.from === "number" && Number.isFinite(data.from) ? data.from : Date.now() - 30 * 24 * 3600 * 1000);
      const toTs = Math.min(Date.now() + 86400000, typeof data.to === "number" && Number.isFinite(data.to) ? data.to : Date.now());

      const org = db.prepare("SELECT name FROM orgs WHERE id = ?").get(targetOrgId) as { name: string | null } | null;
      if (!org) return cors(json({ error: "Organization not found" }, 404), origin);

      // Generate HTML report and convert to PDF for email attachment
      const reportHtml = generateReportHtml({
        orgId: targetOrgId, orgName: org.name || "Organization", orgPlan: "active",
        fromTs, toTs, agencyUserId: authCtx.userId,
      });

      let reportBase64: string;
      let attachMime = "application/pdf";
      let attachExt = "pdf";
      try {
        const pdfBuffer = await htmlToPdf(reportHtml, CONSENT_FOOTER_HTML);
        reportBase64 = pdfBuffer.toString("base64");
      } catch (e: any) {
        console.warn("[cookieproof-api] PDF generation failed for email, falling back to HTML:", e.message);
        reportBase64 = Buffer.from(reportHtml).toString("base64");
        attachMime = "text/html; charset=utf-8";
        attachExt = "html";
      }

      const branding = db.prepare("SELECT brand_name FROM agency_branding WHERE user_id = ?")
        .get(authCtx.userId) as { brand_name: string | null } | null;
      const brandName = (branding?.brand_name || "CookieProof").replace(/[\r\n]/g, "");
      const orgName = (org.name || "Organization").replace(/[\r\n]/g, "");
      const fromDate = new Date(fromTs).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
      const toDate = new Date(toTs).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
      const safeFilename = orgName.replace(/[^a-zA-Z0-9_-]/g, "_");

      const boundary = "----=_Part_" + randomUUID().replace(/-/g, "");
      const subject = `Consent Compliance Report: ${orgName} (${fromDate} — ${toDate})`.replace(/[\r\n\t]/g, " ").slice(0, 200);

      const emailBody = [
        `From: ${smtp.from}`,
        `To: ${recipientEmail}`,
        `Subject: ${subject}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        ``,
        `--${boundary}`,
        `Content-Type: text/plain; charset=utf-8`,
        `Content-Transfer-Encoding: 7bit`,
        ``,
        `Hello,`,
        ``,
        `Please find attached the consent compliance report for ${orgName}.`,
        `Period: ${fromDate} — ${toDate}`,
        ``,
        `Best regards,`,
        `${brandName}`,
        ``,
        `--${boundary}`,
        `Content-Type: ${attachMime}; name="consent-report-${safeFilename}.${attachExt}"`,
        `Content-Transfer-Encoding: base64`,
        `Content-Disposition: attachment; filename="consent-report-${safeFilename}.${attachExt}"`,
        ``,
        reportBase64,
        ``,
        `--${boundary}--`,
      ].join("\r\n");

      try {
        await sendSmtpEmail(smtp.host, smtp.port, smtp.user, smtp.pass, smtp.from, recipientEmail, emailBody);
        console.log(`[cookieproof-api] Report email sent to ${maskEmail(recipientEmail)} for org ${targetOrgId} by ${maskEmail(authCtx.email)}`);
        return cors(json({ ok: true, sent_to: recipientEmail }), origin);
      } catch (e: any) {
        console.error("[cookieproof-api] SMTP send failed:", e.message);
        return cors(json({ error: "Failed to send email. Please try again later." }, 500), origin);
      }
    }

    // ---- GET /api/agency/trends — daily consent data for sparklines --------
    if (req.method === "GET" && path === "/api/agency/trends") {
      if (authCtx.type !== "jwt") return cors(json({ error: "JWT auth required" }, 403), origin);
      if (!isAgencyOrAdmin(authCtx)) return cors(json({ error: "Agency or admin access required" }, 403), origin);

      const targetOrgId = url.searchParams.get("org_id");
      if (!targetOrgId || !UUID_RE.test(targetOrgId)) {
        return cors(json({ error: "Valid org_id is required" }, 400), origin);
      }
      // Must be owner of the target org
      const membership = db.prepare("SELECT 1 FROM org_members WHERE user_id = ? AND org_id = ? AND role = 'owner'").get(authCtx.userId, targetOrgId);
      if (!membership) return cors(json({ error: "Not authorized" }, 403), origin);

      const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 30));
      const orgDomains = getOrgDomains(targetOrgId);
      if (orgDomains.length === 0) return cors(json({ daily: [] }), origin);

      const ph = orgDomains.map(() => "?").join(",");
      const fromTs = Date.now() - days * 24 * 3600 * 1000;
      const daily = db.prepare(`
        SELECT date(created_at / 1000, 'unixepoch') as day,
          COUNT(*) as total,
          SUM(CASE WHEN method = 'accept-all' THEN 1 ELSE 0 END) as accept_all,
          SUM(CASE WHEN method = 'reject-all' THEN 1 ELSE 0 END) as reject_all
        FROM consent_proofs WHERE domain IN (${ph}) AND created_at >= ?
        GROUP BY day ORDER BY day
      `).all(...orgDomains, fromTs);

      return cors(json({ daily }), origin);
    }

    // ---- Scheduled reports CRUD ---------------------------------------------
    if (req.method === "POST" && path === "/api/agency/schedule-report") {
      if (authCtx.type !== "jwt") return cors(json({ error: "JWT auth required" }, 403), origin);
      if (!isAgencyOrAdmin(authCtx)) return cors(json({ error: "Agency or admin access required" }, 403), origin);

      let data: any;
      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      data = _body.data;

      const targetOrgId = data.org_id;
      if (!targetOrgId || !UUID_RE.test(targetOrgId)) {
        return cors(json({ error: "Valid org_id is required" }, 400), origin);
      }
      const frequency = data.frequency;
      if (frequency !== "weekly" && frequency !== "monthly") {
        return cors(json({ error: "frequency must be 'weekly' or 'monthly'" }, 400), origin);
      }
      const recipientEmail = typeof data.recipient_email === "string" ? data.recipient_email.trim().toLowerCase().replace(/[\r\n]/g, "") : "";
      if (!recipientEmail || recipientEmail.length > MAX_EMAIL_LEN || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
        return cors(json({ error: "Valid recipient_email is required" }, 400), origin);
      }

      // Must be owner of the target org
      const membership = db.prepare("SELECT 1 FROM org_members WHERE user_id = ? AND org_id = ? AND role = 'owner'").get(authCtx.userId, targetOrgId);
      if (!membership) return cors(json({ error: "Not authorized for this org" }, 403), origin);

      // Limit: max 50 active schedules per user
      const schedCount = (db.prepare("SELECT COUNT(*) as cnt FROM scheduled_reports WHERE created_by = ? AND enabled = 1").get(authCtx.userId) as any)?.cnt || 0;
      if (schedCount >= 50) return cors(json({ error: "Maximum 50 scheduled reports" }, 429), origin);

      // Upsert: check if schedule already exists for this user + org
      const existing = db.prepare("SELECT id FROM scheduled_reports WHERE org_id = ? AND created_by = ?")
        .get(targetOrgId, authCtx.userId) as { id: string } | null;
      const nextRun = computeNextRun(frequency);

      if (existing) {
        db.prepare("UPDATE scheduled_reports SET frequency = ?, recipient_email = ?, next_run_at = ?, enabled = 1 WHERE id = ?")
          .run(frequency, recipientEmail, nextRun, existing.id);
        return cors(json({ ok: true, schedule: { id: existing.id, frequency, recipient_email: recipientEmail, next_run_at: nextRun } }), origin);
      }

      const id = randomUUID();
      db.prepare(`INSERT INTO scheduled_reports (id, org_id, created_by, frequency, recipient_email, next_run_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(id, targetOrgId, authCtx.userId, frequency, recipientEmail, nextRun, Date.now());
      return cors(json({ ok: true, schedule: { id, frequency, recipient_email: recipientEmail, next_run_at: nextRun } }), origin);
    }

    if (req.method === "GET" && path === "/api/agency/schedule-report") {
      if (authCtx.type !== "jwt") return cors(json({ error: "JWT auth required" }, 403), origin);
      if (!isAgencyOrAdmin(authCtx)) return cors(json({ error: "Agency or admin access required" }, 403), origin);

      // Always scoped to user's own schedules
      const schedules = db.prepare(`
        SELECT sr.*, o.name as org_name FROM scheduled_reports sr
        LEFT JOIN orgs o ON o.id = sr.org_id
        WHERE sr.created_by = ? ORDER BY sr.created_at DESC
      `).all(authCtx.userId);
      return cors(json({ schedules }), origin);
    }

    if (req.method === "DELETE" && path.startsWith("/api/agency/schedule-report/")) {
      if (authCtx.type !== "jwt") return cors(json({ error: "JWT auth required" }, 403), origin);
      if (!isAgencyOrAdmin(authCtx)) return cors(json({ error: "Agency or admin access required" }, 403), origin);

      const scheduleId = path.slice("/api/agency/schedule-report/".length);
      if (!UUID_RE.test(scheduleId)) return cors(json({ error: "Invalid schedule ID" }, 400), origin);

      const schedule = db.prepare("SELECT created_by FROM scheduled_reports WHERE id = ?").get(scheduleId) as { created_by: string } | null;
      if (!schedule) return cors(json({ error: "Schedule not found" }, 404), origin);
      if (schedule.created_by !== authCtx.userId) {
        return cors(json({ error: "Not authorized" }, 403), origin);
      }

      db.prepare("DELETE FROM scheduled_reports WHERE id = ?").run(scheduleId);
      return cors(json({ ok: true }), origin);
    }

    // ---- Admin endpoints ---------------------------------------------------
    // GET /api/admin/users
    if (req.method === "GET" && path === "/api/admin/users") {
      if (authCtx.type !== "jwt" || !isAdmin(authCtx)) return cors(json({ error: "Admin access required" }, 403), origin);

      const users = db.prepare(`
        SELECT u.id, u.email, u.account_type, u.status, u.created_at, u.last_login_at,
          (SELECT COUNT(*) FROM org_members om WHERE om.user_id = u.id) as org_count,
          (SELECT om2.org_id FROM org_members om2 WHERE om2.user_id = u.id ORDER BY om2.role = 'owner' DESC LIMIT 1) as first_org_id
        FROM users u ORDER BY u.created_at DESC
      `).all();
      return cors(json({ users }), origin);
    }

    // PUT /api/admin/users/:id/account-type
    if (req.method === "PUT" && path.startsWith("/api/admin/users/") && path.endsWith("/account-type")) {
      if (authCtx.type !== "jwt" || !isAdmin(authCtx)) return cors(json({ error: "Admin access required" }, 403), origin);

      const targetId = path.slice("/api/admin/users/".length, -"/account-type".length);
      if (!targetId || !UUID_RE.test(targetId)) {
        return cors(json({ error: "Invalid user ID" }, 400), origin);
      }
      if (targetId === authCtx.userId) return cors(json({ error: "Cannot change your own account type" }, 400), origin);

      let data: any;
      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      data = _body.data;
      const newType = data.account_type;
      if (!["user", "agency", "admin", "super_admin"].includes(newType)) {
        return cors(json({ error: "account_type must be 'user', 'agency', 'admin', or 'super_admin'" }, 400), origin);
      }

      const target = db.prepare("SELECT id, account_type FROM users WHERE id = ?").get(targetId) as { id: string; account_type: string } | null;
      if (!target) return cors(json({ error: "User not found" }, 404), origin);

      // Hierarchical guard: only super_admins can touch admin/super_admin users or assign admin+ roles
      if (!isSuperAdmin(authCtx)) {
        if (target.account_type === "admin" || target.account_type === "super_admin") {
          return cors(json({ error: "Only super admins can modify admin accounts" }, 403), origin);
        }
        if (newType === "admin" || newType === "super_admin") {
          return cors(json({ error: "Only super admins can assign admin roles" }, 403), origin);
        }
      }

      db.prepare("UPDATE users SET account_type = ? WHERE id = ?").run(newType, targetId);
      // Bump token_version to force re-login with new permissions
      db.prepare("UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = ?").run(targetId);
      console.log(`[cookieproof-api] Admin ${maskEmail(authCtx.email)} changed ${targetId} to ${newType}`);
      return cors(json({ ok: true, account_type: newType }), origin);
    }

    // PUT /api/admin/users/:id/status
    if (req.method === "PUT" && path.startsWith("/api/admin/users/") && path.endsWith("/status")) {
      if (authCtx.type !== "jwt" || !isAdmin(authCtx)) return cors(json({ error: "Admin access required" }, 403), origin);
      const targetId = path.slice("/api/admin/users/".length, -"/status".length);
      if (!targetId || !UUID_RE.test(targetId)) return cors(json({ error: "Invalid user ID" }, 400), origin);
      if (targetId === authCtx.userId) return cors(json({ error: "Cannot change your own status" }, 400), origin);

      let data: any;
      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      data = _body.data;
      const newStatus = data.status;
      if (!["active", "archived"].includes(newStatus)) return cors(json({ error: "status must be 'active' or 'archived'" }, 400), origin);

      const target = db.prepare("SELECT id, account_type FROM users WHERE id = ?").get(targetId) as { id: string; account_type: string } | null;
      if (!target) return cors(json({ error: "User not found" }, 404), origin);

      const isTargetAdmin = target.account_type === "admin" || target.account_type === "super_admin";
      if (isTargetAdmin && !isSuperAdmin(authCtx)) return cors(json({ error: "Only super admins can modify admin accounts" }, 403), origin);

      db.prepare("UPDATE users SET status = ? WHERE id = ?").run(newStatus, targetId);
      db.prepare("UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = ?").run(targetId);
      console.log(`[cookieproof-api] Admin ${maskEmail(authCtx.email)} set user ${targetId} status to ${newStatus}`);
      return cors(json({ ok: true, status: newStatus }), origin);
    }

    // DELETE /api/admin/users/:id
    if (req.method === "DELETE" && path.startsWith("/api/admin/users/") && !path.endsWith("/account-type") && !path.endsWith("/status")) {
      if (authCtx.type !== "jwt" || !isAdmin(authCtx)) return cors(json({ error: "Admin access required" }, 403), origin);
      const segments = path.split("/").filter(Boolean);
      if (segments.length !== 4) return cors(json({ error: "Not found" }, 404), origin);
      const targetUserId = segments[3];
      if (!targetUserId || !UUID_RE.test(targetUserId)) return cors(json({ error: "Invalid user ID" }, 400), origin);
      if (targetUserId === authCtx.userId) return cors(json({ error: "Cannot delete your own account from admin panel" }, 400), origin);

      const target = db.prepare("SELECT id, email, account_type FROM users WHERE id = ?").get(targetUserId) as { id: string; email: string; account_type: string } | null;
      if (!target) return cors(json({ error: "User not found" }, 404), origin);

      // Hierarchy: only super_admin can delete admins/super_admins
      const isTargetAdmin = target.account_type === "admin" || target.account_type === "super_admin";
      if (isTargetAdmin && !isSuperAdmin(authCtx)) return cors(json({ error: "Only super admins can delete admin accounts" }, 403), origin);

      try {
        db.transaction(() => {
          // Delete user's owned orgs ONLY if they are the sole member; otherwise transfer ownership
          const ownedOrgs = db.prepare("SELECT org_id FROM org_members WHERE user_id = ? AND role = 'owner'").all(targetUserId) as { org_id: string }[];
          for (const { org_id } of ownedOrgs) {
            const otherMember = db.prepare(
              "SELECT user_id FROM org_members WHERE org_id = ? AND user_id != ? LIMIT 1"
            ).get(org_id, targetUserId) as { user_id: string } | null;
            if (otherMember) {
              // Transfer ownership to next member instead of destroying org data
              db.prepare("UPDATE org_members SET role = 'owner' WHERE org_id = ? AND user_id = ?").run(org_id, otherMember.user_id);
              db.prepare("DELETE FROM org_members WHERE org_id = ? AND user_id = ?").run(org_id, targetUserId);
            } else {
              // Sole member — safe to delete entire org
              db.prepare("DELETE FROM consent_proofs WHERE domain IN (SELECT domain FROM domain_configs WHERE org_id = ?)").run(org_id);
              db.prepare("DELETE FROM domain_configs WHERE org_id = ?").run(org_id);
              db.prepare("DELETE FROM allowed_domains WHERE org_id = ?").run(org_id);
              db.prepare("DELETE FROM alert_log WHERE org_id = ?").run(org_id);
              db.prepare("DELETE FROM scheduled_reports WHERE org_id = ?").run(org_id);
              db.prepare("DELETE FROM invite_tokens WHERE org_id = ?").run(org_id);
              db.prepare("DELETE FROM org_members WHERE org_id = ?").run(org_id);
              db.prepare("DELETE FROM orgs WHERE id = ?").run(org_id);
              invalidateOriginCache();
            }
          }
          db.prepare("DELETE FROM org_members WHERE user_id = ?").run(targetUserId);
          db.prepare("DELETE FROM agency_branding WHERE user_id = ?").run(targetUserId);
          db.prepare("DELETE FROM agency_smtp WHERE user_id = ?").run(targetUserId);
          db.prepare("DELETE FROM scheduled_reports WHERE created_by = ?").run(targetUserId);
          db.prepare("DELETE FROM invite_tokens WHERE created_by = ?").run(targetUserId);
          db.prepare("DELETE FROM totp_backup_codes WHERE user_id = ?").run(targetUserId);
          db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(targetUserId);
          db.prepare("DELETE FROM email_verification_tokens WHERE user_id = ?").run(targetUserId);
          db.prepare("DELETE FROM users WHERE id = ?").run(targetUserId);
        })();
        console.log(`[cookieproof-api] Admin ${authCtx.userId} deleted user ${maskEmail(target.email)}`);
        return cors(json({ ok: true, deleted: true }), origin);
      } catch (e: any) {
        console.error(`[cookieproof-api] Admin user deletion failed:`, e?.message);
        return cors(json({ error: "Deletion failed" }, 500), origin);
      }
    }

    // GET /api/admin/orgs
    if (req.method === "GET" && path === "/api/admin/orgs") {
      if (authCtx.type !== "jwt" || !isAdmin(authCtx)) return cors(json({ error: "Admin access required" }, 403), origin);

      // Exclude admin's own home org
      const homeOrg = db.prepare(
        "SELECT org_id FROM org_members WHERE user_id = ? ORDER BY role = 'owner' DESC, rowid ASC LIMIT 1"
      ).get(authCtx.userId) as { org_id: string } | null;

      const orgs = db.prepare(`
        SELECT o.id, o.name, o.plan, o.trial_started_at, o.trial_ends_at, o.grace_ends_at, o.created_by_agency, o.created_at,
          (SELECT COUNT(*) FROM domain_configs dc WHERE dc.org_id = o.id) as domain_count,
          (SELECT COUNT(*) FROM org_members om WHERE om.org_id = o.id) as member_count,
          (SELECT u.email FROM users u WHERE u.id = o.created_by_agency) as agency_email
        FROM orgs o WHERE o.id != ? ORDER BY o.created_at DESC
      `).all(homeOrg?.org_id || "") as any[];

      const enriched = orgs.map((o: any) => {
        const ps = getOrgPlanStatus(o.id);
        return { ...o, plan: ps.plan, daysLeft: ps.daysLeft };
      });

      return cors(json({ orgs: enriched }), origin);
    }

    // POST /api/admin/orgs - Create org for a user (admin only)
    if (req.method === "POST" && path === "/api/admin/orgs") {
      if (authCtx.type !== "jwt" || !isAdmin(authCtx)) return cors(json({ error: "Admin access required" }, 403), origin);
      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      const data = _body.data as { name?: string; user_id?: string; plan?: string };
      const orgName = typeof data.name === "string" ? data.name.trim() : "";
      const targetUserId = typeof data.user_id === "string" ? data.user_id : "";
      const plan = typeof data.plan === "string" && ["trial", "active", "unlimited"].includes(data.plan) ? data.plan : "trial";

      if (!orgName) return cors(json({ error: "Organization name is required" }, 400), origin);
      if (orgName.length > 100) return cors(json({ error: "Organization name too long" }, 400), origin);

      // Validate target user exists if provided
      if (targetUserId) {
        if (!UUID_RE.test(targetUserId)) return cors(json({ error: "Invalid user ID" }, 400), origin);
        const userExists = db.prepare("SELECT 1 FROM users WHERE id = ?").get(targetUserId);
        if (!userExists) return cors(json({ error: "User not found" }, 404), origin);
      }

      const orgId = crypto.randomUUID();
      const now = Date.now();
      const trialEnds = plan === "trial" ? now + 14 * 24 * 60 * 60 * 1000 : null;

      db.prepare(`INSERT INTO orgs (id, name, plan, trial_started_at, trial_ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
        orgId, orgName, plan, plan === "trial" ? now : null, trialEnds, now
      );

      // Add user as owner if specified
      if (targetUserId) {
        db.prepare("INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, 'owner')").run(orgId, targetUserId);
      }

      return cors(json({ ok: true, org_id: orgId, name: orgName }), origin);
    }

    // PUT /api/admin/orgs/:id - Update org (rename, etc)
    if (req.method === "PUT" && path.match(/^\/api\/admin\/orgs\/[^/]+$/) && !path.endsWith("/plan")) {
      if (authCtx.type !== "jwt" || !isAdmin(authCtx)) return cors(json({ error: "Admin access required" }, 403), origin);
      const targetOrgId = path.slice("/api/admin/orgs/".length);
      if (!targetOrgId || !UUID_RE.test(targetOrgId)) return cors(json({ error: "Invalid org ID" }, 400), origin);

      const orgExists = db.prepare("SELECT 1 FROM orgs WHERE id = ?").get(targetOrgId);
      if (!orgExists) return cors(json({ error: "Organization not found" }, 404), origin);

      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      const data = _body.data as { name?: string };

      if (typeof data.name === "string") {
        const name = data.name.trim();
        if (!name) return cors(json({ error: "Name cannot be empty" }, 400), origin);
        if (name.length > 100) return cors(json({ error: "Name too long" }, 400), origin);
        db.prepare("UPDATE orgs SET name = ? WHERE id = ?").run(name, targetOrgId);
      }

      return cors(json({ ok: true }), origin);
    }

    // GET /api/admin/orgs/:id/members - Get org members
    if (req.method === "GET" && path.match(/^\/api\/admin\/orgs\/[^/]+\/members$/)) {
      if (authCtx.type !== "jwt" || !isAdmin(authCtx)) return cors(json({ error: "Admin access required" }, 403), origin);
      const targetOrgId = path.slice("/api/admin/orgs/".length, -"/members".length);
      if (!targetOrgId || !UUID_RE.test(targetOrgId)) return cors(json({ error: "Invalid org ID" }, 400), origin);

      const members = db.prepare(`
        SELECT u.id, u.email, u.account_type, om.role, om.rowid as joined_order
        FROM org_members om
        JOIN users u ON u.id = om.user_id
        WHERE om.org_id = ?
        ORDER BY om.role = 'owner' DESC, om.rowid ASC
      `).all(targetOrgId);

      return cors(json({ members }), origin);
    }

    // POST /api/admin/orgs/:id/members - Add user to org
    if (req.method === "POST" && path.match(/^\/api\/admin\/orgs\/[^/]+\/members$/)) {
      if (authCtx.type !== "jwt" || !isAdmin(authCtx)) return cors(json({ error: "Admin access required" }, 403), origin);
      const targetOrgId = path.slice("/api/admin/orgs/".length, -"/members".length);
      if (!targetOrgId || !UUID_RE.test(targetOrgId)) return cors(json({ error: "Invalid org ID" }, 400), origin);

      const orgExists = db.prepare("SELECT 1 FROM orgs WHERE id = ?").get(targetOrgId);
      if (!orgExists) return cors(json({ error: "Organization not found" }, 404), origin);

      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      const data = _body.data as { user_id?: string; role?: string };
      const userId = typeof data.user_id === "string" ? data.user_id : "";
      const role = typeof data.role === "string" && ["owner", "admin", "member"].includes(data.role) ? data.role : "member";

      if (!userId || !UUID_RE.test(userId)) return cors(json({ error: "Valid user_id required" }, 400), origin);

      const userExists = db.prepare("SELECT 1 FROM users WHERE id = ?").get(userId);
      if (!userExists) return cors(json({ error: "User not found" }, 404), origin);

      const alreadyMember = db.prepare("SELECT 1 FROM org_members WHERE org_id = ? AND user_id = ?").get(targetOrgId, userId);
      if (alreadyMember) return cors(json({ error: "User is already a member" }, 400), origin);

      db.prepare("INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, ?)").run(targetOrgId, userId, role);
      return cors(json({ ok: true }), origin);
    }

    // DELETE /api/admin/orgs/:id/members/:userId - Remove user from org
    if (req.method === "DELETE" && path.match(/^\/api\/admin\/orgs\/[^/]+\/members\/[^/]+$/)) {
      if (authCtx.type !== "jwt" || !isAdmin(authCtx)) return cors(json({ error: "Admin access required" }, 403), origin);
      const parts = path.split("/");
      const targetOrgId = parts[4];
      const targetUserId = parts[6];
      if (!targetOrgId || !UUID_RE.test(targetOrgId)) return cors(json({ error: "Invalid org ID" }, 400), origin);
      if (!targetUserId || !UUID_RE.test(targetUserId)) return cors(json({ error: "Invalid user ID" }, 400), origin);

      const result = db.prepare("DELETE FROM org_members WHERE org_id = ? AND user_id = ?").run(targetOrgId, targetUserId);
      if (result.changes === 0) return cors(json({ error: "Membership not found" }, 404), origin);

      return cors(json({ ok: true }), origin);
    }

    // GET /api/admin/users/:id/orgs - Get user's orgs
    if (req.method === "GET" && path.match(/^\/api\/admin\/users\/[^/]+\/orgs$/)) {
      if (authCtx.type !== "jwt" || !isAdmin(authCtx)) return cors(json({ error: "Admin access required" }, 403), origin);
      const targetUserId = path.slice("/api/admin/users/".length, -"/orgs".length);
      if (!targetUserId || !UUID_RE.test(targetUserId)) return cors(json({ error: "Invalid user ID" }, 400), origin);

      const orgs = db.prepare(`
        SELECT o.id, o.name, o.plan, om.role
        FROM org_members om
        JOIN orgs o ON o.id = om.org_id
        WHERE om.user_id = ?
        ORDER BY om.role = 'owner' DESC, o.name ASC
      `).all(targetUserId);

      return cors(json({ orgs }), origin);
    }

    // PUT /api/admin/orgs/:id/plan
    if (req.method === "PUT" && path.startsWith("/api/admin/orgs/") && path.endsWith("/plan")) {
      if (authCtx.type !== "jwt" || !isSuperAdmin(authCtx)) return cors(json({ error: "Super admin access required" }, 403), origin);

      const targetOrgId = path.slice("/api/admin/orgs/".length, -"/plan".length);
      if (!targetOrgId || !UUID_RE.test(targetOrgId)) {
        return cors(json({ error: "Invalid org ID" }, 400), origin);
      }

      let data: any;
      const _body = await safeJson(req);
      if ("error" in _body) return cors(json({ error: _body.error }, 400), origin);
      data = _body.data;

      const org = db.prepare("SELECT id, plan FROM orgs WHERE id = ?").get(targetOrgId) as { id: string; plan: string } | null;
      if (!org) return cors(json({ error: "Organization not found" }, 404), origin);

      if (data.plan === "active") {
        // Activate org (clear trial dates)
        db.prepare("UPDATE orgs SET plan = 'active', trial_started_at = NULL, trial_ends_at = NULL, grace_ends_at = NULL WHERE id = ?").run(targetOrgId);
        console.log(`[cookieproof-api] Admin ${maskEmail(authCtx.email)} activated org ${targetOrgId}`);
        return cors(json({ ok: true, plan: "active" }), origin);
      }

      if (typeof data.extend_days === "number" && data.extend_days > 0 && data.extend_days <= 365) {
        const extMs = data.extend_days * 24 * 3600 * 1000;
        const now = Date.now();
        const gracePeriodMs = 7 * 24 * 3600 * 1000;
        // Extend from whichever is later: current end date or now
        db.prepare(`
          UPDATE orgs SET
            plan = 'trial',
            trial_started_at = COALESCE(trial_started_at, ?),
            trial_ends_at = MAX(COALESCE(trial_ends_at, ?), ?) + ?,
            grace_ends_at = MAX(COALESCE(grace_ends_at, ?), ?) + ?
          WHERE id = ?
        `).run(now, now, now, extMs, now + gracePeriodMs, now + gracePeriodMs, extMs, targetOrgId);
        console.log(`[cookieproof-api] Admin ${maskEmail(authCtx.email)} extended org ${targetOrgId} by ${data.extend_days}d`);
        const ps = getOrgPlanStatus(targetOrgId);
        return cors(json({ ok: true, plan: ps.plan, daysLeft: ps.daysLeft }), origin);
      }

      return cors(json({ error: "Provide plan='active' or extend_days=N" }, 400), origin);
    }

    // GET /api/admin/orgs/:id/export
    if (req.method === "GET" && path.startsWith("/api/admin/orgs/") && path.endsWith("/export")) {
      if (authCtx.type !== "jwt" || !isAdmin(authCtx)) return cors(json({ error: "Admin access required" }, 403), origin);

      const targetOrgId = path.slice("/api/admin/orgs/".length, -"/export".length);
      if (!targetOrgId || !UUID_RE.test(targetOrgId)) {
        return cors(json({ error: "Invalid org ID" }, 400), origin);
      }

      const orgDomains = getOrgDomains(targetOrgId);
      let rows: any[] = [];
      if (orgDomains.length > 0) {
        const ph = orgDomains.map(() => "?").join(",");
        rows = db.prepare(`SELECT * FROM consent_proofs WHERE domain IN (${ph}) ORDER BY created_at DESC LIMIT 100000`).all(...orgDomains);
      }

      const exportFormat = url.searchParams.get("format");

      if (exportFormat === "pdf") {
        // Cap at 10,000 rows for PDF
        const pdfRows = rows.slice(0, 10000);
        const org = db.prepare("SELECT name FROM orgs WHERE id = ?").get(targetOrgId) as { name: string | null } | null;
        const orgName = escHtml(org?.name || targetOrgId);
        const proofHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Consent Proof Export — ${orgName}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:32px 24px;color:#1e293b;font-size:10px;line-height:1.4;}
  @page{size:A4 landscape;margin:0;}
  body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  h1{font-size:18px;margin:0 0 4px;color:#0d9488;}
  .subtitle{font-size:11px;color:#64748b;margin:0 0 16px;}
  table{width:100%;border-collapse:collapse;}
  th,td{padding:4px 6px;border:1px solid #e2e8f0;text-align:left;font-size:9px;word-break:break-all;}
  th{background:#f1f5f9;font-weight:600;color:#475569;}
  tr:nth-child(even){background:#f8fafc;}
</style></head><body>
<h1>Consent Proof Export</h1>
<p class="subtitle">${orgName} &mdash; ${pdfRows.length.toLocaleString()} records (exported ${new Date().toLocaleDateString("en-US")})</p>
<table>
<thead><tr><th>Domain</th><th>URL</th><th>Method</th><th>Categories</th><th>IP</th><th>Date</th></tr></thead>
<tbody>
${pdfRows.map((r: any) => `<tr><td>${escHtml(r.domain)}</td><td>${escHtml((r.url || "").slice(0, 60))}</td><td>${escHtml(r.method)}</td><td>${escHtml(r.categories || "")}</td><td>${escHtml(r.ip || "")}</td><td>${new Date(r.created_at).toLocaleDateString("en-US")}</td></tr>`).join("")}
</tbody></table>
</body></html>`;

        try {
          const pdfBuffer = await htmlToPdf(proofHtml, CONSENT_FOOTER_HTML);
          return cors(new Response(pdfBuffer, {
            status: 200,
            headers: {
              "Content-Type": "application/pdf",
              "Content-Disposition": `attachment; filename="org-${targetOrgId}-export-${Date.now()}.pdf"`,
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
            },
          }), origin);
        } catch (e: any) {
          console.error("[cookieproof-api] Proof export PDF failed:", e.message);
          return cors(json({ error: "PDF generation failed. Try without format=pdf for CSV." }, 500), origin);
        }
      }

      const header = "id,domain,url,method,categories,version,ip,user_agent,created_at\n";
      const csvRows = rows.map((r: any) => [
        csvEscape(r.id), csvEscape(r.domain), csvEscape(r.url || ""),
        csvEscape(r.method), csvEscape(r.categories), csvEscape(String(r.version)),
        csvEscape(r.ip || ""), csvEscape(r.user_agent || ""), csvEscape(String(r.created_at)),
      ].join(",")).join("\n");

      return cors(new Response(header + csvRows, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="org-${targetOrgId}-export-${Date.now()}.csv"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      }), origin);
    }

    // DELETE /api/admin/orgs/:id (archive or delete)
    if (req.method === "DELETE" && path.startsWith("/api/admin/orgs/") && !path.endsWith("/export") && !path.endsWith("/plan")) {
      if (authCtx.type !== "jwt" || !isSuperAdmin(authCtx)) return cors(json({ error: "Super admin access required" }, 403), origin);

      const targetOrgId = path.slice("/api/admin/orgs/".length).replace(/\/+$/, "");
      if (!targetOrgId || !UUID_RE.test(targetOrgId)) {
        return cors(json({ error: "Invalid org ID" }, 400), origin);
      }

      let data: any;
      const _body = await safeJson(req);
      data = "error" in _body ? {} : _body.data;

      const org = db.prepare("SELECT id FROM orgs WHERE id = ?").get(targetOrgId);
      if (!org) return cors(json({ error: "Organization not found" }, 404), origin);

      if (data.action === "delete") {
        // Hard delete — super_admin only
        if (!isSuperAdmin(authCtx)) {
          return cors(json({ error: "Only super admins can permanently delete organizations" }, 403), origin);
        }
        // Prevent deleting your own current org
        if (authCtx.orgId === targetOrgId) {
          return cors(json({ error: "Switch to a different organization before deleting this one" }, 400), origin);
        }
        db.transaction(() => {
          // Invalidate JWTs for all affected members before removing them
          const members = db.prepare("SELECT user_id FROM org_members WHERE org_id = ?").all(targetOrgId) as { user_id: string }[];
          for (const m of members) {
            db.prepare("UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = ?").run(m.user_id);
          }
          db.prepare("DELETE FROM consent_proofs WHERE domain IN (SELECT domain FROM domain_configs WHERE org_id = ?)").run(targetOrgId);
          db.prepare("DELETE FROM domain_configs WHERE org_id = ?").run(targetOrgId);
          db.prepare("DELETE FROM allowed_domains WHERE org_id = ?").run(targetOrgId);
          db.prepare("DELETE FROM alert_log WHERE org_id = ?").run(targetOrgId);
          db.prepare("DELETE FROM scheduled_reports WHERE org_id = ?").run(targetOrgId);
          db.prepare("DELETE FROM invite_tokens WHERE org_id = ?").run(targetOrgId);
          db.prepare("DELETE FROM org_members WHERE org_id = ?").run(targetOrgId);
          db.prepare("DELETE FROM orgs WHERE id = ?").run(targetOrgId);
          invalidateOriginCache();
        })();
        console.log(`[cookieproof-api] Super admin ${maskEmail(authCtx.email)} permanently deleted org ${targetOrgId}`);
        return cors(json({ ok: true, deleted: true }), origin);
      }

      if (data.action !== "archive") {
        return cors(json({ error: "Body must contain { action: 'archive' } or { action: 'delete' }" }, 400), origin);
      }
      // Prevent archiving your own current org (would lock you out)
      if (authCtx.orgId === targetOrgId) {
        return cors(json({ error: "Switch to a different organization before archiving this one" }, 400), origin);
      }

      db.prepare("UPDATE orgs SET plan = 'archived' WHERE id = ?").run(targetOrgId);
      console.log(`[cookieproof-api] Admin ${maskEmail(authCtx.email)} archived org ${targetOrgId}`);
      return cors(json({ ok: true, plan: "archived" }), origin);
    }

    // =========================================================================
    // BILLING ENDPOINTS
    // =========================================================================

    // GET /api/billing/plans — list available pricing plans
    if (req.method === "GET" && path === "/api/billing/plans") {
      const plans = db.prepare(`
        SELECT id, name, price_cents, currency, interval, features
        FROM pricing_plans WHERE is_active = 1 ORDER BY price_cents ASC
      `).all() as { id: string; name: string; price_cents: number; currency: string; interval: string; features: string }[];

      return cors(json({
        plans: plans.map(p => ({
          id: p.id,
          name: p.name,
          price: p.price_cents / 100,
          price_cents: p.price_cents,
          currency: p.currency,
          interval: p.interval,
          features: p.features ? JSON.parse(p.features) : {},
        })),
      }), origin);
    }

    // GET /api/billing/subscription — get current org subscription status
    if (req.method === "GET" && path === "/api/billing/subscription") {
      if (authCtx.type !== "jwt") return cors(json({ error: "Unauthorized" }, 401), origin);

      const sub = db.prepare(`
        SELECT s.*, p.name as plan_name, p.price_cents, p.currency, p.interval, p.features
        FROM subscriptions s
        JOIN pricing_plans p ON p.id = s.plan_id
        WHERE s.org_id = ? AND s.status NOT IN ('canceled', 'expired')
        ORDER BY s.created_at DESC LIMIT 1
      `).get(authCtx.orgId) as any;

      if (!sub) {
        // Check trial status
        const org = db.prepare("SELECT plan, trial_ends_at, grace_ends_at FROM orgs WHERE id = ?")
          .get(authCtx.orgId) as { plan: string; trial_ends_at: number | null; grace_ends_at: number | null } | null;
        const ps = getOrgPlanStatus(authCtx.orgId);
        return cors(json({
          subscription: null,
          org_plan: ps.plan,
          days_left: ps.daysLeft,
          trial_ends_at: org?.trial_ends_at,
        }), origin);
      }

      return cors(json({
        subscription: {
          id: sub.id,
          plan_id: sub.plan_id,
          plan_name: sub.plan_name,
          status: sub.status,
          price: sub.price_cents / 100,
          price_cents: sub.price_cents,
          currency: sub.currency,
          interval: sub.interval,
          features: sub.features ? JSON.parse(sub.features) : {},
          current_period_start: sub.current_period_start,
          current_period_end: sub.current_period_end,
          cancel_at_period_end: !!sub.cancel_at_period_end,
          created_at: sub.created_at,
        },
        org_plan: "active",
      }), origin);
    }

    // GET /api/billing/payments — list payment history
    if (req.method === "GET" && path === "/api/billing/payments") {
      if (authCtx.type !== "jwt") return cors(json({ error: "Unauthorized" }, 401), origin);

      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 100);
      const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

      const payments = db.prepare(`
        SELECT id, amount_cents, currency, status, description, paid_at, created_at
        FROM payments WHERE org_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
      `).all(authCtx.orgId, limit, offset) as any[];

      const total = (db.prepare("SELECT COUNT(*) as cnt FROM payments WHERE org_id = ?")
        .get(authCtx.orgId) as { cnt: number }).cnt;

      return cors(json({
        payments: payments.map(p => ({
          id: p.id,
          amount: p.amount_cents / 100,
          amount_cents: p.amount_cents,
          currency: p.currency,
          status: p.status,
          description: p.description,
          paid_at: p.paid_at,
          created_at: p.created_at,
        })),
        total,
        limit,
        offset,
      }), origin);
    }

    // POST /api/billing/subscribe — initiate subscription (creates Mollie checkout)
    if (req.method === "POST" && path === "/api/billing/subscribe") {
      if (authCtx.type !== "jwt") return cors(json({ error: "Unauthorized" }, 401), origin);

      // Only org owners can subscribe
      const membership = db.prepare("SELECT role FROM org_members WHERE org_id = ? AND user_id = ?")
        .get(authCtx.orgId, authCtx.userId) as { role: string } | null;
      if (!membership || membership.role !== "owner") {
        return cors(json({ error: "Only organization owners can manage subscriptions" }, 403), origin);
      }

      const body = await safeJson(req);
      if ("error" in body) return cors(json({ error: body.error }, 400), origin);
      const { plan_id } = body.data as { plan_id?: string };

      if (!plan_id) return cors(json({ error: "plan_id is required" }, 400), origin);

      // Validate plan exists
      const plan = db.prepare("SELECT * FROM pricing_plans WHERE id = ? AND is_active = 1")
        .get(plan_id) as any;
      if (!plan) return cors(json({ error: "Invalid plan" }, 400), origin);

      const now = Date.now();
      const subId = randomUUID();

      // Atomic check-and-insert; if already on a different plan, cancel old and create new
      const subResult = db.transaction(() => {
        const existingSub = db.prepare(`
          SELECT id, plan_id, status FROM subscriptions WHERE org_id = ? AND status IN ('active', 'pending')
        `).get(authCtx.orgId) as { id: string; plan_id: string; status: string } | null;

        if (existingSub) {
          // Same plan — no change needed
          if (existingSub.plan_id === plan_id) return { error: "same_plan" as const };
          // Upgrade/downgrade: cancel old subscription, create new one
          db.prepare(`UPDATE subscriptions SET status = 'canceled', canceled_at = ?, updated_at = ? WHERE id = ?`)
            .run(now, now, existingSub.id);
        }

        db.prepare(`
          INSERT INTO subscriptions (id, org_id, plan_id, status, created_at, updated_at)
          VALUES (?, ?, ?, 'pending', ?, ?)
        `).run(subId, authCtx.orgId, plan_id, now, now);
        return { ok: true as const, upgraded: !!existingSub };
      })();

      if ("error" in subResult) {
        return cors(json({ error: "You are already on this plan." }, 400), origin);
      }

      // If Mollie is not configured, mark as active immediately (dev/testing mode)
      if (!MOLLIE_API_KEY) {
        const periodEnd = now + (plan.interval === "year" ? 365 * 24 * 3600 * 1000 : 30 * 24 * 3600 * 1000);
        db.prepare(`
          UPDATE subscriptions SET status = 'active', current_period_start = ?, current_period_end = ?, updated_at = ?
          WHERE id = ?
        `).run(now, periodEnd, now, subId);

        // Activate org plan
        db.prepare("UPDATE orgs SET plan = 'active', trial_ends_at = NULL, grace_ends_at = NULL WHERE id = ?")
          .run(authCtx.orgId);

        // Record mock payment
        const paymentId = randomUUID();
        db.prepare(`
          INSERT INTO payments (id, org_id, subscription_id, amount_cents, currency, status, description, paid_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'paid', ?, ?, ?, ?)
        `).run(paymentId, authCtx.orgId, subId, plan.price_cents, plan.currency, `${plan.name} subscription`, now, now, now);

        console.log(`[cookieproof-api] Dev mode: Auto-activated subscription ${subId} for org ${authCtx.orgId}`);
        return cors(json({
          subscription_id: subId,
          status: "active",
          message: "Subscription activated (Mollie not configured - dev mode)",
        }), origin);
      }

      // Create Mollie payment for first charge
      // The checkout_url will redirect to Mollie's hosted checkout
      const molliePayload = {
        amount: { currency: plan.currency, value: (plan.price_cents / 100).toFixed(2) },
        description: `CookieProof ${plan.name} - First Payment`,
        redirectUrl: MOLLIE_REDIRECT_URL ? `${MOLLIE_REDIRECT_URL}?subscription_id=${subId}` : undefined,
        webhookUrl: MOLLIE_WEBHOOK_URL || undefined,
        metadata: {
          org_id: authCtx.orgId,
          subscription_id: subId,
          plan_id: plan_id,
          type: "subscription_first",
        },
        sequenceType: "first", // For recurring payments
      };

      try {
        const mollieRes = await fetch("https://api.mollie.com/v2/payments", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${MOLLIE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(molliePayload),
        });

        const mollieData = await mollieRes.json() as any;
        if (!mollieRes.ok) {
          // SECURITY: Log full error server-side but return generic message to client
          console.error("[cookieproof-api] Mollie payment creation failed:", mollieData);
          // Rollback subscription
          db.prepare("DELETE FROM subscriptions WHERE id = ?").run(subId);
          return cors(json({ error: "Payment service error. Please try again later." }, 500), origin);
        }

        // Store Mollie payment ID
        const paymentId = randomUUID();
        db.prepare(`
          INSERT INTO payments (id, org_id, subscription_id, mollie_payment_id, amount_cents, currency, status, description, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
        `).run(paymentId, authCtx.orgId, subId, mollieData.id, plan.price_cents, plan.currency, `${plan.name} subscription`, now, now);

        // Update subscription with Mollie customer ID if available
        if (mollieData.customerId) {
          db.prepare("UPDATE subscriptions SET mollie_customer_id = ?, updated_at = ? WHERE id = ?")
            .run(mollieData.customerId, now, subId);
        }

        console.log(`[cookieproof-api] Created Mollie payment ${mollieData.id} for subscription ${subId}`);
        return cors(json({
          subscription_id: subId,
          checkout_url: mollieData._links?.checkout?.href,
          status: "pending_payment",
        }), origin);
      } catch (e: any) {
        console.error("[cookieproof-api] Mollie API error:", e.message);
        db.prepare("DELETE FROM subscriptions WHERE id = ?").run(subId);
        return cors(json({ error: "Payment service unavailable" }, 503), origin);
      }
    }

    // POST /api/billing/cancel — cancel subscription at period end
    if (req.method === "POST" && path === "/api/billing/cancel") {
      if (authCtx.type !== "jwt") return cors(json({ error: "Unauthorized" }, 401), origin);

      const membership = db.prepare("SELECT role FROM org_members WHERE org_id = ? AND user_id = ?")
        .get(authCtx.orgId, authCtx.userId) as { role: string } | null;
      if (!membership || membership.role !== "owner") {
        return cors(json({ error: "Only organization owners can cancel subscriptions" }, 403), origin);
      }

      const sub = db.prepare(`
        SELECT * FROM subscriptions WHERE org_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1
      `).get(authCtx.orgId) as any;

      if (!sub) return cors(json({ error: "No active subscription found" }, 404), origin);

      const now = Date.now();

      // If Mollie subscription exists, cancel it there too
      if (MOLLIE_API_KEY && sub.mollie_subscription_id && sub.mollie_customer_id) {
        try {
          await fetch(`https://api.mollie.com/v2/customers/${sub.mollie_customer_id}/subscriptions/${sub.mollie_subscription_id}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${MOLLIE_API_KEY}` },
          });
          console.log(`[cookieproof-api] Canceled Mollie subscription ${sub.mollie_subscription_id}`);
        } catch (e: any) {
          console.error("[cookieproof-api] Mollie cancellation failed:", e.message);
          // Continue anyway - mark as canceled locally
        }
      }

      db.prepare(`
        UPDATE subscriptions SET cancel_at_period_end = 1, canceled_at = ?, updated_at = ? WHERE id = ?
      `).run(now, now, sub.id);

      // Send immediate cancellation confirmation email
      sendBillingLifecycleEmail(authCtx.orgId, "subscription_canceled").catch(e => {
        console.error(`[billing-lifecycle] Failed to send cancellation email:`, e.message);
      });

      console.log(`[cookieproof-api] Subscription ${sub.id} marked for cancellation by ${maskEmail(authCtx.email)}`);
      return cors(json({
        ok: true,
        message: "Subscription will be canceled at the end of the current billing period",
        current_period_end: sub.current_period_end,
      }), origin);
    }

    // POST /api/billing/reactivate — reactivate a canceled subscription (before period ends)
    if (req.method === "POST" && path === "/api/billing/reactivate") {
      if (authCtx.type !== "jwt") return cors(json({ error: "Unauthorized" }, 401), origin);

      const membership = db.prepare("SELECT role FROM org_members WHERE org_id = ? AND user_id = ?")
        .get(authCtx.orgId, authCtx.userId) as { role: string } | null;
      if (!membership || membership.role !== "owner") {
        return cors(json({ error: "Only organization owners can reactivate subscriptions" }, 403), origin);
      }

      const now = Date.now();

      // Check if there's a canceled subscription that hasn't expired yet
      const sub = db.prepare(`
        SELECT * FROM subscriptions WHERE org_id = ? AND cancel_at_period_end = 1 AND status = 'active'
        AND (current_period_end IS NULL OR current_period_end > ?)
        ORDER BY created_at DESC LIMIT 1
      `).get(authCtx.orgId, now) as any;

      if (sub) {
        // Reactivate the subscription
        db.prepare(`UPDATE subscriptions SET cancel_at_period_end = 0, canceled_at = NULL, updated_at = ? WHERE id = ?`)
          .run(now, sub.id);

        // Clear any scheduled deletion
        db.prepare(`UPDATE orgs SET deletion_scheduled_at = NULL WHERE id = ?`).run(authCtx.orgId);

        console.log(`[cookieproof-api] Subscription ${sub.id} reactivated by ${maskEmail(authCtx.email)}`);
        return cors(json({
          ok: true,
          message: "Subscription reactivated successfully",
        }), origin);
      }

      // Check if the org is in expired state (can resubscribe)
      const org = db.prepare("SELECT plan, deletion_scheduled_at FROM orgs WHERE id = ?")
        .get(authCtx.orgId) as { plan: string; deletion_scheduled_at: number | null } | null;

      if (org && (org.plan === "expired" || org.plan === "grace")) {
        // SECURITY: Prevent infinite free trial cycling — only allow reactivation if
        // the org has had a previous paid subscription or has never been reactivated before
        const hadPaidSub = db.prepare(
          "SELECT 1 FROM subscriptions WHERE org_id = ? AND status IN ('active', 'canceled', 'expired', 'pending') LIMIT 1"
        ).get(authCtx.orgId);
        const previousTrialReactivation = db.prepare(
          "SELECT 1 FROM billing_lifecycle_events WHERE org_id = ? AND event_type = 'trial_reactivated' LIMIT 1"
        ).get(authCtx.orgId);

        if (!hadPaidSub && previousTrialReactivation) {
          return cors(json({
            error: "Trial already used. Please subscribe to a plan to continue.",
            redirect_to_billing: true,
          }, 400), origin);
        }

        // Clear deletion schedule and restore to trial (they'll need to subscribe)
        db.prepare(`UPDATE orgs SET plan = 'trial', trial_ends_at = ?, grace_ends_at = ?, deletion_scheduled_at = NULL WHERE id = ?`)
          .run(now + 14 * 24 * 3600 * 1000, now + 21 * 24 * 3600 * 1000, authCtx.orgId);

        // Log reactivation to prevent abuse
        db.prepare(`INSERT INTO billing_lifecycle_events (id, org_id, event_type, created_at) VALUES (?, ?, 'trial_reactivated', ?)`)
          .run(randomUUID(), authCtx.orgId, now);

        logAuditEvent(authCtx.userId, "org_create", { action: "reactivate_trial" }, req, authCtx.orgId);
        console.log(`[cookieproof-api] Org ${authCtx.orgId} restored to trial by ${maskEmail(authCtx.email)}`);
        return cors(json({
          ok: true,
          message: "Account restored. Please subscribe to a plan to continue.",
          redirect_to_billing: true,
        }), origin);
      }

      return cors(json({ error: "No subscription to reactivate" }, 404), origin);
    }

    // GET /api/billing/invoices — get invoice download links (via Mollie)
    if (req.method === "GET" && path === "/api/billing/invoices") {
      if (authCtx.type !== "jwt") return cors(json({ error: "Unauthorized" }, 401), origin);

      // Get paid payments with Mollie IDs
      const payments = db.prepare(`
        SELECT id, mollie_payment_id, amount_cents, currency, description, paid_at
        FROM payments WHERE org_id = ? AND status = 'paid' AND mollie_payment_id IS NOT NULL
        ORDER BY paid_at DESC LIMIT 24
      `).all(authCtx.orgId) as any[];

      // For now, return payment info without invoice URLs
      // When Mollie is integrated, we'd fetch invoice URLs from their API
      return cors(json({
        invoices: payments.map(p => ({
          id: p.id,
          amount: p.amount_cents / 100,
          currency: p.currency,
          description: p.description,
          paid_at: p.paid_at,
          // invoice_url would come from Mollie API
        })),
      }), origin);
    }

    // Admin: GET /api/admin/billing/subscriptions — list all subscriptions
    if (req.method === "GET" && path === "/api/admin/billing/subscriptions") {
      if (authCtx.type !== "jwt" || !isAdmin(authCtx)) {
        return cors(json({ error: "Admin access required" }, 403), origin);
      }

      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
      const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
      const status = url.searchParams.get("status");

      let query = `
        SELECT s.*, o.name as org_name, p.name as plan_name, p.price_cents
        FROM subscriptions s
        JOIN orgs o ON o.id = s.org_id
        JOIN pricing_plans p ON p.id = s.plan_id
      `;
      const params: any[] = [];
      if (status) {
        query += " WHERE s.status = ?";
        params.push(status);
      }
      query += " ORDER BY s.created_at DESC LIMIT ? OFFSET ?";
      params.push(limit, offset);

      const subs = db.prepare(query).all(...params);

      let countQuery = "SELECT COUNT(*) as cnt FROM subscriptions";
      if (status) countQuery += " WHERE status = ?";
      const total = (db.prepare(countQuery).get(...(status ? [status] : [])) as { cnt: number }).cnt;

      return cors(json({ subscriptions: subs, total, limit, offset }), origin);
    }

    // Admin: PUT /api/admin/billing/subscription/:id — manually update subscription status
    if (req.method === "PUT" && path.startsWith("/api/admin/billing/subscription/")) {
      if (authCtx.type !== "jwt" || !isSuperAdmin(authCtx)) {
        return cors(json({ error: "Super admin access required" }, 403), origin);
      }

      const subId = path.slice("/api/admin/billing/subscription/".length);
      if (!subId || !UUID_RE.test(subId)) {
        return cors(json({ error: "Invalid subscription ID" }, 400), origin);
      }

      const body = await safeJson(req);
      if ("error" in body) return cors(json({ error: body.error }, 400), origin);
      const { status } = body.data as { status?: string };

      if (!status || !["active", "canceled", "expired", "pending"].includes(status)) {
        return cors(json({ error: "Invalid status. Must be: active, canceled, expired, pending" }, 400), origin);
      }

      const sub = db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(subId) as any;
      if (!sub) return cors(json({ error: "Subscription not found" }, 404), origin);

      const now = Date.now();
      db.prepare("UPDATE subscriptions SET status = ?, updated_at = ? WHERE id = ?")
        .run(status, now, subId);

      // Update org plan accordingly
      if (status === "active") {
        db.prepare("UPDATE orgs SET plan = 'active' WHERE id = ?").run(sub.org_id);
      } else if (status === "expired" || status === "canceled") {
        db.prepare("UPDATE orgs SET plan = 'expired' WHERE id = ?").run(sub.org_id);
      }

      logAuditEvent(authCtx.userId, "admin_subscription_update", {
        subscription_id: subId, org_id: sub.org_id,
        old_status: sub.status, new_status: status,
      }, req, sub.org_id);
      console.log(`[cookieproof-api] Admin ${maskEmail(authCtx.email)} set subscription ${subId} to ${status}`);
      return cors(json({ ok: true, status }), origin);
    }

    // Admin: GET /api/admin/billing/revenue — revenue stats
    if (req.method === "GET" && path === "/api/admin/billing/revenue") {
      if (authCtx.type !== "jwt" || !isAdmin(authCtx)) {
        return cors(json({ error: "Admin access required" }, 403), origin);
      }

      const now = Date.now();
      const thirtyDaysAgo = now - 30 * 24 * 3600 * 1000;

      const totalRevenue = db.prepare(`
        SELECT COALESCE(SUM(amount_cents), 0) as total FROM payments WHERE status = 'paid'
      `).get() as { total: number };

      const last30Days = db.prepare(`
        SELECT COALESCE(SUM(amount_cents), 0) as total FROM payments WHERE status = 'paid' AND paid_at >= ?
      `).get(thirtyDaysAgo) as { total: number };

      const activeSubscriptions = db.prepare(`
        SELECT COUNT(*) as cnt FROM subscriptions WHERE status = 'active'
      `).get() as { cnt: number };

      const mrr = db.prepare(`
        SELECT COALESCE(SUM(p.price_cents), 0) as total
        FROM subscriptions s
        JOIN pricing_plans p ON p.id = s.plan_id
        WHERE s.status = 'active' AND p.interval = 'month'
      `).get() as { total: number };

      const arr = db.prepare(`
        SELECT COALESCE(SUM(p.price_cents), 0) as total
        FROM subscriptions s
        JOIN pricing_plans p ON p.id = s.plan_id
        WHERE s.status = 'active' AND p.interval = 'year'
      `).get() as { total: number };

      return cors(json({
        total_revenue_cents: totalRevenue.total,
        last_30_days_cents: last30Days.total,
        active_subscriptions: activeSubscriptions.cnt,
        mrr_cents: mrr.total,
        arr_cents: arr.total,
        // Convert to display amounts
        total_revenue: totalRevenue.total / 100,
        last_30_days: last30Days.total / 100,
        mrr: mrr.total / 100,
        arr: arr.total / 100,
      }), origin);
    }

    return cors(json({ error: "Not found" }, 404), origin);
  },
});

const initialDomains = getAllowedOrigins();
if (initialDomains.length > 0) {
  const dbCount = initialDomains.length - ENV_ORIGINS.length;
  console.log(`[cookieproof-api] ${initialDomains.length} allowed origin(s): ${ENV_ORIGINS.length} from env, ${dbCount} from database.`);
} else {
  console.log("[cookieproof-api] No allowed origins configured. CORS will block cross-origin requests in production.");
}

// ---------------------------------------------------------------------------
// Startup configuration banner
// ---------------------------------------------------------------------------
{
  const ok = (s: string) => `  ✓ ${s}`;
  const warn = (s: string) => `  ⚠ ${s}`;
  const checks: string[] = [];

  // Email
  if (RESEND_API_KEY) checks.push(ok("Email: Resend configured"));
  else if (SMTP_HOST) checks.push(ok("Email: SMTP configured"));
  else checks.push(warn("Email: NOT configured — verification emails, password resets, and alerts will not be sent"));

  // Billing
  if (MOLLIE_API_KEY && MOLLIE_WEBHOOK_URL && MOLLIE_REDIRECT_URL) checks.push(ok("Billing: Mollie fully configured"));
  else if (MOLLIE_API_KEY) checks.push(warn("Billing: MOLLIE_API_KEY set but missing MOLLIE_WEBHOOK_URL or MOLLIE_REDIRECT_URL"));
  else checks.push(warn("Billing: Not configured — subscribe/billing endpoints disabled"));

  // Gotenberg
  checks.push(ok(`PDF: Gotenberg at ${GOTENBERG_URL}`));

  // CORS
  if (initialDomains.length === 0) checks.push(warn("CORS: No ALLOWED_ORIGINS — cross-origin requests will be blocked"));
  else checks.push(ok(`CORS: ${initialDomains.length} allowed origin(s)`));

  // Data retention
  if (RETENTION_DAYS <= 0 || !Number.isFinite(RETENTION_DAYS)) {
    console.error("[cookieproof-api] CRITICAL: RETENTION_DAYS is invalid — proofs may be purged immediately");
    process.exit(1);
  }
  checks.push(ok(`Retention: ${RETENTION_DAYS} days`));

  // Admin
  if (ADMIN_EMAIL) checks.push(ok(`Admin: ${ADMIN_EMAIL}`));
  else checks.push(warn("Admin: No ADMIN_EMAIL set — first registered user becomes owner"));

  console.log(`\n[cookieproof-api] ═══ Startup Configuration ═══`);
  for (const c of checks) console.log(c);
  console.log("");
}

console.log(`[cookieproof-api] Consent proof API running on :${PORT}`);

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function gracefulShutdown(signal: string, exitCode = 0): Promise<void> {
  if (_shuttingDown) return;
  _shuttingDown = true;
  console.log(`[cookieproof-api] ${signal} received — shutting down gracefully...`);

  // Stop accepting new connections
  try {
    _server?.stop();
    console.log("[cookieproof-api] Server stopped accepting connections");
  } catch {}

  // Wait for in-flight requests to complete (up to 5s)
  await new Promise(r => setTimeout(r, 5_000));

  // Flush pending data
  try { flushConfigFetchCounts(); } catch {}

  // Close database
  try { db.close(); console.log("[cookieproof-api] Database closed"); } catch {}

  console.log("[cookieproof-api] Shutdown complete");
  process.exit(exitCode);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Global error handlers — prevent silent crashes
process.on("uncaughtException", (err: any) => {
  console.error("[cookieproof-api] UNCAUGHT EXCEPTION:", err);
  gracefulShutdown("uncaughtException", 1);
});
process.on("unhandledRejection", (reason: any) => {
  // Log but don't exit — async errors in email/webhook calls shouldn't crash the server
  console.error("[cookieproof-api] UNHANDLED REJECTION:", reason);
});
