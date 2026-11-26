import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chapterDisplayInfo, groupChaptersForDirectory } from '../docs/.vitepress/theme/notebookChapterOrder.ts'
import { deriveCustomThemeVars } from '../docs/.vitepress/theme/themeManager.ts'
import { parseFlowchartMermaid, serializeFlowchartMermaid, nextNodeId } from '../docs/.vitepress/theme/mermaidGraphModel.ts'
import { sanitizeMermaidSource } from '../docs/.vitepress/theme/mermaidRenderer.ts'
import { normalizeRepository, parseRepository } from '../docs/.vitepress/theme/repository.ts'

const droppedBundle = await build({ entryPoints: ['docs/.vitepress/theme/readDroppedMarkdown.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { selectedImageMatch } = await import(`data:text/javascript;base64,${Buffer.from(droppedBundle.outputFiles[0].contents).toString('base64')}`)

function encodeId(relPath) {
  const b64 = Buffer.from(relPath, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  return `c_${'a'.repeat(32)}_${b64}`
}

test('chapterDisplayInfo prioritizes filename and shows H1 as summaryTitle for imported files', () => {
  const ch = {
    id: encodeId('01-基础/02-变量与类型.md'),
    title: '深入理解 Python 变量与类型系统'
  }
  const info = chapterDisplayInfo(ch)
  assert.equal(info.isImported, true)
  assert.equal(info.groupName, '01-基础')
  assert.equal(info.nestedSubpath, '')
  assert.equal(info.primaryTitle, '02-变量与类型')
  assert.equal(info.summaryTitle, '深入理解 Python 变量与类型系统')
})

test('chapterDisplayInfo flattens 4th+ level nested folders as 子文件夹/文档名 inside 3rd-level group', () => {
  const ch = {
    id: encodeId('02-进阶/异步/协程/01-gather.md'),
    title: 'asyncio.gather 源码精讲'
  }
  const info = chapterDisplayInfo(ch)
  assert.equal(info.groupName, '02-进阶')
  assert.equal(info.nestedSubpath, '异步/协程')
  assert.equal(info.primaryTitle, '异步/协程/01-gather')
  assert.equal(info.summaryTitle, 'asyncio.gather 源码精讲')
})

test('groupChaptersForDirectory groups consecutive chapters sharing top-level folder', () => {
  const list = [
    { id: encodeId('README.md'), title: '总览' },
    { id: encodeId('第1章/a.md'), title: 'A' },
    { id: encodeId('第1章/b.md'), title: 'B' },
    { id: encodeId('第2章/c.md'), title: 'C' }
  ]
  const groups = groupChaptersForDirectory(list)
  assert.equal(groups.length, 3)
  assert.equal(groups[0].groupName, '')
  assert.equal(groups[0].items.length, 1)
  assert.equal(groups[1].groupName, '第1章')
  assert.equal(groups[1].items.length, 2)
  assert.equal(groups[2].groupName, '第2章')
  assert.equal(groups[2].items.length, 1)
})

test('deriveCustomThemeVars derives light and dark color schemes accurately', () => {
  const light = deriveCustomThemeVars({ paper: '#eef4fa', ink: '#1f3347', edge: '#46688a' })
  assert.equal(light['color-scheme'], 'light')
  assert.equal(light['--theme-paper'], '#eef4fa')
  assert.equal(light['--theme-ink'], '#1f3347')

  const dark = deriveCustomThemeVars({ paper: '#18222e', ink: '#e3ecf5', edge: '#7a9ec2' })
  assert.equal(dark['color-scheme'], 'dark')
})

test('selectedImageMatch disambiguates duplicate basenames using relative folder suffix', () => {
  const pool = ['root/ch1.assets/pic.png', 'root/ch2.assets/pic.png']
  const matched = selectedImageMatch('ch2.assets/pic.png', pool, true)
  assert.deepEqual(matched, { path: 'root/ch2.assets/pic.png', ambiguous: false })

  const stillAmbiguous = selectedImageMatch('other/pic.png', pool, true)
  assert.deepEqual(stillAmbiguous, { path: null, ambiguous: true })
})

test('mermaidGraphModel parses and serializes flowcharts cleanly', () => {
  const src = [
    'flowchart LR',
    '  A["开始"] --> B{"判断"}',
    '  B -->|是| C(["完成"])',
    '  B -.->|否| D[("存储")]'
  ].join('\n')
  const graph = parseFlowchartMermaid(src)
  assert.ok(graph)
  assert.equal(graph.direction, 'LR')
  assert.equal(graph.nodes.length, 4)
  assert.equal(graph.nodes[1].shape, 'diamond')
  assert.equal(graph.nodes[2].shape, 'stadium')
  assert.equal(graph.nodes[3].shape, 'cylinder')
  assert.equal(graph.edges.length, 3)
  assert.equal(graph.edges[2].style, 'dashed')
  assert.equal(nextNodeId(graph.nodes), 'E')
  const out = serializeFlowchartMermaid(graph)
  assert.ok(out.includes('flowchart LR'))
  assert.ok(out.includes('B -.->|否| D'))
  assert.equal(parseFlowchartMermaid('sequenceDiagram\n  A->>B: hi'), null)
})

test('repository supports GitHub, Gitee, GitLab and GitCode while rejecting untrusted hosts', () => {
  assert.equal(normalizeRepository('https://gitee.com/User/My-Notes.git'), 'gitee:user/my-notes')
  assert.equal(normalizeRepository('https://gitlab.com/User/My-Notes'), 'gitlab:user/my-notes')
  assert.equal(normalizeRepository('https://gitcode.com/User/My-Notes'), 'gitcode:user/my-notes')
  const parsed = parseRepository('https://gitee.com/Alice/Notes')
  assert.equal(parsed.provider, 'gitee')
  assert.equal(parsed.webUrl, 'https://gitee.com/alice/notes')
  assert.throws(() => normalizeRepository('https://evil.example/a/b'))
})

test('sanitizeMermaidSource auto-quotes unquoted edge labels containing parentheses', () => {
  const raw = 'flowchart TD\n  L1 -->|命中! (~1ms)| Ret["直接返回缓存答案"]'
  const fixed = sanitizeMermaidSource(raw)
  assert.equal(fixed, 'flowchart TD\n  L1 -->|"命中! (~1ms)"| Ret["直接返回缓存答案"]')
})
