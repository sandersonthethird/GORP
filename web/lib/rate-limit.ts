import { getDb } from './db'
import { rateLimits } from '../drizzle/schema'
import { eq, sql } from 'drizzle-orm'

const DAILY_LIMIT = 50

export async function checkRateLimit(
  token: string
): Promise<{ allowed: boolean; remaining: number }> {
  const today = new Date().toISOString().split('T')[0]

  const result = await getDb()
    .insert(rateLimits)
    .values({
      token,
      chatCountDay: 1,
      lastReset: today,
      totalQueries: 1,
    })
    .onConflictDoUpdate({
      target: rateLimits.token,
      set: {
        chatCountDay: sql`CASE
          WHEN ${rateLimits.lastReset} < ${today} THEN 1
          ELSE ${rateLimits.chatCountDay} + 1
        END`,
        lastReset: sql`CASE
          WHEN ${rateLimits.lastReset} < ${today} THEN ${today}::date
          ELSE ${rateLimits.lastReset}
        END`,
        totalQueries: sql`${rateLimits.totalQueries} + 1`,
      },
    })
    .returning({ chatCountDay: rateLimits.chatCountDay })

  const count = result[0]?.chatCountDay ?? 0
  return { allowed: count <= DAILY_LIMIT, remaining: Math.max(0, DAILY_LIMIT - count) }
}
