import MarkdownIt from 'markdown-it'

export interface DroppedMarkdownFile { path: string; name: string; content: string }
export interface DroppedSkip { path: string; reason: 'not-markdown' | 'too-large' | 'too-many' | 'invalid-utf8' | 'read-error' | 'unsupported' }
export interface DroppedLocalResource { markdownPath: string; target: string }
export interface DroppedMarkdownResult { files: DroppedMarkdownFile[]; folders: string[]; skipped: DroppedSkip[]; localResources: DroppedLocalResource[] }
export interface DropReadLimits { maxFiles?: number; maxFileBytes?: number; maxTotalBytes?: number; maxEntries?: number; maxDepth?: number }

interface Entry {
  name: string
  isFile: boolean
  isDirectory: boolean
  file?: (success: (file: File) => void, error: (error: unknown) => void) => void
  createReader?: () => { readEntries: (success: (entries: Entry[]) => void, error: (error: unknown) => void) => void }
}

const parser = new MarkdownIt({ html: true })

/** Report relative links and image targets; no files or links are followed. */
function localTargets(markdown: string): string[] {
  const found = new Set<string>()
  const add = (target: string) => {
    const value = target.trim()
    if (!value || value.startsWith('#') || value.startsWith('/') || value.startsWith('\\') || /^[a-z][a-z\d+.-]*:/i.test(value)) return
    found.add(value)
  }
  const visit = (tokens: any[]) => {
    for (const token of tokens) {
      if (token.type === 'link_open') add(token.attrGet('href') || '')
      if (token.type === 'image') add(token.attrGet('src') || '')
      if (token.type === 'html_inline' || token.type === 'html_block') {
        const attributes = /\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
        let match: RegExpExecArray | null
        while ((match = attributes.exec(token.content))) add(match[1] || match[2] || match[3] || '')
      }
      if (token.children) visit(token.children)
    }
  }
  visit(parser.parse(markdown, {}))
  return [...found]
}

function fileBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => typeof reader.result === 'string' || reader.result === null ? reject(new Error('Invalid file data')) : resolve(reader.result)
    reader.readAsArrayBuffer(file)
  })
}

/** Read dropped files without mutating the app's notebooks or GitHub data. */
export async function readDroppedMarkdown(transfer: DataTransfer, options: DropReadLimits = {}): Promise<DroppedMarkdownResult> {
  const limit = (value: number | undefined, fallback: number) => Number.isSafeInteger(value) && value! > 0 ? value! : fallback
  const maxFiles = limit(options.maxFiles, 300), maxFileBytes = limit(options.maxFileBytes, 5 * 1024 * 1024)
  const maxTotalBytes = limit(options.maxTotalBytes, 30 * 1024 * 1024)
  const maxEntries = limit(options.maxEntries, 2000), maxDepth = limit(options.maxDepth, 32)
  const result: DroppedMarkdownResult = { files: [], folders: [], skipped: [], localResources: [] }
  let entriesSeen = 0, totalBytes = 0, exhausted = false
  const addFolder = (name: string) => { if (name && !result.folders.includes(name)) result.folders.push(name) }
  const addRelativeRoot = (path: string) => { if (path.includes('/')) addFolder(path.split('/')[0]) }
  const skip = (path: string, reason: DroppedSkip['reason']) => result.skipped.push({ path, reason })
  const consume = () => {
    if (entriesSeen >= maxEntries) { if (!exhausted) skip('（其余项目）', 'too-many'); exhausted = true; return false }
    entriesSeen++
    return true
  }
  const readFile = async (file: File, path: string) => {
    if (!/\.md$/i.test(file.name)) { skip(path, 'not-markdown'); return }
    if (result.files.length >= maxFiles) { skip(path, 'too-many'); return }
    if (file.size > maxFileBytes || totalBytes + file.size > maxTotalBytes) { skip(path, 'too-large'); return }
    // Count attempted reads against the budget, including invalid files.
    totalBytes += file.size
    let bytes: ArrayBuffer
    try { bytes = await fileBytes(file) } catch { skip(path, 'read-error'); return }
    let content: string
    try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) } catch { skip(path, 'invalid-utf8'); return }
    result.files.push({ path, name: file.name, content })
    for (const target of localTargets(content)) result.localResources.push({ markdownPath: path, target })
  }
  const walk = async (entry: Entry, parent: string, depth: number): Promise<void> => {
    if (exhausted || !consume()) return
    const path = parent ? `${parent}/${entry.name}` : entry.name
    if (entry.isFile && entry.file) {
      try { await readFile(await new Promise<File>((resolve, reject) => entry.file!(resolve, reject)), path) }
      catch { skip(path, 'read-error') }
    } else if (entry.isDirectory && entry.createReader) {
      if (depth >= maxDepth) { skip(path, 'too-many'); return }
      try {
        const reader = entry.createReader()
        while (!exhausted) {
          // A directory reader can return several batches before the empty batch.
          const batch = await new Promise<Entry[]>((resolve, reject) => reader.readEntries(resolve, reject))
          if (!batch.length) break
          for (const child of batch) { await walk(child, path, depth + 1); if (exhausted) break }
        }
      } catch { skip(path, 'read-error') }
    } else skip(path, 'unsupported')
  }
  // The drag data store can become inaccessible as soon as the drop handler
  // yields. Capture every handle synchronously before the first await.
  const items = Array.from(transfer.items || []).filter(item => item.kind === 'file').map(item => {
    try {
      const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() as Entry | null : null
      return { entry, file: entry ? null : item.getAsFile() }
    } catch { return { entry: null, file: null } }
  })
  const fallbackFiles = items.length ? [] : Array.from(transfer.files || [])
  if (items.length) {
    for (const item of items) {
      if (exhausted) break
      const entry = item.entry
      if (entry) {
        if (entry.isDirectory) addFolder(entry.name)
        await walk(entry, '', 0)
      }
      else {
        const file = item.file
        if (!consume()) break
        if (file) { const path = file.webkitRelativePath || file.name; addRelativeRoot(path); await readFile(file, path) }
        else skip('（无法读取的项目）', 'unsupported')
      }
    }
  } else {
    for (const file of fallbackFiles) {
      if (!consume()) break
      const path = file.webkitRelativePath || file.name
      addRelativeRoot(path)
      await readFile(file, path)
    }
  }
  return result
}
