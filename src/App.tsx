import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import { flushSync } from 'react-dom'
import {
  ArrowDownLeft, ArrowDownToLine, ArrowRight, ArrowUpRight, BookOpen, Check,
  CheckCheck, ChevronDown, CircleCheck, Clock3, Coffee, Command,
  Dices, Feather, FolderHeart, HardDrive, Lightbulb, LoaderCircle,
  MoveUpRight, Plus, RotateCcw, Search, ShieldCheck, SlidersHorizontal, Sparkles,
  Sun, Trash2, X,
} from 'lucide-react'
import { CATEGORIES, STORAGE_KEY, isEntry, loadStore, randomIndex, relativeTime } from './model'
import type { Category, Entry, Page, Store } from './model'

const categoryIcons = { 灵感: Lightbulb, 工作: FolderHeart, 生活: Coffee, 学习: BookOpen }
const pageLabels: Record<Page, string> = { notes: '随心记', draw: '摇个任务', done: '已完成' }
const times = [5, 15, 30, 60]

function reducedMotion() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches }

function transition(action: () => void) {
  if ('startViewTransition' in document && !reducedMotion()) {
    document.startViewTransition(() => flushSync(action))
  } else action()
}

function BrandMark({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark ${small ? 'small' : ''}`} aria-hidden="true">
    <span /><span /><Sparkles size={small ? 15 : 19} strokeWidth={1.7} />
  </span>
}

function CardMark() {
  return <svg className="card-mark" viewBox="0 0 100 100" fill="none" aria-hidden="true">
    {[0, 30, 60, 90, 120, 150].map(rotation => <rect key={rotation} x="33" y="14" width="34" height="72" rx="17" stroke="currentColor" strokeWidth="1.4" transform={`rotate(${rotation} 50 50)`} />)}
    <circle cx="50" cy="50" r="7" fill="currentColor" />
  </svg>
}

function CategoryLabel({ category }: { category: Category }) {
  const Icon = categoryIcons[category]
  return <span className={`category-label cat-${CATEGORIES.indexOf(category)}`}><Icon size={13} />{category}</span>
}

type Toast = { message: string; undo?: () => void; id: number }
const NoticeContext = createContext<{ toast: Toast | null; close: () => void } | null>(null)

function ToastMessage({ toast, close, inDialog = false }: { toast: Toast | null; close: () => void; inDialog?: boolean }) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const startTimer = useCallback(() => { timer.current = setTimeout(close, 5000) }, [close])
  useEffect(() => {
    if (!toast) return
    startTimer()
    return () => clearTimeout(timer.current)
  }, [toast, startTimer])
  if (!toast) return null
  return <div className={`toast ${inDialog ? 'in-dialog' : ''}`} key={toast.id} role="status" onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={startTimer} onFocus={() => clearTimeout(timer.current)} onBlur={startTimer}>
    <span className="toast-icon"><Check size={15} /></span><span>{toast.message}</span>
    {toast.undo && <button onClick={() => { toast.undo?.(); close() }}>撤销</button>}
    <button className="icon-button toast-close" aria-label="关闭提示" onClick={close}><X size={14} /></button>
  </div>
}

function Modal({ children, title, onClose, drawer = false }: { children: ReactNode; title: string; onClose: () => void; drawer?: boolean }) {
  const notice = useContext(NoticeContext)
  const ref = useRef<HTMLDialogElement>(null)
  const [closing, setClosing] = useState(false)
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    const focusFrame = requestAnimationFrame(() => dialog.querySelector<HTMLInputElement>('.editor-title')?.focus())
    return () => { cancelAnimationFrame(focusFrame); clearTimeout(timeout.current); dialog.close() }
  }, [])
  const close = useCallback(() => {
    if (closing) return
    setClosing(true)
    timeout.current = setTimeout(() => { ref.current?.close(); onClose() }, reducedMotion() ? 0 : 150)
  }, [closing, onClose])
  return <dialog ref={ref} className={`${drawer ? 'drawer' : 'modal'} ${closing ? 'closing' : ''}`} aria-label={title}
    onCancel={e => { e.preventDefault(); close() }} onClick={e => { if (e.target === e.currentTarget) close() }}>
    <div className="dialog-content">
      <header className="dialog-header"><div><span className="eyebrow">给想法留一点空间</span><h2>{title}</h2></div><button className="icon-button" aria-label="关闭窗口" onClick={close}><X size={20} /></button></header>
      {children}
    </div>
    {notice && <ToastMessage toast={notice.toast} close={notice.close} inDialog />}
  </dialog>
}

function EntryEditor({ entry, onSave, onDelete, onClose }: { entry: Entry; onSave: (entry: Entry) => void; onDelete: (entry: Entry) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(entry)
  return <Modal title="这一刻的想法" onClose={onClose} drawer>
    <form className="entry-form" onSubmit={e => { e.preventDefault(); if (draft.title.trim()) { onSave({ ...draft, title: draft.title.trim(), example: false }); onClose() } }}>
      <label className="field-label" htmlFor="entry-title">一句话，记住它</label>
      <input id="entry-title" autoFocus className="editor-title" value={draft.title} maxLength={120} required onChange={e => setDraft({ ...draft, title: e.target.value })} />
      <label className="field-label" htmlFor="entry-body">再展开说说</label>
      <textarea id="entry-body" className="editor-body" value={draft.body} maxLength={5000} placeholder="不必整理好，想到什么就写什么。" onChange={e => setDraft({ ...draft, body: e.target.value })} />
      <div className="editor-selects"><label>放在哪一类<select value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value as Category })}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label>
        <label>大约需要多久<select value={draft.minutes} onChange={e => setDraft({ ...draft, minutes: Number(e.target.value) })}>{times.map(t => <option key={t} value={t}>{t} 分钟</option>)}</select></label></div>
      <label className="task-option"><input type="checkbox" checked={draft.isTask} onChange={e => setDraft({ ...draft, isTask: e.target.checked })} /><span><strong>也把它放进任务池</strong><small>在“摇个任务”里，遇见这个想法。</small></span></label>
      <div className="editor-meta"><Clock3 size={13} />记录于 {new Date(entry.createdAt).toLocaleString('zh-CN')}</div>
      <footer className="editor-footer"><button className="text-button danger" type="button" onClick={() => { onDelete(entry); onClose() }}><Trash2 size={15} />删除记录</button><button className="button primary" type="submit" disabled={!draft.title.trim()}>保存想法<Check size={16} /></button></footer>
    </form>
  </Modal>
}

function NoteCard({ entry, open, toggleTask, complete, restore, newId }: { entry: Entry; open: () => void; toggleTask: () => void; complete: () => void; restore: () => void; newId: string | null }) {
  return <article className={`note-card cat-${CATEGORIES.indexOf(entry.category)} ${entry.done ? 'is-done' : ''} ${newId === entry.id ? 'just-added' : ''}`} style={{ viewTransitionName: `note-${entry.id}` } as CSSProperties}>
    <div className="note-top"><CategoryLabel category={entry.category} /><span className="note-time" title={new Date(entry.createdAt).toLocaleString('zh-CN')}>{relativeTime(entry.done ? entry.completedAt ?? entry.createdAt : entry.createdAt)}</span></div>
    <button className="note-content" onClick={open} aria-label={`编辑：${entry.title}`}><h3>{entry.title}</h3><p>{entry.body || '留一点空白，等下一个想法。'}</p></button>
    <div className="note-bottom">
      {entry.done ? <span className="done-label"><CheckCheck size={14} />已经做到了</span> : <button className={`task-chip ${entry.isTask ? 'in-pool' : ''}`} onClick={toggleTask} aria-label={`${entry.isTask ? '移出' : '加入'}任务池：${entry.title}`}><span className="tiny-check">{entry.isTask ? <Check size={10} /> : <Plus size={10} />}</span>{entry.isTask ? '在任务池里' : '加入任务池'}</button>}
      {entry.isTask && !entry.done && <span className="note-duration"><Clock3 size={12} />{entry.minutes} 分钟</span>}
      {entry.done ? <button className="icon-button note-action" aria-label={`恢复任务：${entry.title}`} onClick={restore}><RotateCcw size={15} /></button> : entry.isTask && <button className="icon-button note-action complete-note" aria-label={`完成任务：${entry.title}`} onClick={complete}><Check size={15} /></button>}
    </div>
  </article>
}

function Composer({ inputRef, add, defaultCategory }: { inputRef: React.RefObject<HTMLTextAreaElement | null>; add: (entry: Entry) => void; defaultCategory: Category | '全部' }) {
  const [text, setText] = useState('')
  const [category, setCategory] = useState<Category>('灵感')
  const [isTask, setIsTask] = useState(false)
  const [minutes, setMinutes] = useState(15)
  const [focused, setFocused] = useState(false)
  const [saved, setSaved] = useState(false)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => { if (defaultCategory !== '全部') setCategory(defaultCategory) }, [defaultCategory])
  useEffect(() => () => clearTimeout(savedTimer.current), [])
  function save(e?: FormEvent) {
    e?.preventDefault()
    if (!text.trim()) return
    const [title, ...body] = text.trim().split('\n')
    add({ id: crypto.randomUUID(), title: title.slice(0, 120), body: (title.slice(120) + '\n' + body.join('\n')).trim(), category, minutes, isTask, done: false, createdAt: Date.now() })
    setText('')
    setSaved(true)
    clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setSaved(false), 1500)
    inputRef.current?.focus()
  }
  return <form className={`composer ${focused ? 'focused' : ''} ${text ? 'has-content' : ''} ${saved ? 'just-saved' : ''}`} onSubmit={save}>
    <div className="composer-top"><span className="section-overline"><Feather size={15} />一个新的想法</span><span className={`composer-hint ${saved ? 'save-feedback' : ''}`}>{saved ? <><Check size={12} />想法已收好</> : '不必完整，也不必重要'}</span></div>
    <label className="sr-only" htmlFor="quick-note">写下此刻的想法</label>
    <textarea id="quick-note" ref={inputRef} value={text} maxLength={5000} rows={3} placeholder={'此刻，你在想什么？\n一个灵感，一件小事，都可以。'} onChange={e => setText(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); save() } }} />
    <div className="composer-guidance"><div><p>第一行记下主题，换行把想法慢慢展开。</p></div></div>
    <div className="composer-bottom"><div className="composer-options"><label className="select-chip"><span className={`category-dot cat-${CATEGORIES.indexOf(category)}`} /><select aria-label="记录分类" value={category} onChange={e => setCategory(e.target.value as Category)}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select><ChevronDown size={12} /></label>
      <button className={`composer-task ${isTask ? 'selected' : ''}`} type="button" aria-pressed={isTask} onClick={() => setIsTask(!isTask)}><span className="tiny-check">{isTask ? <Check size={10} /> : <Plus size={11} />}</span>也是个待办</button>
      {isTask && <label className="select-chip duration-select"><Clock3 size={12} /><select aria-label="预计耗时" value={minutes} onChange={e => setMinutes(Number(e.target.value))}>{times.map(t => <option key={t} value={t}>{t} 分钟</option>)}</select></label>}</div>
      <button className="button primary save-button" disabled={!text.trim()} type="submit">记下来<ArrowUpRight size={16} /></button></div>
    <div className="composer-footnote"><span><Command size={10} /> / Ctrl + Enter 快速记录</span><span>{text.length > 0 ? `${text.length} / 5000` : '让想法先有个着落。'}</span></div>
    {saved && <span className="saved-slip" aria-hidden="true"><Feather size={13} /><i /><i /></span>}
  </form>
}

type Phase = 'idle' | 'shuffling' | 'revealed' | 'active' | 'complete'

function DrawStage({ candidates, active, onAccept, onComplete, onRelease, compact = false, onExpand }: { candidates: Entry[]; active: Entry | null; onAccept: (entry: Entry) => void; onComplete: (entry: Entry) => void; onRelease: () => void; compact?: boolean; onExpand?: () => void }) {
  const [phase, setPhase] = useState<Phase>(active ? 'active' : 'idle')
  const [result, setResult] = useState<Entry | null>(active)
  const [drawCount, setDrawCount] = useState(0)
  const [dragging, setDragging] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const completeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const starting = useRef(false)
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const deckRef = useRef<HTMLDivElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  const candidatesRef = useRef(candidates)
  candidatesRef.current = candidates
  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(completeTimer.current) }, [])
  useEffect(() => {
    if (active) { setResult(active); setPhase('active') }
    else setPhase(p => p === 'active' ? 'idle' : p)
  }, [active])
  useEffect(() => {
    if (phase === 'revealed' && !candidates.some(e => e.id === result?.id)) { setResult(null); setPhase('idle') }
  }, [candidates, phase, result])
  useEffect(() => {
    if (phase !== 'revealed') return
    const frame = requestAnimationFrame(() => resultRef.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [phase])

  function draw() {
    if (starting.current || phase === 'shuffling' || !candidates.length || phase === 'active') return
    starting.current = true
    setDragging(false)
    setPhase('shuffling')
    setDrawCount(n => n + 1)
    timer.current = setTimeout(() => {
      let pool = candidatesRef.current
      if (pool.length > 1) pool = pool.filter(entry => entry.id !== result?.id)
      if (pool.length) { setResult(pool[randomIndex(pool.length)]); setPhase('revealed') }
      else { setResult(null); setPhase('idle') }
      starting.current = false
    }, reducedMotion() ? 100 : 1550)
  }

  function finish() {
    if (!result) return
    setPhase('complete')
    onComplete(result)
    completeTimer.current = setTimeout(() => { setResult(null); setPhase('idle') }, reducedMotion() ? 100 : 1700)
  }
  const showResult = phase === 'revealed' || phase === 'active'
  return <section className={`draw-stage ${compact ? 'compact' : ''} phase-${phase}`} aria-label={compact ? '随机任务预览' : '随机抽取任务'}>
    <div className="stage-heading"><span className="section-overline"><Sparkles size={14} />{phase === 'active' ? '此刻，只做这一件' : compact ? '给选择一点随机' : '你负责开始，剩下的交给随机'}</span>{compact && <button className="icon-button" aria-label="打开任务抽取" onClick={onExpand}><MoveUpRight size={16} /></button>}</div>
    <div className="stage-canvas">
      <div className="orbit orbit-one" /><div className="orbit orbit-two" />
      <span className="stage-spark spark-one">＋</span><span className="stage-spark spark-two">✳</span><span className="stage-spark spark-three">＋</span>
      {phase === 'complete' ? <div className="completion-scene" role="status"><span className="completion-check"><Check size={34} strokeWidth={1.8} /></span><h3>又完成了一件小事。</h3><p>今天，也在一点点向前。</p>{!reducedMotion() && Array.from({ length: 12 }, (_, i) => <i className="confetti" key={i} style={{ '--angle': `${i * 30}deg`, '--distance': `${70 + i % 3 * 24}px` } as CSSProperties} />)}</div>
      : showResult && result ? <div ref={resultRef} tabIndex={-1} aria-label={`抽到了：${result.title}`} className={`result-card cat-${CATEGORIES.indexOf(result.category)} ${phase === 'active' ? 'accepted' : ''}`} key={result.id}>
        <div className="result-top"><CategoryLabel category={result.category} /><span>{phase === 'active' ? <span className="focus-dot" /> : <Sparkles size={15} />}</span></div>
        <span className="result-eyebrow">{phase === 'active' ? '正在专注' : '就是这一件'}</span><h3>{result.title}</h3>{!compact && <p>{result.body}</p>}<span className="result-time"><Clock3 size={13} />给它 {result.minutes} 分钟</span>
        <div className="result-corner"><ArrowDownLeft size={18} /></div>
      </div> : <div ref={deckRef} className={`card-deck ${dragging ? 'is-dragging' : ''}`} key={drawCount}>
        {[-2, -1, 0, 1, 2].map((n, index) => <div key={n} className={`draw-card card-${index}`} style={{ '--position': n, '--order': index, zIndex: 5 - Math.abs(n) } as CSSProperties}>
          <div className="card-back"><CardMark /><span className="card-back-label">一件小事</span></div>
        </div>)}
        <button className="deck-touch" type="button" disabled={phase === 'shuffling' || !candidates.length} aria-label="轻推卡片，随机抽取一个任务" onClick={() => { if (!pointer.current) draw() }}
          onPointerDown={e => { if (phase !== 'idle' || !candidates.length) return; pointer.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId) }}
          onPointerMove={e => { if (!pointer.current || !deckRef.current) return; const x = Math.max(-65, Math.min(65, e.clientX - pointer.current.x)); const y = Math.max(-35, Math.min(35, e.clientY - pointer.current.y)); if (Math.abs(x) + Math.abs(y) > 5) setDragging(true); if (!reducedMotion()) deckRef.current.style.transform = `translate(${x * .45}px, ${y * .45}px) rotate(${x * .06}deg)` }}
          onPointerUp={e => { if (!pointer.current) return; pointer.current = null; if (deckRef.current) deckRef.current.style.transform = ''; setDragging(false); e.preventDefault(); draw() }}
          onPointerCancel={() => { pointer.current = null; setDragging(false); if (deckRef.current) deckRef.current.style.transform = '' }} />
      </div>}
      <span className="canvas-caption" aria-live="polite">{phase === 'shuffling' ? '把犹豫洗一洗…' : phase === 'idle' ? candidates.length ? '轻推卡片，看看下一件小事' : '先在随心记里，加入一个待办吧' : phase === 'revealed' ? '无需想太多，先迈出一小步。' : phase === 'active' ? '其他的事，等一会儿也没关系。' : ''}</span>
    </div>
    <div className="stage-controls">
      {phase === 'idle' || phase === 'shuffling' ? <button className={`button ${compact ? 'secondary' : 'primary'} draw-button`} onClick={draw} disabled={phase === 'shuffling' || !candidates.length}>{phase === 'shuffling' ? <><LoaderCircle className="spin" size={16} />正在酝酿一点惊喜</> : <><Dices size={17} />帮我选一件<ArrowRight size={16} /></>}</button>
        : phase === 'complete' ? <span className="completion-footer"><CheckCheck size={15} />这份小小的成就，已经记下了</span>
        : phase === 'revealed' && result ? <><button className="text-button" onClick={draw} disabled={!candidates.length}><RotateCcw size={14} />换一件</button><button className="button primary" onClick={() => { onAccept(result); setPhase('active') }}>就做这件事<ArrowUpRight size={16} /></button></>
        : <><button className="text-button" onClick={() => { onRelease(); setPhase('idle') }}><RotateCcw size={14} />先放回去</button><button className="button primary" onClick={finish}><Check size={16} />完成了</button></>}
    </div>
    {!compact && <div className="stage-bottom"><span><ShieldCheck size={12} />每个候选任务，都有同样的机会</span><span>{candidates.length} 个候选任务</span></div>}
  </section>
}

export default function App() {
  const [initial] = useState(loadStore)
  const [store, setStore] = useState<Store>(initial.store)
  const [storageError, setStorageError] = useState<string | null>(initial.error)
  const [page, setPage] = useState<Page>('notes')
  const [category, setCategory] = useState<Category | '全部'>('全部')
  const [query, setQuery] = useState('')
  const [notesFilter, setNotesFilter] = useState<'all' | 'tasks' | 'ideas'>('all')
  const [timeFilter, setTimeFilter] = useState(0)
  const [excluded, setExcluded] = useState<string[]>([])
  const [editor, setEditor] = useState<string | null>(null)
  const [dataModal, setDataModal] = useState(false)
  const [helpModal, setHelpModal] = useState(false)
  const [newId, setNewId] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const newTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const notify = useCallback((message: string, undo?: () => void) => setToast({ message, undo, id: Date.now() }), [])
  const closeToast = useCallback(() => setToast(null), [])

  useEffect(() => {
    if (initial.error) return
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); setStorageError(null) }
    catch { setStorageError('本地保存失败，请导出备份后检查浏览器存储空间。') }
  }, [store, initial.error])
  useEffect(() => () => clearTimeout(newTimer.current), [])
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (document.querySelector('dialog[open]')) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchRef.current?.focus() }
      if (e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey && !(e.target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable))) {
        e.preventDefault(); setPage('notes'); if (composerRef.current) composerRef.current.focus(); else setTimeout(() => composerRef.current?.focus(), 0)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  const pending = store.entries.filter(e => e.isTask && !e.done)
  const done = store.entries.filter(e => e.done)
  const active = store.entries.find(e => e.id === store.activeId && !e.done && e.isTask) ?? null
  const candidates = pending.filter(e => !excluded.includes(e.id) && (!timeFilter || e.minutes <= timeFilter))
  const eligible = pending.filter(e => !timeFilter || e.minutes <= timeFilter)
  const doneToday = done.filter(e => e.completedAt && new Date(e.completedAt).toDateString() === new Date().toDateString()).length
  const filtered = store.entries.filter(e => (page === 'done' ? e.done : !e.done)
    && (category === '全部' || e.category === category)
    && (notesFilter === 'all' || (notesFilter === 'tasks' ? e.isTask : !e.isTask))
    && (!query || `${e.title} ${e.body}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())))
  const selectedEntry = store.entries.find(e => e.id === editor)

  function navigate(next: Page) { setPage(next); setQuery(''); setCategory('全部'); setNotesFilter('all'); window.scrollTo({ top: 0, behavior: 'instant' }) }
  function add(entry: Entry) {
    setNewId(entry.id)
    transition(() => setStore(s => ({ ...s, welcomed: true, entries: [entry, ...s.entries] })))
    setCategory('全部'); setNotesFilter('all'); setQuery('')
    notify(entry.isTask ? '想法已记下，也加入了任务池。' : '这一刻的想法，留住了。')
    clearTimeout(newTimer.current); newTimer.current = setTimeout(() => setNewId(null), 1800)
  }
  function update(entry: Entry) { setStore(s => ({ ...s, entries: s.entries.map(e => e.id === entry.id ? entry : e), activeId: !entry.isTask && s.activeId === entry.id ? null : s.activeId })); notify('已经保存，灵感还在。') }
  function remove(entry: Entry) {
    transition(() => setStore(s => ({ ...s, entries: s.entries.filter(e => e.id !== entry.id), activeId: s.activeId === entry.id ? null : s.activeId })))
    notify('记录已删除。', () => transition(() => setStore(s => ({ ...s, entries: s.entries.some(e => e.id === entry.id) ? s.entries : [entry, ...s.entries] }))))
  }
  function complete(entry: Entry) {
    transition(() => setStore(s => ({ ...s, activeId: s.activeId === entry.id ? null : s.activeId, entries: s.entries.map(e => e.id === entry.id ? { ...e, done: true, completedAt: Date.now() } : e) })))
    notify('又完成了一件事，做得很好。', () => setStore(s => ({ ...s, entries: s.entries.map(e => e.id === entry.id ? { ...e, done: false, completedAt: undefined } : e) })))
  }
  function restore(entry: Entry) { transition(() => setStore(s => ({ ...s, entries: s.entries.map(e => e.id === entry.id ? { ...e, done: false, completedAt: undefined } : e) }))); notify('已放回任务池，准备再次出发。') }
  function toggleTask(entry: Entry) {
    setStore(s => ({ ...s, activeId: s.activeId === entry.id ? null : s.activeId, entries: s.entries.map(e => e.id === entry.id ? { ...e, isTask: !e.isTask } : e) }))
    notify(entry.isTask ? '已从任务池移出，想法仍然保留。' : '已加入任务池，等下一次遇见。')
  }
  function exportData() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), ...store }, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = `就这件备份-${new Date().toLocaleDateString('sv')}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    notify('备份已导出，给想法多一份安心。')
  }
  async function importData(file: File | undefined) {
    if (!file) return
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('too large')
      const parsed = JSON.parse(await file.text()) as Store
      if (!Array.isArray(parsed.entries) || !parsed.entries.every(isEntry)) throw new Error('invalid')
      setStore(s => { const ids = new Set(s.entries.map(e => e.id)); const incoming = parsed.entries.filter(e => { if (ids.has(e.id)) return false; ids.add(e.id); return true }); return { ...s, welcomed: true, entries: [...incoming, ...s.entries] } })
      notify('备份已合并，现有记录也都保留了。')
    } catch { notify('无法导入，请选择从“就这件”导出的 JSON 备份文件。') }
    if (importRef.current) importRef.current.value = ''
  }

  const drawProps = { candidates, active, onAccept: (entry: Entry) => setStore(s => ({ ...s, activeId: entry.id })), onComplete: complete, onRelease: () => setStore(s => ({ ...s, activeId: null })) }
  return <NoticeContext.Provider value={{ toast, close: closeToast }}><div className="app-shell">
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    <aside className="sidebar">
      <button className="brand" onClick={() => navigate('notes')} aria-label="就这件首页"><BrandMark /><span><strong>就这件<span className="brand-period">.</span></strong><small>想法有着落，今天有方向</small></span></button>
      <div className="workspace-label">我的小小空间</div>
      <nav className="main-nav" aria-label="主导航">{([{ id: 'notes', icon: Feather, count: store.entries.filter(e => !e.done).length }, { id: 'draw', icon: Dices, count: pending.length }, { id: 'done', icon: CircleCheck, count: done.length }] as const).map(item => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><item.icon size={18} strokeWidth={1.65} /><span>{pageLabels[item.id]}</span><span className="nav-count">{String(item.count).padStart(2, '0')}</span></button>)}</nav>
      <div className="sidebar-divider" />
      <div className="sidebar-section-label">想法的抽屉</div>
      <nav className="category-nav" aria-label="记录分类">{CATEGORIES.map((c, i) => <button key={c} className={category === c && page === 'notes' ? 'chosen' : ''} onClick={() => { navigate('notes'); setCategory(c) }}><span className={`category-dot cat-${i}`} /><span>{c}</span><small>{store.entries.filter(e => e.category === c && !e.done).length}</small></button>)}</nav>
      <div className="sidebar-bottom"><div className="daily-card"><div className="daily-card-heading"><span className="daily-sun"><Sun size={16} /></span><span>今天，也在慢慢前进。</span></div><p><strong>{doneToday}</strong> 件小事已经完成</p><div className="progress-marks" aria-label={`今天已完成 ${doneToday} 件任务`}>{Array.from({ length: Math.max(5, Math.min(10, pending.length + doneToday)) }, (_, i) => <span className={i < doneToday ? 'filled' : ''} key={i}>{i < doneToday && <Check size={11} />}</span>)}</div></div>
        <button className="sidebar-data" onClick={() => setDataModal(true)}><HardDrive size={16} /><span>使用与数据</span><ArrowUpRight size={13} /></button><div className="sidebar-footer"><span className="status-dot" />留一点空白，给下一次灵感。</div></div>
    </aside>

    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><span className="mobile-brand"><BrandMark small /></span><span>我的空间</span><span className="breadcrumb-slash">/</span><strong>{pageLabels[page]}</strong></div><div className="topbar-right"><div className="global-search"><Search size={15} /><input ref={searchRef} aria-label="搜索记录" placeholder="搜索记录…" value={query} onChange={e => { setQuery(e.target.value); if (page === 'draw') setPage('notes') }} /><kbd>⌘ K</kbd>{query && <button className="icon-button" aria-label="清空搜索" onClick={() => setQuery('')}><X size={13} /></button>}</div><button className={`save-status ${storageError ? 'error' : ''}`} onClick={() => setDataModal(true)}><span className="status-dot" />{storageError ? '本地保存异常' : '已保存在此设备'}</button><button className="avatar" aria-label="查看使用说明" onClick={() => setHelpModal(true)}>我</button></div></header>

    <main id="main-content" className="main-content">
      <div className="page-intro" key={page}><div><span className="eyebrow date-label">{new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())}<span className="tiny-divider" />让今天，轻一点。</span><h1>{page === 'notes' ? '想到了，就记下来。' : page === 'draw' ? '下一件事，让随机来选。' : '每一小步，都算数。'}</h1><p>{page === 'notes' ? '收好一闪而过的灵感，也留住那些想做的小事。' : page === 'draw' ? '把选择交给一叠卡片，把注意力留给眼前这一件事。' : '这些被你完成的小事，拼出了认真生活的模样。'}</p></div><button className="button secondary page-action" onClick={() => { if (page === 'notes') navigate('draw'); else { navigate('notes'); setTimeout(() => composerRef.current?.focus(), 0) } }}>{page === 'notes' ? <><Dices size={16} />摇个任务<ArrowUpRight size={15} /></> : <><Plus size={16} />记个新想法</>}</button></div>

      {storageError && <div className="storage-warning" role="alert"><HardDrive size={16} /><span>{storageError}</span><button onClick={exportData}>导出备份</button></div>}

      {page === 'notes' && <>
        <div className="capture-grid"><Composer inputRef={composerRef} add={add} defaultCategory={category} /><DrawStage key="preview" {...drawProps} compact onExpand={() => navigate('draw')} /></div>
        <div className="notes-section"><div className="section-toolbar"><div className="section-title"><h2>想法收纳盒</h2><span>{String(filtered.length).padStart(2, '0')}</span></div><div className="filter-tabs" aria-label="记录类型">{([{ key: 'all', text: '全部记录' }, { key: 'ideas', text: '纯粹的灵感' }, { key: 'tasks', text: '想做的小事' }] as const).map(f => <button key={f.key} className={notesFilter === f.key ? 'selected' : ''} aria-pressed={notesFilter === f.key} onClick={() => setNotesFilter(f.key)}>{f.text}</button>)}</div></div>
        {(category !== '全部' || query) && <div className="active-filters">{category !== '全部' && <button onClick={() => setCategory('全部')}>{category}<X size={12} /></button>}{query && <span>搜索“{query}”的结果</span>}<button className="clear-filters" onClick={() => { setCategory('全部'); setQuery(''); setNotesFilter('all') }}>重置筛选</button></div>}
        {!store.welcomed && !query && <div className="welcome-hint"><Sparkles size={14} /><span>先放了几条示例陪你开始。随时编辑，或记下真正属于你的想法。</span><button className="icon-button" aria-label="关闭示例说明" onClick={() => setStore(s => ({ ...s, welcomed: true }))}><X size={13} /></button></div>}
        <div className="notes-grid">{filtered.map(entry => <NoteCard key={entry.id} entry={entry} newId={newId} open={() => setEditor(entry.id)} toggleTask={() => toggleTask(entry)} complete={() => complete(entry)} restore={() => restore(entry)} />)}</div>
        {!filtered.length && <div className="empty-state"><Feather size={27} /><h3>{query || category !== '全部' || notesFilter !== 'all' ? '这一格，还留着空白。' : '第一条想法，会是什么呢？'}</h3><p>{query || category !== '全部' || notesFilter !== 'all' ? '试试其他关键词，或换一个分类。' : '不需要一个大计划，一句话就可以开始。'}</p><button className="button secondary" onClick={() => { setQuery(''); setCategory('全部'); setNotesFilter('all'); composerRef.current?.focus() }}><Plus size={15} />记个新想法</button></div>}
        <div className="notes-end"><span /><Feather size={13} /><span>想法不用排队，想到就来。</span><span /></div></div>
      </>}

      {page === 'draw' && <div className="draw-layout"><div className="draw-main"><div className="draw-filterbar"><span><SlidersHorizontal size={15} />此刻，我有</span><div className="time-tabs">{[{ value: 0, text: '不限时间' }, { value: 15, text: '15 分钟' }, { value: 30, text: '30 分钟' }].map(t => <button key={t.value} className={timeFilter === t.value ? 'selected' : ''} aria-pressed={timeFilter === t.value} onClick={() => setTimeFilter(t.value)}>{t.text}</button>)}</div></div><DrawStage key="full" {...drawProps} /><div className="draw-note"><p>不是替你安排整个人生，<br /><strong>只是帮你轻轻地，开始下一件事。</strong></p><Feather size={23} strokeWidth={1.2} /></div></div>
        <aside className="pool-panel"><div className="pool-header"><h2>今天的候选池<span>{String(candidates.length).padStart(2, '0')}</span></h2></div><p className="pool-description">勾选此刻愿意做的事，剩下的交给随机。</p><div className="pool-list">{eligible.map(entry => <label key={entry.id} className={`pool-item ${excluded.includes(entry.id) ? 'excluded' : ''}`}><input type="checkbox" checked={!excluded.includes(entry.id)} onChange={() => setExcluded(s => s.includes(entry.id) ? s.filter(id => id !== entry.id) : [...s, entry.id])} /><span className="pool-checkbox"><Check size={12} /></span><div><span className="pool-title">{entry.title}</span><span className="pool-meta"><CategoryLabel category={entry.category} /><span>·</span>{entry.minutes} 分钟</span></div></label>)}</div>
        {!eligible.length && <div className="pool-empty"><Coffee size={25} /><p>{pending.length ? '这个时间里，还没有候选任务。' : '候选池还是空的。'}<br />{pending.length ? '试试放宽一点时间。' : '在随心记里，把小事加入任务池。'}</p></div>}
        {eligible.length > 0 && <button className="text-button select-all" onClick={() => { const ids = new Set(eligible.map(e => e.id)); const allSelected = eligible.every(e => !excluded.includes(e.id)); setExcluded(s => allSelected ? [...new Set([...s, ...ids])] : s.filter(id => !ids.has(id))) }}><CheckCheck size={14} />{eligible.every(e => !excluded.includes(e.id)) ? '暂时全部取消' : '全部加入候选'}</button>}
        <button className="pool-add" onClick={() => { navigate('notes'); setTimeout(() => composerRef.current?.focus(), 0) }}><Plus size={15} />再添一件小事<ArrowUpRight size={14} /></button><div className="pool-footnote"><span>小提醒</span><p>重要又紧急的事，可以直接去做。<br />随机，留给那些让你犹豫的小选择。</p></div></aside></div>}

      {page === 'done' && <div className="done-page"><div className="done-summary"><span className="done-summary-icon"><CheckCheck size={28} /></span><div><strong>{done.length}<span>件小事，已被你认真完成</span></strong><p>今天完成 {doneToday} 件。进度不必很快，走过就算数。</p></div></div><div className="section-toolbar"><div className="section-title"><h2>收集一点成就感</h2><span>{filtered.length}</span></div><span className="subtle">按记录时间排列</span></div><div className="notes-grid">{filtered.map(entry => <NoteCard key={entry.id} entry={entry} newId={null} open={() => setEditor(entry.id)} toggleTask={() => toggleTask(entry)} complete={() => complete(entry)} restore={() => restore(entry)} />)}</div>{!filtered.length && <div className="empty-state"><CircleCheck size={30} /><h3>{query ? '没有找到这条完成记录。' : '小小的成就，正在路上。'}</h3><p>{query ? '换个关键词试试。' : '去摇一个任务吧。完成后，它会被好好收在这里。'}</p><button className="button primary" onClick={() => navigate('draw')}><Dices size={16} />从一件小事开始</button></div>}</div>}
      <footer className="page-footer"><span>一点想法 · 一点随机 · 一点行动</span><button onClick={() => setHelpModal(true)}>慢慢来，也很好<ArrowUpRight size={12} /></button></footer>
    </main></div>

    <nav className="mobile-nav" aria-label="手机导航">{([{ id: 'notes', icon: Feather }, { id: 'draw', icon: Dices }, { id: 'done', icon: CircleCheck }] as const).map(item => <button key={item.id} className={page === item.id ? 'active' : ''} aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><item.icon size={20} /><span>{pageLabels[item.id]}</span></button>)}</nav>
    {selectedEntry && <EntryEditor key={selectedEntry.id} entry={selectedEntry} onClose={() => setEditor(null)} onSave={update} onDelete={remove} />}
    {dataModal && <Modal title="你的想法，自己保管。" onClose={() => setDataModal(false)}><div className="data-content"><span className="data-illustration"><HardDrive size={29} /></span><p>记录会自动保存在当前浏览器里。再次打开，想法还在。切换设备或清理浏览器数据前，记得导出一份备份。</p>{storageError && <p className="danger" role="alert">{storageError}</p>}<div className="data-stats"><div><strong>{store.entries.length}</strong><span>条记录</span></div><div><strong>{pending.length}</strong><span>件待办</span></div><div><strong>{done.length}</strong><span>件已完成</span></div></div><button className="button primary full-width" onClick={exportData}><ArrowDownToLine size={16} />导出我的记录</button><button className="button secondary full-width" onClick={() => importRef.current?.click()}><Plus size={16} />从备份合并记录</button><input className="sr-only" type="file" accept="application/json,.json" ref={importRef} onChange={e => void importData(e.target.files?.[0])} />{store.entries.some(e => e.example) && <button className="text-button remove-examples" onClick={() => { const examples = store.entries.filter(e => e.example); setStore(s => ({ ...s, welcomed: true, entries: s.entries.filter(e => !e.example), activeId: examples.some(e => e.id === s.activeId) ? null : s.activeId })); notify('示例已清空，留给你自己的想法。', () => setStore(s => ({ ...s, entries: [...s.entries, ...examples.filter(e => !s.entries.some(item => item.id === e.id))] }))) }}><Trash2 size={14} />清空示例，重新开始</button>}</div></Modal>}
    {helpModal && <Modal title="让开始，变得轻一点。" onClose={() => setHelpModal(false)}><div className="help-content"><BrandMark /><p>“就这件”是一个装下灵感、也帮你开始的小空间。</p><div><span>01</span><p><strong>想到了，就先记下</strong>一句话也可以，不必等想法变完整。</p></div><div><span>02</span><p><strong>想做的事，放进任务池</strong>给它留一个合适的时间，轻轻勾选加入。</p></div><div><span>03</span><p><strong>不知道先做什么，就摇一个</strong>轻推卡片或点一下，今天从这一件开始。</p></div><footer><span><kbd>N</kbd>快速记录</span><span><kbd>⌘ / Ctrl K</kbd>搜索想法</span></footer></div></Modal>}
    {!selectedEntry && !dataModal && !helpModal && <ToastMessage toast={toast} close={closeToast} />}
  </div>
  </NoticeContext.Provider>
}
