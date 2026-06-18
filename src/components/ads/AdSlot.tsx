"use client"

import { useEffect, useRef, useState } from "react"

type AdFormat = "LEADERBOARD" | "RECTANGLE" | "MOBILE_BANNER"
type AdPlacement = "MAP_LIST" | "CITY_DISCARD" | "IMPACT" | "BLOG_ARTICLE"

interface ServedAd {
  id: string
  advertiser: string
  imageUrl: string
  format: AdFormat
}

interface AdSlotProps {
  placement: AdPlacement
  city?: string
  state?: string
  className?: string
}

// Proporções reservadas por formato — evita layout shift (CLS) enquanto carrega.
const FORMAT_BOX: Record<AdFormat, { maxWidth: number; ratio: string }> = {
  LEADERBOARD: { maxWidth: 728, ratio: "728 / 90" },
  RECTANGLE: { maxWidth: 300, ratio: "300 / 250" },
  MOBILE_BANNER: { maxWidth: 320, ratio: "320 / 100" },
}

export function AdSlot({ placement, city, state, className }: AdSlotProps) {
  const [ad, setAd] = useState<ServedAd | null>(null)
  const [carregou, setCarregou] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const impressaoEnviada = useRef(false)

  // Busca o anúncio do slot
  useEffect(() => {
    const params = new URLSearchParams({ placement })
    if (city) params.set("city", city)
    if (state) params.set("state", state)

    let cancelado = false
    fetch(`/api/ads/serve?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : { ad: null }))
      .then((data: { ad: ServedAd | null }) => {
        if (!cancelado) {
          setAd(data.ad)
          setCarregou(true)
        }
      })
      .catch(() => {
        if (!cancelado) setCarregou(true)
      })

    return () => {
      cancelado = true
    }
  }, [placement, city, state])

  // Conta impressão quando o anúncio entra na viewport (1x)
  useEffect(() => {
    if (!ad || impressaoEnviada.current) return
    const el = containerRef.current
    if (!el) return

    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !impressaoEnviada.current) {
            impressaoEnviada.current = true
            navigator.sendBeacon?.(
              "/api/ads/impression",
              new Blob([JSON.stringify({ campaignId: ad.id })], { type: "application/json" }),
            )
            obs.disconnect()
          }
        }
      },
      { threshold: 0.5 },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [ad])

  // Sem anúncio: não renderiza nada (slot some, layout fica limpo).
  if (carregou && !ad) return null

  const box = ad ? FORMAT_BOX[ad.format] : FORMAT_BOX[placement === "BLOG_ARTICLE" ? "RECTANGLE" : "LEADERBOARD"]

  return (
    <div
      ref={containerRef}
      className={`mx-auto w-full ${className ?? ""}`}
      style={{ maxWidth: box.maxWidth }}
    >
      {/* Selo de transparência obrigatório */}
      <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground/60 text-right">
        Publicidade
      </p>

      <div
        className="relative overflow-hidden rounded-lg border border-border/60 bg-muted/30"
        style={{ aspectRatio: box.ratio }}
      >
        {ad && (
          <a
            href={`/api/ads/click/${ad.id}`}
            target="_blank"
            rel="sponsored noopener noreferrer"
            aria-label={`Anúncio de ${ad.advertiser}`}
            className="block h-full w-full"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={ad.imageUrl}
              alt={`Anúncio de ${ad.advertiser}`}
              className="h-full w-full object-contain"
              loading="lazy"
            />
          </a>
        )}
      </div>
    </div>
  )
}
