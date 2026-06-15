import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { auth } from "@/../auth"
import { prisma } from "@/lib/db/prisma"
import { Header } from "@/components/layout/Header"
import { CheckinClient } from "./CheckinClient"

export const metadata: Metadata = {
  title: "Registrar Descarte | EcoMed",
  robots: { index: false },
}

interface Props {
  searchParams: Promise<{ p?: string }>
}

export default async function CheckinPage({ searchParams }: Props) {
  const { p: pointId } = await searchParams

  if (!pointId) {
    return (
      <div className="flex min-h-screen flex-col">
        <Header />
        <main className="flex flex-1 items-center justify-center p-6 text-center">
          <div>
            <p className="text-2xl font-bold">QR Code inválido</p>
            <p className="mt-2 text-muted-foreground">
              Escaneie o QR Code no balcão da farmácia para registrar seu descarte.
            </p>
          </div>
        </main>
      </div>
    )
  }

  // Retém pointId no next= para recuperar após login/cadastro
  const session = await auth()
  if (!session?.user?.id) {
    redirect(`/login?next=/checkin?p=${encodeURIComponent(pointId)}`)
  }

  const point = await prisma.point.findFirst({
    where: { id: pointId, status: "APPROVED" },
    select: {
      id: true,
      name: true,
      address: true,
      city: true,
      state: true,
      latitude: true,
      longitude: true,
      residueTypes: true,
    },
  })

  if (!point) {
    return (
      <div className="flex min-h-screen flex-col">
        <Header />
        <main className="flex flex-1 items-center justify-center p-6 text-center">
          <div>
            <p className="text-2xl font-bold">Ponto não encontrado</p>
            <p className="mt-2 text-muted-foreground">
              Este ponto de coleta não existe ou está inativo.
            </p>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex flex-1 items-center justify-center p-4">
        <CheckinClient point={point} />
      </main>
    </div>
  )
}
