# Praca inżynierska — Nikodem Nowak

**Autor:** Nikodem Nowak, nr albumu **251598**
**Promotor:** dr inż. Marcin Kacprowicz
**Status tematu:** wstępnie zaakceptowany przez promotora w rozmowie 2026-04-20, tytuł i opis wysłane mailem — **brak formalnego zatwierdzenia** (stan na 2026-05-07).

## Tytuł roboczy

Aplikacja mobilna do prywatnych notatek głosowych z lokalnym przetwarzaniem mowy i podsumowywaniem przez LLM (React Native + Expo).

## Streszczenie

Mobilna aplikacja React Native (Expo SDK, TypeScript strict, build przez EAS w trybie development; target iOS 17+, urządzenie referencyjne iPhone 17 Pro / A19 Pro), która:
- nagrywa głos,
- transkrybuje go **lokalnie** (Apple SFSpeechRecognizer przez `expo-speech-recognition`, tryb on-device),
- streszcza/przetwarza transkrypt **lokalnym LLM** (Qwen3-4B Instruct, GGUF Q4_K_M, runtime: `llama.rn` z akceleracją GPU Metal),
- zapisuje notatkę w lokalnej bazie (`expo-sqlite` + `expo-file-system`).

**Plan B dla STT:** Whisper przez `whisper.rn` — wyłącznie jako fallback jakościowy na PL.

**Privacy-first:** żaden ruch sieciowy w aplikacji po pierwszym pobraniu modelu LLM. SFSpeechRecognizer jest częścią iOS — nie wymaga pobrania. RODO + AI Act w tle jako uzasadnienie.

**Zakres czysto inżynierski** — bez komponentu badawczego/benchmarku (świadoma decyzja po rozmowie z promotorem 2026-04-20). Działający produkt > badanie.

## Repo / struktura

```
uni/engineer/
├── CLAUDE.md          # ten plik
├── prezentacja/       # prezentacje proseminaryjne (LaTeX/Beamer)
│   ├── main.tex                # aktualna prezentacja (proseminarium 2026-05-13)
│   └── main_v1_backup.tex      # stara prezentacja (kwiecień 2026, nieaktualny zakres — wariant C)
└── ...                # (kod aplikacji RN dojdzie później, jeszcze nie zacząłem)
```

## Podział: knowledge vault vs repo

**Repo `~/uni/engineer/` = praca operacyjna.** Tu żyją artefakty: prezentacje, skrypt wystąpienia, kod aplikacji, drafty rozdziałów, pytania oponentów.

**Knowledge vault `~/knowledge/projects/inzynierka/` = kontekst startowy.** Tu żyją informacje, które mają pozwolić nowej sesji Claude'a wejść w temat bez pytania o wszystko od nowa: kim jest autor, kto jest promotorem, jaki jest temat, jakie były odrzucone warianty, dlaczego wybrany jest taki model. Stan, nie deliverables.

### Knowledge vault (czytaj NA POCZĄTKU nowej sesji)

- [`overview.md`](../../knowledge/projects/inzynierka/overview.md) — temat, zakres, stack, struktura pracy, status formalny
- [`topic-history.md`](../../knowledge/projects/inzynierka/topic-history.md) — odrzucone warianty (A/B/C) i dlaczego
- [`model-choice.md`](../../knowledge/projects/inzynierka/model-choice.md) — uzasadnienie Qwen3-4B vs alternatywy
- [`decisions-log.md`](../../knowledge/projects/inzynierka/decisions-log.md) — chronologiczny log decyzji

### Repo (tutaj pracujemy)

- `prezentacja/main.tex` — aktualne slajdy proseminarium
- `prezentacja/proseminarium-2026-05-13.md` — skrypt wystąpienia + pytania oponentów + odpowiedzi
- `prezentacja/main_v1_backup.tex` — stara prezentacja (kwiecień, wariant C, nieaktualny zakres)
- (kod aplikacji RN dojdzie później)

### Co aktualizować i gdzie

| Sytuacja | Gdzie zapisać |
|---|---|
| Decyzja projektowa (np. zmiana modelu, runtime) | `~/knowledge/.../decisions-log.md` + odpowiedni plik kontekstu |
| Notatka ze spotkania z promotorem | `~/knowledge/.../decisions-log.md` (skrót) + nowy plik szczegółowy w vault, jeśli warto |
| Skrypt prezentacji, slajdy, draft rozdziału, kod | repo `~/uni/engineer/` |
| Pytania oponentów / Q&A na konkretne wystąpienie | repo, obok prezentacji której dotyczą |

## Kontekst sesji dla agenta

- Język komunikacji: **polski** (kod, identyfikatory, commit messages — angielski; treść pracy — polski).
- Frontend: React Native + Expo SDK, TypeScript strict, named exports, no `any`. Build przez EAS (development build).
- Platforma: iOS 17+ (iPhone 17 Pro, 12 GB RAM, A19 Pro). Android = stretch goal po MVP.
- Privacy-first: nie sugeruj rozwiązań chmurowych do głównego pipeline'u (STT/LLM). Cloud OK tylko do jednorazowego pobrania modelu LLM.
- Runtime LLM: `llama.rn` z akceleracją GPU Metal. Model: Qwen3-4B Instruct GGUF Q4_K_M. Nie proponuj porównań z ExecuTorch/MLC jako części pracy — to było odrzucone.
- Runtime STT: `expo-speech-recognition` (Apple SFSpeechRecognizer w trybie on-device). Plan B: `whisper.rn` (Whisper) — wyłącznie jako fallback jakościowy na PL.
- Storage: `expo-sqlite` (notatki) + `expo-file-system` (audio).
- Najbliższy deadline: **proseminarium 2026-05-13 (środa)**, prezentacja ~20 min, 2 oponentów × 2 pytania.

## Co dalej

1. **2026-05-13** — proseminarium (prezentacja + pytania oponentów). Materiały: `proseminarium-2026-05-13.md`.
2. Po proseminarium — formalne zatwierdzenie tematu u promotora.
3. POC: minimalna apka RN z `llama.rn` + Qwen3-4B (Metal) na iPhonie. Pomiar TTFT i tokens/s tylko jako sanity-check, bez metodologii badawczej.
4. POC: STT przez `expo-speech-recognition` (SFSpeechRecognizer) na tym samym urządzeniu. Weryfikacja jakości PL on-device. Plan B: `whisper.rn`.
5. Iteracja MVP — UI list/detail, flow „nagraj → transkrybuj → podsumuj → zapisz".
