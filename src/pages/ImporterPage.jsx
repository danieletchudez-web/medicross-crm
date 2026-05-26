import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import Sidebar from "../components/Sidebar";
import "./ImporterPage.css";

/* ── Tooltip ────────────────────────────────────────────────────────── */
function Tooltip({ text }) {
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);

  function show() {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
  }

  function hide() { setPos(null); }

  return (
    <span className="kpi-tooltip-wrap">
      <span
        ref={triggerRef}
        className="kpi-tooltip-trigger"
        onMouseEnter={show}
        onMouseLeave={hide}
        onClick={show}
      >?</span>
      {pos && (
        <span
          className="kpi-tooltip-box"
          style={{ position: "fixed", top: pos.top, right: pos.right, left: "auto" }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

/* ─── Formato financiero argentino ──────────────────────────────────── */
function fmtARS(v) {
  const n = Number(v || 0);
  if (isNaN(n)) return "$ 0,00";
  return new Intl.NumberFormat("es-AR", {
    style: "currency", currency: "ARS",
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n);
}

/* compact — etiquetas claras en español argentino
   MM  = miles de millones (billion)
   M   = millones
   K   = miles
   siempre 1 decimal para MM y M, sin decimal para K
*/
function compact(v) {
  const n = Number(v || 0);
  if (isNaN(n) || !isFinite(n)) return "$ 0";
  const neg = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const f   = (x, d = 1) => x.toFixed(d).replace(".", ",");
  if (abs >= 1_000_000_000_000) return `${neg}$${f(abs / 1_000_000_000_000)} MM`;
  if (abs >= 1_000_000_000)     return `${neg}$${f(abs / 1_000_000_000)} MM`;
  if (abs >= 1_000_000)         return `${neg}$${f(abs / 1_000_000)} M`;
  if (abs >= 1_000)             return `${neg}$${f(abs / 1_000, 0)} K`;
  return fmtARS(n);
}

function safePct(a, b) {
  const na = Number(a || 0), nb = Number(b || 0);
  if (!isFinite(na) || !isFinite(nb) || nb === 0) return 0;
  return Math.round((na / nb) * 100);
}

function parseNum(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return isNaN(v) || !isFinite(v) ? null : v;
  const s = String(v).trim().replace(/\s/g, "").replace(/\$/g, "");
  if (!s || s === "-") return null;
  const hasCommaDecimal = /^\d{1,3}(\.\d{3})*,\d{1,4}$/.test(s);
  const hasDotDecimal   = /^\d{1,3}(,\d{3})*\.\d{1,4}$/.test(s);
  let normalized;
  if (hasCommaDecimal)      normalized = s.replace(/\./g, "").replace(",", ".");
  else if (hasDotDecimal)   normalized = s.replace(/,/g, "");
  else                      normalized = s.replace(/,/g, ".");
  const n = parseFloat(normalized);
  return isNaN(n) || !isFinite(n) ? null : n;
}

function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v === "number") { const d = new Date((v - 25569) * 86400000); return isNaN(d) ? null : d; }
  const s = String(v).trim();
  const p = s.split(new RegExp("[/.-]"));
  if (p.length === 3) {
    const [a, b, c] = p.map(Number);
    if (a <= 31 && b <= 12 && c > 31) return new Date(c, b - 1, a);
    if (a > 31) return new Date(a, b - 1, c);
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

const COL_MAP = {
  fecha:           ["fecha","date","fecha venta","fecha de venta"],
  unidad_negocio:  ["punto venta","punto de venta","sucursal","unidad negocio","bu"],
  comprobante:     ["numero","número","nro","n°","comprobante","factura"],
  condicion_venta: ["tipo","type","tipo de comprobante","condicion","modalidad"],
  provincia:       ["letra","letra comprobante"],
  cliente:         ["cliente","client","razón social","razon social","nombre cliente"],
  vendedor:        ["vendedor","seller","rep","representante"],
  producto:        ["referencia","ref","descripcion","descripción","producto","nombre de proceso"],
  estado:          ["estado","status"],
  observaciones:   ["adjuntos","adjunto","observaciones","notas"],
  total_venta:     ["monto total","total","importe","monto","amount","total neto gravado"],
  costo:           ["costo","cost","precio costo","total neto grabado","neto gravado"],
};

function detectColumns(headers) {
  const mapping = {};
  const hL = headers.map(h => String(h || "").toLowerCase().trim());
  for (const [field, aliases] of Object.entries(COL_MAP)) {
    const idx = hL.findIndex(h => aliases.some(a => h.includes(a)));
    if (idx !== -1) mapping[field] = headers[idx];
  }
  return mapping;
}

function parseRow(raw, mapping) {
  const get = f => { const col = mapping[f]; return col !== undefined ? raw[col] : undefined; };
  const tv = parseNum(get("total_venta")), co = parseNum(get("costo"));
  return {
    fecha:           parseDate(get("fecha")),
    comprobante:     String(get("comprobante") || "").trim() || null,
    cliente:         String(get("cliente") || "").trim() || null,
    cuit:            String(get("cuit") || "").trim() || null,
    provincia:       String(get("provincia") || "").trim() || null,
    vendedor:        String(get("vendedor") || "").trim() || null,
    producto:        String(get("producto") || "").trim() || null,
    codigo_producto: String(get("codigo_producto") || "").trim() || null,
    unidad_negocio:  String(get("unidad_negocio") || "").trim() || null,
    cantidad:        parseNum(get("cantidad")),
    precio_unitario: parseNum(get("precio_unitario")),
    total_venta:     tv, costo: co,
    margen:          (co !== null && tv !== null && tv >= 0 && co >= 0) ? tv - co : null,
    estado:          String(get("estado") || "").trim() || null,
    condicion_venta: String(get("condicion_venta") || "").trim() || null,
    forecast:        parseNum(get("forecast")),
    objetivo:        parseNum(get("objetivo")),
    observaciones:   String(get("observaciones") || "").trim() || null,
  };
}

function validateRow(row, comp) {
  const e = [];
  if (!row.fecha) e.push("Fecha inválida");
  if (!row.cliente) e.push("Cliente vacío");
  if (row.total_venta === null || row.total_venta === undefined) e.push("Monto vacío");
  else if (row.total_venta < 0) e.push("Monto negativo");
  if (row.comprobante && comp.has(row.comprobante)) e.push("Duplicado");
  return e;
}

const PAL  = ["#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#06b6d4","#ec4899","#84cc16","#f97316","#6366f1"];
const EPAL = ["#3b82f6","#10b981","#f59e0b","#8b5cf6","#ef4444","#06b6d4"];

/* Etiqueta de escala para el hero */
function scaleLabel(n) {
  const abs = Math.abs(Number(n || 0));
  if (abs >= 1_000_000_000) return "miles de millones";
  if (abs >= 1_000_000)     return "millones";
  if (abs >= 1_000)         return "miles";
  return "";
}

/* ══════════════════════════════════════════════════════════════════════ */
export default function ImporterPage({ profile, onNavigate }) {
  const [tab,            setTab]            = useState("dashboard");
  const [step,           setStep]           = useState(1);
  const [xlsxData,       setXlsxData]       = useState(null);
  const [mapping,        setMapping]        = useState({});
  const [parsed,         setParsed]         = useState([]);
  const [importing,      setImporting]      = useState(false);
  const [filename,       setFilename]       = useState("");
  const [dragOver,       setDragOver]       = useState(false);
  const [progress,       setProgress]       = useState(0);
  const [forecastMonth,  setForecastMonth]  = useState(String(new Date().getMonth() + 1).padStart(2, "0"));
  const [forecastInputs, setForecastInputs] = useState(() => {
    try { return JSON.parse(localStorage.getItem("bi_forecast_monthly") || "{}"); } catch { return {}; }
  });
  const [sales,          setSales]          = useState(() => { try { const s = localStorage.getItem("bi_cache_sales"); return s ? JSON.parse(s) : []; } catch { return []; } });
  const [imports,        setImports]        = useState(() => { try { const s = localStorage.getItem("bi_cache_imports"); return s ? JSON.parse(s) : []; } catch { return []; } });
  const [loadingBI,      setLoadingBI]      = useState(() => { try { return !localStorage.getItem("bi_cache_sales"); } catch { return true; } });
  const [filterVendedor, setFilterVendedor] = useState("todos");
  const [filterUnidad,   setFilterUnidad]   = useState("todas");
  const [filterMes,      setFilterMes]      = useState("todos");
  const [filterImport,   setFilterImport]   = useState("todos");
  const [chartMode,      setChartMode]      = useState("acumulado");

  const lineRef = useRef(null), ticketRef = useRef(null);
  const lineMonthRef = useRef(null), donutRef = useRef(null);

  const currentYearFcast = useMemo(
    () => Object.values(forecastInputs).reduce((s, v) => s + Number(v || 0), 0),
    [forecastInputs]
  );

  useEffect(() => { loadBI(); }, []);
  useEffect(() => {
    if (!loadingBI && sales.length > 0 && tab === "dashboard") setTimeout(renderCharts, 120);
  }, [loadingBI, sales, filterVendedor, filterUnidad, filterMes, filterImport, tab, chartMode]);

  async function loadBI() {
    setLoadingBI(true);
    const [sRes, iRes] = await Promise.all([
      supabase.from("sales").select("*").order("fecha", { ascending: true }),
      supabase.from("imports").select("*").order("created_at", { ascending: false }),
    ]);
    const salesData = sRes.data || [];
    const importsData = iRes.data || [];
    setSales(salesData);
    setImports(importsData);
    try {
      localStorage.setItem("bi_cache_sales", JSON.stringify(salesData));
      localStorage.setItem("bi_cache_imports", JSON.stringify(importsData));
    } catch { /* cache is optional */ }
    try { const s = localStorage.getItem("bi_forecast_monthly"); if (s) setForecastInputs(JSON.parse(s)); } catch { /* forecast cache is optional */ }
    setLoadingBI(false);
  }

  async function processFile(file) {
    setFilename(file.name);
    const XLSX = window.XLSX;
    if (!XLSX) { alert("SheetJS no cargado. Revisá index.html."); return; }
    const ab = await file.arrayBuffer();
    const wb = XLSX.read(ab, { type: "array", cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rawData = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true });
    if (rawData.length < 2) { alert("Archivo vacío."); return; }
    const headers = rawData[0].map(h => String(h).trim()).filter(Boolean);
    const rows = rawData.slice(1).filter(r => r.some(c => c !== "")).map(r => {
      const o = {}; headers.forEach((h, i) => { o[h] = r[i]; }); return o;
    });
    setXlsxData({ headers, rows });
    setMapping(detectColumns(headers));
    setStep(2);
  }

  async function handleFile(e) { if (e.target.files[0]) processFile(e.target.files[0]); }
  const handleDrop = useCallback(e => {
    e.preventDefault(); setDragOver(false);
    if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]);
  }, []);

  function runValidation() {
    const comp = new Set();
    setParsed(xlsxData.rows.map(raw => {
      const row = parseRow(raw, mapping);
      const errors = validateRow(row, comp);
      if (row.comprobante) comp.add(row.comprobante);
      return { row, errors };
    }));
    setStep(3);
  }

  async function doImport() {
    setImporting(true); setProgress(10);
    const ok = parsed.filter(p => p.errors.length === 0);
    const { data: imp, error } = await supabase.from("imports").insert([{
      owner_id: profile?.id, filename,
      rows_total: parsed.length, rows_ok: ok.length,
      rows_error: parsed.filter(p => p.errors.length > 0).length, status: "completed",
    }]).select().single();
    if (error) { alert("Error: " + error.message); setImporting(false); return; }
    setProgress(30);
    const rows = ok.map(p => ({ ...p.row, import_id: imp.id, fecha: p.row.fecha ? p.row.fecha.toISOString().slice(0, 10) : null }));
    for (let i = 0; i < rows.length; i += 100) {
      await supabase.from("sales").insert(rows.slice(i, i + 100));
      setProgress(30 + Math.round(((i + 100) / rows.length) * 65));
    }
    setProgress(100); setImporting(false); setStep(4); loadBI();
  }

  function saveForecast() {
    const val = forecastInputs[forecastMonth] || "";
    const n = parseFloat(String(val).replace(/\./g, "").replace(",", "."));
    if (!isNaN(n) && isFinite(n) && n >= 0) {
      const next = { ...forecastInputs, [forecastMonth]: n };
      setForecastInputs(next);
      localStorage.setItem("bi_forecast_monthly", JSON.stringify(next));
    }
  }

  const filteredSales = useMemo(() => sales.filter(s => {
    if (filterVendedor !== "todos" && s.vendedor !== filterVendedor) return false;
    if (filterUnidad   !== "todas" && s.unidad_negocio !== filterUnidad) return false;
    if (filterImport   !== "todos" && s.import_id !== filterImport) return false;
    if (filterMes !== "todos") {
      const d = new Date(s.fecha); if (isNaN(d)) return false;
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (k !== filterMes) return false;
    }
    return true;
  }), [sales, filterVendedor, filterUnidad, filterMes, filterImport]);

  const vendedores = useMemo(() => [...new Set(sales.map(s => s.vendedor).filter(Boolean))], [sales]);
  const unidades   = useMemo(() => [...new Set(sales.map(s => s.unidad_negocio).filter(Boolean))], [sales]);
  const meses      = useMemo(() => {
    const set = new Set(sales.map(s => {
      if (!s.fecha) return null;
      const d = new Date(s.fecha); if (isNaN(d)) return null;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    }).filter(Boolean));
    return [...set].sort().reverse();
  }, [sales]);

  const kpis = useMemo(() => {
    const safeN = v => { const n = Number(v); return isFinite(n) ? n : 0; };
    const total = filteredSales.reduce((s, r) => s + safeN(r.total_venta), 0);

    const filasConCosto   = filteredSales.filter(r => r.costo !== null && r.costo !== undefined);
    const hasCosto        = filasConCosto.length > 0;
    const costoTotal      = filasConCosto.reduce((s, r) => s + safeN(r.costo), 0);
    const ventasConCosto  = filasConCosto.reduce((s, r) => s + safeN(r.total_venta), 0);
    const margenTotal     = hasCosto ? ventasConCosto - costoTotal : null;

    const comprobantesUnicos = new Set(filteredSales.map(r => r.comprobante).filter(Boolean)).size;
    const tickets    = comprobantesUnicos || filteredSales.filter(r => safeN(r.total_venta) > 0).length;
    const clientes   = new Set(filteredSales.map(r => r.cliente).filter(Boolean)).size;
    const productos  = new Set(filteredSales.map(r => r.producto).filter(Boolean)).size;
    const avgTicket  = tickets > 0 ? total / tickets : 0;

    const byVend = {}, byUnit = {};
    filteredSales.forEach(r => {
      const v = safeN(r.total_venta);
      if (r.vendedor)       byVend[r.vendedor]       = (byVend[r.vendedor]       || 0) + v;
      if (r.unidad_negocio) byUnit[r.unidad_negocio] = (byUnit[r.unidad_negocio] || 0) + v;
    });
    const mejorVend = Object.entries(byVend).sort((a, b) => b[1] - a[1])[0];
    const mejorUnit = Object.entries(byUnit).sort((a, b) => b[1] - a[1])[0];

    const now      = new Date();
    const nowM     = now.getMonth(), nowY = now.getFullYear();
    const prevM    = nowM === 0 ? 11 : nowM - 1;
    const prevY    = nowM === 0 ? nowY - 1 : nowY;

    const thisMonth = filteredSales
      .filter(s => { const d = new Date(s.fecha); return !isNaN(d) && d.getMonth() === nowM && d.getFullYear() === nowY; })
      .reduce((s, r) => s + safeN(r.total_venta), 0);
    const prevMonth = filteredSales
      .filter(s => { const d = new Date(s.fecha); return !isNaN(d) && d.getMonth() === prevM && d.getFullYear() === prevY; })
      .reduce((s, r) => s + safeN(r.total_venta), 0);

    const momChange = prevMonth > 0 ? ((thisMonth - prevMonth) / prevMonth) * 100 : null;

    const byWeek = {};
    filteredSales.forEach(s => {
      const d = new Date(s.fecha); if (isNaN(d)) return;
      const wk = Math.floor(d.getTime() / (7 * 86400000));
      byWeek[wk] = (byWeek[wk] || 0) + safeN(s.total_venta);
    });
    const sparkData = Object.entries(byWeek).sort((a, b) => Number(a[0]) - Number(b[0])).slice(-8).map(e => e[1]);

    const byMonthObj = {};
    filteredSales.forEach(s => {
      const d = new Date(s.fecha); if (isNaN(d)) return;
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      byMonthObj[k] = (byMonthObj[k] || 0) + safeN(s.total_venta);
    });
    const monthEntries    = Object.entries(byMonthObj);
    const mejorMesEntry   = [...monthEntries].sort((a, b) => b[1] - a[1])[0];
    const mejorMes        = mejorMesEntry ? { mes: mejorMesEntry[0], valor: mejorMesEntry[1] } : null;
    const cantMeses       = monthEntries.length;
    const promedioMensual = cantMeses > 0 ? total / cantMeses : 0;

    const fcastKey  = String(nowM + 1).padStart(2, "0");
    const fcast     = Number(forecastInputs[fcastKey] || 0);
    const fcastPct  = fcast > 0 ? safePct(thisMonth, fcast) : null;

    const pendienteRows  = filteredSales.filter(s => (s.estado || "").toUpperCase().includes("PENDIENTE COBRO"));
    const pendienteCobro = pendienteRows.reduce((s, r) => s + safeN(r.total_venta), 0);
    const pendienteCount = pendienteRows.length;
    const cobrada        = filteredSales.filter(s => (s.estado || "").toUpperCase() === "COBRADA")
                                        .reduce((s, r) => s + safeN(r.total_venta), 0);

    return {
      total, hasCosto, costoTotal, margenTotal, ventasConCosto,
      tickets, clientes, productos, avgTicket,
      mejorVend, mejorUnit, momChange, thisMonth, prevMonth,
      sparkData, fcast, fcastPct,
      mejorMes, cantMeses, promedioMensual,
      pendienteCobro, pendienteCount, cobrada,
    };
  }, [filteredSales, forecastInputs]);

  const topClientes = useMemo(() => {
    const byC = {};
    filteredSales.forEach(s => {
      if (!s.cliente) return;
      const v = Number(s.total_venta); byC[s.cliente] = (byC[s.cliente] || 0) + (isFinite(v) ? v : 0);
    });
    return Object.entries(byC).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [filteredSales]);

  const estadoEntries = useMemo(() => {
    const byE = {};
    filteredSales.forEach(s => { if (s.estado) byE[s.estado] = (byE[s.estado] || 0) + 1; });
    return Object.entries(byE).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [filteredSales]);
  const totalEstado = estadoEntries.reduce((s, [, v]) => s + v, 0);

  const alertas = useMemo(() => {
    const list = [];
    if (kpis.momChange !== null && kpis.momChange < -5)
      list.push({ type: "danger", icon: "📉", title: "Caída de ventas", desc: `Las ventas cayeron ${Math.abs(kpis.momChange).toFixed(1).replace(".", ",")}% vs. el mes anterior.`, val: `${kpis.momChange.toFixed(1).replace(".", ",")}%` });
    if (kpis.fcastPct !== null && kpis.fcastPct < 90)
      list.push({ type: "warning", icon: "⚠", title: "Forecast en riesgo", desc: `Cumplimiento del ${kpis.fcastPct}% del forecast mensual.`, val: `${kpis.fcastPct}%` });
    const sinCompra60 = new Set(filteredSales.filter(s => { const d = new Date(s.fecha); return !isNaN(d) && (new Date() - d) > 60 * 86400000; }).map(s => s.cliente)).size;
    if (sinCompra60 > 0)
      list.push({ type: "info", icon: "👥", title: "Clientes inactivos", desc: `${sinCompra60} clientes sin compras en más de 60 días.`, val: String(sinCompra60) });
    if (kpis.pendienteCount > 0)
      list.push({ type: "warning", icon: "⏳", title: "Facturas pendientes de cobro", desc: `${kpis.pendienteCount} facturas por ${compact(kpis.pendienteCobro)} sin cobrar.`, val: `${safePct(kpis.pendienteCobro, kpis.total)}%` });
    if (list.length === 0)
      list.push({ type: "info", icon: "✓", title: "Sin alertas", desc: "Todos los indicadores dentro de parámetros.", val: "OK" });
    return list;
  }, [kpis, filteredSales]);

  const insights = useMemo(() => {
    const list = [];
    if (kpis.mejorUnit) list.push({
      icon: "🏆",
      parts: ["La unidad ", { strong: kpis.mejorUnit[0] }, ` representa el ${safePct(kpis.mejorUnit[1], kpis.total)}% del total (${compact(kpis.mejorUnit[1])}).`],
    });
    if (kpis.mejorVend) list.push({
      icon: "⭐",
      parts: ["Mejor vendedor: ", { strong: kpis.mejorVend[0] }, ` con ${compact(kpis.mejorVend[1])} facturados.`],
    });
    if (kpis.momChange !== null) list.push({
      icon: kpis.momChange >= 0 ? "📈" : "📉",
      parts: ["Variación mensual: ", { strong: `${kpis.momChange >= 0 ? "+" : ""}${kpis.momChange.toFixed(1).replace(".", ",")}%` }, " vs. mes anterior."],
    });
    if (kpis.mejorMes) list.push({
      icon: "📅",
      parts: ["Mejor mes: ", { strong: kpis.mejorMes.mes }, ` con ${compact(kpis.mejorMes.valor)}.`],
    });
    return list;
  }, [kpis]);

  const biDecisions = useMemo(() => {
    const rows = [];
    rows.push({
      tone: kpis.fcastPct !== null && kpis.fcastPct < 70 ? "danger" : kpis.fcastPct !== null && kpis.fcastPct < 95 ? "warning" : "success",
      title: kpis.fcastPct !== null ? `Forecast ${kpis.fcastPct}%` : "Forecast pendiente",
      text: kpis.fcastPct !== null ? `Mes actual contra forecast: ${compact(kpis.fcast)}.` : "Cargá forecast mensual para medir cobertura.",
    });
    if (kpis.pendienteCount > 0) rows.push({
      tone: "danger",
      title: `${kpis.pendienteCount} pendientes de cobro`,
      text: `${compact(kpis.pendienteCobro)} pendientes. Priorizar seguimiento administrativo.`,
    });
    if (kpis.mejorUnit) rows.push({
      tone: "success",
      title: kpis.mejorUnit[0],
      text: `Unidad líder con ${compact(kpis.mejorUnit[1])} facturados.`,
    });
    if (kpis.momChange !== null) rows.push({
      tone: kpis.momChange >= 0 ? "success" : "warning",
      title: `${kpis.momChange >= 0 ? "+" : ""}${kpis.momChange.toFixed(1).replace(".", ",")}% mensual`,
      text: "Variación contra el mes anterior.",
    });
    return rows.slice(0, 3);
  }, [kpis]);

  function renderCharts() {
    const Chart = window.Chart; if (!Chart) return;
    [lineRef, lineMonthRef, ticketRef, donutRef].forEach(r => { if (r.current?.chartInstance) r.current.chartInstance.destroy(); });
    const byMonth = {};
    filteredSales.forEach(s => {
      if (!s.fecha) return; const d = new Date(s.fecha); if (isNaN(d)) return;
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const v = Number(s.total_venta); byMonth[k] = (byMonth[k] || 0) + (isFinite(v) ? v : 0);
    });
    const mKeys = Object.keys(byMonth).sort();
    let cData = mKeys.map(k => byMonth[k]);
    if (chartMode === "acumulado") { let acc = 0; cData = cData.map(v => { acc += v; return acc; }); }
    const tOpts = { backgroundColor: "#1e293b", bodyColor: "#f1f5f9", titleColor: "#94a3b8", cornerRadius: 8, padding: 10, displayColors: false, callbacks: { label: ctx => ` ${compact(ctx.raw)}` } };
    const sX = { grid: { display: false }, border: { display: false }, ticks: { color: "#94a3b8", font: { size: 10, family: "DM Sans" } } };
    const sY = { beginAtZero: true, border: { display: false }, grid: { color: "#f1f5f9", lineWidth: 1 }, ticks: { color: "#94a3b8", font: { size: 10, family: "DM Sans" }, callback: compact } };

    if (lineRef.current && mKeys.length > 0) {
      const ctx = lineRef.current.getContext("2d");
      const grad = ctx.createLinearGradient(0, 0, 0, 240);
      grad.addColorStop(0, "rgba(59,130,246,0.18)"); grad.addColorStop(1, "rgba(59,130,246,0)");
      lineRef.current.chartInstance = new Chart(lineRef.current, {
        type: "line",
        data: { labels: mKeys, datasets: [{ data: cData, borderColor: "#3b82f6", backgroundColor: grad, fill: true, tension: 0.3, pointRadius: 4, pointBackgroundColor: "#3b82f6", pointBorderColor: "#fff", pointBorderWidth: 2 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: tOpts }, scales: { x: sX, y: sY } },
      });
    }
    if (lineMonthRef.current && mKeys.length > 0) {
      const monthlyData = mKeys.map(k => byMonth[k]);
      const maxVal = Math.max(...monthlyData, 1);
      lineMonthRef.current.chartInstance = new Chart(lineMonthRef.current, {
        type: "bar",
        data: {
          labels: mKeys,
          datasets: [{
            label: "Ventas mensuales",
            data: monthlyData,
            backgroundColor: monthlyData.map(v => (v/maxVal)>=0.8?"rgba(16,185,129,0.7)":(v/maxVal)>=0.5?"rgba(59,130,246,0.6)":"rgba(59,130,246,0.25)"),
            borderColor: monthlyData.map(v => (v/maxVal)>=0.8?"#10b981":"#3b82f6"),
            borderWidth: 1.5, borderRadius: 6, borderSkipped: false,
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend:{display:false}, tooltip:{...tOpts,callbacks:{label:ctx=>" "+compact(ctx.raw)}} },
          scales: { x:{...sX,ticks:{...sX.ticks,maxRotation:45,minRotation:0}}, y:sY }
        }
      });
    }
    const byMonthTicket = {};
    filteredSales.forEach(s => {
      if (!s.fecha) return;
      const d = new Date(s.fecha); if (isNaN(d)) return;
      const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
      if (!byMonthTicket[k]) byMonthTicket[k] = { total:0, comps: new Set(), count:0 };
      const v = isFinite(Number(s.total_venta)) ? Number(s.total_venta) : 0;
      byMonthTicket[k].total += v;
      if (s.comprobante) byMonthTicket[k].comps.add(s.comprobante);
      else byMonthTicket[k].count += 1;
    });
    const tKeys = Object.keys(byMonthTicket).sort();
    const ticketData = tKeys.map(k => {
      const { total, comps, count } = byMonthTicket[k];
      const n = comps.size + count;
      return n > 0 ? total / n : 0;
    });
    if (ticketRef.current && tKeys.length > 0) {
      ticketRef.current.chartInstance = new Chart(ticketRef.current, {
        type: "bar",
        data: {
          labels: tKeys,
          datasets: [{ label:"Ticket promedio", data:ticketData, backgroundColor:"rgba(99,102,241,0.25)", borderColor:"#6366f1", borderWidth:1.5, borderRadius:6, borderSkipped:false }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend:{display:false}, tooltip:{...tOpts,callbacks:{label:ctx=>" "+compact(ctx.raw)}} },
          scales: { x:{...sX,ticks:{...sX.ticks,maxRotation:45,minRotation:0}}, y:{...sY,ticks:{...sY.ticks,callback:compact}} }
        }
      });
    }
    if (donutRef.current && estadoEntries.length > 0) {
      donutRef.current.chartInstance = new Chart(donutRef.current, {
        type: "doughnut",
        data: { labels: estadoEntries.map(e => e[0]), datasets: [{ data: estadoEntries.map(e => e[1]), backgroundColor: EPAL.slice(0, estadoEntries.length), borderWidth: 0, hoverOffset: 5 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: "68%", plugins: { legend: { display: false }, tooltip: { backgroundColor: "#1e293b", bodyColor: "#f1f5f9", titleColor: "#94a3b8", cornerRadius: 8, padding: 10 } } },
      });
    }
  }

  async function deleteImport(id) { if (!confirm("¿Eliminar esta importación?")) return; await supabase.from("imports").delete().eq("id", id); loadBI(); }

  const okRows     = parsed.filter(p => p.errors.length === 0);
  const errRows    = parsed.filter(p => p.errors.length > 0);
  const lastImport = imports[0];

  return (
    <div className="bi-shell">
      <Sidebar profile={profile} onNavigate={onNavigate}/>
      <div className="bi-main">

        {/* HEADER */}
        <header className="bi-header">
          <div className="bi-header__left">
            <div className="bi-header__tabs">
              {[
                { k: "dashboard", l: "Dashboard BI" },
                ...( ["super_admin","manager"].includes(profile?.role) ? [
                  { k: "import",  l: "📥 Importar Excel" },
                  { k: "history", l: "📋 Historial"      },
                ] : [] ),
              ].map(t => (
                <button key={t.k} className={`bi-header__tab ${tab === t.k ? "active" : ""}`} onClick={() => setTab(t.k)}>{t.l}</button>
              ))}
            </div>
          </div>
          <div className="bi-header__right">
            {lastImport && (
              <span className="bi-header__sync">
                <span className="bi-sync-dot"/>
                Última importación: {new Date(lastImport.created_at).toLocaleDateString("es-AR")} {new Date(lastImport.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                <span style={{ color: "#10b981", marginLeft: 4 }}>☁</span>
              </span>
            )}
            <div className="bi-header__avatar">{(profile?.full_name || "U").slice(0, 1).toUpperCase()}</div>
          </div>
        </header>

        <div className="bi-content">
          {tab === "dashboard" && (
            <>
              {loadingBI ? (
                <div className="bi-loading"><div className="bi-spinner"/><span>Cargando…</span></div>
              ) : sales.length === 0 ? (
                <div className="bi-empty-full">
                  <div style={{ fontSize: 44, marginBottom: 10 }}>📊</div>
                  <h3>Sin datos importados</h3>
                  <p>Importá un archivo Excel para ver el dashboard.</p>
                  <button className="bi-btn bi-btn--primary" onClick={() => setTab("import")}>Importar →</button>
                </div>
              ) : (
                <>
                  {/* HERO — formato numérico mejorado */}
                  <div className="bi-hero">
                    {/* Bloque principal */}
                    <div className="bi-hero__block bi-hero__block--main">
                      <span className="bi-hero__eyebrow">TOTAL VENTAS ACUMULADAS</span>
                      <strong className="bi-hero__big">{compact(kpis.total)}</strong>
                      <span className="bi-hero__scale">{scaleLabel(kpis.total)} de pesos</span>
                      <span className="bi-hero__sub">{fmtARS(kpis.total)}</span>
                      {kpis.momChange !== null && (
                        <span className={`bi-hero__badge ${kpis.momChange >= 0 ? "up" : "down"}`}>
                          {kpis.momChange >= 0 ? "▲" : "▼"} {Math.abs(kpis.momChange).toFixed(1).replace(".", ",")}% vs. mes anterior
                        </span>
                      )}
                    </div>

                    <div className="bi-hero__sep"/>
                    <div className="bi-hero__block">
                      <span className="bi-hero__eyebrow">FACTURADO MES ACTUAL</span>
                      <strong className="bi-hero__val">{compact(kpis.thisMonth)}</strong>
                      <span className="bi-hero__scale">{scaleLabel(kpis.thisMonth)}</span>
                      <span className="bi-hero__meta">
                        {kpis.momChange !== null
                          ? `${kpis.momChange >= 0 ? "▲" : "▼"} ${Math.abs(kpis.momChange).toFixed(1).replace(".",",")}% vs. mes ant.`
                          : "—"}
                      </span>
                    </div>

                    <div className="bi-hero__sep"/>

                    {/* Mejor mes */}
                    <div className="bi-hero__block">
                      <span className="bi-hero__eyebrow">MEJOR MES</span>
                      <strong className="bi-hero__val">{compact(kpis.mejorMes?.valor || 0)}</strong>
                      <span className="bi-hero__scale">{scaleLabel(kpis.mejorMes?.valor || 0)}</span>
                      <span className="bi-hero__meta">{kpis.mejorMes?.mes || "—"}</span>
                    </div>

                    <div className="bi-hero__sep"/>

                    {/* Promedio mensual */}
                    <div className="bi-hero__block">
                      <span className="bi-hero__eyebrow">PROMEDIO MENSUAL</span>
                      <strong className="bi-hero__val">{compact(kpis.promedioMensual || 0)}</strong>
                      <span className="bi-hero__scale">{scaleLabel(kpis.promedioMensual || 0)}</span>
                      <span className="bi-hero__meta">{kpis.cantMeses || 0} meses con datos</span>
                    </div>


                    <div className="bi-hero__sep"/>

                    {/* Forecast */}
                    <div className="bi-hero__block">
                      <span className="bi-hero__eyebrow">MES ACTUAL VS. FORECAST</span>
                      <strong className="bi-hero__val">{kpis.fcastPct !== null ? `${kpis.fcastPct}%` : "—"}</strong>
                      {kpis.fcast > 0 && (
                        <>
                          <span className="bi-hero__meta">Forecast: {compact(kpis.fcast)}</span>
                          <div className="bi-hero__bar">
                            <div style={{ width: `${Math.min(100, kpis.fcastPct || 0)}%`, height: "100%", background: "#f59e0b", borderRadius: 999 }}/>
                          </div>

                        </>
                      )}
                    </div>

                    <div className="bi-hero__sep"/>

                    {/* Stats rápidos */}
                    <div className="bi-hero__stats">
                      <div className="bi-hero__stat"><strong>{kpis.tickets}</strong><span>FACTURAS</span></div>
                      <div className="bi-hero__stat"><strong>{kpis.clientes}</strong><span>CLIENTES</span></div>
                      <div className="bi-hero__stat">
                        <strong>{compact(kpis.avgTicket)}</strong>
                        <span style={{ fontSize: 7 }}>{scaleLabel(kpis.avgTicket).toUpperCase()}</span>
                        <span>TICKET PROM.</span>
                      </div>
                      <div className="bi-hero__stat"><strong>{kpis.productos}</strong><span>PRODUCTOS</span></div>
                    </div>
                  </div>

                  <section className="bi-decisions">
                    <div className="bi-decisions__head">
                      <span>Decisiones de BI</span>
                      <strong>Lectura ejecutiva</strong>
                    </div>
                    {biDecisions.map((item, index) => (
                      <article key={`${item.title}-${index}`} className={`bi-decision bi-decision--${item.tone}`}>
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <div>
                          <strong>{item.title}</strong>
                          <p>{item.text}</p>
                        </div>
                      </article>
                    ))}
                  </section>

                  {/* Filtros */}
                  <div className="bi-filters bi-filters--compact">
                    <FilterGroup label="Período" value={filterMes} onChange={setFilterMes}>
                      <option value="todos">Todo el período</option>
                      {meses.map(m => <option key={m} value={m}>{m}</option>)}
                    </FilterGroup>
                    <FilterGroup label="Vendedores" value={filterVendedor} onChange={setFilterVendedor}>
                      <option value="todos">Todos los vendedores</option>
                      {vendedores.map(v => <option key={v} value={v}>{v}</option>)}
                    </FilterGroup>
                    <FilterGroup label="Unidades" value={filterUnidad} onChange={setFilterUnidad}>
                      <option value="todas">Todas las unidades</option>
                      {unidades.map(u => <option key={u} value={u}>{u}</option>)}
                    </FilterGroup>
                    <FilterGroup label="Importación" value={filterImport} onChange={setFilterImport}>
                      <option value="todos">Todas</option>
                      {imports.map(i => <option key={i.id} value={i.id}>{i.filename}</option>)}
                    </FilterGroup>
                  </div>

                  {/* KPI CARDS */}
                  <div className="bi-kpi-row">
                    <div className="bi-kpi bi-kpi--wide">
                      <div className="bi-kpi__head">
                        <span className="bi-kpi__icon" style={{ background: "rgba(245,158,11,.1)" }}>🏆</span>
                        <span className="bi-kpi__label">TOP 5 CLIENTES</span>
                      </div>
                      <div className="bi-top3">
                        {Object.entries(
                          filteredSales.reduce((acc, s) => {
                            if (!s.cliente) return acc;
                            const v = Number(s.total_venta);
                            acc[s.cliente] = (acc[s.cliente] || 0) + (isFinite(v) ? v : 0);
                            return acc;
                          }, {})
                        ).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([nombre, total], i) => (
                          <div key={nombre} className="bi-top3__row">
                            <span className="bi-top3__pos" style={{ color: ["#f59e0b","#94a3b8","#cd7c3a","#64748b","#64748b"][i] }}>#{i+1}</span>
                            <span className="bi-top3__name" title={nombre}>{nombre}</span>
                            <span className="bi-top3__val">{compact(total)}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="bi-kpi">
                      <div className="bi-kpi__head">
                        <span className="bi-kpi__icon" style={{ background: "rgba(59,130,246,.1)" }}>🎯</span>
                        <span className="bi-kpi__label">TICKET PROMEDIO</span>
                      </div>
                      <strong className="bi-kpi__val" style={{ color: "#3b82f6" }}>{compact(kpis.avgTicket)}</strong>
                      <span className="bi-kpi__sub">{kpis.tickets} facturas únicas</span>
                      <div className="bi-kpi__divider"/>
                      <div className="bi-kpi__stat-row">
                        <div className="bi-kpi__stat"><span>Clientes</span><strong>{kpis.clientes}</strong></div>
                        <div className="bi-kpi__stat"><span>Productos</span><strong>{kpis.productos}</strong></div>
                        <div className="bi-kpi__stat"><span>Meses</span><strong>{kpis.cantMeses}</strong></div>
                      </div>
                    </div>

                    <div className="bi-kpi">
                      <div className="bi-kpi__head">
                        <span className="bi-kpi__icon" style={{ background: "rgba(239,68,68,.1)" }}>⏳</span>
                        <span className="bi-kpi__label">PENDIENTE DE COBRO</span>
                      </div>
                      <strong className="bi-kpi__val" style={{ color: "#ef4444" }}>{compact(kpis.pendienteCobro)}</strong>
                      <span className="bi-kpi__sub">{kpis.pendienteCount} facturas · {safePct(kpis.pendienteCobro, kpis.total)}% del total</span>
                      <div className="bi-kpi__divider"/>
                      <div className="bi-kpi__bar-label"><span>Cobrado</span><span>{compact(kpis.cobrada)}</span></div>
                      <div style={{ height: 5, background: "#f1f5f9", borderRadius: 999, overflow: "hidden" }}>
                        <div style={{ width: `${Math.min(100, safePct(kpis.cobrada, kpis.total))}%`, height: "100%", background: "#10b981", borderRadius: 999 }}/>
                      </div>
                      <div className="bi-kpi__bar-label" style={{ marginTop: 3 }}>
                        <span>Pendiente</span><span style={{ color: "#ef4444" }}>{safePct(kpis.pendienteCobro, kpis.total)}%</span>
                      </div>
                      <div style={{ height: 5, background: "#f1f5f9", borderRadius: 999, overflow: "hidden" }}>
                        <div style={{ width: `${Math.min(100, safePct(kpis.pendienteCobro, kpis.total))}%`, height: "100%", background: "#ef4444", borderRadius: 999 }}/>
                      </div>
                    </div>

                    <div className="bi-kpi bi-kpi--forecast">
                      <div className="bi-kpi__head">
                        <span className="bi-kpi__icon" style={{ background: "rgba(99,102,241,.1)" }}>📋</span>
                        <span className="bi-kpi__label">FORECAST MENSUAL</span>
                      </div>
                      <div className="bi-forecast-row">
                        <select className="bi-forecast-select" value={forecastMonth} onChange={e => setForecastMonth(e.target.value)}>
                          {["01","02","03","04","05","06","07","08","09","10","11","12"].map(m => {
                            const labels = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
                            return <option key={m} value={m}>{labels[Number(m) - 1]}{forecastInputs[m] ? " ✓" : ""}</option>;
                          })}
                        </select>
                      </div>
                      {/* Solo super_admin puede editar el forecast */}
                      {profile?.role === "super_admin" && (
                        <div className="bi-forecast-row" style={{ marginTop: 4 }}>
                          <input
                            className="bi-forecast-input"
                            value={forecastInputs[forecastMonth] || ""}
                            onChange={e => setForecastInputs(prev => ({ ...prev, [forecastMonth]: e.target.value }))}
                            placeholder="Ej: 3400000000"
                            onKeyDown={e => e.key === "Enter" && saveForecast()}
                          />
                          <button className="bi-forecast-save" onClick={saveForecast}>Guardar</button>
                        </div>
                      )}
                      {forecastInputs[forecastMonth] ? (
                        <>
                          <div className="bi-kpi__divider"/>
                          <div className="bi-kpi__bar-label">
                            <span>Forecast</span>
                            <span style={{ color: "#6366f1" }}>{compact(Number(forecastInputs[forecastMonth]))}</span>
                          </div>
                          <div style={{ height: 5, background: "#f1f5f9", borderRadius: 999, overflow: "hidden" }}>
                            <div style={{ width: `${Math.min(100, kpis.fcastPct || 0)}%`, height: "100%", background: "#6366f1", borderRadius: 999 }}/>
                          </div>
                          <span className="bi-kpi__sub" style={{ color: "#6366f1" }}>{kpis.fcastPct || 0}% cumplido</span>
                        </>
                      ) : (
                        <span className="bi-kpi__sub" style={{ color: "#94a3b8" }}>
                          {profile?.role === "super_admin" ? "Ingresá el forecast para este mes" : "Sin forecast cargado"}
                        </span>
                      )}
                      {currentYearFcast > 0 && <span className="bi-kpi__sub" style={{ color: "#94a3b8", fontSize: 10 }}>Total anual: {compact(currentYearFcast)}</span>}
                    </div>
                  </div>

                  {/* CHARTS ROW 1 */}
                  <div className="bi-row bi-row--70-30">
                    <div className="bi-panel">
                      <div className="bi-panel__hd">
                        <div><h3>Evolución de ventas</h3><p>Tendencia mensual</p></div>
                        <div className="bi-toggle">
                          {["acumulado","mensual"].map(m => (
                            <button key={m} className={chartMode === m ? "active" : ""} onClick={() => setChartMode(m)}>
                              {m.charAt(0).toUpperCase() + m.slice(1)}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div style={{ height: 220, padding: "10px 14px 8px" }}><canvas ref={lineRef}/></div>
                    </div>
                    <div className="bi-panel">
                      <div className="bi-panel__hd"><div><h3>Ventas por estado</h3><p>Distribución de registros</p></div></div>
                      <div className="bi-donut-layout">
                        <div style={{ width: 130, height: 130, flexShrink: 0 }}><canvas ref={donutRef}/></div>
                        <div className="bi-donut-legend">
                          {estadoEntries.map(([e, c], i) => (
                            <div key={e} className="bi-legend-row">
                              <span className="bi-legend-dot" style={{ background: EPAL[i] }}/>
                              <span className="bi-legend-label">{e.toUpperCase()}</span>
                              <span className="bi-legend-pct">{safePct(c, totalEstado)}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* CHARTS ROW 2 */}
                  <div className="bi-row bi-row--50-50">
                    <div className="bi-panel">
                      <div className="bi-panel__hd">
                        <div><h3>Ventas mensuales</h3><p>Volumen por mes — color según performance</p></div>
                        <Tooltip text="Barras por mes con color según performance: verde = mejor mes, azul = normal, azul claro = bajo. Detectá estacionalidad y tendencia de crecimiento."/>
                      </div>
                      <div style={{ height: 240, padding: "10px 14px 14px" }}><canvas ref={lineMonthRef}/></div>
                    </div>
                    <div className="bi-panel">
                      <div className="bi-panel__hd">
                        <div><h3>Ticket promedio por mes</h3><p>Valor promedio por comprobante</p></div>
                        <Tooltip text="Monto promedio por factura cada mes. Si sube, tus operaciones son más grandes. Si baja, puede indicar más clientes chicos o descuentos. Calculado sobre comprobantes únicos."/>
                      </div>
                      <div style={{ height: 240, padding: "10px 14px 14px" }}><canvas ref={ticketRef}/></div>
                    </div>
                  </div>

                  {/* BOTTOM ROW */}
                  <div className="bi-row bi-row--33-33-33">
                    <div className="bi-panel">
                      <div className="bi-panel__hd">
                        <div><h3>Ranking de clientes</h3><p>Top clientes por volumen facturado</p></div>
                        <span className="bi-badge">{topClientes.length} clientes</span>
                      </div>
                      <div className="bi-ranking">
                        {topClientes.map(([cliente, total], i) => {
                          const maxV = topClientes[0]?.[1] || 1;
                          return (
                            <div key={cliente} className="bi-rank-row">
                              <span className="bi-rank-num" style={{ color: i < 3 ? PAL[i] : "#94a3b8" }}>#{i+1}</span>
                              <div className="bi-rank-mid">
                                <span className="bi-rank-name" title={cliente}>{cliente}</span>
                                <div className="bi-rank-bar-bg"><div className="bi-rank-bar-fill" style={{ width: `${safePct(total, maxV)}%`, background: PAL[i % PAL.length] }}/></div>
                              </div>
                              <span className="bi-rank-val">{compact(total)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="bi-panel">
                      <div className="bi-panel__hd"><div><h3>Alertas inteligentes</h3></div></div>
                      <div className="bi-alertas">
                        {alertas.map((a, i) => (
                          <div key={i} className={`bi-alerta bi-alerta--${a.type}`}>
                            <span className="bi-alerta__ico">{a.icon}</span>
                            <div className="bi-alerta__body"><strong>{a.title}</strong><p>{a.desc}</p></div>
                            <span className={`bi-alerta__val ${a.type}`}>{a.val}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="bi-panel">
                      <div className="bi-panel__hd"><div><h3>Insights automáticos</h3><p>Calculados con datos reales</p></div></div>
                      <div className="bi-insights">
                        {insights.map((ins, i) => (
                          <div key={i} className="bi-insight">
                            <span className="bi-insight__ico">{ins.icon}</span>
                            <p>
                              {ins.parts.map((part, idx) => (
                                typeof part === "string"
                                  ? <span key={idx}>{part}</span>
                                  : <strong key={idx}>{part.strong}</strong>
                              ))}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* ÚLTIMAS IMPORTACIONES */}
                  <div className="bi-panel">
                    <div className="bi-panel__hd">
                      <div><h3>Últimas importaciones</h3></div>
                      {["super_admin","manager"].includes(profile?.role) && (
                        <button className="bi-link" onClick={() => setTab("history")}>Ver historial →</button>
                      )}
                    </div>
                    <div className="bi-tbl-wrap">
                      <table className="bi-tbl">
                        <thead><tr><th>Fecha</th><th>Archivo</th><th>Filas procesadas</th><th>Estado</th><th>Errores</th></tr></thead>
                        <tbody>
                          {imports.slice(0, 4).map(imp => (
                            <tr key={imp.id}>
                              <td>{new Date(imp.created_at).toLocaleDateString("es-AR")} {new Date(imp.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</td>
                              <td><strong>{imp.filename}</strong></td>
                              <td>{imp.rows_ok.toLocaleString("es-AR")} filas</td>
                              <td><span className={`bi-status ${imp.rows_error > 0 ? "warn" : "ok"}`}>{imp.rows_error > 0 ? "Advertencias" : "Exitoso"}</span></td>
                              <td className={imp.rows_error > 0 ? "c-red" : "c-green"}>{imp.rows_error}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* IMPORTAR — solo manager y super_admin */}
          {tab === "import" && ["super_admin","manager"].includes(profile?.role) && (
            <div className="bi-import">
              <div className="bi-stepper">
                {["Subir archivo","Mapear columnas","Validar","Completado"].map((label, i) => (
                  <div key={i} className={`bi-step ${step > i+1 ? "done" : step === i+1 ? "active" : ""}`}>
                    <div className="bi-step__n">{step > i+1 ? "✓" : i+1}</div>
                    <span>{label}</span>
                    {i < 3 && <div className="bi-step__line"/>}
                  </div>
                ))}
              </div>

              {step === 1 && (
                <div className={`bi-drop ${dragOver ? "over" : ""}`} onDrop={handleDrop} onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}>
                  <div style={{ fontSize: 44, marginBottom: 10 }}>📂</div>
                  <h3>Arrastrá tu archivo Excel aquí</h3>
                  <p>O hacé click para seleccionar · .xlsx, .xls, .csv</p>
                  <label className="bi-btn bi-btn--primary">Seleccionar archivo<input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} style={{ display: "none" }}/></label>
                  <p className="bi-drop__hint">Las columnas se detectan automáticamente.</p>
                </div>
              )}

              {step === 2 && xlsxData && (
                <div className="bi-panel" style={{ padding: 22 }}>
                  <div className="bi-panel__hd"><div><h3>Mapear columnas</h3><p>Verificá el mapeo automático.</p></div><span className="bi-badge bi-badge--blue">{xlsxData.headers.length} columnas</span></div>
                  <div className="bi-map-grid">
                    {Object.keys(COL_MAP).map(field => (
                      <div key={field} className={`bi-map-row ${mapping[field] ? "mapped" : ""}`}>
                        <span className="bi-map-lbl">{field.replace(/_/g, " ")}</span>
                        <select value={mapping[field] || ""} onChange={e => setMapping({ ...mapping, [field]: e.target.value || undefined })}>
                          <option value="">— No usar —</option>
                          {xlsxData.headers.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                        {mapping[field] && <span style={{ color: "#10b981", fontWeight: 800, fontSize: 12 }}>✓</span>}
                      </div>
                    ))}
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <p style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: .5, color: "#94a3b8", marginBottom: 8 }}>Previsualización — 5 primeras filas</p>
                    <div className="bi-tbl-wrap"><table className="bi-tbl"><thead><tr>{xlsxData.headers.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{xlsxData.rows.slice(0, 5).map((r, i) => <tr key={i}>{xlsxData.headers.map(h => <td key={h}>{String(r[h] || "—")}</td>)}</tr>)}</tbody></table></div>
                  </div>
                  <div className="bi-actions"><button className="bi-btn bi-btn--ghost" onClick={() => setStep(1)}>← Volver</button><button className="bi-btn bi-btn--primary" onClick={runValidation}>Validar →</button></div>
                </div>
              )}

              {step === 3 && (
                <div className="bi-panel" style={{ padding: 22 }}>
                  <div className="bi-panel__hd"><div><h3>Resultado de validación</h3></div><div style={{ display: "flex", gap: 8 }}><span className="bi-badge bi-badge--green">✓ {okRows.length}</span>{errRows.length > 0 && <span className="bi-badge bi-badge--red">✕ {errRows.length}</span>}</div></div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                    <div style={{ flex: 1, height: 7, background: "#f1f5f9", borderRadius: 999, overflow: "hidden" }}><div style={{ width: `${safePct(okRows.length, parsed.length)}%`, height: "100%", background: "#10b981", borderRadius: 999 }}/></div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#10b981" }}>{safePct(okRows.length, parsed.length)}%</span>
                  </div>
                  {errRows.length > 0 && <div style={{ marginBottom: 14 }}><p style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: .5, color: "#dc2626", marginBottom: 8 }}>Filas con errores</p>{errRows.slice(0, 12).map((p, i) => <div key={i} style={{ display: "flex", gap: 10, padding: "7px 10px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 7, marginBottom: 3, fontSize: 12 }}><span style={{ fontWeight: 800, color: "#dc2626", minWidth: 28 }}>F{parsed.indexOf(p) + 2}</span><span style={{ flex: 1, fontWeight: 600, color: "#0f172a" }}>{p.row.cliente || "—"}</span><span style={{ color: "#dc2626", fontSize: 11 }}>{p.errors.join(" · ")}</span></div>)}{errRows.length > 12 && <p style={{ fontSize: 11, color: "#94a3b8" }}>+{errRows.length - 12} más</p>}</div>}
                  {importing && <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}><div style={{ flex: 1, height: 7, background: "#f1f5f9", borderRadius: 999, overflow: "hidden" }}><div style={{ width: `${progress}%`, height: "100%", background: "linear-gradient(90deg,#6366f1,#3b82f6)", borderRadius: 999, transition: "width .3s" }}/></div><span style={{ fontSize: 12, fontWeight: 700, color: "#6366f1", minWidth: 35 }}>{progress}%</span></div>}
                  <div className="bi-actions"><button className="bi-btn bi-btn--ghost" onClick={() => setStep(2)}>← Volver</button><button className="bi-btn bi-btn--primary" onClick={doImport} disabled={importing || okRows.length === 0}>{importing ? `Importando… ${progress}%` : `Importar ${okRows.length} registros →`}</button></div>
                </div>
              )}

              {step === 4 && (
                <div style={{ background: "#fff", border: "1px solid #e8ecf2", borderRadius: 16, padding: "60px 40px", textAlign: "center" }}>
                  <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#ecfdf5", color: "#10b981", fontSize: 28, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", border: "2px solid #bbf7d0" }}>✓</div>
                  <h3 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 800, color: "#0f172a" }}>¡Importación completada!</h3>
                  <p style={{ margin: "0 0 22px", fontSize: 13, color: "#64748b" }}>{okRows.length} registros importados{errRows.length > 0 ? ` · ${errRows.length} omitidos` : ""}.</p>
                  <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                    <button className="bi-btn bi-btn--primary" onClick={() => { setTab("dashboard"); setStep(1); setXlsxData(null); setParsed([]); }}>Ver Dashboard →</button>
                    <button className="bi-btn bi-btn--ghost" onClick={() => { setStep(1); setXlsxData(null); setParsed([]); }}>Importar otro</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* HISTORIAL — solo manager y super_admin */}
          {tab === "history" && ["super_admin","manager"].includes(profile?.role) && (
            <div className="bi-panel" style={{ padding: 22 }}>
              <div className="bi-panel__hd"><div><h3>Historial de importaciones</h3><p>{imports.length} importaciones</p></div></div>
              <div className="bi-tbl-wrap">
                <table className="bi-tbl">
                  <thead><tr><th>Fecha</th><th>Archivo</th><th>Total</th><th>Válidas</th><th>Errores</th><th>Estado</th><th></th></tr></thead>
                  <tbody>
                    {imports.map(imp => (
                      <tr key={imp.id}>
                        <td>{new Date(imp.created_at).toLocaleDateString("es-AR")} {new Date(imp.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</td>
                        <td><strong>{imp.filename}</strong></td>
                        <td>{imp.rows_total}</td>
                        <td className="c-green">{imp.rows_ok}</td>
                        <td className={imp.rows_error > 0 ? "c-red" : ""}>{imp.rows_error}</td>
                        <td><span className={`bi-status ${imp.rows_error > 0 ? "warn" : "ok"}`}>{imp.rows_error > 0 ? "Advertencias" : "Exitoso"}</span></td>
                        <td><button className="bi-del" onClick={() => deleteImport(imp.id)}>Eliminar</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <footer className="bi-footer">
            <a href="https://www.linkedin.com/in/danieletchudez/" target="_blank" rel="noreferrer">Designed by Daniel Etchudez</a>
          </footer>
        </div>
      </div>
    </div>
  );
}

function FilterGroup({ label, value, onChange, children }) {
  return (
    <div className="bi-fg">
      <label>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}>{children}</select>
    </div>
  );
}
