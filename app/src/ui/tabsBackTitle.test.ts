import { tabsBackTitle } from './tabsBackTitle'

describe('tabsBackTitle', () => {
  it('names the notes tab for index and for no focused route', () => {
    expect(['Notatki', 'Notes']).toContain(tabsBackTitle('index'))
    expect(tabsBackTitle(undefined)).toBe(tabsBackTitle('index'))
  })

  it('names the tasks tab', () => {
    expect(['Zadania', 'Tasks']).toContain(tabsBackTitle('tasks'))
  })
})
