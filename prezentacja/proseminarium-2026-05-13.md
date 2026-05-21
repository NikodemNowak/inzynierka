# Proseminarium 2026-05-13 (środa)

**Czas:** ~20 minut prezentacji + pytania oponentów (2 oponentów × 2 pytania).
**Format slajdów:** wizualny, mało tekstu — narracja po stronie mówcy. Slajdy = ikony, diagramy, krótkie hasła. Tekst pełny tylko gdy jest to cytat regulacyjny lub kluczowy termin.

---

## Outline slajdów (16 slajdów, ~75 s/slajd)

| # | Slajd | Co jest na slajdzie | Czas |
|---|---|---|---|
| 1 | Tytułowy | Ikona telefonu z kłódką; tytuł pracy; imię; nr albumu; promotor; data | ~30 s |
| 2 | Hook | Ekran chatu z ChatGPT, strzałka do chmury, czerwony znak: „twoje dane są tam" | ~60 s |
| 3 | Wrażliwe konteksty | 4 ikony: 🩺 medycyna, ⚖️ prawo, 💰 finanse, 📰 dziennikarstwo. W stopce: RODO + AI Act | ~75 s |
| 4 | Trend „local-first" | 4 loga: Apple Intelligence, Gemini Nano, Llama, Qwen. Hasło: „modele zmalały, telefony urosły" | ~75 s |
| 5 | Pomysł — pipeline | Diagram: 🎙️ → 📝 (SFSpeechRecognizer) → 🧠 (LLM, Qwen3-4B) → 📋 (notatka). Cały blok w ramce „TELEFON" | ~75 s |
| 6 | Problem użytkownika | Jedno zdanie wyśrodkowane: „Chcę dyktować notatki, nie wysyłając głosu nikomu." | ~45 s |
| 7 | Co buduję | 3 ikony: 🎙️ nagrywanie, ✂️ streszczanie, 🗂️ organizacja. Krótkie podpisy | ~90 s |
| 8 | Stack | Loga: Expo, React Native, TypeScript, Apple Speech (SFSpeechRecognizer), llama.cpp / llama.rn, Qwen3-4B, Metal | ~75 s |
| 9 | Wybór modelu | Wizualne porównanie: Qwen3-4B (dense, ~3 GB w RAM) ✅ vs Qwen3-30B-A3B (MoE, ~17 GB w RAM) ❌. iPhone 17 Pro = 12 GB. | ~90 s |
| 10 | Architektura | Warstwy: UI / state / domain / data / runtime AI. Strzałki tylko wewnątrz. Brak strzałek na zewnątrz urządzenia. | ~90 s |
| 11 | Privacy by design | Telefon w ramce; przekreślone strzałki wychodzące. Hasło: „network = none" po pierwszym pobraniu modelu | ~60 s |
| 12 | Zakres | Dwie kolumny: „W zakresie" / „Poza zakresem". Krótkie bullety | ~75 s |
| 13 | Harmonogram | Gantt: V — VIII research, VIII — XI implementacja, XI — XII redakcja. Obrona: I 2027 | ~75 s |
| 14 | Ryzyka | 3 ikony: ⚠️ pamięć iOS, ⚠️ jakość PL, ⚠️ niedojrzałe biblioteki. Każde z krótką mitygacją | ~90 s |
| 15 | Status + następne kroki | „Wstępna akceptacja promotora ✅ • Wybór modelu ✅ • POC w toku" | ~60 s |
| 16 | Dziękuję / pytania | Standout, „Pytania?" | — |

Razem: ~17 minut narracji + bufor na zacinanie i przejścia ≈ 20 min.

---

## Skrypt wystąpienia (PL, do nauczenia się — nie czytać z kartki)

> Słowo o stylu: krótkie zdania, oddychać między akapitami. Tempo wolniejsze niż się wydaje na próbie. Kluczowe terminy (RODO, AI Act, Qwen, llama.rn) wymawiać wyraźnie.

### Slajd 1 — Tytułowy (~30 s)

> Cześć, nazywam się Nikodem Nowak, numer albumu 251598. Promotorem mojej pracy jest dr inż. Marcin Kacprowicz. Temat to: aplikacja mobilna do prywatnych notatek głosowych z lokalnym przetwarzaniem mowy i podsumowywaniem przez model językowy.
>
> Zaznaczę od razu — temat został wstępnie zaakceptowany przez promotora, czeka na formalne zatwierdzenie. Dziś chcę pokazać, dlaczego ten kierunek ma sens i co konkretnie zamierzam zbudować.

### Slajd 2 — Hook (~60 s)

> Spójrzcie na ten obrazek. Ktokolwiek z was użył dziś ChatGPT, Geminiego, Copilota — wasze pytanie i wszystko, co napisaliście, poleciało na serwer firmy w USA. To nie jest teoria spiskowa, to jest model biznesowy.
>
> Każde nowoczesne narzędzie typu „AI-notatnik" — Otter, Notion AI, Apple Notes z AI fallback do chmury, Google Recorder — działa w ten sam sposób. Wysyła dźwięk albo transkrypt do chmury i tam się go przetwarza.
>
> Dla większości ludzi to jest OK. Ale są konteksty, w których to po prostu nie przejdzie.

### Slajd 3 — Wrażliwe konteksty (~75 s)

> Lekarz nagrywający notatkę po wizycie z pacjentem. Adwokat dyktujący strategię procesową. Doradca finansowy omawiający portfolio klienta. Dziennikarz rozmawiający ze źródłem, które ufa, że jego głos nie wyciągnie z telefonu.
>
> To są zawody, w których obowiązuje tajemnica zawodowa. RODO mówi o danych szczególnej kategorii. AI Act, który obowiązuje od 2024, wprowadza dodatkowe wymagania dla systemów wysokiego ryzyka.
>
> Dla tych ludzi standardowe AI-notatniki są po prostu niedostępne. Nie mogą ich legalnie używać.

### Slajd 4 — Trend „local-first" (~75 s)

> Dobra wiadomość: trend się zmienia. Apple wypuściło Apple Intelligence, które część zadań robi on-device. Google ma Gemini Nano w Pixel 8 i 9. Meta wypuściła Llama 3.2 — modele 1 i 3 miliardów parametrów zaprojektowane pod telefony. Qwen, model który ja wybiorę, ma serię 3.5 wydaną w lutym tego roku — też pod urządzenia konsumenckie.
>
> Dwa zjawiska się spotkały. Modele zmalały — kwantyzacja, lepsze architektury, sprawniejsze trenowanie. A telefony urosły — iPhone 17 Pro ma dwanaście gigabajtów RAM, neural engine zoptymalizowany pod inferencję.
>
> Pełna prywatność, bez kompromisu na funkcjonalności, jest dziś technicznie realna. Moja praca pokazuje, że da się ją złożyć w produkt.

### Slajd 5 — Pipeline (~75 s)

> Pomysł w jednym diagramie. Użytkownik mówi do telefonu. Apple SFSpeechRecognizer — natywny silnik rozpoznawania mowy iOS w trybie on-device — zamienia głos na tekst strumieniowo. Lokalny LLM — w moim przypadku Qwen3-4B — bierze ten transkrypt i robi z niego streszczenie, listę zadań, tagi. Wszystko ląduje w bazie SQLite na telefonie.
>
> Cały ten pipeline mieści się w ramce z napisem „telefon". Nic z niego nie wychodzi.

### Slajd 6 — Problem użytkownika (~45 s)

> Cała praca da się streścić w jednym zdaniu, które jest na slajdzie. *„Chcę dyktować notatki, nie wysyłając głosu nikomu."* To jest cały problem. Reszta to inżynieria, która ten problem rozwiązuje.

### Slajd 7 — Co buduję (~90 s)

> Konkretnie: aplikacja mobilna, React Native i Expo, na iOS jako primary, Android jako stretch goal po MVP.
>
> Trzy główne funkcje. Pierwsza — nagrywanie głosu z transkrypcją w czasie zbliżonym do rzeczywistego, przez Apple SFSpeechRecognizer w trybie on-device. Strumieniowo, więc transkrypt rośnie razem z mówieniem. Whisper przez `whisper.rn` zostaje w odwodzie jako plan B na wypadek niedostatecznej jakości polskiego.
>
> Druga — automatyczne streszczenie i wyciąganie zadań z transkryptu. Tu wchodzi LLM. Użytkownik nagrywa pięciominutową wypowiedź, dostaje akapit streszczenia plus listę punktów do zrobienia.
>
> Trzecia — organizacja notatek. Lista, szczegół z audio, transkryptem, streszczeniem, ręczne tagi. SQLite lokalnie, audio na dysku telefonu, nic w chmurze.

### Slajd 8 — Stack (~75 s)

> Stack: React Native plus Expo SDK z TypeScriptem w trybie strict, build przez EAS w trybie development build. Cel: iOS 17+, urządzenie referencyjne iPhone 17 Pro z A19 Pro.
>
> STT — Apple SFSpeechRecognizer przez bibliotekę `expo-speech-recognition`. To most z JavaScriptu do natywnego silnika Apple, w trybie on-device, z deklarowanym przez Apple wsparciem dla polskiego.
>
> LLM przez `llama.rn` — binding do `llama.cpp`. Najbardziej dojrzały pipeline, format wag GGUF, akceleracja GPU przez Metal, znana społeczność, dobra dokumentacja.
>
> Model: Qwen3-4B Instruct, w kwantyzacji Q4_K_M. Dlaczego ten — następny slajd.
>
> Whisper przez `whisper.rn` mam jako plan B dla STT, gdyby SFSpeechRecognizer zawiódł na polskim — osobnego slajdu mu nie poświęcam.

### Slajd 9 — Wybór modelu (~90 s)

> To jest jeden ze slajdów, na które warto zwrócić uwagę, bo pokazuje jak myślę o trade-offach.
>
> Po lewej: Qwen3-4B. Cztery miliardy parametrów, model „dense" — wszystkie wagi pracują przy każdym tokenie. Po kwantyzacji do 4 bitów (Q4_K_M) zajmuje około 3 gigabajtów w pamięci RAM. Mieści się w 12 GB iPhone'a 17 Pro z dużym zapasem na system, aplikację, kontekst.
>
> Po prawej: Qwen3-30B-A3B. Też z rodziny Qwen3, ale model „MoE" — Mixture of Experts. Nazwa A3B jest myląca: brzmi jak 3 miliardy aktywnych parametrów, ale całe 30 miliardów wag musi siedzieć w RAM, bo dla każdego tokena routing wybiera innego eksperta. Po kwantyzacji to około 17 gigabajtów. Nie zmieści się na żadnym konsumenckim telefonie.
>
> To jest dokładnie ten typ pułapki, który chcę opisać w części teoretycznej pracy. Liczy się nie sam rozmiar nominalny, tylko to ile musi siedzieć w pamięci.

### Slajd 10 — Architektura (~90 s)

> Architektura w pięciu warstwach. UI — komponenty React, ekrany. State — Zustand albo Redux Toolkit, decyzję podejmę przy POC. Warstwa domeny — logika biznesowa, encje notatek, użytkownika. Warstwa danych — adapter na SQLite i system plików. Warstwa runtime AI — fasada nad `expo-speech-recognition` i `llama.rn` z jednolitym API. Mail do promotora opisuje to jako trzy warstwy logiczne: prezentacja, logika, dane — pięć warstw na slajdzie to ich praktyczne rozbicie implementacyjne.
>
> Strzałki na diagramie idą tylko w obrębie urządzenia, między warstwami. Z całego diagramu nie wychodzi ani jedna strzałka na zewnątrz. To nie przypadek — to założenie projektowe.

### Slajd 11 — Privacy by design (~60 s)

> Privacy nie jest tu polityką prywatności — jest decyzją architektoniczną. Po pierwszym pobraniu modelu z Hugging Face — które zrobi się jednorazowo przy pierwszym uruchomieniu albo bundluje z apką — aplikacja nie potrzebuje sieci. Możesz wyłączyć dane mobilne i Wi-Fi i wszystko działa.
>
> Mogę to wymusić na poziomie kodu — odebrać uprawnienia sieciowe Info.plist, zablokować klienta HTTP. To weryfikowalne, nie deklaratywne.

### Slajd 12 — Zakres (~75 s)

> W zakresie pracy: aplikacja iOS 17+ jako primary, jeden runtime LLM (`llama.rn`), STT przez Apple SFSpeechRecognizer, Qwen3-4B jako wybrany model, polski i angielski jako języki wejścia-wyjścia, testy funkcjonalne i jakościowa ocena podsumowań.
>
> Poza zakresem świadomie: trening i fine-tuning modeli, multimodalność (obraz, wideo), synchronizacja w chmurze, porównanie wielu runtime'ów. Whisper przez `whisper.rn` zostaje jako plan B dla STT, ale nie jest częścią main story. To ostatnie — porównanie runtime'ów — celowo zostawiam ewentualnie na pracę magisterską. Tutaj problem rozwiązuje produkt, nie benchmark.

### Slajd 13 — Harmonogram (~75 s)

> Maj — czerwiec: research literaturowy, POC z `llama.rn` (Qwen3-4B na Metalu) oraz z `expo-speech-recognition` (SFSpeechRecognizer), sprawdzenie czy w ogóle to działa płynnie na docelowym sprzęcie.
> Lipiec — październik: implementacja MVP, iteracje UI, integracja warstw.
> Listopad — grudzień: testy funkcjonalne, redakcja pracy, finalna szlifa.
> Obrona planowo styczeń — luty 2027.

### Slajd 14 — Ryzyka (~90 s)

> Trzy ryzyka, na które warto zwrócić uwagę. Pierwsze: limity pamięci iOS — system ubija aplikacje przekraczające jakieś trzy gigabajty RAM. Mityguję ograniczeniem do modeli 4B, kwantyzacją Q4, testami OOM od początku.
>
> Drugie: jakość polskiego w modelu trenowanym głównie na danych angielskich. Mityguję wyborem Qwena, który radzi sobie z polskim akceptowalnie, plus ewentualnym alternatywą Bielik jako planem B.
>
> Trzecie: niedojrzałe biblioteki. `expo-speech-recognition` i `llama.rn` mają breaking changes. Mityguję pinem wersji, a w razie czego mam plan forknięcia stabilnej wersji. Dodatkowo `whisper.rn` jako plan B dla STT zmniejsza ryzyko jakościowe na polskim — gdyby SFSpeechRecognizer zawiódł.

### Slajd 15 — Status (~60 s)

> Gdzie jestem: temat wstępnie zaakceptowany przez promotora, formalne zatwierdzenie czeka. Wybór modelu LLM, runtime'u LLM i STT skończony. Następny krok — POC: minimalna apka która ładuje Qwena3-4B przez `llama.rn` z akceleracją Metal i odpowiada na prompt na fizycznym telefonie. Jak to zaskoczy, dochodzi `expo-speech-recognition` (SFSpeechRecognizer) i wtedy mamy pełny pipeline w wersji szkieletowej.

### Slajd 16 — Dziękuję

> Dziękuję, jestem gotów na pytania.

---

## Pytania oponentów + odpowiedzi

> Format: dwa pytania na oponenta, łącznie cztery. Pytania mają wyglądać sensownie, dotyczyć różnych części prezentacji, i mieć dobre odpowiedzi „w kieszeni". Oponenci to koledzy, więc dam im to z wyprzedzeniem — chodzi o to, żebym brzmiał kompetentnie a oni żeby byli przygotowani.

---

### Oponent 1

#### P1.1 — „Dlaczego React Native, a nie natywny rozwój (Swift / Kotlin)? Natywnie miałbyś bezpośredni dostęp do Core ML i Apple Intelligence, mniejszy overhead i lepszą wydajność."

**Odpowiedź:**

> To jest dobry punkt i rozważałem go. Trzy powody za React Native + Expo.
>
> Po pierwsze — gorące ścieżki AI nie idą przez warstwę JS. LLM przez `llama.rn` siedzi w `llama.cpp` w natywnym C++ z akceleracją GPU Metal; STT przez `expo-speech-recognition` to cienki most do natywnego Apple SFSpeechRecognizer, a na Androidzie do natywnego silnika Google. JavaScript wywołuje natywną funkcję, dostaje strumień tokenów lub strumień transkryptu i je renderuje. Overhead bridge'a jest pomijalny w porównaniu z czasem inferencji.
>
> Po drugie — cross-platform plan. `llama.cpp` ma backendy zarówno Metal (iOS), jak i Vulkan/OpenCL (Android). `expo-speech-recognition` z premedytacją mostkuje do dwóch różnych natywnych silników: SFSpeechRecognizer na iOS, `android.speech.SpeechRecognizer` na Androidzie. To znaczy: jeden codebase, ale na każdej platformie korzystam z natywnego, on-device SDK do mowy. Idąc Swiftem domknąłbym się do iOS bezpowrotnie. Apple Intelligence wykluczyłem osobno — ma fallback do prywatnej chmury Apple, więc gwarancja „nic nie wychodzi z urządzenia" by upadła.
>
> Po trzecie — wartość edukacyjna. Idąc natywnie, większość pracy to byłoby pisanie boilerplate'u UI w SwiftUI. Idąc przez RN, kod aplikacji jest cienki, a większość wysiłku idzie w warstwę integracji modeli, projektowanie warstw i decyzje architektoniczne — czyli rzeczywistą zawartość pracy inżynierskiej.

#### P1.2 — „Skoro nie ma komponentu badawczego ani benchmarku, jak zdefiniujesz że projekt się udał? Jak ocenisz jakość streszczeń bez metryk?"

**Odpowiedź:**

> Sukces zdefiniowany jest produktowo, nie pomiarowo. Trzy kryteria.
>
> Pierwsze — funkcjonalne: pełen pipeline działa. Nagrywam głos, dostaję transkrypt, dostaję streszczenie, wszystko trafia do bazy, wszystko offline. To jest binarny test: działa albo nie.
>
> Drugie — wydajnościowy sanity check, nie benchmark: czas do pierwszego tokena LLM do dwóch sekund, generacja powyżej dziesięciu tokenów na sekundę, oraz dla STT — czas transkrypcji nie dłuższy niż długość nagrania. SFSpeechRecognizer pracuje strumieniowo, więc to kryterium jest naturalnie spełnione, ale weryfikuję je explicite na docelowym urządzeniu. To są progi „użyteczne", a nie metryki naukowe — różnica w tym, że nie porównuję ich między rozwiązaniami.
>
> Trzecie — jakościowe, ale subiektywne i jawnie tak opisane w pracy. Przygotuję ustalony zestaw nagrań — wystąpienie konferencyjne, wykład, dyktowane notatki — i ocenię streszczenia względem tego, co sam bym napisał. To nie jest ewaluacja ilościowa typu BLEU czy ROUGE, i tak to nazwę w pracy. Promotor wprost powiedział, że dla pracy inżynierskiej to wystarczy — komponent badawczy zostawiamy na magisterkę.

---

### Oponent 2

#### P2.1 — „Dlaczego Qwen, a nie polski model Bielik? Dla użytkowników mówiących po polsku to byłoby naturalniejsze."

**Odpowiedź:**

> Najpierw uściślenie zakresu pytania. Polską jakością mowy w aplikacji zajmują się dwa różne komponenty. Rozpoznawanie mowy (STT) robi Apple SFSpeechRecognizer, który ma własne, deklarowane przez Apple wsparcie dla polskiego on-device — Bielika tu w ogóle nie potrzebuję, bo to nie jest zadanie LLM-a. Bielik wchodzi w grę wyłącznie dla LLM-a, czyli streszczania transkryptu. I w tym kontekście jest na krótkiej liście — opisuję go w pracy jako alternatywę i traktuję jako plan B dla LLM. Trzy powody, dla których w punkcie wyjścia wybieram Qwena.
>
> Pierwszy — dwujęzyczność. Aplikacja musi obsłużyć polski i angielski równie dobrze, bo wielu użytkowników miesza języki — nazwy własne, terminy techniczne, cytaty po angielsku w polskim kontekście. Qwen jest trenowany na ogromnym korpusie wielojęzycznym, Bielik jest skupiony na polskim i anglojęzyczne wejścia obsługuje gorzej.
>
> Drugi — dojrzałość ekosystemu. Qwen ma gotowe wagi GGUF z wieloma poziomami kwantyzacji, kompatybilność z llama.cpp testowaną od dawna. Bielik dopiero dochodzi do tego poziomu, a to oznacza większe ryzyko techniczne dla pracy z deadlinem.
>
> Trzeci — porównywalność. Wybierając popularny model bazowy, ułatwiam komuś, kto czyta moją pracę, ocenę wyników. Bielik wymagałby dodatkowego wprowadzenia w to czym jest i jak się go używa, co w pracy o zakresie produktowym kradnie miejsce ważnym treściom.
>
> Jeśli w trakcie POC okaże się, że Qwen3-4B nie radzi sobie z polskim wystarczająco dobrze, mam plan B z Bielikiem opisany — wyłącznie dla części LLM.

#### P2.2 — „Mówisz że apka jest fully offline, ale model trzeba pobrać z Hugging Face. Czyli Hugging Face wie, kto pobrał — to nie jest dziura w privacy-first?"

**Odpowiedź:**

> Najpierw zwrócę uwagę, że problem dotyczy wyłącznie pobrania modelu LLM. Apple SFSpeechRecognizer jest częścią iOS — nie wymaga żadnego pobierania z zewnątrz. Mówimy więc o jednym jednorazowym pobraniu pliku Qwen3-4B w kwantyzacji Q4_K_M.
>
> Rozróżniam dwa zagrożenia.
>
> Pierwsze: dane użytkownika — głos, transkrypt, treść notatek. Te nie wychodzą z urządzenia nigdy. To jest twarde założenie pracy.
>
> Drugie: metadane pobrania modelu — adres IP, user agent, ewentualnie identyfikator urządzenia. Hugging Face wie, że ktoś z tego IP pobrał ten model. To nie są dane wrażliwe użytkownika, to jest fakt techniczny — telefon pobrał plik o określonej zawartości.
>
> Mam dwie ścieżki mitygacji. Pierwsza — proxy przez własny serwer albo CDN, gdzie nie loguję IP. Druga, czystsza — bundlowanie modelu razem z aplikacją w App Store. Wtedy pobranie idzie z Apple, a nie z Hugging Face, i jest nieodróżnialne od pobrania samej aplikacji.
>
> Drugie podejście ma wadę — model jest duży, instalacja apki wzrasta o trzy gigabajty, są limity App Store. Zdecyduję podczas implementacji, ale to jest świadomy trade-off i będzie opisany w pracy.

---

## Co przygotować przed wystąpieniem

- [ ] Skompilować nową prezentację (`prezentacja/main.tex`) i przeczytać slajd po slajdzie
- [ ] Próba na czas (osobno, na głos, ze stoperem) — co najmniej 2 razy
- [ ] Przekazać oponentom ich pytania (po 2 każdy) z odpowiednim wyprzedzeniem
- [ ] Przygotować wersję PDF prezentacji na pendrive jako backup
- [ ] Sprawdzić czy slajdy są czytelne z dystansu (głównie diagramy)
- [ ] Mieć ze sobą notatki z kluczowymi liczbami: 4B parametrów, ~3 GB w RAM, 12 GB RAM iPhone 17 Pro, AI Act 2024, Qwen3-4B wydany 2025-04, iOS 17+ jako minimum, Apple SFSpeechRecognizer wsparcie PL on-device deklarowane przez Apple
