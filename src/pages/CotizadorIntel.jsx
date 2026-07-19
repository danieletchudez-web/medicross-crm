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

/* Estados de cotización agrupados */
const WON_STATES  = new Set(["aceptada", "ganada", "facturada", "cobrada"]);
const LOST_STATES = new Set(["rechazada", "vencida", "perdida"]);

/* días transcurridos desde una fecha ISO */
function daysSince(fecha) {
  if (!fecha) return 999;
  return Math.max(0, Math.floor((Date.now() - new Date(fecha).getTime()) / 86400000));
}

/* clave de costo: identifica (producto, proveedor, moneda) para comparar costos entre cotizaciones */
function getCostKey(item) {
  const prod = item.codigo ? `c:${norm(item.codigo)}` : `d:${norm(item.descr).slice(0, 50)}`;
  return `${prod}__${norm(item.empresa || "")}__${(item.moneda || "USD")}`;
}

/* clave de conversión: solo producto, sin proveedor */
function getConvKey(item) {
  return item.codigo ? `c:${norm(item.codigo)}` : `d:${norm(item.descr).slice(0, 50)}`;
}

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
    for (const [legacyIndex, r] of (cot.renglones || []).entries()) {
      const calc = calcFlat(r, tcG);
      flat.push({
        quoteId:     cot.id,
        legacyIndex,
        quoteNum:    cot.quote_num_formatted || String(cot.quote_number || "?"),
        fecha,
        institucion: cot.institucion || "",
        vendedor:    cot.vendedor || "",
        estado:      cot.estado || "borrador",
        // Las cotizaciones actuales guardan el proveedor en `empresa`.
        // Conservamos aliases para que también sean buscables registros importados.
        empresa:     r.empresa || r.proveedor || r.supplier || "",
        codigo:      r.codigo  || "",
        marca:       r.marca   || "",
        descr:       r.descr   || "",
        cant:        parseInt(r.cant) || 1,
        moneda:      r.moneda  || "USD",
        costo:       parseN(r.costo),
        rawMarkup:   r.markup  || "2",
        rawIva:      r.iva     || "10.5",
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
function tokenMatch(item, tokens, scope = "all") {
  if (!tokens.length) return true;
  const generalFields = [item.descr, item.codigo, item.marca, item.institucion, item.vendedor, item.quoteNum, item.estado];
  const supplierFields = [item.empresa];
  const fields = scope === "suppliers"
    ? supplierFields
    : scope === "general"
      ? generalFields
      : [...generalFields, ...supplierFields];
  return tokens.every(tok => fields.some(f => norm(f).includes(tok)));
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
export default function CotizadorIntel({ onOpenQuote, onEditQuote, onUseInRenglon }) {
  const [open,       setOpen]       = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [items,      setItems]      = useState(null);
  const [search,     setSearch]     = useState("");
  const [searchScope,setSearchScope]= useState("all");
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
  const [selected,   setSelected]   = useState(new Set()); /* multi-select */
  const [deleting,   setDeleting]   = useState(false);
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
      const legacyItems = expandCotizaciones(data || []);
      // Cuando el flujo colaborativo está disponible, sus costos versionados
      // reemplazan el costo legacy equivalente sin romper instalaciones previas.
      const { data: workflowRows } = await supabase
        .from("quotation_items")
        .select("id,quotation_id,legacy_index,requested_description,quantity,desired_brand,suggested_supplier_name,markup,sale_price_unit,final_price_unit,commercial_status,quotation_item_costs(*),cotizaciones!inner(quote_num_formatted,quote_number,vendedor,institucion,estado,tc,created_at,fecha_apert)")
        .order("created_at", { referencedTable: "quotation_item_costs", ascending: false });
      const replacements = new Map();
      for (const row of (workflowRows || [])) {
        const current = (row.quotation_item_costs || []).find(cost => cost.is_current);
        if (!current) continue;
        const cot = row.cotizaciones;
        const tcG = parseN(cot?.tc) || 1425;
        const costo = parseN(current.total_unit_cost || current.converted_cost || current.unit_cost);
        const raw = {
          empresa: current.supplier_name || row.suggested_supplier_name,
          marca: current.brand || row.desired_brand,
          descr: row.requested_description,
          cant: row.quantity,
          moneda: current.currency || "ARS",
          costo,
          markup: row.markup ? 1 + Number(row.markup) / 100 : 1,
          iva: current.vat_pct || 0,
          modoManual: row.final_price_unit || row.sale_price_unit ? "manual" : "auto",
          pvManual: row.final_price_unit || row.sale_price_unit || "",
        };
        const calc = calcFlat(raw, tcG);
        replacements.set(`${row.quotation_id}:${row.legacy_index}`, {
          quoteId: row.quotation_id, legacyIndex: row.legacy_index,
          quoteNum: cot?.quote_num_formatted || String(cot?.quote_number || "?"),
          fecha: cot?.fecha_apert || cot?.created_at?.slice(0, 10) || "",
          institucion: cot?.institucion || "", vendedor: cot?.vendedor || "",
          estado: row.commercial_status || cot?.estado || "borrador",
          empresa: raw.empresa || "", codigo: current.supplier_code || "",
          marca: raw.marca || "", descr: raw.descr || "", cant: Number(raw.cant) || 1,
          moneda: raw.moneda, costo, rawMarkup: raw.markup, rawIva: raw.iva,
          ...(calc || { cARS: costo, pvARSs: 0, pvARSc: 0, mkPct: 0, gm: 0, subtotal: 0, tc: tcG }),
        });
      }
      const merged = legacyItems.map(item => replacements.get(`${item.quoteId}:${item.legacyIndex}`) || item);
      const legacyKeys = new Set(legacyItems.map(item => `${item.quoteId}:${item.legacyIndex}`));
      replacements.forEach((item, key) => { if (!legacyKeys.has(key)) merged.push(item); });
      setItems(merged.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))));
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
    setSearchScope("all");
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
    if (searchTokens.length) res = res.filter(i => tokenMatch(i, searchTokens, searchScope));
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
  }, [items, searchTokens, searchScope, fDesde, fHasta, fVendedor, fEstado, fMoneda, fPrecioMin, fPrecioMax, sortKey, sortDir]);

  /* ── Multi-select (must be after filtered) ── */
  const visibleIds = useMemo(
    () => [...new Set(filtered.slice(0, 200).map(i => i.quoteId))],
    [filtered]
  );
  const allSelected   = visibleIds.length > 0 && visibleIds.every(id => selected.has(id));
  const someSelected  = visibleIds.some(id => selected.has(id));
  const selectedCount = selected.size;

  function toggleRow(quoteId) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(quoteId) ? next.delete(quoteId) : next.add(quoteId);
      return next;
    });
  }
  function toggleAll() {
    if (allSelected) {
      setSelected(prev => { const n = new Set(prev); visibleIds.forEach(id => n.delete(id)); return n; });
    } else {
      setSelected(prev => { const n = new Set(prev); visibleIds.forEach(id => n.add(id)); return n; });
    }
  }
  function clearSelection() { setSelected(new Set()); }

  async function deleteSelected() {
    const ids = [...selected];
    const quoteNums = [...new Set(
      filtered.filter(i => ids.includes(i.quoteId)).map(i => "#" + i.quoteNum)
    )].join(", ");
    if (!confirm(`¿Eliminar ${ids.length} cotización${ids.length > 1 ? "es" : ""} (${quoteNums})?\nEsta acción moverá las cotizaciones a la papelera.`)) return;
    setDeleting(true);
    try {
      await Promise.all(ids.map(id =>
        supabase.from("cotizaciones").update({ deleted: true, deleted_at: new Date().toISOString() }).eq("id", id)
      ));
      setItems(prev => prev ? prev.filter(i => !ids.includes(i.quoteId)) : prev);
      clearSelection();
    } catch (e) {
      alert("Error al eliminar: " + e.message);
    } finally {
      setDeleting(false);
    }
  }

  function exportSelectedXLSX() {
    exportXLSXFromData(filtered.filter(i => selected.has(i.quoteId)));
  }
  function exportSelectedPrint() {
    exportPrintFromData(filtered.filter(i => selected.has(i.quoteId)));
  }

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

  /* Historial de costos por (producto + proveedor + moneda) — comparación en moneda original */
  const costHistory = useMemo(() => {
    if (!items) return {};
    const map = {};
    items.forEach(i => {
      if (i.costo <= 0 || !i.empresa) return;
      const key = getCostKey(i);
      if (!map[key]) map[key] = { empresa: i.empresa, moneda: i.moneda, entries: [] };
      map[key].entries.push({ fecha: i.fecha, costo: i.costo });
    });
    Object.values(map).forEach(h => {
      h.entries.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
      const costs = h.entries.map(e => e.costo).filter(c => c > 0);
      h.latestCosto  = costs.length ? costs[costs.length - 1] : 0;
      h.latestFecha  = h.entries.length ? h.entries[h.entries.length - 1].fecha : "";
      if (costs.length >= 2) {
        const last = costs[costs.length - 1];
        const prev = costs[costs.length - 2];
        const pct  = prev > 0 ? ((last - prev) / prev) * 100 : 0;
        h.trendPct  = pct;
        h.trend     = Math.abs(pct) < 3 ? "stable" : pct > 0 ? "up" : "down";
      } else {
        h.trend = "unknown"; h.trendPct = 0;
      }
    });
    return map;
  }, [items]);

  /* Tasa de conversión a nivel de ítem individual por producto */
  const convRates = useMemo(() => {
    if (!items) return {};
    const map = {};
    items.forEach(i => {
      const key = getConvKey(i);
      if (!map[key]) map[key] = { won: 0, lost: 0 };
      if (WON_STATES.has(i.estado))  map[key].won++;
      else if (LOST_STATES.has(i.estado)) map[key].lost++;
    });
    const result = {};
    Object.entries(map).forEach(([k, v]) => {
      const total = v.won + v.lost;
      result[k] = total >= 3 ? Math.round((v.won / total) * 100) : null;
    });
    return result;
  }, [items]);

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

  /* G. Exports */
  function exportCSV() {
    const headers = ["Fecha","N°Cot","Cliente","Descripción","Cant","Costo ARS","PV c/IVA","Markup %","GM %","Moneda","Vendedor","Estado"];
    const rows = filtered.slice(0, 5000).map(i => [
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

  async function exportXLSXFromData(data) {
    const XLSX = await import("xlsx");
    const dateStr = new Date().toISOString().slice(0, 10);

    // ── Hoja 1: Detalle completo ──────────────────────────────────────
    const detHeaders = [
      "Fecha","N° Cotización","Cliente / Institución","Descripción","Marca",
      "Empresa / Proveedor","Código","Cantidad","Moneda","Costo Original",
      "Costo ARS","PV s/IVA ARS","PV c/IVA ARS","Markup %","GM %",
      "Subtotal ARS","Vendedor","Estado","TC USD→ARS",
    ];
    const detRows = data.map(i => [
      i.fecha ? new Date(i.fecha + "T00:00:00") : "",
      i.quoteNum || "",
      i.institucion || "",
      i.descr || i.codigo || "",
      i.marca || "",
      i.empresa || "",
      i.codigo || "",
      i.cant || 1,
      i.moneda || "",
      i.costo > 0 ? i.costo : "",
      i.cARS > 0 ? +i.cARS.toFixed(2) : "",
      i.pvARSs > 0 ? +i.pvARSs.toFixed(2) : "",
      i.pvARSc > 0 ? +i.pvARSc.toFixed(2) : "",
      i.mkPct != null ? +i.mkPct.toFixed(2) : "",
      i.gm != null ? +i.gm.toFixed(2) : "",
      i.pvARSc > 0 ? +(i.pvARSc * (i.cant || 1)).toFixed(2) : "",
      i.vendedor || "",
      i.estado || "",
      i.tc > 0 ? i.tc : "",
    ]);
    const wsDet = XLSX.utils.aoa_to_sheet([detHeaders, ...detRows]);
    // date format for column A
    const dateStyle = { numFmt: "dd/mm/yyyy" };
    for (let r = 1; r <= detRows.length; r++) {
      const cell = wsDet[XLSX.utils.encode_cell({ r, c: 0 })];
      if (cell && cell.t === "d") cell.z = "dd/mm/yyyy";
    }
    wsDet["!cols"] = [
      { wch: 11 }, { wch: 13 }, { wch: 36 }, { wch: 40 }, { wch: 20 },
      { wch: 24 }, { wch: 14 }, { wch: 9 }, { wch: 7 }, { wch: 14 },
      { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 8 },
      { wch: 16 }, { wch: 20 }, { wch: 12 }, { wch: 12 },
    ];
    wsDet["!freeze"] = { xSplit: 0, ySplit: 1 };

    // ── Hoja 2: Resumen por Vendedor ──────────────────────────────────
    const vendMap = {};
    for (const i of data) {
      const v = i.vendedor || "(Sin asignar)";
      if (!vendMap[v]) vendMap[v] = { items: 0, cots: new Set(), totalARS: 0, mks: [], gms: [] };
      vendMap[v].items++;
      vendMap[v].cots.add(i.quoteNum);
      if (i.pvARSc > 0) {
        vendMap[v].totalARS += i.pvARSc * (i.cant || 1);
        vendMap[v].mks.push(i.mkPct);
        vendMap[v].gms.push(i.gm);
      }
    }
    const vendHeaders = ["Vendedor","N° Ítems","N° Cotizaciones","Total Vendido ARS","Markup Prom %","GM Prom %"];
    const vendRows = Object.entries(vendMap)
      .sort(([, a], [, b]) => b.totalARS - a.totalARS)
      .map(([v, d]) => [
        v, d.items, d.cots.size,
        +d.totalARS.toFixed(2),
        d.mks.length ? +(d.mks.reduce((s, x) => s + x, 0) / d.mks.length).toFixed(2) : "",
        d.gms.length ? +(d.gms.reduce((s, x) => s + x, 0) / d.gms.length).toFixed(2) : "",
      ]);
    const wsVend = XLSX.utils.aoa_to_sheet([vendHeaders, ...vendRows]);
    wsVend["!cols"] = [{ wch: 22 },{ wch: 12 },{ wch: 16 },{ wch: 18 },{ wch: 14 },{ wch: 10 }];
    wsVend["!freeze"] = { xSplit: 0, ySplit: 1 };

    // ── Hoja 3: Resumen por Cliente ───────────────────────────────────
    const cliMap = {};
    for (const i of data) {
      const c = i.institucion || "(Sin cliente)";
      if (!cliMap[c]) cliMap[c] = { items: 0, cots: new Set(), totalARS: 0 };
      cliMap[c].items++;
      cliMap[c].cots.add(i.quoteNum);
      if (i.pvARSc > 0) cliMap[c].totalARS += i.pvARSc * (i.cant || 1);
    }
    const cliHeaders = ["Cliente / Institución","N° Ítems","N° Cotizaciones","Total Facturado ARS"];
    const cliRows = Object.entries(cliMap)
      .sort(([, a], [, b]) => b.totalARS - a.totalARS)
      .map(([c, d]) => [c, d.items, d.cots.size, +d.totalARS.toFixed(2)]);
    const wsCli = XLSX.utils.aoa_to_sheet([cliHeaders, ...cliRows]);
    wsCli["!cols"] = [{ wch: 44 },{ wch: 12 },{ wch: 16 },{ wch: 20 }];
    wsCli["!freeze"] = { xSplit: 0, ySplit: 1 };

    // ── Armar workbook ────────────────────────────────────────────────
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsDet,  "Detalle");
    XLSX.utils.book_append_sheet(wb, wsVend, "Por Vendedor");
    XLSX.utils.book_append_sheet(wb, wsCli,  "Por Cliente");
    XLSX.writeFile(wb, `inteligencia_comercial_${dateStr}.xlsx`);
  }

  function exportPrintFromData(data) {
    const dateStr = new Date().toLocaleDateString("es-AR", { day:"2-digit", month:"long", year:"numeric" });
    const totalARS = data.reduce((s, i) => s + (i.pvARSc > 0 ? i.pvARSc * (i.cant || 1) : 0), 0);
    const avgMk = (() => { const v = data.filter(i => i.mkPct > 0); return v.length ? v.reduce((s,i)=>s+i.mkPct,0)/v.length : 0; })();
    const avgGM = (() => { const v = data.filter(i => i.gm > 0);   return v.length ? v.reduce((s,i)=>s+i.gm,0)/v.length   : 0; })();
    const fmtN = n => Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const activeFilters = [
      search && `Búsqueda: "${search}"`,
      fVendedor && `Vendedor: ${fVendedor}`,
      fEstado && `Estado: ${fEstado}`,
      fMoneda && `Moneda: ${fMoneda}`,
      fDesde && `Desde: ${fmtDate(fDesde)}`,
      fHasta && `Hasta: ${fmtDate(fHasta)}`,
    ].filter(Boolean).join(" · ");

    const rows = data.map((i, idx) => `
      <tr class="${idx % 2 === 0 ? "even" : "odd"}">
        <td>${fmtDate(i.fecha)}</td>
        <td>#${i.quoteNum}</td>
        <td>${i.institucion || "—"}</td>
        <td class="td-desc">${i.descr || i.codigo || "—"}</td>
        <td>${i.marca || "—"}</td>
        <td class="r">${i.cant || 1}</td>
        <td class="r">${i.moneda}</td>
        <td class="r">${i.cARS > 0 ? "$ " + fmtN(i.cARS) : "—"}</td>
        <td class="r">${i.pvARSc > 0 ? "$ " + fmtN(i.pvARSc) : "—"}</td>
        <td class="r">${i.mkPct > 0 ? i.mkPct.toFixed(1) + "%" : "—"}</td>
        <td class="r">${i.gm > 0 ? i.gm.toFixed(1) + "%" : "—"}</td>
        <td class="r">${i.pvARSc > 0 ? "$ " + fmtN(i.pvARSc * (i.cant||1)) : "—"}</td>
        <td>${i.vendedor || "—"}</td>
        <td class="estado estado-${i.estado}">${i.estado || "—"}</td>
      </tr>`).join("");

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Inteligencia Comercial — ${dateStr}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 9pt; color: #111; background: #fff; padding: 16px; }
  h1 { font-size: 14pt; margin-bottom: 2px; }
  .subtitle { color: #555; font-size: 9pt; margin-bottom: 8px; }
  .kpis { display: flex; gap: 24px; margin-bottom: 10px; padding: 8px 12px; background: #f4f6fb; border-radius: 6px; }
  .kpi { display: flex; flex-direction: column; }
  .kpi span { font-size: 7.5pt; color: #666; text-transform: uppercase; letter-spacing: .04em; }
  .kpi strong { font-size: 11pt; font-weight: 700; }
  .filters { font-size: 8pt; color: #555; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 8pt; }
  thead th { background: #1e3a5f; color: #fff; padding: 5px 6px; text-align: left; white-space: nowrap; font-size: 7.5pt; }
  th.r, td.r { text-align: right; }
  td { padding: 4px 6px; border-bottom: 1px solid #e8ecf0; vertical-align: top; }
  tr.even td { background: #f9fafb; }
  .td-desc { max-width: 200px; word-break: break-word; }
  .estado { font-size: 7pt; font-weight: 600; padding: 1px 5px; border-radius: 10px; white-space: nowrap; }
  .estado-generado { background: #d1fae5; color: #065f46; }
  .estado-borrador { background: #f3f4f6; color: #374151; }
  .estado-enviada  { background: #dbeafe; color: #1d4ed8; }
  .estado-aceptada { background: #d1fae5; color: #047857; }
  .estado-ganada   { background: #d4edda; color: #166534; }
  .estado-vencida  { background: #ffedd5; color: #c2410c; }
  tfoot td { font-weight: 700; background: #eef2f7; padding: 5px 6px; border-top: 2px solid #1e3a5f; }
  @page { size: A4 landscape; margin: 12mm; }
  @media print { body { padding: 0; } }
</style></head><body>
<h1>Inteligencia Comercial de Cotizaciones</h1>
<p class="subtitle">Storing Insumos Médicos · Exportado el ${dateStr} · ${data.length} ítems</p>
${activeFilters ? `<p class="filters">Filtros activos: ${activeFilters}</p>` : ""}
<div class="kpis">
  <div class="kpi"><span>Total ARS</span><strong>$ ${fmtN(totalARS)}</strong></div>
  <div class="kpi"><span>Ítems</span><strong>${data.length}</strong></div>
  <div class="kpi"><span>Markup prom.</span><strong>${avgMk.toFixed(1)}%</strong></div>
  <div class="kpi"><span>GM prom.</span><strong>${avgGM.toFixed(1)}%</strong></div>
</div>
<table>
  <thead><tr>
    <th>Fecha</th><th>#Cot</th><th>Cliente</th><th>Descripción</th><th>Marca</th>
    <th class="r">Cant</th><th class="r">Mon.</th><th class="r">Costo ARS</th>
    <th class="r">PV c/IVA</th><th class="r">Markup%</th><th class="r">GM%</th>
    <th class="r">Subtotal</th><th>Vendedor</th><th>Estado</th>
  </tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr>
    <td colspan="11" style="text-align:right">Total general:</td>
    <td class="r">$ ${fmtN(totalARS)}</td><td colspan="2"></td>
  </tr></tfoot>
</table>
<script>window.onload=()=>window.print();<\/script>
</body></html>`;

    const win = window.open("", "_blank");
    if (!win) { alert("Habilitá las ventanas emergentes para exportar a PDF."); return; }
    win.document.write(html);
    win.document.close();
  }

  const hasFilters = search || fDesde || fHasta || fVendedor || fEstado || fMoneda || fPrecioMin || fPrecioMax;
  const showSparkline = searchTokens.length > 0 && filtered.filter(i => i.pvARSc > 0 && i.fecha).length >= 2;

  const TABLE_COLS = [
    { key: "fecha",       label: "Fecha"       },
    { key: "quoteNum",    label: "#Cot."        },
    { key: "institucion", label: "Cliente"      },
    { key: "descr",       label: "Descripción"  },
    { key: "empresa",     label: "Proveedor"    },
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
                    placeholder={searchScope === "suppliers"
                      ? "Buscar proveedor…"
                      : searchScope === "general"
                        ? "Buscar producto, descripción, código, cliente, vendedor, N° cotización…"
                        : "Buscar producto, proveedor, descripción, código, cliente, vendedor, N° cotización…"}
                    autoComplete="off"
                  />
                  {search && (
                    <button className="ci-search-clear" type="button" onClick={() => setSearch("")}>×</button>
                  )}
                </div>
                <select
                  className="ci-search-scope"
                  value={searchScope}
                  onChange={e => setSearchScope(e.target.value)}
                  aria-label="Elegir dónde buscar"
                  title="Elegir dónde buscar"
                >
                  <option value="all">Buscar en todo</option>
                  <option value="general">Sin proveedores</option>
                  <option value="suppliers">Solo proveedores</option>
                </select>
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
                {/* G. Exports */}
                <button
                  className="ci-csv-btn"
                  type="button"
                  onClick={() => exportXLSXFromData(filtered.slice(0, 5000))}
                  disabled={!filtered.length}
                  title="Exportar a Excel (.xlsx) con 3 hojas: Detalle, Por Vendedor, Por Cliente"
                >
                  ⬇ XLS
                </button>
                <button
                  className="ci-csv-btn"
                  type="button"
                  onClick={() => exportPrintFromData(filtered.slice(0, 5000))}
                  disabled={!filtered.length}
                  title="Exportar a PDF (ventana de impresión)"
                >
                  ⬇ PDF
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
                  <div className="ci-kpi ci-kpi--accent">
                    <span>Resumen</span>
                    <div className="ci-kpi__summary">
                      <div><small>Ítems</small><strong>{kpis.count}</strong></div>
                      <div><small>Último precio</small><strong>{fARS(kpis.lastPrice)}</strong></div>
                    </div>
                    <small>Actualizado {fmtDate(kpis.lastDate)}</small>
                  </div>

                  <div className="ci-kpi ci-kpi--wide">
                    <span>Rango de precios</span>
                    <div className="ci-kpi__metrics ci-kpi__metrics--three">
                      <div><small>Mínimo</small><strong>{fARS(kpis.minPrice)}</strong></div>
                      <div><small>Promedio</small><strong>{fARS(kpis.avgPrice)}</strong></div>
                      <div><small>Máximo</small><strong>{fARS(kpis.maxPrice)}</strong></div>
                    </div>
                  </div>

                  <div className="ci-kpi ci-kpi--wide">
                    <span>Rentabilidad</span>
                    <div className="ci-kpi__metrics">
                      <div><small>Markup prom.</small><strong>{fPct(kpis.avgMarkup)}</strong><small>Mediana {fPct(kpis.medMarkup)}</small></div>
                      <div><small>Gross margin</small><strong>{fPct(kpis.avgGM)}</strong><small>Mediana {fPct(kpis.medGM)}</small></div>
                    </div>
                    {kpis.mkOutliers > 0 && (
                      <small className="ci-kpi__warn">
                        ⚠ {kpis.mkOutliers} outlier{kpis.mkOutliers > 1 ? "s" : ""} de markup excluido{kpis.mkOutliers > 1 ? "s" : ""}
                      </small>
                    )}
                    {kpis.gmOutliers > 0 && (
                      <small className="ci-kpi__warn">
                        ⚠ {kpis.gmOutliers} outlier{kpis.gmOutliers > 1 ? "s" : ""} de margen excluido{kpis.gmOutliers > 1 ? "s" : ""}
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
                    <div className="ci-kpi ci-kpi--clients">
                      <span>Posición por cliente</span>
                      <div><small>Más barato en</small><strong className="ci-kpi__client" title={kpis.cheapest}>{kpis.cheapest}</strong></div>
                      {kpis.mostExp && kpis.mostExp !== kpis.cheapest && (
                        <div><small>Más caro en</small><strong className="ci-kpi__client" title={kpis.mostExp}>{kpis.mostExp}</strong></div>
                      )}
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
                                title={`Copiar "${g.descr}" al renglón activo de la cotización actual`}
                              >
                                Usar producto
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
                        <th className="ci-th-chk">
                          <input
                            type="checkbox"
                            className="ci-chk"
                            checked={allSelected}
                            ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                            onChange={toggleAll}
                            title="Seleccionar todos"
                          />
                        </th>
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
                        <th className="ci-th-action">Ver</th>
                        {onEditQuote && <th className="ci-th-action">Editar</th>}
                        {onUseInRenglon && <th className="ci-th-action">Usar producto</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.slice(0, 200).map((item, i) => {
                        /* ── indicadores por fila ── */
                        const age     = daysSince(item.fecha);
                        const ch      = costHistory[getCostKey(item)];
                        const diffPct = ch && ch.latestCosto > 0 && item.costo > 0
                          ? (item.costo - ch.latestCosto) / ch.latestCosto * 100
                          : null;
                        const costIsStale = diffPct !== null && Math.abs(diffPct) > 5;
                        const conv    = convRates[getConvKey(item)];
                        return (
                        <tr key={i} className={`ci-tr${selected.has(item.quoteId) ? " ci-tr--sel" : ""}`}>
                          <td className="ci-td-chk">
                            <input
                              type="checkbox"
                              className="ci-chk"
                              checked={selected.has(item.quoteId)}
                              onChange={() => toggleRow(item.quoteId)}
                            />
                          </td>
                          {/* Fecha + indicador de antigüedad de precio */}
                          <td className="ci-td-sticky">
                            {fmtDate(item.fecha)}
                            {age > 60
                              ? <span className="ci-age-dot ci-age-dot--alert" title={`Precio de hace ${age} días — posiblemente desactualizado por inflación o tipo de cambio`}>●</span>
                              : age > 30
                              ? <span className="ci-age-dot ci-age-dot--warn"  title={`Precio de hace ${age} días`}>●</span>
                              : null}
                          </td>
                          <td className="ci-td-num">#{item.quoteNum}</td>
                          <td className="ci-td-clip" title={item.institucion}>
                            <Highlight text={item.institucion || "—"} tokens={searchTokens} />
                          </td>
                          {/* Descripción + tasa de conversión histórica del producto */}
                          <td className="ci-td-clip ci-td-descr" title={item.descr}>
                            <Highlight text={item.descr || item.codigo || "—"} tokens={searchTokens} />
                            {conv !== null && conv !== undefined && (
                              <span
                                className={`ci-conv${conv >= 50 ? " ci-conv--good" : conv >= 25 ? " ci-conv--mid" : " ci-conv--low"}`}
                                title={`Conversión histórica de este producto: ${conv}% de los ítems cotizados terminaron en Ganada/Facturada/Cobrada`}
                              >{conv}%</span>
                            )}
                          </td>
                          <td className="ci-td-clip" title={item.empresa}>
                            <Highlight text={item.empresa || "—"} tokens={searchTokens} />
                          </td>
                          <td className="ci-td-r">{item.cant}</td>
                          {/* Costo ARS + tendencia de costo + alerta de cambio de costo */}
                          <td className="ci-td-r">
                            {item.cARS > 0 ? fARS(item.cARS) : "—"}
                            {ch?.trend === "up"   && <span className="ci-cost-trend ci-cost-trend--up"   title={`Costo de ${item.empresa || "este proveedor"} subió ${ch.trendPct.toFixed(1)}% respecto al registro anterior (en ${item.moneda})`}>↑</span>}
                            {ch?.trend === "down" && <span className="ci-cost-trend ci-cost-trend--down" title={`Costo de ${item.empresa || "este proveedor"} bajó ${Math.abs(ch.trendPct).toFixed(1)}% respecto al registro anterior (en ${item.moneda})`}>↓</span>}
                            {costIsStale && (
                              <span className="ci-cost-chg" title={`Este costo (${item.moneda} ${item.costo}) difiere ${diffPct > 0 ? "+" : ""}${diffPct.toFixed(1)}% del costo más reciente de ${item.empresa || "este proveedor"} — verificar antes de usar`}>⚠</span>
                            )}
                          </td>
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
                          {/* Ver — abre preview */}
                          <td className="ci-td-action">
                            <button
                              type="button"
                              className="ci-open-btn"
                              onClick={() => onOpenQuote(item.quoteId)}
                              title="Ver resumen de la cotización"
                            >
                              Ver
                            </button>
                          </td>
                          {/* Editar — carga directo en editor */}
                          {onEditQuote && (
                            <td className="ci-td-action">
                              <button
                                type="button"
                                className="ci-open-btn ci-open-btn--edit"
                                onClick={() => onEditQuote(item.quoteId)}
                                title="Cargar en el editor para modificar"
                              >
                                Editar
                              </button>
                            </td>
                          )}
                          {/* Usar producto — acción primaria */}
                          {onUseInRenglon && (
                            <td className="ci-td-action">
                              <button
                                type="button"
                                className="ci-use-btn"
                                onClick={() => onUseInRenglon(item)}
                                title="Copiar este producto (descripción, código, proveedor) al renglón activo de la cotización actual"
                              >
                                Usar producto
                              </button>
                            </td>
                          )}
                        </tr>
                        );
                      })}
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

      {/* ── Floating selection bar (outside open block so survives panel collapse) ── */}
      {selectedCount > 0 && (
        <div className="ci-sel-bar">
          <span className="ci-sel-bar__count">
            {selectedCount} cotización{selectedCount > 1 ? "es" : ""} seleccionada{selectedCount > 1 ? "s" : ""}
          </span>
          <div className="ci-sel-bar__actions">
            <button
              type="button"
              className="ci-sel-bar__btn ci-sel-bar__btn--xls"
              onClick={exportSelectedXLSX}
              title="Exportar selección a Excel"
            >⬇ XLS</button>
            <button
              type="button"
              className="ci-sel-bar__btn ci-sel-bar__btn--pdf"
              onClick={exportSelectedPrint}
              title="Exportar selección a PDF"
            >⬇ PDF</button>
            <button
              type="button"
              className="ci-sel-bar__btn ci-sel-bar__btn--del"
              onClick={deleteSelected}
              disabled={deleting}
              title="Mover a papelera"
            >{deleting ? "Eliminando…" : "🗑 Eliminar"}</button>
            <button
              type="button"
              className="ci-sel-bar__btn ci-sel-bar__btn--clr"
              onClick={clearSelection}
            >✕ Deseleccionar</button>
          </div>
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
    const prices  = withPrice.map(m => m.pvARSc);
    const byDate  = [...withPrice].sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));
    /* percentiles de markup (en %, filtrados de outliers) para sugerencias */
    const markups  = withPrice.map(m => m.mkPct).filter(m => m > 0 && m < 900);
    const sortedMk = [...markups].sort((a, b) => a - b);
    const sortedPv = [...prices].sort((a, b) => a - b);
    const pAt = (arr, p) => arr.length ? arr[Math.max(0, Math.min(arr.length - 1, Math.floor((arr.length - 1) * p)))] : null;
    return {
      count:      matches.length,
      lastPrice:  byDate[0]?.pvARSc || 0,
      avgPrice:   avg(prices),
      avgGM:      avg(withPrice.map(m => m.gm).filter(g => g > -50 && g < 95)),
      /* sugerencias: markup% convertible a multiplicador = 1 + mkPct/100 */
      p25Markup:  pAt(sortedMk, 0.25),
      medMarkup:  pAt(sortedMk, 0.50),
      p75Markup:  pAt(sortedMk, 0.75),
      p25Price:   pAt(sortedPv, 0.25),
      medPrice:   pAt(sortedPv, 0.50),
      p75Price:   pAt(sortedPv, 0.75),
    };
  }, [cotHistory, descr]);
}
