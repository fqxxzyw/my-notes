import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { java } from '@codemirror/lang-java'
import { json } from '@codemirror/lang-json'
import { cpp } from '@codemirror/lang-cpp'
import { sql } from '@codemirror/lang-sql'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'

const languages = {
  js: javascript().language, javascript: javascript().language, jsx: javascript({ jsx: true }).language,
  ts: javascript({ typescript: true }).language, typescript: javascript({ typescript: true }).language,
  tsx: javascript({ typescript: true, jsx: true }).language,
  py: python().language, python: python().language, java: java().language,
  json: json().language, c: cpp().language, cpp: cpp().language, 'c++': cpp().language,
  sql: sql().language, css: css().language, html: html().language, xml: html().language
}

export const markdownEditorLanguage = markdown({
  base: markdownLanguage,
  codeLanguages: info => languages[info.toLowerCase().trim().split(/\s+/)[0]] || null
})

// The same code palette is used in both modes; Markdown marks are coloured
// only in source mode so rendered prose keeps the application's typography.
const codeStyles = [
  { tag: tags.keyword, color: 'var(--paper-code-keyword)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--paper-code-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--paper-code-number)' },
  { tag: tags.comment, color: 'var(--paper-code-comment)', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--paper-code-function)' },
  { tag: [tags.typeName, tags.className], color: 'var(--paper-code-type)' },
  { tag: tags.operator, color: 'var(--paper-code-operator)' },
  { tag: tags.propertyName, color: 'var(--paper-code-property)' }
]
export const visualCodeHighlight = HighlightStyle.define(codeStyles)
export const sourceMarkdownHighlight = HighlightStyle.define([
  ...codeStyles,
  { tag: tags.heading, color: 'var(--paper-syntax-heading)', fontWeight: '700' },
  { tag: tags.processingInstruction, color: 'var(--paper-syntax-marker)', fontWeight: '600' },
  { tag: tags.labelName, color: 'var(--paper-syntax-label)' },
  { tag: tags.link, color: 'var(--paper-syntax-link)' },
  { tag: tags.url, color: 'var(--paper-syntax-url)', textDecoration: 'underline' },
  { tag: tags.strong, color: 'var(--paper-syntax-emphasis)', fontWeight: '700' },
  { tag: tags.emphasis, color: 'var(--paper-syntax-emphasis)', fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.monospace, color: 'var(--paper-syntax-inline-code)' },
  { tag: tags.quote, color: 'var(--paper-syntax-quote)' },
  { tag: tags.contentSeparator, color: 'var(--paper-syntax-marker)' },
  { tag: [tags.escape, tags.character], color: 'var(--paper-syntax-label)' }
])
