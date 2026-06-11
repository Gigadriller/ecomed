/**
 * Rotas de geolocalização para a busca do mapa.
 *
 * GET /api/geo/cidades?q=  → autocomplete de cidades com pontos de coleta
 * GET /api/geo/cep/:cep    → resolve CEP via ViaCEP (server-side, sem CSP extra)
 *
 * As coordenadas de cidade vêm da média dos pontos APPROVED daquela cidade —
 * cobre todos os ~5.5k municípios com UBS/farmácia sem dataset externo.
 */
import { Hono } from "hono";
import { checkRateLimit } from "@/lib/ratelimit";
import { getCidades, normalizar } from "@/lib/geo/cidades";

const app = new Hono();

// GET /api/geo/cidades?q=sao+paulo
app.get("/cidades", async (c) => {
  const ip = c.req.header("CF-Connecting-IP") ?? c.req.header("x-forwarded-for") ?? "unknown";
  try {
    const { success } = await checkRateLimit("map", ip);
    if (!success) return c.json({ error: "Muitas requisições" }, 429);
  } catch {
    // rate limit indisponível — seguir
  }

  const q = normalizar(c.req.query("q") ?? "");
  if (q.length < 2) return c.json([]);

  try {
    const cidades = await getCidades();
    const resultados = cidades
      .map((cid) => {
        const nome = normalizar(cid.city);
        // startsWith pontua mais alto que includes
        const score = nome.startsWith(q) ? 2 : nome.includes(q) ? 1 : 0;
        return { ...cid, score };
      })
      .filter((cid) => cid.score > 0)
      .sort((a, b) => b.score - a.score || b.pontos - a.pontos)
      .slice(0, 8)
      .map(({ score: _score, ...cid }) => cid);

    return c.json(resultados);
  } catch (err) {
    console.error("[geo/cidades] erro:", err);
    return c.json([], 200);
  }
});

// GET /api/geo/cep/01310100
app.get("/cep/:cep", async (c) => {
  const ip = c.req.header("CF-Connecting-IP") ?? c.req.header("x-forwarded-for") ?? "unknown";
  try {
    const { success } = await checkRateLimit("map", ip);
    if (!success) return c.json({ error: "Muitas requisições" }, 429);
  } catch {
    // rate limit indisponível — seguir
  }

  const cep = (c.req.param("cep") ?? "").replace(/\D/g, "");
  if (cep.length !== 8) return c.json({ error: "CEP inválido" }, 400);

  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return c.json({ error: "Falha ao consultar CEP" }, 502);
    const data = (await res.json()) as {
      erro?: boolean;
      localidade?: string;
      uf?: string;
      logradouro?: string;
      bairro?: string;
    };
    if (data.erro || !data.localidade || !data.uf) {
      return c.json({ error: "CEP não encontrado" }, 404);
    }

    // Resolver coordenadas pela cidade do CEP
    const cidades = await getCidades();
    const alvo = normalizar(data.localidade);
    const cidade = cidades.find(
      (cid) => normalizar(cid.city) === alvo && cid.state === data.uf,
    );
    if (!cidade) {
      return c.json(
        { error: "Cidade do CEP ainda não tem pontos de coleta cadastrados" },
        404,
      );
    }

    return c.json({
      cep,
      city: data.localidade,
      state: data.uf,
      logradouro: data.logradouro || null,
      bairro: data.bairro || null,
      latitude: cidade.latitude,
      longitude: cidade.longitude,
    });
  } catch (err) {
    console.error("[geo/cep] erro:", err);
    return c.json({ error: "Falha ao consultar CEP" }, 502);
  }
});

export const geoRouter = app;
