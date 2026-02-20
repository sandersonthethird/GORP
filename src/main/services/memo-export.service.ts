import { BrowserWindow } from 'electron'
import { join } from 'path'
import { writeFileSync } from 'fs'
import { getMemosDir } from '../storage/paths'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function sanitizeFilePart(value: string): string {
  return value
    .replace(/[\/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

function markdownToHtml(markdown: string): string {
  const lines = markdown.split('\n')
  const output: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      output.push('<div style="height:8px"></div>')
      continue
    }

    if (trimmed.startsWith('### ')) {
      output.push(`<h3>${escapeHtml(trimmed.slice(4))}</h3>`)
      continue
    }
    if (trimmed.startsWith('## ')) {
      output.push(`<h2>${escapeHtml(trimmed.slice(3))}</h2>`)
      continue
    }
    if (trimmed.startsWith('# ')) {
      output.push(`<h1>${escapeHtml(trimmed.slice(2))}</h1>`)
      continue
    }
    if (trimmed.startsWith('- ')) {
      output.push(`<li>${escapeHtml(trimmed.slice(2))}</li>`)
      continue
    }

    output.push(`<p>${escapeHtml(trimmed)}</p>`)
  }

  const collapsed = output
    .join('\n')
    .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
    .replace(/<\/ul>\s*<ul>/g, '')

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            color: #111827;
            margin: 40px;
            line-height: 1.5;
            font-size: 13px;
          }
          h1 { font-size: 24px; margin: 0 0 10px 0; }
          h2 { font-size: 18px; margin: 18px 0 8px; }
          h3 { font-size: 15px; margin: 16px 0 6px; }
          p { margin: 6px 0; }
          ul { margin: 8px 0 8px 20px; }
          li { margin: 4px 0; }
        </style>
      </head>
      <body>${collapsed}</body>
    </html>
  `
}

export async function exportMemoMarkdownToPdf(params: {
  companyName: string
  memoTitle: string
  versionNumber: number
  contentMarkdown: string
}): Promise<{ absolutePath: string; filename: string }> {
  const safeCompany = sanitizeFilePart(params.companyName || 'Company')
  const safeTitle = sanitizeFilePart(params.memoTitle || 'Investment Memo')
  const filename = `${safeCompany} - ${safeTitle} - v${params.versionNumber}.pdf`
  const absolutePath = join(getMemosDir(), filename)
  const html = markdownToHtml(params.contentMarkdown)

  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 1600,
    webPreferences: {
      sandbox: true
    }
  })

  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
    })
    writeFileSync(absolutePath, pdf)
    return { absolutePath, filename }
  } finally {
    win.destroy()
  }
}
