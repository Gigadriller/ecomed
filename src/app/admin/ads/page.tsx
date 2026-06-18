import { requireAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { AdsManager } from "./AdsManager";

export const metadata = { title: "Publicidade | Admin EcoMed" };

export default async function AdminAdsPage() {
  await requireAdmin();

  const campanhas = await prisma.adCampaign.findMany({
    orderBy: { createdAt: "desc" },
    include: { events: { select: { impressions: true, clicks: true } } },
  });

  const data = campanhas.map((ca) => {
    const impressions = ca.events.reduce((s, e) => s + e.impressions, 0);
    const clicks = ca.events.reduce((s, e) => s + e.clicks, 0);
    return {
      id: ca.id,
      advertiser: ca.advertiser,
      title: ca.title,
      imageUrl: ca.imageUrl,
      targetUrl: ca.targetUrl,
      placement: ca.placement,
      format: ca.format,
      targetState: ca.targetState,
      targetCity: ca.targetCity,
      centerLat: ca.centerLat,
      centerLng: ca.centerLng,
      radiusKm: ca.radiusKm,
      active: ca.active,
      endsAt: ca.endsAt ? ca.endsAt.toISOString() : null,
      weight: ca.weight,
      impressions,
      clicks,
    };
  });

  return <AdsManager initial={data} />;
}
