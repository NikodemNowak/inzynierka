import { runBenchmarkSuite } from './benchmarkService'
import type { BenchmarkRun } from './benchmarkTypes'

// Fixed Polish dictated notes (56, 346 and 1116 words) used for every speed
// comparison, so one button reproduces the same measurement after each change.
export interface QuickSuiteText {
  id: string
  words: number
  source: string
}

export const QUICK_SUITE_TEXTS: readonly QuickSuiteText[] = [
  {
    id: "pl-quick-56",
    words: 56,
    source: "Krótka notatka na poniedziałek. Rano pokazuję promotorowi najnowszą wersję aplikacji: nagrywanie, lokalna transkrypcja i podsumowanie bez internetu. Po spotkaniu muszę poprawić jeszcze ekran eksportu i wysłać mu link do repozytorium. Ola sprawdzi rozdział drugi do czwartku. Kupiłem bilet na pociąg w sobotę za pięćdziesiąt osiem złotych. W piątek nie mam zajęć, więc zostaję dłużej na uczelni.",
  },
  {
    id: "pl-quick-346",
    words: 346,
    source: "Notatka po spotkaniu z promotorem i sprawy z tego tygodnia.\n\nW poniedziałek o dziesiątej trzydzieści spotkałem się z promotorem w jego gabinecie. Omówiliśmy stan pracy inżynierskiej i aplikacji do notatek głosowych. Zostało mi dokończyć ekran nagrywania, poprawić eksport notatek i przygotować prezentację na poniedziałek. Promotor powiedział, że najważniejsze jest, żeby aplikacja działała na prawdziwym telefonie, a nie tylko w symulatorze. Poprosił też, żebym opisał w pracy, jak działa lokalne przetwarzanie mowy i model językowy. Do następnego spotkania mam wysłać mu krótkie podsumowanie postępów, najlepiej do środy wieczorem.\n\nPóźniej byłem na uczelni i załatwiałem sprawy w dziekanacie. Musiałem złożyć podanie o przedłużenie terminu oddania pracy. Pani w dziekanacie powiedziała, że decyzja będzie w ciągu dwóch tygodni, a termin składania podań mija ósmego listopada. Zapłaciłem też trzysta złotych za druk plakatu na konferencję. Poprawka: nie trzysta, tylko trzysta pięćdziesiąt złotych, bo doszła opłata za format A1. Paragon zostawiłem w szufladzie biurka.\n\nWróciłem do domu około siedemnastej i odebrałem paczkę z nowym dyskiem zewnętrznym. Dwa terabajty, kosztował czterysta dziewięćdziesiąt złotych. Muszę jeszcze skopiować na niego wszystkie nagrania testowe. Uwaga: nie instaluj nowego systemu na tym dysku, bo ma zostać sformatowany pod kopie zapasowe. W sobotę jadę do rodziców, wrócę w niedzielę wieczorem.\n\nMuszę pamiętać o kilku rzeczach na przyszły tydzień: w poniedziałek rano wysłać promotorowi link do repozytorium, we wtorek poprawić testy jednostkowe, w czwartek spotkanie z Oliwią w sprawie rozdziału drugiego. Ola przygotuje listę uwag do piątku. Kuba pożyczył mi książkę o uczeniu maszynowym i muszę mu ją oddać do końca miesiąca. Zamówiłem kawę dla zespołu, przyjdzie w czwartek.\n\nJeszcze jedna rzecz z wieczoru: siedziałem do dwudziestej drugiej nad testami aplikacji i udało się naprawić błąd, który pojawiał się przy odtwarzaniu nagrania po nagrywaniu. Muszę jeszcze sprawdzić ten przypadek na telefonie, bo na komputerze wszystko przechodzi. Jutro rano zrobię kopię repozytorium i wypchnę zmiany na GitHuba. Wieczorem zadzwoniła Ola i ustaliliśmy, że spotkamy się w czwartek o siedemnastej w bibliotece, a nie w kawiarni, bo będzie ciszej. Zapisałem to w kalendarzu.\n\nNa koniec najważniejsze: w piątek nie mam zajęć, więc mogę zostać dłużej na uczelni i dokończyć prezentację.",
  },
  {
    id: "pl-quick-1116",
    words: 1116,
    source: "Poniedziałkowy przegląd projektu i plan na najbliższe dwa tygodnie.\n\nZacznę od pracy inżynierskiej, bo to teraz najważniejsze. W poniedziałek o dziesiątej trzydzieści miałem spotkanie z promotorem, panem Marcinem, w jego gabinecie na wydziale. Rozmawialiśmy głównie o aplikacji do notatek głosowych. Pokazałem mu najnowszą wersję: nagrywanie działa na telefonie, transkrypcja leci lokalnie, a podsumowanie robi mały model językowy bez internetu. Promotor był zadowolony, ale powiedział jasno, że obroni się tylko to, co naprawdę działa na urządzeniu, a nie w symulatorze. Poprosił, żebym do następnego spotkania przygotował krótkie podsumowanie postępów i wysłał mu je mailem. Termin: środa do osiemnastej. Poprawka: nie środa, tylko czwartek do osiemnastej, bo w środę mam zajęcia do późna. Muszę też dopisać w rozdziale czwartym, jak dokładnie działa lokalne przetwarzanie mowy i skąd bierze się model językowy, bo recenzent na pewno o to zapyta.\n\nJeszcze o testach aplikacji. Ostatnia wersja przeszła wszystkie testy na komputerze, trzy tysiące dwieście siedemdziesiąt sześć przypadków, w tym nowy test szybkiego budżetowania okien podsumowania. Na telefonie muszę zmierzyć, ile czasu zajmuje przetwarzanie notatki: najpierw krótkiej, potem trzyminutowej, a na końcu dziesięciominutowej. Chcę zapisać, ile wywołań modelu powstaje i ile tokenów wchodzi do promptu, bo to jest wąskie gardło. Pamiętam, że przy długich nagraniach większość czasu idzie na czytanie promptu, a nie na pisanie odpowiedzi. Po pomiarach wyślę wyniki do porównania i dopiero wtedy zdecyduję, co optymalizować.\n\nDruga sprawa: prezentacja na poniedziałek. Mam piętnaście minut łącznie z pytaniami, więc slajdów nie może być więcej niż dwanaście. Na razie mam osiem i brakuje mi dwóch najważniejszych: schematu przepływu danych i wyników pomiarów. Wyniki muszę wyciągnąć z telefonu po ostatnich testach. Chcę pokazać trzy rzeczy: że transkrypcja działa bez internetu, że podsumowanie powstaje lokalnie i że całość jest prywatna, bo nic nie wychodzi z urządzenia. Ćwiczyć będę w czwartek i w piątek po południu. W sobotę rano zrobię ostatni przegląd slajdów.\n\nTrzecia sprawa: sprawy administracyjne na uczelni. We wtorek byłem w dziekanacie złożyć podanie o przedłużenie terminu oddania pracy. Pani w okienku powiedziała, że decyzja będzie w ciągu dwóch tygodni, czyli najpóźniej do dwudziestego piątego listopada. Termin składania wszystkich podań mija ósmego listopada, więc gdyby coś było nie tak, mam jeszcze czas poprawić. Zapłaciłem trzysta złotych za druk plakatu na konferencję studencką. Poprawka: nie trzysta, tylko trzysta pięćdziesiąt złotych, bo doszła opłata za format A1. Paragon i potwierdzenie przelewu zostawiłem w szufladzie biurka, w niebieskiej teczce.\n\nCzwarta sprawa: zakupy i sprzęt. Wróciłem do domu około siedemnastej i odebrałem paczkę z nowym dyskiem zewnętrznym. Dwa terabajty, kosztował czterysta dziewięćdziesiąt złotych, przyszło etui i kabel w zestawie. Muszę skopiować na niego wszystkie nagrania testowe, razem z tymi trzydziestominutowymi, zanim zacznę cokolwiek kasować z laptopa. Ważne: nie instaluj na tym dysku nowego systemu, bo ma zostać sformatowany pod kopie zapasowe. Zamówiłem też podkładkę pod laptopa z aluminium, sto dwadzieścia złotych, i kawę dla zespołu — ta przyjdzie w czwartek. Nie kupuję nowego mikrofonu, ten, który mam, wystarcza do testów.\n\nPiąta sprawa: wyjazd do rodziców. W sobotę jadę pociągiem o dziewiątej czterdzieści, jestem na miejscu około trzynastej. Bilet kupiłem wcześniej, kosztował pięćdziesiąt osiem złotych. Wracam w niedzielę wieczorem, pociąg o dziewiętnastej dziesięć. Mama prosiła, żebym przywiózł dysk z filmami i ładowarkę do laptopa. Tata chce, żebym pomógł mu skonfigurować nowy router. To nie potrwa długo, najwyżej godzinę. Pamiętaj, żeby zabrać ładowarkę do telefonu, bo tamta została ostatnio u nich.\n\nSzósta sprawa: zdrowie i terminy. W poniedziałek dzwoniłem do przychodni i przesunąłem wizytę u dentysty. Była zaplanowana na wtorek, ale mam wtedy zajęcia. Nowy termin to czwartek piętnastego o szesnastej trzydzieści. Fizjoterapia zostaje bez zmian: środa o ósmej rano, co drugi tydzień. Przypomnienie ustawiłem w kalendarzu. Muszę jeszcze odebrać wyniki badań z laboratorium, będą gotowe w piątek po południu.\n\nSiódma sprawa: finanse i dom. Czynsz za listopad to tysiąc sto pięćdziesiąt złotych, płatny do dziesiątego. Rachunek za prąd przyszedł wyższy niż zwykle, dwieście trzydzieści złotych, bo włączam grzejnik w pokoju. Muszę pamiętać o przelewie na oszczędności, pięćset złotych na początku miesiąca. Zmywarka znowu przecieka, więc wzywam serwisanta w czwartek między dwunastą a czternastą. Nie zamawiaj nowej zmywarki, dopóki serwisant tego nie obejrzy.\n\nÓsma sprawa: książki i pożyczki. Kuba pożyczył mi książkę o uczeniu maszynowym, muszę mu ją oddać do końca miesiąca. Ola przygotuje listę uwag do rozdziału drugiego do piątku. Ja z kolei pożyczyłem Oli przedłużacz i mam go odebrać przy okazji czwartkowego spotkania. W bibliotece mam jedną zaległą książkę, termin minął tydzień temu, trzeba zapłacić karę, chyba dwa złote.\n\nDziewiąta sprawa: spotkania towarzyskie. Ustawiłem się z chłopakami na piłkę w sobotę, ale wypada wtedy wyjazd do rodziców, więc przełożyłem na następny tydzień. Marta zaprosiła nas na kolację w niedzielę, ale wracam wieczorem, więc odpadam. Za to w czwartek po dentyście wpadnę do Kuby na herbatę, bo muszę mu oddać książkę. Ola pytała, czy pójdziemy razem na konferencję w grudniu; trzeba się zarejestrować do końca listopada, opłata studencka to sto dwadzieścia złotych.\n\nDziesiąta sprawa: plan tygodnia. W poniedziałek rano wysyłam promotorowi link do repozytorium i wracam do prezentacji. We wtorek poprawiam testy jednostkowe i robię porządek w repozytorium. W środę zajęcia i fizjoterapia, wieczorem piszę rozdział o ograniczeniach. W czwartek spotkanie z Oliwią, dentysta i serwisant — dzień będzie gęsty, więc wszystko zapisuję w kalendarzu. W piątek kończę slajdy i robię próbę prezentacji. W sobotę jadę do rodziców. W niedzielę odpoczywam.\n\nSekcja jedenasta: drobiazgi i zaległości. Muszę wymienić żarówkę w kuchni, ta miga od tygodnia. W łazience cieknie kran, ale to na razie kropla na minutę, więc nie wzywam hydraulika. Zaległe rzeczy w repozytorium: dwie gałęzie do usunięcia, jeden pull request do przejrzenia i trzy zadania w menedżerze zadań, które czekają od września. Chcę też wreszcie zrobić porządek w zakładkach w przeglądarce, bo mam ich otwarte ze czterdzieści.\n\nSekcja dwunasta: rozmowa z Olą o rozdziale drugim. Ola przejrzała wstęp do rozdziału i powiedziała, że za mało jest o tym, dlaczego wybrałem lokalny model, a za dużo o samych bibliotekach. Mam przepisać pierwszą część tak, żeby najpierw był problem, potem decyzja, a na końcu szczegóły techniczne. Obiecała wysłać listę uwag do piątku. Poprosiła też o dwie rzeczy: żebym pokazał jej schemat przepływu danych, bo chce go zrozumieć przed obroną, i żebym sprawdził, czy w rozdziale są wszystkie źródła, bo na razie przypisy wyglądają niespójnie. Umówiliśmy się, że w czwartek przejdziemy przez to razem na spokojnie.\n\nSekcja trzynasta: plan finansowy na listopad. Po opłaceniu czynszu, prądu i plakatu zostaje mi około sześciuset złotych na resztę miesiąca. Muszę odłożyć pięćset na oszczędności, więc na codzienne wydatki zostaje niewiele. W przyszłym tygodniu ograniczam jedzenie na mieście do dwóch razy. Nie kupuję żadnych nowych książek, dopóki nie przeczytam tych, które już mam.\n\nNa koniec dwie rzeczy do zapamiętania. Pierwsza: w piątek nie mam zajęć, więc mogę zostać dłużej na uczelni i spokojnie dokończyć prezentację. Druga: jeśli zdążę, wydrukuję plakat jeszcze przed weekendem.",
  },
]

export interface QuickSuiteOptions {
  deviceLabel?: string
  signal?: AbortSignal
  onProgress?: (message: string) => void
  onResult?: (run: BenchmarkRun) => void
}

// One cold run per text on the default Qwen3 arm; each run keeps the per-phase
// timings and the backend init log in its saved JSON.
export const runQuickSuite = async (
  options: QuickSuiteOptions,
): Promise<BenchmarkRun[]> => {
  const runs: BenchmarkRun[] = []
  for (const [index, text] of QUICK_SUITE_TEXTS.entries()) {
    const label = `${index + 1}/${QUICK_SUITE_TEXTS.length} · ${text.words}`
    runs.push(
      ...(await runBenchmarkSuite({
        arms: ['qwen3'],
        warmRepeats: 0,
        language: 'pl',
        source: text.source,
        inputMode: 'text',
        fixtureId: text.id,
        sourceProvenance: 'user-text',
        nominalMinutes: null,
        deviceLabel: options.deviceLabel,
        execution: 'foreground',
        signal: options.signal,
        onProgress: (message) => options.onProgress?.(`${label} · ${message}`),
        onResult: options.onResult,
      })),
    )
  }
  return runs
}
