// Dual-secret verifier + signer with hot-swap support, mirror of the
// Go-side internal/sharedsecret packages on brightcrm, atomicsite, scanner-
// dashboard-go, and svar-go. Lets Dockyard's rotation engine roll the
// CookieProof API_KEY and WEBHOOK_SECRET without restarting the container.
//
// During a rotation grace window the verifier accepts both current and
// previous values, so requests in flight signed with the old key still
// authenticate. The signer always uses the current value only, so we never
// emit signatures with an old key.
//
// Bun runs server.ts as a single long-lived process , these singletons live
// for the lifetime of the process and are mutated in place by the
// /api/admin/reload-secrets handler.

import { createHmac, timingSafeEqual } from "crypto";

export class Verifier {
  private primary: Buffer | null;
  private secondary: Buffer | null;

  constructor(primary: string, secondary: string) {
    this.primary = primary ? Buffer.from(primary) : null;
    this.secondary = secondary ? Buffer.from(secondary) : null;
  }

  configured(): boolean {
    return this.primary !== null && this.primary.length > 0;
  }

  hasSecondary(): boolean {
    return this.secondary !== null && this.secondary.length > 0;
  }

  update(primary: string, secondary: string): void {
    this.primary = primary ? Buffer.from(primary) : null;
    this.secondary = secondary ? Buffer.from(secondary) : null;
  }

  // equalString constant-time-compares the candidate against primary or
  // secondary. Mismatched lengths short-circuit safely (timingSafeEqual
  // throws on length mismatch , we wrap in try/catch).
  equalString(candidate: string): boolean {
    if (!this.primary) return false;
    const cand = Buffer.from(candidate);
    if (cand.length === this.primary.length) {
      try {
        if (timingSafeEqual(cand, this.primary)) return true;
      } catch {
        // length-mismatch , fall through
      }
    }
    if (this.secondary && cand.length === this.secondary.length) {
      try {
        if (timingSafeEqual(cand, this.secondary)) return true;
      } catch {
        // length-mismatch , fall through
      }
    }
    return false;
  }

  // verify checks an HMAC-SHA256 hex signature over body against either
  // current or previous. Currently unused on the inbound path (CookieProof's
  // public proof endpoint is unauthenticated) but exposed for parity with
  // the Go packages.
  verify(body: string | Buffer, hexSig: string): boolean {
    if (!this.primary) return false;
    const bodyBuf = typeof body === "string" ? Buffer.from(body) : body;
    if (signedEqual(this.primary, bodyBuf, hexSig)) return true;
    if (this.secondary && signedEqual(this.secondary, bodyBuf, hexSig)) return true;
    return false;
  }
}

export class Signer {
  private current: Buffer | null;

  constructor(current: string) {
    this.current = current ? Buffer.from(current) : null;
  }

  configured(): boolean {
    return this.current !== null && this.current.length > 0;
  }

  update(current: string): void {
    this.current = current ? Buffer.from(current) : null;
  }

  // sign returns the lowercase-hex HMAC-SHA256 of body, or empty string when
  // not configured.
  sign(body: string | Buffer): string {
    if (!this.current) return "";
    return createHmac("sha256", this.current).update(body).digest("hex");
  }
}

function signedEqual(key: Buffer, body: Buffer, hexSig: string): boolean {
  const expected = createHmac("sha256", key).update(body).digest("hex");
  if (expected.length !== hexSig.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(hexSig));
  } catch {
    return false;
  }
}
