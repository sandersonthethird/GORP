# V1 Company-Centric OS: Concrete Schema + Screen Map

## 1. V1 Scope and Constraints

### Product Goal
Unify meeting intelligence, files, email artifacts, and pipeline context around a single canonical entity: `Company`, with first-class `Industry` and `Theme`.

### V1 Guardrails
- Keep existing meeting capture/transcription workflows untouched.
- Add new modules behind feature flags.
- Prefer read-only external integrations first (CRM, email, Drive metadata ingest).
- Require source citations for generated thesis statements and claims.

### Explicit Non-Goals (V1)
- No multi-user collaboration or RBAC.
- No full write-back CRM sync (read-only ingest only).
- No autonomous investment recommendations without explicit evidence links.

---

## 2. Data Model (V1)

## 2.1 Relationship Overview

- One `Company` can have many `Meetings`, `Artifacts`, `Contacts`, `Themes`, and `Deals`.
- One `Company` can have many persisted AI `CompanyConversations`.
- One `Company` can have many user-authored `CompanyNotes`.
- One `Company` can have many versioned `InvestmentMemos`.
- Each exported memo PDF is tracked as an `Artifact` so it is searchable and citable.
- One `Theme` can map to many `Companies`; one `Company` can map to many `Themes`.
- One `Company` can map to many `Industries`; one `Industry` can map to many `Companies`.
- One `EmailAccount` has many `EmailThreads` and `EmailMessages`.
- One `EmailMessage` can link to one or more `Companies`, `Contacts`, and optional `Themes`.
- Email attachments are promoted to `Artifacts` for unified search and evidence reuse.
- `Thesis` belongs to a `Company` or `Theme` and contains `Claims`.
- `Claim` must link to one or more `Evidence` records, each pointing to a source artifact/snippet.

---

## 2.2 Concrete SQLite Schema (new tables)

Note: this codebase already has a `companies` table used as domain cache (`domain -> display_name`).
To avoid breaking that, use `org_*` tables for the Company OS domain model.

```sql
-- Canonical company records
CREATE TABLE IF NOT EXISTS org_companies (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  description TEXT, -- short company summary/description
  primary_domain TEXT,
  website_url TEXT,
  stage TEXT, -- pre-seed/seed/series_a/...
  status TEXT NOT NULL DEFAULT 'active', -- active/watchlist/archived
  crm_provider TEXT, -- affinity/attio/hubspot/salesforce/null
  crm_company_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_org_companies_domain ON org_companies(primary_domain);
CREATE INDEX IF NOT EXISTS idx_org_companies_status ON org_companies(status);

-- Alternate names/domains/tickers for matching and ingest normalization
CREATE TABLE IF NOT EXISTS org_company_aliases (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  alias_value TEXT NOT NULL,
  alias_type TEXT NOT NULL, -- name/domain/ticker/crm
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES org_companies(id) ON DELETE CASCADE,
  UNIQUE(company_id, alias_type, alias_value)
);
CREATE INDEX IF NOT EXISTS idx_org_company_aliases_value ON org_company_aliases(alias_value);

-- Controlled taxonomy
CREATE TABLE IF NOT EXISTS industries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  parent_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (parent_id) REFERENCES industries(id) ON DELETE SET NULL
);

-- Company <-> Industry
CREATE TABLE IF NOT EXISTS org_company_industries (
  company_id TEXT NOT NULL,
  industry_id TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0, -- 0..1
  is_primary INTEGER NOT NULL DEFAULT 0,
  tagged_by TEXT NOT NULL DEFAULT 'manual', -- manual/auto
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (company_id, industry_id),
  FOREIGN KEY (company_id) REFERENCES org_companies(id) ON DELETE CASCADE,
  FOREIGN KEY (industry_id) REFERENCES industries(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_org_company_industries_primary ON org_company_industries(is_primary);

-- Investment themes
CREATE TABLE IF NOT EXISTS themes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  thesis_statement TEXT,
  status TEXT NOT NULL DEFAULT 'exploring', -- exploring/active/paused/archived
  conviction_score INTEGER, -- 0..100
  owner_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_themes_status ON themes(status);

-- Theme <-> Company
CREATE TABLE IF NOT EXISTS org_company_themes (
  company_id TEXT NOT NULL,
  theme_id TEXT NOT NULL,
  relevance_score REAL NOT NULL DEFAULT 0.5, -- 0..1
  rationale TEXT,
  linked_by TEXT NOT NULL DEFAULT 'manual', -- manual/auto
  last_reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (company_id, theme_id),
  FOREIGN KEY (company_id) REFERENCES org_companies(id) ON DELETE CASCADE,
  FOREIGN KEY (theme_id) REFERENCES themes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_org_company_themes_theme ON org_company_themes(theme_id);

-- Deal pipeline state (read-only sync initially)
CREATE TABLE IF NOT EXISTS deals (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  pipeline_name TEXT, -- core/follow-on/opportunistic
  stage TEXT NOT NULL, -- sourced/screening/diligence/partner/term_sheet/pass
  stage_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  owner_name TEXT,
  crm_provider TEXT,
  crm_deal_id TEXT,
  amount_target_usd INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES org_companies(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage);
CREATE INDEX IF NOT EXISTS idx_deals_company ON deals(company_id);

CREATE TABLE IF NOT EXISTS deal_stage_events (
  id TEXT PRIMARY KEY,
  deal_id TEXT NOT NULL,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  event_time TEXT NOT NULL DEFAULT (datetime('now')),
  note TEXT,
  source TEXT NOT NULL DEFAULT 'manual', -- manual/crm_sync
  FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_deal_stage_events_deal ON deal_stage_events(deal_id);

-- Contacts
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  email TEXT,
  primary_company_id TEXT,
  title TEXT,
  linkedin_url TEXT,
  crm_contact_id TEXT,
  crm_provider TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (primary_company_id) REFERENCES org_companies(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(normalized_name);

-- Explicit many-to-many contact-company links
CREATE TABLE IF NOT EXISTS org_company_contacts (
  company_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  role_label TEXT, -- founder/investor/advisor/etc
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (company_id, contact_id),
  FOREIGN KEY (company_id) REFERENCES org_companies(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
);

-- Connected inboxes (read-only sync in V1)
CREATE TABLE IF NOT EXISTS email_accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL, -- gmail/outlook/imap
  account_email TEXT NOT NULL,
  display_name TEXT,
  external_account_id TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- active/error/revoked
  scopes_json TEXT, -- provider scopes as JSON array
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, account_email)
);

-- Incremental sync cursor/checkpoint
CREATE TABLE IF NOT EXISTS email_sync_state (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  mailbox TEXT NOT NULL DEFAULT 'INBOX',
  cursor TEXT, -- provider cursor/history id
  last_sync_started_at TEXT,
  last_sync_completed_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES email_accounts(id) ON DELETE CASCADE,
  UNIQUE(account_id, mailbox)
);

CREATE TABLE IF NOT EXISTS email_threads (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  provider_thread_id TEXT NOT NULL,
  subject TEXT,
  snippet TEXT,
  first_message_at TEXT,
  last_message_at TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES email_accounts(id) ON DELETE CASCADE,
  UNIQUE(account_id, provider_thread_id)
);
CREATE INDEX IF NOT EXISTS idx_email_threads_last_message ON email_threads(last_message_at);

CREATE TABLE IF NOT EXISTS email_messages (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  thread_id TEXT,
  provider_message_id TEXT NOT NULL,
  internet_message_id TEXT,
  direction TEXT NOT NULL, -- inbound/outbound
  subject TEXT,
  from_name TEXT,
  from_email TEXT NOT NULL,
  reply_to TEXT,
  sent_at TEXT,
  received_at TEXT,
  snippet TEXT,
  body_text TEXT, -- normalized text body (no HTML)
  labels_json TEXT, -- provider labels as JSON array
  is_unread INTEGER NOT NULL DEFAULT 0,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  artifact_id TEXT, -- optional unified artifact row
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES email_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (thread_id) REFERENCES email_threads(id) ON DELETE SET NULL,
  FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL,
  UNIQUE(account_id, provider_message_id)
);
CREATE INDEX IF NOT EXISTS idx_email_messages_received ON email_messages(received_at);
CREATE INDEX IF NOT EXISTS idx_email_messages_from ON email_messages(from_email);

CREATE TABLE IF NOT EXISTS email_message_participants (
  message_id TEXT NOT NULL,
  role TEXT NOT NULL, -- from/to/cc/bcc/reply_to
  email TEXT NOT NULL,
  display_name TEXT,
  contact_id TEXT,
  domain TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (message_id, role, email),
  FOREIGN KEY (message_id) REFERENCES email_messages(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_email_participants_email ON email_message_participants(email);

-- Email attachments can optionally map to artifacts (deck, collateral, etc)
CREATE TABLE IF NOT EXISTS email_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  provider_attachment_id TEXT,
  filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  sha256 TEXT,
  storage_uri TEXT,
  artifact_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (message_id) REFERENCES email_messages(id) ON DELETE CASCADE,
  FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_email_attachments_message ON email_attachments(message_id);

-- Explicit linkage so comms can be monitored by company/contact
CREATE TABLE IF NOT EXISTS email_company_links (
  message_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  linked_by TEXT NOT NULL DEFAULT 'auto', -- auto/manual
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (message_id, company_id),
  FOREIGN KEY (message_id) REFERENCES email_messages(id) ON DELETE CASCADE,
  FOREIGN KEY (company_id) REFERENCES org_companies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS email_contact_links (
  message_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  linked_by TEXT NOT NULL DEFAULT 'auto', -- auto/manual
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (message_id, contact_id),
  FOREIGN KEY (message_id) REFERENCES email_messages(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS email_theme_links (
  message_id TEXT NOT NULL,
  theme_id TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  linked_by TEXT NOT NULL DEFAULT 'manual', -- auto/manual
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (message_id, theme_id),
  FOREIGN KEY (message_id) REFERENCES email_messages(id) ON DELETE CASCADE,
  FOREIGN KEY (theme_id) REFERENCES themes(id) ON DELETE CASCADE
);

-- Unified source documents and records
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  company_id TEXT,
  theme_id TEXT,
  meeting_id TEXT, -- nullable link to existing meetings table
  artifact_type TEXT NOT NULL, -- transcript/summary/email/deck/file/note/chat/investment_memo_pdf
  title TEXT NOT NULL,
  mime_type TEXT,
  storage_uri TEXT, -- local path or provider uri
  source_provider TEXT, -- local/google_drive/gmail/crm/manual
  source_external_id TEXT,
  content_text TEXT, -- normalized plain text for search/summarization
  captured_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES org_companies(id) ON DELETE SET NULL,
  FOREIGN KEY (theme_id) REFERENCES themes(id) ON DELETE SET NULL,
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_artifacts_company ON artifacts(company_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_theme ON artifacts(theme_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_meeting ON artifacts(meeting_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_type ON artifacts(artifact_type);

-- FTS across artifacts
CREATE VIRTUAL TABLE IF NOT EXISTS artifacts_fts USING fts5(
  artifact_id UNINDEXED,
  title,
  content_text,
  tokenize='porter unicode61'
);

-- Explicit link from meetings to canonical companies/themes
CREATE TABLE IF NOT EXISTS meeting_company_links (
  meeting_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  linked_by TEXT NOT NULL DEFAULT 'auto', -- auto/manual
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (meeting_id, company_id),
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  FOREIGN KEY (company_id) REFERENCES org_companies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS meeting_theme_links (
  meeting_id TEXT NOT NULL,
  theme_id TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  linked_by TEXT NOT NULL DEFAULT 'manual', -- auto/manual
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (meeting_id, theme_id),
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  FOREIGN KEY (theme_id) REFERENCES themes(id) ON DELETE CASCADE
);

-- Persisted AI chat by company (independent of per-meeting chat)
CREATE TABLE IF NOT EXISTS company_conversations (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  theme_id TEXT,
  title TEXT NOT NULL,
  model_provider TEXT, -- claude/ollama/...
  model_name TEXT,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  last_message_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES org_companies(id) ON DELETE CASCADE,
  FOREIGN KEY (theme_id) REFERENCES themes(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_company_conversations_company ON company_conversations(company_id);
CREATE INDEX IF NOT EXISTS idx_company_conversations_last_msg ON company_conversations(last_message_at);

CREATE TABLE IF NOT EXISTS company_conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL, -- user/assistant/system
  content TEXT NOT NULL,
  citations_json TEXT, -- [{sourceType,sourceId,snippet,timestamp}]
  token_count INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES company_conversations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_company_conversation_messages_conv ON company_conversation_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_company_conversation_messages_created ON company_conversation_messages(created_at);

-- User-authored company notes (manual notes, follow-ups, diligence thoughts)
CREATE TABLE IF NOT EXISTS company_notes (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  theme_id TEXT,
  title TEXT,
  content TEXT NOT NULL,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES org_companies(id) ON DELETE CASCADE,
  FOREIGN KEY (theme_id) REFERENCES themes(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_company_notes_company ON company_notes(company_id);
CREATE INDEX IF NOT EXISTS idx_company_notes_updated ON company_notes(updated_at);

-- Structured investment memo (separate from notes) with version history
CREATE TABLE IF NOT EXISTS investment_memos (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  theme_id TEXT,
  deal_id TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', -- draft/review/final/archived
  latest_version_number INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES org_companies(id) ON DELETE CASCADE,
  FOREIGN KEY (theme_id) REFERENCES themes(id) ON DELETE SET NULL,
  FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_investment_memos_company ON investment_memos(company_id);
CREATE INDEX IF NOT EXISTS idx_investment_memos_status ON investment_memos(status);

CREATE TABLE IF NOT EXISTS investment_memo_versions (
  id TEXT PRIMARY KEY,
  memo_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  content_markdown TEXT NOT NULL,
  structured_json TEXT, -- optional extracted sections/metadata
  change_note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (memo_id) REFERENCES investment_memos(id) ON DELETE CASCADE,
  UNIQUE(memo_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_investment_memo_versions_memo ON investment_memo_versions(memo_id);

-- Export records (PDF, later docx) linked to artifacts for unified retrieval
CREATE TABLE IF NOT EXISTS investment_memo_exports (
  id TEXT PRIMARY KEY,
  memo_version_id TEXT NOT NULL,
  artifact_id TEXT,
  export_format TEXT NOT NULL DEFAULT 'pdf',
  storage_uri TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (memo_version_id) REFERENCES investment_memo_versions(id) ON DELETE CASCADE,
  FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_investment_memo_exports_version ON investment_memo_exports(memo_version_id);

-- Thesis objects
CREATE TABLE IF NOT EXISTS theses (
  id TEXT PRIMARY KEY,
  company_id TEXT,
  theme_id TEXT,
  title TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'draft', -- draft/active/archived
  conviction_score INTEGER, -- 0..100
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES org_companies(id) ON DELETE CASCADE,
  FOREIGN KEY (theme_id) REFERENCES themes(id) ON DELETE CASCADE,
  CHECK (company_id IS NOT NULL OR theme_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_theses_company ON theses(company_id);
CREATE INDEX IF NOT EXISTS idx_theses_theme ON theses(theme_id);

CREATE TABLE IF NOT EXISTS thesis_claims (
  id TEXT PRIMARY KEY,
  thesis_id TEXT NOT NULL,
  claim_text TEXT NOT NULL,
  claim_type TEXT NOT NULL DEFAULT 'support', -- support/risk/question
  confidence REAL, -- 0..1
  status TEXT NOT NULL DEFAULT 'open', -- open/validated/refuted
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (thesis_id) REFERENCES theses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_thesis_claims_thesis ON thesis_claims(thesis_id);

-- Evidence must cite source artifact/snippet
CREATE TABLE IF NOT EXISTS evidence_links (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  snippet_text TEXT NOT NULL,
  snippet_start INTEGER,
  snippet_end INTEGER,
  source_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_evidence_artifact ON evidence_links(artifact_id);

CREATE TABLE IF NOT EXISTS thesis_claim_evidence (
  claim_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (claim_id, evidence_id),
  FOREIGN KEY (claim_id) REFERENCES thesis_claims(id) ON DELETE CASCADE,
  FOREIGN KEY (evidence_id) REFERENCES evidence_links(id) ON DELETE CASCADE
);
```

---

## 2.3 Migration Plan in This Codebase

Use the existing migration pattern in `src/main/database/migrations/` and connection bootstrap in `src/main/database/connection.ts`.

Recommended sequence:

1. `012-company-os-core.ts`
- Create `org_companies`, `org_company_aliases`, `industries`, `org_company_industries`, `themes`, `org_company_themes`, `deals`, `deal_stage_events`, `contacts`, `org_company_contacts`.

2. `013-company-os-email.ts`
- Create `email_accounts`, `email_sync_state`, `email_threads`, `email_messages`, `email_message_participants`, `email_attachments`, `email_company_links`, `email_contact_links`, `email_theme_links`.

3. `014-company-os-artifacts.ts`
- Create `artifacts`, `artifacts_fts`, `meeting_company_links`, `meeting_theme_links`.
- Add optional `artifact_id` linkage for `email_messages` and `email_attachments` if not created in `013`.

4. `015-company-os-chat.ts`
- Create `company_conversations`, `company_conversation_messages`.

5. `016-company-os-notes.ts`
- Create `company_notes`.

6. `017-company-os-memo.ts`
- Create `investment_memos`, `investment_memo_versions`, `investment_memo_exports`.

7. `018-company-os-thesis.ts`
- Create `theses`, `thesis_claims`, `evidence_links`, `thesis_claim_evidence`.

8. `019-company-os-backfill.ts`
- Backfill `meeting_company_links` from existing `meetings.companies`, `meetings.attendee_emails`, and company domain cache.
- Seed `artifacts` for existing transcript/summary/recording assets tied to `meeting_id`.
- Backfill `contacts` from `meetings.attendee_emails` and link via `org_company_contacts` where possible.

Backfill safety rules:
- Never delete/overwrite existing `meetings` columns in V1.
- Insert with `INSERT OR IGNORE`.
- Preserve confidence and mark linkage source as `auto`.

---

## 3. Feature Flag Strategy

Store flags in existing `settings` table using string values (`'true' | 'false'`).

Recommended flags:

- `ff_company_model_v1`: enable schema backfill and repo wiring.
- `ff_companies_ui_v1`: show Companies list/detail screens.
- `ff_themes_ui_v1`: show Themes list/detail screens.
- `ff_pipeline_ui_v1`: show pipeline board and deal stages.
- `ff_artifacts_ui_v1`: show artifacts ingestion and evidence panels.
- `ff_ask_unified_v1`: search/query across meetings + artifacts.
- `ff_email_ingest_v1`: enable inbox sync and email schema reads.
- `ff_email_ui_v1`: show email timeline/comms views in company workspace and inbox.
- `ff_company_chat_v1`: enable persisted company-level AI chat threads in Companies view.
- `ff_company_notes_v1`: enable persisted company notes in Company Workspace.
- `ff_investment_memo_v1`: enable dedicated investment memo tab + PDF export.
- `ff_crm_sync_read_v1`: read-only CRM import.

Rollout defaults:
- Dev: all `true` except `ff_crm_sync_read_v1`.
- Production dogfood: enable in order, one flag per week.

---

## 4. Screen Map (V1)

Add routes incrementally to existing router in `src/renderer/App.tsx` and sidebar nav in `src/renderer/components/layout/Sidebar.tsx`.

## 4.1 Route Map

1. `/` (existing): Meetings
- Keep unchanged.

2. `/companies` (`ff_companies_ui_v1`)
- Company Directory.

3. `/company/:companyId` (`ff_companies_ui_v1`)
- Company Workspace (primary working screen).

4. `/themes` (`ff_themes_ui_v1`)
- Theme List + status.

5. `/theme/:themeId` (`ff_themes_ui_v1`)
- Theme Workspace.

6. `/pipeline` (`ff_pipeline_ui_v1`)
- Deal board by stage.

7. `/ask` (`ff_ask_unified_v1`)
- Unified query across meetings/artifacts with citations.

8. `/inbox` (`ff_artifacts_ui_v1`)
- Triage newly ingested artifacts into company/theme links.

---

## 4.2 Screen Specs

### A. Company Directory (`/companies`)
- Purpose: one place to browse/search all tracked companies.
- Sections:
  - Search + filters (`industry`, `theme`, `stage`, `pipeline stage`).
  - Table/cards: name, industries, themes, last interaction, pipeline stage.
  - Quick actions: open workspace, add company, link meeting.

### B. Company Workspace (`/company/:id`)
- Purpose: central decision workspace for one company.
- Tabs (single top-level tab row):
  1. `Overview`: profile, description, industries/themes, key metrics, latest status.
  2. `Notes`: user-authored notes, open questions, diligence to-dos (pin + recency sort).
  3. `Timeline`: meetings/emails/files in chronological order (filter chips: all/meetings/emails/files).
  4. `Thesis`: thesis summary, claims, evidence coverage.
  5. `Memo`: structured investment memo, version history, `Export PDF`.
  6. `Pipeline`: deal stage, stage history, next actions.
  7. `Artifacts`: file inventory and source previews.
  8. `Contacts`: people map linked to this company.
  9. `Comms`: thread-centric inbox view for company contacts (latest touchpoints, unanswered threads).
  10. `Chat`: persisted AI conversations scoped to this company (thread list + history + citations).

### C. Themes List (`/themes`)
- Purpose: manage hypothesis buckets.
- Sections:
  - Theme cards with status + conviction + linked company count.
  - Sort by conviction, recent activity, open questions.

### D. Theme Workspace (`/theme/:id`)
- Purpose: compare companies under one thesis lens.
- Sections:
  - Thesis statement + key questions.
  - Company comparison matrix (traction, GTM, team, risk, valuation).
  - Supporting and contradictory evidence feed.

### E. Pipeline (`/pipeline`)
- Purpose: operational stage management.
- Sections:
  - Stage columns: sourced -> screening -> diligence -> partner -> term_sheet -> pass.
  - Card drilldown opens company workspace pipeline tab.
  - Stage history log (read-only from CRM in V1).

### F. Unified Ask (`/ask`)
- Purpose: one query surface across all content.
- Controls:
  - Query bar.
  - Filters: company, industry, theme, artifact type, date range.
  - Result must include citation chips (meeting/file/email + timestamp/snippet).

### G. Inbox (`/inbox`)
- Purpose: prevent ingest chaos.
- Sections:
  - Unassigned artifacts queue.
  - Unassigned email threads/messages queue.
  - Suggested company/theme links with confidence.
  - Actions: accept, override, ignore.

---

## 5. Repository / IPC / Service Additions (V1)

## 5.1 New Repositories

Add under `src/main/database/repositories/`:
- `org-company.repo.ts`
- `industry.repo.ts`
- `theme.repo.ts`
- `deal.repo.ts`
- `contact.repo.ts`
- `email.repo.ts`
- `email-sync.repo.ts`
- `artifact.repo.ts`
- `company-chat.repo.ts`
- `company-notes.repo.ts`
- `investment-memo.repo.ts`
- `thesis.repo.ts`
- `evidence.repo.ts`

## 5.2 New IPC Modules

Add under `src/main/ipc/`:
- `company.ipc.ts`
- `theme.ipc.ts`
- `pipeline.ipc.ts`
- `email.ipc.ts`
- `artifact.ipc.ts`
- `company-chat.ipc.ts`
- `company-notes.ipc.ts`
- `investment-memo.ipc.ts`
- `thesis.ipc.ts`
- `flags.ipc.ts` (optional helper over settings)

## 5.3 Data Ingestion Services (read-only first)

Add under `src/main/services/`:
- `artifact-ingest.service.ts` (normalizes file/email/meeting documents into `artifacts`)
- `entity-linker.service.ts` (maps artifacts to company/theme, with confidence)
- `email-sync.service.ts` (provider polling/webhook cursor sync into `email_*` tables)
- `memo-export.service.ts` (render memo + export via Electron `printToPDF`, then register exported PDF as artifact)
- `crm-sync.service.ts` (read-only deal/company/contact import)

---

## 6. Incremental Delivery Plan

### Phase 1 (2-3 weeks): Company Foundation
- Migrations `012` + `013` partial (`org_companies`, links, email core tables without provider sync).
- Backfill links from existing meetings.
- Add `company_notes` for immediate manual context capture.
- UI: `/companies`, `/company/:id` with `Overview` + `Notes` + `Timeline`.
- Flags: `ff_company_model_v1`, `ff_companies_ui_v1`.

### Phase 2 (2 weeks): Theme Layer
- Add `themes`, `org_company_themes`.
- UI: `/themes`, `/theme/:id`.
- Flags: `ff_themes_ui_v1`.

### Phase 3 (2 weeks): Pipeline + Contacts + Memo
- Add `deals`, `deal_stage_events`, `contacts`, `org_company_contacts`.
- Add `investment_memos`, `investment_memo_versions`, `investment_memo_exports`.
- UI: `/pipeline`, company `Pipeline` and `Contacts` tabs, plus company `Memo` tab with `Export PDF`.
- Flags: `ff_pipeline_ui_v1`, `ff_investment_memo_v1`.

### Phase 4 (2-3 weeks): Thesis + Evidence + Unified Ask + Email Triage + Company Chat
- Add `theses`, `thesis_claims`, `evidence_links`.
- Add `artifacts_fts` indexing and combined search.
- Add `company_conversations`, `company_conversation_messages` and scope retrieval to company.
- UI: `Thesis` tab + `/ask` + `/inbox` email triage + company `Chat` tab.
- Flags: `ff_artifacts_ui_v1`, `ff_ask_unified_v1`, `ff_email_ui_v1`, `ff_company_chat_v1`, `ff_company_notes_v1`.

### Phase 5 (optional): CRM Read Sync
- Pull companies/deals/contacts from CRM into read model.
- No write-back yet.
- Flag: `ff_crm_sync_read_v1`.

### Phase 6 (optional): Inbox Ingest Sync
- Add provider sync workers and cursor checkpoints (`email_sync_state`).
- Monitor company/contact communication events and stale-thread alerts.
- Flag: `ff_email_ingest_v1`.

---

## 7. UX Complexity Controls

Mandatory controls for V1:

1. Max 6 top-level sidebar items at any time.
2. Every AI-generated claim must show linked evidence.
3. Keep `Industry` controlled vocabulary; avoid free-form duplication.
4. Allow free-form `Theme`, but require `thesis_statement`.
5. Keep external sync read-only until data quality is stable.
6. Default inbox ingest to headers/snippets first; full body fetch on-demand or allowlist.
7. Memo stays separate from notes: notes are scratchpad; memo is structured decision artifact.

---

## 8. Immediate Next Implementation Step

Implement only Phase 1 foundation first:

1. Create migrations `012-company-os-core.ts` and `014-company-os-artifacts.ts` (minimal subset).
2. Add `org-company.repo.ts` and `artifact.repo.ts`.
3. Add feature flag helper using settings keys.
4. Add `/companies` route and simple directory screen (list + open company detail).
5. Add `/company/:id` with `Overview` + `Timeline` backed by meeting links.

Email-specific add-on:

6. Add `013-company-os-email.ts` with `email_accounts`, `email_threads`, `email_messages`, `email_message_participants`, `email_company_links`.
7. Add `email.repo.ts` query helpers for company timeline joins.

Company chat add-on:

8. Add `015-company-os-chat.ts` with `company_conversations` and `company_conversation_messages`.
9. Add `company-chat.repo.ts` + `company-chat.ipc.ts` for create/list/append/get-thread operations.

Company notes add-on:

10. Add `016-company-os-notes.ts` with `company_notes`.
11. Add `company-notes.repo.ts` + `company-notes.ipc.ts` for create/list/update/pin/delete.

Investment memo add-on:

12. Add `017-company-os-memo.ts` with `investment_memos`, `investment_memo_versions`, `investment_memo_exports`.
13. Add `investment-memo.repo.ts` + `investment-memo.ipc.ts` for create/list/save-version/finalize operations.
14. Add `memo-export.service.ts` and save exported PDFs as `artifacts.artifact_type = 'investment_memo_pdf'`.
