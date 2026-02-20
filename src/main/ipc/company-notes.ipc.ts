import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/channels'
import * as notesRepo from '../database/repositories/company-notes.repo'

export function registerCompanyNotesHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.COMPANY_NOTES_LIST, (_event, companyId: string) => {
    if (!companyId) throw new Error('companyId is required')
    return notesRepo.listCompanyNotes(companyId)
  })

  ipcMain.handle(
    IPC_CHANNELS.COMPANY_NOTES_CREATE,
    (_event, data: { companyId: string; title?: string | null; content: string; themeId?: string | null }) => {
      if (!data?.companyId) throw new Error('companyId is required')
      if (!data.content?.trim()) throw new Error('content is required')
      return notesRepo.createCompanyNote({
        companyId: data.companyId,
        title: data.title ?? null,
        content: data.content,
        themeId: data.themeId ?? null
      })
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.COMPANY_NOTES_UPDATE,
    (
      _event,
      noteId: string,
      updates: Partial<{ title: string | null; content: string; isPinned: boolean; themeId: string | null }>
    ) => {
      if (!noteId) throw new Error('noteId is required')
      return notesRepo.updateCompanyNote(noteId, updates || {})
    }
  )

  ipcMain.handle(IPC_CHANNELS.COMPANY_NOTES_DELETE, (_event, noteId: string) => {
    if (!noteId) throw new Error('noteId is required')
    return notesRepo.deleteCompanyNote(noteId)
  })
}
