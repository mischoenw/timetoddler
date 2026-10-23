import type { Project } from './types'

/** Knob and tile order: favourites first, then alphabetical; archived never. */
export function tileOrder(projects: Project[]): Project[] {
  return projects
    .filter((p) => !p.archived)
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }))
}

export const PALETTE = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#469990', '#9a6324', '#800000', '#000075']

export function nextColor(used: string[]): string {
  return PALETTE.find((c) => !used.includes(c)) ?? PALETTE[used.length % PALETTE.length]
}
