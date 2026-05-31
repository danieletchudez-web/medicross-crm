import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import "./GlobalSearch.css";

/* ─── Table definitions ───────────────────────────────────────────────
   fields      → client-side match against top-level string columns
   jsonFields  → match inside JSONB array columns (e.g. renglones)
   objFields   → match inside a joined object (many-to-one join)
   ilike       → server-side ilike search (use for large tables)
──────────────────────────────────────────────────────────────────────── */
const TABLES = [
  {
    key: "accounts", label: "Cliente", icon: "🏥", page: "accounts",
    select: "id,name,city,province,type,phone,email",
    fields: ["name","city","province","type","phone","email"],
  },
  {
    key: "opportunities", label: "Oportunidad", icon: "💼", page: "opportunities",
    select: "id,name,stage,next_action,accounts(name)",
    fields: ["name","stage","next_action"],
    objFields: [{ field: "accounts", keys: ["name"] }],
  },
  {
    key: "products", label: "Producto", icon: "📦", page: "products",
    select: "id,name,line,speech",
    fields: ["name","line","speech"],
  },
  {
    key: "campaigns", label: "Campaña", icon: "📣", page: "campaigns",
    select: "id,name,product_line,status,objective",
    fields: ["name","product_line","status","objective"],
  },
  {
    key: "tenders", label: "Licitación", icon: "📋", page: "tenders",
    select: "id,institution,process_name,process_number,status,jurisdiction,product_line,next_action,competitor_winner",
    fields: ["institution","process_name","process_number","status","jurisdiction","product_line","next_action","competitor_winner"],
  },
  {
    key: "tender_competitors", label: "Competidor", icon: "🏁", page: "tenders",
    select: "id,name,notes,tender_id",
    fields: ["name","notes"],
  },
  {
    key: "cotizaciones", label: "Cotización", icon: "🧾", page: "cotizador",
    select: "id,quote_num_formatted,vendedor,institucion,nro_licit,renglones",
    fields: ["quote_num_formatted","vendedor","institucion","nro_licit"],
    jsonFields: [{ field: "renglones", keys: ["descr","codigo","marca","empresa"] }],
  },
  {
    key: "tender_comparativas", label: "Intel. de precios", icon: "📊", page: "preciosHistoricos",
    select: "id,descripcion,empresa,renglon",
    ilike: ["descripcion","empresa"],
  },
  {
    key: "visits", label: "Visita", icon: "📍", page: "visits",
    select: "id,visit_date,contact,objective,notes,visit_type",
    fields: ["contact","objective","notes","visit_type"],
  },
];

/* ─── Matching helpers ───────────────────────────────────────────────── */
function matches(row, fields = [], query, jsonFields = [], objFields = []) {
  const q = query.toLowerCase();
  if (fields.some(f => String(row[f] || "").toLowerCase().includes(q))) return true;
  for (const { field, keys } of jsonFields) {
    const arr = Array.isArray(row[field]) ? row[field] : [];
    if (arr.some(item => keys.some(k => String(item[k] || "").toLowerCase().includes(q)))) return true;
  }
  for (const { field, keys } of objFields) {
    const obj = row[field];
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      if (keys.some(k => String(obj[k] || "").toLowerCase().includes(q))) return true;
    }
  }
  return false;
}

function titleFor(item) {
  return (
    item.name        ||
    item.institution ||
    item.process_name||
    item.quote_num_formatted ||
    item.descripcion ||
    item.objective   ||
    item.contact     ||
    "Sin título"
  );
}

function subtitleFor(item) {
  if (item.renglones !== undefined) {
    const prods = (item.renglones || [])
      .map(r => r.descr || r.codigo).filter(Boolean).slice(0, 3).join(", ");
    return [item.institucion, item.vendedor, prods].filter(Boolean).join(" · ");
  }
  if (item.descripcion !== undefined) {
    return [item.empresa, item.renglon != null ? `Renglón ${item.renglon}` : ""].filter(Boolean).join(" · ");
  }
  if (item.stage !== undefined) {
    return [item.accounts?.name, item.stage, item.next_action].filter(Boolean).join(" · ");
  }
  if (item.product_line !== undefined && item.objective !== undefined) {
    return [item.product_line, item.status, (item.objective || "").slice(0, 60)].filter(Boolean).join(" · ");
  }
  if (item.visit_date !== undefined) {
    return [item.visit_date, item.visit_type, item.contact].filter(Boolean).join(" · ");
  }
  return [
    item.city, item.province, item.type,
    item.status, item.process_number, item.jurisdiction,
  ].filter(Boolean).join(" · ");
}

/* ══════════════════════════════════════════════════════════════════════ */
export default function GlobalSearch({ onNavigate }) {
  const [open,        setOpen]        = useState(false);
  const [query,       setQuery]       = useState("");
  const [results,     setResults]     = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [activeType,  setActiveType]  = useState("all");

  const flatRef     = useRef([]);
  const resultsRef  = useRef(null);
  const searchTimer = useRef(null);
  const searchSeq   = useRef(0);

  const hasQuery = query.trim().length >= 2;

  const grouped = useMemo(() => {
    return results.reduce((acc, item) => {
      acc[item.kind] = acc[item.kind] || [];
      acc[item.kind].push(item);
      return acc;
    }, {});
  }, [results]);

  const totalCount = results.length;

  const moduleOrder = TABLES.map(t => t.label);
  const sortedGroups = Object.entries(grouped).sort(
    ([a], [b]) => moduleOrder.indexOf(a) - moduleOrder.indexOf(b)
  );
  const visibleGroups = activeType === "all"
    ? sortedGroups
    : sortedGroups.filter(([kind]) => kind === activeType);
  const visibleCount = visibleGroups.reduce((sum, [, rows]) => sum + rows.length, 0);
  const visibleRows = useMemo(() => visibleGroups.flatMap(([, rows]) => rows), [visibleGroups]);

  // Keep flat ref in sync for keyboard nav
  useEffect(() => { flatRef.current = visibleRows; }, [visibleRows]);

  useEffect(() => () => clearTimeout(searchTimer.current), []);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIdx < 0 || !resultsRef.current) return;
    const el = resultsRef.current.querySelector(`[data-idx="${selectedIdx}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedIdx]);

  // Reset selection when results change
  useEffect(() => { setSelectedIdx(-1); }, [results]);

  /* ⌘K / Ctrl+K + arrow nav */
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setOpen(o => !o); return; }
      if (e.key === "Escape") { setOpen(false); return; }
      if (!open) return;
      const flat = flatRef.current;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx(i => Math.min(i + 1, flat.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx(i => Math.max(i - 1, -1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        setSelectedIdx(i => {
          const item = flat[i];
          if (item) {
            setOpen(false);
            setQuery("");
            setResults([]);
            onNavigate(item.page, { id: item.id, source: "globalSearch" });
          }
          return i;
        });
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onNavigate]);

  function runSearch(value) {
    setQuery(value);
    setActiveType("all");
    clearTimeout(searchTimer.current);
    const seq = ++searchSeq.current;
    if (value.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    searchTimer.current = setTimeout(() => executeSearch(value, seq), 300);
  }

  async function executeSearch(value, seq) {
    const loaded = await Promise.all(
      TABLES.map(async table => {
        try {
          let rows;
          if (table.ilike) {
            const orClause = table.ilike.map(f => `${f}.ilike.%${value.trim()}%`).join(",");
            const { data } = await supabase
              .from(table.key).select(table.select).or(orClause).limit(8);
            rows = data || [];
          } else {
            const { data } = await supabase
              .from(table.key).select(table.select).limit(80);
            rows = (data || []).filter(row =>
              matches(row, table.fields, value, table.jsonFields || [], table.objFields || [])
            );
          }
          return rows.slice(0, 3).map(row => ({
            ...row,
            kind:     table.label,
            kindIcon: table.icon,
            page:     table.page,
          }));
        } catch {
          return [];
        }
      })
    );

    if (seq !== searchSeq.current) return;
    setResults(loaded.flat());
    setLoading(false);
  }

  function go(item) {
    setOpen(false);
    setQuery("");
    setResults([]);
    onNavigate(item.page, { id: item.id, source: "globalSearch" });
  }

  // Render with global flat index for keyboard nav
  let gIdx = -1;

  return (
    <>
      <button className="global-search-trigger" onClick={() => setOpen(true)} aria-label="Abrir búsqueda global">
        <svg className="global-search-trigger__icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <span className="global-search-trigger__text">Buscar...</span>
        <kbd className="global-search-trigger__kbd">⌘K</kbd>
      </button>

      {open && (
        <div
          className="global-search-overlay"
          onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <section className="global-search-panel">

            {/* Input */}
            <div className="global-search-box">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color:"#94a3b8", flexShrink:0 }}>
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                autoFocus
                value={query}
                onChange={e => runSearch(e.target.value)}
                placeholder="Buscar en todo el CRM: clientes, productos, licitaciones…"
              />
              {loading
                ? <div className="global-search-spinner"/>
                : <button onClick={() => setOpen(false)}>Esc</button>
              }
            </div>

            {/* Summary bar */}
            {hasQuery && !loading && totalCount > 0 && (
              <div className="global-search-summary">
                <span>{totalCount} resultado{totalCount > 1 ? "s" : ""} en {sortedGroups.length} módulo{sortedGroups.length > 1 ? "s" : ""}</span>
                <div className="global-search-summary__tags">
                  {sortedGroups.map(([kind, rows]) => {
                    const icon = TABLES.find(t => t.label === kind)?.icon || "";
                    return (
                      <button
                        key={kind}
                        className={`global-search-summary__tag${activeType === kind ? " global-search-summary__tag--active" : ""}`}
                        onClick={() => setActiveType(activeType === kind ? "all" : kind)}
                      >
                        {icon} {kind} <strong>{rows.length}</strong>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Results */}
            <div className="global-search-results" ref={resultsRef}>
              {!hasQuery && (
                <div className="global-search-hint">
                  <p>Buscá en <strong>todos los módulos</strong> del CRM simultáneamente.</p>
                  <div className="global-search-modules">
                    {TABLES.map(t => (
                      <span key={t.key} className="global-search-module-tag">
                        {t.icon} {t.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {hasQuery && loading  && <p className="global-search-empty">Buscando en todos los módulos…</p>}
              {hasQuery && !loading && totalCount === 0 && (
                <p className="global-search-empty">Sin resultados para <strong>"{query}"</strong>.</p>
              )}

              {visibleGroups.map(([kind, rows]) => {
                const icon = TABLES.find(t => t.label === kind)?.icon || "";
                return (
                  <div key={kind} className="global-search-group">
                    <div className="global-search-group__header">
                      <span className="global-search-group__icon">{icon}</span>
                      <span className="global-search-group__label">{kind}</span>
                      <span className="global-search-group__count">{rows.length}</span>
                    </div>
                    {rows.map(item => {
                      gIdx++;
                      const myIdx = gIdx;
                      return (
                        <button
                          key={`${kind}-${item.id}`}
                          data-idx={myIdx}
                          className={`global-search-item${selectedIdx === myIdx ? " global-search-item--selected" : ""}`}
                          onMouseEnter={() => setSelectedIdx(myIdx)}
                          onClick={() => go(item)}
                        >
                          <strong className="global-search-item__title">{titleFor(item)}</strong>
                          {subtitleFor(item) && (
                            <small className="global-search-item__sub">{subtitleFor(item)}</small>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            {hasQuery && totalCount > 0 && (
              <div className="global-search-footer">
                <span>{visibleCount} visibles</span>
                <span><kbd>↑</kbd><kbd>↓</kbd> Navegar</span>
                <span><kbd>↵</kbd> Abrir</span>
                <span><kbd>Esc</kbd> Cerrar</span>
              </div>
            )}

          </section>
        </div>
      )}
    </>
  );
}
