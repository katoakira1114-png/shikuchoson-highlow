import raw from '../data/dataset.json';
import type { Dataset, MuniInfo } from '../shared/types';

export const dataset = raw as unknown as Dataset;

export const muniList: MuniInfo[] = dataset.munis.map((m) => ({ code: m.c, name: m.n, pref: m.p, kind: m.k }));

export const meta = {
  version: dataset.version,
  dummy: !!dataset.dummy,
  indicators: dataset.indicators.map((i) => ({ name: i.name, year: i.year, source: i.source })),
};
