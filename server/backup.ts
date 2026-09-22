import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const databasePath = resolve(process.env.DOPABITE_DATABASE_PATH ?? '.data/dopabite.sqlite3')
const backupDirectory = resolve(process.env.DOPABITE_BACKUP_PATH ?? '.data/backups')
const retention = Math.max(1, Number.parseInt(process.env.DOPABITE_BACKUP_RETENTION ?? '7', 10))

if (backupDirectory === resolve('/') || backupDirectory === resolve('.')) {
  throw new Error('Backup path must be a dedicated directory')
}

mkdirSync(backupDirectory, { recursive: true })

const stamp = new Date().toISOString().replaceAll(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
const backupPath = resolve(backupDirectory, `dopabite-${stamp}.sqlite3`)
const escapedBackupPath = backupPath.replaceAll("'", "''")
const source = new DatabaseSync(databasePath, { readOnly: true })

source.exec(`VACUUM INTO '${escapedBackupPath}'`)
source.close()

const verification = new DatabaseSync(backupPath, { readOnly: true })
const integrity = verification.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
verification.close()
if (integrity.integrity_check !== 'ok') {
  rmSync(backupPath, { force: true })
  throw new Error(`Backup integrity check failed: ${integrity.integrity_check}`)
}

const checksum = createHash('sha256').update(readFileSync(backupPath)).digest('hex')
writeFileSync(`${backupPath}.sha256`, `${checksum}  ${basename(backupPath)}\n`, { encoding: 'utf8' })

const snapshots = readdirSync(backupDirectory)
  .filter((name) => /^dopabite-\d{8}T\d{6}Z\.sqlite3$/.test(name))
  .sort()

for (const expired of snapshots.slice(0, Math.max(0, snapshots.length - retention))) {
  const expiredPath = resolve(backupDirectory, expired)
  if (!expiredPath.startsWith(`${backupDirectory}\\`) && !expiredPath.startsWith(`${backupDirectory}/`)) {
    throw new Error('Refusing to remove a backup outside the configured directory')
  }
  rmSync(expiredPath, { force: true })
  rmSync(`${expiredPath}.sha256`, { force: true })
}

console.log(`Verified SQLite snapshot: ${backupPath}`)
