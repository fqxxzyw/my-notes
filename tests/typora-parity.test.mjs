import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import MarkdownIt from 'markdown-it'

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

const typora = await loadTsModule('docs/.vitepress/theme/markdownTypora.ts')
const keymap = await loadTsModule('docs/.vitepress/theme/typoraKeymap.ts')
const stats = await loadTsModule('docs/.vitepress/theme/markdownStats.ts')
const live = await loadTsModule('docs/.vitepress/theme/liveMarkdown.ts')

function createMd() {
  const md = new MarkdownIt({ html: false, linkify: true })
  typora.enableTyporaMarkdown(md)
  return md
}

test('LaTeX inline and display math render offline via KaTeX while protecting currency and XSS', () => {
  const md = createMd()
  const inlineHtml = md.render('质能方程 $E = mc^2$ 成立。')
  assert.match(inlineHtml, /class="paper-math-inline"/)
  assert.match(inlineHtml, /class="katex"/)

  const displayHtml = md.render('$$\n\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}\n$$')
  assert.match(displayHtml, /class="paper-math-block"/)
  assert.match(displayHtml, /class="katex-display"/)

  const singleLineDisplay = md.render('$$ a^2 + b^2 = c^2 $$')
  assert.match(singleLineDisplay, /class="paper-math-block"/)
  assert.match(singleLineDisplay, /class="katex-display"/)

  // Currency values must NOT be parsed as math — even on the exact same line as real inline math!
  const currency = md.render('预算 $100 到 $200，以及价格$50和$80元，转义 \\$x\\$。')
  assert.doesNotMatch(currency, /paper-math-inline/)
  assert.match(currency, /\$100/)
  assert.match(currency, /\$200/)

  const mixedLine = md.render('预算 $100 到 $200，质能方程 $E = mc^2$，以及无空格价格$50，公式$a^2 + b^2 = c^2$。')
  assert.match(mixedLine, /\$100 到 \$200/)
  assert.match(mixedLine, /\$50，公式/)
  assert.doesNotMatch(mixedLine, /katex-error/)
  assert.equal((mixedLine.match(/class="paper-math-inline"/g) || []).length, 2)

  // KaTeX trust:false blocks javascript: links inside \href (renders error text, zero <a> element)
  const xssMath = md.render('$\\href{javascript:alert(1)}{click}$')
  assert.doesNotMatch(xssMath, /<a\b/i)
  assert.doesNotMatch(xssMath, /href\s*=\s*["']?javascript:/i)

  assert.equal(typora.extractDisplayMathBlock('$$\nx + y\n$$'), 'x + y')
  assert.equal(typora.extractDisplayMathBlock('$$a+b$$'), 'a+b')
  assert.equal(typora.extractDisplayMathBlock('$a+b$'), null)
})

test('Typora inline extensions (highlight, sub, sup, safe HTML) preserve strikethrough and block XSS', () => {
  const md = createMd()
  const html = md.render('这是 ==重点高亮==，水是 H~2~O，平方是 x^2^，~~已删除~~，<u>下划线</u>，<kbd>Ctrl</kbd>+<kbd>K</kbd><br>换行。')
  assert.match(html, /<mark>重点高亮<\/mark>/)
  assert.match(html, /H<sub>2<\/sub>O/)
  assert.match(html, /x<sup>2<\/sup>/)
  assert.match(html, /<s>已删除<\/s>/)
  assert.match(html, /<u>下划线<\/u>/)
  assert.match(html, /<kbd>Ctrl<\/kbd>\+<kbd>K<\/kbd><br>/)

  const detailsHtml = md.render('<details open>\n<summary>展开详情</summary>\n\n隐藏内容 **加粗**\n\n</details>')
  assert.match(detailsHtml, /<details class="paper-details" open>/)
  assert.match(detailsHtml, /<summary>展开详情<\/summary>/)
  assert.match(detailsHtml, /<strong>加粗<\/strong>/)
  assert.match(detailsHtml, /<\/details>/)

  // Arbitrary tags or tags with attributes must stay escaped
  const unsafe = md.render('<script>alert(1)</script> <u onclick="alert(1)">x</u> <img src=x onerror=alert(1)>')
  assert.doesNotMatch(unsafe, /<script\b/i)
  assert.doesNotMatch(unsafe, /<u\s+onclick/i)
  assert.doesNotMatch(unsafe, /<img\b/i)
  assert.match(unsafe, /&lt;script&gt;/)
  assert.match(unsafe, /&lt;u onclick=/)
  assert.match(unsafe, /&lt;img src=x onerror=/)
})

test('All five GitHub/Typora Callouts render with semantic classes and icon titles', () => {
  const md = createMd()
  for (const kind of ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']) {
    const html = md.render(`> [!${kind}]\n> 内容 **重点**`)
    assert.match(html, new RegExp(`class="paper-callout paper-callout-${kind.toLowerCase()}"`))
    assert.match(html, /class="paper-callout-title"/)
    assert.match(html, /<strong>重点<\/strong>/)
    assert.doesNotMatch(html, new RegExp(`\\[!${kind}\\]`))
  }
})

test('Footnotes render superscript jump refs and bottom footnote section with back-links', () => {
  const md = createMd()
  const src = '纸间支持脚注[^intro]与多行说明[^multi]。\n\n[^intro]: 第一条 **说明**\n[^multi]: 第一行\n  第二行补充\n'
  const html = md.render(src)
  assert.match(html, /id="fnref-1"/)
  assert.match(html, /href="#fn-1"/)
  assert.match(html, /id="fnref-2"/)
  assert.match(html, /class="paper-footnotes"/)
  assert.match(html, /<li id="fn-1">第一条 <strong>说明<\/strong>/)
  assert.match(html, /第一行 第二行补充/)
  assert.match(html, /href="#fnref-1"[^>]*class="paper-hash-link paper-fn-back vp-raw"/)
})

test('[TOC] block lists document headings in full render and in liveMarkdown blocks without duplicating footnotes', () => {
  const md = createMd()
  const doc = '[TOC]\n\n# 概述\n\n正文[^a]\n\n## 子章节\n\n[^a]: 注释内容\n'
  const html = md.render(doc)
  assert.match(html, /class="paper-inline-toc"/)
  assert.match(html, />概述<\/a>/)
  assert.match(html, />子章节<\/a>/)

  // Visual editor block slicing must preserve TOC headings and NOT duplicate footnotes on every block
  const blocks = live.markdownBlocks(doc)
  const tocBlock = blocks.find(b => b.type === 'paper_toc_block')
  assert.ok(tocBlock, '[TOC] should produce a paper_toc_block')
  assert.match(tocBlock.html, />概述<\/a>/)
  assert.match(tocBlock.html, />子章节<\/a>/)
  for (const b of blocks) {
    assert.doesNotMatch(b.html, /class="paper-footnotes"/, 'single block must not duplicate footnote section')
  }
})

test('highlightCodeBlock highlights known languages offline and safely escapes unknown languages', () => {
  const tsHtml = typora.highlightCodeBlock('const x: number = 42', 'typescript')
  assert.match(tsHtml, /class="hljs-keyword"/)
  assert.match(tsHtml, /class="hljs-number"/)

  const pyHtml = typora.highlightCodeBlock('def hello(name):\n    return "hi"', 'py')
  assert.match(pyHtml, /class="hljs-keyword"/)
  assert.match(pyHtml, /class="hljs-string"/)

  const unknownHtml = typora.highlightCodeBlock('<tag attr="1">&</tag>', 'nonexistent-lang')
  assert.equal(unknownHtml, '&lt;tag attr=&quot;1&quot;&gt;&amp;&lt;/tag&gt;')
})

test('handleTyporaEnter continues lists, tasks, ordered lists, blockquotes and exits empty items', () => {
  const apply = (doc, edit) => doc.slice(0, edit.from) + edit.insert + doc.slice(edit.to)

  // Unordered list continuation & exit
  const bulletDoc = '- 第一项'
  const bulletEdit = keymap.handleTyporaEnter(bulletDoc, bulletDoc.length)
  assert.equal(apply(bulletDoc, bulletEdit), '- 第一项\n- ')
  const emptyBullet = '- '
  const exitBullet = keymap.handleTyporaEnter(emptyBullet, emptyBullet.length)
  assert.equal(apply(emptyBullet, exitBullet), '')

  // Ordered list increments number
  const ordDoc = '  2. 第二步'
  const ordEdit = keymap.handleTyporaEnter(ordDoc, ordDoc.length)
  assert.equal(apply(ordDoc, ordEdit), '  2. 第二步\n  3. ')
  const emptyOrd = '3. '
  assert.equal(apply(emptyOrd, keymap.handleTyporaEnter(emptyOrd, emptyOrd.length)), '')

  // Task list continues unchecked even after checked item
  const taskDoc = '- [x] 已完成任务'
  const taskEdit = keymap.handleTyporaEnter(taskDoc, taskDoc.length)
  assert.equal(apply(taskDoc, taskEdit), '- [x] 已完成任务\n- [ ] ')
  const emptyTask = '- [ ] '
  assert.equal(apply(emptyTask, keymap.handleTyporaEnter(emptyTask, emptyTask.length)), '')

  // Blockquote continuation & exit
  const quoteDoc = '> 引用文字'
  assert.equal(apply(quoteDoc, keymap.handleTyporaEnter(quoteDoc, quoteDoc.length)), '> 引用文字\n> ')
  const emptyQuote = '> '
  assert.equal(apply(emptyQuote, keymap.handleTyporaEnter(emptyQuote, emptyQuote.length)), '')

  // Ignores thematic break & fenced code blocks
  assert.equal(keymap.handleTyporaEnter('---', 3), null)
  const fenceDoc = '```md\n- 代码中的列表'
  assert.equal(keymap.handleTyporaEnter(fenceDoc, fenceDoc.length), null)
})

test('handleTyporaListIndent indents and outdents list items safely', () => {
  const apply = (doc, edit) => doc.slice(0, edit.from) + edit.insert + doc.slice(edit.to)

  const doc = '- 父项\n- 子项'
  const line2Start = doc.indexOf('- 子项')
  const indented = keymap.handleTyporaListIndent(doc, line2Start + 2, line2Start + 2, false)
  assert.equal(apply(doc, indented), '- 父项\n  - 子项')

  const nested = '- 父项\n  - 子项'
  const outdented = keymap.handleTyporaListIndent(nested, nested.length, nested.length, true)
  assert.equal(apply(nested, outdented), '- 父项\n- 子项')

  // Plain prose returns null
  assert.equal(keymap.handleTyporaListIndent('普通段落文本', 2, 2, false), null)
})

test('smartPasteUrl wraps selection with URL and ignores non-URL or code blocks', () => {
  const apply = (doc, edit) => doc.slice(0, edit.from) + edit.insert + doc.slice(edit.to)
  const doc = '请看 纸间文档 介绍'
  const from = doc.indexOf('纸间文档')
  const to = from + '纸间文档'.length

  const edit = keymap.smartPasteUrl(doc, from, to, 'https://example.com/guide')
  assert.equal(apply(doc, edit), '请看 [纸间文档](https://example.com/guide) 介绍')

  // Non-URL clipboard text returns null
  assert.equal(keymap.smartPasteUrl(doc, from, to, 'not a url'), null)
  // Empty selection returns null
  assert.equal(keymap.smartPasteUrl(doc, from, from, 'https://example.com'), null)
  // Inside code fence returns null
  const fenced = '```\n纸间文档\n```'
  assert.equal(keymap.smartPasteUrl(fenced, 4, 8, 'https://example.com'), null)
})

test('applyHeadingLevel sets H1–H6 and Ctrl+0 clears back to paragraph', () => {
  const apply = (doc, edit) => doc.slice(0, edit.from) + edit.insert + doc.slice(edit.to)
  let doc = '普通段落'
  doc = apply(doc, keymap.applyHeadingLevel(doc, 0, 0, 2))
  assert.equal(doc, '## 普通段落')
  doc = apply(doc, keymap.applyHeadingLevel(doc, 3, 3, 5))
  assert.equal(doc, '##### 普通段落')
  doc = apply(doc, keymap.applyHeadingLevel(doc, 0, 0, 0))
  assert.equal(doc, '普通段落')
})

test('toggleTyporaInline wraps and unwraps highlight, underline, sub, sup and inline math without stacking', () => {
  const apply = (doc, edit) => doc.slice(0, edit.from) + edit.insert + doc.slice(edit.to)

  for (const [kind, open, close] of [
    ['highlight', '==', '=='],
    ['underline', '<u>', '</u>'],
    ['sub', '~', '~'],
    ['sup', '^', '^'],
    ['inline-math', '$', '$']
  ]) {
    const base = '文本 关键 结尾'
    const from = base.indexOf('关键')
    const to = from + 2
    const wrappedEdit = keymap.toggleTyporaInline(base, from, to, kind)
    const wrapped = apply(base, wrappedEdit)
    assert.equal(wrapped, `文本 ${open}关键${close} 结尾`, `${kind} wrap`)
    // Toggle again on the inner selected range unwraps cleanly
    const unwrappedEdit = keymap.toggleTyporaInline(wrapped, wrappedEdit.selectionStart, wrappedEdit.selectionEnd, kind)
    assert.equal(apply(wrapped, unwrappedEdit), base, `${kind} unwrap outer`)
    // Toggle again when selection includes the markers also unwraps cleanly
    const fullFrom = wrapped.indexOf(open)
    const fullTo = fullFrom + open.length + 2 + close.length
    const unwrapSelf = keymap.toggleTyporaInline(wrapped, fullFrom, fullTo, kind)
    assert.equal(apply(wrapped, unwrapSelf), base, `${kind} unwrap inner`)
  }
})

test('computeDocumentStats counts CJK, Latin words, lines and reading time accurately', () => {
  const empty = stats.computeDocumentStats('')
  assert.deepEqual(empty, { chars: 0, charsNoSpace: 0, cjkChars: 0, words: 0, lines: 1, readingMinutes: 0 })

  const sample = '# 纸间测试\n\nHello world! 访问 [官网](https://example.com/very/long/path)。'
  const res = stats.computeDocumentStats(sample)
  assert.equal(res.lines, 3)
  assert.equal(res.cjkChars, 8) // 纸间测试访问官网
  assert.equal(res.words, 10) // 8 CJK + Hello + world (URL stripped!)
  assert.equal(res.readingMinutes, 1)
})

test('toggleMarkdownTaskAtIndex toggles only real task items while skipping code fences', () => {
  const doc = [
    '- [ ] 任务零',
    '```md',
    '- [ ] 代码块内的假任务',
    '```',
    '- [X] 任务一',
    '  - [ ] 子任务二'
  ].join('\r\n')

  const t0 = stats.toggleMarkdownTaskAtIndex(doc, 0)
  assert.ok(t0.includes('- [x] 任务零\r\n'))
  assert.ok(t0.includes('- [ ] 代码块内的假任务\r\n'))

  const t1 = stats.toggleMarkdownTaskAtIndex(doc, 1)
  assert.ok(t1.includes('- [ ] 任务一\r\n'))
  assert.ok(t1.includes('- [ ] 代码块内的假任务\r\n'))

  const t2 = stats.toggleMarkdownTaskAtIndex(doc, 2)
  assert.ok(t2.includes('  - [x] 子任务二'))

  assert.equal(stats.toggleMarkdownTaskAtIndex(doc, 3), null)
  assert.equal(stats.toggleMarkdownTaskAtIndex(doc, -1), null)
})
