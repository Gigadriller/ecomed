-- AlterTable: segmentação hiperlocal por raio
ALTER TABLE "AdCampaign" ADD COLUMN "centerLat" DOUBLE PRECISION;
ALTER TABLE "AdCampaign" ADD COLUMN "centerLng" DOUBLE PRECISION;
ALTER TABLE "AdCampaign" ADD COLUMN "radiusKm" INTEGER;
