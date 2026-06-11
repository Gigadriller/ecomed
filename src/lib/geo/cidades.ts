// Lib compartilhada de cidades com pontos de coleta.
// Usada pelo router /api/geo, pelas páginas SEO /descarte/[slug] e pelo sitemap.
import { prisma } from "@/lib/db/prisma";

export type Cidade = {
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  pontos: number;
};

// Cache em memória do processo (a lista de cidades muda raramente)
let _cidades: Cidade[] | null = null;
let _loadedAt = 0;
const TTL_MS = 6 * 60 * 60 * 1000;

export function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Slug de URL: "São Paulo"/"SP" → "sao-paulo-sp" */
export function cidadeSlug(city: string, state: string): string {
  const base = normalizar(city)
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  return `${base}-${state.toLowerCase()}`;
}

export async function getCidades(): Promise<Cidade[]> {
  const agora = Date.now();
  if (_cidades && agora - _loadedAt < TTL_MS) return _cidades;

  const rows = await prisma.$queryRaw<Cidade[]>`
    SELECT city, state,
           AVG(latitude)::float  AS latitude,
           AVG(longitude)::float AS longitude,
           COUNT(*)::int         AS pontos
    FROM "Point"
    WHERE status = 'APPROVED'
    GROUP BY city, state
  `;
  _cidades = rows;
  _loadedAt = agora;
  return rows;
}

/** Resolve um slug de /descarte/[slug] de volta para a cidade. */
export async function cidadePorSlug(slug: string): Promise<Cidade | null> {
  const cidades = await getCidades();
  return cidades.find((c) => cidadeSlug(c.city, c.state) === slug) ?? null;
}
