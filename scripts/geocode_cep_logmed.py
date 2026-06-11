# -*- coding: utf-8 -*-
"""
geocode_cep_logmed.py — refina as coordenadas dos pontos LogMed usando o CEP.

Contexto: a importação original geocodificou os 7.940 pontos LogMed pelo
CENTROIDE do município (todos os pontos da mesma cidade ficaram empilhados
na mesma coordenada). Este script consulta APIs públicas de CEP para obter
a posição real de cada endereço.

Fontes (em ordem de tentativa):
  1. BrasilAPI  https://brasilapi.com.br/api/cep/v2/{cep}   (coordenadas OSM)
  2. AwesomeAPI https://cep.awesomeapi.com.br/json/{cep}     (lat/lng diretos)

Características:
  - RESUMÍVEL: progresso salvo em scripts/.geocode_progress.json a cada lote.
    Pode interromper (Ctrl+C) e rodar de novo — continua de onde parou.
  - SEGURO: por padrão roda em dry-run (não escreve no banco). Use --apply.
  - EDUCADO: ~2 req/s para não abusar das APIs públicas.
  - Sanidade: rejeita coordenadas a mais de 80 km do centroide atual do ponto
    (CEP errado no cadastro não pode jogar a farmácia em outro estado).

Uso:
  # Teste sem escrever (mostra amostra do que faria)
  DATABASE_URL="postgresql://..." python scripts/geocode_cep_logmed.py

  # Valendo
  DATABASE_URL="postgresql://..." python scripts/geocode_cep_logmed.py --apply

Duração estimada: ~70–90 min para 7.940 pontos (2 req/s, 1 CEP por ponto).
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
RATE_DELAY_S = 0.5          # ~2 req/s
MAX_DIST_KM = 80            # rejeita coordenada muito longe do centroide atual
BATCH_COMMIT = 50           # commit + save progress a cada N pontos


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def geocode_brasilapi(cep: str):
    try:
        r = requests.get(f"https://brasilapi.com.br/api/cep/v2/{cep}", timeout=8)
        if r.status_code != 200:
            return None
        data = r.json()
        loc = (data.get("location") or {}).get("coordinates") or {}
        lat, lng = loc.get("latitude"), loc.get("longitude")
        if lat and lng:
            return float(lat), float(lng), "brasilapi"
    except Exception:
        pass
    return None


def geocode_awesomeapi(cep: str):
    try:
        r = requests.get(f"https://cep.awesomeapi.com.br/json/{cep}", timeout=8)
        if r.status_code != 200:
            return None
        data = r.json()
        lat, lng = data.get("lat"), data.get("lng")
        if lat and lng:
            return float(lat), float(lng), "awesomeapi"
    except Exception:
        pass
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
    args = parser.parse_args()

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("ERRO: defina DATABASE_URL no ambiente.")
        sys.exit(1)

    progress = load_progress()
    done, failed = progress["done"], progress["failed"]

    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, "zipCode", latitude, longitude, city, state
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
          f"falhas anteriores: {len(failed)} | nesta execução: {len(pendentes)}")
    if not args.apply:
        print("⚠ DRY-RUN — nada será escrito. Use --apply para gravar.\n")

    atualizados = rejeitados = sem_coord = 0
    try:
        for i, (pid, cep, lat_atual, lng_atual, city, state) in enumerate(pendentes, 1):
            cep_limpo = (cep or "").replace("-", "").strip()
            if len(cep_limpo) != 8:
                failed[pid] = "cep_invalido"
                continue

            resultado = geocode_brasilapi(cep_limpo) or geocode_awesomeapi(cep_limpo)
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
                      f"Δ{dist:.1f}km via {fonte} | ok={atualizados} falha={sem_coord} rej={rejeitados}")
    except KeyboardInterrupt:
        print("\nInterrompido — progresso salvo, rode novamente para continuar.")
    finally:
        if args.apply:
            conn.commit()
        save_progress(progress)
        cur.close()
        conn.close()

    print(f"\n{'APLICADO' if args.apply else 'DRY-RUN'}: "
          f"{atualizados} atualizados | {sem_coord} sem coordenada | {rejeitados} rejeitados (> {MAX_DIST_KM} km)")
    print(f"Progresso em {PROGRESS_FILE.name} — rode de novo para reprocessar só os pendentes.")


if __name__ == "__main__":
    main()
