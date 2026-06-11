/**
 * Testes das regras puras de gamificação (src/lib/coins/levels.ts)
 *
 * Coberturas:
 *  - calcularNivel: todas as fronteiras de nível (100/101, 500/501, 2000/2001, 5000/5001)
 *  - multiplicadorNivel: 1.0 / 1.2 / 1.5
 *  - calcularStreak: primeiro dia, mesmo dia, dia seguinte, milestones (3/7/30), quebra
 *  - diaUTC / inicioSemanaUTC / inicioMesUTC: truncamento correto
 *  - Consistência das tabelas de limites e isenções
 */

import { describe, it, expect } from 'vitest'
import {
  COIN_VALUES,
  ISENTO_TETO_GLOBAL,
  LIMITES_DIARIOS,
  TETO_DIARIO_GLOBAL,
  calcularNivel,
  calcularStreak,
  diaUTC,
  inicioMesUTC,
  inicioSemanaUTC,
  multiplicadorNivel,
} from '@/lib/coins/levels'

// ─────────────────────────────────────────────────────────────────────────────
// 1. NÍVEIS
// ─────────────────────────────────────────────────────────────────────────────

describe('calcularNivel — fronteiras de nível', () => {
  it.each([
    [0, 'SEMENTE'],
    [100, 'SEMENTE'],
    [101, 'BROTO'],
    [500, 'BROTO'],
    [501, 'ARVORE'],
    [2000, 'ARVORE'],
    [2001, 'GUARDIAO'],
    [5000, 'GUARDIAO'],
    [5001, 'LENDA_ECO'],
    [1_000_000, 'LENDA_ECO'],
  ])('totalEarned=%i → %s', (total, esperado) => {
    expect(calcularNivel(total)).toBe(esperado)
  })
})

describe('multiplicadorNivel', () => {
  it.each([
    ['SEMENTE', 1.0],
    ['BROTO', 1.0],
    ['ARVORE', 1.0],
    ['GUARDIAO', 1.2],
    ['LENDA_ECO', 1.5],
    ['NIVEL_INEXISTENTE', 1.0],
  ])('%s → %f', (nivel, esperado) => {
    expect(multiplicadorNivel(nivel)).toBe(esperado)
  })

  it('CHECKIN de 10 coins vira 12 para GUARDIAO e 15 para LENDA_ECO (arredondado)', () => {
    expect(Math.round(COIN_VALUES.CHECKIN * multiplicadorNivel('GUARDIAO'))).toBe(12)
    expect(Math.round(COIN_VALUES.CHECKIN * multiplicadorNivel('LENDA_ECO'))).toBe(15)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. STREAK
// ─────────────────────────────────────────────────────────────────────────────

const dia = (iso: string) => new Date(`${iso}T12:00:00Z`)

describe('calcularStreak', () => {
  it('primeira atividade (lastActivityAt = null) inicia streak em 1', () => {
    const r = calcularStreak(0, 0, null, dia('2026-06-10'))
    expect(r).toEqual({ novoStreak: 1, novoStreakBest: 1 })
  })

  it('primeira atividade preserva streakBest anterior maior', () => {
    const r = calcularStreak(0, 9, null, dia('2026-06-10'))
    expect(r.novoStreakBest).toBe(9)
  })

  it('mesma data (mesmo dia UTC) não altera o streak', () => {
    const r = calcularStreak(4, 6, dia('2026-06-10'), dia('2026-06-10'))
    expect(r).toEqual({ novoStreak: 4, novoStreakBest: 6 })
  })

  it('dia seguinte incrementa o streak', () => {
    const r = calcularStreak(1, 1, dia('2026-06-09'), dia('2026-06-10'))
    expect(r.novoStreak).toBe(2)
    expect(r.novoStreakBest).toBe(2)
    expect(r.milestone).toBeUndefined()
  })

  it('atinge milestone STREAK_3_DAYS no terceiro dia consecutivo', () => {
    const r = calcularStreak(2, 2, dia('2026-06-09'), dia('2026-06-10'))
    expect(r.novoStreak).toBe(3)
    expect(r.milestone).toBe('STREAK_3_DAYS')
  })

  it('atinge milestone STREAK_7_DAYS no sétimo dia consecutivo', () => {
    const r = calcularStreak(6, 6, dia('2026-06-09'), dia('2026-06-10'))
    expect(r.novoStreak).toBe(7)
    expect(r.milestone).toBe('STREAK_7_DAYS')
  })

  it('atinge milestone STREAK_30_DAYS no trigésimo dia consecutivo', () => {
    const r = calcularStreak(29, 29, dia('2026-06-09'), dia('2026-06-10'))
    expect(r.novoStreak).toBe(30)
    expect(r.milestone).toBe('STREAK_30_DAYS')
  })

  it('não emite milestone em dias intermediários (ex: 4º dia)', () => {
    const r = calcularStreak(3, 3, dia('2026-06-09'), dia('2026-06-10'))
    expect(r.novoStreak).toBe(4)
    expect(r.milestone).toBeUndefined()
  })

  it('quebra o streak após 2+ dias sem atividade (volta para 1, preserva best)', () => {
    const r = calcularStreak(15, 15, dia('2026-06-07'), dia('2026-06-10'))
    expect(r.novoStreak).toBe(1)
    expect(r.novoStreakBest).toBe(15)
    expect(r.milestone).toBeUndefined()
  })

  it('virada de mês conta como dia seguinte (31/05 → 01/06)', () => {
    const r = calcularStreak(1, 1, dia('2026-05-31'), dia('2026-06-01'))
    expect(r.novoStreak).toBe(2)
  })

  it('horários diferentes no mesmo dia UTC contam como mesmo dia', () => {
    const ontem23h = new Date('2026-06-09T23:59:00Z')
    const hoje00h = new Date('2026-06-10T00:01:00Z')
    const r = calcularStreak(2, 2, ontem23h, hoje00h)
    // 09/06 23:59 → dia UTC 09/06; 10/06 00:01 → dia UTC 10/06 = dia seguinte
    expect(r.novoStreak).toBe(3)
    expect(r.milestone).toBe('STREAK_3_DAYS')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. HELPERS DE DATA
// ─────────────────────────────────────────────────────────────────────────────

describe('Helpers de data UTC', () => {
  it('diaUTC trunca para meia-noite UTC sem mutar a entrada', () => {
    const base = new Date('2026-06-10T15:30:45.123Z')
    const r = diaUTC(base)
    expect(r.toISOString()).toBe('2026-06-10T00:00:00.000Z')
    expect(base.toISOString()).toBe('2026-06-10T15:30:45.123Z')
  })

  it('inicioSemanaUTC retorna a segunda-feira da semana (quarta 10/06 → segunda 08/06)', () => {
    // 2026-06-10 é uma quarta-feira
    expect(inicioSemanaUTC(dia('2026-06-10')).toISOString()).toBe('2026-06-08T00:00:00.000Z')
  })

  it('inicioSemanaUTC no domingo retorna a segunda anterior (dom 14/06 → seg 08/06)', () => {
    expect(inicioSemanaUTC(dia('2026-06-14')).toISOString()).toBe('2026-06-08T00:00:00.000Z')
  })

  it('inicioSemanaUTC na própria segunda retorna o mesmo dia', () => {
    expect(inicioSemanaUTC(dia('2026-06-08')).toISOString()).toBe('2026-06-08T00:00:00.000Z')
  })

  it('inicioMesUTC retorna o dia 1º do mês', () => {
    expect(inicioMesUTC(dia('2026-06-25')).toISOString()).toBe('2026-06-01T00:00:00.000Z')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. CONSISTÊNCIA DAS TABELAS ANTI-FRAUDE
// ─────────────────────────────────────────────────────────────────────────────

describe('Consistência das tabelas de limites', () => {
  it('todo evento com limite diário existe na tabela de valores', () => {
    for (const evento of Object.keys(LIMITES_DIARIOS)) {
      expect(COIN_VALUES, `evento ${evento} sem valor definido`).toHaveProperty(evento)
    }
  })

  it('eventos isentos do teto global existem na tabela de valores (exceto REDEMPTION, que é débito)', () => {
    for (const evento of ISENTO_TETO_GLOBAL) {
      if (evento === 'REDEMPTION') continue
      expect(COIN_VALUES, `evento ${evento} sem valor definido`).toHaveProperty(evento)
    }
  })

  it('teto diário global comporta o maior ganho unitário possível com multiplicador', () => {
    const maiorBase = Math.max(
      ...Object.entries(COIN_VALUES)
        .filter(([e]) => !ISENTO_TETO_GLOBAL.has(e))
        .map(([, v]) => v),
    )
    expect(Math.round(maiorBase * 1.5)).toBeLessThanOrEqual(TETO_DIARIO_GLOBAL)
  })

  it('streak milestones têm recompensas crescentes (3 < 7 < 30 dias)', () => {
    expect(COIN_VALUES.STREAK_3_DAYS).toBeLessThan(COIN_VALUES.STREAK_7_DAYS)
    expect(COIN_VALUES.STREAK_7_DAYS).toBeLessThan(COIN_VALUES.STREAK_30_DAYS)
  })
})
