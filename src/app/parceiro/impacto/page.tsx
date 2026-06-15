import type { Metadata } from "next"
import { requirePartner } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Droplets, Leaf, Users, Store } from "lucide-react"

export const metadata: Metadata = { title: "Relatório de Impacto ESG | EcoMed Parceiro" }
export const revalidate = 3600 // 1h

// ── Fórmulas de impacto (padrão EcoMed) ──────────────────────────────────────
const LITROS_POR_DESCARTE = 450_000   // ml de água protegida por descarte (Bila & Dezotti, 2003)
const CO2_POR_DESCARTE = 0.5          // kg de CO₂ evitado por descarte

function trimestre(offset = 0) {
  const now = new Date()
  const q = Math.floor(now.getMonth() / 3) + offset
  const year = now.getFullYear() + Math.floor(q / 4)
  const qNorm = ((q % 4) + 4) % 4
  return {
    inicio: new Date(year, qNorm * 3, 1),
    fim: new Date(year, qNorm * 3 + 3, 1),
    label: `T${qNorm + 1}/${year}`,
  }
}

export default async function ParceiroImpactoPage() {
  const session = await requirePartner()

  const partner = await prisma.partner.findUnique({
    where: { userId: session.user!.id! },
    include: { points: { where: { status: "APPROVED" }, select: { id: true } } },
  })

  if (!partner || partner.points.length === 0) {
    return (
      <div className="py-20 text-center space-y-2">
        <p className="text-lg font-semibold">Nenhum ponto aprovado</p>
        <p className="text-muted-foreground text-sm">
          O relatório de impacto ficará disponível após a aprovação do seu ponto.
        </p>
      </div>
    )
  }

  const pointIds = partner.points.map((p) => p.id)
  const t = trimestre(0)
  const tAnt = trimestre(-1)

  // Descartes por ponto no trimestre atual
  const [checkinsRaw, checkinsAntRaw, pessoasRaw] = await Promise.all([
    prisma.checkin.groupBy({
      by: ["pointId"],
      where: { pointId: { in: pointIds }, createdAt: { gte: t.inicio, lt: t.fim } },
      _count: { _all: true },
    }),
    prisma.checkin.groupBy({
      by: ["pointId"],
      where: { pointId: { in: pointIds }, createdAt: { gte: tAnt.inicio, lt: tAnt.fim } },
      _count: { _all: true },
    }),
    prisma.checkin.findMany({
      where: { pointId: { in: pointIds }, createdAt: { gte: t.inicio, lt: t.fim } },
      select: { userId: true, pointId: true },
    }),
  ])

  // Pontos com nome para exibição
  const points = await prisma.point.findMany({
    where: { id: { in: pointIds } },
    select: { id: true, name: true, city: true },
  })
  const pointMap = Object.fromEntries(points.map((p) => [p.id, p]))

  const totalAtual = checkinsRaw.reduce((s, r) => s + r._count._all, 0)
  const totalAnt = checkinsAntRaw.reduce((s, r) => s + r._count._all, 0)
  const variacao = totalAnt > 0 ? Math.round(((totalAtual - totalAnt) / totalAnt) * 100) : null
  const pessoasUnicas = new Set(pessoasRaw.map((r) => r.userId)).size

  const stats = [
    {
      label: "Descartes registrados",
      value: totalAtual.toLocaleString("pt-BR"),
      sub: variacao !== null
        ? `${variacao >= 0 ? "+" : ""}${variacao}% vs ${tAnt.label}`
        : `${t.label}`,
      icon: Store,
      color: "text-green-600",
    },
    {
      label: "Litros de água protegidos",
      value: (totalAtual * LITROS_POR_DESCARTE / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 0 }),
      sub: "litros — Bila & Dezotti, 2003",
      icon: Droplets,
      color: "text-blue-600",
    },
    {
      label: "CO₂ equivalente evitado",
      value: `${(totalAtual * CO2_POR_DESCARTE).toLocaleString("pt-BR", { minimumFractionDigits: 1 })} kg`,
      sub: "estimativa EcoMed",
      icon: Leaf,
      color: "text-emerald-600",
    },
    {
      label: "Pessoas alcançadas",
      value: pessoasUnicas.toLocaleString("pt-BR"),
      sub: "cidadãos únicos que descartaram",
      icon: Users,
      color: "text-purple-600",
    },
  ]

  // Ranking por ponto
  const rankingMap = Object.fromEntries(checkinsRaw.map((r) => [r.pointId, r._count._all]))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Relatório de Impacto ESG</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Período: <strong>{t.label}</strong> ({t.inicio.toLocaleDateString("pt-BR")} –{" "}
          {new Date(t.fim.getTime() - 1).toLocaleDateString("pt-BR")})
        </p>
      </div>

      {/* Métricas principais */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(({ label, value, sub, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="pt-5 pb-4">
              <div className={`mb-2 ${color}`}>
                <Icon className="size-7" />
              </div>
              <p className="text-2xl font-bold">{value}</p>
              <p className="text-xs font-medium text-foreground">{label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabela por ponto */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Descartes por unidade — {t.label}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-2.5 text-left font-medium">Unidade</th>
                  <th className="px-4 py-2.5 text-left font-medium">Cidade</th>
                  <th className="px-4 py-2.5 text-right font-medium">Descartes</th>
                  <th className="px-4 py-2.5 text-right font-medium">Litros protegidos</th>
                  <th className="px-4 py-2.5 text-right font-medium">CO₂ evitado</th>
                </tr>
              </thead>
              <tbody>
                {points
                  .sort((a, b) => (rankingMap[b.id] ?? 0) - (rankingMap[a.id] ?? 0))
                  .map((p) => {
                    const d = rankingMap[p.id] ?? 0
                    return (
                      <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium">{pointMap[p.id]?.name ?? p.id}</td>
                        <td className="px-4 py-3 text-muted-foreground">{p.city}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{d.toLocaleString("pt-BR")}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {(d * LITROS_POR_DESCARTE / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} L
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {(d * CO2_POR_DESCARTE).toLocaleString("pt-BR", { minimumFractionDigits: 1 })} kg
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        * Métricas calculadas conforme padrão EcoMed. Referência hídrica: Bila & Dezotti (2003).
        CO₂: estimativa conservadora por descarte correto vs. incineração informal.
      </p>
    </div>
  )
}
