"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, Loader2, MapPin, X } from "lucide-react";

export type ResiduoTipo = "todos" | "medicamentos" | "perfurocortantes";

export interface SearchTarget {
  latitude: number;
  longitude: number;
  label: string;
}

interface CidadeSugestao {
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  pontos: number;
}

const FILTROS: Array<{ valor: ResiduoTipo; rotulo: string; icone: string }> = [
  { valor: "todos", rotulo: "Todos", icone: "📍" },
  { valor: "medicamentos", rotulo: "Medicamentos", icone: "💊" },
  { valor: "perfurocortantes", rotulo: "Agulhas e seringas", icone: "💉" },
];

interface MapSearchBarProps {
  tipo: ResiduoTipo;
  onTipoChange: (tipo: ResiduoTipo) => void;
  onTarget: (target: SearchTarget) => void;
}

export function MapSearchBar({ tipo, onTipoChange, onTarget }: MapSearchBarProps) {
  const [query, setQuery] = useState("");
  const [sugestoes, setSugestoes] = useState<CidadeSugestao[]>([]);
  const [aberto, setAberto] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const blurTimer = useRef<number | null>(null);

  const ehCep = /^\d{5}-?\d{0,3}$/.test(query.trim());
  const cepCompleto = /^\d{5}-?\d{3}$/.test(query.trim());

  // Autocomplete de cidades (debounced)
  useEffect(() => {
    setErro(null);
    if (ehCep || query.trim().length < 2) {
      setSugestoes([]);
      return;
    }
    const t = window.setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch(`/api/geo/cidades?q=${encodeURIComponent(query.trim())}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const data: CidadeSugestao[] = await res.json();
        setSugestoes(data);
        setAberto(true);
      } catch {
        // abortado
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [query, ehCep]);

  const buscarCep = useCallback(async () => {
    const cep = query.replace(/\D/g, "");
    if (cep.length !== 8) return;
    setBuscando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/geo/cep/${cep}`);
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error ?? "CEP não encontrado");
        return;
      }
      onTarget({
        latitude: data.latitude,
        longitude: data.longitude,
        label: `${data.city} - ${data.state}`,
      });
      setAberto(false);
      setSugestoes([]);
    } catch {
      setErro("Falha ao consultar o CEP");
    } finally {
      setBuscando(false);
    }
  }, [query, onTarget]);

  function selecionarCidade(cid: CidadeSugestao) {
    onTarget({
      latitude: cid.latitude,
      longitude: cid.longitude,
      label: `${cid.city} - ${cid.state}`,
    });
    setQuery(`${cid.city} - ${cid.state}`);
    setAberto(false);
    setSugestoes([]);
  }

  function limpar() {
    setQuery("");
    setSugestoes([]);
    setErro(null);
    setAberto(false);
  }

  return (
    <div className="absolute left-1/2 top-3 z-1000 w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2">
      {/* Campo de busca */}
      <div className="relative">
        <div className="flex items-center gap-2 rounded-full bg-background/95 px-4 py-2.5 shadow-lg ring-1 ring-border backdrop-blur">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            type="text"
            inputMode="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => sugestoes.length > 0 && setAberto(true)}
            onBlur={() => {
              blurTimer.current = window.setTimeout(() => setAberto(false), 150);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (cepCompleto) void buscarCep();
                else if (sugestoes.length > 0) selecionarCidade(sugestoes[0]);
              }
              if (e.key === "Escape") setAberto(false);
            }}
            placeholder="Buscar por cidade ou CEP…"
            aria-label="Buscar pontos de coleta por cidade ou CEP"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {buscando && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />}
          {query && !buscando && (
            <button
              onClick={limpar}
              aria-label="Limpar busca"
              className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
          {cepCompleto && !buscando && (
            <button
              onClick={() => void buscarCep()}
              className="shrink-0 rounded-full bg-eco-green px-3 py-1 text-xs font-semibold text-white"
            >
              Buscar
            </button>
          )}
        </div>

        {/* Dropdown de sugestões */}
        {aberto && sugestoes.length > 0 && (
          <ul
            role="listbox"
            className="absolute mt-2 w-full overflow-hidden rounded-2xl bg-background shadow-xl ring-1 ring-border"
          >
            {sugestoes.map((cid) => (
              <li key={`${cid.city}-${cid.state}`}>
                <button
                  role="option"
                  aria-selected="false"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selecionarCidade(cid)}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-muted"
                >
                  <MapPin className="size-4 shrink-0 text-eco-green" aria-hidden />
                  <span className="truncate">
                    {cid.city} <span className="text-muted-foreground">- {cid.state}</span>
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {cid.pontos} {cid.pontos === 1 ? "ponto" : "pontos"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {erro && (
          <p className="mt-2 rounded-full bg-background/95 px-4 py-1.5 text-center text-xs text-red-600 shadow ring-1 ring-border">
            {erro}
          </p>
        )}
      </div>

      {/* Chips de filtro por tipo de resíduo */}
      <div className="mt-2 flex justify-center gap-1.5" role="group" aria-label="Filtrar por tipo de resíduo">
        {FILTROS.map((f) => (
          <button
            key={f.valor}
            onClick={() => onTipoChange(f.valor)}
            aria-pressed={tipo === f.valor}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold shadow ring-1 backdrop-blur transition-colors ${
              tipo === f.valor
                ? "bg-eco-green text-white ring-eco-green"
                : "bg-background/95 text-foreground ring-border hover:bg-muted"
            }`}
          >
            <span aria-hidden>{f.icone}</span> {f.rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}
