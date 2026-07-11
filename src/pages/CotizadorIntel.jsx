import { useState, useMemo, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import "./CotizadorIntel.css";

/* ── helpers ────────────────────────────────────────────────────────── */
const parseN   = (s) => parseFloat(String(s || "").replace(",", ".")) || 0;
const fARS     = (n) => "$ " + Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fPct     = (n) => Number(n || 0).toFixed(1) + "%";
const fmtDate  = (v) => { if (!v) return "—"; const [y, m, d] = String(v).slice(0, 10).split("-"); return `${d}/${m}/${y?.slice(2)}`; };
const norm     = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const avg      = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
const median   = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/* Rangos plausibles — valores fuera se excluyen del promedio/mediana */
const GM_RANGE = [-50, 95];   // % gross margin
const MK_RANGE = [-50, 900];  // % markup

const ESTADO_LABELS = {
  borrador: "Borrador", generado: "Generado", enviada: "Enviada",
  evaluacion: "En evaluación", aceptada: "Aceptada", rechazada: "Rechazada",
  vencida: "Vencida", seguimiento: "Seguimiento", negociacion: "Negociación",
  ganada: "Ganada", perdida: "Perdida", facturada: "Facturada", cobrada: "Cobrada",
};

/* ── calcFlat (mirrors CotizadorPage) ──────────────────────────────── */
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

/* ── expand cotizaciones → flat items ──────────────────────────────── */
function expandCotizaciones(rows) {
  const flat = [];
  for (const cot of rows) {
    const tcG   = parseN(cot.tc) || 1425;
    const fecha = cot.fecha_apert || cot.created_at?.slice(0, 10) || "";
    for (const r of (cot.renglones || [])) {
      const calc = calcFlat(r, tcG);
      flat.push({
        quoteId:     cot.id,
        quoteNum:    cot.quote_num_formatted || String(cot.quote_number || "?"),
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

/* ── sort ───────────────────────────────────────────────────────────── */
function sortItems(arr, key, dir) {
  return [...arr].sort((a, b) => {
    const av = a[key] ?? "", bv = b[key] ?? "";
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
}

/* D. Token-based search ─────────────────────────────────────────────── */
function tokenMatch(item, tokens) {
  if (!tokens.length) return true;
  return tokens.every(tok =>
    [item.descr, item.codigo, item.marca, item.empresa, item.institucion, item.vendedor, item.quoteNum, item.estado]
      .some(f => norm(f).includes(tok))
  );
}

/* E. Highlight matching tokens ──────────────────────────────────────── */
function Highlight({ text, tokens }) {
  if (!tokens?.length || !text) return <>{text || ""}</>;
  const lw = norm(text);
  const ranges = [];
  for (const tok of tokens) {
    let idx = 0;
    while (idx < lw.length) {
      const found = lw.indexOf(tok, idx);
      if (found < 0) break;
      ranges.push([found, found + tok.length]);
      idx = found + tok.length;
    }
  }
  if (!ranges.length) return <>{text}</>;
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [[...ranges[0]]];
  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1];
    if (ranges[i][0] <= last[1]) last[1] = Math.max(last[1], ranges[i][1]);
    else merged.push([...ranges[i]]);
  }
  const parts = [];
  let pos = 0;
  for (const [start, end] of merged) {
    if (pos < start) parts.push(text.slice(pos, start));
    parts.push(<mark key={start} className="ci-hl">{text.slice(start, end)}</mark>);
    pos = end;
  }
  if (pos < text.length) parts.push(text.slice(pos));
  return <>{parts}</>;
}

/* C. Sparkline SVG ──────────────────────────────────────────────────── */
function Sparkline({ items }) {
  const pts = [...items]
    .filter(i => i.pvARSc > 0 && i.fecha)
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  if (pts.length < 2) return null;
  const W = 180, H = 52;
  const prices = pts.map(p => p.pvARSc);
  const minP = Math.min(...prices), maxP = Math.max(...prices);
  const range = maxP - minP || 1;
  const toX = (i) => (i / (pts.length - 1)) * (W - 12) + 6;
  const toY = (v) => H - 8 - ((v - minP) / range) * (H - 18);
  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(p.pvARSc).toFixed(1)}`).join(" ");
  const fillPath = `${linePath} L ${toX(pts.length - 1).toFixed(1)} ${H} L ${toX(0).toFixed(1)} ${H} Z`;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible", display: "block" }}>
      <defs>
        <linearGradient id="ci-sg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#185fa5" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#185fa5" stopOpacity="0.01" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill="url(#ci-sg)" />
      <path d={linePath} fill="none" stroke="#185fa5" strokeWidth="2" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={toX(i)} cy={toY(p.pvARSc)} r={i === pts.length - 1 ? 4 : 2.5}
          fill="#185fa5" stroke={i === pts.length - 1 ? "#fff" : "none"} strokeWidth="1.5" />
      ))}
    </svg>
  );
}

/* ── SearchIcon ─────────────────────────────────────────────────────── */
function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   COMPONENTE PRINCIPAL
══════════════════════════════════════════════════════════════════════ */
export default function CotizadorIntel({ onOpenQuote, onUseInRenglon }) {
  const [open,       setOpen]       = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [items,      setItems]      = useState(null);
  const [search,     setSearch]     = useState("");
  const [fDesde,     setFDesde]     = useState("");
  const [fHasta,     setFHasta]     = useState("");
  const [fVendedor,  setFVendedor]  = useState("");
  const [fEstado,    setFEstado]    = useState("");
  const [fMoneda,    setFMoneda]    = useState("");
  const [fPrecioMin, setFPrecioMin] = useState("");  /* F */
  const [fPrecioMax, setFPrecioMax] = useState("");  /* F */
  const [sortKey,    setSortKey]    = useState("fecha");
  const [sortDir,    setSortDir]    = useState(-1);
  const [grouped,    setGrouped]    = useState(false); /* B */
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
    setFPrecioMin(""); setFPrecioMax("");
  }

  /* D. Token-based search tokens */
  const searchTokens = useMemo(() => {
    const q = norm(search.trim());
    return q ? q.split(/\s+/).filter(t => t.length > 0) : [];
  }, [search]);

  /* filtered + sorted */
  const filtered = useMemo(() => {
    if (!items) return [];
    let res = items;
    if (searchTokens.length) res = res.filter(i => tokenMatch(i, searchTokens));
    if (fDesde)    res = res.filter(i => i.fecha >= fDesde);
    if (fHasta)    res = res.filter(i => i.fecha <= fHasta);
    if (fVendedor) res = res.filter(i => i.vendedor === fVendedor);
    if (fEstado)   res = res.filter(i => i.estado   === fEstado);
    if (fMoneda)   res = res.filter(i => i.moneda   === fMoneda);
    /* F. Price range */
    const pMin = fPrecioMin ? parseFloat(String(fPrecioMin).replace(/\./g, "").replace(",", ".")) : 0;
    const pMax = fPrecioMax ? parseFloat(String(fPrecioMax).replace(/\./g, "").replace(",", ".")) : 0;
    if (pMin > 0) res = res.filter(i => i.pvARSc >= pMin);
    if (pMax > 0) res = res.filter(i => i.pvARSc <= pMax);
    return sortItems(res, sortKey, sortDir);
  }, [items, searchTokens, fDesde, fHasta, fVendedor, fEstado, fMoneda, fPrecioMin, fPrecioMax, sortKey, sortDir]);

  /* B. Grouped data */
  const groupedData = useMemo(() => {
    const map = {};
    filtered.forEach(item => {
      const key = norm(item.descr || item.codigo || "?");
      if (!map[key]) map[key] = {
        key,
        descr:   item.descr || item.codigo || "—",
        empresa: item.empresa,
        items:   [],
      };
      map[key].items.push(item);
    });
    return Object.values(map).map(g => {
      const withPrice = g.items.filter(i => i.pvARSc > 0);
      const prices    = withPrice.map(i => i.pvARSc);
      const byDate    = [...g.items].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
      return {
        ...g,
        count:     g.items.length,
        lastItem:  byDate[0],
        lastPrice: byDate.find(i => i.pvARSc > 0)?.pvARSc || 0,
        minPrice:  prices.length ? Math.min(...prices) : 0,
        maxPrice:  prices.length ? Math.max(...prices) : 0,
        avgPrice:  prices.length ? avg(prices) : 0,
        avgMk:     avg(withPrice.map(i => i.mkPct)),
        clients:   [...new Set(g.items.map(i => i.institucion).filter(Boolean))],
      };
    }).sort((a, b) => b.count - a.count);
  }, [filtered]);

  /* KPIs */
  const kpis = useMemo(() => {
    const valid = filtered.filter(i => i.pvARSc > 0);
    if (!valid.length) return null;
    const prices  = valid.map(i => i.pvARSc);
    const byDate  = [...valid].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    const p3      = avg(byDate.slice(0, 3).map(i => i.pvARSc));
    const p3prev  = avg(byDate.slice(3, 6).map(i => i.pvARSc));
    const trend   = !p3prev || byDate.length < 4 ? "—"
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
    /* Outlier filtering for GM and Markup */
    const gmClean    = valid.filter(i => i.gm    >= GM_RANGE[0] && i.gm    <= GM_RANGE[1]);
    const mkClean    = valid.filter(i => i.mkPct >= MK_RANGE[0] && i.mkPct <= MK_RANGE[1]);
    const gmOutliers = valid.length - gmClean.length;
    const mkOutliers = valid.length - mkClean.length;
    return {
      count:      valid.length,
      lastPrice:  byDate[0]?.pvARSc || 0,
      lastDate:   byDate[0]?.fecha  || "",
      minPrice:   Math.min(...prices),
      maxPrice:   Math.max(...prices),
      avgPrice:   avg(prices),
      avgMarkup:  avg(mkClean.map(i => i.mkPct)),
      medMarkup:  median(mkClean.map(i => i.mkPct)),
      mkOutliers,
      avgGM:      avg(gmClean.map(i => i.gm)),
      medGM:      median(gmClean.map(i => i.gm)),
      gmOutliers,
      trend,
      cheapest,
      mostExp,
    };
  }, [filtered]);

  const vendedores = useMemo(
    () => items ? [...new Set(items.map(i => i.vendedor).filter(Boolean))].sort() : [],
    [items]
  );

  /* P2 — cotizaciones únicas (dedup por quoteId) para analytics de pipeline */
  const cotizacionesUniq = useMemo(() => {
    if (!items) return [];
    const map = {};
    items.forEach(i => { if (!map[i.quoteId]) map[i.quoteId] = i; });
    return Object.values(map);
  }, [items]);

  const FUNNEL_STATES = ["borrador","generado","enviada","evaluacion","negociacion","aceptada","rechazada","vencida"];

  const pipeline = useMemo(() => {
    if (!cotizacionesUniq.length) return null;
    const counts = {};
    FUNNEL_STATES.forEach(s => { counts[s] = 0; });
    cotizacionesUniq.forEach(c => {
      if (counts[c.estado] !== undefined) counts[c.estado]++;
    });
    const total      = cotizacionesUniq.length;
    const aceptadas  = counts.aceptada  || 0;
    const terminales = aceptadas + (counts.rechazada || 0) + (counts.vencida || 0);
    const tasaAcept  = terminales > 0 ? Math.round(aceptadas / terminales * 100) : null;
    const maxCount   = Math.max(1, ...FUNNEL_STATES.map(s => counts[s]));
    return { counts, total, tasaAcept, maxCount };
  }, [cotizacionesUniq]);

  /* Mantenimientos: cotizaciones aceptadas con más de 12 meses de antigüedad */
  const cutoffDate = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().slice(0, 10);
  }, []);

  const maintenance = useMemo(() => {
    if (!cotizacionesUniq.length) return [];
    return cotizacionesUniq
      .filter(c => c.estado === "aceptada" && c.fecha && c.fecha < cutoffDate)
      .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  }, [cotizacionesUniq, cutoffDate]);

  /* P3 — Ranking de vendedores: agrega por items (todos, sin filtrar) */
  const vendorRanking = useMemo(() => {
    if (!items || !items.length) return [];
    const map = {};
    items.forEach(i => {
      const v = i.vendedor || "Sin asignar";
      if (!map[v]) map[v] = { vendedor: v, quoteIds: new Set(), total: 0 };
      map[v].quoteIds.add(i.quoteId);
      map[v].total += i.subtotal || 0;
    });
    const ranked = Object.values(map)
      .map(v => ({ vendedor: v.vendedor, count: v.quoteIds.size, total: v.total }))
      .sort((a, b) => b.count - a.count);
    const maxCount = ranked.length ? ranked[0].count : 1;
    return ranked.map(v => ({ ...v, pct: Math.round(v.count / maxCount * 100) }));
  }, [items]);

  /* G. CSV export */
  function exportCSV() {
    const headers = ["Fecha","N°Cot","Cliente","Descripción","Cant","Costo ARS","PV c/IVA","Markup %","GM %","Moneda","Vendedor","Estado"];
    const rows = filtered.slice(0, 2000).map(i => [
      fmtDate(i.fecha), "#" + i.quoteNum, i.institucion || "",
      i.descr || i.codigo || "", i.cant,
      i.cARS > 0 ? i.cARS.toFixed(2) : "",
      i.pvARSc > 0 ? i.pvARSc.toFixed(2) : "",
      i.mkPct > 0 ? i.mkPct.toFixed(1) : "",
      i.gm > 0 ? i.gm.toFixed(1) : "",
      i.moneda, i.vendedor || "", i.estado || "",
    ]);
    const csv = [headers, ...rows]
      .map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `inteligencia_comercial_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  const hasFilters = search || fDesde || fHasta || fVendedor || fEstado || fMoneda || fPrecioMin || fPrecioMax;
  const showSparkline = searchTokens.length > 0 && filtered.filter(i => i.pvARSc > 0 && i.fecha).length >= 2;

  const TABLE_COLS = [
    { key: "fecha",       label: "Fecha"       },
    { key: "quoteNum",    label: "#Cot."        },
    { key: "institucion", label: "Cliente"      },
    { key: "descr",       label: "Descripción"  },
    { key: "cant",        label: "Cant."        },
    { key: "cARS",        label: "Costo ARS"    },
    { key: "pvARSc",      label: "PV c/IVA"     },
    { key: "mkPct",       label: "Markup %"     },
    { key: "gm",          label: "GM %"         },
    { key: "moneda",      label: "Mon."         },
    { key: "vendedor",    label: "Vendedor"     },
    { key: "estado",      label: "Estado"       },
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
              {/* ── buscador + controles ── */}
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
                {/* B. Vista toggle Individual/Agrupado */}
                <div className="ci-view-toggle">
                  <button
                    type="button"
                    className={`ci-vt-btn${!grouped ? " ci-vt-btn--active" : ""}`}
                    onClick={() => setGrouped(false)}
                  >Individual</button>
                  <button
                    type="button"
                    className={`ci-vt-btn${grouped ? " ci-vt-btn--active" : ""}`}
                    onClick={() => setGrouped(true)}
                  >Agrupado</button>
                </div>
                {/* G. CSV */}
                <button
                  className="ci-csv-btn"
                  type="button"
                  onClick={exportCSV}
                  disabled={!filtered.length}
                  title="Exportar resultados como CSV"
                >
                  ⬇ CSV
                </button>
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
                {/* F. Price range */}
                <input
                  type="number"
                  className="ci-filter ci-filter--price"
                  value={fPrecioMin}
                  onChange={e => setFPrecioMin(e.target.value)}
                  placeholder="Precio mín ARS"
                  min="0"
                />
                <input
                  type="number"
                  className="ci-filter ci-filter--price"
                  value={fPrecioMax}
                  onChange={e => setFPrecioMax(e.target.value)}
                  placeholder="Precio máx ARS"
                  min="0"
                />
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
                    <small>Mediana: {fPct(kpis.medMarkup)}</small>
                    {kpis.mkOutliers > 0 && (
                      <small className="ci-kpi__warn">
                        ⚠ {kpis.mkOutliers} outlier{kpis.mkOutliers > 1 ? "s" : ""} excluido{kpis.mkOutliers > 1 ? "s" : ""}
                      </small>
                    )}
                  </div>
                  <div className="ci-kpi">
                    <span>Gross Margin prom.</span>
                    <strong>{fPct(kpis.avgGM)}</strong>
                    <small>Mediana: {fPct(kpis.medGM)}</small>
                    {kpis.gmOutliers > 0 && (
                      <small className="ci-kpi__warn">
                        ⚠ {kpis.gmOutliers} outlier{kpis.gmOutliers > 1 ? "s" : ""} excluido{kpis.gmOutliers > 1 ? "s" : ""}
                      </small>
                    )}
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
                  {/* C. Sparkline en KPI row */}
                  {showSparkline && (
                    <div className="ci-kpi ci-kpi--spark">
                      <span>Evolución de precio</span>
                      <Sparkline items={filtered} />
                    </div>
                  )}
                </div>
              )}

              {/* ── P2/P3: pipeline + ranking vendedores (fila de dos widgets) ── */}
              {(pipeline || vendorRanking.length > 0) && (
                <div className="ci-widgets-row">

                  {pipeline && (
                    <div className="ci-pipeline ci-widget">
                      <div className="ci-pipeline__header">
                        <span className="ci-pipeline__title">Pipeline de cotizaciones</span>
                        {pipeline.tasaAcept !== null && (
                          <span className="ci-pipeline__rate">
                            Tasa: <strong>{pipeline.tasaAcept}%</strong>
                          </span>
                        )}
                        <span className="ci-pipeline__total">{pipeline.total} cots.</span>
                      </div>
                      <div className="ci-funnel">
                        {FUNNEL_STATES.map(estado => {
                          const count = pipeline.counts[estado];
                          if (!count && estado === "borrador") return null;
                          const pct = Math.round(count / pipeline.maxCount * 100);
                          return (
                            <div key={estado} className="ci-funnel__row">
                              <span className="ci-funnel__label">{ESTADO_LABELS[estado]}</span>
                              <div className="ci-funnel__bar-wrap">
                                <div
                                  className={`ci-funnel__bar ci-funnel__bar--${estado}`}
                                  style={{ width: `${Math.max(pct, count > 0 ? 3 : 0)}%` }}
                                />
                              </div>
                              <span className="ci-funnel__count">{count}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {vendorRanking.length > 0 && (
                    <div className="ci-ranking ci-widget">
                      <div className="ci-pipeline__header">
                        <span className="ci-pipeline__title">Ranking de vendedores</span>
                        <span className="ci-pipeline__total">{vendorRanking.length} vendedores</span>
                      </div>
                      <div className="ci-funnel">
                        {vendorRanking.map(v => (
                          <div key={v.vendedor} className="ci-funnel__row ci-ranking__row">
                            <span className="ci-funnel__label">{v.vendedor.split(" ")[0]}</span>
                            <div className="ci-funnel__bar-wrap">
                              <div
                                className="ci-funnel__bar ci-ranking__bar"
                                style={{ width: `${Math.max(v.pct, 3)}%` }}
                              />
                            </div>
                            <span className="ci-funnel__count">{v.count}</span>
                            <span className="ci-ranking__total">{fARS(v.total)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                </div>
              )}

              {/* ── P2: alertas de mantenimiento ── */}
              {maintenance.length > 0 && (
                <div className="ci-maint">
                  <div className="ci-maint__header">
                    ⚙ Mantenimientos sugeridos
                    <span className="ci-maint__badge">{maintenance.length}</span>
                  </div>
                  <div className="ci-maint__list">
                    {maintenance.slice(0, 6).map(c => (
                      <div key={c.quoteId} className="ci-maint__item">
                        <span className="ci-maint__inst">{c.institucion || "—"}</span>
                        <span className="ci-maint__date">{fmtDate(c.fecha)}</span>
                        <button
                          type="button"
                          className="ci-maint__btn"
                          onClick={() => onOpenQuote(c.quoteId)}
                        >
                          Ver →
                        </button>
                      </div>
                    ))}
                    {maintenance.length > 6 && (
                      <p className="ci-maint__more">+{maintenance.length - 6} más con potencial de mantenimiento</p>
                    )}
                  </div>
                </div>
              )}

              {/* ── tabla ── */}
              {filtered.length === 0 ? (
                <p className="ci-empty">
                  {hasFilters
                    ? "Sin resultados con los filtros actuales. Intentá ampliar la búsqueda."
                    : "No hay ítems en las cotizaciones guardadas."}
                </p>
              ) : grouped ? (
                /* B. Tabla agrupada por producto */
                <div className="ci-table-outer">
                <div className="ci-table-wrap">
                  <table className="ci-table">
                    <thead>
                      <tr>
                        <th className="ci-th-sort">Descripción</th>
                        <th className="ci-th-sort ci-th-c">Cots.</th>
                        <th className="ci-th-sort ci-th-c">Clientes</th>
                        <th className="ci-th-sort ci-th-r">Último precio</th>
                        <th className="ci-th-sort ci-th-r">Mínimo</th>
                        <th className="ci-th-sort ci-th-r">Promedio</th>
                        <th className="ci-th-sort ci-th-r">Máximo</th>
                        <th className="ci-th-sort ci-th-r">Markup prom.</th>
                        {onUseInRenglon && <th className="ci-th-action">Usar</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {groupedData.map((g) => (
                        <tr key={g.key} className="ci-tr">
                          <td className="ci-td-clip ci-td-descr" title={g.descr}>
                            <Highlight text={g.descr} tokens={searchTokens} />
                            {g.empresa && <span className="ci-td-sub">{g.empresa}</span>}
                          </td>
                          <td className="ci-td-c">
                            <span className="ci-count-badge">{g.count}</span>
                          </td>
                          <td className="ci-td-c" style={{ fontSize: 11 }}>
                            {g.clients.length > 0
                              ? <span title={g.clients.join(", ")}>{g.clients.length}</span>
                              : "—"}
                          </td>
                          <td className="ci-td-r ci-td-price">
                            {g.lastPrice > 0 ? fARS(g.lastPrice) : "—"}
                            {g.lastItem?.fecha && <span className="ci-td-sub">{fmtDate(g.lastItem.fecha)}</span>}
                          </td>
                          <td className="ci-td-r">{g.minPrice > 0 ? fARS(g.minPrice) : "—"}</td>
                          <td className="ci-td-r">{g.avgPrice > 0 ? fARS(g.avgPrice) : "—"}</td>
                          <td className="ci-td-r">{g.maxPrice > 0 ? fARS(g.maxPrice) : "—"}</td>
                          <td className="ci-td-r">{g.avgMk > 0 ? fPct(g.avgMk) : "—"}</td>
                          {onUseInRenglon && (
                            <td className="ci-td-action">
                              <button
                                type="button"
                                className="ci-use-btn"
                                onClick={() => onUseInRenglon(g.lastItem)}
                                title={`Usar "${g.descr}" en el renglón activo`}
                              >
                                + Usar
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                </div>
              ) : (
                /* Individual table */
                <div className="ci-table-outer">
                  <div className="ci-table-wrap">
                  <table className="ci-table">
                    <thead>
                      <tr>
                        {TABLE_COLS.map(({ key, label }) => (
                          <th
                            key={key}
                            className={`ci-th-sort${key === "fecha" ? " ci-th-sticky" : ""}`}
                            onClick={() => handleSort(key)}
                          >
                            {label}
                            {sortKey === key ? (sortDir > 0 ? " ↑" : " ↓") : ""}
                          </th>
                        ))}
                        <th className="ci-th-action">Abrir</th>
                        {onUseInRenglon && <th className="ci-th-action">Usar</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.slice(0, 200).map((item, i) => (
                        <tr key={i} className="ci-tr">
                          <td className="ci-td-sticky">{fmtDate(item.fecha)}</td>
                          <td className="ci-td-num">#{item.quoteNum}</td>
                          <td className="ci-td-clip" title={item.institucion}>
                            <Highlight text={item.institucion || "—"} tokens={searchTokens} />
                          </td>
                          <td className="ci-td-clip ci-td-descr" title={item.descr}>
                            <Highlight text={item.descr || item.codigo || "—"} tokens={searchTokens} />
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
                          {/* A. Usar en renglón */}
                          {onUseInRenglon && (
                            <td className="ci-td-action">
                              <button
                                type="button"
                                className="ci-use-btn"
                                onClick={() => onUseInRenglon(item)}
                                title="Copiar descripción al renglón activo"
                              >
                                + Usar
                              </button>
                            </td>
                          )}
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
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ── hook liviano para hint contextual por renglón ──────────────────── */
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
      count:     matches.length,
      lastPrice: byDate[0]?.pvARSc || 0,
      avgPrice:  avg(prices),
      avgGM:     avg(withPrice.map(m => m.gm)),
    };
  }, [cotHistory, descr]);
}
