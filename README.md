# MAW

*A game about talking with your mouth full.*

You are the mouth. Dinner in Dalmatia. You simply must tell the story of your
travels through Croatia — mid-bite. Every word of the story has to escape your
lips; the food absolutely must not.

The entire game takes place **inside a procedurally-built 3D mouth**, seen
from the back of the throat — camera hanging right at the uvula, looking out
past the molars, over the tongue, through the lips, at the Adriatic.

## Play

Serve the repo with any static file server and open it on your phone
(or desktop):

```sh
npm run serve     # python3 -m http.server 8000
# → http://localhost:8000
```

**One control:** hold anywhere to bite down, release to speak.

- **Words** drift up from your larynx — they must escape while the mouth is
  open. Each one advances a 181-word travel story through Split, Hvar,
  Dubrovnik, and the last days.
- **Food** (olives, Pag cheese, figs, bread, cherry tomatoes) gets jostled
  toward the light every time you talk. Bite down to stop it. Chew it enough
  times and you can swallow it for points.
- Mistime it: a word hits closed lips — *MMMPH* — and your streak dies.
- Let three pieces of food past your lips and your reputation is finished.
- Hold the mouth shut too long and you'll need to breathe.

## How it's built

No build step, no model files, no texture assets — everything is generated
from math and Canvas2D at load time, on top of [three.js](https://threejs.org)
(vendored in `vendor/`).

- `js/anatomy.js` — 28 individually sculpted teeth (incisors, canines,
  premolars, molars with cusps and fossae) placed along elliptical dental
  arches; festooned gingiva with interdental papillae; hard palate with rugae
  and median raphe; soft palate and a spring-damped uvula; palatoglossal
  arches; a CPU-deformed tongue (median sulcus, papillae bump maps, sublingual
  veins) that articulates while words pass; cheek/lip shell skinned to the
  mandible; floor of mouth with a saliva pool. The mandible rotates at the
  temporomandibular joint. ~38k vertices of mouth.
- `js/world.js` — the world past the lips: shader-driven Adriatic with sun
  glitter, hazy islands, a terracotta town with a campanile, gulls, a slow
  boat, and the dinner table your food lands on.
- `js/game.js` — jaw spring physics, chomp detection, food physics against
  the tongue/cheeks/lips, the word flight path, scoring, slow-motion crises,
  and the suffocation mechanic.
- `js/audio.js` — fully synthesized WebAudio: wet chomps, crunches, gulps,
  formant-filtered vowels for escaping words, muffled "mmph"s, distant plate
  clatter, church bells, waves heard through the aperture (low-passed by the
  jaw), and a heartbeat.
- Lighting: real-time sun shadows through the lip aperture, PMREM environment
  reflections on every wet surface, pulsing transilluminated cheeks, adaptive
  exposure as the jaw opens and closes, ACES tone mapping + bloom.

## Tests

```sh
npm test          # headless smoke test (node, stubbed DOM)
npm run shots     # boots the game in headless Chromium, screenshots states
```
