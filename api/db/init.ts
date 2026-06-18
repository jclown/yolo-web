import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbPath = path.join(process.cwd(), 'data', 'yolo-platform.db');

const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS datasets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    dataset_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    path TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dataset_id) REFERENCES datasets(id)
  );

  CREATE TABLE IF NOT EXISTS annotations (
    id TEXT PRIMARY KEY,
    image_id TEXT NOT NULL,
    class_id TEXT NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    width REAL NOT NULL,
    height REAL NOT NULL,
    FOREIGN KEY (image_id) REFERENCES images(id)
  );

  CREATE TABLE IF NOT EXISTS models (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    path TEXT NOT NULL,
    mAP50 REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS training_tasks (
    id TEXT PRIMARY KEY,
    model_id TEXT NOT NULL,
    dataset_id TEXT NOT NULL,
    status TEXT NOT NULL,
    epochs INTEGER NOT NULL,
    current_epoch INTEGER DEFAULT 0,
    config TEXT,
    started_at DATETIME,
    completed_at DATETIME,
    FOREIGN KEY (model_id) REFERENCES models(id),
    FOREIGN KEY (dataset_id) REFERENCES datasets(id)
  );

  CREATE TABLE IF NOT EXISTS metric_logs (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    epoch INTEGER NOT NULL,
    train_loss REAL,
    val_loss REAL,
    mAP50 REAL,
    mAP50_95 REAL,
    FOREIGN KEY (task_id) REFERENCES training_tasks(id)
  );

  CREATE TABLE IF NOT EXISTS augment_tasks (
    id TEXT PRIMARY KEY,
    dataset_id TEXT NOT NULL,
    strategies TEXT NOT NULL,
    multiplier INTEGER NOT NULL,
    status TEXT NOT NULL,
    progress INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dataset_id) REFERENCES datasets(id)
  );

  CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    FOREIGN KEY (dataset_id) REFERENCES datasets(id)
  );
`);

export default db;
