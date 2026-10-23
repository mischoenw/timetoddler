import { openDb } from '@core/db'
import { Repo } from '@core/repo'
import { AppService } from '@core/service'

export function at(local: string): number {
  // 'YYYY-MM-DD HH:MM' in the test time zone (Europe/Berlin)
  const [d, t = '00:00'] = local.split(' ')
  const [y, m, day] = d.split('-').map(Number)
  const [hh, mm] = t.split(':').map(Number)
  return new Date(y, m - 1, day, hh, mm).getTime()
}

export class Clock {
  constructor(public t: number) {}
  now = (): number => this.t
  set(local: string): void {
    this.t = at(local)
  }
}

export async function setup(start = '2026-10-21 08:00') {
  const clock = new Clock(at(start))
  const repo = new Repo(await openDb())
  const svc = new AppService(repo, clock.now)
  return { clock, repo, svc }
}
