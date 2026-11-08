export const LIBRARY_KEY = 'pose_atlas_template_library_v1'
export const DEFAULT_TAGS = ['单人', '双人', '多人', '换装', '姿势迁移', '电商']
export type LibraryKind = 'workflow' | 'prompt'
export type MappingKey = 'portraitNodeId' | 'portraitBNodeId' | 'costumeNodeId' | 'poseNodeId' | 'stitchedNodeId' | 'promptNodeId'
export type LibraryMappings = Record<MappingKey, string>
export interface LibraryEntry {
  id: string
  kind: LibraryKind
  title: string
  tags: string[]
  description: string
  content: string
  negative: string
  model: string
  workflowId: string
  mappings: LibraryMappings
  createdAt: number
  updatedAt: number
}
export const EMPTY_MAPPINGS: LibraryMappings = { portraitNodeId: 'none', portraitBNodeId: 'none', costumeNodeId: 'none', poseNodeId: 'none', stitchedNodeId: 'none', promptNodeId: 'none' }
export const MAPPING_LABELS: Record<MappingKey, string> = { portraitNodeId: '人像', portraitBNodeId: '人物 B', costumeNodeId: '服装', poseNodeId: '姿势', stitchedNodeId: '参考拼图', promptNodeId: '正向提示词' }
export function newLibraryEntry(kind: LibraryKind): LibraryEntry {
  return { id: crypto.randomUUID(), kind, title: '', tags: [], description: '', content: '', negative: '', model: '', workflowId: '', mappings: { ...EMPTY_MAPPINGS }, createdAt: Date.now(), updatedAt: Date.now() }
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Library exports contain configuration, never embedded photos or credentials. */
export function cleanWorkflow(json: string): { content: string; format: 'api' | 'canvas' } {
  let value: unknown
  try { value = JSON.parse(json) } catch { throw new Error('工作流不是有效 JSON') }
  if (!object(value)) throw new Error('工作流必须是 JSON 对象')
  const format = Array.isArray(value.nodes) && Array.isArray(value.links) ? 'canvas' : 'api'
  if (format === 'api' && (!Object.keys(value).length || !Object.values(value).every(n => object(n) && typeof n.class_type === 'string' && object(n.inputs)))) throw new Error('未识别为 ComfyUI API 或画布工作流')
  function scrub(v: unknown, key = ''): unknown {
    if (/^(api[-_]?key|authorization|access[-_]?token|token|password|secret|headers)$/i.test(key)) return ''
    if (typeof v === 'string') {
      if (/^(data:image\/|blob:)/i.test(v)) return ''
      if (/(?:sk-[a-zA-Z0-9]{20,}|AIza[a-zA-Z0-9]{20,})/.test(v)) throw new Error('文件包含疑似真实密钥，请移除后再导入')
      if (/^(?:[a-z]:[\\/]|\\\\|\/(?:home|Users)\/)/i.test(v)) return ''
      if (key === 'image' || key === 'mask') return ''
      return v
    }
    if (Array.isArray(v)) return v.map(x => scrub(x))
    if (object(v)) return Object.fromEntries(Object.entries(v).filter(([k]) => !['extra', 'client_config'].includes(k)).map(([k, x]) => [k, scrub(x, k)]))
    return v
  }
  return { content: JSON.stringify(scrub(value), null, 2), format }
}
export function validateMappings(content: string, mappings: LibraryMappings): string | null {
  const { format } = cleanWorkflow(content)
  if (format === 'canvas') return null
  const nodes = JSON.parse(content)
  const used = new Set<string>()
  for (const [key, id] of Object.entries(mappings)) {
    if (id === 'none') continue
    const node = nodes[id]
    if (!node) return `${MAPPING_LABELS[key as MappingKey]}节点不存在`
    if (key === 'promptNodeId') {
      if (!['prompt', 'text', 'string', 'positive'].some(field => typeof node.inputs[field] === 'string')) return '请选择文本提示词节点'
    } else {
      if (node.class_type !== 'LoadImage' && typeof node.inputs.image !== 'string') return '请选择图片输入节点'
      if (used.has(id)) return '不同参考图不能绑定同一个图片节点'
      used.add(id)
    }
  }
  return null
}
export function normalizeEntry(value: unknown, kind: LibraryKind): LibraryEntry {
  if (!object(value) || value.kind !== kind || typeof value.title !== 'string' || !value.title.trim() || typeof value.content !== 'string') throw new Error('导入条目缺少标题或内容，或所属库不匹配')
  const entry = newLibraryEntry(kind)
  entry.id = typeof value.id === 'string' && value.id.length < 120 ? value.id : entry.id
  entry.title = value.title.trim().slice(0, 200)
  entry.tags = Array.isArray(value.tags) ? [...new Set(value.tags.filter((t): t is string => typeof t === 'string' && !!t.trim()).map(t => t.trim().slice(0, 50)))] : []
  for (const key of ['description', 'negative', 'model', 'workflowId'] as const) entry[key] = typeof value[key] === 'string' ? value[key] : ''
  entry.content = kind === 'workflow' ? cleanWorkflow(value.content).content : value.content
  if (!entry.content.trim()) throw new Error('内容不能为空')
  if (object(value.mappings)) for (const key of Object.keys(EMPTY_MAPPINGS) as MappingKey[]) if (typeof value.mappings[key] === 'string') entry.mappings[key] = value.mappings[key]
  if (kind === 'workflow') { const error = validateMappings(entry.content, entry.mappings); if (error) throw new Error(error) }
  for (const key of ['createdAt', 'updatedAt'] as const) if (typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] > 0 && value[key] <= 8640000000000000) entry[key] = value[key]
  return entry
}
export function parseLibraryImport(text: string, kind: LibraryKind, filename: string): { entries: LibraryEntry[]; raw: boolean } {
  if (text.length > 10 * 1024 * 1024) throw new Error('文件不能超过 10 MB')
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch {
    if (kind !== 'prompt' || /\.json$/i.test(filename)) throw new Error('JSON 文件格式错误')
    const entry = newLibraryEntry(kind); entry.title = filename.replace(/\.[^.]+$/, ''); entry.content = text
    if (!text.trim()) throw new Error('提示词内容不能为空')
    return { entries: [entry], raw: true }
  }
  if (object(parsed) && parsed.schema === 'pose-atlas-library' && parsed.version !== 1) throw new Error('不支持此备份版本')
  if (object(parsed) && parsed.schema === 'pose-atlas-library' && Array.isArray(parsed.entries)) {
    if (parsed.kind !== kind) throw new Error('备份类型与当前管理页不匹配')
    if (parsed.entries.length > 1000) throw new Error('一次最多导入 1000 条')
    return { entries: parsed.entries.map(v => normalizeEntry(v, kind)), raw: false }
  }
  if (kind !== 'workflow') throw new Error('请导入提示词库导出的 JSON 或 TXT 文件')
  const entry = newLibraryEntry(kind); entry.title = filename.replace(/\.[^.]+$/, ''); entry.content = cleanWorkflow(text).content
  return { entries: [entry], raw: true }
}
export function mergeLibraryEntries(current: LibraryEntry[], incoming: LibraryEntry[], mode: 'replace' | 'copy'): LibraryEntry[] {
  const next = [...current]
  for (const item of incoming) {
    const index = next.findIndex(e => e.kind === item.kind && (e.id === item.id || e.title === item.title))
    if (index >= 0 && mode === 'replace') next[index] = { ...item, id: next[index].id, createdAt: next[index].createdAt, updatedAt: Date.now() }
    else {
      let title = item.title
      let suffix = 1
      while (next.some(e => e.kind === item.kind && e.title === title)) title = `${item.title}（副本 ${suffix++}）`
      const copy = index >= 0 || next.some(e => e.id === item.id)
      next.push(copy ? { ...item, id: crypto.randomUUID(), title, createdAt: Date.now(), updatedAt: Date.now() } : item)
    }
  }
  return next
}
export function libraryExport(entries: LibraryEntry[], kind: LibraryKind): string {
  return JSON.stringify({ schema: 'pose-atlas-library', version: 1, kind, entries: entries.map(e => normalizeEntry(e, kind)) }, null, 2)
}
export function withNegativePrompt(content: string, positiveId: string, negative: string): string {
  if (!negative.trim()) return content
  const nodes = JSON.parse(content)
  const positive = nodes[positiveId]
  for (const field of ['negative_prompt', 'negative']) {
    if (typeof positive?.inputs?.[field] === 'string') {
      positive.inputs[field] = negative
      return JSON.stringify(nodes, null, 2)
    }
  }
  const matches = Object.entries(nodes).filter(([id, node]) => id !== positiveId && object(node) && object(node.inputs) && /negative|反向|负面/i.test(String(object(node._meta) ? node._meta.title : '')))
  for (const [, node] of matches) {
    if (!object(node) || !object(node.inputs)) continue
    for (const field of ['text', 'prompt', 'string', 'negative_prompt']) if (typeof node.inputs[field] === 'string') {
      node.inputs[field] = negative
      return JSON.stringify(nodes, null, 2)
    }
  }
  throw new Error('未识别到反向提示词输入，请清空反向内容或选择含反向输入的工作流')
}
export function linkedLibraryPrompts(entries: LibraryEntry[], workflowId: string): LibraryEntry[] {
  return entries.filter(e => e.kind === 'prompt' && e.workflowId === workflowId).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
}
export function prepareLibraryWorkflow(entry: LibraryEntry, prompt?: LibraryEntry) {
  const cleaned = cleanWorkflow(entry.content)
  if (entry.kind !== 'workflow' || cleaned.format !== 'api') throw new Error('请先在 ComfyUI 中导出 API 格式，再替换此模板文件')
  const problem = validateMappings(cleaned.content, entry.mappings)
  if (problem) throw new Error(problem)
  let workflowJson = cleaned.content
  let promptNodeId = entry.mappings.promptNodeId
  if (prompt) {
    if (prompt.kind !== 'prompt' || prompt.workflowId !== entry.id) throw new Error('提示词与工作流关联不匹配')
    const nodes = JSON.parse(workflowJson)
    const candidates = Object.entries(nodes).flatMap(([id, value]) => {
      if (!object(value) || !object(value.inputs)) return []
      const field = ['prompt', 'text', 'string', 'positive'].find(key => typeof (value.inputs as Record<string, unknown>)[key] === 'string')
      return field ? [{ id, field, title: String(object(value._meta) ? value._meta.title || '' : '') }] : []
    })
    const positive = candidates.find(n => n.id === promptNodeId) || candidates.find(n => !/negative|反向|负面/i.test(n.title))
    if (!positive) throw new Error('工作流中没有可写入的正向提示词节点')
    nodes[positive.id].inputs[positive.field] = prompt.content
    workflowJson = withNegativePrompt(JSON.stringify(nodes, null, 2), positive.id, prompt.negative)
    promptNodeId = 'none'
  }
  return { ...entry.mappings, workflowPreset: 'custom' as const, workflowJson, promptNodeId, randomizeSeed: false, parameterOverrides: undefined, libraryWorkflowId: entry.id, libraryPromptId: prompt?.id }
}
export function downloadLibraryFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = name.replace(/[<>:"/\\|?*]/g, '_'); a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
