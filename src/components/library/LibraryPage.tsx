import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { DownloadIcon, FileUpIcon, PlusIcon, ScanSearchIcon } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu'
import { idbRead, idbWrite } from '@/lib/idbStorage'
import { toast } from '@/lib/notifications'
import { autoDetectComfyMappings, checkComfyWorkflow, detectComfyUi, parseComfyWorkflowNodes } from '@/services/aiGenerator'
import { useStudio } from '@/store/studioStore'
import { cleanWorkflow, DEFAULT_TAGS, downloadLibraryFile, EMPTY_MAPPINGS, LIBRARY_KEY, libraryExport, MAPPING_LABELS, mergeLibraryEntries, newLibraryEntry, normalizeEntry, parseLibraryImport, withNegativePrompt, linkedLibraryPrompts, prepareLibraryWorkflow } from '@/lib/templateLibrary'
import { TEMPLATE_LIBRARY_QUERY_KEY } from '@/lib/useTemplateLibrary'
import type { LibraryEntry, LibraryKind, MappingKey } from '@/lib/templateLibrary'

const selectClass = 'h-9 rounded-md border border-input bg-background px-3 text-sm w-full'
const date = (value: number) => new Date(value).toLocaleString('zh-CN', { hour12: false })
const errorText = (error: unknown) => error instanceof Error ? error.message : '操作失败'

export function LibraryPage({ kind }: { kind: LibraryKind }) {
  const workflowPage = kind === 'workflow'
  const title = workflowPage ? '工作流模板配置' : '提示词库'
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const studio = useStudio()
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  const entriesRef = useRef(entries)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState('all')
  const [sort, setSort] = useState('updated')
  const [draft, setDraft] = useState<LibraryEntry | null>(null)
  const [editorError, setEditorError] = useState('')
  const [newTag, setNewTag] = useState('')
  const [pending, setPending] = useState<LibraryEntry[] | null>(null)
  const [deleting, setDeleting] = useState<LibraryEntry | null>(null)
  const [checking, setChecking] = useState(false)
  const [report, setReport] = useState<string[] | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    void idbRead<LibraryEntry[]>(LIBRARY_KEY).then(value => {
      if (!active) return
      if (value && (!Array.isArray(value) || !value.every(e => e && (e.kind === 'workflow' || e.kind === 'prompt')))) throw new Error('本地库格式异常，请先备份浏览器数据')
      entriesRef.current = (value || []).map(e => normalizeEntry(e, e.kind)); setEntries(entriesRef.current); setLoaded(true)
    }).catch(error => { if (active) setLoadError(errorText(error)) })
    return () => { active = false }
  }, [])

  async function persist(next: LibraryEntry[]) {
    setBusy(true)
    try { await idbWrite(LIBRARY_KEY, next); entriesRef.current = next; setEntries(next); queryClient.setQueryData(TEMPLATE_LIBRARY_QUERY_KEY, next) }
    finally { setBusy(false) }
  }
  async function commitImport(items: LibraryEntry[], mode: 'replace' | 'copy') {
    try { await persist(mergeLibraryEntries(entriesRef.current, items, mode)); setPending(null); toast.success(`已导入 ${items.length} 条记录`) }
    catch (error) { toast.error(errorText(error)) }
  }
  function openDraft(entry: LibraryEntry) { setEditorError(''); setNewTag(''); setDraft(structuredClone(entry)) }
  async function readFile(file: File, inEditor = false) {
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('文件不能超过 10 MB')
      const result = parseLibraryImport(await file.text(), kind, file.name)
      if (inEditor) {
        if (result.entries.length !== 1) throw new Error('编辑表单一次只能加载一条记录')
        const item = result.entries[0]
        if (workflowPage && result.raw) item.mappings = { ...autoDetectComfyMappings(item.content), promptNodeId: 'none' }
        setDraft(current => current ? result.raw
          ? { ...current, content: item.content, mappings: item.mappings, title: current.title || item.title }
          : { ...item, id: current.id, createdAt: current.createdAt }
          : item)
        setEditorError('')
      } else if (result.raw) {
        const item = result.entries[0]
        if (workflowPage) item.mappings = { ...autoDetectComfyMappings(item.content), promptNodeId: 'none' }
        openDraft(item)
      } else if (result.entries.some(item => entriesRef.current.some(e => e.kind === item.kind && (e.id === item.id || e.title === item.title)))) setPending(result.entries)
      else await commitImport(result.entries, 'copy')
    } catch (error) { if (inEditor) setEditorError(errorText(error)); else toast.error(errorText(error)) }
  }
  async function saveDraft() {
    if (!draft) return
    try {
      const item = normalizeEntry({ ...draft, updatedAt: Date.now() }, kind)
      const conflict = entriesRef.current.find(e => e.kind === kind && e.title === item.title && e.id !== item.id)
      if (conflict) throw new Error('已有同名条目，请修改标题，或关闭表单后编辑已有条目')
      const next = entriesRef.current.some(e => e.id === item.id) ? entriesRef.current.map(e => e.id === item.id ? item : e) : [...entriesRef.current, item]
      await persist(next); setDraft(null); toast.success('已保存到本地库')
    } catch (error) { setEditorError(errorText(error)) }
  }
  function exportEntries(items: LibraryEntry[], filename: string) {
    try { downloadLibraryFile(filename, libraryExport(items, kind)) } catch (error) { toast.error(errorText(error)) }
  }
  async function detectEnvironment() {
    setChecking(true); setReportOpen(true); setReport(null)
    try {
      const cfg = studio.apiConfig.providers.comfyui
      const found = await detectComfyUi(cfg.baseUrl, cfg.apiKey)
      if (!found) throw new Error('未找到本地 ComfyUI，请启动服务并在 API 配置中检查地址和跨域设置')
      const lines = [`服务连接成功：${found.info}`]
      const workflows = workflowPage ? entriesRef.current.filter(e => e.kind === 'workflow') : entriesRef.current.filter(e => e.kind === 'workflow' && entriesRef.current.some(p => p.kind === 'prompt' && p.workflowId === e.id))
      if (!workflows.length) lines.push('没有待检测的工作流。提示词本身不需要安装模型；关联工作流后可检查其节点和模型。')
      for (const item of workflows) {
        if (cleanWorkflow(item.content).format === 'canvas') { lines.push(`${item.title}：画布格式，请先导出 API 格式再检测节点和模型`); continue }
        try {
          const result = await checkComfyWorkflow(found.baseUrl, cfg.apiKey, item.content, Object.entries(item.mappings).filter(([key]) => key !== 'promptNodeId').map(([, id]) => id))
          lines.push(`${item.title}：${result.ok ? '通过' : '未通过'}`, ...result.errors.map(x => `错误：${x}`), ...result.warnings.map(x => `提醒：${x}`))
        } catch (error) { lines.push(`${item.title}：${errorText(error)}`) }
      }
      setReport(lines)
    } catch (error) { setReport([errorText(error)]) }
    finally { setChecking(false) }
  }
  function handleUseEntry(item: LibraryEntry) {
    try {
      if (studio.isGenerating) throw new Error('当前任务进行中，请等待完成后再切换模板或提示词')
      const linked = item.kind === 'workflow' ? item : entries.find(e => e.id === item.workflowId && e.kind === 'workflow')
      if (item.kind === 'prompt' && item.workflowId && !linked) throw new Error('关联工作流已删除，请先编辑提示词并重新关联')
      if (linked) {
        const selectedPrompt = item.kind === 'prompt' ? item : linkedLibraryPrompts(entries, linked.id)[0]
        studio.updateComfyUiParams(prepareLibraryWorkflow(linked, selectedPrompt))
        studio.setCustomPrompt(selectedPrompt?.content ?? null)
        studio.updateApiConfig({ activeProvider: 'comfyui' })
        toast.success(selectedPrompt ? `已加载模板及提示词：${selectedPrompt.title}` : '已加载模板，使用工作流原提示词')
        void navigate({ to: '/studio' })
        return
      }
      const cp = { ...studio.apiConfig.comfyuiParams }
      if (item.kind === 'prompt') {
        if (studio.apiConfig.activeProvider === 'comfyui') {
          const parsed = parseComfyWorkflowNodes(cp.workflowJson)
          if (!parsed.valid) throw new Error(parsed.error || '当前工作流无效')
          const positive = parsed.promptNodes.find(n => n.id === cp.promptNodeId) || parsed.promptNodes.find(n => !/negative|反向|负面/i.test(n.title))
          if (!positive) throw new Error('工作流中没有可写入的正向提示词节点')
          const nodes = JSON.parse(cp.workflowJson)
          nodes[positive.id].inputs[positive.field] = item.content
          cp.workflowJson = withNegativePrompt(JSON.stringify(nodes, null, 2), positive.id, item.negative)
          // Keep the selected text in the saved workflow too, so a refresh cannot
          // replace it with a recipe-generated prompt after customPrompt resets.
          cp.promptNodeId = 'none'
          studio.updateComfyUiParams(cp)
        } else if (item.negative.trim() && studio.apiConfig.activeProvider !== 'qwen') throw new Error('当前云端协议没有独立反向提示词参数，请清空反向内容后使用')
        if (studio.apiConfig.activeProvider === 'qwen') studio.updateQwenParams({ negativePrompt: item.negative })
        studio.setCustomPrompt(item.content)
      } else { studio.updateComfyUiParams(cp); studio.setCustomPrompt(null) }
      toast.success('已应用到合成台，请确认参考图后生成')
      void navigate({ to: '/studio' })
    } catch (error) { toast.error(errorText(error)) }
  }

  const allTags = [...new Set([...DEFAULT_TAGS, ...entries.flatMap(e => e.tags), ...(draft?.tags || [])])]
  const rows = entries.filter(e => e.kind === kind && (tag === 'all' || e.tags.includes(tag)) && `${e.title} ${e.description} ${e.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title, 'zh-CN') : sort === 'created' ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt)
  const parsedDraft = draft && workflowPage ? parseComfyWorkflowNodes(draft.content) : null
  const patch = (value: Partial<LibraryEntry>) => setDraft(current => current ? { ...current, ...value } : current)

  return <>
    <PageHeader title={title} description="保存在当前浏览器，支持导出备份；切换浏览器或清除站点数据前请先备份。" actions={<>
      <Button variant="outline" size="sm" onClick={() => void detectEnvironment()} disabled={checking || !loaded || busy}><ScanSearchIcon className="size-4" />{checking ? '检测中…' : '检测本机环境'}</Button>
      <Button variant="outline" size="sm" onClick={() => exportEntries(entries.filter(e => e.kind === kind), `${kind}-library.json`)} disabled={!loaded || busy}><DownloadIcon className="size-4" />整库导出</Button>
      <Button variant="outline" size="sm" onClick={() => openDraft(newLibraryEntry(kind))} disabled={!loaded || busy}><PlusIcon className="size-4" />新建</Button>
      <Button size="sm" onClick={() => openDraft(newLibraryEntry(kind))} disabled={!loaded || busy}><FileUpIcon className="size-4" />导入</Button>
    </>} />
    <input ref={fileRef} type="file" className="hidden" aria-label="导入库备份" accept={workflowPage ? '.json' : '.json,.txt'} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void readFile(file) }} />
    <div className="flex flex-wrap gap-3 rounded-xl border bg-card p-4">
      <Input className="min-w-48 flex-1" aria-label="搜索标题或描述" placeholder="搜索标题、描述、标签…" value={query} onChange={e => setQuery(e.target.value)} />
      <select aria-label="按标签筛选" className={`${selectClass} sm:w-36`} value={tag} onChange={e => setTag(e.target.value)}><option value="all">全部标签</option>{allTags.map(t => <option key={t} value={t}>{t}</option>)}</select>
      <select aria-label="排序方式" className={`${selectClass} sm:w-40`} value={sort} onChange={e => setSort(e.target.value)}><option value="updated">最近更新</option><option value="created">最近创建</option><option value="title">标题排序</option></select>
      <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={!loaded || busy}>从文件恢复 / 批量导入</Button>
    </div>
    {loadError ? <p role="alert" className="text-destructive">读取失败：{loadError}。请重新加载页面重试，当前未写入任何数据。</p> : !loaded ? <p role="status">正在读取本地库…</p> : <section className="overflow-hidden rounded-xl border bg-card" aria-label={`${title}列表`}>
      <div className="border-b px-5 py-3 text-sm text-muted-foreground">共 {rows.length} 条</div>
      {!rows.length && <div className="p-12 text-center text-muted-foreground">{entries.some(e => e.kind === kind) ? '没有匹配的记录，请调整搜索或标签。' : `还没有${workflowPage ? '工作流模板' : '提示词'}，点击右上角新建或导入。`}</div>}
      <ul className="divide-y">{rows.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="min-w-0 flex-1 basis-72"><h2 className="break-words font-semibold">{item.title}</h2><div className="mt-2 flex flex-wrap gap-1.5">{item.tags.map(t => <span key={t} className="rounded-md bg-muted px-2 py-0.5 text-xs">{t}</span>)}{workflowPage && <span className="rounded-md border px-2 py-0.5 text-xs">{parseComfyWorkflowNodes(item.content).isUiFormat ? '画布格式 · 仅管理' : 'API 格式'}</span>}</div><p className="mt-2 line-clamp-2 break-words text-sm text-muted-foreground">{item.description || (workflowPage ? '暂无描述' : item.content)}</p>{!workflowPage && <p className="mt-1 text-xs text-muted-foreground">适用模型：{item.model || '未指定'} · 关联模板：{entries.find(e => e.id === item.workflowId)?.title || (item.workflowId ? '已删除，请重新关联' : '无，使用当前配置')}</p>}<p className="mt-2 text-xs text-muted-foreground">创建：{date(item.createdAt)} · 更新：{date(item.updatedAt)}</p></div>
        <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => handleUseEntry(item)} disabled={busy}>使用</Button><Button size="sm" variant="outline" onClick={() => openDraft(item)} disabled={busy}>编辑</Button><Button size="sm" variant="outline" onClick={() => exportEntries([item], `${item.title}.json`)}>导出</Button>{workflowPage && <Button size="sm" variant="outline" onClick={() => downloadLibraryFile(`${item.title}.workflow.json`, cleanWorkflow(item.content).content)}>导出原工作流</Button>}<Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleting(item)} disabled={busy}>删除</Button></div>
      </li>)}</ul>
    </section>}
    <Dialog open={!!draft} onOpenChange={open => { if (!open && !busy) setDraft(null) }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>{draft && entries.some(e => e.id === draft.id) ? '编辑' : '新建 / 导入'}{workflowPage ? '工作流模板' : '提示词'}</DialogTitle><DialogDescription>{workflowPage ? '上传 JSON 后确认图片节点映射。画布格式可保存，但需要导出 API 格式后才能应用。' : '可直接填写内容，或上传 TXT / 本库导出的 JSON。日期自动记录。'}</DialogDescription></DialogHeader>
      {draft && <form id="library-entry-form" className="grid gap-4" onSubmit={e => { e.preventDefault(); void saveDraft() }}>
        <label className="grid gap-2 text-sm">标题 *<Input required maxLength={200} value={draft.title} onChange={e => patch({ title: e.target.value })} /></label>
        <div className="grid gap-2 text-sm"><span>标签（下拉多选）</span><DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="outline" aria-label="选择标签" className="justify-start whitespace-normal">{draft.tags.length ? draft.tags.join('、') : '选择标签：单人、双人等'}</Button></DropdownMenuTrigger><DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">{allTags.map(t => <DropdownMenuCheckboxItem key={t} checked={draft.tags.includes(t)} onSelect={e => e.preventDefault()} onCheckedChange={checked => patch({ tags: checked ? [...new Set([...draft.tags, t])] : draft.tags.filter(tag => tag !== t) })}>{t}</DropdownMenuCheckboxItem>)}</DropdownMenuContent></DropdownMenu><div className="flex gap-2"><Input aria-label="新增标签" placeholder="输入自定义标签" maxLength={50} value={newTag} onChange={e => setNewTag(e.target.value)} /><Button type="button" variant="outline" onClick={() => { if (newTag.trim()) { patch({ tags: [...new Set([...draft.tags, newTag.trim()])] }); setNewTag('') } }}>添加标签</Button></div></div>
        <label className="grid gap-2 text-sm">描述<Textarea value={draft.description} onChange={e => patch({ description: e.target.value })} /></label>
        <label className="grid gap-2 text-sm">文件上传（{workflowPage ? 'JSON' : 'TXT / JSON'}）<Input type="file" accept={workflowPage ? '.json' : '.json,.txt'} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void readFile(file, true) }} /></label>
        <label className="grid gap-2 text-sm">{workflowPage ? '工作流 JSON *' : '正向内容 *'}<Textarea className="min-h-44 font-mono" required value={draft.content} onChange={e => patch({ content: e.target.value })} /></label>
        {workflowPage ? <>
          <p className={`text-sm ${parsedDraft?.valid ? 'text-emerald-600' : 'text-muted-foreground'}`}>{parsedDraft?.valid ? `API 格式 · ${parsedDraft.imageNodes.length} 个图片节点` : draft.content ? parsedDraft?.error : '请先上传或填写工作流 JSON'}</p>
          {parsedDraft?.valid && <><Button type="button" variant="outline" onClick={() => patch({ mappings: { ...autoDetectComfyMappings(draft.content), promptNodeId: 'none' } })}>自动识别节点映射</Button><div className="grid gap-3 sm:grid-cols-2">{(Object.keys(EMPTY_MAPPINGS) as MappingKey[]).map(key => <label key={key} className="grid gap-2 text-sm">{MAPPING_LABELS[key]}节点<select className={selectClass} value={draft.mappings[key]} onChange={e => patch({ mappings: { ...draft.mappings, [key]: e.target.value } })}><option value="none">{key === 'promptNodeId' ? '保留工作流提示词' : '不绑定'}</option>{(key === 'promptNodeId' ? parsedDraft.promptNodes : parsedDraft.imageNodes).map(n => <option key={n.id} value={n.id}>#{n.id} {n.title}</option>)}</select></label>)}</div><p className="text-xs text-muted-foreground">未绑定的图片节点可能作为附加参考图显示。应用后请在合成台核对。上传图片文件名不会保存到模板。</p></>}
        </> : <><label className="grid gap-2 text-sm">反向内容（可选）<Textarea value={draft.negative} onChange={e => patch({ negative: e.target.value })} /><span className="text-xs text-muted-foreground">需要工作流含可识别的反向提示词节点，或使用支持此参数的云端协议。</span></label><label className="grid gap-2 text-sm">适用模型（说明用途，不会自动切换模型）<Input value={draft.model} onChange={e => patch({ model: e.target.value })} /></label><label className="grid gap-2 text-sm">关联工作流<select className={selectClass} value={draft.workflowId} onChange={e => patch({ workflowId: e.target.value })}><option value="">不关联，使用合成台当前配置</option>{draft.workflowId && !entries.some(e => e.id === draft.workflowId) && <option value={draft.workflowId}>原关联已删除，请重新选择</option>}{entries.filter(e => e.kind === 'workflow').map(e => <option key={e.id} value={e.id}>{e.title}</option>)}</select></label></>}
        <p className="text-xs text-muted-foreground">创建日期：{date(draft.createdAt)} · 更新日期：保存时自动更新</p>
        {editorError && <p role="alert" className="text-sm text-destructive">{editorError}</p>}
      </form>}
      {!workflowPage && <p className="text-xs text-muted-foreground">提示词中的图片编号以关联工作流实际输入顺序为准，不以网页槽位显示顺序为准。关联模板后，点击“使用”会一并加载其节点映射。</p>}
      <DialogFooter><Button variant="outline" onClick={() => setDraft(null)} disabled={busy}>取消</Button><Button form="library-entry-form" type="submit" disabled={busy}>{busy ? '保存中…' : '保存'}</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={!!pending} onOpenChange={open => { if (!open && !busy) setPending(null) }}><DialogContent><DialogHeader><DialogTitle>发现重复记录</DialogTitle><DialogDescription>按标题或 ID 匹配。覆盖会更新已有记录；保留副本会创建新记录。</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setPending(null)}>取消</Button><Button variant="outline" disabled={busy} onClick={() => pending && void commitImport(pending, 'copy')}>保留副本</Button><Button disabled={busy} onClick={() => pending && void commitImport(pending, 'replace')}>覆盖重复项</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!deleting} onOpenChange={open => { if (!open && !busy) setDeleting(null) }}><DialogContent><DialogHeader><DialogTitle>删除「{deleting?.title}」？</DialogTitle><DialogDescription>建议先导出备份。删除工作流后，引用它的提示词需要重新关联。</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setDeleting(null)}>取消</Button><Button variant="destructive" disabled={busy} onClick={async () => { try { await persist(entriesRef.current.filter(e => e.id !== deleting?.id)); setDeleting(null); toast.success('已删除') } catch (error) { toast.error(errorText(error)) } }}>确认删除</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={reportOpen} onOpenChange={setReportOpen}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>本机环境检测</DialogTitle><DialogDescription>只读取服务、节点和模型信息，不执行生成，也不安装依赖。</DialogDescription></DialogHeader><div role="status" className="space-y-2 break-words text-sm">{checking && <p>正在检测，请稍候…</p>}{report?.map((line, i) => <p key={i}>{line}</p>)}</div><DialogFooter><Button onClick={() => setReportOpen(false)}>关闭</Button></DialogFooter></DialogContent></Dialog>
  </>
}
