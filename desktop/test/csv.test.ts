import { describe, expect, it } from 'vitest'
import { attendanceCsv, entriesCsv } from '@core/csv'
import type { Project } from '@shared/types'
import { at } from './helpers'

const project: Project = {
  id: 1, kind: 'youtrack', name: 'Login; Fix', client: 'ABC', color: '#000', favorite: false, archived: false,
  createdAt: 0, ytProjectId: null, ytIssue: 'ABC-1', ytWorkTypeId: null, ytStale: false
}

describe('csv', () => {
  it('quotes and splits entries per day', () => {
    const csv = entriesCsv(
      [{ id: 1, projectId: 1, start: at('2026-10-21 23:00'), end: at('2026-10-22 00:30'), note: 'a "b"', ytIssue: null }],
      new Map([[1, project]]),
      new Map([[1, 'booked']]),
      0
    )
    expect(csv.split('\r\n')).toEqual([
      'Datum;Start;Ende;Dauer;Minuten;Tätigkeit;Kunde;Ticket;Notiz;Status',
      '2026-10-21;23:00;00:00;1:00;60;"Login; Fix";ABC;ABC-1;"a ""b""";gebucht',
      '2026-10-22;00:00;00:30;0:30;30;"Login; Fix";ABC;ABC-1;"a ""b""";gebucht',
      ''
    ])
  })

  it('lists attendance chronologically', () => {
    const csv = attendanceCsv(
      [{ id: 1, start: at('2026-10-21 08:00'), end: at('2026-10-21 16:00') }],
      [{ id: 1, presenceId: 1, start: at('2026-10-21 12:00'), end: at('2026-10-21 12:30'), resumeProjectId: null }],
      0
    )
    expect(csv.split('\r\n').slice(1, 3)).toEqual(['2026-10-21;Anwesenheit;08:00;16:00;8:00;480', '2026-10-21;Pause;12:00;12:30;0:30;30'])
  })
})
