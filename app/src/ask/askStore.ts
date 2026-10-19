import { create } from 'zustand'
import { GenerationCancelledError } from '../ai/llm'
import type { Note } from '../domain/note'
import type { Task } from '../domain/task'
import type { Language } from '../i18n/language'
import type { AskSource } from './askAnswer'
import { askNotes, type AskStage } from './askService'

// The conversation lives only in memory: questions about private notes are not
// written anywhere, and it is gone when the app is closed.

export interface AskMessage {
  id: number
  question: string
  answer: string
  sources: AskSource[]
  cited: AskSource[]
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

const visible = (raw: string): string => raw.replace(/<think>[\s\S]*?(?:<\/think>|$)/gu, '').replace(/<\/?think>/gu, '').replace(/^\s+/u, '')

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
    try {
      const answer = await askNotes(trimmed, { ...input, history }, {
        signal: controller.signal,
        onStage: (stage) => patch({ stage }),
        onToken: (token) => {
          raw += token
          patch({ answer: visible(raw) })
        },
      })
      patch({ answer: answer.text, sources: answer.sources, cited: answer.cited, status: 'done', stage: null })
    } catch (error) {
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
