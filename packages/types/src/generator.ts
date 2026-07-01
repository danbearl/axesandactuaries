import type { Adventurer, Heritage, Vocation, StatBlock, Personality } from './game.js';
import {
  HERITAGES, VOCATIONS, STATS,
  VOCATION_STAT_PRIORITY,
} from './game.js';

// ── Utility (ported math from dnd-character-gen, no IP) ───────────────────────

const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

const weightedPick = <T>(arr: readonly T[], weights: readonly number[]): T => {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < arr.length; i++) {
    r -= weights[i];
    if (r <= 0) return arr[i];
  }
  return arr[arr.length - 1];
};

const randInt = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const randHeight = (min: number, max: number): number => {
  const a = randInt(min, max);
  const b = randInt(min, max);
  return Math.round((a + b) / 2);
};

const correlatedWeight = (
  heightIn: number,
  heightRange: [number, number],
  weightRange: [number, number],
): number => {
  const [hMin, hMax] = heightRange;
  const [wMin, wMax] = weightRange;
  const heightFraction = hMax === hMin ? 0.5 : (heightIn - hMin) / (hMax - hMin);
  const jitter = (Math.random() - 0.5) * 0.3;
  const fraction = Math.max(0, Math.min(1, heightFraction + jitter));
  return Math.round(wMin + fraction * (wMax - wMin));
};

// Name deduplication — prevents the same full name appearing twice in a session
const HISTORY_SIZE = 30;
const nameHistory = new Set<string>();
const nameHistoryOrder: string[] = [];

const recordName = (name: string): void => {
  if (nameHistory.has(name)) return;
  nameHistory.add(name);
  nameHistoryOrder.push(name);
  if (nameHistoryOrder.length > HISTORY_SIZE) {
    nameHistory.delete(nameHistoryOrder.shift()!);
  }
};

const MAX_RETRIES = 5;
const pickFresh = <T extends string>(arr: readonly T[]): T => {
  for (let i = 0; i < MAX_RETRIES; i++) {
    const candidate = pick(arr);
    if (!nameHistory.has(candidate)) return candidate;
  }
  return pick(arr);
};

// ── Original Name Tables (fully invented) ────────────────────────────────────

const NAMES: Record<Heritage, { male: string[]; female: string[]; surnames: string[] }> = {
  Aethborn: {
    male:    ['Sael', 'Vorien', 'Caellum', 'Theryn', 'Auris', 'Zephon', 'Lirael', 'Vayn'],
    female:  ['Sylvae', 'Aerith', 'Caela', 'Thysse', 'Aurel', 'Zephyra', 'Lirae', 'Vayna'],
    surnames: ['Skymantle', 'Dawnrift', 'Cloudborne', 'Veilweave', 'Highcrest', 'Starfall'],
  },
  Stonemarked: {
    male:    ['Durrak', 'Kaeld', 'Vorn', 'Threld', 'Brekk', 'Gorrik', 'Haund', 'Uldrak'],
    female:  ['Durra', 'Kaelda', 'Vorna', 'Thrella', 'Brekka', 'Gorrika', 'Haunda', 'Uldra'],
    surnames: ['Ironvein', 'Deepcarve', 'Stonehide', 'Cragmoor', 'Rockwarden', 'Gravelborn'],
  },
  Verdant: {
    male:    ['Lieven', 'Sylrin', 'Faeno', 'Thalow', 'Brynn', 'Elvar', 'Mireth', 'Ossian'],
    female:  ['Sylarra', 'Lieva', 'Faene', 'Thaline', 'Brynna', 'Elvara', 'Mirela', 'Ossia'],
    surnames: ['Willowmere', 'Thicketborn', 'Greenmantle', 'Fernwatch', 'Mosswick', 'Briarhold'],
  },
  Cinder: {
    male:    ['Embrix', 'Scorch', 'Volgr', 'Ashen', 'Pyrax', 'Kindrak', 'Flaeyn', 'Smoldr'],
    female:  ['Embra', 'Scorcha', 'Volga', 'Ashena', 'Pyra', 'Kindra', 'Flaeyna', 'Smoldra'],
    surnames: ['Ashmantle', 'Coalborn', 'Emberveil', 'Scorchmark', 'Cinderkeep', 'Heatward'],
  },
  Saltblood: {
    male:    ['Corran', 'Tidrik', 'Maryn', 'Wavren', 'Brine', 'Coraen', 'Drifter', 'Keldan'],
    female:  ['Corryn', 'Tidra', 'Marina', 'Wavra', 'Brinna', 'Coraena', 'Drifta', 'Kelda'],
    surnames: ['Deepcurrent', 'Saltwind', 'Tidesborn', 'Wavecrest', 'Brinehold', 'Harborwatch'],
  },
  Duskwalker: {
    male:    ['Shade', 'Vespyr', 'Noctyn', 'Umbrel', 'Twilnir', 'Dimmer', 'Gloamr', 'Starless'],
    female:  ['Shada', 'Vespyra', 'Noctyne', 'Umbriel', 'Twilna', 'Dimra', 'Gloamra', 'Starla'],
    surnames: ['Nightveil', 'Shadowborn', 'Duskmantle', 'Eventide', 'Darkwatch', 'Gloomhaven'],
  },
  Ironbound: {
    male:    ['Forge', 'Hamrik', 'Anvil', 'Clench', 'Blokk', 'Wrench', 'Rivet', 'Graft'],
    female:  ['Forgea', 'Hamrika', 'Anvila', 'Clenchie', 'Blokka', 'Wrencha', 'Riveta', 'Grafta'],
    surnames: ['Ironweld', 'Steelborn', 'Hammerfall', 'Crestforge', 'Anvilmark', 'Ironvault'],
  },
};

const GENDERS = ['Male', 'Female'] as const;
type Gender = (typeof GENDERS)[number];

const generateName = (heritage: Heritage, gender: Gender): string => {
  const pool = NAMES[heritage];
  const firstList = gender === 'Male' ? pool.male : pool.female;
  const first = pickFresh(firstList);
  const last = pickFresh(pool.surnames);
  const full = `${first} ${last}`;
  recordName(full);
  return full;
};

// ── Physical Appearance Tables (original) ─────────────────────────────────────

type HeightRange = { male: [number, number]; female: [number, number] };
type WeightRange = { male: [number, number]; female: [number, number] };

const HEIGHT_RANGES: Record<Heritage, HeightRange> = {
  Aethborn:    { male: [62, 72], female: [58, 68] },
  Stonemarked: { male: [54, 64], female: [50, 60] },
  Verdant:     { male: [63, 73], female: [59, 69] },
  Cinder:      { male: [60, 70], female: [56, 66] },
  Saltblood:   { male: [64, 74], female: [60, 70] },
  Duskwalker:  { male: [65, 75], female: [61, 71] },
  Ironbound:   { male: [65, 76], female: [62, 72] },
};

const WEIGHT_RANGES: Record<Heritage, WeightRange> = {
  Aethborn:    { male: [120, 170], female: [100, 150] },
  Stonemarked: { male: [160, 230], female: [140, 200] },
  Verdant:     { male: [130, 185], female: [110, 160] },
  Cinder:      { male: [145, 200], female: [125, 175] },
  Saltblood:   { male: [150, 210], female: [130, 185] },
  Duskwalker:  { male: [130, 180], female: [110, 155] },
  Ironbound:   { male: [180, 260], female: [160, 230] },
};

const BUILDS: Record<Heritage, string[]> = {
  Aethborn:    ['lithe', 'willowy', 'slender', 'lean'],
  Stonemarked: ['stocky', 'broad', 'compact', 'dense'],
  Verdant:     ['wiry', 'lean', 'nimble', 'rangy'],
  Cinder:      ['sinewy', 'wiry', 'compact', 'lean'],
  Saltblood:   ['sturdy', 'broad-shouldered', 'hardy', 'athletic'],
  Duskwalker:  ['slender', 'lithe', 'lean', 'wiry'],
  Ironbound:   ['massive', 'barrel-chested', 'hulking', 'powerful'],
};

const COMPLEXIONS: Record<Heritage, string[]> = {
  Aethborn:    ['pale silver', 'cloud-white', 'pallid blue', 'faint gold'],
  Stonemarked: ['grey-brown', 'stone-grey', 'dark brown', 'ruddy slate'],
  Verdant:     ['olive', 'deep green-brown', 'rich umber', 'warm tan'],
  Cinder:      ['ash-grey', 'charcoal', 'ember-red', 'soot-dark'],
  Saltblood:   ['sun-weathered', 'deep tan', 'bronze', 'sandy brown'],
  Duskwalker:  ['twilight purple', 'dark grey', 'deep charcoal', 'night-black'],
  Ironbound:   ['ruddy bronze', 'hammered brown', 'dark red', 'burnished tan'],
};

const HAIR_COLORS: Record<Heritage, string[]> = {
  Aethborn:    ['silver-white', 'pale gold', 'ice blue', 'white'],
  Stonemarked: ['iron grey', 'dark brown', 'black', 'salt-and-pepper'],
  Verdant:     ['earthy brown', 'deep auburn', 'dark green-tinged', 'black'],
  Cinder:      ['ember red', 'ash white', 'charcoal black', 'burnt orange'],
  Saltblood:   ['sun-bleached blonde', 'sandy brown', 'dark auburn', 'salt-white'],
  Duskwalker:  ['midnight black', 'deep violet', 'dark grey', 'silver'],
  Ironbound:   ['dark brown', 'black', 'iron grey', 'reddish-brown'],
};

const EYE_COLORS: Record<Heritage, string[]> = {
  Aethborn:    ['pale blue', 'silver', 'white', 'sky grey'],
  Stonemarked: ['grey', 'brown', 'amber', 'gold'],
  Verdant:     ['deep green', 'hazel', 'amber', 'earthy brown'],
  Cinder:      ['red', 'amber', 'burnt orange', 'ember gold'],
  Saltblood:   ['sea green', 'grey-blue', 'teal', 'storm grey'],
  Duskwalker:  ['violet', 'deep purple', 'silver', 'pitch black'],
  Ironbound:   ['dark brown', 'amber', 'brown-gold', 'grey'],
};

const inchesToFtIn = (inches: number): string => {
  const ft = Math.floor(inches / 12);
  const ins = inches % 12;
  return `${ft}'${ins}"`;
};

// ── Stat Generation ───────────────────────────────────────────────────────────
// Uses 3d6+2 (range 5–20) instead of 4d6-drop-lowest to avoid D&D feel.
// Vocation priorities ensure the most relevant stats are highest.

const roll3d6plus2 = (): number =>
  randInt(1, 6) + randInt(1, 6) + randInt(1, 6) + 2;

const rollStats = (vocation: Vocation): StatBlock => {
  const scores = STATS.map(() => roll3d6plus2()).sort((a, b) => b - a);
  const priorities = VOCATION_STAT_PRIORITY[vocation];
  const secondary = STATS.filter(s => !priorities.includes(s));

  for (let i = secondary.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [secondary[i], secondary[j]] = [secondary[j], secondary[i]];
  }

  const ordered = [...priorities, ...secondary];
  const result = {} as StatBlock;
  STATS.forEach(stat => {
    result[stat] = scores[ordered.indexOf(stat)];
  });
  return result;
};

// ── Personality Generation ─────────────────────────────────────────────────────

const rollPersonality = (): Personality => ({
  loyalty:     randInt(1, 5) as Personality['loyalty'],
  ambition:    randInt(1, 5) as Personality['ambition'],
  temperament: randInt(1, 5) as Personality['temperament'],
  disposition: randInt(1, 5) as Personality['disposition'],
});

// ── Power Rating ──────────────────────────────────────────────────────────────
// Computed from stats + level; used for contract matching.

const computePowerRating = (stats: StatBlock, level: number): number => {
  const statSum = Object.values(stats).reduce((a, b) => a + b, 0);
  return Math.round((statSum / STATS.length) * level);
};

// ── Wage / Hire Cost ──────────────────────────────────────────────────────────

export const computeHireCost = (powerRating: number): number =>
  Math.round(50 + powerRating * 8 + Math.random() * 20);

export const computeDailyWage = (powerRating: number): number =>
  Math.round(5 + powerRating * 0.6);

// ── Heritage Weights ──────────────────────────────────────────────────────────
// Saltblood and Verdant are common; Ironbound and Duskwalker are rare.

const HERITAGE_WEIGHTS: readonly number[] = [12, 15, 18, 12, 18, 10, 15];

// ── Main Generator ─────────────────────────────────────────────────────────────

let idCounter = 1;
const newId = (): string => `adv_${Date.now()}_${idCounter++}`;

export const generateAdventurer = (): Adventurer => {
  const heritage = weightedPick(HERITAGES, HERITAGE_WEIGHTS);
  const vocation = pick(VOCATIONS);
  const gender   = pick(GENDERS);
  const name     = generateName(heritage, gender);

  const hRange = HEIGHT_RANGES[heritage][gender === 'Male' ? 'male' : 'female'];
  const wRange = WEIGHT_RANGES[heritage][gender === 'Male' ? 'male' : 'female'];
  const heightIn = randHeight(hRange[0], hRange[1]);
  const weightLbs = correlatedWeight(heightIn, hRange, wRange);

  const stats       = rollStats(vocation);
  const personality = rollPersonality();
  const level       = 1;
  const powerRating = computePowerRating(stats, level);

  return {
    id:          newId(),
    name,
    heritage,
    vocation,
    gender,
    level,
    experience:  0,
    powerRating,
    stats,
    personality,
    hireCost:    computeHireCost(powerRating),
    dailyWage:   computeDailyWage(powerRating),
    status:      'available',
    height:      inchesToFtIn(heightIn),
    build:       pick(BUILDS[heritage]),
    complexion:  pick(COMPLEXIONS[heritage]),
    hairColor:   pick(HAIR_COLORS[heritage]),
    eyeColor:    pick(EYE_COLORS[heritage]),
  };
};

export const generateAdventurerPool = (count: number): Adventurer[] =>
  Array.from({ length: count }, () => generateAdventurer());
