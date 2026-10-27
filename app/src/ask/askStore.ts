import { create } from 'zustand'
import { GenerationCancelledError } from '../ai/llm'
import type { Note } from '../domain/note'
import type { Task } from '../domain/task'
import type { Language } from '../i18n/language'
import type { AskItem, AskSource } from './askAnswer'
import { askNotes, type AskStage } from './askService'

// The conversation lives only in memory: questions about private notes are not
// written anywhere, and it is gone when the app is closed.

export interface AskMessage {
  id: number
  question: string
  answer: string
  sources: AskSource[]
  cited: AskSource[]
  // Deterministic task lists: lead-in line and rows that open their notes.
  intro?: string
  items?: AskItem[]
  followUps?: string[]
  status: 'pending' | 'done' | 'cancelled' | 'error'
  stage: AskStage | null
  error?: string
}

interface AskState {
  messages: AskMessage[]
  ask: (question: string, input: { notes: readonly Note[]; tasks: readonly Task[]; appLanguage: Language }) => Promise<void>
  stop: () => void
  clear: () => void
}

let controller: AbortController | null = null
let nextId = 1

// A half-written citation ("[", "[1") stays out of sight until it is closed.
export const visible = (raw: string): string =>
  raw.replace(/<think>[\s\S]*?(?:<\/think>|$)/gu, '').replace(/<\/?think>/gu, '').replace(/^\s+/u, '').replace(/\s*\[\d*$/u, '')

// Tokens arrive far faster than the screen can use them: the text is pushed at most this often.
const FLUSH_MS = 50

export const useAskStore = create<AskState>((set, get) => ({
  messages: [],
  ask: async (question, input) => {
    const trimmed = question.trim()
    if (!trimmed || get().messages.some((message) => message.status === 'pending')) return
    const id = nextId++
    const history = get().messages.filter((message) => message.status === 'done').slice(-2).map((message) => ({ question: message.question, answer: message.answer }))
    set({ messages: [...get().messages, { id, question: trimmed, answer: '', sources: [], cited: [], status: 'pending', stage: null }] })
    const patch = (change: Partial<AskMessage>): void =>
      set({ messages: get().messages.map((message) => (message.id === id ? { ...message, ...change } : message)) })
    controller = new AbortController()
    let raw = ''
    let lastFlush = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const flush = (): void => {
      timer = null
      lastFlush = Date.now()
      patch({ answer: visible(raw) })
    }
    try {
      const answer = await askNotes(trimmed, { ...input, history }, {
        signal: controller.signal,
        onStage: (stage) => patch({ stage }),
        onToken: (token) => {
          raw += token
          const wait = FLUSH_MS - (Date.now() - lastFlush)
          if (wait <= 0) flush()
          else if (!timer) timer = setTimeout(flush, wait)
        },
      })
      if (timer) clearTimeout(timer)
      timer = null
      patch({
        answer: answer.text,
        sources: answer.sources,
        cited: answer.cited,
        status: 'done',
        stage: null,
        ...(answer.intro ? { intro: answer.intro } : {}),
        ...(answer.items ? { items: answer.items } : {}),
        ...(answer.followUps?.length ? { followUps: answer.followUps } : {}),
      })
    } catch (error) {
      if (timer) clearTimeout(timer)
      timer = null
      if (error instanceof GenerationCancelledError || controller?.signal.aborted) patch({ status: 'cancelled', stage: null })
      else patch({ status: 'error', stage: null, error: error instanceof Error ? error.message : String(error) })
    } finally {
      controller = null
    }
  },
  stop: () => controller?.abort(),
  clear: () => {
    controller?.abort()
    set({ messages: [] })
  },
}))
