import { useMemo, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { formatMoney, todayISO, type Account, type Snapshot } from '../domain'
import {
  buildImport, cellDateISO, guessMapping, parseStatementText, parseTable, prepareImport, reconcile, suggestCategory, withImport,
  type Cell, type ColumnMapping, type ImportKind, type ImportRow, type ParsedStatement,
} from '../domain/import'
import { commitImport, lastAccountId, undoImport } from '../actions'
import { newId } from '../db'
import { readStatementFile, PdfPasswordError, type StatementSource } from '../lib/import/files'
import { fmtDate } from '../lib/format'
import { AccountSelect, Amount, CategorySelect, Field, FormError, PageHeader, Section } from '../components/ui'

type Step =
  | { name: 'source' }
  | { name: 'password'; file: File; incorrect: boolean }
  | { name: 'mapping'; source: Extract<StatementSource, { type: 'table' }> }
  | { name: 'preview'; parsed: ParsedStatement; sourceName: string; lines?: string[] }
  | { name: 'done'; importId: string; txCount: number; planCount: number; undone?: number }

const mappingKey = (accountId: string) => `cuzdan.importMapping.${accountId}`
function loadMapping(accountId: string): ColumnMapping | null {
  try {
    const raw = localStorage.getItem(mappingKey(accountId))
    return raw ? (JSON.parse(raw) as ColumnMapping) : null
  } catch { return null }
}
function saveMapping(accountId: string, m: ColumnMapping) {
  try { localStorage.setItem(mappingKey(accountId), JSON.stringify(m)) } catch { /* ignore */ }
}

export function ImportPage({ snap }: { snap: Snapshot }) {
  const [params] = useSearchParams()
  const accounts = snap.accounts.filter((a) => !a.archived)
  const [accountId, setAccountId] = useState(() => {
    const q = params.get('hesap')
    return accounts.some((a) => a.id === q) ? q! : lastAccountId(snap.accounts) ?? ''
  })
  const account = accounts.find((a) => a.id === accountId)
  const [step, setStep] = useState<Step>({ name: 'source' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const kind = account?.kind === 'credit_card' ? 'card' : 'bank'
  const today = todayISO()

  const restart = () => { setStep({ name: 'source' }); setError(null) }

  const showParsed = (parsed: ParsedStatement, sourceName: string, lines?: string[]) => {
    setStep({ name: 'preview', parsed, sourceName, lines })
  }

  const openFile = async (file: File, password?: string) => {
    if (!account) return
    setError(null)
    setBusy(true)
    try {
      const src = await readStatementFile(file, password)
      if (src.type === 'lines') showParsed(parseStatementText(src.lines, { kind, today }), src.name, src.lines)
      else setStep({ name: 'mapping', source: src })
    } catch (e) {
      if (e instanceof PdfPasswordError) setStep({ name: 'password', file, incorrect: e.incorrect })
      else setError(e instanceof Error ? e.message : 'Dosya okunamadı')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Ekstre içe aktar" action={step.name !== 'source' && step.name !== 'done' ? <button className="btn btn-ghost" onClick={restart}>Baştan başla</button> : undefined} />
      {step.name === 'source' && (
        <SourceStep
          snap={snap} accountId={accountId} setAccountId={setAccountId} busy={busy}
          onFile={(f) => void openFile(f)}
          onText={(text) => account && showParsed(parseStatementText(text.split(/\r?\n/), { kind, today }), 'Yapıştırılan metin', text.split(/\r?\n/))}
        />
      )}
      {step.name === 'password' && (
        <PasswordStep step={step} busy={busy} onSubmit={(pw) => void openFile(step.file, pw)} onCancel={restart} />
      )}
      {step.name === 'mapping' && account && (
        <MappingStep
          rows={step.source.rows} account={account}
          onDone={(m) => {
            saveMapping(account.id, m)
            showParsed(parseTable(step.source.rows, m, { kind, today }), step.source.name)
          }}
        />
      )}
      {step.name === 'preview' && account && (
        <PreviewStep
          key={step.sourceName} snap={snap} account={account} parsed={step.parsed} lines={step.lines} sourceName={step.sourceName}
          onImported={(importId, txCount, planCount) => setStep({ name: 'done', importId, txCount, planCount })}
        />
      )}
      {step.name === 'done' && <DoneStep step={step} account={account} onUndone={(n) => setStep({ ...step, undone: n })} onRestart={restart} />}
      <FormError msg={error} />
    </div>
  )
}

// --- step 1: account + file / text ---

function SourceStep({ snap, accountId, setAccountId, busy, onFile, onText }: {
  snap: Snapshot; accountId: string; setAccountId: (id: string) => void; busy: boolean
  onFile: (f: File) => void; onText: (t: string) => void
}) {
  const [text, setText] = useState('')
  const [drag, setDrag] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const drop = (e: DragEvent) => {
    e.preventDefault()
    setDrag(false)
    const f = e.dataTransfer.files[0]
    if (f) onFile(f)
  }
  return (
    <>
      <Section>
        <Field label="Hangi hesabın ekstresi?" hint="Kredi kartı ekstresi için kartı, banka hesap dökümü için hesabı seçin.">
          <AccountSelect accounts={snap.accounts} value={accountId} onChange={setAccountId} />
        </Field>
      </Section>
      <Section title="Dosya">
        <div
          className={`grid place-items-center rounded-2xl border-2 border-dashed p-6 text-center transition ${
            drag ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30' : 'border-slate-200 dark:border-slate-700'
          }`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={drop}
        >
          <p className="text-sm text-slate-500">PDF, Excel (.xlsx) veya CSV dosyasını buraya bırakın</p>
          <button className="btn btn-primary mt-3" disabled={busy || !accountId} onClick={() => input.current?.click()}>
            {busy ? 'Okunuyor...' : 'Dosya seç'}
          </button>
          <input
            ref={input} type="file" className="hidden" accept=".pdf,.xlsx,.csv,.tsv,.txt,application/pdf,text/csv"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f) }}
          />
          <p className="mt-3 text-xs text-slate-400">Dosya cihazınızda okunur, hiçbir yere gönderilmez.</p>
        </div>
      </Section>
      <Section title="Ya da metni yapıştırın">
        <textarea
          className="input min-h-32 font-mono text-xs"
          placeholder={'İnternet bankacılığından kopyaladığınız satırlar, ör.\n12.09.2026 MIGROS KADIKOY 1.250,40\n14.09.2026 ÖDEME -5.000,00'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn btn-soft mt-2" disabled={!text.trim() || !accountId} onClick={() => onText(text)}>Metni çözümle</button>
      </Section>
    </>
  )
}

// --- password ---

function PasswordStep({ step, busy, onSubmit, onCancel }: {
  step: Extract<Step, { name: 'password' }>; busy: boolean; onSubmit: (pw: string) => void; onCancel: () => void
}) {
  const [pw, setPw] = useState('')
  const submit = (e: FormEvent) => { e.preventDefault(); if (pw) onSubmit(pw) }
  return (
    <Section title="Şifreli PDF">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-slate-500">
          <b>{step.file.name}</b> şifreli. Bankanın e-postasında belirtilen şifreyi girin (genelde T.C. kimlik no veya doğum tarihinden türetilir). Şifre saklanmaz.
        </p>
        <Field label="PDF şifresi">
          <input className="input" type="password" autoComplete="off" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <FormError msg={step.incorrect ? 'Şifre yanlış, tekrar deneyin.' : null} />
        <div className="flex gap-2">
          <button className="btn btn-primary" disabled={!pw || busy}>{busy ? 'Açılıyor...' : 'Aç'}</button>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Vazgeç</button>
        </div>
      </form>
    </Section>
  )
}

// --- column mapping (Excel / CSV) ---

function MappingStep({ rows, account, onDone }: { rows: Cell[][]; account: Account; onDone: (m: ColumnMapping) => void }) {
  const width = Math.max(0, ...rows.map((r) => r.length))
  const initial = useMemo(() => {
    const saved = loadMapping(account.id)
    const fits = saved && [saved.date, saved.description, saved.amount, saved.debit, saved.credit, saved.balance]
      .every((c) => c === undefined || c < width) && saved.headerRow < rows.length
    return (fits ? saved : guessMapping(rows)) ?? { headerRow: 0, date: 0, description: Math.min(1, width - 1), amount: Math.min(2, width - 1) }
  }, [account.id, rows, width])
  const [m, setM] = useState<ColumnMapping>(initial)
  const split = m.amount === undefined
  const header = m.headerRow >= 0 ? rows[m.headerRow] : undefined
  const colName = (k: number) => `${k + 1}. sütun${header?.[k] ? `: ${String(header[k]).slice(0, 24)}` : ''}`
  const cols = [...Array(width).keys()]
  const preview = parseTable(rows, m, { kind: account.kind === 'credit_card' ? 'card' : 'bank' }).rows.slice(0, 5)
  const valid = m.date !== undefined && m.description !== undefined && (!split || m.debit !== undefined || m.credit !== undefined)

  return (
    <Section title="Sütunları eşleştirin">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Başlık satırı" hint="Veriler bu satırdan sonra başlar">
          <select className="input" value={m.headerRow} onChange={(e) => setM({ ...m, headerRow: Number(e.target.value) })}>
            <option value={-1}>Başlık yok</option>
            {rows.slice(0, 30).map((r, i) => <option key={i} value={i}>{i + 1}. satır: {r.filter((c) => c !== null && c !== '').map((c) => (c instanceof Date ? cellDateISO(c) : String(c))).join(' | ').slice(0, 50)}</option>)}
          </select>
        </Field>
        <Field label="Tarih"><ColumnSelect cols={cols} colName={colName} value={m.date} onChange={(v) => v !== undefined && setM({ ...m, date: v })} /></Field>
        <Field label="Açıklama"><ColumnSelect cols={cols} colName={colName} value={m.description} onChange={(v) => v !== undefined && setM({ ...m, description: v })} /></Field>
        <Field label="Tutar düzeni">
          <select className="input" value={split ? 'split' : 'single'} onChange={(e) => setM(e.target.value === 'split'
            ? { ...m, amount: undefined, debit: m.debit ?? m.amount, credit: m.credit }
            : { ...m, amount: m.amount ?? m.debit ?? 0, debit: undefined, credit: undefined })}>
            <option value="single">Tek tutar sütunu (işaretli)</option>
            <option value="split">Ayrı Borç / Alacak sütunları</option>
          </select>
        </Field>
        {split ? (
          <>
            <Field label="Borç (çıkan)"><ColumnSelect cols={cols} colName={colName} optional value={m.debit} onChange={(v) => setM({ ...m, debit: v })} /></Field>
            <Field label="Alacak (giren)"><ColumnSelect cols={cols} colName={colName} optional value={m.credit} onChange={(v) => setM({ ...m, credit: v })} /></Field>
          </>
        ) : (
          <Field label="Tutar"><ColumnSelect cols={cols} colName={colName} value={m.amount} onChange={(v) => v !== undefined && setM({ ...m, amount: v })} /></Field>
        )}
        <Field label="Bakiye (isteğe bağlı)"><ColumnSelect cols={cols} colName={colName} optional value={m.balance} onChange={(v) => setM({ ...m, balance: v })} /></Field>
      </div>
      <div className="mt-4">
        <div className="label">Önizleme (ilk 5 işlem)</div>
        {preview.length === 0 ? <p className="text-sm text-slate-400">Bu eşleştirmeyle işlem bulunamadı.</p> : (
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {preview.map((r, i) => (
              <li key={i} className="flex justify-between gap-2 py-1.5">
                <span className="truncate"><span className="text-slate-400 tabular-nums">{r.date}</span> {r.description}</span>
                <Amount value={r.direction === 'credit' ? r.amount : -r.amount} signed />
              </li>
            ))}
          </ul>
        )}
      </div>
      <button className="btn btn-primary mt-4" disabled={!valid} onClick={() => onDone(m)}>Devam</button>
    </Section>
  )
}

function ColumnSelect({ value, onChange, optional, cols, colName }: {
  value: number | undefined; onChange: (v: number | undefined) => void; optional?: boolean; cols: number[]; colName: (k: number) => string
}) {
  return (
    <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}>
      {optional && <option value="">Yok</option>}
      {cols.map((k) => <option key={k} value={k}>{colName(k)}</option>)}
    </select>
  )
}

// --- preview ---

const CHIP = {
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
  gray: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  indigo: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300',
  sky: 'bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300',
}
const Chip = ({ tone, children }: { tone: keyof typeof CHIP; children: ReactNode }) =>
  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${CHIP[tone]}`}>{children}</span>

function PreviewStep({ snap, account, parsed, lines, sourceName, onImported }: {
  snap: Snapshot; account: Account; parsed: ParsedStatement; lines?: string[]; sourceName: string
  onImported: (importId: string, txCount: number, planCount: number) => void
}) {
  const today = todayISO()
  const isCard = account.kind === 'credit_card'
  const [paymentSourceId, setPaymentSourceId] = useState('')
  const [initial] = useState(() => prepareImport(parsed, account, snap, today).rows)
  const [rows, setRows] = useState<ImportRow[]>(initial)
  const [fixDiff, setFixDiff] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const update = (id: number, patch: Partial<ImportRow>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const setKind = (r: ImportRow, k: ImportKind) =>
    update(r.id, { kind: k, categoryId: k === 'transfer' ? undefined : suggestCategory(r.row.description, k, snap.categories) })
  const changeSource = (id: string) => {
    setPaymentSourceId(id)
    setRows((rs) => rs.map((r) => (r.looksLikePayment && r.kind !== 'expense' ? { ...r, kind: id ? 'transfer' : 'income', categoryId: id ? undefined : r.categoryId } : r)))
  }

  const source = paymentSourceId || undefined
  const built = useMemo(
    () => buildImport(rows, account, { importId: 'preview', makeId: () => 'preview', now: 0, paymentSourceId: source }),
    [rows, account, source],
  )
  const rec = useMemo(() => reconcile(parsed.meta, account, withImport(snap, built), today), [parsed.meta, account, snap, built, today])
  const adjustment = fixDiff && rec?.diff && rec.kesim ? { amount: rec.diff, date: rec.kesim } : undefined

  const txCount = built.transactions.length + (adjustment ? 1 : 0)
  const planCount = built.plans.length
  const billCount = built.plans.filter((p) => p.kind === 'recurring_expense').length
  const linkedCount = built.transactions.filter((t) => t.occurrenceKey).length
  const skipped = rows.filter((r) => !r.include).length

  const doImport = async () => {
    setErr(null)
    setSaving(true)
    try {
      const importId = newId()
      const final = buildImport(rows, account, { importId, makeId: newId, now: Date.now(), paymentSourceId: source, adjustment })
      await commitImport(final)
      onImported(importId, final.transactions.length, final.plans.length)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Kaydedilemedi')
      setSaving(false)
    }
  }

  if (!rows.length) {
    return (
      <Section title={sourceName}>
        <p className="text-sm text-slate-500">
          Hiç işlem satırı bulunamadı. Satırların tarihle başlayıp tutarla bittiğinden emin olun. Taranmış (resim) PDF'ler desteklenmez;
          bankanızın Excel/CSV dökümünü ya da internet bankacılığından kopyalanan metni deneyin.
        </p>
        {lines && <ExtractedText lines={lines} />}
      </Section>
    )
  }

  const m = parsed.meta
  const hasMeta = Object.values(m).some((v) => v !== undefined)
  return (
    <>
      {(hasMeta || isCard) && (
        <Section title="Ekstre bilgileri">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            {m.statementDate && <Info label="Hesap kesim">{fmtDate(m.statementDate)}</Info>}
            {m.dueDate && <Info label="Son ödeme">{fmtDate(m.dueDate)}</Info>}
            {m.totalDebt !== undefined && <Info label="Dönem borcu">{formatMoney(m.totalDebt)}</Info>}
            {m.minPayment !== undefined && <Info label="Asgari ödeme">{formatMoney(m.minPayment)}</Info>}
            {m.limit !== undefined && <Info label="Kart limiti">{formatMoney(m.limit)}</Info>}
          </div>
          {rec && (
            <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-950/60">
              {rec.kesim === null || rec.engineTotal === null || rec.diff === null ? (
                <p className="text-slate-500">Uygulamada bu kesim tarihine denk gelen ekstre yok. Kartın kesim günü ve açılış tarihini kontrol edin.</p>
              ) : rec.diff === 0 || adjustment ? (
                <p className="text-emerald-600 dark:text-emerald-400">✓ İçe aktarmadan sonra {fmtDate(rec.kesim)} ekstresi bankanın dönem borcuyla aynı{adjustment && ` (${formatMoney(adjustment.amount, { signed: true })} düzeltmeyle)`}.</p>
              ) : (
                <>
                  <p>
                    İçe aktarmadan sonra uygulamadaki {fmtDate(rec.kesim)} ekstresi <b className="tabular-nums">{formatMoney(rec.engineTotal)}</b>,
                    bankanınki <b className="tabular-nums">{formatMoney(rec.bankTotal)}</b>. Fark <Amount value={rec.diff} tone="neutral" signed className="font-semibold" />.
                  </p>
                  <p className="mt-1 text-xs text-slate-500">Atlanan satırları, taksit planlarını ve açılış bakiyesini kontrol edin ya da farkı bir düzeltme işlemiyle kapatın.</p>
                </>
              )}
              {rec.diff !== null && rec.diff !== 0 && (
                <button className={`btn btn-sm mt-2 ${adjustment ? 'btn-ghost' : 'btn-soft'}`} onClick={() => setFixDiff(!fixDiff)}>
                  {adjustment ? 'Düzeltmeyi kaldır' : 'Farkı düzelt'}
                </button>
              )}
            </div>
          )}
          {isCard && rows.some((r) => r.looksLikePayment) && (
            <div className="mt-3">
              <Field label="Kart ödemeleri hangi hesaptan yapıldı?" hint="Seçerseniz ödemeler transfer olarak eklenir ve gelir sayılmaz.">
                <AccountSelect accounts={snap.accounts} value={paymentSourceId} onChange={changeSource} filter={(a) => a.kind !== 'credit_card'} allowEmpty="Seçilmedi (karta gelir olarak eklenir)" />
              </Field>
            </div>
          )}
        </Section>
      )}

      <Section
        title={`${rows.length} satır · ${sourceName}`}
        action={
          <div className="flex flex-wrap justify-end gap-1">
            <button className="btn btn-ghost btn-sm" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, include: true })))}>Tümü</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, include: false })))}>Hiçbiri</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, include: initial[r.id].include })))}>Önerilen</button>
          </div>
        }
      >
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((r) => (
            <PreviewRow key={r.id} r={r} snap={snap} isCard={isCard} transferOk={!!paymentSourceId}
              lead={r.billFollows ? rows[r.billFollows.rowId] : undefined}
              onTrack={(track) => r.billProposal && update(r.id, { billProposal: { ...r.billProposal, track } })}
              onInclude={(v) => update(r.id, { include: v })} onKind={(k) => setKind(r, k)}
              onCategory={(c) => update(r.id, { categoryId: c || undefined })} onMode={(mode) => update(r.id, { mode })} />
          ))}
        </ul>
        {lines && <ExtractedText lines={lines} />}
      </Section>

      <div className="card sticky bottom-20 z-10 flex flex-wrap items-center justify-between gap-3 p-4 md:bottom-4">
        <div className="text-sm">
          <b>{txCount}</b> işlem{planCount - billCount > 0 && <>, <b>{planCount - billCount}</b> taksit planı</>}
          {billCount > 0 && <>, <b>{billCount}</b> yeni fatura</>} eklenecek, <b>{skipped}</b> satır atlanacak
          {linkedCount > 0 && <div className="text-xs text-slate-500">{linkedCount} işlem faturalara bağlanacak (vade ödendi olur)</div>}
        </div>
        <button className="btn btn-primary" disabled={saving || txCount + planCount === 0} onClick={() => void doImport()}>
          {saving ? 'Kaydediliyor...' : 'İçe aktar'}
        </button>
        <FormError msg={err} />
      </div>
    </>
  )
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return <div><div className="text-xs text-slate-400">{label}</div><div className="tabular-nums">{children}</div></div>
}

function ExtractedText({ lines }: { lines: string[] }) {
  return (
    <details className="mt-3 text-xs text-slate-500">
      <summary className="cursor-pointer">Okunan metni göster ({lines.length} satır)</summary>
      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 font-mono dark:bg-slate-950/60">{lines.join('\n')}</pre>
    </details>
  )
}

function PreviewRow({ r, snap, isCard, transferOk, lead, onTrack, onInclude, onKind, onCategory, onMode }: {
  r: ImportRow; snap: Snapshot; isCard: boolean; transferOk: boolean; lead?: ImportRow
  onTrack: (track: boolean) => void; onInclude: (v: boolean) => void; onKind: (k: ImportKind) => void; onCategory: (id: string) => void; onMode: (m: 'tx' | 'plan') => void
}) {
  const plan = r.installment?.plan
  const coveredPlan = r.installment?.coveredBy && r.installment.coveredBy !== 'file'
    ? snap.plans.find((p) => p.id === r.installment?.coveredBy) : undefined
  const kinds: { value: ImportKind; label: string }[] = [
    { value: 'expense', label: 'Gider' },
    { value: 'income', label: isCard ? 'İade/ödeme' : 'Gelir' },
    ...(isCard && transferOk && r.row.direction === 'credit' ? [{ value: 'transfer' as const, label: 'Transfer' }] : []),
  ]
  const asPlan = r.mode === 'plan' && !!plan
  const expense = r.kind === 'expense'
  const leadPlan = lead?.include && lead.kind === 'expense' && lead.billProposal?.track ? lead.billProposal.plan : undefined
  return (
    <li className={`flex gap-3 py-3 ${r.include ? '' : 'opacity-55'}`}>
      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-indigo-600" checked={r.include} onChange={(e) => onInclude(e.target.checked)} aria-label="Dahil et" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="break-words text-sm font-medium">{r.row.description}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              <span className="tabular-nums">{fmtDate(r.row.date)}</span>
              {r.duplicate === 'existing' && <Chip tone="amber">Çift kayıt</Chip>}
              {r.duplicate === 'file' && <Chip tone="amber">Dosyada tekrar</Chip>}
              {r.beforeOpening && <Chip tone="gray">Açılıştan önce</Chip>}
              {r.installment && <Chip tone="indigo">{r.installment.current}/{r.installment.total} taksit</Chip>}
              {r.installment?.coveredBy && <Chip tone="gray">{coveredPlan ? `Taksit planında: ${coveredPlan.name}` : 'Taksit planında'}</Chip>}
              {r.bill?.occurrenceKey && expense && <Chip tone="sky">Fatura: {r.bill.planName}</Chip>}
              {r.bill && !r.bill.occurrenceKey && <Chip tone="amber">Fatura zaten ödendi: {r.bill.planName}</Chip>}
              {r.billProposal?.track && r.include && expense && <Chip tone="sky">Yeni fatura: {r.billProposal.plan.name}</Chip>}
              {leadPlan && expense && <Chip tone="sky">Yeni fatura: {leadPlan.name}</Chip>}
              {r.row.foreign && <Chip tone="gray">{r.row.foreign.currency} {formatMoney(r.row.foreign.amount).replace(' ₺', '')}</Chip>}
            </div>
          </div>
          <Amount value={r.row.direction === 'credit' ? r.row.amount : -r.row.amount} signed className="shrink-0 text-sm font-semibold" />
        </div>
        {r.include && (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {asPlan ? (
              <div className="rounded-xl bg-indigo-50/60 p-2 text-xs text-slate-600 dark:bg-indigo-950/30 dark:text-slate-300 sm:col-span-2">
                Taksit planı oluşturulacak: {formatMoney(plan.totalAmount)}, {plan.installmentCount} taksit, alışveriş {fmtDate(plan.purchaseDate)}
                {plan.preSettledCount > 0 && `, ${plan.preSettledCount} taksit takipten önce`}. Bu ve sonraki taksitler ekstrelere otomatik yansır.
                <button className="ml-1 font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => onMode('tx')}>Tek işlem olarak ekle</button>
              </div>
            ) : (
              <>
                <select className="input py-1.5 text-sm" value={r.kind} onChange={(e) => onKind(e.target.value as ImportKind)} aria-label="Tür">
                  {kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
                {r.kind !== 'transfer' && (
                  <CategorySelect categories={snap.categories} kind={r.kind} value={r.categoryId ?? ''} onChange={onCategory} />
                )}
                {plan && (
                  <button className="text-left text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400 sm:col-span-2" onClick={() => onMode('plan')}>
                    Bunun yerine taksit planı oluştur
                  </button>
                )}
                {r.billProposal && expense && (
                  <label className="flex items-start gap-2 rounded-xl bg-sky-50/70 p-2 text-xs text-slate-600 dark:bg-sky-950/30 dark:text-slate-300 sm:col-span-2">
                    <input type="checkbox" className="mt-0.5 accent-sky-600" checked={r.billProposal.track} onChange={(e) => onTrack(e.target.checked)} />
                    <span>
                      <b>Fatura olarak takip et:</b> "{r.billProposal.plan.name}" faturası oluşturulur (aylık, tahmini {formatMoney(r.billProposal.plan.amount)}
                      {r.billProposal.plan.bill?.autopay && ', otomatik ödeme talimatlı'}) ve bu satır ilk vadesine bağlanır.
                    </span>
                  </label>
                )}
                {r.installment?.coveredBy && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 sm:col-span-2">Bu taksit plan tarafından zaten ekstreye yansıtılıyor; işlem olarak eklemek çift sayar.</p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

// --- done ---

function DoneStep({ step, account, onUndone, onRestart }: {
  step: Extract<Step, { name: 'done' }>; account?: Account; onUndone: (n: number) => void; onRestart: () => void
}) {
  const [busy, setBusy] = useState(false)
  const undo = async () => {
    if (!confirm('Bu içe aktarmada eklenen tüm işlemler, taksit planları ve faturalar silinsin mi?')) return
    setBusy(true)
    try { onUndone(await undoImport(step.importId)) } finally { setBusy(false) }
  }
  return (
    <Section>
      {step.undone !== undefined ? (
        <p className="text-sm">İçe aktarma geri alındı, {step.undone} kayıt silindi.</p>
      ) : (
        <>
          <p className="text-sm">
            <span className="text-emerald-600 dark:text-emerald-400">✓</span> {account?.name ?? 'Hesap'} için <b>{step.txCount}</b> işlem
            {step.planCount > 0 && <> ve <b>{step.planCount}</b> plan (taksit / fatura)</>} eklendi.
          </p>
          <button className="btn btn-danger mt-3" disabled={busy} onClick={() => void undo()}>Bu içe aktarmayı geri al</button>
        </>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link to="/islemler" className="btn btn-soft">İşlemlere git</Link>
        {account?.kind === 'credit_card' && <Link to="/kartlar" className="btn btn-soft">Kartlara git</Link>}
        <Link to="/faturalar" className="btn btn-soft">Faturalara git</Link>
        <button className="btn btn-ghost" onClick={onRestart}>Yeni içe aktarma</button>
      </div>
    </Section>
  )
}
