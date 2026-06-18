import { prisma } from "@/lib/db/prisma"
import { haversineMetros } from "@/lib/geo/haversine"

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
  lat?: number | null
  lng?: number | null
}

function toServed(c: { id: string; advertiser: string; imageUrl: string; format: string }): ServedAd {
  return { id: c.id, advertiser: c.advertiser, imageUrl: c.imageUrl, format: c.format as AdFormat }
}

/**
 * Seleciona uma campanha ativa para o placement, respeitando vigência e
 * segmentação. Prioridade de relevância (mais específica primeiro):
 *   1. Raio hiperlocal — usuário a até radiusKm do ponto (exige lat/lng)
 *   2. Cidade/UF — campanha geo-segmentada que bate com o contexto
 *   3. Nacional — sem segmentação
 * Dentro do nível escolhido, a escolha é ponderada por weight.
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
      centerLat: true,
      centerLng: true,
      radiusKm: true,
      weight: true,
    },
  })

  if (candidatas.length === 0) return null

  const cidade = opts.city?.trim().toLowerCase() ?? null
  const uf = opts.state?.trim().toUpperCase() ?? null
  const temCoords = typeof opts.lat === "number" && typeof opts.lng === "number"

  const radio: typeof candidatas = []
  const geo: typeof candidatas = []
  const nacional: typeof candidatas = []

  for (const c of candidatas) {
    // Campanha com raio: só elegível se temos a posição do usuário e ele está dentro.
    if (c.radiusKm && c.centerLat != null && c.centerLng != null) {
      if (!temCoords) continue
      const dist = haversineMetros(opts.lat as number, opts.lng as number, c.centerLat, c.centerLng)
      if (dist <= c.radiusKm * 1000) radio.push(c)
      continue
    }

    // Campanha geo-segmentada por cidade/UF.
    if (c.targetState && c.targetState.toUpperCase() !== uf) continue
    if (c.targetCity && c.targetCity.trim().toLowerCase() !== cidade) continue
    if (c.targetCity || c.targetState) geo.push(c)
    else nacional.push(c)
  }

  const pool = radio.length > 0 ? radio : geo.length > 0 ? geo : nacional
  if (pool.length === 0) return null

  // Seleção ponderada por weight.
  const totalPeso = pool.reduce((s, c) => s + Math.max(1, c.weight), 0)
  let sorteio = Math.random() * totalPeso
  for (const c of pool) {
    sorteio -= Math.max(1, c.weight)
    if (sorteio <= 0) return toServed(c)
  }
  return toServed(pool[0])
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
