import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IPC_CHANNELS } from '../../shared/constants/channels'
import { useFeatureFlag } from '../hooks/useFeatureFlags'
import type { CompanySummary } from '../../shared/types/company'
import styles from './Companies.module.css'

function formatDate(value: string | null): string {
  if (!value) return 'Never'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Never'
  return date.toLocaleString()
}

export default function Companies() {
  const navigate = useNavigate()
  const { enabled: companiesEnabled, loading: flagsLoading } = useFeatureFlag('ff_companies_ui_v1')
  const [companies, setCompanies] = useState<CompanySummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newDomain, setNewDomain] = useState('')

  const fetchCompanies = useCallback(async () => {
    if (!companiesEnabled) return
    setLoading(true)
    setError(null)
    try {
      const results = await window.api.invoke<CompanySummary[]>(
        IPC_CHANNELS.COMPANY_LIST,
        { query: query.trim(), limit: 300 }
      )
      setCompanies(results)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [companiesEnabled, query])

  useEffect(() => {
    fetchCompanies()
  }, [fetchCompanies])

  const handleCreateCompany = async () => {
    if (!newName.trim()) return
    try {
      const created = await window.api.invoke<CompanySummary>(
        IPC_CHANNELS.COMPANY_CREATE,
        {
          canonicalName: newName.trim(),
          description: newDescription.trim() || null,
          primaryDomain: newDomain.trim() || null
        }
      )
      setShowCreate(false)
      setNewName('')
      setNewDescription('')
      setNewDomain('')
      await fetchCompanies()
      navigate(`/company/${created.id}`)
    } catch (err) {
      setError(String(err))
    }
  }

  if (!flagsLoading && !companiesEnabled) {
    return (
      <div className={styles.page}>
        <div className={styles.empty}>Companies view is disabled by feature flag.</div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <input
          className={styles.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search companies by name, domain, or description"
        />
        <button className={styles.primaryButton} onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? 'Cancel' : '+ New Company'}
        </button>
      </div>

      {showCreate && (
        <div className={styles.createCard}>
          <input
            className={styles.input}
            placeholder="Company name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            className={styles.input}
            placeholder="Primary domain (optional)"
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
          />
          <textarea
            className={styles.textarea}
            placeholder="Description (optional)"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
          />
          <button className={styles.primaryButton} onClick={handleCreateCompany}>
            Create
          </button>
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}
      {loading && <div className={styles.meta}>Loading companies...</div>}
      {!loading && companies.length === 0 && (
        <div className={styles.empty}>No companies found.</div>
      )}

      {companies.length > 0 && (
        <div className={styles.list}>
          {companies.map((company) => (
            <button
              key={company.id}
              className={styles.card}
              onClick={() => navigate(`/company/${company.id}`)}
            >
              <div className={styles.cardTop}>
                <h3 className={styles.name}>{company.canonicalName}</h3>
                <span className={styles.status}>{company.status}</span>
              </div>
              <div className={styles.domain}>{company.primaryDomain || 'No domain'}</div>
              {company.description && <p className={styles.description}>{company.description}</p>}
              <div className={styles.metaRow}>
                <span>{company.meetingCount} meetings</span>
                <span>{company.emailCount} emails</span>
                <span>{company.noteCount} notes</span>
                <span>Last touch: {formatDate(company.lastTouchpoint)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
