import { createTaskProposal } from './taskProposal'
import { extractTasks } from './taskExtraction'

jest.mock('./taskExtraction')

test('drops tasks that only describe the test note itself', async () => {
  jest.mocked(extractTasks).mockResolvedValue([
    'Test nowej notatki chciałbym jutro sobie zapisać',
    'Omówić z doktorem dalsze kroki',
  ])
  const result = await createTaskProposal('x', () => undefined, 'pl')
  expect(result.tasks).toEqual(['Omówić z doktorem dalsze kroki'])
})
