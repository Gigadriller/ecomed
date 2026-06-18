import { prisma } from "@/lib/db/prisma"

// Placements válidos onde um banner pode ser exibido.
// NUNCA incluir fluxos sensíveis (checkin, EcoBot, emergência).
export const AD_PLACEMENTS = ["MAP_LIST", "CITY_DISCARD", "IMPACT", "BLOG_ARTICLE"] as const
export type AdPlacement = (typeof AD_PLACEMENTS)[number]

export const AD_FORMATS = ["LEADERBOARD", "RECTANGLE", "MOBILE_BANNER"] as const
export type AdFormat = (typeof AD_FORMATS)[number]

export interface ServedAd {
  id: string
  advertiser: string
  imageUrl: string
  format: AdFormat
}

interface ServeOptions {
  city?: string | null
  state?: string | null
}

/**
 * Seleciona uma campanha ativa para o placement, respeitando vigência e
 * segmentação geográfica. Campanhas com cidade/UF definida têm prioridade
 * sobre as nacionais quando o contexto bate. Escolha final é ponderada por weight.
 */
export async function getActiveAd(
  placement: AdPlacement,
  opts: ServeOptions = {},
): Promise<ServedAd | null> {
  const agora = new Date()

  const candidatas = await prisma.adCampaign.findMany({
    where: {
      placement,
      active: true,
      startsAt: { lte: agora },
      OR: [{ endsAt: null }, { endsAt: { gte: agora } }],
    },
    select: {
      id: true,
      advertiser: true,
      imageUrl: true,
      format: true,
      targetCity: true,
      targetState: true,
      weight: true,
    },
  })

  if (candidatas.length === 0) return null

  // Filtra por segmentação: mantém campanhas nacionais (sem cidade/UF) e as que
  // batem com o contexto. Descarta as segmentadas para outra praça.
  const cidade = opts.city?.trim().toLowerCase() ?? null
  const uf = opts.state?.trim().toUpperCase() ?? null

  const elegiveis = candidatas.filter((c) => {
    if (c.targetState && c.targetState.toUpperCase() !== uf) return false
    if (c.targetCity && c.targetCity.trim().toLowerCase() !== cidade) return false
    return true
  })

  if (elegiveis.length === 0) return null

  // Dá prioridade às campanhas geo-segmentadas (mais relevantes) quando existem.
  const segmentadas = elegiveis.filter((c) => c.targetCity || c.targetState)
  const pool = segmentadas.length > 0 ? segmentadas : elegiveis

  // Seleção ponderada por weight.
  const totalPeso = pool.reduce((s, c) => s + Math.max(1, c.weight), 0)
  let sorteio = Math.random() * totalPeso
  for (const c of pool) {
    sorteio -= Math.max(1, c.weight)
    if (sorteio <= 0) {
      return { id: c.id, advertiser: c.advertiser, imageUrl: c.imageUrl, format: c.format as AdFormat }
    }
  }

  const fallback = pool[0]
  return {
    id: fallback.id,
    advertiser: fallback.advertiser,
    imageUrl: fallback.imageUrl,
    format: fallback.format as AdFormat,
  }
}

/** Registra impressão no agregado diário (idempotente por campanha+dia). */
export async function registrarImpressao(campaignId: string): Promise<void> {
  const hoje = new Date()
  hoje.setUTCHours(0, 0, 0, 0)
  await prisma.adEventDaily.upsert({
    where: { campaignId_date: { campaignId, date: hoje } },
    update: { impressions: { increment: 1 } },
    create: { campaignId, date: hoje, impressions: 1, clicks: 0 },
  })
}

/** Registra clique no agregado diário e retorna a URL de destino, se válida. */
export async function registrarClique(campaignId: string): Promise<string | null> {
  const campanha = await prisma.adCampaign.findUnique({
    where: { id: campaignId },
    select: { targetUrl: true },
  })
  if (!campanha) return null

  const hoje = new Date()
  hoje.setUTCHours(0, 0, 0, 0)
  await prisma.adEventDaily.upsert({
    where: { campaignId_date: { campaignId, date: hoje } },
    update: { clicks: { increment: 1 } },
    create: { campaignId, date: hoje, impressions: 0, clicks: 1 },
  })

  return campanha.targetUrl
}
