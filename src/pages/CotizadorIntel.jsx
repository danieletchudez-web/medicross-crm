import { useState, useMemo, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import "./CotizadorIntel.css";

/* ── helpers (mirrors CotizadorPage) ───────────────────────────────── */
const parseN   = (s) => parseFloat(String(s || "").replace(",", ".")) || 0;
const fARS     = (n) => "$ " + Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fPct     = (n) => Number(n || 0).toFixed(1) + "%";
const fmtDate  = (v) => { if (!v) return "—"; const [y, m, d] = String(v).slice(0, 10).split("-"); return `${d}/${m}/${y?.slice(2)}`; };
const norm     = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const avg      = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

const ESTADO_LABELS = {
  borrador: "Borrador", generado: "Generado", enviada: "Enviada",
  evaluacion: "En evaluación", aceptada: "Aceptada", rechazada: "Rechazada",
  vencida: "Vencida", seguimiento: "Seguimiento", negociacion: "Negociación",
  ganada: "Ganada", perdida: "Perdida", facturada: "Facturada", cobrada: "Cobrada",
};

/* ── calcR identico al de CotizadorPage ───────────────────────────── */
function calcFlat(r, tcG) {
  const tc   = parseN(r.tcInd) > 0 ? parseN(r.tcInd) : tcG;
  const iva  = parseN(r.iva) / 100;
  const cost = parseN(r.costo);
  if (cost <= 0 || tc <= 0) return null;
  const cARS = r.moneda === "ARS" ? cost : cost * tc;
  const pvMan = parseN(r.pvManual);
  let pvARSs, pvARSc;
  if (r.modoManual === "manual" && pvMan > 0) {
    pvARSc = pvMan; pvARSs = pvARSc / (1 + iva);
  } else {
    pvARSs = cARS * (parseN(r.markup) || 1); pvARSc = pvARSs * (1 + iva);
  }
  const mkPct = cARS > 0 ? (pvARSs - cARS) / cARS * 100 : 0;
  const gm    = pvARSs > 0 ? (pvARSs - cARS) / pvARSs * 100 : 0;
  return { cARS, pvARSs, pvARSc, mkPct, gm, subtotal: pvARSc * (parseInt(r.cant) || 1), tc };
}

/* ── expande cotizaciones → ítems planos ───────────────────────────── */
function expandCotizaciones(rows) {
  const flat = [];
  for (const cot of rows) {
    const tcG   = parseN(cot.tc) || 1425;
    const fecha = cot.fecha_apert || cot.created_at?.slice(0, 10) || "";
    for (const r of (cot.renglones || [])) {
      const calc = calcFlat(r, tcG);
      flat.push({
        quoteId:    cot.id,
        quoteNum:   cot.quote_num_formatted || String(cot.quote_number || "?"),
        fecha,
        institucion: cot.institucion || "",
        vendedor:    cot.vendedor || "",
        estado:      cot.estado || "borrador",
        empresa:     r.empresa || "",
        codigo:      r.codigo  || "",
        marca:       r.marca   || "",
        descr:       r.descr   || "",
        cant:        parseInt(r.cant) || 1,
        moneda:      r.moneda  || "USD",
        costo:       parseN(r.costo),
        ...(calc || { cARS: 0, pvARSs: 0, pvARSc: 0, mkPct: 0, gm: 0, subtotal: 0, tc: tcG }),
      });
    }
  }
  return flat.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
}

/* ── sort helper ────────────────────────────────────────────────────── */
function sortItems(arr, key, dir) {
  return [...arr].sort((a, b) => {
    const av = a[key] ?? "", bv = b[key] ?? "";
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
}

/* ── SearchIcon ─────────────────────────────────────────────────────── */
function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  );
}

/* ── componente principal ───────────────────────────────────────────── */
export default function CotizadorIntel({ onOpenQuote }) {
  const [open,      setOpen]      = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [items,     setItems]     = useState(null);   // null = never loaded
  const [search,    setSearch]    = useState("");
  const [fDesde,    setFDesde]    = useState("");
  const [fHasta,    setFHasta]    = useState("");
  const [fVendedor, setFVendedor] = useState("");
  const [fEstado,   setFEstado]   = useState("");
  const [fMoneda,   setFMoneda]   = useState("");
  const [sortKey,   setSortKey]   = useState("fecha");
  const [sortDir,   setSortDir]   = useState(-1);
  const loadingRef = useRef(false);

  async function loadData() {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("cotizaciones")
        .select("id, quote_num_formatted, quote_number, vendedor, institucion, estado, tc, created_at, fecha_apert, renglones")
        .eq("deleted", false)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      setItems(expandCotizaciones(data || []));
    } catch (e) {
      console.error("[CotizadorIntel]", e);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && items === null) loadData();
  }

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d * -1);
    else { setSortKey(key); setSortDir(-1); }
  }

  function clearFilters() {
    setSearch(""); setFDesde(""); setFHasta("");
    setFVendedor(""); setFEstado(""); setFMoneda("");
  }

  /* ── filtered + sorted items ──────────────────────────────────────── */
  const filtered = useMemo(() => {
    if (!items) return [];
    let res = items;
    if (search.trim()) {
      const q = norm(search.trim());
      res = res.filter(i =>
        [i.descr, i.codigo, i.marca, i.empresa, i.institucion, i.vendedor, i.quoteNum, i.estado]
          .some(f => norm(f).includes(q))
      );
    }
    if (fDesde) res = res.filter(i => i.fecha >= fDesde);
    if (fHasta) res = res.filter(i => i.fecha <= fHasta);
    if (fVendedor) res = res.filter(i => i.vendedor === fVendedor);
    if (fEstado)   res = res.filter(i => i.estado   === fEstado);
    if (fMoneda)   res = res.filter(i => i.moneda   === fMoneda);
    return sortItems(res, sortKey, sortDir);
  }, [items, search, fDesde, fHasta, fVendedor, fEstado, fMoneda, sortKey, sortDir]);

  /* ── KPIs ─────────────────────────────────────────────────────────── */
  const kpis = useMemo(() => {
    const valid = filtered.filter(i => i.pvARSc > 0);
    if (!valid.length) return null;
    const prices   = valid.map(i => i.pvARSc);
    const byDate   = [...valid].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    const p3       = avg(byDate.slice(0, 3).map(i => i.pvARSc));
    const p3prev   = avg(byDate.slice(3, 6).map(i => i.pvARSc));
    const trend    = !p3prev || byDate.length < 4 ? "—"
                   : p3 > p3prev * 1.05 ? "↑ Subiendo"
                   : p3 < p3prev * 0.95 ? "↓ Bajando"
                   : "→ Estable";
    const byClient = {};
    valid.forEach(i => {
      if (!i.institucion) return;
      if (!byClient[i.institucion]) byClient[i.institucion] = [];
      byClient[i.institucion].push(i.pvARSc);
    });
    const clientAvgs = Object.entries(byClient).map(([c, ps]) => [c, avg(ps)]);
    const cheapest  = clientAvgs.sort((a, b) => a[1] - b[1])[0]?.[0] || "";
    const mostExp   = clientAvgs.sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    return {
      count:      valid.length,
      lastPrice:  byDate[0]?.pvARSc || 0,
      lastDate:   byDate[0]?.fecha  || "",
      minPrice:   Math.min(...prices),
      maxPrice:   Math.max(...prices),
      avgPrice:   avg(prices),
      avgMarkup:  avg(valid.map(i => i.mkPct)),
      avgGM:      avg(valid.map(i => i.gm)),
      trend,
      cheapest,
      mostExp,
    };
  }, [filtered]);

  const vendedores = useMemo(
    () => items ? [...new Set(items.map(i => i.vendedor).filter(Boolean))].sort() : [],
    [items]
  );

  const hasFilters = search || fDesde || fHasta || fVendedor || fEstado || fMoneda;
  const TABLE_COLS = [
    { key: "fecha",      label: "Fecha"     },
    { key: "quoteNum",   label: "#Cot."     },
    { key: "institucion",label: "Cliente"   },
    { key: "descr",      label: "Descripción" },
    { key: "cant",       label: "Cant."     },
    { key: "cARS",       label: "Costo ARS" },
    { key: "pvARSc",     label: "PV c/IVA"  },
    { key: "mkPct",      label: "Markup %"  },
    { key: "gm",         label: "GM %"      },
    { key: "moneda",     label: "Mon."      },
    { key: "vendedor",   label: "Vendedor"  },
    { key: "estado",     label: "Estado"    },
  ];

  return (
    <div className="ci-wrap">
      {/* ── toggle ── */}
      <button className="ci-toggle" onClick={toggle} type="button">
        <span className="ci-toggle__ico">📊</span>
        <span className="ci-toggle__label">Inteligencia Comercial de Cotizaciones</span>
        {items !== null && (
          <span className="ci-toggle__badge">{items.length} ítems</span>
        )}
        <span className="ci-toggle__chev">{open ? "▲" : "▼"}</span>
      </button>

      {/* ── panel ── */}
      {open && (
        <div className="ci-panel">

          {/* estado vacío / carga inicial */}
          {items === null && (
            <div className="ci-init">
              {loading ? (
                <span className="ci-init__loading">Cargando historial…</span>
              ) : (
                <button className="ci-load-btn" type="button" onClick={loadData}>
                  Cargar historial de cotizaciones
                </button>
              )}
            </div>
          )}

          {items !== null && (
            <>
              {/* ── buscador ── */}
              <div className="ci-search-row">
                <div className="ci-search-wrap">
                  <span className="ci-search-ico"><SearchIcon /></span>
                  <input
                    className="ci-search-input"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Buscar producto, descripción, código, cliente, vendedor, N° cotización…"
                    autoComplete="off"
                  />
                  {search && (
                    <button className="ci-search-clear" type="button" onClick={() => setSearch("")}>×</button>
                  )}
                </div>
                <button
                  className="ci-refresh-btn"
                  type="button"
                  onClick={loadData}
                  disabled={loading}
                  title="Recargar datos"
                >
                  {loading ? "…" : "↺"}
                </button>
              </div>

              {/* ── filtros ── */}
              <div className="ci-filters">
                <input type="date" className="ci-filter" value={fDesde} onChange={e => setFDesde(e.target.value)} title="Desde" />
                <input type="date" className="ci-filter" value={fHasta} onChange={e => setFHasta(e.target.value)} title="Hasta" />
                <select className="ci-filter" value={fVendedor} onChange={e => setFVendedor(e.target.value)}>
                  <option value="">Todos los vendedores</option>
                  {vendedores.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
                <select className="ci-filter" value={fEstado} onChange={e => setFEstado(e.target.value)}>
                  <option value="">Todos los estados</option>
                  {Object.entries(ESTADO_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <select className="ci-filter" value={fMoneda} onChange={e => setFMoneda(e.target.value)}>
                  <option value="">Moneda</option>
                  <option value="USD">USD</option>
                  <option value="ARS">ARS</option>
                </select>
                {hasFilters && (
                  <button className="ci-filter-clear" type="button" onClick={clearFilters}>✕ Limpiar</button>
                )}
                <span className="ci-filter-count">
                  {filtered.length} resultado{filtered.length !== 1 ? "s" : ""}
                </span>
              </div>

              {/* ── KPIs ── */}
              {kpis && (
                <div className="ci-kpis">
                  <div className="ci-kpi">
                    <span>Ítems encontrados</span>
                    <strong>{kpis.count}</strong>
                  </div>
                  <div className="ci-kpi ci-kpi--accent">
                    <span>Último precio</span>
                    <strong>{fARS(kpis.lastPrice)}</strong>
                    <small>{fmtDate(kpis.lastDate)}</small>
                  </div>
                  <div className="ci-kpi">
                    <span>Precio mínimo</span>
                    <strong>{fARS(kpis.minPrice)}</strong>
                  </div>
                  <div className="ci-kpi">
                    <span>Precio máximo</span>
                    <strong>{fARS(kpis.maxPrice)}</strong>
                  </div>
                  <div className="ci-kpi">
                    <span>Precio promedio</span>
                    <strong>{fARS(kpis.avgPrice)}</strong>
                  </div>
                  <div className="ci-kpi">
                    <span>Markup promedio</span>
                    <strong>{fPct(kpis.avgMarkup)}</strong>
                  </div>
                  <div className="ci-kpi">
                    <span>Gross Margin prom.</span>
                    <strong>{fPct(kpis.avgGM)}</strong>
                  </div>
                  <div className="ci-kpi">
                    <span>Tendencia precio</span>
                    <strong className={
                      kpis.trend.startsWith("↑") ? "ci-trend--up" :
                      kpis.trend.startsWith("↓") ? "ci-trend--dn" : ""
                    }>{kpis.trend}</strong>
                  </div>
                  {kpis.cheapest && (
                    <div className="ci-kpi">
                      <span>Cotizado más barato en</span>
                      <strong className="ci-kpi__client">{kpis.cheapest}</strong>
                    </div>
                  )}
                  {kpis.mostExp && kpis.mostExp !== kpis.cheapest && (
                    <div className="ci-kpi">
                      <span>Cotizado más caro en</span>
                      <strong className="ci-kpi__client">{kpis.mostExp}</strong>
                    </div>
                  )}
                </div>
              )}

              {/* ── tabla ── */}
              {filtered.length === 0 ? (
                <p className="ci-empty">
                  {hasFilters
                    ? "Sin resultados con los filtros actuales. Intentá ampliar la búsqueda."
                    : "No hay ítems en las cotizaciones guardadas."}
                </p>
              ) : (
                <div className="ci-table-wrap">
                  <table className="ci-table">
                    <thead>
                      <tr>
                        {TABLE_COLS.map(({ key, label }) => (
                          <th
                            key={key}
                            className="ci-th-sort"
                            onClick={() => handleSort(key)}
                          >
                            {label}
                            {sortKey === key ? (sortDir > 0 ? " ↑" : " ↓") : ""}
                          </th>
                        ))}
                        <th className="ci-th-action">Abrir</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.slice(0, 200).map((item, i) => (
                        <tr key={i} className="ci-tr">
                          <td>{fmtDate(item.fecha)}</td>
                          <td className="ci-td-num">#{item.quoteNum}</td>
                          <td className="ci-td-clip" title={item.institucion}>
                            {item.institucion || "—"}
                          </td>
                          <td className="ci-td-clip ci-td-descr" title={item.descr}>
                            {item.descr || item.codigo || "—"}
                          </td>
                          <td className="ci-td-r">{item.cant}</td>
                          <td className="ci-td-r">{item.cARS > 0 ? fARS(item.cARS) : "—"}</td>
                          <td className="ci-td-r ci-td-price">{item.pvARSc > 0 ? fARS(item.pvARSc) : "—"}</td>
                          <td className="ci-td-r">{item.mkPct > 0 ? fPct(item.mkPct) : "—"}</td>
                          <td className="ci-td-r">{item.gm > 0 ? fPct(item.gm) : "—"}</td>
                          <td>{item.moneda}</td>
                          <td>{(item.vendedor || "—").split(" ")[0]}</td>
                          <td>
                            <span className={`ci-estado ci-estado--${item.estado || "borrador"}`}>
                              {ESTADO_LABELS[item.estado] || item.estado}
                            </span>
                          </td>
                          <td className="ci-td-action">
                            <button
                              type="button"
                              className="ci-open-btn"
                              onClick={() => onOpenQuote(item.quoteId)}
                              title={`Abrir cotización #${item.quoteNum}`}
                            >
                              →
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filtered.length > 200 && (
                    <p className="ci-limit-note">
                      Mostrando 200 de {filtered.length} resultados — afiná la búsqueda para ver más.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ── hook liviano para hint contextual por renglón ──────────────────── *
 * Se llama desde CotizadorPage para mostrar info de precios históricos
 * internos al tipear la descripción de un renglón.                      */
export function useQuoteHint(cotHistory, descr) {
  return useMemo(() => {
    if (!cotHistory || !descr || descr.length < 5) return null;
    const q = norm(descr.trim());
    const tokens = q.split(/\s+/).filter(t => t.length >= 3);
    if (!tokens.length) return null;
    const matches = cotHistory.filter(item => {
      const t = norm(item.descr);
      return tokens.every(tok => t.includes(tok));
    });
    const withPrice = matches.filter(m => m.pvARSc > 0);
    if (!withPrice.length) return null;
    const prices = withPrice.map(m => m.pvARSc);
    const byDate  = [...withPrice].sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));
    return {
      count:    matches.length,
      lastPrice: byDate[0]?.pvARSc || 0,
      avgPrice:  avg(prices),
      avgGM:     avg(withPrice.map(m => m.gm)),
    };
  }, [cotHistory, descr]);
}
