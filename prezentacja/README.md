# Prezentacja — proseminarium 2026-05-13

## Zawartość

- `main.tex` — aktualna prezentacja (privacy-first apka notatek głosowych, zakres inżynierski)
- `main_v1_backup.tex` — stara prezentacja z kwietnia 2026 (wariant C: apka + benchmark runtime'ów). Zostawiona jako referencja, nie używać.

Skrypt wystąpienia (co mówić do każdego slajdu) + pytania oponentów: `proseminarium-2026-05-13.md` (obok).

## Kompilacja

Wymagane: TeX Live z `metropolis`, `fontawesome5`, `pgfgantt`, `tikz`.

```bash
# Ubuntu/Debian — pełen TeX Live (najprostsze)
sudo apt install texlive-full

# albo minimalnie:
sudo apt install texlive-latex-base texlive-latex-extra texlive-fonts-extra \
                 texlive-luatex texlive-lang-polish

# kompilacja (lualatex zalecany — fontawesome5 lepiej radzi sobie z luatexem)
lualatex main.tex

# fallback
pdflatex main.tex
```

Jeśli `metropolis` brakuje:

```bash
# z CTAN
tlmgr install beamertheme-metropolis pgfplots fontawesome5 pgfgantt
```

## Słowo o stylu

Slajdy są **wizualne, niskotekstowe** — narracja po stronie mówcy. Nie czytać slajdów na głos, mówić wokół nich. Pełen skrypt narracji jest w knowledge vault.
