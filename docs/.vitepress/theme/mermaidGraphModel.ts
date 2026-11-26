/**
 * Bidirectional structured model for Mermaid flowchart / graph diagrams.
 * Parses standard flowchart syntax into editable nodes & edges and serializes back cleanly.
 */

export type FlowDirection = 'TD' | 'LR' | 'BT' | 'RL'
export type NodeShape = 'rect' | 'round' | 'diamond' | 'stadium' | 'circle' | 'cylinder'
export type EdgeStyle = 'solid' | 'dashed' | 'thick'

export interface MermaidFlowNode {
  id: string
  label: string
  shape: NodeShape
}

export interface MermaidFlowEdge {
  from: string
  to: string
  style: EdgeStyle
  label: string
}

export interface MermaidFlowGraph {
  direction: FlowDirection
  nodes: MermaidFlowNode[]
  edges: MermaidFlowEdge[]
}

const NODE_TOKEN_RE = /^([A-Za-z0-9_]+)(?:\(\(\s*([\s\S]*?)\s*\)\)|\(\[\s*([\s\S]*?)\s*\]\)|\[\(\s*([\s\S]*?)\s*\)\]|\[([\s\S]*?)\]|\(([\s\S]*?)\)|\{([\s\S]*?)\})?$/

function unquoteLabel(raw: string): string {
  const trimmed = raw.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"')
  }
  return trimmed
}

function parseNodeToken(token: string): MermaidFlowNode | null {
  const m = NODE_TOKEN_RE.exec(token.trim())
  if (!m) return null
  const id = m[1]
  if (m[2] !== undefined) return { id, label: unquoteLabel(m[2]), shape: 'circle' }
  if (m[3] !== undefined) return { id, label: unquoteLabel(m[3]), shape: 'stadium' }
  if (m[4] !== undefined) return { id, label: unquoteLabel(m[4]), shape: 'cylinder' }
  if (m[5] !== undefined) return { id, label: unquoteLabel(m[5]), shape: 'rect' }
  if (m[6] !== undefined) return { id, label: unquoteLabel(m[6]), shape: 'round' }
  if (m[7] !== undefined) return { id, label: unquoteLabel(m[7]), shape: 'diamond' }
  return { id, label: id, shape: 'rect' }
}

function hasExplicitShape(token: string): boolean {
  return /[(\[{]/.test(token)
}

/** Parse Mermaid flowchart/graph code into a visual graph, or null if not a flowchart. */
export function parseFlowchartMermaid(code: string): MermaidFlowGraph | null {
  const lines = (code || '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('%%'))
  if (!lines.length) {
    return {
      direction: 'TD',
      nodes: [
        { id: 'A', label: '开始节点', shape: 'stadium' },
        { id: 'B', label: '处理步骤', shape: 'rect' }
      ],
      edges: [{ from: 'A', to: 'B', style: 'solid', label: '' }]
    }
  }
  const header = /^(?:flowchart|graph)\s+(TD|TB|LR|BT|RL)\b/i.exec(lines[0])
  if (!header) return null
  const rawDir = header[1].toUpperCase()
  const direction: FlowDirection = rawDir === 'TB' ? 'TD' : (rawDir as FlowDirection)

  const nodeMap = new Map<string, MermaidFlowNode>()
  const edges: MermaidFlowEdge[] = []

  const upsertNode = (token: string): MermaidFlowNode | null => {
    const parsed = parseNodeToken(token)
    if (!parsed) return null
    const existing = nodeMap.get(parsed.id)
    if (!existing) {
      nodeMap.set(parsed.id, parsed)
      return parsed
    }
    if (hasExplicitShape(token)) {
      existing.label = parsed.label
      existing.shape = parsed.shape
    }
    return existing
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].replace(/;$/, '').trim()
    if (!line || /^(?:subgraph|end|style|classDef|class|linkStyle|click)\b/i.test(line)) continue

    // Match edge: <left> <arrow> <right>
    // Supports: -->, -.->, ==>, -->|label|, -.->|label|, ==>|label|, -- label -->
    const pipeEdge = /^(.+?)\s*(-->|-\.->|==>)\s*(?:\|([^|]*)\|)?\s*(.+)$/.exec(line)
    if (pipeEdge) {
      const left = upsertNode(pipeEdge[1])
      const right = upsertNode(pipeEdge[4])
      if (left && right) {
        const style: EdgeStyle = pipeEdge[2] === '-.->' ? 'dashed' : pipeEdge[2] === '==>' ? 'thick' : 'solid'
        edges.push({ from: left.id, to: right.id, style, label: unquoteLabel(pipeEdge[3] || '') })
      }
      continue
    }
    const inlineLabelEdge = /^(.+?)\s*--\s*([^-]+?)\s*-->\s*(.+)$/.exec(line)
    if (inlineLabelEdge) {
      const left = upsertNode(inlineLabelEdge[1])
      const right = upsertNode(inlineLabelEdge[3])
      if (left && right) {
        edges.push({ from: left.id, to: right.id, style: 'solid', label: unquoteLabel(inlineLabelEdge[2]) })
      }
      continue
    }
    upsertNode(line)
  }

  return {
    direction,
    nodes: [...nodeMap.values()],
    edges
  }
}

function escapeMermaidLabel(label: string): string {
  return (label || '').replace(/[\r\n]+/g, ' ').replace(/"/g, "'").trim() || '节点'
}

function formatNode(node: MermaidFlowNode): string {
  const text = escapeMermaidLabel(node.label)
  switch (node.shape) {
    case 'round': return `${node.id}("${text}")`
    case 'diamond': return `${node.id}{"${text}"}`
    case 'stadium': return `${node.id}(["${text}"])`
    case 'circle': return `${node.id}(("${text}"))`
    case 'cylinder': return `${node.id}[("${text}")]`
    default: return `${node.id}["${text}"]`
  }
}

/** Serialize a structured flowchart graph back into clean Mermaid syntax. */
export function serializeFlowchartMermaid(graph: MermaidFlowGraph): string {
  const lines: string[] = [`flowchart ${graph.direction}`]
  const declared = new Set<string>()
  for (const node of graph.nodes) {
    lines.push(`    ${formatNode(node)}`)
    declared.add(node.id)
  }
  for (const edge of graph.edges) {
    if (!declared.has(edge.from) || !declared.has(edge.to)) continue
    const arrow = edge.style === 'dashed' ? '-.->' : edge.style === 'thick' ? '==>' : '-->'
    const cleanLabel = edge.label.replace(/[|\r\n]+/g, ' ').trim()
    if (cleanLabel) {
      lines.push(`    ${edge.from} ${arrow}|${cleanLabel}| ${edge.to}`)
    } else {
      lines.push(`    ${edge.from} ${arrow} ${edge.to}`)
    }
  }
  return lines.join('\n')
}

export function nextNodeId(nodes: readonly MermaidFlowNode[]): string {
  const used = new Set(nodes.map(n => n.id))
  for (let code = 65; code <= 90; code++) {
    const letter = String.fromCharCode(code)
    if (!used.has(letter)) return letter
  }
  let idx = 1
  while (used.has(`N${idx}`)) idx++
  return `N${idx}`
}
