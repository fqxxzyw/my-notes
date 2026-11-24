import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

async function loadTsModule(entryPoint) {
  const bundled = await build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false
  })
  return import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`)
}

const share = await loadTsModule('docs/.vitepress/theme/shareLink.ts')
const audio = await loadTsModule('docs/.vitepress/theme/shelfAudio.ts')

const TINY_PNG_BASE64 = share.bytesToBase64(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]))
const SAMPLE_REL = 'assets/0123456789abcdef0123456789abcdef.png'

test('offline share links roundtrip cabinet, book, chapter and page scopes with attachments', () => {
  const cabinetPayload = {
    v: 1,
    scope: 'cabinet',
    cabinet: {
      title: 'A2A 研究',
      books: [
        {
          title: '核心架构',
          description: '协议与工具链笔记',
          chapters: [
            { title: '第一章 概述', content: `# 概述\n\n![图](${SAMPLE_REL})` },
            { title: '备忘录', content: '纯文本记录', ext: 'txt' }
          ],
          attachments: [{ relPath: SAMPLE_REL, mime: 'image/png', base64: TINY_PNG_BASE64 }]
        }
      ],
      pages: [
        { title: '快速入门', content: '# 入门\n\n$E = mc^2$' }
      ]
    }
  }

  const encoded = share.encodeShareLink(cabinetPayload, { webOriginUrl: 'https://example.github.io/my-notes/' })
  assert.ok(encoded.uri.startsWith('paper-share://v1/'))
  assert.ok(encoded.webUrl?.startsWith('https://example.github.io/my-notes/#paper-share=v1:'))
  assert.equal(encoded.tooLarge, false)

  // Decode from raw URI, from web URL, and from chat text containing the URI
  for (const input of [encoded.uri, encoded.webUrl, `给你分享一个书柜：${encoded.uri} 点导入粘贴即可！`]) {
    const decoded = share.decodeShareInput(input)
    assert.equal(decoded.kind, 'offline')
    assert.equal(decoded.payload.scope, 'cabinet')
    assert.equal(decoded.payload.cabinet.title, 'A2A 研究')
    assert.equal(decoded.payload.cabinet.books[0].chapters.length, 2)
    assert.equal(decoded.payload.cabinet.books[0].chapters[1].ext, 'txt')
    assert.equal(decoded.payload.cabinet.books[0].attachments[0].relPath, SAMPLE_REL)
    assert.equal(decoded.payload.cabinet.pages[0].title, '快速入门')
  }

  const summary = share.summarizeSharePayload(cabinetPayload)
  assert.deepEqual(summary, {
    scope: 'cabinet',
    scopeLabel: '书柜分享',
    title: 'A2A 研究',
    bookCount: 1,
    chapterCount: 2,
    pageCount: 1,
    imageCount: 1
  })

  // Book, chapter and page scopes
  const bookEnc = share.encodeShareLink({
    v: 1,
    scope: 'book',
    book: { title: '算法手册', chapters: [{ title: '动态规划', content: '## DP' }] }
  })
  assert.equal(share.decodeShareInput(bookEnc.uri).payload.book.title, '算法手册')

  const chEnc = share.encodeShareLink({
    v: 1,
    scope: 'chapter',
    chapter: { title: '单章笔记', bookTitle: '算法手册', content: '正文' }
  })
  assert.equal(share.decodeShareInput(chEnc.uri).payload.chapter.title, '单章笔记')

  const pageEnc = share.encodeShareLink({
    v: 1,
    scope: 'page',
    page: { title: '独立清单', content: '第一行', ext: 'txt' }
  })
  const pageDec = share.decodeShareInput(pageEnc.uri).payload.page
  assert.equal(pageDec.title, '独立清单')
  assert.equal(pageDec.ext, 'txt')
})

test('stripShareAttachments removes images while preserving text and metadata', () => {
  const payload = {
    v: 1,
    scope: 'page',
    page: {
      title: '含图笔记',
      content: `![p](${SAMPLE_REL})`,
      attachments: [{ relPath: SAMPLE_REL, mime: 'image/png', base64: TINY_PNG_BASE64 }]
    }
  }
  const stripped = share.stripShareAttachments(payload)
  assert.equal(share.summarizeSharePayload(stripped).imageCount, 0)
  assert.equal(stripped.page.title, '含图笔记')
  assert.equal(stripped.page.content, payload.page.content)
})

test('GitHub short links and standard GitHub docs URLs parse across all scopes', () => {
  const ghBook = share.encodeGitHubShareLink({ repo: 'alice/notes', scope: 'book', id: 'book123', title: '系统设计' })
  assert.ok(ghBook.startsWith('paper-share://gh/v1?'))
  const parsedBook = share.decodeShareInput(ghBook)
  assert.equal(parsedBook.kind, 'github')
  assert.equal(parsedBook.repo, 'alice/notes')
  assert.equal(parsedBook.scope, 'book')
  assert.equal(parsedBook.id, 'book123')

  const ghCh = share.encodeGitHubShareLink({ repo: 'alice/notes', scope: 'chapter', id: 'book123', chapterId: 'ch01' })
  const parsedCh = share.decodeShareInput(ghCh)
  assert.equal(parsedCh.scope, 'chapter')
  assert.equal(parsedCh.chapterId, 'ch01')

  // Direct GitHub web URLs
  const webPage = share.decodeShareInput('https://github.com/alice/notes/blob/main/docs/pages/readme.md')
  assert.deepEqual(webPage, { kind: 'github', repo: 'alice/notes', scope: 'page', id: 'readme' })

  const webCh = share.decodeShareInput('https://github.com/alice/notes/blob/main/docs/notebooks/book1/intro.md')
  assert.deepEqual(webCh, { kind: 'github', repo: 'alice/notes', scope: 'chapter', id: 'book1', chapterId: 'intro' })

  const webBook = share.decodeShareInput('https://github.com/alice/notes/tree/main/docs/notebooks/book1')
  assert.deepEqual(webBook, { kind: 'github', repo: 'alice/notes', scope: 'book', id: 'book1' })
})

test('share decoder rejects tampered payloads and filters unsafe attachment paths/MIMEs', () => {
  assert.throws(() => share.decodeShareInput(''), /粘贴分享链接/)
  assert.throws(() => share.decodeShareInput('https://example.com/random'), /未识别/)
  assert.throws(() => share.decodeShareInput('paper-share://v1/not-valid-zlib!!!'), /损坏|不完整/)

  const validated = share.validateSharePayload({
    v: 1,
    scope: 'page',
    page: {
      title: '安全校验',
      content: '正文',
      attachments: [
        { relPath: '../escape.png', mime: 'image/png', base64: TINY_PNG_BASE64 },
        { relPath: SAMPLE_REL, mime: 'image/svg+xml', base64: TINY_PNG_BASE64 },
        { relPath: SAMPLE_REL, mime: 'image/png', base64: TINY_PNG_BASE64 }
      ]
    }
  })
  assert.equal(validated.page.attachments.length, 1)
  assert.equal(validated.page.attachments[0].mime, 'image/png')

  // Hard offline memory cap (512 KiB raw payload guard)
  const huge = share.encodeShareLink({
    v: 1,
    scope: 'page',
    page: { title: '超大文档', content: 'A'.repeat(share.MAX_OFFLINE_RAW_BYTES + 1024) }
  })
  assert.equal(huge.overMemoryLimit, true)
  assert.equal(huge.tooLarge, true)
  assert.equal(huge.uri, '')
})

test('createScrollTickTracker emits rhythmic per-book ticks and single edge bumps', () => {
  let ticks = 0
  let bumps = 0
  const tracker = audio.createScrollTickTracker(50, {
    onTick: () => { ticks++ },
    onEdgeBump: () => { bumps++ }
  })
  tracker.reset(0)
  // Crossing 50, 100, 150, 200 -> 4 ticks + 1 end bump at 200
  tracker.update(20, 200, 100)
  assert.equal(ticks, 0)
  tracker.update(55, 200, 120)
  assert.equal(ticks, 1)
  tracker.update(110, 200, 140)
  assert.equal(ticks, 2)
  tracker.update(165, 200, 160)
  assert.equal(ticks, 3)
  tracker.update(200, 200, 180)
  assert.equal(ticks, 4)
  assert.equal(bumps, 1)
  // Staying at the end must NOT spam edge bumps
  tracker.update(200, 200, 220)
  assert.equal(bumps, 1)
  // Sliding all the way back to start triggers start bump once
  tracker.update(0, 200, 280)
  assert.equal(bumps, 2)
  tracker.update(0, 200, 320)
  assert.equal(bumps, 2)

  // Sound toggle state works cleanly in headless Node
  audio.setSoundEnabled(false)
  assert.equal(audio.isSoundEnabled(), false)
  audio.setSoundEnabled(true)
  assert.equal(audio.isSoundEnabled(), true)
})
