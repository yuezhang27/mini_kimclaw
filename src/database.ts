import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'messages.db');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS groups (
    group_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE (group_id, message_id)
  )
`);

type TableInfoRow = {
  cid: number;
  name: string;
  type: string;
  notnull: 0 | 1;
  dflt_value: string | null;
  pk: 0 | 1;
};

type IndexListRow = {
  seq: number;
  name: string;
  unique: 0 | 1;
  origin: string;
  partial: 0 | 1;
};

type IndexInfoRow = {
  seqno: number;
  cid: number;
  name: string;
};

function hasCompositeUniqueConstraint(): boolean {
  const indexes = db.prepare("PRAGMA index_list(messages)").all() as IndexListRow[];

  for (const index of indexes) {
    if (index.unique !== 1) {
      continue;
    }

    const columns = db
      .prepare(`PRAGMA index_info(${index.name})`)
      .all() as IndexInfoRow[];
    const columnNames = columns.map((column) => column.name);

    if (
      columnNames.length === 2 &&
      columnNames[0] === "group_id" &&
      columnNames[1] === "message_id"
    ) {
      return true;
    }
  }

  return false;
}

function migrateMessagesTable(): void {
  const columns = db.prepare("PRAGMA table_info(messages)").all() as TableInfoRow[];
  const hasChatId = columns.some((column) => column.name === 'chat_id');
  const hasGroupId = columns.some((column) => column.name === 'group_id');

  if (!hasGroupId) {
    db.exec("ALTER TABLE messages ADD COLUMN group_id TEXT");
  }

  if (hasChatId) {
    db.exec("UPDATE messages SET group_id = chat_id WHERE group_id IS NULL OR group_id = ''");
  }

  const latestColumns = db.prepare("PRAGMA table_info(messages)").all() as TableInfoRow[];
  const groupIdColumn = latestColumns.find((column) => column.name === 'group_id');
  const tableSqlRow = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'")
    .get() as { sql: string } | undefined;
  const hasLegacyMessageUnique = tableSqlRow?.sql.includes("message_id TEXT NOT NULL UNIQUE") ?? false;
  const hasCompositeUnique = hasCompositeUniqueConstraint();
  const needsRebuild =
    hasChatId ||
    !groupIdColumn ||
    groupIdColumn.notnull === 0 ||
    hasLegacyMessageUnique ||
    !hasCompositeUnique;

  if (!needsRebuild) {
    return;
  }

  const groupIdSelectExpr = hasChatId
    ? "COALESCE(NULLIF(group_id, ''), chat_id)"
    : "group_id";

  const migrateSql = `
    BEGIN TRANSACTION;
    CREATE TABLE messages_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      UNIQUE (group_id, message_id)
    );

    INSERT OR IGNORE INTO messages_new (id, group_id, message_id, text, status, created_at)
    SELECT id, ${groupIdSelectExpr}, message_id, text, status, created_at
    FROM messages;

    DROP TABLE messages;
    ALTER TABLE messages_new RENAME TO messages;
    COMMIT;
  `;

  db.exec(migrateSql);
}

migrateMessagesTable();

export interface MessageRecord {
  id: number;
  group_id: string;
  message_id: string;
  text: string;
  status: string;
  created_at: string;
}

export function registerGroup(groupId: number): boolean {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO groups (group_id)
    VALUES (?)
  `);

  const result = stmt.run(groupId.toString());
  return result.changes > 0;
}

export function saveMessage(groupId: number, messageId: number, text: string): MessageRecord | null {
  try {
    const stmt = db.prepare(`
      INSERT INTO messages (group_id, message_id, text, status)
      VALUES (?, ?, ?, 'pending')
    `);

    const result = stmt.run(groupId.toString(), messageId.toString(), text);

    const saved = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid) as MessageRecord;

    return saved;
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      console.log(`[DB] Message already exists: group_id=${groupId}, message_id=${messageId}`);
      return null;
    }
    throw error;
  }
}

export function getOldestPendingMessage(): MessageRecord | null {
  const row = db
    .prepare(
      `
        SELECT * FROM messages
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT 1
      `,
    )
    .get() as MessageRecord | undefined;

  return row ?? null;
}

export function updateMessageStatus(id: number, status: "pending" | "done" | "error"): void {
  db.prepare(
    `
      UPDATE messages
      SET status = ?
      WHERE id = ?
    `,
  ).run(status, id);
}

export default db;
