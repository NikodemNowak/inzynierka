# Prompty do grafik — proseminarium 2026-05-13

Wygenerowane grafiki wrzucaj do `prezentacja/img/` z **dokładnie taką nazwą pliku**, jak podana w nagłówku — `main.tex` szuka ich pod tymi nazwami przez `\includegraphics`.

Format: PNG, ratio ~16:9 (slajd) albo kwadrat (gdy slajd dzieli przestrzeń pół na pół), tło białe lub bardzo jasne (slajdy mają białe tło). Bez tekstu na grafice — podpisy zrobi LaTeX.

Modele które się sprawdzą: Gemini Nano Banana, GPT Image 2, Imagen 3. Jeżeli któryś dorzuca sam tekst — w prompt dodaj `no text, no labels, no captions`.

---

## 1. `img/hook.png` — slajd 2 (Hook)

**Slajd:** "Tak działa każdy popularny AI-notatnik".
**Co ma pokazać:** dane lecą z telefonu na serwer w chmurze — czerwono, alarmująco, ale czytelnie.

**Prompt:**

```
A clean, minimalist editorial illustration showing a smartphone on the left
emitting a red data stream (sound waves and abstract data packets) flying
through the air toward a cloud-shaped server on the right. The cloud is
clearly a server: it has a subtle data-center feel (racks visible inside,
small status lights). Red glowing arrow connects them. White background,
flat illustration style, university lecture aesthetic, no text, no labels,
no captions. 16:9 aspect ratio.
```

---

## 2. `img/sensitive.png` — slajd 3 (Wrażliwe konteksty)

**Slajd:** "Dla kogo to nie wystarcza" — medycyna, prawo, finanse, dziennikarstwo.
**Co ma pokazać:** cztery zawody, każdy z wyraźnym wizualnym akcentem prywatności (notatnik, telefon przy uchu, dyktafon — coś, co pokazuje że ci ludzie nagrywają poufne informacje).

**Prompt:**

```
A clean four-panel editorial illustration on a white background. Each panel
shows one professional dictating a private voice note: (1) a doctor in a
white coat speaking into a smartphone, (2) a lawyer in formal attire next
to a stack of case files speaking into a phone, (3) a financial advisor at
a desk with charts and a phone, (4) a journalist with a notebook and a
voice recorder. Style: flat vector illustration, muted professional color
palette with one subtle red accent (a small lock or shield icon hovering
near each phone). University presentation aesthetic, no text, no labels,
no captions. 16:9 aspect ratio.
```

---

## 3. `img/pipeline.png` — slajd 5 (Pipeline)

**Slajd:** "Pomysł — cały pipeline na telefonie".
**Co ma pokazać:** jeden duży telefon w środku, w środku ekranu cztery ikony/kroki: mikrofon → tekst → mózg/AI → notatka. Cały pipeline domknięty w obrysie telefonu — sygnał, że nic z niego nie wychodzi.

**Prompt:**

```
A large smartphone shown in the center of the image, drawn in flat
isometric style. Inside the phone screen, four icons connected by arrows
flow horizontally: (1) a microphone, (2) a text document with text lines,
(3) a stylized brain or neural network node representing a language model,
(4) a sticky note. Arrows between them are clean and minimal. The phone
itself has a subtle glowing border to emphasize that everything happens
inside the device. White background, clean university lecture aesthetic,
no text, no labels, no captions. 16:9 aspect ratio.
```

---

## 4. `img/privacy.png` — slajd 11 (Privacy by design)

**Slajd:** "Privacy by design" — telefon, z którego nic nie wychodzi.
**Co ma pokazać:** telefon w środku, dookoła niego symbol airplane mode / WiFi-off, czerwone "X" przekreślające strzałki próbujące wyjść z urządzenia.

**Prompt:**

```
A central smartphone illustration on a white background. Around the phone,
four arrows try to leave the device in different directions (left, right,
up, down) but each arrow is crossed out with a thick red X. A small
airplane-mode icon glows softly above the phone. The phone screen shows
three small icons: a microphone, a brain (representing AI), and a sticky
note. Style: flat vector illustration, university presentation aesthetic,
white background, no text, no labels, no captions. 16:9 aspect ratio.
```

---

## 5. `img/llm.png` — slajd „Czym są modele językowe"

**Slajd:** krótkie wprowadzenie czym jest LLM + multimodalność.
**Co ma pokazać:** czarna skrzynka LLM, na wejściu trzy strumienie (tekst, obraz, dźwięk), na wyjściu odpowiedź tekstowa. Wizualnie sugeruje, że LLM przyjmuje różne modalności i odpowiada tekstem.

**Prompt:**

```
A clean, minimalist editorial illustration showing a central rounded
square or hexagon labeled with abstract neural-network-style nodes
(representing a Large Language Model). On the left side, three input
streams flow into it: (1) a text document with text lines, (2) a small
image thumbnail (suggesting a photograph), (3) a sound wave (suggesting
audio). On the right side, a single output stream emerges: a clean text
response sheet. Connecting lines are subtle, the central LLM box has a
subtle blue glow to draw attention. Style: flat vector illustration,
muted professional palette, university lecture aesthetic. White
background, no text, no labels, no captions. 16:9 aspect ratio.
```

---

## 6. `img/title-bg.png` — slajd 1 (Tytułowy) — *opcjonalne*

**Slajd:** Tytułowy. Możesz pominąć — beamer i tak ładnie sobie radzi z samym tekstem. Ale jeśli chcesz akcent wizualny:

**Prompt:**

```
A subtle, abstract background illustration: a smartphone silhouette with a
soft microphone wave pattern emanating from it, fading into white space.
Very minimal, almost monochromatic with a single subtle blue tint. Suitable
as a faded background behind a title. White background, no text, no labels,
no captions. 16:9 aspect ratio.
```

Jeśli wstawisz, w `main.tex` zmień slajd tytułowy na ten z tłem (mam zostawiony zakomentowany kod).

---

## Co zostaje jako TikZ (nie generujemy obrazków)

Te slajdy **lepiej zostawić jako rysunki w LaTeX-u**, bo to diagramy techniczne i AI image gen ich nie zrobi czytelnie:

- **Slajd 9 (Wybór modelu)** — porównanie Qwen 4B vs 30B-A3B w dwóch kolumnach z liczbami. To tabela-diagram, czytelność > estetyka.
- **Slajd 10 (Architektura)** — pięć warstw stosu. Diagram strukturalny.
- **Slajd 13 (Plan)** — uproszczony pasek faz. Zostawiony w TikZ jako Gantt.

Jeśli mimo wszystko chcesz je też zrobić jako obrazki — daj znać, dorzucę prompty.
