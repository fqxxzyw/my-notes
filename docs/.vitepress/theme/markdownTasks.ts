import type MarkdownIt from 'markdown-it'

/** Render standard task markers as non-interactive checkboxes in both views. */
export function enableTaskMarkers(markdown: MarkdownIt): void {
  markdown.core.ruler.after('inline', 'paper-task-markers', state => {
    const stack: string[] = []
    for (const token of state.tokens) {
      if (token.nesting === -1) stack.pop()
      if (token.type === 'inline' && stack.includes('list_item_open') && token.children?.length) {
        const first = token.children[0]
        const match = first.type === 'text' ? /^\[([ xX])\](?:[ \t]+|$)/.exec(first.content) : null
        if (match) {
          first.content = first.content.slice(match[0].length)
          const checked = match[1].toLowerCase() === 'x'
          const box = new state.Token('html_inline', '', 0)
          box.content = `<input type="checkbox" disabled aria-label="${checked ? '任务已完成' : '任务未完成'}"${checked ? ' checked' : ''}> `
          token.children.unshift(box)
        }
      }
      if (token.nesting === 1) stack.push(token.type)
    }
  })
}
