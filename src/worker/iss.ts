import type { CrewMember, IssResponse } from '../shared/types';
import { cached } from './cache';
import { json, type Env } from './env';
import { skyContext } from './sky';
import { getText, issTle, tleLines, visiblePasses } from './tonight';

// The Space Station screen: the orbit (the display works out the position itself, every
// second), who's aboard, and when it next passes over visibly.
//   orbit   CelesTrak, shared with Tonight
//   crew    the community-kept "people in space" list (corquaid on GitHub), checked every 6 hours

const CREW_URL = 'https://corquaid.github.io/international-space-station-APIs/JSON/people-in-space.json';

interface PeopleInSpace {
  iss_expedition?: number;
  people: Array<{ name: string; agency: string; position: string; country: string; spacecraft: string; launched: number; iss: boolean }>;
}

async function crew(env: Env): Promise<{ crew: CrewMember[]; expedition?: number }> {
  return cached(env, 'iss:crew:v1', 6 * 3600, async () => {
    const d = JSON.parse(await getText(CREW_URL)) as PeopleInSpace;
    // The list covers everyone in orbit; the Chinese station's crew are on it too.
    const aboard = d.people.filter(p => p.iss).map(p => ({ name: p.name, agency: p.agency, role: p.position, country: p.country, spacecraft: p.spacecraft, launched: p.launched }));
    return { crew: aboard, expedition: d.iss_expedition };
  });
}

export async function handleIss(env: Env, url: URL, request: Request): Promise<Response> {
  const tle = await issTle(env).catch(() => null);
  const lines = tle && tleLines(tle);
  if (!tle || !lines) return json({ error: 'The station’s orbit isn’t available right now.' }, { status: 502 });
  // Each part is optional: the map works without the crew list or a place.
  const [people, home] = await Promise.all([
    crew(env).catch(() => ({ crew: [] as CrewMember[], expedition: undefined })),
    skyContext(env, url, request).then(s => s.home, () => null),
  ]);
  const passes = home ? await visiblePasses(env, tle, home.lat, home.lon).catch(() => undefined) : undefined;
  return json({ tle: lines, crew: people.crew, expedition: people.expedition, passes } satisfies IssResponse);
}
