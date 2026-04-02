import { readFileSync } from 'node:fs';
import { gzipSync, brotliCompressSync } from 'node:zlib';

const file = 'dist/cookieproof.esm.js';
const buf = readFileSync(file);
const gz = gzipSync(buf);
const br = brotliCompressSync(buf);

const raw = (buf.length / 1024).toFixed(1);
const gzip = (gz.length / 1024).toFixed(1);
const brotli = (br.length / 1024).toFixed(1);

console.log(`\nCookieProof bundle size:`);
console.log(`  Raw:    ${raw} KB`);
console.log(`  Gzip:   ${gzip} KB`);
console.log(`  Brotli: ${brotli} KB`);

const MAX_GZIP_KB = 25;
if (gz.length / 1024 > MAX_GZIP_KB) {
  console.error(`\n  FAIL: Gzip size exceeds ${MAX_GZIP_KB}KB budget!`);
  process.exit(1);
}
console.log(`\n  PASS: Under ${MAX_GZIP_KB}KB gzip budget.\n`);
