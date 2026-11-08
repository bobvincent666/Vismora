import assert from 'node:assert/strict'
import test, { before, after } from 'node:test'
import { createServer } from 'vite'
import { recipeBackup } from '../src/lib/recipeImages.ts'

let server, service
before(async () => {
  server = await createServer({server: {middlewareMode: true}, appType: 'custom'})
  service = await server.ssrLoadModule('/src/services/aiGenerator.ts')
})
after(async () => { await server?.close() })

const workflow = {
  '4': {class_type: 'TextEncodeQwenImage21', inputs: {prompt: 'Keep workflow prompt', 'images.image_1': ['11', 0], 'images.image_2': ['12', 0], 'images.image_3': ['13', 0]}, _meta: {title: '三图双人'}},
  '11': {class_type: 'LoadImage', inputs: {image: 'pose.png'}, _meta: {title: '图1：姿势参考 (Pose)'}},
  '12': {class_type: 'LoadImage', inputs: {image: 'left.png'}, _meta: {title: '图2：左侧人物A（人像参考）'}},
  '13': {class_type: 'LoadImage', inputs: {image: 'right.png'}, _meta: {title: '图3：右侧人物B（人像参考）'}},
}
const ref = (text) => ({原图: `data:image/png;base64,${btoa(text)}`, 缩略图: '', source: 'upload'})
const recipe = {portrait: ref('person-a'), portraitB: ref('person-b'), pose: ref('pose'), costume: null}
const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'content-type': 'application/json'}})

test('lightweight localStorage backup excludes uploaded person B photo', () => {
  assert.equal(recipeBackup(recipe).portraitB, null)
  assert.equal(recipeBackup({portrait: null, costume: null, pose: null}).portraitB, null)
})

test('recognizes two identities without assigning the male portrait to clothing', () => {
  assert.deepEqual(service.autoDetectComfyMappings(JSON.stringify(workflow)), {
    promptNodeId: '4', portraitNodeId: '12', portraitBNodeId: '13', costumeNodeId: 'none', poseNodeId: '11', stitchedNodeId: 'none',
  })
  const old = structuredClone(workflow)
  old['13']._meta.title = '图3：服装参考 (Clothing)'
  const mapped = service.autoDetectComfyMappings(JSON.stringify(old))
  assert.equal(mapped.portraitBNodeId, 'none')
  assert.equal(mapped.costumeNodeId, '13')
  const single = {'12': {...workflow['12'], _meta: {title: '男性头像'}}}
  const singleMapped = service.autoDetectComfyMappings(JSON.stringify(single))
  assert.equal(singleMapped.portraitNodeId, '12')
  assert.equal(singleMapped.portraitBNodeId, 'none')
})

async function captureSubmission(recipe, overrides = {}) {
  const original = globalThis.fetch
  const uploads = new Map()
  let submitted
  const selectedWorkflow = overrides.workflowJson || JSON.stringify(workflow)
  const map = service.autoDetectComfyMappings(selectedWorkflow)
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname
    if (path === '/system_stats') return json({system: {}})
    if (path.startsWith('/object_info/')) {
      const cls = path.split('/').pop()
      return json({[cls]: {input: {required: cls === 'LoadImage' ? {image: [['fixture.png']]} : {}}}})
    }
    if (path === '/upload/image') {
      const file = init.body.get('image')
      uploads.set(file.name, await file.text())
      return json({name: file.name})
    }
    if (path === '/prompt') {
      submitted = JSON.parse(init.body).prompt
      return json({error: {type: 'test_capture', message: 'TEST_CAPTURED'}}, 400)
    }
    throw Error('Unexpected request ' + path)
  }
  let error
  try {
    await service.generateCharacterImage({recipe, prompt: 'Do not overwrite file prompt', config: {
      activeProvider: 'comfyui', providers: {comfyui: {apiKey: '', baseUrl: 'http://127.0.0.1:9999', model: 'custom', customModel: 'test'}},
      comfyuiParams: {...map, promptNodeId: 'none', workflowJson: JSON.stringify(workflow), randomizeSeed: false, ...overrides},
    }})
  } catch (e) { error = e }
  finally { globalThis.fetch = original }
  return {uploads, submitted, error}
}

test('the actual submission uses person B for node 13, person A for 12 and pose for 11', async () => {
  const {uploads, submitted, error} = await captureSubmission(recipe)
  assert.match(error.message, /TEST_CAPTURED/)
  assert.equal(uploads.size, 3)
  assert.equal(uploads.get(submitted['12'].inputs.image), 'person-a')
  assert.equal(uploads.get(submitted['13'].inputs.image), 'person-b')
  assert.equal(uploads.get(submitted['11'].inputs.image), 'pose')
  assert.equal(submitted['4'].inputs.prompt, 'Keep workflow prompt')
  assert.deepEqual(submitted['4'].inputs['images.image_3'], ['13', 0])
})

test('missing person B stops before uploads or submission instead of reusing an old file', async () => {
  const {uploads, submitted, error} = await captureSubmission({...recipe, portraitB: null})
  assert.match(error.message, /人物B/)
  assert.equal(uploads.size, 0)
  assert.equal(submitted, undefined)
})

test('duplicate mappings cannot overwrite a different identity', async () => {
  const {uploads, submitted, error} = await captureSubmission(recipe, {portraitBNodeId: '12'})
  assert.match(error.message, /不能重复绑定/)
  assert.equal(uploads.size, 0)
  assert.equal(submitted, undefined)
})

const withOptionalCostume = () => {
  const wf = structuredClone(workflow)
  wf['15'] = {class_type: 'LoadImage', inputs: {image: ''}, _meta: {title: '女士服装（可选）', optionalReference: 'womens_clothing'}}
  wf['4'].inputs['images.image_4'] = ['15', 0]
  return JSON.stringify(wf)
}

test('empty optional clothing is detached while both identities remain separate', async () => {
  const {submitted, uploads, error} = await captureSubmission(recipe, {workflowJson: withOptionalCostume()})
  assert.match(error.message, /TEST_CAPTURED/)
  assert.equal(uploads.size, 3)
  assert.equal(submitted['15'], undefined)
  assert.equal(submitted['4'].inputs['images.image_4'], undefined)
  assert.equal(uploads.get(submitted['13'].inputs.image), 'person-b')
  assert.match(submitted['4'].inputs.prompt, /NO clothing reference image/)
  assert.match(submitted['4'].inputs.prompt, /cream long-sleeved shirt/)
})

test('selected clothing goes to image 4 and applies to the left woman only', async () => {
  const {submitted, uploads, error} = await captureSubmission({...recipe, costume: ref('womens-outfit')}, {workflowJson: withOptionalCostume()})
  assert.match(error.message, /TEST_CAPTURED/)
  assert.equal(uploads.size, 4)
  assert.equal(uploads.get(submitted['15'].inputs.image), 'womens-outfit')
  assert.equal(uploads.get(submitted['13'].inputs.image), 'person-b')
  assert.deepEqual(submitted['4'].inputs['images.image_4'], ['15', 0])
  assert.match(submitted['4'].inputs.prompt, /ONLY clothing specification.*woman on the LEFT/)
})
