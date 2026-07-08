import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

// Starter wiki content only — no in-app editor yet, so further edits happen
// via `pnpm db:studio`. Only created if missing, so re-running never clobbers
// edits made there. Safe to run standalone against any environment (including
// production) since it never touches the adventurer/contract market pool.

export const WIKI_PAGES = [
  {
    slug:  'heritages',
    title: 'Heritages',
    order: 1,
    body: `Every adventurer belongs to one of seven heritages, each with its own build, coloring, and stat leanings from character generation.

- **Aethborn** — pale, silver-toned, often lithe or willowy. The rarest of the common heritages.
- **Stonemarked** — stocky and broad, grey-brown complexions. Naturally sturdy.
- **Verdant** — wiry and lean, earthy or olive complexions. One of the more common heritages.
- **Cinder** — sinewy builds, ash-grey to ember-red coloring.
- **Saltblood** — sturdy and weathered, common among coastal-raised adventurers.
- **Duskwalker** — slender, pale-to-charcoal complexions, favor muted colors. Uncommon.
- **Ironbound** — massive, barrel-chested, hammered bronze-to-brown coloring. The rarest heritage.

Heritage currently determines an adventurer's generated name pool, physical appearance (height, build, complexion, hair, eyes), and how frequently that heritage appears in the adventurer pool — it has no direct effect on stats or gameplay mechanics today.`,
  },
  {
    slug:  'vocations',
    title: 'Vocations',
    order: 2,
    body: `Every adventurer has one of eight vocations, which determines which stats they roll highest and their title as they level up.

| Vocation | Primary Stats | Titles (by level) |
|---|---|---|
| Sellsword | Might, Grit, Finesse | Sellsword → Warblade → Ironclad |
| Outrider | Finesse, Grit, Cunning | Outrider → Pathfinder → Ghost |
| Arcanist | Attunement, Cunning, Influence | Arcanist → Invoker → Archon |
| Mender | Influence, Attunement, Grit | Mender → Warden → Lifebinder |
| Trickster | Finesse, Cunning, Influence | Trickster → Phantom → Shadowblade |
| Invoker | Attunement, Might, Grit | Invoker → Stormbinder → Conduit |
| Chanter | Influence, Cunning, Attunement | Chanter → Liturgist → Hierophant |
| Alchemist | Cunning, Attunement, Finesse | Alchemist → Distiller → Grandmaster |

An adventurer's title changes automatically as they level up — it's purely cosmetic and doesn't affect their stats.`,
  },
  {
    slug:  'characteristics',
    title: 'Characteristics',
    order: 3,
    body: `Every adventurer has six core stats and four personality traits, rolled at generation.

## Stats
**Might, Finesse, Grit, Cunning, Attunement, Influence** — each rolled between 5 and 20. An adventurer's vocation determines which three stats tend to roll highest. Stats (averaged, scaled by level) determine an adventurer's Power Rating, which is what actually matters for taking on contracts.

## Personality
Personality traits are rated 1–5 and each carries a real gameplay trade-off:

- **Loyalty** *(Mercenary → Steadfast)* — Low loyalty sharply increases the chance an adventurer quits when they don't receive expected payment or are underutilized by the player; loyalty recovers slowly when wages are paid on time.
- **Ambition** *(Content → Obsessed)* — Ambitious adventurers gain experience faster from successful contracts, but expect work that matches their growing skill. Repeatedly sending one on contracts beneath their ability, or leaving them idle too long between jobs, risks souring their loyalty — the more ambitious, the faster and more severely it sours.
- **Temperament** *(Cautious → Reckless)* — Reckless adventurers take risks in the field: a chance to bring back extra reward from a successful contract, but also a higher chance of injury regardless of how the contract turns out. Cautious adventurers trade that upside for a safer track record.
- **Disposition** *(Gruff → Amiable)* — Adventurers who complete contracts together build camaraderie over time, and a well-bonded party performs better as a whole. Amiable adventurers build that bond faster than gruff ones — and it fades if the pair stops adventuring together.`,
  },
];

export async function seedWiki(prisma: PrismaClient) {
  const existing = await prisma.wikiPage.findMany({ select: { slug: true } });
  const existingSlugs = new Set(existing.map((p) => p.slug));
  const missing = WIKI_PAGES.filter((p) => !existingSlugs.has(p.slug));

  if (missing.length > 0) {
    await prisma.wikiPage.createMany({ data: missing });
  }
  console.log(`  ✓ Wiki: created ${missing.length} page(s), ${existingSlugs.size} already existed`);
}

// Allow running standalone: `tsx prisma/seedWiki.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  const prisma = new PrismaClient();
  seedWiki(prisma)
    .catch(console.error)
    .finally(() => prisma.$disconnect());
}
