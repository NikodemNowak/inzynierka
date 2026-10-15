const light = [
  {
    id: 'start',
    title: '01 · Pierwsze uruchomienie',
    description:
      'Trzy krótkie kroki. Model jest opcjonalny; można od razu przejść do notatek.',
    nodes: [
      {
        asset: 'onboarding',
        column: 0,
        title: 'Prywatne notatki',
        subtitle: 'Pierwsza korzyść i prosty przycisk Dalej.',
      },
      {
        asset: 'onboarding',
        column: 1,
        title: 'Mowa w tekst',
        subtitle: 'Podgląd transkrypcji pojawiającej się podczas mówienia.',
      },
      {
        asset: 'onboarding',
        column: 2,
        title: 'Opcjonalny model',
        subtitle: 'Pobierz teraz albo pomiń i wróć do tego w Ustawieniach.',
      },
      {
        asset: 'list',
        column: 0,
        title: 'Twoje notatki',
        subtitle: 'Przykład listy z dyskretnym postępem pobierania modelu.',
      },
    ],
    edges: ['Dalej', 'Dalej', 'Pobierz'],
    alternatives: false,
  },
  {
    id: 'recording',
    title: '02 · Nagranie głosowe',
    description:
      'Od wyboru nagrania do gotowej notatki. Tytuł i podsumowanie powstają w swoich docelowych miejscach.',
    nodes: [
      {
        asset: 'list',
        column: 1,
        title: 'Nowa notatka',
        subtitle: 'Plus otwiera wybór: nagraj, importuj lub napisz.',
      },
      {
        asset: 'record',
        column: 0,
        title: 'Gotowość',
        subtitle: 'Czytelna akcja rozpoczęcia w stałym miejscu u dołu.',
      },
      {
        asset: 'record',
        column: 1,
        title: 'Dyktowanie',
        subtitle: 'Stabilny tekst i delikatne pojawianie się kolejnych liter.',
      },
      {
        asset: 'record',
        column: 2,
        title: 'Zapis',
        subtitle: 'Zakończenie nagrania bez nagłej zmiany całego układu.',
      },
      {
        asset: 'ai',
        column: 0,
        title: 'Tworzenie',
        subtitle:
          'Jeden status w pasku; wspólna animacja oczekiwania w polach.',
      },
      {
        asset: 'ai',
        column: 1,
        title: 'Pojawianie się wyniku',
        subtitle: 'Czytelny tekst stopniowo zastępuje delikatną poświatę.',
      },
      {
        asset: 'ai',
        column: 2,
        title: 'Gotowa notatka',
        subtitle: 'Tytuł, data i osobny rząd kategorii. Odtwarzacz oraz treść.',
      },
    ],
    edges: [
      'Nagraj',
      'Rozpocznij',
      'Zatrzymaj',
      'Zapisano',
      'Generowanie',
      'Zakończono',
    ],
    alternatives: false,
  },
  {
    id: 'import',
    title: '03 · Import nagrania',
    description:
      'Wyraźny wybór pliku, spokojny stan pracy i widoczna transkrypcja. Nie pokazujemy procentu, którego nie dostarcza rozpoznawanie mowy.',
    nodes: [
      {
        asset: 'list',
        column: 1,
        title: 'Wybór sposobu',
        subtitle:
          'Import znajduje się w tym samym menu co pozostałe sposoby dodawania.',
      },
      {
        asset: 'create',
        column: 1,
        title: 'Wybierz plik',
        subtitle: 'Jedna główna akcja otwierająca systemowy wybór pliku.',
      },
      {
        asset: 'create',
        column: 2,
        title: 'Transkrypcja pliku',
        subtitle: 'Aktywność procesu i miejsce na dostępne fragmenty tekstu.',
      },
      {
        asset: 'ai',
        column: 0,
        title: 'Tytuł i podsumowanie',
        subtitle: 'Opcjonalne opracowanie transkrypcji przez pobrany model.',
      },
      {
        asset: 'note',
        column: 0,
        title: 'Zapisana notatka',
        subtitle: 'Audio, treść i opracowanie dostępne w jednym widoku.',
      },
    ],
    edges: ['Importuj', 'Wybierz plik', 'Transkrypcja gotowa', 'Zapisano'],
    alternatives: false,
  },
  {
    id: 'manual',
    title: '04 · Notatka ręczna',
    description:
      'Pełna kontrola nad treścią. Podsumowanie jest opcjonalne; ręczne wpisanie notatki nie wymaga generowania.',
    nodes: [
      {
        asset: 'list',
        column: 1,
        title: 'Nowa notatka',
        subtitle: 'Wybierz Napisz ręcznie.',
      },
      {
        asset: 'create',
        column: 0,
        title: 'Formularz',
        subtitle: 'Tytuł, treść, opcjonalne podsumowanie i kategorie.',
      },
      {
        asset: 'extra',
        column: 0,
        title: 'Notatka tekstowa',
        subtitle: 'Naturalny widok treści bez pustego odtwarzacza.',
      },
    ],
    edges: ['Napisz ręcznie', 'Zapisz'],
    alternatives: false,
  },
  {
    id: 'note',
    title: '05 · Czytanie i edycja',
    description:
      'Treść ma pierwszeństwo. Edycja ręczna jest niezależna od ponownego przetwarzania modelem.',
    nodes: [
      {
        asset: 'note',
        column: 0,
        title: 'Początek notatki',
        subtitle: 'Tytuł, audio, podsumowanie i wejście do edycji.',
      },
      {
        asset: 'note',
        column: 1,
        title: 'Dalsza treść',
        subtitle:
          'Transkrypcja, zadania oraz dyskretna akcja proponowania zadań.',
      },
      {
        asset: 'note',
        column: 2,
        title: 'Edytuj ręcznie',
        subtitle: 'Wszystkie pola można poprawić samodzielnie i zapisać.',
      },
    ],
    edges: ['Przewiń', 'Edytuj'],
    alternatives: false,
  },
  {
    id: 'regenerate',
    title: '06 · Ponowne przetwarzanie',
    description:
      'Nowe propozycje nie zastępują treści automatycznie. Każde pole ma własny wybór obecnej albo nowej wersji.',
    nodes: [
      {
        asset: 'note',
        column: 0,
        title: 'Obecna notatka',
        subtitle: 'Akcja Przetwórz ponownie oznaczona ikoną dwóch iskierek.',
      },
      {
        asset: 'rerun',
        column: 0,
        title: 'Potwierdź generowanie',
        subtitle: 'Wyjaśnienie zakresu i zachowania obecnych danych.',
      },
      {
        asset: 'rerun',
        column: 1,
        title: 'Wybierz zmiany',
        subtitle:
          'Osobno: tytuł, podsumowanie i kategoria. Przykład zachowuje obecną kategorię.',
      },
      {
        asset: 'rerun',
        column: 2,
        title: 'Zastosowane zmiany',
        subtitle: 'Notatka otrzymuje tylko wybrane propozycje.',
      },
    ],
    edges: ['Przetwórz', 'Generuj', 'Zastosuj 2 zmiany'],
    alternatives: false,
  },
  {
    id: 'model',
    title: '07 · Model i prywatność',
    description:
      'Pobieranie widać w Ustawieniach i na liście notatek. Prywatność została skrócona do trzech zrozumiałych punktów.',
    nodes: [
      {
        asset: 'settings',
        column: 0,
        title: 'Model opcjonalny',
        subtitle: 'Nazwa, przeznaczenie, rozmiar i jedna akcja pobrania.',
      },
      {
        asset: 'list',
        column: 0,
        title: 'Postęp na liście',
        subtitle:
          'Minimalistyczny pasek pozostaje widoczny po wyjściu z Ustawień.',
      },
      {
        asset: 'settings',
        column: 1,
        title: 'Szczegóły pobierania',
        subtitle: 'Postęp, ilość danych oraz możliwość anulowania.',
      },
      {
        asset: 'settings',
        column: 2,
        title: 'Model gotowy',
        subtitle: 'Wyraźny stan i osobna akcja usunięcia modelu.',
      },
    ],
    edges: ['Pobierz i wróć', 'Otwórz postęp', 'Pobrano'],
    alternatives: false,
  },
  {
    id: 'tasks',
    title: '08 · Propozycje zadań',
    description:
      'Wybierz przydatne propozycje, zanim trafią na listę. Zadania zachowują odnośnik do źródłowej notatki.',
    nodes: [
      {
        asset: 'note',
        column: 1,
        title: 'Zadania z notatki',
        subtitle: 'Akcja Zaproponuj zadania pod treścią.',
      },
      {
        asset: 'extra',
        column: 1,
        title: 'Wybierz propozycje',
        subtitle: 'Zaznaczenia i liczba wybranych pozycji na przycisku.',
      },
      {
        asset: 'list',
        column: 2,
        title: 'Lista zadań',
        subtitle: 'Oddzielone zadania do zrobienia i ukończone.',
      },
    ],
    edges: ['Zaproponuj', 'Dodaj zaznaczone'],
    alternatives: false,
  },
  {
    id: 'states',
    title: '09 · Puste stany i przerwania',
    description:
      'Osobne warianty ekranów. Krótkie wskazówki prowadzą do działania; zachowany tekst można uratować po przerwaniu nagrania.',
    nodes: [
      {
        asset: 'states',
        column: 0,
        title: 'Pierwsza notatka',
        subtitle: 'Plus pozostaje jedynym punktem dodawania.',
      },
      {
        asset: 'states',
        column: 1,
        title: 'Brak wyników',
        subtitle: 'Powrót do listy przez wyczyszczenie wyszukiwania.',
      },
      {
        asset: 'states',
        column: 2,
        title: 'Nagranie przerwane',
        subtitle: 'Informacja o braku audio i akcja Zapisz tekst jako notatkę.',
      },
      {
        asset: 'extra',
        column: 2,
        title: 'Brak zadań',
        subtitle: 'Krótka wskazówka i przejście do notatek.',
      },
    ],
    edges: [],
    alternatives: true,
  },
]
const dark = [
  {
    id: 'dark-start',
    title: '01 · Pierwsze uruchomienie',
    description:
      'Trzy krótkie kroki. Model jest opcjonalny; można od razu przejść do notatek.',
    nodes: [
      {
        asset: 'onboardingDark',
        column: 0,
        title: 'Prywatne notatki',
        subtitle: 'Pierwsza korzyść i prosty przycisk Dalej.',
      },
      {
        asset: 'onboardingDark',
        column: 1,
        title: 'Mowa w tekst',
        subtitle: 'Podgląd transkrypcji pojawiającej się podczas mówienia.',
      },
      {
        asset: 'onboardingDark',
        column: 2,
        title: 'Opcjonalny model',
        subtitle: 'Pobierz teraz albo pomiń i wróć do tego w Ustawieniach.',
      },
      {
        asset: 'listDark',
        column: 0,
        title: 'Twoje notatki',
        subtitle: 'Przykład listy z dyskretnym postępem pobierania modelu.',
      },
    ],
    edges: ['Dalej', 'Dalej', 'Pobierz'],
    alternatives: false,
  },
  {
    id: 'dark-recording',
    title: '02 · Nagranie głosowe',
    description:
      'Od wyboru nagrania do gotowej notatki. Tytuł i podsumowanie powstają w swoich docelowych miejscach.',
    nodes: [
      {
        asset: 'listDark',
        column: 1,
        title: 'Nowa notatka',
        subtitle: 'Plus otwiera wybór: nagraj, importuj lub napisz.',
      },
      {
        asset: 'recordDark',
        column: 0,
        title: 'Gotowość',
        subtitle: 'Czytelna akcja rozpoczęcia w stałym miejscu u dołu.',
      },
      {
        asset: 'recordDark',
        column: 1,
        title: 'Dyktowanie',
        subtitle: 'Stabilny tekst i delikatne pojawianie się kolejnych liter.',
      },
      {
        asset: 'recordDark',
        column: 2,
        title: 'Zapis',
        subtitle: 'Zakończenie nagrania bez nagłej zmiany całego układu.',
      },
      {
        asset: 'aiDark',
        column: 0,
        title: 'Tworzenie',
        subtitle:
          'Jeden status w pasku; wspólna animacja oczekiwania w polach.',
      },
      {
        asset: 'aiDark',
        column: 1,
        title: 'Pojawianie się wyniku',
        subtitle: 'Czytelny tekst stopniowo zastępuje delikatną poświatę.',
      },
      {
        asset: 'aiDark',
        column: 2,
        title: 'Gotowa notatka',
        subtitle: 'Tytuł, data i osobny rząd kategorii. Odtwarzacz oraz treść.',
      },
    ],
    edges: [
      'Nagraj',
      'Rozpocznij',
      'Zatrzymaj',
      'Zapisano',
      'Generowanie',
      'Zakończono',
    ],
    alternatives: false,
  },
  {
    id: 'dark-import',
    title: '03 · Import nagrania',
    description:
      'Wyraźny wybór pliku, spokojny stan pracy i widoczna transkrypcja. Nie pokazujemy procentu, którego nie dostarcza rozpoznawanie mowy.',
    nodes: [
      {
        asset: 'listDark',
        column: 1,
        title: 'Wybór sposobu',
        subtitle:
          'Import znajduje się w tym samym menu co pozostałe sposoby dodawania.',
      },
      {
        asset: 'createDark',
        column: 1,
        title: 'Wybierz plik',
        subtitle: 'Jedna główna akcja otwierająca systemowy wybór pliku.',
      },
      {
        asset: 'createDark',
        column: 2,
        title: 'Transkrypcja pliku',
        subtitle: 'Aktywność procesu i miejsce na dostępne fragmenty tekstu.',
      },
      {
        asset: 'aiDark',
        column: 0,
        title: 'Tytuł i podsumowanie',
        subtitle: 'Opcjonalne opracowanie transkrypcji przez pobrany model.',
      },
      {
        asset: 'noteDark',
        column: 0,
        title: 'Zapisana notatka',
        subtitle: 'Audio, treść i opracowanie dostępne w jednym widoku.',
      },
    ],
    edges: ['Importuj', 'Wybierz plik', 'Transkrypcja gotowa', 'Zapisano'],
    alternatives: false,
  },
  {
    id: 'dark-manual',
    title: '04 · Notatka ręczna',
    description:
      'Pełna kontrola nad treścią. Podsumowanie jest opcjonalne; ręczne wpisanie notatki nie wymaga generowania.',
    nodes: [
      {
        asset: 'listDark',
        column: 1,
        title: 'Nowa notatka',
        subtitle: 'Wybierz Napisz ręcznie.',
      },
      {
        asset: 'createDark',
        column: 0,
        title: 'Formularz',
        subtitle: 'Tytuł, treść, opcjonalne podsumowanie i kategorie.',
      },
      {
        asset: 'extraDark',
        column: 0,
        title: 'Notatka tekstowa',
        subtitle: 'Naturalny widok treści bez pustego odtwarzacza.',
      },
    ],
    edges: ['Napisz ręcznie', 'Zapisz'],
    alternatives: false,
  },
  {
    id: 'dark-note',
    title: '05 · Czytanie i edycja',
    description:
      'Treść ma pierwszeństwo. Edycja ręczna jest niezależna od ponownego przetwarzania modelem.',
    nodes: [
      {
        asset: 'noteDark',
        column: 0,
        title: 'Początek notatki',
        subtitle: 'Tytuł, audio, podsumowanie i wejście do edycji.',
      },
      {
        asset: 'noteDark',
        column: 1,
        title: 'Dalsza treść',
        subtitle:
          'Transkrypcja, zadania oraz dyskretna akcja proponowania zadań.',
      },
      {
        asset: 'noteDark',
        column: 2,
        title: 'Edytuj ręcznie',
        subtitle: 'Wszystkie pola można poprawić samodzielnie i zapisać.',
      },
    ],
    edges: ['Przewiń', 'Edytuj'],
    alternatives: false,
  },
  {
    id: 'dark-regenerate',
    title: '06 · Ponowne przetwarzanie',
    description:
      'Nowe propozycje nie zastępują treści automatycznie. Każde pole ma własny wybór obecnej albo nowej wersji.',
    nodes: [
      {
        asset: 'noteDark',
        column: 0,
        title: 'Obecna notatka',
        subtitle: 'Akcja Przetwórz ponownie oznaczona ikoną dwóch iskierek.',
      },
      {
        asset: 'rerunDark',
        column: 0,
        title: 'Potwierdź generowanie',
        subtitle: 'Wyjaśnienie zakresu i zachowania obecnych danych.',
      },
      {
        asset: 'rerunDark',
        column: 1,
        title: 'Wybierz zmiany',
        subtitle:
          'Osobno: tytuł, podsumowanie i kategoria. Przykład zachowuje obecną kategorię.',
      },
      {
        asset: 'rerunDark',
        column: 2,
        title: 'Zastosowane zmiany',
        subtitle: 'Notatka otrzymuje tylko wybrane propozycje.',
      },
    ],
    edges: ['Przetwórz', 'Generuj', 'Zastosuj 2 zmiany'],
    alternatives: false,
  },
  {
    id: 'dark-model',
    title: '07 · Model i prywatność',
    description:
      'Pobieranie widać w Ustawieniach i na liście notatek. Prywatność została skrócona do trzech zrozumiałych punktów.',
    nodes: [
      {
        asset: 'settingsDark',
        column: 0,
        title: 'Model opcjonalny',
        subtitle: 'Nazwa, przeznaczenie, rozmiar i jedna akcja pobrania.',
      },
      {
        asset: 'listDark',
        column: 0,
        title: 'Postęp na liście',
        subtitle:
          'Minimalistyczny pasek pozostaje widoczny po wyjściu z Ustawień.',
      },
      {
        asset: 'settingsDark',
        column: 1,
        title: 'Szczegóły pobierania',
        subtitle: 'Postęp, ilość danych oraz możliwość anulowania.',
      },
      {
        asset: 'settingsDark',
        column: 2,
        title: 'Model gotowy',
        subtitle: 'Wyraźny stan i osobna akcja usunięcia modelu.',
      },
    ],
    edges: ['Pobierz i wróć', 'Otwórz postęp', 'Pobrano'],
    alternatives: false,
  },
  {
    id: 'dark-tasks',
    title: '08 · Propozycje zadań',
    description:
      'Wybierz przydatne propozycje, zanim trafią na listę. Zadania zachowują odnośnik do źródłowej notatki.',
    nodes: [
      {
        asset: 'noteDark',
        column: 1,
        title: 'Zadania z notatki',
        subtitle: 'Akcja Zaproponuj zadania pod treścią.',
      },
      {
        asset: 'extraDark',
        column: 1,
        title: 'Wybierz propozycje',
        subtitle: 'Zaznaczenia i liczba wybranych pozycji na przycisku.',
      },
      {
        asset: 'listDark',
        column: 2,
        title: 'Lista zadań',
        subtitle: 'Oddzielone zadania do zrobienia i ukończone.',
      },
    ],
    edges: ['Zaproponuj', 'Dodaj zaznaczone'],
    alternatives: false,
  },
  {
    id: 'dark-states',
    title: '09 · Puste stany i przerwania',
    description:
      'Osobne warianty ekranów. Krótkie wskazówki prowadzą do działania; zachowany tekst można uratować po przerwaniu nagrania.',
    nodes: [
      {
        asset: 'statesDark',
        column: 0,
        title: 'Pierwsza notatka',
        subtitle: 'Plus pozostaje jedynym punktem dodawania.',
      },
      {
        asset: 'statesDark',
        column: 1,
        title: 'Brak wyników',
        subtitle: 'Powrót do listy przez wyczyszczenie wyszukiwania.',
      },
      {
        asset: 'statesDark',
        column: 2,
        title: 'Nagranie przerwane',
        subtitle: 'Informacja o braku audio i akcja Zapisz tekst jako notatkę.',
      },
      {
        asset: 'extraDark',
        column: 2,
        title: 'Brak zadań',
        subtitle: 'Krótka wskazówka i przejście do notatek.',
      },
    ],
    edges: [],
    alternatives: true,
  },
]
const crops = {
  list: [
    [45, 19, 465, 956],
    [533, 19, 468, 956],
    [1025, 19, 466, 956],
  ],
  listDark: [
    [45, 19, 465, 956],
    [532, 19, 469, 956],
    [1025, 19, 466, 956],
  ],
  record: [
    [74, 27, 443, 933],
    [544, 27, 448, 933],
    [1018, 26, 445, 934],
  ],
  recordDark: [
    [74, 26, 443, 934],
    [544, 26, 448, 934],
    [1018, 26, 445, 934],
  ],
  note: [
    [51, 19, 470, 946],
    [534, 19, 467, 946],
    [1014, 19, 472, 946],
  ],
  noteDark: [
    [50, 19, 471, 946],
    [534, 19, 467, 946],
    [1014, 19, 472, 946],
  ],
  ai: [
    [52, 19, 468, 945],
    [534, 19, 467, 945],
    [1015, 19, 470, 945],
  ],
  aiDark: [
    [52, 19, 468, 945],
    [534, 19, 467, 945],
    [1014, 19, 471, 945],
  ],
  rerun: [
    [50, 19, 469, 954],
    [534, 19, 467, 954],
    [1016, 19, 470, 954],
  ],
  rerunDark: [
    [50, 19, 469, 954],
    [533, 19, 469, 954],
    [1016, 19, 471, 954],
  ],
  create: [
    [51, 19, 470, 940],
    [534, 19, 467, 940],
    [1014, 19, 471, 940],
  ],
  createDark: [
    [51, 19, 470, 940],
    [534, 19, 467, 941],
    [1014, 19, 471, 941],
  ],
  settings: [
    [46, 19, 461, 960],
    [532, 19, 471, 960],
    [1028, 19, 461, 960],
  ],
  settingsDark: [
    [45, 19, 462, 960],
    [531, 19, 473, 960],
    [1028, 19, 462, 960],
  ],
  onboarding: [
    [47, 20, 460, 945],
    [532, 20, 470, 945],
    [1027, 20, 462, 945],
  ],
  onboardingDark: [
    [46, 20, 462, 945],
    [532, 20, 470, 945],
    [1026, 20, 463, 945],
  ],
  states: [
    [45, 21, 462, 939],
    [531, 20, 468, 940],
    [1024, 21, 465, 940],
  ],
  statesDark: [
    [45, 20, 462, 941],
    [531, 20, 468, 941],
    [1023, 20, 466, 941],
  ],
  extra: [
    [52, 19, 468, 942],
    [535, 19, 466, 942],
    [1015, 19, 470, 942],
  ],
  extraDark: [
    [51, 19, 470, 943],
    [534, 19, 467, 943],
    [1015, 19, 470, 943],
  ],
}
const flows = document.getElementById('flows'),
  jump = document.getElementById('jump'),
  viewer = document.getElementById('viewer')
let theme = matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light',
  columns = columnCount(),
  activeSection = null,
  activeIndex = 0,
  wholeBoard = false
function columnCount() {
  return innerWidth >= 1100
    ? 4
    : innerWidth >= 800
      ? 3
      : innerWidth >= 560
        ? 2
        : 1
}
function arrow(kind = 'right') {
  return kind === 'right'
    ? '<svg viewBox="0 0 42 18" aria-hidden="true"><path d="M1 9H39M32 2l7 7-7 7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    : '<svg viewBox="0 0 28 24" aria-hidden="true"><path d="M5 2v12c0 3 2 5 5 5h15m-6-6 6 6-6 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
}
function setCrop(crop, img, step, full = false) {
  const [x, y, w, h] = full
    ? [0, 0, 1536, 1024]
    : crops[step.asset][step.column]
  crop.style.setProperty('--ratio', String(w / h))
  img.style.width = `${(1536 / w) * 100}%`
  img.style.left = `${(-x / w) * 100}%`
  img.style.top = `${(-y / h) * 100}%`
  img.src = files[step.asset]
}
function createStep(step, index, section, edge) {
  const root = document.createElement('div')
  root.className = 'step'
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'screen-card'
  button.setAttribute(
    'aria-label',
    `Powiększ ekran ${index + 1}: ${step.title}. ${step.subtitle}`,
  )
  const stage = document.createElement('span')
  stage.className = 'phone-stage'
  const crop = document.createElement('span')
  crop.className = 'phone-crop'
  const img = document.createElement('img')
  img.width = 1536
  img.height = 1024
  img.alt = ''
  img.loading = 'eager'
  img.decoding = 'async'
  setCrop(crop, img, step)
  crop.append(img)
  stage.append(crop)
  const head = document.createElement('span')
  head.className = 'screen-head'
  const number = document.createElement('span')
  number.className = 'screen-no'
  number.textContent = String(index + 1).padStart(2, '0')
  const copy = document.createElement('span')
  copy.className = 'screen-copy'
  const title = document.createElement('strong')
  title.textContent = step.title
  const subtitle = document.createElement('small')
  subtitle.textContent = step.subtitle
  copy.append(title, subtitle)
  head.append(number, copy)
  button.append(stage, head)
  root.append(button)
  button.addEventListener('click', () => openViewer(section, index))
  if (edge) {
    const connector = document.createElement('span')
    connector.className = 'connector'
    connector.innerHTML = arrow()
    const label = document.createElement('small')
    label.textContent = edge
    connector.append(label)
    root.append(connector)
  }
  return root
}
function render() {
  flows.replaceChildren()
  jump.replaceChildren()
  document.documentElement.style.setProperty('--columns', columns)
  for (const section of theme === 'light' ? light : dark) {
    const nav = document.createElement('a')
    nav.href = `#${section.id}`
    nav.textContent = section.title.replace(/^\d+ · /, '')
    jump.append(nav)
    const root = document.createElement('section')
    root.id = section.id
    root.className = 'flow'
    const header = document.createElement('div')
    header.className = 'flow-header'
    const copy = document.createElement('div')
    const h = document.createElement('h2')
    h.textContent = section.title
    const p = document.createElement('p')
    p.textContent = section.description
    copy.append(h, p)
    const count = document.createElement('span')
    count.className = 'flow-count'
    const length = section.nodes.length
    count.textContent = `${length} ${length < 5 ? 'ekrany' : 'ekranów'}`
    header.append(copy, count)
    root.append(header)
    const rowCount = Math.ceil(length / columns),
      rowSize = Math.ceil(length / rowCount)
    for (let offset = 0; offset < length; offset += rowSize) {
      if (offset > 0) {
        const continuation = document.createElement('div')
        continuation.className = section.alternatives
          ? 'row-space'
          : 'continuation'
        if (!section.alternatives) {
          continuation.innerHTML = arrow('down')
          const text = document.createElement('span')
          text.textContent = `${section.edges[offset - 1] || 'Dalej'} · `
          const strong = document.createElement('strong')
          strong.textContent = `${String(offset + 1).padStart(2, '0')} ${section.nodes[offset].title}`
          text.append(strong)
          continuation.append(text)
        }
        root.append(continuation)
      }
      const row = document.createElement('div')
      row.className = 'flow-row'
      const nodes = section.nodes.slice(offset, offset + rowSize)
      nodes.forEach((step, i) =>
        row.append(
          createStep(
            step,
            offset + i,
            section,
            !section.alternatives && i < nodes.length - 1
              ? section.edges[offset + i] || 'Dalej'
              : null,
          ),
        ),
      )
      root.append(row)
    }
    flows.append(root)
  }
  const note = document.createElement('p')
  note.className = 'scope-note'
  note.textContent =
    'W obu motywach dostępny jest ten sam komplet ekranów. Zestaw obejmuje centralny plus, ręczną edycję, niezależny wybór propozycji i odzyskiwanie tekstu. Pokazany postęp pobierania to stan wewnątrz aplikacji; powiadomienia systemowe i Live Activity nie są częścią tej planszy.'
  flows.append(note)
}
function updateViewer() {
  const step = activeSection.nodes[activeIndex]
  document.getElementById('viewer-title').textContent = step.title
  document.getElementById('viewer-position').textContent =
    `${activeSection.title.replace(/^\d+ · /, '')} · ekran ${activeIndex + 1} z ${activeSection.nodes.length}`
  document.getElementById('viewer-description').textContent = step.subtitle
  document
    .getElementById('viewer-stage')
    .classList.toggle('full-board', wholeBoard)
  setCrop(
    document.getElementById('viewer-crop'),
    document.getElementById('viewer-image'),
    step,
    wholeBoard,
  )
  document.getElementById('viewer-board').textContent = wholeBoard
    ? 'Pokaż wybrany ekran'
    : 'Pokaż całą planszę'
  const link = document.getElementById('viewer-file')
  link.href = files[step.asset]
  link.download = `notatki-${step.asset}.png`
  document.getElementById('viewer-prev').disabled = activeIndex === 0
  document.getElementById('viewer-next').disabled =
    activeIndex === activeSection.nodes.length - 1
}
function openViewer(section, index) {
  activeSection = section
  activeIndex = index
  wholeBoard = false
  updateViewer()
  viewer.showModal()
}
function moveViewer(delta) {
  const next = activeIndex + delta
  if (next >= 0 && next < activeSection.nodes.length) {
    activeIndex = next
    wholeBoard = false
    updateViewer()
  }
}
document
  .getElementById('viewer-prev')
  .addEventListener('click', () => moveViewer(-1))
document
  .getElementById('viewer-next')
  .addEventListener('click', () => moveViewer(1))
document.getElementById('viewer-board').addEventListener('click', () => {
  wholeBoard = !wholeBoard
  updateViewer()
})
document
  .getElementById('viewer-close')
  .addEventListener('click', () => viewer.close())
viewer.addEventListener('click', (event) => {
  if (event.target === viewer) {
    const r = viewer.getBoundingClientRect()
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      viewer.close()
  }
})
viewer.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    moveViewer(-1)
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    moveViewer(1)
  }
})
function setTheme(next) {
  theme = next
  document.documentElement.dataset.theme = next
  document
    .getElementById('light-button')
    .setAttribute('aria-pressed', String(next === 'light'))
  document
    .getElementById('dark-button')
    .setAttribute('aria-pressed', String(next === 'dark'))
  render()
  window.scrollTo(0, 0)
}
document
  .getElementById('light-button')
  .addEventListener('click', () => setTheme('light'))
document
  .getElementById('dark-button')
  .addEventListener('click', () => setTheme('dark'))
let resizeFrame
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeFrame)
  resizeFrame = requestAnimationFrame(() => {
    const next = columnCount()
    if (next !== columns) {
      columns = next
      render()
    }
  })
})
setTheme(theme)
