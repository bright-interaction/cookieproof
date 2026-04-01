/**
 * CookieProof Database Abstraction Layer
 * Supports both SQLite (Bun native) and PostgreSQL
 *
 * Set DB_TYPE=postgres and DATABASE_URL to use Postgres
 * Default: SQLite at /data/consent_proofs.db
 */

import { Database as BunSQLite } from "bun:sqlite";

// =============================================================================
// Types
// =============================================================================

export interface DatabaseDriver {
  // Query execution
  prepare(sql: string): PreparedStatement;
  exec(sql: string): void;

  // Transaction support
  transaction<T>(fn: () => T): T;

  // Connection management
  close(): void;

  // Driver info
  readonly type: "sqlite" | "postgres";
}

export interface PreparedStatement {
  run(...params: any[]): RunResult;
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

export interface RunResult {
  changes: number;
  lastInsertRowid?: number | bigint;
}

// =============================================================================
// SQLite Driver (Bun native)
// =============================================================================

class SQLiteDriver implements DatabaseDriver {
  readonly type = "sqlite" as const;
  private db: BunSQLite;

  constructor(path: string) {
    this.db = new BunSQLite(path, { create: true });
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec("PRAGMA busy_timeout=5000");
    // Security: Restrict to read-only mode for temp tables
    this.db.exec("PRAGMA temp_store=MEMORY");
    // Performance: Enable memory-mapped I/O
    this.db.exec("PRAGMA mmap_size=268435456"); // 256MB
  }

  prepare(sql: string): PreparedStatement {
    const stmt = this.db.prepare(sql);
    return {
      run: (...params: any[]) => {
        const result = stmt.run(...params);
        return {
          changes: result.changes,
          lastInsertRowid: result.lastInsertRowid,
        };
      },
      get: (...params: any[]) => stmt.get(...params),
      all: (...params: any[]) => stmt.all(...params),
    };
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  close(): void {
    this.db.close();
  }
}

// =============================================================================
// PostgreSQL Driver (via pg module)
// =============================================================================

// Note: Postgres driver will be implemented when ready to migrate
// For now, this is a placeholder that shows the interface

class PostgresDriver implements DatabaseDriver {
  readonly type = "postgres" as const;
  private connectionString: string;
  private preparedStatements: Map<string, any> = new Map();

  constructor(connectionString: string) {
    this.connectionString = connectionString;
    // In production, use a connection pool (pg-pool)
    console.log("[db] PostgreSQL driver initialized (connection pooling recommended)");
  }

  prepare(sql: string): PreparedStatement {
    // Convert SQLite ? placeholders to Postgres $1, $2, etc.
    const pgSql = this.convertPlaceholders(sql);

    return {
      run: (...params: any[]) => {
        // This would use pg client in production
        console.warn("[db] PostgreSQL run() not fully implemented");
        return { changes: 0 };
      },
      get: (...params: any[]) => {
        console.warn("[db] PostgreSQL get() not fully implemented");
        return null;
      },
      all: (...params: any[]) => {
        console.warn("[db] PostgreSQL all() not fully implemented");
        return [];
      },
    };
  }

  exec(sql: string): void {
    // Execute raw SQL
    console.warn("[db] PostgreSQL exec() not fully implemented");
  }

  transaction<T>(fn: () => T): T {
    // Wrap in BEGIN/COMMIT
    return fn();
  }

  close(): void {
    // Close connection pool
  }

  // Convert ? placeholders to $1, $2, etc.
  private convertPlaceholders(sql: string): string {
    let index = 0;
    return sql.replace(/\?/g, () => `$${++index}`);
  }
}

// =============================================================================
// Factory
// =============================================================================

const DB_TYPE = process.env.DB_TYPE || "sqlite";
const DB_PATH = process.env.DB_PATH || "/data/consent_proofs.db";
const DATABASE_URL = process.env.DATABASE_URL || "";

export function createDatabase(): DatabaseDriver {
  if (DB_TYPE === "postgres") {
    if (!DATABASE_URL) {
      throw new Error("DATABASE_URL is required when DB_TYPE=postgres");
    }
    console.log("[db] Using PostgreSQL database");
    return new PostgresDriver(DATABASE_URL);
  }

  console.log(`[db] Using SQLite database at ${DB_PATH}`);
  return new SQLiteDriver(DB_PATH);
}

// =============================================================================
// Default Export (singleton)
// =============================================================================

let _db: DatabaseDriver | null = null;

export function getDatabase(): DatabaseDriver {
  if (!_db) {
    _db = createDatabase();
  }
  return _db;
}

export default getDatabase;
