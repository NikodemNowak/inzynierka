import { dueSaidIn, englishPromptView, isTaskCandidateEn, postprocessTaskLinesEn, rejectReasonEn, splitJoinedEn, tidyTaskEn } from './taskLinesEn'

const draft = (title: string, due: string | null = null, id = 1) => ({ title, due, sourceIds: [id], modelIds: [id] })

test('picks sentences that can carry a task', () => {
  expect(isTaskCandidateEn('I need to send him the chapter by Thursday.')).toBe(true)
  expect(isTaskCandidateEn('The weather was grey all day.')).toBe(false)
  expect(isTaskCandidateEn('Okay.')).toBe(false)
})

test('tidies duty leads and moves a trailing deadline into the due', () => {
  expect(tidyTaskEn(draft('I need to send the chapter')).title).toBe('Send the chapter')
  expect(tidyTaskEn(draft('Pay the electricity bill 212 dollars by the 20th'))).toMatchObject({ title: 'Pay the electricity bill 212 dollars', due: 'by the 20th' })
  expect(tidyTaskEn(draft('Fix the bug', 'because of QA')).due).toBeNull()
})

test('splits two joined actions', () => {
  expect(splitJoinedEn(draft('Book the station and send the invoice')).map((t) => t.title)).toEqual(['Book the station', 'Send the invoice'])
  expect(splitJoinedEn(draft('Buy bread and butter')).map((t) => t.title)).toEqual(['Buy bread and butter'])
})

test('rejects other people, dropped plans and finished things', () => {
  expect(rejectReasonEn(draft('Water the plants'), 'Mark will water the plants while we are away.')).toBe('other person')
  expect(rejectReasonEn(draft('Run the online survey'), 'We are not doing the online survey anymore.')).toBe('cancelled')
  expect(rejectReasonEn(draft('Book the table'), 'Lunch on Friday, I already booked the table.')).toBe('done')
  expect(rejectReasonEn(draft('Visit mum'), 'Mum called, she wants me to visit on Sunday.')).toBeNull()
  expect(rejectReasonEn(draft('Pay the water bill'), 'The water bill has to be paid by the fifteenth.')).toBeNull()
  expect(rejectReasonEn(draft("Don't buy milk"), "Don't buy milk.")).toBe('negated')
})

test('drops a task contained in a fuller one', () => {
  const units = [{ id: 1, text: 'I have to send the invoice to Mr Collins for the logo project.' }]
  expect(postprocessTaskLinesEn([draft('Send the invoice to Mr Collins'), draft('Send the invoice to Mr Collins for the logo project')], units).map((t) => t.title))
    .toEqual(['Send the invoice to Mr Collins for the logo project'])
})

test('short task words still count and keep both tasks', () => {
  const units = [{ id: 1, text: 'I go to the gym now.' }, { id: 2, text: 'I have to go to the shop.' }]
  expect(postprocessTaskLinesEn([draft('Go to the gym'), draft('Go to the shop', null, 2)], units).map((t) => t.title)).toEqual(['Go to the gym', 'Go to the shop'])
})

test('the model sees self-corrections already applied', () => {
  expect(englishPromptView('and at 8 PM sorry 6 PM today I have an appointment')).toBe('and at 6 PM today I have an appointment')
  expect(englishPromptView("I'm going to go by car sorry I'm going to go by tram there")).toBe("I'm going to go by tram there")
  expect(englishPromptView('Sorry I am going to the shop')).toBe('I am going to the shop')
})

test('a deadline must be said in its own sentence', () => {
  expect(dueSaidIn('today', "Sorry I'm going to the shop because I have to buy milk.")).toBe(false)
  expect(dueSaidIn('today 18:00', 'and at 6 PM today I have an appointment')).toBe(true)
  expect(dueSaidIn('Thursday evening', 'he said Thursday evening')).toBe(true)
  expect(dueSaidIn('by the 20th', 'pay it by the twentieth')).toBe(true)
})
