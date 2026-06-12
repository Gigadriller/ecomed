# -*- coding: utf-8 -*-
"""
geocode_cep_logmed.py — refina as coordenadas dos pontos LogMed via Nominatim/OSM.

Contexto: a importação original geocodificou os 7.940 pontos LogMed pelo
CENTROIDE do município (todos os pontos da mesma cidade ficaram empilhados
na mesma coordenada). Este script geocodifica o ENDEREÇO REAL de cada ponto.

Fonte: Nominatim (OpenStreetMap) — gratuito, sem chave.
  1. Consulta estruturada (street + city + state + country)
  2. Fallback: consulta livre "endereço, cidade, UF, Brasil"
(BrasilAPI/AwesomeAPI foram descartadas: a primeira raramente tem coordenadas,
 a segunda tem quota por IP muito baixa.)

Características:
  - RESUMÍVEL: progresso salvo em scripts/.geocode_progress.json a cada lote.
    Pode interromper (Ctrl+C) e rodar de novo — continua de onde parou.
  - SEGURO: por padrão roda em dry-run (não escreve no banco). Use --apply.
  - EDUCADO: 1.1 s entre requisições (política de uso do Nominatim) com
    User-Agent identificado.
  - Sanidade: rejeita coordenadas a mais de 80 km do centroide atual do ponto
    (endereço errado no cadastro não pode jogar a farmácia em outro estado).

Uso:
  # Teste sem escrever
  DATABASE_URL="postgresql://..." python geocode_cep_logmed.py --limit 15

  # Valendo (rodar em container/nohup — duração total: 3 a 5 horas)
  DATABASE_URL="postgresql://..." python geocode_cep_logmed.py --apply
"""
import argparse
import json
import math
import os
import sys
import time
from pathlib import Path

import psycopg2
import requests

PROGRESS_FILE = Path(__file__).parent / ".geocode_progress.json"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "EcoMed-Geocoder/1.0 (contato@ecomed.eco.br; refino de pontos de coleta)"
RATE_DELAY_S = 1.1          # política Nominatim: máximo 1 req/s
MAX_DIST_KM = 80            # rejeita coordenada muito longe do centroide atual
BATCH_COMMIT = 25           # commit + save progress a cada N pontos


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _nominatim(params: dict):
    try:
        r = requests.get(
            NOMINATIM_URL,
            params={**params, "format": "json", "limit": 1, "countrycodes": "br"},
            headers={"User-Agent": USER_AGENT},
            timeout=10,
        )
        if r.status_code != 200:
            return None
        results = r.json()
        if results:
            return float(results[0]["lat"]), float(results[0]["lon"])
    except Exception:
        pass
    return None


def geocode(address: str, city: str, state: str):
    """Consulta estruturada; se falhar, consulta livre. Respeita o rate limit."""
    coords = _nominatim({"street": address, "city": city, "state": state, "country": "Brasil"})
    if coords:
        return coords[0], coords[1], "nominatim-structured"

    time.sleep(RATE_DELAY_S)
    coords = _nominatim({"q": f"{address}, {city}, {state}, Brasil"})
    if coords:
        return coords[0], coords[1], "nominatim-freeform"
    return None


def load_progress() -> dict:
    if PROGRESS_FILE.exists():
        return json.loads(PROGRESS_FILE.read_text(encoding="utf-8"))
    return {"done": {}, "failed": {}}


def save_progress(progress: dict):
    PROGRESS_FILE.write_text(json.dumps(progress), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="escreve no banco (sem isso é dry-run)")
    parser.add_argument("--limit", type=int, default=0, help="processar no máximo N pontos (0 = todos)")
    parser.add_argument("--retry-failed", action="store_true", help="reprocessa pontos que falharam antes")
    args = parser.parse_args()

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("ERRO: defina DATABASE_URL no ambiente.")
        sys.exit(1)

    progress = load_progress()
    done, failed = progress["done"], progress["failed"]
    if args.retry_failed:
        failed.clear()

    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, address, city, state, latitude, longitude
        FROM "Point"
        WHERE id LIKE 'logmed-%' AND status = 'APPROVED'
        ORDER BY id
        """
    )
    pontos = cur.fetchall()
    pendentes = [p for p in pontos if p[0] not in done and p[0] not in failed]
    if args.limit:
        pendentes = pendentes[: args.limit]

    print(f"Pontos LogMed: {len(pontos)} | já geocodificados: {len(done)} | "
          f"falhas anteriores: {len(failed)} | nesta execução: {len(pendentes)}", flush=True)
    if not args.apply:
        print("⚠ DRY-RUN — nada será escrito. Use --apply para gravar.\n", flush=True)

    atualizados = rejeitados = sem_coord = 0
    try:
        for i, (pid, address, city, state, lat_atual, lng_atual) in enumerate(pendentes, 1):
            resultado = geocode(address or "", city, state)
            time.sleep(RATE_DELAY_S)

            if not resultado:
                failed[pid] = "sem_coordenada"
                sem_coord += 1
                continue

            lat_novo, lng_novo, fonte = resultado
            dist = haversine_km(lat_atual, lng_atual, lat_novo, lng_novo)
            if dist > MAX_DIST_KM:
                failed[pid] = f"distante_{int(dist)}km"
                rejeitados += 1
                continue

            if args.apply:
                cur.execute(
                    'UPDATE "Point" SET latitude = %s, longitude = %s, "updatedAt" = NOW() WHERE id = %s',
                    (lat_novo, lng_novo, pid),
                )
            done[pid] = fonte
            atualizados += 1

            if i % BATCH_COMMIT == 0:
                if args.apply:
                    conn.commit()
                save_progress(progress)
                print(f"  [{i}/{len(pendentes)}] {pid} ({city}-{state}) "
                      f"Δ{dist:.1f}km via {fonte} | ok={atualizados} falha={sem_coord} rej={rejeitados}",
                      flush=True)
    except KeyboardInterrupt:
        print("\nInterrompido — progresso salvo, rode novamente para continuar.", flush=True)
    finally:
        if args.apply:
            conn.commit()
        save_progress(progress)
        cur.close()
        conn.close()

    print(f"\n{'APLICADO' if args.apply else 'DRY-RUN'}: "
          f"{atualizados} atualizados | {sem_coord} sem coordenada | {rejeitados} rejeitados (> {MAX_DIST_KM} km)",
          flush=True)
    print(f"Progresso em {PROGRESS_FILE.name} — rode de novo para reprocessar só os pendentes.", flush=True)


if __name__ == "__main__":
    main()
