import { randomUUID } from 'crypto'
import { getDatabase } from '../connection'
import type {
  CompanySummary,
  CompanyDetail,
  CompanyMeetingRef,
  CompanyEmailRef,
  CompanyTimelineItem
} from '../../../shared/types/company'

interface CompanyRow {
  id: string
  canonical_name: string
  normalized_name: string
  description: string | null
  primary_domain: string | null
  website_url: string | null
  stage: string | null
  status: string
  crm_provider: string | null
  crm_company_id: string | null
  meeting_count: number
  email_count: number
  note_count: number
  last_touchpoint: string | null
  created_at: string
  updated_at: string
}

function normalizeCompanyName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
}

function rowToCompanySummary(row: CompanyRow): CompanySummary {
  return {
    id: row.id,
    canonicalName: row.canonical_name,
    normalizedName: row.normalized_name,
    description: row.description,
    primaryDomain: row.primary_domain,
    websiteUrl: row.website_url,
    stage: row.stage,
    status: row.status,
    crmProvider: row.crm_provider,
    crmCompanyId: row.crm_company_id,
    meetingCount: row.meeting_count || 0,
    emailCount: row.email_count || 0,
    noteCount: row.note_count || 0,
    lastTouchpoint: row.last_touchpoint,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function baseCompanySelect(whereClause = ''): string {
  return `
    SELECT
      c.id,
      c.canonical_name,
      c.normalized_name,
      c.description,
      c.primary_domain,
      c.website_url,
      c.stage,
      c.status,
      c.crm_provider,
      c.crm_company_id,
      COALESCE(mc.meeting_count, 0) AS meeting_count,
      COALESCE(ec.email_count, 0) AS email_count,
      COALESCE(nc.note_count, 0) AS note_count,
      COALESCE(
        CASE
          WHEN mc.last_meeting_at IS NULL THEN ec.last_email_at
          WHEN ec.last_email_at IS NULL THEN mc.last_meeting_at
          WHEN mc.last_meeting_at > ec.last_email_at THEN mc.last_meeting_at
          ELSE ec.last_email_at
        END,
        c.updated_at
      ) AS last_touchpoint,
      c.created_at,
      c.updated_at
    FROM org_companies c
    LEFT JOIN (
      SELECT
        l.company_id,
        COUNT(DISTINCT l.meeting_id) AS meeting_count,
        MAX(m.date) AS last_meeting_at
      FROM meeting_company_links l
      JOIN meetings m ON m.id = l.meeting_id
      GROUP BY l.company_id
    ) mc ON mc.company_id = c.id
    LEFT JOIN (
      SELECT
        l.company_id,
        COUNT(DISTINCT l.message_id) AS email_count,
        MAX(COALESCE(em.received_at, em.sent_at, em.created_at)) AS last_email_at
      FROM email_company_links l
      JOIN email_messages em ON em.id = l.message_id
      GROUP BY l.company_id
    ) ec ON ec.company_id = c.id
    LEFT JOIN (
      SELECT company_id, COUNT(*) AS note_count
      FROM company_notes
      GROUP BY company_id
    ) nc ON nc.company_id = c.id
    ${whereClause}
  `
}

export function listCompanies(filter?: {
  query?: string
  limit?: number
  offset?: number
}): CompanySummary[] {
  const db = getDatabase()
  const query = filter?.query?.trim()
  const conditions: string[] = []
  const params: unknown[] = []

  if (query) {
    conditions.push('(c.canonical_name LIKE ? OR c.primary_domain LIKE ? OR c.description LIKE ?)')
    const like = `%${query}%`
    params.push(like, like, like)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = filter?.limit ?? 200
  const offset = filter?.offset ?? 0

  const rows = db
    .prepare(
      `${baseCompanySelect(where)}
       ORDER BY datetime(last_touchpoint) DESC, c.canonical_name ASC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as CompanyRow[]

  return rows.map(rowToCompanySummary)
}

export function getCompany(companyId: string): CompanyDetail | null {
  const db = getDatabase()
  const row = db
    .prepare(`${baseCompanySelect('WHERE c.id = ?')} LIMIT 1`)
    .get(companyId) as CompanyRow | undefined
  if (!row) return null

  const industries = db
    .prepare(`
      SELECT i.name
      FROM org_company_industries ci
      JOIN industries i ON i.id = ci.industry_id
      WHERE ci.company_id = ?
      ORDER BY ci.is_primary DESC, i.name ASC
    `)
    .all(companyId) as { name: string }[]

  const themes = db
    .prepare(`
      SELECT t.name
      FROM org_company_themes ct
      JOIN themes t ON t.id = ct.theme_id
      WHERE ct.company_id = ?
      ORDER BY ct.relevance_score DESC, t.name ASC
    `)
    .all(companyId) as { name: string }[]

  return {
    ...rowToCompanySummary(row),
    industries: industries.map((v) => v.name),
    themes: themes.map((v) => v.name)
  }
}

export function createCompany(data: {
  canonicalName: string
  description?: string | null
  primaryDomain?: string | null
  websiteUrl?: string | null
  stage?: string | null
  status?: string
}): CompanyDetail {
  const db = getDatabase()
  const canonicalName = data.canonicalName.trim()
  const normalizedName = normalizeCompanyName(canonicalName)
  const id = randomUUID()

  db.prepare(`
    INSERT INTO org_companies (
      id, canonical_name, normalized_name, description, primary_domain, website_url, stage, status,
      created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(normalized_name) DO UPDATE SET
      canonical_name = excluded.canonical_name,
      description = COALESCE(excluded.description, org_companies.description),
      primary_domain = COALESCE(excluded.primary_domain, org_companies.primary_domain),
      website_url = COALESCE(excluded.website_url, org_companies.website_url),
      stage = COALESCE(excluded.stage, org_companies.stage),
      status = COALESCE(excluded.status, org_companies.status),
      updated_at = datetime('now')
  `).run(
    id,
    canonicalName,
    normalizedName,
    data.description ?? null,
    data.primaryDomain ?? null,
    data.websiteUrl ?? null,
    data.stage ?? null,
    data.status ?? 'active'
  )

  const row = db
    .prepare('SELECT id FROM org_companies WHERE normalized_name = ?')
    .get(normalizedName) as { id: string } | undefined
  if (!row) {
    throw new Error('Failed to create or load company')
  }

  const detail = getCompany(row.id)
  if (!detail) {
    throw new Error('Failed to load created company')
  }
  return detail
}

export function updateCompany(
  companyId: string,
  data: Partial<{
    canonicalName: string
    description: string | null
    primaryDomain: string | null
    websiteUrl: string | null
    stage: string | null
    status: string
  }>
): CompanyDetail | null {
  const db = getDatabase()
  const sets: string[] = []
  const params: unknown[] = []

  if (data.canonicalName !== undefined) {
    sets.push('canonical_name = ?')
    params.push(data.canonicalName.trim())
    sets.push('normalized_name = ?')
    params.push(normalizeCompanyName(data.canonicalName))
  }
  if (data.description !== undefined) {
    sets.push('description = ?')
    params.push(data.description)
  }
  if (data.primaryDomain !== undefined) {
    sets.push('primary_domain = ?')
    params.push(data.primaryDomain)
  }
  if (data.websiteUrl !== undefined) {
    sets.push('website_url = ?')
    params.push(data.websiteUrl)
  }
  if (data.stage !== undefined) {
    sets.push('stage = ?')
    params.push(data.stage)
  }
  if (data.status !== undefined) {
    sets.push('status = ?')
    params.push(data.status)
  }

  if (sets.length > 0) {
    sets.push("updated_at = datetime('now')")
    params.push(companyId)
    db.prepare(`UPDATE org_companies SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  }

  return getCompany(companyId)
}

export function listCompanyMeetings(companyId: string): CompanyMeetingRef[] {
  const db = getDatabase()
  const rows = db
    .prepare(`
      SELECT
        m.id,
        m.title,
        m.date,
        m.status,
        m.duration_seconds
      FROM meeting_company_links l
      JOIN meetings m ON m.id = l.meeting_id
      WHERE l.company_id = ?
      ORDER BY datetime(m.date) DESC
    `)
    .all(companyId) as Array<{
    id: string
    title: string
    date: string
    status: string
    duration_seconds: number | null
  }>

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    date: row.date,
    status: row.status,
    durationSeconds: row.duration_seconds
  }))
}

export function listCompanyEmails(companyId: string): CompanyEmailRef[] {
  const db = getDatabase()
  const rows = db
    .prepare(`
      SELECT
        em.id,
        em.subject,
        em.from_email,
        em.from_name,
        em.received_at,
        em.sent_at,
        em.snippet,
        em.is_unread,
        em.thread_id
      FROM email_company_links l
      JOIN email_messages em ON em.id = l.message_id
      WHERE l.company_id = ?
      ORDER BY datetime(COALESCE(em.received_at, em.sent_at, em.created_at)) DESC
      LIMIT 200
    `)
    .all(companyId) as Array<{
    id: string
    subject: string | null
    from_email: string
    from_name: string | null
    received_at: string | null
    sent_at: string | null
    snippet: string | null
    is_unread: number
    thread_id: string | null
  }>

  return rows.map((row) => ({
    id: row.id,
    subject: row.subject,
    fromEmail: row.from_email,
    fromName: row.from_name,
    receivedAt: row.received_at,
    sentAt: row.sent_at,
    snippet: row.snippet,
    isUnread: row.is_unread === 1,
    threadId: row.thread_id
  }))
}

export function listCompanyTimeline(companyId: string): CompanyTimelineItem[] {
  const meetingItems: CompanyTimelineItem[] = listCompanyMeetings(companyId).map((meeting) => ({
    id: `meeting:${meeting.id}`,
    type: 'meeting',
    title: meeting.title,
    occurredAt: meeting.date,
    subtitle: meeting.status,
    referenceId: meeting.id
  }))

  const emailItems: CompanyTimelineItem[] = listCompanyEmails(companyId).map((email) => ({
    id: `email:${email.id}`,
    type: 'email',
    title: email.subject?.trim() || '(no subject)',
    occurredAt: email.receivedAt || email.sentAt || new Date().toISOString(),
    subtitle: email.fromName ? `${email.fromName} <${email.fromEmail}>` : email.fromEmail,
    referenceId: email.id
  }))

  return [...meetingItems, ...emailItems].sort((a, b) =>
    new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  )
}
