import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"

export const maxDuration = 60

// GET /api/cron/aggregate-views — chamado pelo cron às 03:45 UTC
//
// 1. Agrega visualizações brutas (PointView) por ponto/dia em PointViewDaily.
//    Recalcula o dia inteiro (ON CONFLICT DO UPDATE SET count = EXCLUDED.count),
//    o que é idempotente enquanto os brutos do dia ainda existem.
// 2. Expurga brutos com mais de 90 dias — seus agregados já foram gravados
//    em execuções anteriores e não são tocados.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const agregados = await prisma.$executeRaw`
      INSERT INTO "PointViewDaily" (id, "pointId", date, count)
      SELECT
        'pvd_' || md5("pointId" || date_trunc('day', "viewedAt")::text),
        "pointId",
        date_trunc('day', "viewedAt"),
        COUNT(*)::int
      FROM "PointView"
      WHERE "viewedAt" < date_trunc('day', now())
      GROUP BY "pointId", date_trunc('day', "viewedAt")
      ON CONFLICT ("pointId", date)
      DO UPDATE SET count = EXCLUDED.count
    `

    const expurgados = await prisma.$executeRaw`
      DELETE FROM "PointView"
      WHERE "viewedAt" < now() - interval '90 days'
    `

    return Response.json({
      ok: true,
      diasAgregados: agregados,
      brutosExpurgados: expurgados,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error("[cron:aggregate-views] erro:", err)
    return Response.json({ error: "Falha na agregação" }, { status: 500 })
  }
}
