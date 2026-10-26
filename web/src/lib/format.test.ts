import { describe, expect, it } from 'vitest'
import { fmtClock, fmtDateTime, fmtDur, fmtInt, fmtPct } from './format'

describe('formatação pt-BR', () => {
  it('formata inteiros e percentuais', () => {
    expect(fmtInt(1234567)).toBe('1.234.567')
    expect(fmtPct(51.7912)).toBe('51,79%')
    expect(fmtPct(null)).toBe('—')
  })
  it('formata horários e durações', () => {
    expect(fmtClock(1020)).toBe('17:00')
    expect(fmtClock(1500)).toBe('01:00 (+1d)')
    expect(fmtDur(543)).toBe('9h 03min')
    expect(fmtDur(-5)).toBe('−5min')
  })
  it('indica o fuso na data', () => {
    expect(fmtDateTime('2026-10-04T15:01:05', 'AC')).toBe('04/10/2026 15:01 (UTC−5)')
    expect(fmtDateTime('2026-10-04 07:00:01', 'RR')).toBe('04/10/2026 07:00 (UTC−4)')
    expect(fmtDateTime('2026-10-04 08:00:00', 'SP')).toBe('04/10/2026 08:00 (UTC−3)')
  })
})
