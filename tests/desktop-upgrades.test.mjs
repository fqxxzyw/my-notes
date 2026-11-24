import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto, createHash } from 'node:crypto'
import { build } from 'esbuild'

globalThis.crypto ??= webcrypto

async function loadTs(entry) {
  const bundled = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false, external: ['mermaid'] })
  return import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`)
}

const tableMod = await loadTs('docs/.vitepress/theme/markdownTable.ts')
const mermaidMod = await loadTs('docs/.vitepress/theme/mermaidRenderer.ts')
const titleMod = await loadTs('docs/.vitepress/theme/notebookTitle.ts')
const docMod = await loadTs('docs/.vitepress/theme/documentFiles.ts')
const dropMod = await loadTs('docs/.vitepress/theme/readDroppedMarkdown.ts')
const storeMod = await loadTs('docs/.vitepress/theme/notebookStore.ts')
const linksMod = await loadTs('docs/.vitepress/theme/markdownLinks.ts')

test('markdownTable edits complex cells, inserts/deletes rows and columns, and sets alignment', () => {
  const raw = '| 层级 | 函数名 | 说明 |\r\n| :--- | :---: | ---: |\r\n| **底层** | `_amap_request(a, b)` | 含 \\| 管道符 |'
  const parsed = tableMod.parseMarkdownTable(raw)
  assert.ok(parsed)
  assert.deepEqual(parsed.headers, ['层级', '函数名', '说明'])
  assert.deepEqual(parsed.alignments, ['left', 'center', 'right'])
  assert.equal(parsed.rows[0][0], '**底层**')
  assert.equal(parsed.rows[0][1], '`_amap_request(a, b)`')
  assert.equal(parsed.rows[0][2], '含 | 管道符')
  assert.equal(parsed.newline, '\r\n')

  let next = tableMod.updateTableCell(parsed, 1, 0, '**更新** | 新值')
  next = tableMod.insertTableRow(next, 1)
  next = tableMod.updateTableCell(next, 2, 1, '`geocode()`')
  next = tableMod.insertTableColumn(next, 2, '备注')
  next = tableMod.setTableColumnAlign(next, 2, 'center')
  const serialized = tableMod.serializeMarkdownTable(next)
  assert.ok(serialized.includes('**更新** \\| 新值'))
  assert.ok(serialized.includes('| :--- | :---: | :---: | ---: |'))
  assert.ok(serialized.includes('\r\n'))

  const reparsed = tableMod.parseMarkdownTable(serialized)
  assert.equal(reparsed.headers.length, 4)
  assert.equal(reparsed.rows.length, 2)
  assert.equal(reparsed.rows[0][0], '**更新** | 新值')
  assert.equal(reparsed.rows[1][1], '`geocode()`')

  const trimmed = tableMod.deleteTableColumn(tableMod.deleteTableRow(reparsed, 1), 2)
  assert.equal(trimmed.headers.length, 3)
  assert.equal(trimmed.rows.length, 1)
  // Cannot delete the final remaining column.
  const oneCol = tableMod.deleteTableColumn(tableMod.deleteTableColumn(trimmed, 2), 1)
  assert.equal(oneCol.headers.length, 1)
  assert.equal(tableMod.deleteTableColumn(oneCol, 0).headers.length, 1)
})

test('mermaid fence detection handles flowcharts with subgraphs, Chinese labels and <br/>', () => {
  const flowchart = [
    '```mermaid',
    'flowchart TD',
    '    A["8 个公开工具函数之一被调用<br/>(geocode / regeocode)"]',
    '    subgraph AMAP_REQ ["_amap_request(path, params) 通用请求层"]',
    '        C --> D{"AMAP_API_KEY 是否已配置?"}',
    '    end',
    '```'
  ].join('\n')
  const extracted = mermaidMod.extractMermaidFence(flowchart)
  assert.ok(extracted)
  assert.equal(extracted.language, 'mermaid')
  assert.ok(extracted.code.includes('subgraph AMAP_REQ'))
  assert.ok(extracted.code.includes('<br/>'))
  assert.equal(mermaidMod.isMermaidLanguage('MERMAID'), true)
  assert.equal(mermaidMod.isMermaidLanguage('python'), false)
  assert.equal(mermaidMod.extractMermaidFence('```python\nprint(1)\n```'), null)
  assert.ok(mermaidMod.MERMAID_TEMPLATES.length >= 4)
})

test('rename helpers preserve notebook description/order metadata and Markdown body bytes', () => {
  const index = '# 旧书名\r\n\r\n用户自定义说明\r\n<!-- paper-notes-chapter-order:["c1","c2"] -->\r\n<!-- paper-notes-description:"这是一句简介" -->\r\n'
  const renamedIndex = titleMod.writeNotebookIndexTitle(index, '新书名')
  assert.ok(renamedIndex.startsWith('# 新书名\r\n'))
  assert.ok(renamedIndex.includes('用户自定义说明'))
  assert.ok(renamedIndex.includes('<!-- paper-notes-chapter-order:["c1","c2"] -->'))
  assert.ok(renamedIndex.includes('<!-- paper-notes-description:"这是一句简介" -->'))

  const chapter = '# 原标题\r\n\r\n正文段落\r\n'
  assert.equal(titleMod.writeMarkdownDocumentTitle(chapter, '修改后的标题'), '# 修改后的标题\r\n\r\n正文段落\r\n')
  const noHeading = '没有标题的正文'
  assert.equal(titleMod.writeMarkdownDocumentTitle(noHeading, '新增标题'), '# 新增标题\n\n没有标题的正文')
  assert.throws(() => titleMod.validateRenameTitle('   '), /不能为空/)
  assert.throws(() => titleMod.validateRenameTitle('第一行\n第二行'), /换行/)
})

test('only .md and .txt are editable; pdf/doc/docx/ppt/pptx are read-only and importable', async () => {
  assert.equal(docMod.isEditableExt('md'), true)
  assert.equal(docMod.isEditableExt('txt'), true)
  assert.equal(docMod.isEditableExt(undefined), true)
  for (const ext of ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'csv', 'rtf']) {
    assert.equal(docMod.isEditableExt(ext), false, `${ext} must be read-only`)
    assert.equal(docMod.isBinaryDocumentExt(ext), true, `${ext} must be binary document`)
  }
  assert.throws(() => docMod.validateDocumentPath('docs/pages/files/' + 'a'.repeat(32) + '.exe'))
  assert.throws(() => docMod.validateDocumentPath('docs/pages/files/../../secret.pdf'))
  const validPath = docMod.newDocumentPath(null, 'pdf')
  assert.match(validPath, /^docs\/pages\/files\/[a-f0-9]{32}\.pdf$/)

  const csv = docMod.parseCsvPreview(new TextEncoder().encode('名称,说明\n"纸间,桌面版",支持预览\n'))
  assert.deepEqual(csv, [['名称', '说明'], ['纸间,桌面版', '支持预览']])

  const mdFile = new File(['# 笔记'], 'note.md')
  const txtFile = new File(['纯文本内容'], 'plain.txt')
  const pdfFile = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])], '架构.pdf')
  const docxFile = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2])], '需求.docx')
  const pptxFile = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 3, 4])], '汇报.pptx')
  const exeFile = new File([new Uint8Array([0x4d, 0x5a])], 'bad.exe')

  const result = await dropMod.readDroppedMarkdown({ items: [], files: [mdFile, txtFile, pdfFile, docxFile, pptxFile, exeFile] }, { allowOtherFiles: true })
  assert.deepEqual(result.files.map(f => [f.name, f.ext || 'md']), [['note.md', 'md'], ['plain.txt', 'txt']])
  assert.deepEqual(result.documents.map(d => [d.name, d.ext]), [['架构.pdf', 'pdf'], ['需求.docx', 'docx'], ['汇报.pptx', 'pptx']])
  assert.deepEqual(result.skipped, [{ path: 'bad.exe', reason: 'not-markdown' }])
})

test('notebookStore syncs and restores .txt and binary .pdf pages cleanly', async () => {
  const hash = buf => createHash('sha1').update(buf).digest('hex')
  const blobSha = bytes => hash(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), Buffer.from(bytes)]))
  const files = new Map([['docs/cabinets.json', Buffer.from(JSON.stringify({ cabinets: [{ id: 'general', title: '默认书柜' }], assignments: {} }))]])
  const blobs = new Map()
  let head = 'a'.repeat(40), staged, newCommit, root, trees
  const buildTrees = () => {
    trees = new Map()
    const make = prefix => {
      const dirs = new Set(), entries = []
      for (const [path, bytes] of files) {
        if (!path.startsWith(prefix)) continue
        const rem = path.slice(prefix.length)
        const slash = rem.indexOf('/')
        if (slash < 0) entries.push({ path: rem, type: 'blob', mode: '100644', sha: blobSha(bytes) })
        else dirs.add(rem.slice(0, slash))
      }
      for (const dir of dirs) entries.push({ path: dir, type: 'tree', mode: '040000', sha: make(`${prefix}${dir}/`) })
      const key = hash(Buffer.from(JSON.stringify([prefix, entries])))
      trees.set(key, entries)
      return key
    }
    root = make('')
  }
  buildTrees()
  globalThis.fetch = async (url, options = {}) => {
    const path = decodeURIComponent(new URL(url).pathname)
    const method = options.method || 'GET'
    const body = options.body ? JSON.parse(options.body) : undefined
    const ok = data => new Response(JSON.stringify(data), { status: 200 })
    const git = path.split('/git/')[1]
    if (git) {
      if (git === 'ref/heads/main') return ok({ object: { sha: head } })
      if (git.startsWith('commits/') && method === 'GET') return ok({ tree: { sha: root } })
      if (git.startsWith('trees/') && method === 'GET') return ok({ tree: trees.get(git.slice(6)) })
      if (git === 'blobs' && method === 'POST') {
        const bytes = Buffer.from(body.content, 'base64')
        const sha = blobSha(bytes)
        blobs.set(sha, bytes)
        return ok({ sha })
      }
      if (git.startsWith('blobs/') && method === 'GET') {
        const bytes = [...files.values()].find(b => blobSha(b) === git.slice(6))
        return ok({ encoding: 'base64', content: bytes.toString('base64') })
      }
      if (git === 'trees' && method === 'POST') { staged = body.tree; return ok({ sha: '8'.repeat(40) }) }
      if (git === 'commits' && method === 'POST') { newCommit = hash(Buffer.from(`${head}/${JSON.stringify(staged)}`)); return ok({ sha: newCommit }) }
      if (git === 'refs/heads/main' && method === 'PATCH') {
        for (const change of staged) {
          if (change.sha === null) files.delete(change.path)
          else if (change.sha) files.set(change.path, blobs.get(change.sha))
          else files.set(change.path, Buffer.from(change.content, 'utf-8'))
        }
        head = newCommit; buildTrees(); return ok({})
      }
    }
    const rel = path.split('/contents/')[1]
    if (rel === 'docs/pages') {
      const entries = [...files.keys()].filter(k => k.startsWith('docs/pages/')).map(k => ({ type: 'file', name: k.slice(11), path: k, sha: blobSha(files.get(k)) }))
      return ok(entries)
    }
    if (rel && files.has(rel)) {
      const bytes = files.get(rel)
      return ok({ type: 'file', sha: blobSha(bytes), encoding: 'base64', content: bytes.toString('base64') })
    }
    throw new Error(`Unexpected ${method} ${path}`)
  }

  const store = storeMod.createNotebookStore('example/repo')
  store.setToken('fake')
  const txtId = storeMod.pageIdFromTitle('纯文本记录')
  const pdfId = storeMod.pageIdFromTitle('设计文档')
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
  const pdfManagedPath = docMod.newDocumentPath(null, 'pdf')
  await store.syncBatch(
    [],
    [],
    undefined,
    [
      { id: txtId, title: '纯文本记录', content: '第一行\n第二行', sha: '', ext: 'txt' },
      { id: pdfId, title: '设计文档', content: '', sha: '', ext: 'pdf', filePath: pdfManagedPath, fileSize: pdfBytes.length }
    ],
    [],
    [{ path: pdfManagedPath, bytes: pdfBytes }]
  )
  assert.ok(files.has(`docs/pages/${txtId}.txt`))
  assert.ok(files.has(`docs/pages/${pdfId}.pdf`))

  const listed = await store.listPages()
  assert.equal(listed.length, 2)
  const txtPage = listed.find(p => p.id === txtId)
  const pdfPage = listed.find(p => p.id === pdfId)
  assert.equal(txtPage.ext, 'txt')
  assert.equal(txtPage.title, '纯文本记录')
  assert.equal(txtPage.content, '第一行\n第二行')
  assert.equal(pdfPage.ext, 'pdf')
  assert.equal(pdfPage.title, '设计文档')
  assert.deepEqual(Array.from(pdfPage.binaryBytes), Array.from(pdfBytes))
})

test('markdownLinks resolves sibling .md files, parent paths, anchors, and TOC slugs', () => {
  assert.equal(linksMod.headingSlug('2.1 函数清单与调用映射表'), '21-函数清单与调用映射表')
  assert.equal(linksMod.normalizeHeadingKey('#2.1-函数清单'), linksMod.normalizeHeadingKey('2.1 函数清单'))
  assert.deepEqual(linksMod.parseMarkdownLinkHref('./mcp_tools.md#2.1-函数清单'), {
    kind: 'local',
    path: './mcp_tools.md',
    hash: '2.1-函数清单',
    ext: 'md'
  })
  assert.equal(linksMod.parseMarkdownLinkHref('https://example.com/a.md').kind, 'external')
  assert.deepEqual(linksMod.parseMarkdownLinkHref('#二、全景图'), { kind: 'hash', hash: '二、全景图' })

  const current = { bookId: 'b1', id: 'c1', title: 'api/README', ext: 'md' }
  const siblings = [
    current,
    { bookId: 'b1', id: 'c2', title: 'api/mcp_tools', ext: 'md' },
    { bookId: 'b1', id: 'c3', title: 'guide/快速开始', ext: 'md' },
    { bookId: 'b1', id: 'c4', title: 'api/设计文档', ext: 'pdf', fileName: '设计文档.pdf' }
  ]
  const cabinetPages = [
    { bookId: 'page_p1', id: 'p1', title: '独立笔记', ext: 'md', isPage: true }
  ]

  const hitSibling = linksMod.resolveMarkdownTarget('./mcp_tools.md#2.1-函数清单', current, siblings, cabinetPages)
  assert.equal(hitSibling?.target.id, 'c2')
  assert.equal(hitSibling?.hash, '2.1-函数清单')

  const hitParent = linksMod.resolveMarkdownTarget('../guide/%E5%BF%AB%E9%80%9F%E5%BC%80%E5%A7%8B.md', current, siblings, cabinetPages)
  assert.equal(hitParent?.target.id, 'c3')

  const hitPdf = linksMod.resolveMarkdownTarget('设计文档.pdf', current, siblings, cabinetPages)
  assert.equal(hitPdf?.target.id, 'c4')

  const hitPage = linksMod.resolveMarkdownTarget('./独立笔记.md', current, siblings, cabinetPages)
  assert.equal(hitPage?.target.id, 'p1')

  assert.equal(linksMod.resolveMarkdownTarget('./不存在.md', current, siblings, cabinetPages), null)
})
