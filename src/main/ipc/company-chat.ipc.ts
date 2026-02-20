import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/channels'
import * as companyChatRepo from '../database/repositories/company-chat.repo'

export function registerCompanyChatHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.COMPANY_CHAT_LIST, (_event, companyId: string) => {
    if (!companyId) throw new Error('companyId is required')
    return companyChatRepo.listConversations(companyId)
  })

  ipcMain.handle(
    IPC_CHANNELS.COMPANY_CHAT_CREATE,
    (
      _event,
      data: {
        companyId: string
        title: string
        themeId?: string | null
        modelProvider?: string | null
        modelName?: string | null
      }
    ) => {
      if (!data?.companyId) throw new Error('companyId is required')
      if (!data?.title?.trim()) throw new Error('title is required')
      return companyChatRepo.createConversation(data)
    }
  )

  ipcMain.handle(IPC_CHANNELS.COMPANY_CHAT_MESSAGES, (_event, conversationId: string) => {
    if (!conversationId) throw new Error('conversationId is required')
    return companyChatRepo.listMessages(conversationId)
  })

  ipcMain.handle(
    IPC_CHANNELS.COMPANY_CHAT_APPEND,
    (
      _event,
      data: {
        conversationId: string
        role: 'user' | 'assistant' | 'system'
        content: string
        citationsJson?: string | null
        tokenCount?: number | null
      }
    ) => {
      if (!data?.conversationId) throw new Error('conversationId is required')
      if (!data?.content?.trim()) throw new Error('content is required')
      return companyChatRepo.appendMessage(data)
    }
  )
}
