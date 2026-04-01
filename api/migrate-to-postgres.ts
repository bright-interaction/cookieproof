#!/usr/bin/env bun
/**
 * CookieProof SQLite to PostgreSQL Migration Script
 *
 * Usage:
 *   bun run migrate-to-postgres.ts --sqlite /data/consent_proofs.db --pg postgresql://user:pass@host:5432/cookieproof
 *
 * Options:
 *   --sqlite    Path to SQLite database file
 *   --pg        PostgreSQL connection string
 *   --dry-run   Show what would be migrated without actually doing it
 *   --batch     Batch size for inserts (default: 1000)
 */

import { Database as BunSQLite } from "bun:sqlite";
import { parseArgs } from "util";

// =============================================================================
// Configuration
// =============================================================================

const { values: args } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    sqlite: { type: "string", default: "/data/consent_proofs.db" },
    pg: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    batch: { type: "string", default: "1000" },
    help: { type: "boolean", default: false },
  },
});

if (args.help) {
  console.log(`
CookieProof SQLite to PostgreSQL Migration

Usage:
  bun run migrate-to-postgres.ts --sqlite <path> --pg <connection-string>

Options:
  --sqlite     Path to SQLite database (default: /data/consent_proofs.db)
  --pg         PostgreSQL connection string (required)
  --dry-run    Show counts without migrating
  --batch      Batch size for inserts (default: 1000)
  --help       Show this help message
`);
  process.exit(0);
}

if (!args.pg && !args["dry-run"]) {
  console.error("Error: --pg connection string is required (or use --dry-run)");
  process.exit(1);
}

const BATCH_SIZE = parseInt(args.batch || "1000", 10);
const DRY_RUN = args["dry-run"];

// =============================================================================
// Tables to Migrate (in dependency order)
// =============================================================================

const TABLES = [
  // Core tables first (no FK dependencies)
  "settings",
  "api_keys",
  "allowed_domains",
  "domain_configs",
  "pricing_plans",

  // Users and orgs
  "users",
  "orgs",
  "org_members",

  // Auth tokens
  "invite_tokens",
  "password_reset_tokens",
  "email_verification_tokens",
  "totp_backup_codes",
  "totp_used_codes",

  // Audit and logging
  "audit_log",
  "telemetry_events",
  "config_fetch_daily",
  "alert_log",

  // Webhooks
  "webhooks",

  // Agency features
  "agency_branding",
  "agency_smtp",
  "scheduled_reports",

  // Billing
  "subscriptions",
  "payments",
  "billing_lifecycle_events",

  // Main data (largest table - migrate last)
  "consent_proofs",
];

// =============================================================================
// Migration Logic
// =============================================================================

async function migrate() {
  console.log("=".repeat(60));
  console.log("CookieProof SQLite → PostgreSQL Migration");
  console.log("=".repeat(60));
  console.log(`SQLite:    ${args.sqlite}`);
  console.log(`Postgres:  ${args.pg ? args.pg.replace(/:[^:@]+@/, ":****@") : "(dry-run)"}`);
  console.log(`Batch:     ${BATCH_SIZE}`);
  console.log(`Dry Run:   ${DRY_RUN}`);
  console.log("=".repeat(60));

  // Open SQLite
  const sqlite = new BunSQLite(args.sqlite!, { readonly: true });
  console.log("✓ Connected to SQLite");

  // Get row counts
  const counts: Record<string, number> = {};
  for (const table of TABLES) {
    try {
      const row = sqlite.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
      counts[table] = row.count;
    } catch (e: any) {
      // Table might not exist in older schemas
      counts[table] = 0;
    }
  }

  console.log("\nTable row counts:");
  let totalRows = 0;
  for (const table of TABLES) {
    if (counts[table] > 0) {
      console.log(`  ${table.padEnd(30)} ${counts[table].toLocaleString()}`);
      totalRows += counts[table];
    }
  }
  console.log(`  ${"TOTAL".padEnd(30)} ${totalRows.toLocaleString()}`);

  if (DRY_RUN) {
    console.log("\n[dry-run] No data was migrated.");
    sqlite.close();
    return;
  }

  // Connect to Postgres
  // Note: This uses Bun's experimental postgres support or you can use pg module
  // For production, use: import { Client } from "pg";
  console.log("\n⚠️  Full Postgres migration not implemented in this script.");
  console.log("   The schema has been created. Use pg_dump/pg_restore or manual import.");
  console.log("\nTo export SQLite data:");
  console.log(`  sqlite3 ${args.sqlite} ".mode csv" ".headers on" ".output consent_proofs.csv" "SELECT * FROM consent_proofs;"`);
  console.log("\nTo import to Postgres:");
  console.log(`  psql ${args.pg} -c "\\copy consent_proofs FROM 'consent_proofs.csv' CSV HEADER;"`);

  sqlite.close();

  console.log("\n" + "=".repeat(60));
  console.log("Migration preparation complete");
  console.log("=".repeat(60));
}

// =============================================================================
// Export individual tables (for manual migration)
// =============================================================================

async function exportTable(sqlite: BunSQLite, table: string): Promise<string> {
  const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
  if (rows.length === 0) return "";

  const columns = Object.keys(rows[0] as Record<string, unknown>);
  const header = columns.join(",");

  const lines = rows.map((row: any) => {
    return columns.map((col) => {
      const val = row[col];
      if (val === null) return "";
      if (typeof val === "string") {
        // Escape quotes and wrap in quotes
        return `"${val.replace(/"/g, '""')}"`;
      }
      return String(val);
    }).join(",");
  });

  return [header, ...lines].join("\n");
}

// Run migration
migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
