import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const databasePath = resolve(process.env.DOPABITE_DATABASE_PATH ?? '.data/dopabite.sqlite3')

mkdirSync(dirname(databasePath), { recursive: true })

export const database = new DatabaseSync(databasePath)

database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`)

export function createProductTables() {
  database.exec(`
    CREATE TABLE IF NOT EXISTS restaurants (
      amap_poi_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      longitude REAL,
      latitude REAL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ratings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amap_poi_id TEXT NOT NULL,
      taste_score INTEGER NOT NULL CHECK (taste_score BETWEEN 1 AND 5),
      value_score INTEGER NOT NULL CHECK (value_score BETWEEN 1 AND 5),
      return_score INTEGER NOT NULL CHECK (return_score BETWEEN 1 AND 5),
      note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 160),
      status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'pending', 'rejected')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
      FOREIGN KEY (amap_poi_id) REFERENCES restaurants(amap_poi_id) ON DELETE CASCADE,
      UNIQUE (user_id, amap_poi_id)
    );

    CREATE INDEX IF NOT EXISTS ratings_poi_status_updated_idx
      ON ratings(amap_poi_id, status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS saved_locations (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
      longitude REAL NOT NULL,
      latitude REAL NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, id),
      FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS saved_locations_user_updated_idx
      ON saved_locations(user_id, updated_at DESC);
  `)

  const restaurantColumns = new Set(
    (database.prepare('PRAGMA table_info(restaurants)').all() as unknown as { name: string }[])
      .map((column) => column.name),
  )
  const restaurantColumnMigrations = [
    ['business_area', "ALTER TABLE restaurants ADD COLUMN business_area TEXT NOT NULL DEFAULT ''"],
    ['image_url', 'ALTER TABLE restaurants ADD COLUMN image_url TEXT'],
    ['amap_rating', 'ALTER TABLE restaurants ADD COLUMN amap_rating REAL'],
    ['average_cost', 'ALTER TABLE restaurants ADD COLUMN average_cost REAL'],
    ['open_time', 'ALTER TABLE restaurants ADD COLUMN open_time TEXT'],
    ['source', "ALTER TABLE restaurants ADD COLUMN source TEXT NOT NULL DEFAULT 'amap-live'"],
  ] as const

  for (const [column, statement] of restaurantColumnMigrations) {
    if (!restaurantColumns.has(column)) database.exec(statement)
  }
}
