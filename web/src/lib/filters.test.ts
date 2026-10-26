// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EMPTY, hasFilters, parse, serialize, toApiParams } from './filters'

describe('estado dos filtros na URL', () => {
  it('ida e volta (round-trip) preserva todos os filtros', () => {
    const q = '?cargo=3&uf=AC,RR&mun=1392&zona=1,2&venc=13&tipo_urna=Apurada&agregada=1&depois17=1&r=abst_pct:5:20&r=aptos::300&cand=22:40:&v=mapa&d=AC.1.23&mm=margem'
    const s = parse(q)
    expect(s.f.uf).toEqual(['AC', 'RR'])
    expect(s.f.r.abst_pct).toEqual([5, 20])
    expect(s.f.r.aptos).toEqual([null, 300])
    expect(s.f.cand[22]).toEqual([40, null])
    expect(s.v).toBe('mapa')
    expect(s.ex.mm).toBe('margem')
    expect(parse(serialize(s))).toEqual(s)
  })
  it('descarta lixo e usa padrões', () => {
    const s = parse('?cargo=9&mun=a,2&v=xyz')
    expect(s.f.cargo).toBe(1)
    expect(s.f.mun).toEqual([2])
    expect(s.v).toBe('geral')
    expect(hasFilters(s.f)).toBe(true)
    expect(hasFilters(EMPTY)).toBe(false)
  })
  it('gera os parâmetros da API', () => {
    const p = toApiParams(parse('?uf=AC&r=bn_pct:1:2').f)
    expect(p.get('uf')).toBe('AC')
    expect(p.getAll('r')).toEqual(['bn_pct:1:2'])
  })
})
