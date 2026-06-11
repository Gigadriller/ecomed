import { prisma } from "@/lib/db/prisma"
import { sendPushToUser } from "@/lib/push"
import {
  COIN_VALUES,
  COM_MULTIPLICADOR,
  ISENTO_TETO_GLOBAL,
  LIMITES_DIARIOS,
  LIMITES_MENSAIS,
  TETO_DIARIO_GLOBAL,
  calcularNivel,
  calcularStreak,
  diaUTC,
  inicioMesUTC,
  inicioSemanaUTC,
  multiplicadorNivel,
} from "./levels"

export { calcularNivel } from "./levels"

const NIVEL_LABEL: Record<string, string> = {
  SEMENTE: "Semente 🌱",
  BROTO: "Broto 🌿",
  ARVORE: "Árvore 🌳",
  GUARDIAO: "Guardião 🛡️",
  LENDA_ECO: "Lenda Eco ⭐",
}

// ---- Verifica teto diário global e limite por categoria; registra no tracker ----
async function verificarERegistrar(
  userId: string,
  event: string,
  amount: number,
): Promise<boolean> {
  const hoje = diaUTC()

  if (!ISENTO_TETO_GLOBAL.has(event)) {
    const totais = await prisma.dailyLimitTracker.findMany({ where: { userId, date: hoje } })
    const totalHoje = totais.reduce((s, t) => s + t.coins, 0)
    if (totalHoje + amount > TETO_DIARIO_GLOBAL) return false
  }

  const limite = LIMITES_DIARIOS[event]
  if (limite !== undefined) {
    const catRow = await prisma.dailyLimitTracker.findUnique({
      where: { userId_date_category: { userId, date: hoje, category: event } },
    })
    if (catRow && catRow.count >= limite) return false
  }

  // Verificar limite mensal
  const limiteMensal = LIMITES_MENSAIS[event]
  if (limiteMensal !== undefined) {
    const inicioMes = inicioMesUTC()
    const contMes = await prisma.dailyLimitTracker.findMany({
      where: { userId, category: event, date: { gte: inicioMes } },
    })
    const totalMes = contMes.reduce((s, t) => s + t.count, 0)
    if (totalMes >= limiteMensal) return false
  }

  // Registrar no tracker
  if (!["ADMIN_GRANT", "ADJUSTMENT", "REDEMPTION"].includes(event)) {
    await prisma.dailyLimitTracker.upsert({
      where: { userId_date_category: { userId, date: hoje, category: event } },
      update: { count: { increment: 1 }, coins: { increment: amount } },
      create: { userId, date: hoje, category: event, count: 1, coins: amount },
    })
  }

  return true
}

// ---- Credita coins para um usuário ----
export async function creditCoins(
  userId: string,
  event: string,
  reference?: string,
  customAmount?: number,
  label?: string,
): Promise<{ ok: boolean; newBalance: number; levelUp?: string; streakBonus?: string }> {
  let amount = customAmount ?? COIN_VALUES[event] ?? 0
  if (amount <= 0) return { ok: false, newBalance: 0 }

  // Buscar ou criar wallet
  let wallet = await prisma.wallet.findUnique({ where: { userId } })
  if (!wallet) {
    wallet = await prisma.wallet.create({
      data: { userId, balance: 0, totalEarned: 0, level: "SEMENTE" },
    })
  }

  // Aplicar multiplicador de nível
  if (COM_MULTIPLICADOR.has(event)) {
    amount = Math.round(amount * multiplicadorNivel(wallet.level))
  }

  // Verificar limites
  const dentroDoLimite = await verificarERegistrar(userId, event, amount)
  if (!dentroDoLimite) return { ok: false, newBalance: wallet.balance }

  // Calcular streak
  const { novoStreak, novoStreakBest, milestone } = calcularStreak(
    wallet.streakCurrent,
    wallet.streakBest,
    wallet.lastActivityAt,
  )

  const novoBalance = wallet.balance + amount
  const novoTotal = wallet.totalEarned + amount
  const novoNivel = calcularNivel(novoTotal) as string
  const levelUp = novoNivel !== wallet.level ? novoNivel : undefined

  // Ranking semanal — resetar se passou da segunda-feira
  const inicioSemana = inicioSemanaUTC()
  const precisaResetarSemanal =
    !wallet.weeklyCoinsResetAt || wallet.weeklyCoinsResetAt < inicioSemana

  await Promise.all([
    prisma.wallet.update({
      where: { userId },
      data: {
        balance: { increment: amount },
        totalEarned: { increment: amount },
        level: novoNivel as never,
        streakCurrent: novoStreak,
        streakBest: novoStreakBest,
        lastActivityAt: new Date(),
        weeklyCoins: precisaResetarSemanal ? amount : { increment: amount },
        weeklyCoinsResetAt: precisaResetarSemanal ? inicioSemana : undefined,
      },
    }),
    prisma.coinTransaction.create({
      data: {
        walletId: wallet.id,
        amount,
        event: event as never,
        reference: reference ?? null,
        note: label ?? `${event}${reference ? ` · ${reference}` : ""}`,
      },
    }),
  ])

  // Bônus de streak (recursivo, não reentra no limite pois STREAK_* são isentos)
  let streakBonus: string | undefined
  if (milestone) {
    await creditCoins(userId, milestone)
    streakBonus = milestone
  }

  // Push de level-up
  if (levelUp) {
    sendPushToUser(userId, {
      title: "Você subiu de nível! 🎊",
      body: `Agora você é ${NIVEL_LABEL[levelUp] ?? levelUp}. Continue assim!`,
      url: "/recompensas",
      tag: `levelup-${levelUp}`,
    }).catch((err) => console.error("[push:levelup] falhou:", err))
  }

  // Push de milestone de streak
  if (milestone) {
    const dias = milestone === "STREAK_30_DAYS" ? 30 : milestone === "STREAK_7_DAYS" ? 7 : 3
    sendPushToUser(userId, {
      title: `${dias} dias seguidos! 🔥`,
      body: `Sua sequência continua. Bônus de EcoCoins creditado.`,
      url: "/recompensas",
      tag: `streak-${milestone}`,
    }).catch((err) => console.error("[push:streak] falhou:", err))
  }

  return { ok: true, newBalance: novoBalance, levelUp, streakBonus }
}

// ---- Debitar coins (resgate de recompensa) ----
export async function debitCoins(
  userId: string,
  amount: number,
  note?: string,
): Promise<{ ok: boolean; newBalance?: number }> {
  const wallet = await prisma.wallet.findUnique({ where: { userId } })
  if (!wallet || wallet.balance < amount) return { ok: false }

  const newBalance = wallet.balance - amount

  await Promise.all([
    prisma.coinTransaction.create({
      data: {
        walletId: wallet.id,
        amount: -amount,
        event: "REDEMPTION" as never,
        note: note ?? null,
      },
    }),
    prisma.wallet.update({
      where: { id: wallet.id },
      data: { balance: { decrement: amount } },
    }),
  ])

  return { ok: true, newBalance }
}

// ---- Conceder badge ao usuário (idempotente) ----
export async function concederBadge(
  userId: string,
  badgeSlug: string,
): Promise<boolean> {
  const badge = await prisma.badge.findUnique({ where: { slug: badgeSlug } })
  if (!badge || !badge.active) return false

  const existing = await prisma.userBadge.findFirst({
    where: { userId, badgeId: badge.id },
  })
  if (existing) return false

  await prisma.userBadge.create({ data: { userId, badgeId: badge.id } })

  if (badge.coinReward > 0) {
    await creditCoins(userId, "BADGE_EARNED", badge.id, badge.coinReward)
  }

  return true
}

// ---- Dados completos da carteira (para API) ----
export async function getWalletInfo(userId: string) {
  return prisma.wallet.findUnique({
    where: { userId },
    include: {
      transactions: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  })
}
