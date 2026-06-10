// MAW — the story your mouth is trying to tell, one word at a time,
// between bites. A travelogue of the Dalmatian coast.

export const STORY = `
We sailed out of Split at dawn, while the old town still slept behind its
white stone walls. The Adriatic opened ahead of us like hammered silver,
and the gulls followed our wake all the way past the islands.

By noon we reached Hvar, where lavender spilled down the hillsides and the
whole harbor smelled of salt and rosemary. We ate grilled sardines under a
fig tree, drank cold white wine from Korčula, and watched two old fishermen
mend their nets and argue about nothing.

Later, in Dubrovnik, we walked the city walls at sunset while swifts wheeled
over the terracotta roofs and the sea below turned slowly to copper. A man
with flour on his hands sold us figs still warm from the sun, and told us
the island ferries run on their own sweet time.

So we stopped counting the days. We swam at dawn, ate octopus under the
pines, and learned the word for evening. We stayed until the bora wind came
down from the mountains, and even then, my love, even then, we almost did
not leave.
`.trim();

// Split into clean word tokens, preserving punctuation attached to words.
export const WORDS = STORY.replace(/\s+/g, ' ').split(' ');

// Chapter breaks: word index → place card shown as the story passes through.
export const CHAPTERS = [
  { at: 0,   name: 'SPLIT' },
  { at: 32,  name: 'HVAR' },
  { at: 74,  name: 'DUBROVNIK' },
  { at: 124, name: 'THE LAST DAYS' },
];

export function chapterAt(index) {
  let current = null;
  for (const c of CHAPTERS) if (index === c.at) current = c;
  return current;
}

// ---------------------------------------------------------------------------
// What's on the table tonight. Konoba classics — each entry drives both the
// procedural food model and its chew/juice behaviour.
// ---------------------------------------------------------------------------
export const FOODS = [
  {
    id: 'olive',
    label: 'olive',
    baseColor: 0x2a3018, deepColor: 0x141a09,
    juice: 0x6a7030,
    radius: 0.42, squash: 0.85,
    rough: 0.18, clearcoat: 0.9,
    chewsToSwallow: 2,
    noise: 0.05, lobes: 0,
  },
  {
    id: 'cheese',
    label: 'Pag cheese',
    baseColor: 0xe8d49a, deepColor: 0xcdb377,
    juice: 0xf0e2b4,
    radius: 0.52, squash: 1.0,
    rough: 0.62, clearcoat: 0.08,
    chewsToSwallow: 3,
    noise: 0.06, lobes: 0, cube: true,
  },
  {
    id: 'fig',
    label: 'fig',
    baseColor: 0x4a2440, deepColor: 0x2b1126,
    juice: 0xb04860,
    radius: 0.5, squash: 0.92,
    rough: 0.4, clearcoat: 0.45,
    chewsToSwallow: 2,
    noise: 0.09, lobes: 1,
  },
  {
    id: 'bread',
    label: 'bread',
    baseColor: 0xd9b274, deepColor: 0xa97c43,
    juice: 0xe7d3a8,
    radius: 0.58, squash: 1.0,
    rough: 0.95, clearcoat: 0.0,
    chewsToSwallow: 3,
    noise: 0.16, lobes: 2,
  },
  {
    id: 'tomato',
    label: 'cherry tomato',
    baseColor: 0xb52718, deepColor: 0x7e150c,
    juice: 0xd84a30,
    radius: 0.46, squash: 0.8,
    rough: 0.12, clearcoat: 1.0,
    chewsToSwallow: 2,
    noise: 0.03, lobes: 0,
  },
];

export const WIN_LINES = [
  'The story is told. The table applauds.',
  'Not one crumb escaped. Legendary.',
];

export const LOSE_LINES = [
  'Three pieces of food across the table.',
  'The dinner party will speak of this for years.',
  'Perhaps... write a postcard next time.',
];
