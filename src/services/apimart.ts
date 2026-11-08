import type { GptParams } from '../types/gallery'

type RequestFn = (url: string, init: RequestInit) => Promise<Response>

/** APIMart official channel requires uploaded/public URLs, then an asynchronous task. */
export async function generateApimartImage(options: {
  baseUrl: string
  apiKey: string
  model: string
  prompt: string
  imageRefs: string[]
  params: GptParams
  request: RequestFn
  report?: (message: string, percent?: number) => void
  wait?: (ms: number) => Promise<void>
  now?: () => number
  timeoutMs?: number
}): Promise<string> {
  const { apiKey, model, prompt, imageRefs, params, request } = options
  const base = new URL(options.baseUrl)
  if (base.protocol !== 'https:' || base.hostname !== 'api.apimart.ai' || base.username || base.password || base.search || base.hash || !['', '/', '/v1', '/v1/'].includes(base.pathname)) {
    throw new Error('[GPT] APIMart 模式的 Base URL 应为 https://api.apimart.ai/v1')
  }
  if (imageRefs.length < 1 || imageRefs.length > 16) throw new Error('[GPT] APIMart 需要 1～16 张参考图')
  const v1 = `${base.origin}/v1`
  const report = options.report ?? (() => {})
  const wait = options.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const now = options.now ?? Date.now
  const timeoutMs = options.timeoutMs ?? 600000
  const auth = { Authorization: `Bearer ${apiKey}` }

  const call = async (url: string, init: RequestInit) => {
    const response = await request(url, { ...init, signal: AbortSignal.timeout(60000) })
    let json: any
    try { json = await response.json() } catch { throw new Error(`服务返回非 JSON 响应（HTTP ${response.status}）`) }
    if (!response.ok || json?.error || (json?.code !== undefined && json.code !== 200)) {
      throw new Error(json?.error?.message || json?.message || `请求失败（HTTP ${response.status}）`)
    }
    return json
  }

  const imageUrls: string[] = []
  for (let i = 0; i < imageRefs.length; i++) {
    report(`正在上传参考图 ${i + 1}/${imageRefs.length}`)
    const ref = imageRefs[i]
    if (!/^data:image\/(png|jpeg|webp);base64,/i.test(ref)) throw new Error('[GPT] APIMart 参考图需先转换为 PNG、JPEG 或 WebP')
    const [header, encoded] = ref.split(',')
    const mime = header.slice(5, header.indexOf(';'))
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))
    if (bytes.length > 20 * 1024 * 1024) throw new Error(`[GPT] 参考图 ${i + 1} 超过 20MB`)
    const form = new FormData()
    form.append('file', new Blob([bytes], { type: mime }), `reference-${i + 1}.${mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1]}`)
    let uploaded: any
    try { uploaded = await call(`${v1}/uploads/images`, { method: 'POST', headers: auth, body: form }) }
    catch (err) { throw new Error(`[GPT] 参考图 ${i + 1} 上传失败：${err instanceof Error ? err.message : '网络异常'}`) }
    const url = uploaded?.url
    if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('[GPT] 上传接口未返回有效的 HTTPS 图片地址')
    imageUrls.push(url)
  }

  report('参考图上传完成，正在提交生成任务')
  let submitted: any
  try {
    submitted = await call(`${v1}/images/generations`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, prompt, n: 1, image_urls: imageUrls,
        size: params.aspectRatio || '2:3', resolution: params.resolution || '2k',
        quality: ['auto', 'low', 'medium', 'high'].includes(params.quality) ? params.quality : 'high',
        output_format: params.outputFormat, moderation: params.moderation,
      }),
    })
  } catch (err) {
    throw new Error(`[GPT] 提交失败：${err instanceof Error ? err.message : '网络异常'}。若为网络中断，请先查看服务商任务记录，避免重复提交。`)
  }
  const taskId = submitted?.data?.[0]?.task_id
  if (typeof taskId !== 'string' || !taskId) throw new Error('[GPT] 提交响应未返回 task_id，请先检查服务商任务记录')
  const deadline = now() + timeoutMs
  report(`任务已提交：${taskId}`)
  while (now() < deadline) {
    await wait(4000)
    let result: any
    try { result = await call(`${v1}/tasks/${encodeURIComponent(taskId)}`, { method: 'GET', headers: auth }) }
    catch (err) { throw new Error(`[GPT] 查询失败，任务 ID：${taskId}。${err instanceof Error ? err.message : '网络异常'}；任务可能仍在运行，请勿重复提交。`) }
    const task = result?.data
    if (task?.status === 'completed') {
      const url = task?.result?.images?.[0]?.url?.[0]
      if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error(`[GPT] 任务完成但缺少有效图片地址，任务 ID：${taskId}`)
      report('图片生成完成', 100)
      return url
    }
    if (['failed', 'cancelled', 'canceled'].includes(task?.status)) {
      throw new Error(`[GPT] ${task?.error?.message || '生成任务失败'}（任务 ID：${taskId}）`)
    }
    if (!['submitted', 'pending', 'queued', 'processing', 'in_progress'].includes(task?.status)) {
      throw new Error(`[GPT] 未知任务状态，任务 ID：${taskId}，请到服务商平台查询`)
    }
    const percent = typeof task.progress === 'number' ? Math.max(0, Math.min(99, task.progress)) : undefined
    report(`生成中${percent === undefined ? '' : ` ${percent}%`} · ${taskId}`, percent)
  }
  throw new Error(`[GPT] 等待超时，任务 ID：${taskId}。任务可能仍在运行，请到服务商平台查询，避免重复提交。`)
}
