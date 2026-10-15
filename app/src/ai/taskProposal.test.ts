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

describe('task tidying', () => {
  it('strips a leading conjunction and adds a continued action', async () => {
    const source = 'Test. I muszę omówić co dalej z inżynierem i pokazać postępy w aplikacji w procesie całym pisania inżynierki tworzenia'
    ;(extractTasks as jest.Mock).mockResolvedValueOnce(['i muszę omówić co dalej z inżynierem'])
    const proposal = await createTaskProposal(source, () => undefined, 'pl')
    expect(proposal.tasks).toEqual(['Muszę omówić co dalej z inżynierem', 'Pokazać postępy w aplikacji'])
  })
})
