-- Agregado diário de visualizações de pontos + índice para o expurgo dos brutos

-- CreateTable
CREATE TABLE "PointViewDaily" (
    "id" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PointViewDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PointViewDaily_pointId_date_key" ON "PointViewDaily"("pointId", "date");

-- CreateIndex (acelera a janela de expurgo do cron aggregate-views)
CREATE INDEX "PointView_viewedAt_idx" ON "PointView"("viewedAt");

-- AddForeignKey
ALTER TABLE "PointViewDaily" ADD CONSTRAINT "PointViewDaily_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "Point"("id") ON DELETE CASCADE ON UPDATE CASCADE;
