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

- **The story is performed live.** The narrator tells the tale at true spoken
  cadence (~150 wpm); every word is a note at its real timestamp in the
  recording. Mouth open on the beat — the word escapes. Closed — it smothers
  audibly into your bite and the streak dies. Natural speech breathes in
  phrases, and the **gaps between phrases are your safe windows to chew**.
- **The exit lane** (left edge) is the note highway: gold word-notes ride
  toward a lip-shaped gate, beamed together by phrase; food rides the
  parallel rail with warning rings before it lunges. Bullet time slows the
  narrator's actual voice, pitch and all.
- **The CHEW zone** — a green band that sweeps up and down the lane like a
  kicking meter; it flares (with a soft tick) whenever it slides over a
  morsel. Land your bite while the food is inside it for a **CLEAN BITE**:
  +10 and the chomp counts double toward swallowing. Bite **outside** the
  zone and that's a **sloppy bite** — a dull bump-bump — and the third one
  wedges the morsel in your teeth. A clean bite steadies the jaw and
  forgives one. Picking stuck food out grows the zone; letting it fester
  shrinks it.
- **Food** (olives, Pag cheese, figs, bread, cherry tomatoes) gets jostled
  toward the light every time you talk. Bite down to stop it. Chew it enough
  times and you can swallow it for points.
- Mistime it: a word hits closed lips — *MMMPH* — and your streak dies.
- Let three pieces of food past your lips and your reputation is finished.
- Hold the mouth shut too long and you'll need to breathe.
- **DEFEND YOURSELF.** Somewhere past the first third of the telling, the
  mouth slips into a coughing fit and the camera is blown out through the
  lips: for ten seconds you are the dinner guest across the table — staring
  at the lips, teeth, nose-tip and chin from outside — while 7–12
  half-chewed morsels come flying at your face. **Circle** one mid-air to
  swat it down (+20), **swipe** left or right to lean out of its path
  (arrow keys on desktop, +10 per near miss). Take nothing on the chin and
  the table pretends not to have noticed (+100). The story holds its
  breath; the coughing and lip-smacking, regrettably, do not.
- Three sloppy bites and a morsel gets **stuck in your teeth** (no streak
  builds while it's there) — and you have **3 seconds** before it festers.
  Hold one finger to slip into slow-mo **bullet time** (which all but
  freezes the countdown), then circle the morsel with a *second* finger —
  your glowing pencil loop snaps onto its exact silhouette and flicks it
  free (+50, and the chew zone grows). Miss the window and it festers:
  swallowed whole, chew zone shrunk.

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
  the suffocation mechanic, and the stuck-food / bullet-time state machine.
- `js/defend.js` — the DEFEND YOURSELF bonus round: the cough-flight camera
  path out through the aperture, the volley of cough-launched food aimed at
  your head, and the swipe-vs-circle gesture split (accumulated heading turn
  tells a dodge flick from a blocking loop).
- `js/face.js` — the dinner guest's head, built only for those ten seconds:
  a parametric skull plate (brow ridge, orbital sockets, cheekbones,
  nasolabial folds, philtrum, lip rolls, chin boss and jawline — the lower
  half rides the mandible), a deformed-sphere nose with genuine overhang,
  alar flares and nostrils, eyes with painted irises that blink, squint
  with every cough and track the incoming food, ~400 instanced
  salt-and-pepper hair clumps swept back over a receding hairline, peppered
  brow tufts, a generated skin texture with pores, forehead furrows and
  grey-flecked stubble, and a neck and collar to catch the splatter.
- `js/lasso.js` — the bullet-time cleaning lasso: a Canvas2D layer over the
  WebGL scene with a glowing pencil trail under the finger, a point-in-polygon
  hit test against the morsel's projected position, and a morph that snaps the
  hand-drawn loop onto the convex hull of the morsel's screen-space silhouette
  before it poofs.
- `js/audio.js` — synthesized WebAudio: wet chomps, crunches, gulps, muffled
  "mmph"s, chesty coughs, lip smacks, face-splats, distant plate clatter,
  church bells, waves heard through the aperture (low-passed by the jaw),
  and a heartbeat.
- `js/voice.js` + `assets/voice/` — **real narration**. The whole story is
  one continuous ElevenLabs recording (a warm, worldly storyteller in her
  sixties) with **per-word timestamps** (`timings.json`, from the
  with-timestamps API) driving performance mode; phrase boundaries are
  derived from breath gaps. Individual word clips remain as the classic-mode
  fallback when timings haven't loaded. Re-render with
  `ELEVENLABS_API_KEY=… npm run voice` — the key lives only in your
  environment, never in the repo. New stories: add a text in `js/story.js`,
  re-run the renderer.
- Lighting: real-time sun shadows through the lip aperture, PMREM environment
  reflections on every wet surface, pulsing transilluminated cheeks, adaptive
  exposure as the jaw opens and closes, ACES tone mapping + bloom.

## Tests

```sh
npm test          # headless smoke test (node, stubbed DOM)
npm run shots     # boots the game in headless Chromium, screenshots states
```
