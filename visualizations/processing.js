const boards = {
  light: 'assets/04-processing-light.png',
  dark: 'assets/04-processing-dark.png',
}
const sample = document.getElementById('sample'),
  title = document.getElementById('title-text'),
  summary = document.getElementById('summary-text'),
  titleSlot = document.getElementById('title-slot'),
  summarySlot = document.getElementById('summary-slot')
const textTitle = title.textContent,
  textSummary = summary.textContent,
  categories = [
    'Nauka',
    'Pomysły',
    'Praca',
    'Zdrowie',
    'Dom',
    'Finanse',
    'Zakupy',
    'Podróże',
  ]
let theme = matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light',
  count = 2,
  timers = [],
  running = false
const reduced = document.getElementById('reduce')
reduced.checked = matchMedia('(prefers-reduced-motion: reduce)').matches
function delay(fn, ms) {
  timers.push(setTimeout(fn, ms))
}
function clear() {
  timers.forEach(clearTimeout)
  timers = []
}
function renderTags(animate = false) {
  const root = document.getElementById('tags')
  root.replaceChildren()
  for (const [i, text] of categories.slice(0, count).entries()) {
    const tag = document.createElement('span')
    tag.className = 'tag' + (animate ? ' enter' : '')
    tag.textContent = text
    tag.style.setProperty('--delay', i * 40 + 'ms')
    root.append(tag)
  }
  root.style.minHeight = count === 0 ? '0' : '29px'
  root.style.marginBottom = count === 0 ? '10px' : '20px'
}
function reveal(node, text, step) {
  node.replaceChildren()
  let index = 0
  for (const part of text.split(/(\s+)/)) {
    if (/^\s+$/.test(part)) {
      node.append(document.createTextNode(part))
      continue
    }
    const word = document.createElement('span')
    word.className = 'word'
    for (const c of Array.from(part)) {
      const letter = document.createElement('span')
      letter.className = 'letter'
      letter.textContent = c
      letter.style.setProperty('--delay', index++ * step + 'ms')
      word.append(letter)
    }
    node.append(word)
  }
}
function complete() {
  clear()
  running = false
  sample.classList.remove('busy')
  sample.classList.add('still')
  titleSlot.classList.remove('waiting')
  summarySlot.classList.remove('waiting')
  title.textContent = textTitle
  summary.textContent = textSummary
  renderTags()
}
function play() {
  clear()
  running = true
  sample.classList.remove('still')
  sample.classList.add('busy')
  sample.classList.toggle('reduce', reduced.checked)
  title.textContent = ''
  summary.textContent = ''
  titleSlot.classList.add('waiting')
  summarySlot.classList.add('waiting')
  const tags = document.getElementById('tags'),
    height = tags.getBoundingClientRect().height
  tags.replaceChildren()
  tags.style.minHeight = height + 'px'
  if (reduced.checked) {
    delay(complete, 900)
    return
  }
  delay(() => {
    titleSlot.classList.remove('waiting')
    summarySlot.classList.remove('waiting')
    reveal(title, textTitle, 15)
    reveal(summary, textSummary, 8)
  }, 1500)
  delay(() => renderTags(true), 2750)
  delay(() => {
    running = false
    sample.classList.remove('busy')
  }, 3150)
  delay(() => {
    sample.classList.add('still')
  }, 3500)
}
function setTheme(next) {
  theme = next
  document.documentElement.dataset.theme = theme
  document
    .getElementById('light')
    .setAttribute('aria-pressed', String(theme === 'light'))
  document
    .getElementById('dark')
    .setAttribute('aria-pressed', String(theme === 'dark'))
  document.getElementById('board').src = boards[theme]
}
document.getElementById('replay').onclick = play
document.getElementById('again').onclick = play
document.getElementById('light').onclick = () => setTheme('light')
document.getElementById('dark').onclick = () => setTheme('dark')
reduced.onchange = () => {
  sample.classList.toggle('reduce', reduced.checked)
  if (running) complete()
}
document.querySelectorAll('[data-count]').forEach(
  (button) =>
    (button.onclick = () => {
      complete()
      count = Number(button.dataset.count)
      document
        .querySelectorAll('[data-count]')
        .forEach((b) => b.setAttribute('aria-pressed', String(b === button)))
      renderTags()
    }),
)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) complete()
})
setTheme(theme)
complete()
sample.classList.toggle('reduce', reduced.checked)
