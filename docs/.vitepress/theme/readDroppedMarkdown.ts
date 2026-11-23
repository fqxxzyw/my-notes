import MarkdownIt from 'markdown-it'

export interface DroppedMarkdownFile { path: string; name: string; content: string }
export interface DroppedSkip { path: string; reason: 'not-markdown' | 'too-large' | 'too-many' | 'invalid-utf8' | 'read-error' | 'unsupported' | 'invalid-path' | 'invalid-image' | 'ambiguous' }
export interface DroppedLocalResource { markdownPath: string; target: string }
export interface DroppedImage { path: string; bytes: Uint8Array; references: DroppedLocalResource[] }
export interface DroppedMarkdownResult { files: DroppedMarkdownFile[]; folders: string[]; skipped: DroppedSkip[]; localResources: DroppedLocalResource[]; images: DroppedImage[] }
export interface DropReadLimits { maxFiles?: number; maxFileBytes?: number; maxTotalBytes?: number; maxEntries?: number; maxDepth?: number; maxImages?: number; maxImageBytes?: number; maxTotalImageBytes?: number }

interface Entry {
  name: string
  isFile: boolean
  isDirectory: boolean
  file?: (success: (file: File) => void, error: (error: unknown) => void) => void
  createReader?: () => { readEntries: (success: (entries: Entry[]) => void, error: (error: unknown) => void) => void }
}

const parser = new MarkdownIt({ html: true })

/** Report relative links and image targets; no files or links are followed. */
function localTargets(markdown: string): { targets: string[]; images: string[]; links: string[] } {
  const found = new Set<string>()
  const images = new Set<string>()
  const links = new Set<string>()
  const add = (target: string, image = false) => {
    const value = target.trim()
    if (!value || value.startsWith('#') || value.startsWith('/') || value.startsWith('\\') || /^[a-z][a-z\d+.-]*:/i.test(value)) return
    found.add(value)
    if (image) images.add(value)
    else links.add(value)
  }
  const visit = (tokens: any[]) => {
    for (const token of tokens) {
      if (token.type === 'link_open') add(token.attrGet('href') || '')
      if (token.type === 'image') add(token.attrGet('src') || '', true)
      if (token.type === 'html_inline' || token.type === 'html_block') {
        const attributes = /\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
        let match: RegExpExecArray | null
        // Raw HTML is not rendered by the app; keep these paths in warnings
        // rather than claiming that importing their files made them visible.
        while ((match = attributes.exec(token.content))) add(match[1] || match[2] || match[3] || '')
      }
      if (token.children) visit(token.children)
    }
  }
  visit(parser.parse(markdown, {}))
  return { targets: [...found], images: [...images], links: [...links] }
}

/** FileList paths and entry names must never escape the explicitly selected roots. */
function validInputPath(path: string): boolean {
  return !!path && !path.startsWith('/') && !/[\\\0]/.test(path) && path.split('/').every(part => !!part && part !== '.' && part !== '..')
}

/** URL decoding occurs per segment so encoded separators cannot bypass containment. */
export function resolveDroppedImagePath(markdownPath: string, target: string): string | null {
  if (!validInputPath(markdownPath) || !target || /^[a-z][a-z\d+.-]*:/i.test(target) || /^[\\/]/.test(target)) return null
  const withoutQuery = target.split(/[?#]/, 1)[0]
  const result = markdownPath.split('/').slice(0, -1)
  const rootDepth = markdownPath.includes('/') ? 1 : 0
  try {
    for (const encoded of withoutQuery.split('/')) {
      const part = decodeURIComponent(encoded)
      if (!part || part === '.') continue
      if (/[\\/\0]/.test(part)) return null
      if (part === '..') { if (result.length <= rootDepth) return null; result.pop() }
      else result.push(part)
    }
  } catch { return null }
  return result.length > rootDepth && validInputPath(result.join('/')) ? result.join('/') : null
}

function validImage(path: string, bytes: Uint8Array): boolean {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  if (ext === 'png') return bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((n, i) => bytes[i] === n)
  if (ext === 'jpg' || ext === 'jpeg') return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (ext === 'gif') return bytes.length >= 6 && /^GIF8[79]a$/.test(String.fromCharCode(...bytes.slice(0, 6)))
  return ext === 'webp' && bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
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
  const maxImages = limit(options.maxImages, 300), maxImageBytes = limit(options.maxImageBytes, 20 * 1024 * 1024)
  const maxTotalImageBytes = limit(options.maxTotalImageBytes, 100 * 1024 * 1024)
  const result: DroppedMarkdownResult = { files: [], folders: [], skipped: [], localResources: [], images: [] }
  const imageFiles = new Map<string, File | null>()
  const imageReferences: DroppedLocalResource[] = []
  const nonImageReferences = new Set<string>()
  let entriesSeen = 0, totalBytes = 0, exhausted = false
  const addFolder = (name: string) => { if (validInputPath(name) && !name.includes('/') && !result.folders.includes(name)) result.folders.push(name) }
  const addRelativeRoot = (path: string) => { if (validInputPath(path) && path.includes('/')) addFolder(path.split('/')[0]) }
  const skip = (path: string, reason: DroppedSkip['reason']) => result.skipped.push({ path, reason })
  const consume = () => {
    if (entriesSeen >= maxEntries) { if (!exhausted) skip('（其余项目）', 'too-many'); exhausted = true; return false }
    entriesSeen++
    return true
  }
  const readFile = async (file: File, path: string) => {
    if (!validInputPath(path)) { skip(path, 'invalid-path'); return }
    if (/\.(?:png|jpe?g|gif|webp)$/i.test(file.name)) {
      // Do not read arbitrary pictures. Gather handles and read only those the
      // selected Markdown actually references after traversal is complete.
      imageFiles.set(path, imageFiles.has(path) ? null : file)
      return
    }
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
    const resources = localTargets(content)
    for (const target of resources.targets) result.localResources.push({ markdownPath: path, target })
    for (const target of resources.images) imageReferences.push({ markdownPath: path, target })
    for (const target of resources.links) nonImageReferences.add(`${path}\0${target}`)
  }
  const walk = async (entry: Entry, parent: string, depth: number): Promise<void> => {
    if (exhausted || !consume()) return
    const path = parent ? `${parent}/${entry.name}` : entry.name
    if (!entry.name || /[\\/\0]/.test(entry.name) || entry.name === '.' || entry.name === '..') { skip(path, 'invalid-path'); return }
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
  const referencesByPath = new Map<string, DroppedLocalResource[]>()
  for (const reference of imageReferences) {
    const path = resolveDroppedImagePath(reference.markdownPath, reference.target)
    if (path && imageFiles.has(path)) referencesByPath.set(path, [...(referencesByPath.get(path) || []), reference])
  }
  let totalImageBytes = 0
  for (const [path, file] of imageFiles) {
    const references = referencesByPath.get(path)
    if (!references?.length) { skip(path, 'not-markdown'); continue }
    if (!file) { skip(path, 'ambiguous'); continue }
    if (result.images.length >= maxImages) { skip(path, 'too-many'); continue }
    if (!file.size || file.size > maxImageBytes || totalImageBytes + file.size > maxTotalImageBytes) { skip(path, 'too-large'); continue }
    totalImageBytes += file.size
    let bytes: Uint8Array
    try { bytes = new Uint8Array(await fileBytes(file)) } catch { skip(path, 'read-error'); continue }
    if (bytes.length !== file.size || !validImage(path, bytes)) { skip(path, 'invalid-image'); continue }
    result.images.push({ path, bytes, references })
    const fulfilled = new Set(references.map(ref => `${ref.markdownPath}\0${ref.target}`))
    result.localResources = result.localResources.filter(ref => {
      const key = `${ref.markdownPath}\0${ref.target}`
      return !fulfilled.has(key) || nonImageReferences.has(key)
    })
  }
  return result
}
