import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import { z } from "zod"
import { checkRateLimit } from "@/lib/ratelimit"
import {
  AD_PLACEMENTS,
  getActiveAd,
  registrarClique,
  registrarImpressao,
} from "@/lib/ads"

const ads = new Hono()

// GET /api/ads/serve?placement=&city=&state= — devolve 1 anúncio para o slot
ads.get(
  "/serve",
  zValidator(
    "query",
    z.object({
      placement: z.enum(AD_PLACEMENTS),
      city: z.string().optional(),
      state: z.string().optional(),
      lat: z.coerce.number().min(-90).max(90).optional(),
      lng: z.coerce.number().min(-180).max(180).optional(),
    }),
  ),
  async (c) => {
    const { placement, city, state, lat, lng } = c.req.valid("query")
    const ad = await getActiveAd(placement, { city, state, lat, lng })
    // Cache curto no edge: evita martelar o banco, mas mantém rotação razoável.
    // Vary implícito pela query (lat/lng arredondados pelo cliente).
    c.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
    return c.json({ ad })
  },
)

// POST /api/ads/impression { campaignId } — contabiliza exibição
ads.post(
  "/impression",
  zValidator("json", z.object({ campaignId: z.string().cuid() })),
  async (c) => {
    const ip = c.req.header("CF-Connecting-IP") ?? "anon"
    const { success } = await checkRateLimit("map", ip)
    if (!success) return c.json({ ok: false }, 429)

    const { campaignId } = c.req.valid("json")
    await registrarImpressao(campaignId).catch(() => null)
    return c.json({ ok: true })
  },
)

// GET /api/ads/click/:id — contabiliza clique e redireciona ao destino
ads.get("/click/:id", async (c) => {
  const id = c.req.param("id")
  const destino = await registrarClique(id).catch(() => null)

  if (!destino) return c.redirect("/", 302)

  // Só permite redirect para http(s) absoluto (anti open-redirect malicioso).
  try {
    const url = new URL(destino)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return c.redirect("/", 302)
    }
    return c.redirect(url.toString(), 302)
  } catch {
    return c.redirect("/", 302)
  }
})

export default ads
