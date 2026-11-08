import assert from 'node:assert/strict'
import test from 'node:test'
import { cleanWorkflow, newLibraryEntry, normalizeEntry, parseLibraryImport, mergeLibraryEntries, libraryExport, validateMappings, withNegativePrompt, linkedLibraryPrompts, prepareLibraryWorkflow } from '../src/lib/templateLibrary.ts'

const graph = JSON.stringify({
  '1': { class_type: 'LoadImage', inputs: { image: 'old-photo.png' } },
  '2': { class_type: 'LoadImage', inputs: { image: 'data:image/png;base64,private' } },
  '3': { class_type: 'CLIPTextEncode', inputs: { text: 'portrait' } },
})
const entry = () => ({ ...newLibraryEntry('workflow'), title: '电商换装', content: graph, tags: ['单人', '电商'] })

test('API and canvas workflows are recognized; unrelated JSON is rejected', () => {
  assert.equal(cleanWorkflow(graph).format, 'api')
  assert.equal(cleanWorkflow('{"nodes":[],"links":[]}').format, 'canvas')
  assert.throws(() => cleanWorkflow('{"hello":true}'))
  assert.throws(() => cleanWorkflow('[]'))
})
test('library backups round trip metadata and mappings without uploaded photos or credentials', () => {
  const item = entry(); item.mappings.portraitNodeId = '1'
  const backup = libraryExport([item], 'workflow')
  const restored = parseLibraryImport(backup, 'workflow', 'backup.json').entries[0]
  assert.equal(restored.title, item.title)
  assert.deepEqual(restored.tags, item.tags)
  assert.equal(restored.mappings.portraitNodeId, '1')
  assert.ok(!backup.includes('old-photo.png'))
  assert.ok(!backup.includes('data:image'))
  const secretGraph = JSON.stringify({ '1': { class_type: 'Example', inputs: { api_key: 'private-value', image: '', password: 'hidden' } } })
  assert.ok(!cleanWorkflow(secretGraph).content.includes('private-value'))
  assert.ok(!cleanWorkflow(secretGraph).content.includes('hidden'))
})
test('duplicate image mapping and missing nodes are blocked', () => {
  const item = entry(); item.mappings.portraitNodeId = '1'; item.mappings.poseNodeId = '1'
  assert.match(validateMappings(graph, item.mappings), /同一个/)
  item.mappings.poseNodeId = '99'
  assert.match(validateMappings(graph, item.mappings), /不存在/)
  item.mappings.poseNodeId = '2'; item.mappings.promptNodeId = '3'
  assert.equal(validateMappings(graph, item.mappings), null)
})
test('replace preserves original ID; copies receive unique IDs and titles', () => {
  const original = entry(); const incoming = { ...entry(), description: '新版' }
  const replaced = mergeLibraryEntries([original], [incoming], 'replace')
  assert.equal(replaced.length, 1)
  assert.equal(replaced[0].id, original.id)
  assert.equal(replaced[0].description, '新版')
  const copied = mergeLibraryEntries([original], [incoming, incoming], 'copy')
  assert.equal(new Set(copied.map(e => e.id)).size, 3)
  assert.equal(new Set(copied.map(e => e.title)).size, 3)
})
test('wrong-library backups and malformed entries cannot replace stored records', () => {
  assert.throws(() => parseLibraryImport(libraryExport([entry()], 'workflow'), 'prompt', 'backup.json'))
  assert.throws(() => normalizeEntry({ kind: 'prompt', title: '', content: 'abc' }, 'prompt'))
  assert.throws(() => parseLibraryImport('{"schema":"pose-atlas-library","version":9,"entries":[]}', 'workflow', 'backup.json'))
})
test('TXT import and prompt JSON backup preserve negative text and associated template', () => {
  const parsed = parseLibraryImport('a full body studio photograph', 'prompt', '产品摄影.txt')
  assert.equal(parsed.entries[0].title, '产品摄影')
  const prompt = { ...parsed.entries[0], negative: 'blurry', workflowId: 'workflow-test', model: 'Qwen' }
  const restored = parseLibraryImport(libraryExport([prompt], 'prompt'), 'prompt', 'prompt.json').entries[0]
  assert.equal(restored.negative, 'blurry')
  assert.equal(restored.workflowId, 'workflow-test')
})
test('negative prompt supports Qwen combined encoder and standalone negative nodes', () => {
  const qwen = JSON.stringify({ '4': { class_type: 'TextEncodeQwenImage21', inputs: { prompt: 'positive', negative_prompt: 'old' } } })
  const output = JSON.parse(withNegativePrompt(qwen, '4', 'new'))
  assert.equal(output['4'].inputs.negative_prompt, 'new')
  assert.equal(output['4'].inputs.prompt, 'positive')
  const separate = JSON.stringify({ '1': { inputs: { text: 'positive' } }, '2': { _meta: { title: 'Negative Prompt' }, inputs: { text: 'old' } } })
  assert.equal(JSON.parse(withNegativePrompt(separate, '1', 'new'))['2'].inputs.text, 'new')
  assert.throws(() => withNegativePrompt(graph, '3', 'new'), /反向/)
})
test('workflow selection applies newest associated prompt and preserves independent image mappings', () => {
  const wf = entry(); wf.mappings.portraitNodeId = '1'; wf.mappings.poseNodeId = '2'
  const older = { ...newLibraryEntry('prompt'), title: 'older', content: 'old', workflowId: wf.id, updatedAt: 100 }
  const newer = { ...older, id: 'newer', title: 'newer', content: 'new portrait', updatedAt: 200 }
  const unrelated = { ...newer, id: 'unrelated', workflowId: 'other', updatedAt: 300 }
  const prompts = linkedLibraryPrompts([wf, older, unrelated, newer], wf.id)
  assert.deepEqual(prompts.map(e => e.id), [newer.id, older.id])
  const applied = prepareLibraryWorkflow(wf, prompts[0])
  assert.equal(applied.libraryWorkflowId, wf.id)
  assert.equal(applied.libraryPromptId, newer.id)
  assert.equal(applied.portraitNodeId, '1')
  assert.equal(applied.poseNodeId, '2')
  assert.equal(applied.promptNodeId, 'none')
  assert.equal(JSON.parse(applied.workflowJson)['3'].inputs.text, newer.content)
  assert.equal(JSON.parse(wf.content)['3'].inputs.text, 'portrait')
  const original = prepareLibraryWorkflow(wf)
  assert.equal(original.libraryPromptId, undefined)
  assert.equal(JSON.parse(original.workflowJson)['3'].inputs.text, 'portrait')
  assert.throws(() => prepareLibraryWorkflow(wf, unrelated), /关联/)
})
