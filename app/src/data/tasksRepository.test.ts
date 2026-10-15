import type { SQLiteDatabase } from 'expo-sqlite'
import { getDatabase } from '../db/database'
import { createTasks } from './tasksRepository'

jest.mock('../db/database', () => ({ getDatabase: jest.fn() }))

const rows: string[] = []
const tx = {
  getFirstAsync: jest.fn(),
  getAllAsync: jest.fn(),
  runAsync: jest.fn(),
}
const db = {
  withExclusiveTransactionAsync: jest.fn(
    async (operation: (transaction: typeof tx) => Promise<void>) => {
      const previous = [...rows]
      try {
        await operation(tx)
      } catch (error) {
        rows.splice(0, rows.length, ...previous)
        throw error
      }
    },
  ),
  runAsync: jest.fn(async (_sql: string, values: unknown[]) => {
    rows.push(String(values[2]))
  }),
}
beforeEach(() => {
  jest.clearAllMocks()
  rows.length = 0
  tx.runAsync.mockReset()
  tx.getFirstAsync.mockResolvedValue({ id: 'n1' })
  tx.getAllAsync.mockResolvedValue([])
  tx.runAsync.mockImplementation(async (_sql: string, values: unknown[]) => {
    rows.push(String(values[2]))
  })
  jest.mocked(getDatabase).mockResolvedValue(db as unknown as SQLiteDatabase)
})

it('saves a group atomically if a later insert fails', async () => {
  tx.runAsync
    .mockImplementationOnce(async (_sql, values: unknown[]) => {
      rows.push(String(values[2]))
    })
    .mockRejectedValueOnce(new Error('disk full'))
  await expect(
    createTasks('n1', ['Send report', 'Call Alice']),
  ).rejects.toThrow('disk full')
  expect(rows).toEqual([])
  expect(db.runAsync).not.toHaveBeenCalled()
})

it('deduplicates accepted tasks against persisted rows and the current selection', async () => {
  tx.getAllAsync.mockResolvedValue([{ text: 'Call Alice' }])
  const created = await createTasks('n1', [
    ' call ALICE ',
    'Send report',
    'Send report',
    ' ',
  ])
  expect(created.map((task) => task.text)).toEqual(['Send report'])
  expect(rows).toEqual(['Send report'])
})

it('does not create orphan tasks after the source note was deleted', async () => {
  tx.getFirstAsync.mockResolvedValue(null)
  await expect(createTasks('n1', ['Call Alice'])).rejects.toThrow()
  expect(rows).toEqual([])
})
