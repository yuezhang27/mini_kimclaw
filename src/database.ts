import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dataDir = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'messages.db');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    message_id TEXT NOT NULL UNIQUE,
    text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  )
`);

export interface MessageRecord {
  id: number;
  chat_id: string;
  message_id: string;
  text: string;
  status: string;
  created_at: string;
}

export function saveMessage(chatId: number, messageId: number, text: string): MessageRecord | null {
  try {
    const stmt = db.prepare(`
      INSERT INTO messages (chat_id, message_id, text, status)
      VALUES (?, ?, ?, 'pending')
    `);

    const result = stmt.run(chatId.toString(), messageId.toString(), text);

    const saved = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid) as MessageRecord;

    return saved;
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      console.log(`[DB] Message already exists: message_id=${messageId}`);
      return null;
    }
    throw error;
  }
}

export default db;
