import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { IPC_CHANNELS } from '../../shared/constants/channels'
import { useFeatureFlags } from '../hooks/useFeatureFlags'
import type {
  CompanyDetail as CompanyDetailType,
  CompanyEmailRef,
  CompanyMeetingRef,
  CompanyNote,
  CompanyTimelineItem,
  InvestmentMemoVersion,
  InvestmentMemoWithLatest
} from '../../shared/types/company'
import styles from './CompanyDetail.module.css'

type CompanyTab = 'overview' | 'notes' | 'timeline' | 'memo'

const TAB_LABELS: Record<CompanyTab, string> = {
  overview: 'Overview',
  notes: 'Notes',
  timeline: 'Timeline',
  memo: 'Memo'
}

function formatDateTime(value: string | null): string {
  if (!value) return 'Unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return date.toLocaleString()
}

export default function CompanyDetail() {
  const { companyId = '' } = useParams()
  const navigate = useNavigate()
  const { values: flags, loading: flagsLoading } = useFeatureFlags([
    'ff_companies_ui_v1',
    'ff_company_notes_v1',
    'ff_investment_memo_v1'
  ])

  const [activeTab, setActiveTab] = useState<CompanyTab>('overview')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [company, setCompany] = useState<CompanyDetailType | null>(null)
  const [meetings, setMeetings] = useState<CompanyMeetingRef[]>([])
  const [emails, setEmails] = useState<CompanyEmailRef[]>([])
  const [timeline, setTimeline] = useState<CompanyTimelineItem[]>([])
  const [notes, setNotes] = useState<CompanyNote[]>([])
  const [noteTitle, setNoteTitle] = useState('')
  const [noteContent, setNoteContent] = useState('')
  const [memo, setMemo] = useState<InvestmentMemoWithLatest | null>(null)
  const [memoVersions, setMemoVersions] = useState<InvestmentMemoVersion[]>([])
  const [memoDraft, setMemoDraft] = useState('')
  const [memoChangeNote, setMemoChangeNote] = useState('')
  const [savingMemo, setSavingMemo] = useState(false)
  const [exportingMemo, setExportingMemo] = useState(false)

  const tabs = useMemo(() => {
    const items: CompanyTab[] = ['overview']
    if (flags.ff_company_notes_v1) items.push('notes')
    items.push('timeline')
    if (flags.ff_investment_memo_v1) items.push('memo')
    return items
  }, [flags.ff_company_notes_v1, flags.ff_investment_memo_v1])

  const loadData = useCallback(async () => {
    if (!companyId || !flags.ff_companies_ui_v1) return

    setLoading(true)
    setError(null)
    try {
      const [
        companyResult,
        meetingsResult,
        emailsResult,
        timelineResult,
        notesResult,
        memoResult
      ] = await Promise.all([
        window.api.invoke<CompanyDetailType | null>(IPC_CHANNELS.COMPANY_GET, companyId),
        window.api.invoke<CompanyMeetingRef[]>(IPC_CHANNELS.COMPANY_MEETINGS, companyId),
        window.api.invoke<CompanyEmailRef[]>(IPC_CHANNELS.COMPANY_EMAILS, companyId),
        window.api.invoke<CompanyTimelineItem[]>(IPC_CHANNELS.COMPANY_TIMELINE, companyId),
        flags.ff_company_notes_v1
          ? window.api.invoke<CompanyNote[]>(IPC_CHANNELS.COMPANY_NOTES_LIST, companyId)
          : Promise.resolve([]),
        flags.ff_investment_memo_v1
          ? window.api.invoke<InvestmentMemoWithLatest>(IPC_CHANNELS.INVESTMENT_MEMO_GET_OR_CREATE, companyId)
          : Promise.resolve(null)
      ])

      setCompany(companyResult)
      setMeetings(meetingsResult)
      setEmails(emailsResult)
      setTimeline(timelineResult)
      setNotes(notesResult)
      setMemo(memoResult)
      if (memoResult) {
        const versions = await window.api.invoke<InvestmentMemoVersion[]>(
          IPC_CHANNELS.INVESTMENT_MEMO_LIST_VERSIONS,
          memoResult.id
        )
        setMemoVersions(versions)
        setMemoDraft(memoResult.latestVersion?.contentMarkdown || '')
      } else {
        setMemoVersions([])
        setMemoDraft('')
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [companyId, flags.ff_companies_ui_v1, flags.ff_company_notes_v1, flags.ff_investment_memo_v1])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    if (!tabs.includes(activeTab)) {
      setActiveTab(tabs[0] || 'overview')
    }
  }, [activeTab, tabs])

  const handleAddNote = async () => {
    if (!companyId || !noteContent.trim()) return
    try {
      await window.api.invoke<CompanyNote>(IPC_CHANNELS.COMPANY_NOTES_CREATE, {
        companyId,
        title: noteTitle.trim() || null,
        content: noteContent.trim()
      })
      setNoteTitle('')
      setNoteContent('')
      const updated = await window.api.invoke<CompanyNote[]>(IPC_CHANNELS.COMPANY_NOTES_LIST, companyId)
      setNotes(updated)
    } catch (err) {
      setError(String(err))
    }
  }

  const handleTogglePinNote = async (note: CompanyNote) => {
    try {
      await window.api.invoke<CompanyNote>(
        IPC_CHANNELS.COMPANY_NOTES_UPDATE,
        note.id,
        { isPinned: !note.isPinned }
      )
      const updated = await window.api.invoke<CompanyNote[]>(IPC_CHANNELS.COMPANY_NOTES_LIST, companyId)
      setNotes(updated)
    } catch (err) {
      setError(String(err))
    }
  }

  const handleDeleteNote = async (noteId: string) => {
    try {
      await window.api.invoke<boolean>(IPC_CHANNELS.COMPANY_NOTES_DELETE, noteId)
      const updated = await window.api.invoke<CompanyNote[]>(IPC_CHANNELS.COMPANY_NOTES_LIST, companyId)
      setNotes(updated)
    } catch (err) {
      setError(String(err))
    }
  }

  const handleSaveMemo = async () => {
    if (!memo || !memoDraft.trim()) return
    setSavingMemo(true)
    try {
      await window.api.invoke<InvestmentMemoVersion>(
        IPC_CHANNELS.INVESTMENT_MEMO_SAVE_VERSION,
        memo.id,
        {
          contentMarkdown: memoDraft,
          changeNote: memoChangeNote.trim() || null
        }
      )
      setMemoChangeNote('')
      const refreshedMemo = await window.api.invoke<InvestmentMemoWithLatest>(
        IPC_CHANNELS.INVESTMENT_MEMO_GET_OR_CREATE,
        companyId
      )
      setMemo(refreshedMemo)
      const refreshedVersions = await window.api.invoke<InvestmentMemoVersion[]>(
        IPC_CHANNELS.INVESTMENT_MEMO_LIST_VERSIONS,
        refreshedMemo.id
      )
      setMemoVersions(refreshedVersions)
    } catch (err) {
      setError(String(err))
    } finally {
      setSavingMemo(false)
    }
  }

  const handleMemoStatusChange = async (status: 'draft' | 'review' | 'final' | 'archived') => {
    if (!memo) return
    try {
      const updated = await window.api.invoke<InvestmentMemoWithLatest>(
        IPC_CHANNELS.INVESTMENT_MEMO_SET_STATUS,
        memo.id,
        status
      )
      setMemo((prev) => (prev ? { ...updated, latestVersion: prev.latestVersion } : prev))
    } catch (err) {
      setError(String(err))
    }
  }

  const handleExportMemo = async () => {
    if (!memo) return
    setExportingMemo(true)
    try {
      const result = await window.api.invoke<{ success: boolean; path?: string; error?: string }>(
        IPC_CHANNELS.INVESTMENT_MEMO_EXPORT_PDF,
        memo.id
      )
      if (!result.success) {
        throw new Error(result.error || 'Failed to export memo')
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setExportingMemo(false)
    }
  }

  if (!flagsLoading && !flags.ff_companies_ui_v1) {
    return (
      <div className={styles.page}>
        <div className={styles.empty}>Companies view is disabled by feature flag.</div>
      </div>
    )
  }

  if (!companyId) {
    return (
      <div className={styles.page}>
        <div className={styles.empty}>Missing company id.</div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.meta}>Loading company...</div>
      </div>
    )
  }

  if (!company) {
    return (
      <div className={styles.page}>
        <div className={styles.empty}>Company not found.</div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <button className={styles.backButton} onClick={() => navigate('/companies')}>
        {'< Back to Companies'}
      </button>

      <div className={styles.headerCard}>
        <h2 className={styles.title}>{company.canonicalName}</h2>
        <div className={styles.headerMeta}>
          <span>{company.primaryDomain || 'No domain'}</span>
          <span>Stage: {company.stage || 'Unspecified'}</span>
          <span>Status: {company.status}</span>
          <span>Last touch: {formatDateTime(company.lastTouchpoint)}</span>
        </div>
        {company.description && <p className={styles.description}>{company.description}</p>}
        <div className={styles.tagsRow}>
          {company.industries.length > 0 && (
            <div className={styles.tagGroup}>
              <strong>Industry</strong>
              {company.industries.map((item) => (
                <span key={item} className={styles.tag}>{item}</span>
              ))}
            </div>
          )}
          {company.themes.length > 0 && (
            <div className={styles.tagGroup}>
              <strong>Themes</strong>
              {company.themes.map((item) => (
                <span key={item} className={styles.tag}>{item}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={styles.tabRow}>
        {tabs.map((tab) => (
          <button
            key={tab}
            className={`${styles.tab} ${activeTab === tab ? styles.activeTab : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {activeTab === 'overview' && (
        <div className={styles.section}>
          <div className={styles.statsGrid}>
            <div className={styles.statCard}>
              <div className={styles.statLabel}>Meetings</div>
              <div className={styles.statValue}>{meetings.length}</div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statLabel}>Emails</div>
              <div className={styles.statValue}>{emails.length}</div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statLabel}>Notes</div>
              <div className={styles.statValue}>{notes.length}</div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statLabel}>Memo Version</div>
              <div className={styles.statValue}>{memo?.latestVersionNumber ?? 0}</div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'notes' && (
        <div className={styles.section}>
          <div className={styles.editor}>
            <input
              className={styles.input}
              placeholder="Optional note title"
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
            />
            <textarea
              className={styles.textarea}
              placeholder="Add company-specific notes, risks, and follow-ups"
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
            />
            <button className={styles.primaryButton} onClick={handleAddNote}>
              Add Note
            </button>
          </div>

          <div className={styles.stack}>
            {notes.length === 0 && (
              <div className={styles.empty}>No notes yet for this company.</div>
            )}
            {notes.map((note) => (
              <div key={note.id} className={styles.noteCard}>
                <div className={styles.noteHeader}>
                  <strong>{note.title || 'Untitled note'}</strong>
                  <div className={styles.noteActions}>
                    <button className={styles.actionBtn} onClick={() => handleTogglePinNote(note)}>
                      {note.isPinned ? 'Unpin' : 'Pin'}
                    </button>
                    <button className={styles.actionBtn} onClick={() => handleDeleteNote(note.id)}>
                      Delete
                    </button>
                  </div>
                </div>
                <div className={styles.noteBody}>{note.content}</div>
                <div className={styles.noteMeta}>
                  Updated: {formatDateTime(note.updatedAt)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'timeline' && (
        <div className={styles.section}>
          {timeline.length === 0 && (
            <div className={styles.empty}>No timeline events yet.</div>
          )}
          <div className={styles.stack}>
            {timeline.map((item) => (
              <div key={item.id} className={styles.timelineItem}>
                <div className={styles.timelineTop}>
                  <span className={styles.timelineType}>{item.type}</span>
                  <span className={styles.timelineWhen}>{formatDateTime(item.occurredAt)}</span>
                </div>
                <div className={styles.timelineTitle}>{item.title}</div>
                {item.subtitle && <div className={styles.timelineSubtitle}>{item.subtitle}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'memo' && (
        <div className={styles.section}>
          {!memo && (
            <div className={styles.meta}>Loading memo...</div>
          )}
          {memo && (
            <>
              <div className={styles.memoToolbar}>
                <div>
                  <strong>{memo.title}</strong>
                  <div className={styles.noteMeta}>
                    Status: {memo.status} | Latest version: {memo.latestVersionNumber}
                  </div>
                </div>
                <div className={styles.memoActions}>
                  <select
                    className={styles.select}
                    value={memo.status}
                    onChange={(e) =>
                      handleMemoStatusChange(e.target.value as 'draft' | 'review' | 'final' | 'archived')
                    }
                  >
                    <option value="draft">Draft</option>
                    <option value="review">Review</option>
                    <option value="final">Final</option>
                    <option value="archived">Archived</option>
                  </select>
                  <button
                    className={styles.secondaryButton}
                    onClick={handleExportMemo}
                    disabled={exportingMemo}
                  >
                    {exportingMemo ? 'Exporting...' : 'Export PDF'}
                  </button>
                </div>
              </div>

              <textarea
                className={styles.memoEditor}
                value={memoDraft}
                onChange={(e) => setMemoDraft(e.target.value)}
                placeholder="Write investment memo in markdown"
              />
              <input
                className={styles.input}
                placeholder="Version note (optional)"
                value={memoChangeNote}
                onChange={(e) => setMemoChangeNote(e.target.value)}
              />
              <button
                className={styles.primaryButton}
                onClick={handleSaveMemo}
                disabled={savingMemo}
              >
                {savingMemo ? 'Saving...' : 'Save New Version'}
              </button>

              <div className={styles.stack}>
                {memoVersions.map((version) => (
                  <button
                    key={version.id}
                    className={styles.versionCard}
                    onClick={() => setMemoDraft(version.contentMarkdown)}
                  >
                    <div className={styles.timelineTop}>
                      <strong>Version {version.versionNumber}</strong>
                      <span className={styles.timelineWhen}>{formatDateTime(version.createdAt)}</span>
                    </div>
                    {version.changeNote && (
                      <div className={styles.timelineSubtitle}>{version.changeNote}</div>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
