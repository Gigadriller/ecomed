// Regras puras de gamificação (níveis, multiplicadores, streaks, limites).
// Sem dependência de banco ou push — ver index.ts para a orquestração com Prisma.

// ---- Início do dia em UTC (usado como chave do DailyLimitTracker) ----
export function diaUTC(base: Date = new Date()): Date {
  const d = new Date(base)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

// ---- Início da semana (segunda-feira 00:00 UTC) para ranking semanal ----
export function inicioSemanaUTC(base: Date = new Date()): Date {
  const d = new Date(base)
  d.setUTCHours(0, 0, 0, 0)
  const dow = d.getUTCDay() // 0=dom, 1=seg...
  d.setUTCDate(d.getUTCDate() - ((dow + 6) % 7))
  return d
}

// ---- Início do mês em UTC ----
export function inicioMesUTC(base: Date = new Date()): Date {
  const d = new Date(base)
  d.setUTCDate(1)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

// ---- Cálculo de nível pelo totalEarned (lifetime) ----
export function calcularNivel(
  totalEarned: number,
): "SEMENTE" | "BROTO" | "ARVORE" | "GUARDIAO" | "LENDA_ECO" {
  if (totalEarned <= 100) return "SEMENTE"
  if (totalEarned <= 500) return "BROTO"
  if (totalEarned <= 2000) return "ARVORE"
  if (totalEarned <= 5000) return "GUARDIAO"
  return "LENDA_ECO"
}

// ---- Multiplicador de Coins por nível (GUARDIAO e LENDA_ECO) ----
export function multiplicadorNivel(level: string): number {
  if (level === "GUARDIAO") return 1.2
  if (level === "LENDA_ECO") return 1.5
  return 1.0
}

// ---- Valor base por evento ----
export const COIN_VALUES: Record<string, number> = {
  // Onboarding (único por conta)
  SIGNUP: 20,
  ONBOARDING_PROFILE: 10,
  ONBOARDING_SCREENS: 5,
  ONBOARDING_GEO: 5,
  ONBOARDING_PUSH: 5,
  // Descarte
  CHECKIN: 10,              // GPS = 15 (passar como customAmount)
  CHECKIN_FIRST_MONTH: 5,
  CHECKIN_NEW_POINT: 5,
  // Educação
  ARTICLE_READ: 2,
  QUIZ: 5,
  QUIZ_PERFECT: 10,
  ECOBOT_QUESTION: 1,
  ECOBOT_RATING: 1,
  // Engajamento social
  REFERRAL: 20,
  SHARE_ARTICLE: 3,
  SHARE_BADGE: 2,
  // Streaks
  STREAK_3_DAYS: 5,
  STREAK_7_DAYS: 15,
  STREAK_30_DAYS: 50,
  DAILY_STREAK: 1,
  // Missões
  MISSION_COMPLETE: 0,     // variável — informar customAmount
  MISSION_DAILY_BONUS: 10,
  MISSION_WEEKLY_BONUS: 15,
  // Outros
  REPORT_SUBMITTED: 5,
  BADGE_EARNED: 0,
  ADMIN_GRANT: 0,
  ADJUSTMENT: 0,
}

// ---- Limite diário por categoria ----
export const LIMITES_DIARIOS: Partial<Record<string, number>> = {
  CHECKIN: 3,
  ARTICLE_READ: 5,
  QUIZ: 3,
  QUIZ_PERFECT: 3,
  ECOBOT_QUESTION: 10,
  ECOBOT_RATING: 10,
  SHARE_ARTICLE: 2,
  SHARE_BADGE: 1,
  REPORT_SUBMITTED: 3,
}

// ---- Limite mensal por categoria (verificado separadamente) ----
export const LIMITES_MENSAIS: Partial<Record<string, number>> = {
  REFERRAL: 5,
}

// ---- Eventos isentos do teto diário global ----
export const ISENTO_TETO_GLOBAL = new Set([
  "SIGNUP",
  "ONBOARDING_PROFILE",
  "ONBOARDING_SCREENS",
  "ONBOARDING_GEO",
  "ONBOARDING_PUSH",
  "REFERRAL",           // indicação de amigo — não deve ser bloqueada pelo teto diário
  "ADMIN_GRANT",
  "ADJUSTMENT",
  "REDEMPTION",
  "STREAK_3_DAYS",
  "STREAK_7_DAYS",
  "STREAK_30_DAYS",
])

// ---- Eventos com multiplicador de nível ----
export const COM_MULTIPLICADOR = new Set([
  "CHECKIN",
  "ARTICLE_READ",
  "QUIZ",
  "QUIZ_PERFECT",
  "MISSION_COMPLETE",
])

export const TETO_DIARIO_GLOBAL = 120

// ---- Atualiza streak e retorna milestone se atingido ----
export function calcularStreak(
  streakAtual: number,
  streakBest: number,
  lastActivityAt: Date | null,
  agora: Date = new Date(),
): { novoStreak: number; novoStreakBest: number; milestone?: string } {
  const agoraUtc0 = diaUTC(agora)

  if (!lastActivityAt) {
    return { novoStreak: 1, novoStreakBest: Math.max(1, streakBest) }
  }

  const ultimoUtc0 = new Date(lastActivityAt)
  ultimoUtc0.setUTCHours(0, 0, 0, 0)
  const diffDias = Math.round((agoraUtc0.getTime() - ultimoUtc0.getTime()) / 86_400_000)

  if (diffDias === 0) {
    return { novoStreak: streakAtual, novoStreakBest: streakBest }
  }
  if (diffDias === 1) {
    const novoStreak = streakAtual + 1
    const novoStreakBest = Math.max(novoStreak, streakBest)
    let milestone: string | undefined
    if (novoStreak === 30) milestone = "STREAK_30_DAYS"
    else if (novoStreak === 7) milestone = "STREAK_7_DAYS"
    else if (novoStreak === 3) milestone = "STREAK_3_DAYS"
    return { novoStreak, novoStreakBest, milestone }
  }
  // streak quebrado
  return { novoStreak: 1, novoStreakBest: streakBest }
}
