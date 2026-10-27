import { useMemo, useRef } from 'react'
import { useNotesStore } from '../state/notesStore'

// noteId -> createdAt. The map keeps its identity while only titles, content or
// other fields change, so task grouping is not recomputed on every note edit.
export const useNoteCreatedMap = (): ReadonlyMap<string, number> => {
  const notes = useNotesStore((state) => state.notes)
  const signature = useMemo(
    () => notes.map((note) => `${note.id}:${note.createdAt}`).join('|'),
    [notes],
  )
  const latest = useRef(notes)
  latest.current = notes
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the signature on purpose
  return useMemo(() => new Map(latest.current.map((note) => [note.id, note.createdAt])), [signature])
}
