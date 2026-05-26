import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import "./GlobalSearch.css";

const TABLES = [
  { key: "accounts",     label: "Cliente",     page: "accounts",     select: "id,name,city,province,type",                       fields: ["name","city","province","type"] },
  { key: "opportunities",label: "Oportunidad", page: "opportunities",select: "id,name,stage,next_action",                        fields: ["name","stage","next_action"] },
  { key: "products",     label: "Producto",    page: "products",     select: "id,name,line,speech",                              fields: ["name","line","speech"] },
  { key: "tenders",      label: "Licitación",  page: "tenders",      select: "id,institution,process_name,process_number,status",fields: ["institution","process_name","process_number","status"] },
  { key: "visits",       label: "Visita",      page: "visits",       select: "id,visit_date,contact,objective,notes",            fields: ["contact","objective","notes","visit_date"] },
];

function matches(row, fields, query) {
  const q = query.toLowerCase();
  return fields.some(field => String(row[field] || "").toLowerCase().includes(q));
}

function titleFor(item) {
  return item.name || item.institution || item.process_name || item.objective || item.contact || "Sin título";
}

function subtitleFor(item) {
  return [item.city, item.province, item.type, item.stage, item.status, item.process_number, item.visit_date]
    .filter(Boolean)
    .join(" · ");
}

export default function GlobalSearch({ onNavigate }) {
  const [open,    setOpen]    = useState(false);
  const [query,   setQuery]   = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const hasQuery = query.trim().length >= 2;
  const grouped  = useMemo(() => {
    return results.reduce((acc, item) => {
      acc[item.kind] = acc[item.kind] || [];
      acc[item.kind].push(item);
      return acc;
    }, {});
  }, [results]);

  /* Atajo de teclado ⌘K / Ctrl+K */
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  async function runSearch(value) {
    setQuery(value);
    if (value.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    const loaded = await Promise.all(TABLES.map(async table => {
      const { data } = await supabase.from(table.key).select(table.select).limit(30);
      return (data || [])
        .filter(row => matches(row, table.fields, value))
        .slice(0, 6)
        .map(row => ({ ...row, kind: table.label, page: table.page }));
    }));
    setResults(loaded.flat());
    setLoading(false);
  }

  function go(item) {
    setOpen(false);
    setQuery("");
    setResults([]);
    onNavigate(item.page, { id: item.id, source: "globalSearch" });
  }

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
            <div className="global-search-box">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{color:"#94a3b8",flexShrink:0}}>
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                autoFocus
                value={query}
                onChange={e => runSearch(e.target.value)}
                placeholder="Buscar clientes, licitaciones, oportunidades, productos o visitas..."
              />
              <button onClick={() => setOpen(false)}>Esc</button>
            </div>
            <div className="global-search-results">
              {!hasQuery && <p className="global-search-empty">Escribí al menos 2 letras para buscar en todo el CRM.</p>}
              {hasQuery && loading  && <p className="global-search-empty">Buscando...</p>}
              {hasQuery && !loading && results.length === 0 && <p className="global-search-empty">Sin resultados.</p>}
              {Object.entries(grouped).map(([kind, rows]) => (
                <div key={kind} className="global-search-group">
                  <span>{kind}</span>
                  {rows.map(item => (
                    <button key={`${kind}-${item.id}`} onClick={() => go(item)}>
                      <strong>{titleFor(item)}</strong>
                      <small>{subtitleFor(item) || "Abrir registro"}</small>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
