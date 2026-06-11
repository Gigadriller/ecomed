# EcoMed — Últimos Passos

Registro dos avanços mais recentes no projeto.

---

# Junho 2026 — Produção endurecida + 9 melhorias de produto

## 1. Correções críticas e segurança

| Item | O que mudou |
|---|---|
| **Login Google corrigido** | Criação de wallet movida do callback `signIn` (onde o User ainda não existe no banco → FK violation → AccessDenied) para o callback `jwt` |
| **Segredos fora das camadas Docker** | `DATABASE_URL`, `AUTH_SECRET` e `GOOGLE_CLIENT_SECRET` agora via BuildKit secrets (`--mount=type=secret`); `docker history` não os expõe mais |
| **Migrations no deploy manual** | `scripts/deploy.sh` agora roda `prisma migrate deploy` (espelha o GitHub Actions — elimina schema drift) |
| **Backup diário do banco** | `ops/maintenance/backup-db.sh`: pg_dump 02:30 UTC, formato custom comprimido, retenção 14 dias, validação de tamanho |
| **Repo limpo** | Pasta `app/` duplicada (cópia desatualizada com node_modules e tarballs) removida; `.gitattributes` força LF em scripts |

## 2. EcoBot

- **Base de conhecimento consolidada**: `ia/knowledge_base.md` (140 Q&As nunca indexados — o ingest só lê `.txt`) mesclado em `ia/docs/treinamento_ecobot.txt` → **310 blocos Q&A**
- **Nova seção "Sobre a Plataforma"**: EcoBot responde sobre EcoCoins, missões, ranking, conquistas, indicação, mapa, quiz, perfil e privacidade
- **43 testes pytest** nos guardrails (emergência → SAMU, prompt injection, automedicação, dados pessoais, falsos positivos, filtro de saída)

## 3. Mapa

- **Busca por cidade ou CEP** (`/api/geo/cidades` + `/api/geo/cep/:cep` via ViaCEP server-side) — usuários que negam geolocalização não ficam mais bloqueados
- **Filtro por tipo de resíduo**: chips Todos / Medicamentos / Agulhas e seringas (`?tipo=` com aliases para variações históricas de `residueTypes`)
- **Selo de validação comunitária** na página do ponto: "descarte confirmado há X dias" (check-ins ≤ 30d) + alerta de reportes em aberto

## 4. Páginas públicas novas

| Rota | Conteúdo |
|---|---|
| `/impacto` | Contadores reais (descartes, litros, usuários) + cobertura nacional (municípios com/sem ponto) |
| `/desenvolvedores` | Documentação da API pública v1 + widget iframe |
| `/descarte/[cidade]-[uf]` | SEO programático por município: pontos, FAQ, JSON-LD (FAQPage + ItemList), ISR diário; no sitemap p/ cidades com 2+ pontos |
| `/embed/mapa` | Widget iframe para terceiros (frame-ancestors liberado só em `/embed/*`, atribuição fixa) |

## 5. API pública v1 (`/api/public/v1`)

- Auth por header `X-API-Key` (chaves em `PUBLIC_API_KEYS` env JSON), CORS por origin registrado, rate limit 60 req/min com headers `X-RateLimit-*`
- Primeira integração: **ReMed (PUC Minas)** — projeto acadêmico de doação de medicamentos
- Gatilho de migração para tabela `PublicApiKey`: 3º parceiro

## 6. Dados e manutenção

- **`PointViewDaily`**: agregado diário de visualizações; cron 03:45 UTC agrega e expurga brutos > 90 dias (tabela `PointView` crescia sem limite)
- **`scripts/geocode_cep_logmed.py`**: corrige as coordenadas dos 7.940 pontos LogMed (hoje todos usam o centroide do município — pins empilhados). Resumível, dry-run por padrão, valida distância máxima de 80 km. **Rodar manualmente**: `DATABASE_URL=... python scripts/geocode_cep_logmed.py --apply` (~80 min)
- **Acessibilidade**: VLibras (tradutor de Libras do governo) em todas as páginas

## 7. Testes e qualidade

- 71 testes vitest (40 quiz existentes + 31 novos de níveis/multiplicadores/streaks/anti-fraude)
- Regras puras de gamificação extraídas para `src/lib/coins/levels.ts` (testáveis sem banco)
- Lint: 3 erros → 0 (`.claude/**` ignorado, VLibras sem namespace global)

---

# Maio 2026 — Importação de dados e otimização do mapa

---

## 1. Importação das UBS do DATASUS (~50.864 pontos)

**O que foi feito:**
Criamos o script `scripts/seed-ubs.ts` para importar automaticamente todas as Unidades Básicas de Saúde do Brasil diretamente da API pública do **CNES** (Cadastro Nacional de Estabelecimentos de Saúde — Ministério da Saúde).

**Como funciona:**

- A API do CNES disponibiliza os dados em pages de 20 registros. O script pagina tudo automaticamente.
- Filtramos 4 tipos de unidade: **Posto de Saúde (01)**, **Centro de Saúde/UBS (02)**, **UPA (20)** e **ESF/PSF (32)**.
- Cada registro passa por validação: descartamos unidades desabilitadas e registros sem coordenadas geográficas válidas.
- Os nomes dos municípios são obtidos cruzando o código IBGE da UBS com a API de municípios do IBGE.
- Um parceiro-sistema chamado **"DATASUS — Ministério da Saúde"** (CNPJ público: 00394544000185) é criado automaticamente para ser o "dono" desses pontos no banco.

**Resultado:**
~50.864 UBS inseridas no banco com status `APPROVED`, cobrindo todos os estados do Brasil.

---

## 2. Importação das farmácias do LogMed (7.940 pontos)

O LogMed é o programa de logística reversa de medicamentos do setor farmacêutico, regulamentado pela ANVISA (RDC 222/2018). Eles mantêm uma lista pública de farmácias que aceitam medicamentos para descarte.

A importação foi dividida em **3 etapas**:

### Etapa 1 — Scraping (`scripts/scrape_logmed.py`)

O site do LogMed disponibiliza todos os pontos em uma única página HTML de ~13 MB (`/onde-descartar/pdf`). Criamos um script Python com `BeautifulSoup` para ler essa tabela linha por linha e extrair:

- UF, cidade, nome da farmácia, CNPJ, endereço, CEP e rede associada

O campo "rede" vinha com muitas variações e nomes de pessoas (responsáveis técnicos), então criamos a função `normalizar_rede()` para consolidar tudo em **8 grupos**:

| Rede                     | Tipo                               |
| ------------------------ | ---------------------------------- |
| ABRAFARMA                | Associação nacional de redes       |
| FEBRAFAR                 | Federação de redes associativistas |
| ABC, ABCFARMA, REDEFARMA | Redes regionais                    |
| SINCOFARMA               | Sindicatos regionais               |
| ABCDEFARMA               | Rede regional menor                |
| **INDEPENDENTE**         | Farmácias sem rede identificada    |

Saída: `prisma/logmed_pontos.json` com 7.940 registros (sem coordenadas ainda).

### Etapa 2 — Geocodificação (`scripts/geocode_logmed.py`)

O JSON da etapa anterior só tinha cidade e UF — sem latitude/longitude. Precisávamos geocodificar os 7.940 pontos.

**Problema:** usar a API do OpenStreetMap (Nominatim) levaria ~15 minutos (máximo 1 requisição por segundo pela política de uso).

**Solução:** baixamos o dataset público [kelvins/municipios-brasileiros](https://github.com/kelvins/municipios-brasileiros) — um CSV com as coordenadas do centroide de todos os 5.571 municípios brasileiros. A geocodificação ficou **instantânea**, sem nenhuma chamada de API.

7 cidades precisaram de tratamento manual por variações de grafia:

- `DIAS D'AVILA` → apóstrofo diferente do dataset
- `MOJI MIRIM` → grafia antiga de Mogi Mirim
- `PARATI` → nome antigo de Paraty
- Duas cidades com UF errada no cadastro do LogMed (Taubaté e Bernardino de Campos marcadas como MG em vez de SP)

**Resultado:** 100% dos 7.940 pontos geocodificados.

### Etapa 3 — Importação para o banco (`scripts/import_logmed.py`)

Com o JSON completo (dados + coordenadas), importamos tudo para o PostgreSQL usando **bulk insert** via `psycopg2.extras.execute_values` em lotes de 500 registros.

Cada ponto recebe um **ID determinístico** no formato `logmed-000000` até `logmed-007939`. Isso permite re-executar o script com segurança — o `ON CONFLICT (id) DO NOTHING` garante que não há duplicatas.

Antes de inserir, o script remove qualquer ponto parcial de execuções anteriores (importante porque na primeira tentativa a importação travou no meio).

**Resultado:** 8 parceiros criados (um por rede) + 7.940 pontos inseridos em ~3 segundos.

---

## 3. Banco de dados — estado atual

```
Pontos com status APPROVED
─────────────────────────────────────────────
 DATASUS (UBS)         ~50.864 pontos
 LogMed (farmácias)      7.940 pontos
 Seeds manuais             ~15 pontos
─────────────────────────────────────────────
 TOTAL                 ~58.819 pontos
```

12 parceiros registrados no total.

---

## 4. Problema: mapa travando com 58 mil pontos

Depois da importação, o endpoint `/api/pontos/mapa` retornava **todos** os pontos aprovados para o Leaflet renderizar. Com 58 mil registros (~10 MB de JSON), o mapa travava completamente no navegador.

**Solução:** usamos a cláusula PostgreSQL `DISTINCT ON (city, state)` para retornar apenas **um ponto representativo por cidade** — resultado: ~780 pontos para o overview do mapa, o suficiente para mostrar a cobertura nacional sem sobrecarregar.

```sql
SELECT DISTINCT ON (city, state)
  id, name, address, city, state, latitude, longitude, ...
FROM "Point"
WHERE status = 'APPROVED'
ORDER BY city, state, "createdAt" DESC
```

O endpoint `/api/pontos/proximos` continua retornando os pontos detalhados quando o usuário usa a geolocalização — aí sim buscamos todos os pontos dentro de um bounding box geográfico, limitado a 30 resultados.

---

## 5. Arquivos criados/modificados

| Arquivo                     | O que é                                     |
| --------------------------- | ------------------------------------------- |
| `scripts/seed-ubs.ts`       | Importação das UBS via API CNES/DATASUS     |
| `scripts/scrape_logmed.py`  | Scraping da tabela HTML do LogMed           |
| `scripts/geocode_logmed.py` | Geocodificação instantânea via CSV do IBGE  |
| `scripts/import_logmed.py`  | Bulk insert no PostgreSQL                   |
| `prisma/municipios_br.csv`  | Dataset IBGE: 5.571 municípios com lat/lng  |
| `prisma/seed-logmed.ts`     | Cria o usuário sistema `seed@ecomed.eco.br` |
| `src/app/api/.../pontos.ts` | Fix do endpoint /mapa com DISTINCT ON       |

> Para mais detalhes técnicos (parâmetros, exemplos de código, fluxo completo), veja [docs/importacao-pontos.md](./importacao-pontos.md).
