const boards = [
  {
    key: 'list',
    title: 'Lista, dodawanie i zadania',
    states: 'Lista notatek · menu dodawania · lista zadań',
    change:
      'Jeden plus otwiera trzy sposoby dodania. Na liście audio jest metadanymi, a zadania pokazują notatkę źródłową.',
  },
  {
    key: 'record',
    title: 'Nagrywanie i tekst na żywo',
    states: 'Gotowość · dyktowanie · zapis',
    change:
      'Stała pozycja głównej akcji, spokojny licznik i czytelna transkrypcja. Animowana jest końcówka bieżącej frazy; zapisane zdania pozostają nieruchome.',
  },
  {
    key: 'note',
    title: 'Notatka i ręczna edycja',
    states: 'Początek notatki · dalsza treść · edycja',
    change:
      'Odtwarzacz pozostaje w notatce. Ręcznie można zmienić tytuł, podsumowanie, treść i kategorie; pola nie mają przycisków kasujących zawartość.',
  },
  {
    key: 'ai',
    title: 'Powstawanie tytułu i podsumowania',
    states: 'Oczekiwanie · ujawnianie tekstu · wynik',
    change:
      'Jeden status Opracowuję notatkę obejmuje tytuł, podsumowanie i kategorie. Kategorie mają osobny rząd pod datą; większa liczba zawija się do kolejnych linii. Refleks i pojawianie się liter łączą oba pola w jeden proces.',
  },
  {
    key: 'rerun',
    title: 'Ponowne przetwarzanie',
    states: 'Potwierdzenie · wybór zmian · zastosowany wynik',
    change:
      'Najpierw zgoda na generowanie, potem osobny wybór obecnej lub nowej wersji tytułu, podsumowania i kategorii. Dotychczasowa treść pozostaje do decyzji użytkownika.',
  },
  {
    key: 'create',
    title: 'Wpis ręczny i import audio',
    states: 'Nowa notatka · wybór pliku · transkrypcja pliku',
    change:
      'Pełny formularz ręczny i prosty ekran wyboru pliku. Import ma wskaźnik aktywności bez zmyślonego procentu oraz miejsce na pojawiający się tekst.',
  },
  {
    key: 'settings',
    title: 'Model, prywatność i ustawienia',
    states: 'Model niepobrany · pobieranie · model gotowy',
    change:
      'Czytelna karta modelu z trzema stanami, krótka prywatność w punktach i eksport. Nagrywanie nie wymaga pobrania modelu do podsumowań.',
  },
  {
    key: 'onboarding',
    title: 'Pierwsze uruchomienie',
    states: 'Prywatne notatki · mowa w tekst · opcjonalny model',
    change:
      'Trzy kolejne korzyści zamiast przeładowanego ekranu. Pobranie modelu można pominąć, a później uruchomić w Ustawieniach.',
  },
  {
    key: 'states',
    title: 'Puste stany i odzyskiwanie tekstu',
    states: 'Pierwsza notatka · brak wyników · przerwane nagranie',
    change:
      'Puste widoki podpowiadają następny krok. Przy przerwaniu nagrania widać, co zostało zachowane, i można zapisać sam tekst.',
  },
  {
    key: 'extra',
    title: 'Notatka tekstowa i propozycje zadań',
    states: 'Notatka bez audio · wybór propozycji · brak zadań',
    change:
      'Brak zbędnego odtwarzacza w notatce tekstowej. Propozycje zadań wybiera się przed dodaniem, a pusty stan prowadzi z powrotem do notatek.',
  },
]
let theme = matchMedia('(prefers-color-scheme: dark)').matches
  ? 'dark'
  : 'light'
const dialog = document.getElementById('zoom')
function render() {
  document.documentElement.dataset.theme = theme
  document
    .getElementById('light')
    .setAttribute('aria-pressed', String(theme === 'light'))
  document
    .getElementById('dark')
    .setAttribute('aria-pressed', String(theme === 'dark'))
  const root = document.getElementById('boards'),
    nav = document.getElementById('nav')
  root.replaceChildren()
  nav.replaceChildren()
  boards.forEach((b, i) => {
    const section = document.createElement('section')
    section.id = b.key
    const title = document.createElement('h2')
    title.textContent = String(i + 1).padStart(2, '0') + ' · ' + b.title
    const description = document.createElement('p')
    description.textContent = b.change
    const button = document.createElement('button')
    button.className = 'board'
    button.setAttribute('aria-label', 'Powiększ: ' + b.title)
    const image = document.createElement('img')
    image.src = files[b.key + (theme === 'dark' ? 'Dark' : '')]
    image.width = 1536
    image.height = 1024
    image.alt = b.states
    image.decoding = 'async'
    button.append(image)
    const states = document.createElement('p')
    states.className = 'states'
    states.textContent = b.states
    section.append(title, description, button, states)
    root.append(section)
    const link = document.createElement('a')
    link.href = '#' + b.key
    link.textContent = String(i + 1).padStart(2, '0') + ' ' + b.title
    nav.append(link)
    button.onclick = () => {
      document.getElementById('zoom-title').textContent = b.title
      document.getElementById('zoom-image').src = image.src
      const a = document.getElementById('download')
      a.href = image.src
      a.download = 'notatki-' + b.key + '-' + theme + '.png'
      dialog.showModal()
    }
  })
}
document.getElementById('light').onclick = () => {
  theme = 'light'
  render()
}
document.getElementById('dark').onclick = () => {
  theme = 'dark'
  render()
}
document.getElementById('close').onclick = () => dialog.close()
dialog.onclick = (e) => {
  if (e.target === dialog) {
    const r = dialog.getBoundingClientRect()
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      dialog.close()
  }
}
render()
