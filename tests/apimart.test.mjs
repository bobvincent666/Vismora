import assert from 'node:assert/strict'
import test from 'node:test'
import { generateApimartImage } from '../src/services/apimart.ts'
import { onRequestGet } from '../functions/api/proxy.ts'

const json = (data, status = 200) => new Response(JSON.stringify(data), { status })
const options = {
  baseUrl: 'https://api.apimart.ai/v1', apiKey: 'mock-key', model: 'gpt-image-2-official', prompt: 'three reference roles',
  imageRefs: ['person', 'clothing', 'pose'].map((s) => `data:image/png;base64,${btoa(s)}`),
  params: { aspectRatio: '2:3', resolution: '2k', quality: 'high', outputFormat: 'png', moderation: 'auto' },
  wait: async () => {},
}

test('uploads all three references in order, submits once, and polls with authenticated GET', async () => {
  const uploads = []
  let submitted = 0
  let queried = 0
  const progress = []
  const url = await generateApimartImage({ ...options, report: (m) => progress.push(m), request: async (url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer mock-key')
    if (url.endsWith('/uploads/images')) {
      assert.equal(init.method, 'POST')
      uploads.push(await init.body.get('file').text())
      return json({ url: `https://upload.apimart.ai/${uploads.length}.png` })
    }
    if (url.endsWith('/images/generations')) {
      submitted++
      assert.deepEqual(JSON.parse(init.body), {
        model: options.model, prompt: options.prompt, n: 1,
        image_urls: [1, 2, 3].map((n) => `https://upload.apimart.ai/${n}.png`),
        size: '2:3', resolution: '2k', quality: 'high', output_format: 'png', moderation: 'auto',
      })
      return json({ code: 200, data: [{ status: 'submitted', task_id: 'task_mock' }] })
    }
    assert.equal(url, 'https://api.apimart.ai/v1/tasks/task_mock')
    assert.equal(init.method, 'GET')
    assert.equal(init.body, undefined)
    queried++
    return json({code: 200, data: queried === 1 ? {status: 'in_progress', progress: 50} : {status: 'completed', result: {images: [{url: ['https://upload.apimart.ai/result.png']}]}}})
  } })
  assert.deepEqual(uploads, ['person', 'clothing', 'pose'])
  assert.equal(submitted, 1)
  assert.equal(queried, 2)
  assert.equal(url, 'https://upload.apimart.ai/result.png')
  assert.ok(progress.some((m) => m.includes('50%')))
})

test('upload authentication failure stops before creating a billable task', async () => {
  let calls = 0
  await assert.rejects(generateApimartImage({ ...options, request: async () => {
    calls++
    return json({error: {message: 'invalid_api_key'}}, 401)
  }}), /参考图 1 上传失败.*invalid_api_key/)
  assert.equal(calls, 1)
})

const taskRequest = (result) => async (url) => {
  if (url.endsWith('/uploads/images')) return json({ url: 'https://upload.apimart.ai/mock.png' })
  if (url.endsWith('/images/generations')) return json({ code: 200, data: [{task_id: 'task_mock'}] })
  return result()
}

test('task errors include service error and task ID', async () => {
  await assert.rejects(generateApimartImage({ ...options, request: taskRequest(() => json({ code: 200, data: { status: 'failed', error: {message: 'upstream failure'} } })) }), /upstream failure.*task_mock/)
})

test('query network failure keeps task ID and never resubmits', async () => {
  await assert.rejects(generateApimartImage({ ...options, request: taskRequest(() => { throw Error('network failure') }) }), /查询失败，任务 ID：task_mock/)
})

test('timeout keeps task ID for checking the existing task', async () => {
  let clock = 0
  await assert.rejects(generateApimartImage({ ...options, now: () => clock, timeoutMs: 1, wait: async () => { clock += 4000 }, request: taskRequest(() => json({code: 200, data: {status: 'in_progress'}})) }), /等待超时，任务 ID：task_mock/)
})

test('production proxy forwards GET without a request body and preserves auth', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.apimart.ai/v1/tasks/task_mock')
    assert.equal(init.method, 'GET')
    assert.equal(init.body, undefined)
    assert.equal(init.headers.get('authorization'), 'Bearer mock-key')
    return json({code: 200, data: {status: 'in_progress'}})
  }
  try {
    const result = await onRequestGet({ request: new Request('https://app.example/api/proxy', {headers: {'x-target-url':'https://api.apimart.ai/v1/tasks/task_mock', authorization:'Bearer mock-key'}}) })
    assert.equal(result.status, 200)
    assert.equal((await result.json()).data.status, 'in_progress')
  } finally { globalThis.fetch = originalFetch }
})
