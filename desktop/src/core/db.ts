import initSqlJs, { type Database, type SqlValue } from 'sql.js'

export type Params = SqlValue[]

const MIGRATIONS: string[] = [
  `
  CREATE TABLE project(
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('youtrack','local')),
    name TEXT NOT NULL,
    client TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL,
    favorite INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    yt_project_id TEXT,
    yt_issue TEXT,
    yt_work_type_id TEXT,
    yt_stale INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE entry(
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES project(id),
    start_utc INTEGER NOT NULL,
    end_utc INTEGER,
    note TEXT NOT NULL DEFAULT '',
    yt_issue TEXT
  );
  CREATE INDEX entry_start ON entry(start_utc);
  CREATE UNIQUE INDEX entry_one_open ON entry(end_utc IS NULL) WHERE end_utc IS NULL;
  CREATE TABLE presence(
    id INTEGER PRIMARY KEY,
    start_utc INTEGER NOT NULL,
    end_utc INTEGER
  );
  CREATE UNIQUE INDEX presence_one_open ON presence(end_utc IS NULL) WHERE end_utc IS NULL;
  CREATE TABLE pause(
    id INTEGER PRIMARY KEY,
    presence_id INTEGER NOT NULL REFERENCES presence(id) ON DELETE CASCADE,
    start_utc INTEGER NOT NULL,
    end_utc INTEGER,
    resume_project_id INTEGER
  );
  CREATE UNIQUE INDEX pause_one_open ON pause(end_utc IS NULL) WHERE end_utc IS NULL;
  -- No FK to entry: rows outlive a deleted entry until its work items are removed remotely.
  CREATE TABLE booking(
    entry_id INTEGER NOT NULL,
    day TEXT NOT NULL,
    connector TEXT NOT NULL,
    remote_id TEXT,
    remote_issue TEXT,
    synced_hash TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending','booked','error','delete')),
    error TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_try INTEGER NOT NULL DEFAULT 0,
    synced_at INTEGER,
    PRIMARY KEY(entry_id, day, connector)
  );
  CREATE TABLE setting(key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE remote_cache(key TEXT PRIMARY KEY, value TEXT NOT NULL, fetched_at INTEGER NOT NULL);
  `
]

export class Db {
  private depth = 0
  private dirty = false

  constructor(
    private readonly sql: Database,
    private readonly onChange?: () => void
  ) {
    this.sql.run('PRAGMA foreign_keys = ON')
    this.migrate()
  }

  private migrate(): void {
    const version = Number(this.sql.exec('PRAGMA user_version')[0]?.values[0][0] ?? 0)
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.tx(() => {
        this.sql.exec(MIGRATIONS[v])
        this.sql.run(`PRAGMA user_version = ${v + 1}`)
      })
    }
  }

  all<T>(query: string, params: Params = []): T[] {
    const stmt = this.sql.prepare(query)
    try {
      stmt.bind(params)
      const rows: T[] = []
      while (stmt.step()) rows.push(stmt.getAsObject() as T)
      return rows
    } finally {
      stmt.free()
    }
  }

  get<T>(query: string, params: Params = []): T | undefined {
    return this.all<T>(query, params)[0]
  }

  run(query: string, params: Params = []): { id: number; changes: number } {
    this.sql.run(query, params)
    const changes = this.sql.getRowsModified()
    const id = Number(this.sql.exec('SELECT last_insert_rowid()')[0].values[0][0])
    if (changes > 0) this.markDirty()
    return { id, changes }
  }

  /** Runs `fn` atomically. Nested calls join the outer transaction. */
  tx<T>(fn: () => T): T {
    if (this.depth === 0) this.sql.run('BEGIN')
    this.depth++
    try {
      const result = fn()
      this.depth--
      if (this.depth === 0) {
        this.sql.run('COMMIT')
        this.flushChange()
      }
      return result
    } catch (err) {
      this.depth--
      if (this.depth === 0) {
        this.sql.run('ROLLBACK')
        this.dirty = false
      }
      throw err
    }
  }

  export(): Uint8Array {
    if (this.depth > 0) throw new Error('export inside transaction')
    const data = this.sql.export()
    // sql.js reopens the database on export, which resets connection pragmas.
    this.sql.run('PRAGMA foreign_keys = ON')
    return data
  }

  close(): void {
    this.sql.close()
  }

  private markDirty(): void {
    this.dirty = true
    if (this.depth === 0) this.flushChange()
  }

  private flushChange(): void {
    if (!this.dirty) return
    this.dirty = false
    this.onChange?.()
  }
}

export interface OpenDbOptions {
  data?: Uint8Array
  wasmPath?: string
  onChange?: () => void
}

export async function openDb(opts: OpenDbOptions = {}): Promise<Db> {
  const SQL = await initSqlJs(opts.wasmPath ? { locateFile: () => opts.wasmPath! } : undefined)
  return new Db(new SQL.Database(opts.data), opts.onChange)
}
