// Which extra cards sit above the notes list. Both are hidden for an empty
// library and while searching, so results start right under the field.
export interface ListExtras {
  readonly ask: boolean
  readonly nextTask: boolean
}

export const listExtras = ({
  noteCount,
  nextTask,
  query,
}: {
  noteCount: number
  nextTask: object | null
  query: string
}): ListExtras => {
  const visible = noteCount > 0 && query.trim().length === 0
  return { ask: visible, nextTask: visible && nextTask !== null }
}
