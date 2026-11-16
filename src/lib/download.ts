/** Trigger a browser download of in-memory text (e.g. a CSV export). */
export function downloadText(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  // BOM so Excel opens UTF-8 (Vietnamese names) correctly
  const blob = new Blob(['﻿', content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
