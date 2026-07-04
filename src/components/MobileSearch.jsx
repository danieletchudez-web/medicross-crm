import { useEffect, useRef, useState } from "react";
import {
  Search, X, Clock, ChevronRight, Sparkles,
  Users, Target, Package, CheckSquare, MapPin, Briefcase, Megaphone, FileText,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";

// ─── Search table definitions ─────────────────────────────────────────────────

const SEARCH_TABLES = [
  {
    key: "accounts", label: "Clientes", Icon: Users, page: "accounts",
    select: "id,name,city,province",
    ilike: ["name", "city", "province"],
    title: r => r.name,
    sub: r => [r.city, r.province].filter(Boolean).join(", "),
  },
  {
    key: "opportunities", label: "Oportunidades", Icon: Target, page: "opportunities",
    select: "id,name,stage",
    ilike: ["name"],
    title: r => r.name,
    sub: r => r.stage,
  },
  {
    key: "products", label: "Productos", Icon: Package, page: "products",
    select: "id,name,line",
    ilike: ["name", "line"],
    title: r => r.name,
    sub: r => r.line,
  },
  {
    key: "tasks", label: "Tareas", Icon: CheckSquare, page: "tasks",
    select: "id,title,status",
    ilike: ["title"],
    title: r => r.title,
    sub: r => r.status,
  },
  {
    key: "visits", label: "Visitas", Icon: MapPin, page: "visits",
    select: "id,contact,visit_date,objective",
    ilike: ["contact", "objective"],
    title: r => r.contact || r.objective || "Visita",
    sub: r => r.visit_date,
  },
  {
    key: "tenders", label: "Licitaciones", Icon: Briefcase, page: "tenders",
    select: "id,institution,process_name,status",
    ilike: ["institution", "process_name"],
    title: r => r.institution || r.process_name || "Licitación",
    sub: r => r.status,
  },
  {
    key: "cotizaciones", label: "Cotizaciones", Icon: FileText, page: "cotizador",
    select: "id,quote_num_formatted,institucion",
    ilike: ["quote_num_formatted", "institucion"],
    title: r => r.quote_num_formatted || r.institucion || "Cotización",
    sub: r => r.institucion,
  },
  {
    key: "campaigns", label: "Campañas", Icon: Megaphone, page: "campaigns",
    select: "id,name,status",
    ilike: ["name"],
    title: r => r.name,
    sub: r => r.status,
  },
];

const QUICK_ACTIONS = [
  { label: "Clientes",       page: "accounts",      Icon: Users      },
  { label: "Oportunidades",  page: "opportunities", Icon: Target     },
  { label: "Visitas",        page: "visits",        Icon: MapPin     },
  { label: "Tareas",         page: "tasks",         Icon: CheckSquare},
  { label: "Licitaciones",   page: "tenders",       Icon: Briefcase  },
  { label: "Cotizaciones",   page: "cotizador",     Icon: FileText   },
];

function isQuestion(q) {
  return /^[¿?]|^cómo\b|^qué\b|^cuál\b|^cuándo\b|^dónde\b|^cuánto/i.test(q.trim());
}

function loadRecents() {
  try { return JSON.parse(localStorage.getItem("mob_recientes") || "[]").slice(0, 5); }
  catch { return []; }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MobileSearch({ open, onClose, onNavigate }) {
  const [query,   setQuery]   = useState("");
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState(false);
  const [recents, setRecents] = useState([]);

  const inputRef = useRef(null);
  const timerRef = useRef(null);
  const seqRef   = useRef(0);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults({});
    setLoading(false);
    setRecents(loadRecents());
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    clearTimeout(timerRef.current);
    const q = query.trim();
    if (q.length < 2) { setResults({}); setLoading(false); return; }
    setLoading(true);
    const seq = ++seqRef.current;
    timerRef.current = setTimeout(() => runSearch(q, seq), 280);
    return () => clearTimeout(timerRef.current);
  }, [query]);

  async function runSearch(q, seq) {
    const all = await Promise.all(
      SEARCH_TABLES.map(async t => {
        try {
          const orClause = t.ilike.map(f => `${f}.ilike.%${q}%`).join(",");
          const { data } = await supabase
            .from(t.key)
            .select(t.select)
            .or(orClause)
            .limit(5);
          return { ...t, rows: data || [] };
        } catch { return { ...t, rows: [] }; }
      })
    );
    if (seq !== seqRef.current) return;
    const grouped = {};
    all.forEach(entry => { if (entry.rows.length > 0) grouped[entry.key] = entry; });
    setResults(grouped);
    setLoading(false);
  }

  function go(page, id) {
    onClose();
    setQuery("");
    setResults({});
    onNavigate(page, id ? { id, source: "mobileSearch" } : undefined);
  }

  function openMedix() {
    onClose();
    document.dispatchEvent(new CustomEvent("crm:toggle-medix"));
  }

  const hasQuery   = query.trim().length >= 2;
  const hasResults = Object.keys(results).length > 0;
  const showMedix  = hasQuery && query.trim().length > 4 && isQuestion(query);

  if (!open) return null;

  return (
    <div className="msearch" aria-modal="true" role="dialog" aria-label="Búsqueda global">

      {/* ── Input row ── */}
      <div className="msearch__top">
        <div className="msearch__input-wrap">
          <Search size={16} strokeWidth={1.5} className="msearch__search-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            className="msearch__input"
            type="search"
            placeholder="Buscar clientes, oportunidades, productos…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="search"
          />
          {query.length > 0 && (
            <button
              className="msearch__clear"
              onClick={() => setQuery("")}
              aria-label="Borrar"
            >
              <X size={13} strokeWidth={2.5} />
            </button>
          )}
        </div>
        <button className="msearch__cancel" onClick={onClose}>Cancelar</button>
      </div>

      {/* ── Body ── */}
      <div className="msearch__body">

        {/* Empty state: recents + quick navigation */}
        {!hasQuery && (
          <>
            {recents.length > 0 && (
              <>
                <p className="msearch__section-label">RECIENTES</p>
                {recents.map(r => (
                  <button key={r.key + r.ts} className="msearch__row" onClick={() => go(r.key)}>
                    <span className="msearch__row-icon msearch__row-icon--muted">
                      <Clock size={14} strokeWidth={1.5} />
                    </span>
                    <span className="msearch__row-label">{r.label}</span>
                    <ChevronRight size={13} strokeWidth={1.5} className="msearch__row-chev" />
                  </button>
                ))}
              </>
            )}
            <p className="msearch__section-label">{recents.length > 0 ? "MÓDULOS" : "IR A"}</p>
            {QUICK_ACTIONS.map(({ label, page, Icon: Ic }) => (
              <button key={page} className="msearch__row" onClick={() => go(page)}>
                <span className="msearch__row-icon">
                  <Ic size={14} strokeWidth={1.5} />
                </span>
                <span className="msearch__row-label">{label}</span>
                <ChevronRight size={13} strokeWidth={1.5} className="msearch__row-chev" />
              </button>
            ))}

            {/* Medix prompt */}
            <button className="msearch__medix-prompt" onClick={openMedix}>
              <span className="msearch__medix-dot" aria-hidden="true" />
              <div className="msearch__medix-text">
                <span className="msearch__medix-eyebrow">MEDIX</span>
                <span className="msearch__medix-label">¿Con qué querés que te ayude hoy?</span>
              </div>
              <Sparkles size={16} strokeWidth={1.5} className="msearch__medix-icon" aria-hidden="true" />
            </button>
          </>
        )}

        {/* Loading */}
        {hasQuery && loading && (
          <div className="msearch__loading">
            <span className="msearch__spinner" />
            <span>Buscando…</span>
          </div>
        )}

        {/* No results */}
        {hasQuery && !loading && !hasResults && (
          <p className="msearch__empty">
            Sin resultados para <strong>"{query}"</strong>
          </p>
        )}

        {/* Grouped results */}
        {hasQuery && !loading && hasResults && Object.entries(results).map(([key, { label, Icon: Ic, page, rows, title: titleFn, sub: subFn }]) => (
          <div key={key} className="msearch__group">
            <div className="msearch__group-hd">
              <Ic size={11} strokeWidth={2} className="msearch__group-icon" />
              <span className="msearch__group-label">{label}</span>
              <span className="msearch__group-count">{rows.length}</span>
            </div>
            {rows.map(row => {
              const title = titleFn(row) || "Sin título";
              const sub   = subFn(row);
              return (
                <button key={row.id} className="msearch__item" onClick={() => go(page, row.id)}>
                  <div className="msearch__item-main">
                    <span className="msearch__item-title">{title}</span>
                    {sub && <span className="msearch__item-sub">{sub}</span>}
                  </div>
                  <ChevronRight size={13} strokeWidth={1.5} className="msearch__row-chev" />
                </button>
              );
            })}
          </div>
        ))}

        {/* Medix suggestion for question queries */}
        {showMedix && (
          <button className="msearch__medix-suggest" onClick={openMedix}>
            <Sparkles size={14} strokeWidth={1.5} className="msearch__medix-suggest-icon" />
            <div>
              <p className="msearch__medix-suggest-label">Preguntar a Medix</p>
              <p className="msearch__medix-suggest-query">"{query}"</p>
            </div>
          </button>
        )}

        <div style={{ height: "calc(32px + env(safe-area-inset-bottom))" }} />
      </div>
    </div>
  );
}
