import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from '../drizzle/schema'

function createDb() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set')
  }
  const sql = neon(databaseUrl)
  return drizzle(sql, { schema })
}

// Lazy initialization — only creates the connection when first accessed at runtime,
// not during the build step when DATABASE_URL is unavailable.
let _db: ReturnType<typeof createDb> | undefined

export function getDb() {
  if (!_db) {
    _db = createDb()
  }
  return _db
}
