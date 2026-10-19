import { Asset } from 'expo-asset'
import * as FileSystem from 'expo-file-system/legacy'
import { Platform } from 'react-native'
import { prepareBenchmarkAudio } from '../ai/benchmarkAudio'
import { enqueueLlm } from '../ai/llmQueue'
import { ensureModelReady } from '../ai/modelReady'
import { processNoteWithLlm } from '../ai/noteProcessing'
import { PIPELINE_VERSION } from '../ai/processingContext'
import { createTaskProposal } from '../ai/taskProposal'
import { answerQuestion } from '../ask/askAnswer'
import { expandQuestion } from '../ask/askExpand'
import { buildAskIndex, type AskIndex, type AskNote, type AskTask } from '../ask/askIndex'
import { retrieve } from '../ask/askRetrieval'
import { plain, questionLanguage } from '../ask/askText'
import { documentText, embedText, queryText } from '../ask/embedder'
import { isEmbeddingModelDownloaded } from '../ask/embeddingModel'
import type { Language } from '../i18n/language'
import { nativeCapture } from '../stt/nativeCapture'
import { syntheticNotes } from './syntheticNotes'

// One button on the measurements screen: three synthetic recordings go through
// on-device speech recognition, the note pipeline (title, summary, tasks) and
// "Zapytaj notatki" over them plus the eval notebook. Everything is timed and
// saved to Documents/benchmarks/suite-*.json for the PC pull script.

interface SuiteData {
  version: number
  evalNow: string
  recordings: { id: string; language: Language; reference: string }[]
  notes: { id: string; language: Language; createdAt: string; title: string; content: string; summary: string | null; tasks: string[] | null }[]
  questions: { id: string; language: Language; question: string; type: string; answer: string; mustInclude: string[]; mustNotInclude: string[]; sourceNotes: string[]; followUpOf: string | null; liveDate?: boolean }[]
}

const audioModule = (id: string): number => {
  switch (id) {
    case 'pl-plan': return require('../../assets/benchmarks/suite-pl-plan.wav')
    case 'pl-dziennik': return require('../../assets/benchmarks/suite-pl-dziennik.wav')
    default: return require('../../assets/benchmarks/suite-en-trip.wav')
  }
}

const words = (text: string): string[] => plain(text).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/u).filter(Boolean)
// Word error rate against the script the audio was synthesized from.
export const wordErrorRate = (reference: string, hypothesis: string): number => {
  const ref = words(reference)
  const hyp = words(hypothesis)
  let previous = Array.from({ length: hyp.length + 1 }, (_, j) => j)
  for (let i = 1; i <= ref.length; i += 1) {
    const row = [i]
    for (let j = 1; j <= hyp.length; j += 1)
      row[j] = Math.min(previous[j]! + 1, row[j - 1]! + 1, previous[j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1))
    previous = row
  }
  return ref.length ? previous[hyp.length]! / ref.length : 0
}

// "no|not|don" accepts any one of the alternatives.
export const includes = (text: string, wanted: string): boolean =>
  wanted.split('|').some((option) => plain(text).replace(/(\d)[\s.](?=\d{3}\b)/gu, '$1').includes(plain(option)))

const since = (start: number): number => Date.now() - start

export interface SuiteProgress {
  step: string
  done: number
  total: number
}

const transcribe = async (uri: string, locale: 'pl-PL' | 'en-US', signal: AbortSignal): Promise<{ text: string; durationMs: number }> => {
  if (!nativeCapture) throw new Error('Native audio transcription is unavailable')
  await prepareBenchmarkAudio(locale, signal)
  const { durationMs } = await nativeCapture.inspectAudio(uri)
  const parts: string[] = []
  for (let start = 0; start < durationMs; start += 30000) {
    if (signal.aborted) throw new Error('cancelled')
    parts.push(await nativeCapture.transcribeWindow(uri, start, Math.min(30000, durationMs - start), locale, `suite-${Date.now().toString(36)}-${start}`))
  }
  return { text: parts.join(' ').trim(), durationMs }
}

const similarityMap = (query: Int8Array, vectors: Map<number, Int8Array>): Map<number, number> => {
  const norm = (v: Int8Array): number => Math.sqrt(v.reduce((sum, x) => sum + x * x, 0)) || 1
  const qn = norm(query)
  const out = new Map<number, number>()
  for (const [id, vector] of vectors) {
    let dot = 0
    for (let d = 0; d < query.length; d += 1) dot += query[d]! * vector[d]!
    out.set(id, dot / (qn * norm(vector)))
  }
  return out
}

export const runFullFlowSuite = async (onProgress: (progress: SuiteProgress) => void, signal: AbortSignal): Promise<string> => {
  const data = require('./suiteData.json') as SuiteData
  const startedAt = Date.now()
  const result: Record<string, unknown> = { kind: 'full-flow-suite', version: data.version, pipeline: PIPELINE_VERSION, platform: Platform.OS, osVersion: String(Platform.Version), startedAt }
  const total = data.recordings.length * 2 + data.questions.length + 2
  let done = 0
  const step = (name: string): void => onProgress({ step: name, done: done++, total })

  // 1–2. Speech recognition and the note pipeline for each recording.
  const recordings: Record<string, unknown>[] = []
  const suiteNotes: AskNote[] = []
  const suiteTasks: AskTask[] = []
  for (const recording of data.recordings) {
    step(`STT · ${recording.id}`)
    const asset = Asset.fromModule(audioModule(recording.id))
    await asset.downloadAsync()
    const uri = asset.localUri ?? asset.uri
    const sttStarted = Date.now()
    const entry: Record<string, unknown> = { id: recording.id, language: recording.language }
    try {
      const stt = await transcribe(uri, recording.language === 'pl' ? 'pl-PL' : 'en-US', signal)
      Object.assign(entry, { sttMs: since(sttStarted), audioMs: stt.durationMs, transcript: stt.text, wer: wordErrorRate(recording.reference, stt.text) })
    } catch (error) {
      // Without speech recognition the rest of the suite still runs on the script text.
      Object.assign(entry, { sttMs: since(sttStarted), sttError: String(error), transcript: recording.reference, wer: null })
    }
    step(`LLM · ${recording.id}`)
    const content = String(entry.transcript)
    const execution = { taskEvidenceMemo: {}, ...(signal ? { signal } : {}) }
    let calls = 0
    const llm = await enqueueLlm(async () => {
      let modelLoadMs: number | null = null
      const noteStarted = Date.now()
      const note = await processNoteWithLlm(content, () => undefined, (ms) => { modelLoadMs = ms }, recording.language, execution, true)
      const noteMs = since(noteStarted)
      const tasksStarted = Date.now()
      const proposal = await createTaskProposal(content, () => { calls += 1 }, recording.language, execution)
      return { note, proposal, noteMs, tasksMs: since(tasksStarted), modelLoadMs }
    })
    Object.assign(entry, {
      title: llm.note.title, summary: llm.note.summary, tags: llm.note.tags, tasks: llm.proposal.tasks,
      noteMs: llm.noteMs, tasksMs: llm.tasksMs, modelLoadMs: llm.modelLoadMs, taskStatusUpdates: calls,
      warnings: [...(llm.note.warnings ?? []), ...llm.proposal.warnings],
    })
    recordings.push(entry)
    const id = `suite-${recording.id}`
    suiteNotes.push({ id, title: llm.note.title, content, summary: llm.note.summary, createdAt: Date.now(), language: recording.language })
    for (const task of llm.proposal.tasks) suiteTasks.push({ noteId: id, text: task, done: false })
  }
  result.recordings = recordings

  // 3. "Zapytaj notatki" over the eval notebook and the three new notes.
  const evalNotes: AskNote[] = data.notes.map((note) => ({ id: note.id, title: note.title, content: note.content, summary: note.summary, createdAt: new Date(note.createdAt).getTime(), language: note.language }))
  const evalTasks: AskTask[] = data.notes.flatMap((note) => (note.tasks ?? []).map((text) => ({ noteId: note.id, text, done: false })))
  const indexStarted = Date.now()
  const index: AskIndex = buildAskIndex([...evalNotes, ...suiteNotes], [...evalTasks, ...suiteTasks])
  result.askIndex = { notes: index.notes.size, chunks: index.chunks.length, buildMs: since(indexStarted) }

  step('Embedding notes')
  const vectors = new Map<number, Int8Array>()
  const semanticOn = await isEmbeddingModelDownloaded()
  if (semanticOn) {
    const embedStarted = Date.now()
    await enqueueLlm(async () => {
      for (const chunk of index.chunks) {
        if (signal.aborted) throw new Error('cancelled')
        vectors.set(chunk.id, await embedText(documentText(index.notes.get(chunk.noteId)?.title ?? '', chunk.text)))
      }
    })
    result.embedding = { chunks: vectors.size, totalMs: since(embedStarted), msPerChunk: since(embedStarted) / Math.max(1, vectors.size) }
  } else result.embedding = { skipped: 'search model not downloaded' }

  const evalNow = new Date(data.evalNow)
  const byId = new Map(data.questions.map((question) => [question.id, question]))
  const answers = new Map<string, string>()
  const asked: Record<string, unknown>[] = []
  for (const question of data.questions) {
    step(`Ask · ${question.id}`)
    const now = question.liveDate ? new Date() : evalNow
    const parent = question.followUpOf ? byId.get(question.followUpOf) : undefined
    const previous = parent?.question
    const language = questionLanguage(question.question, question.language)
    const entry = await enqueueLlm(async () => {
      await ensureModelReady(() => undefined)
      const expandStarted = Date.now()
      const expansion = await expandQuestion(question.question, previous, signal).catch(() => [])
      const expandMs = since(expandStarted)
      const history = previous ? [previous] : []
      const lexical = retrieve(question.question, index, { now, history, expansion })
      let semanticMs: number | null = null
      let hybrid = lexical
      if (semanticOn) {
        const semanticStarted = Date.now()
        const query = await embedText(queryText(previous && question.question.split(/\s+/u).length <= 4 ? `${previous} ${question.question}` : question.question))
        hybrid = retrieve(question.question, index, { now, history, expansion, semantic: similarityMap(query, vectors) })
        semanticMs = since(semanticStarted)
      }
      const recall = (found: { noteId: string }[]): number =>
        question.sourceNotes.length ? question.sourceNotes.filter((id) => found.some((note) => note.noteId === id)).length / question.sourceNotes.length : 1
      const answerStarted = Date.now()
      let firstTokenMs: number | null = null
      const answer = hybrid.length
        ? await answerQuestion(question.question, hybrid, index, language, {
            now,
            history: parent ? [{ question: parent.question, answer: answers.get(parent.id) ?? '' }] : [],
            onToken: () => { firstTokenMs ??= since(answerStarted) },
            signal,
          })
        : { text: language === 'pl' ? 'Nie znalazłem tego w notatkach.' : "I couldn't find that in your notes.", sources: [], cited: [] }
      return {
        id: question.id, type: question.type, question: question.question, gold: question.answer, text: answer.text,
        cited: answer.cited.map((source) => source.noteId), expansion, retried: answer.retried ?? false, generations: 'generations' in answer ? answer.generations : [],
        sourcesLexical: lexical.map((note) => note.noteId), sourcesHybrid: hybrid.map((note) => note.noteId),
        recallLexical: recall(lexical), recallHybrid: recall(hybrid),
        include: question.mustInclude.length ? question.mustInclude.filter((word) => includes(answer.text, word)).length / question.mustInclude.length : null,
        bad: question.mustNotInclude.filter((word) => includes(answer.text, word)),
        expandMs, semanticMs, firstTokenMs, answerMs: since(answerStarted),
      }
    })
    answers.set(question.id, entry.text)
    asked.push(entry)
  }
  result.questions = asked

  // 4. Word search over a year of notes (10 a day): index build and query time on this phone.
  step('Scale · 1 year')
  const year = syntheticNotes(3650)
  const scaleStarted = Date.now()
  const big = buildAskIndex([...year.notes, ...evalNotes], [...year.tasks, ...evalTasks])
  const buildMs = since(scaleStarted)
  const queryStarted = Date.now()
  const sample = data.questions.slice(0, 10)
  for (const question of sample) retrieve(question.question, big, { now: evalNow })
  result.scale = { notes: big.notes.size, chunks: big.chunks.length, buildMs, retrieveMsPerQuestion: since(queryStarted) / sample.length }

  result.totalMs = since(startedAt)
  const directory = `${FileSystem.documentDirectory}benchmarks/`
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true })
  const path = `${directory}suite-${new Date(startedAt).toISOString().replace(/[:.]/gu, '-')}.json`
  await FileSystem.writeAsStringAsync(path, JSON.stringify(result, null, 1))
  onProgress({ step: 'done', done: total, total })
  return path
}
