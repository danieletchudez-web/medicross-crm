import { useEffect, useMemo, useRef, useState } from "react";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";
import "./ImporterPage.css";

/* ─── Helpers ────────────────────────────────────────────────────────── */
function money(v) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(Number(v || 0));
}
function compactMoney(v) {
  const n = Number(v || 0);
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)         return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}
function pct(a, b) { return b > 0 ? Math.round((a / b) * 100) : 0; }
function parseNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}
function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  // Excel serial number
  if (typeof v === "number") {
    const d = new Date((v - 25569) * 86400000);
    return isNaN(d) ? null : d;
  }
  // String
  const s = String(v).trim();
  const parts = s.split(/[/\-\.]/);
  if (parts.length === 3) {
    const [a, b, c] = parts.map(Number);
    // dd/mm/yyyy
    if (a <= 31 && b <= 12) return new Date(c, b - 1, a);
    // yyyy/mm/dd
    if (a > 31) return new Date(a, b - 1, c);
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
function fmtDate(d) {
  if (!d) return "—";
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/* ─── Column mapping — aliases ───────────────────────────────────────── */
const COL_MAP = {
  comprobante:     ["numero","número","nro","n°","comprobante","factura"],
  fecha:           ["fecha","date","fecha venta","fecha de venta"],
  producto:        ["referencia","ref","nombre de proceso","descripcion","descripción","producto","articulo"],
  cliente:         ["cliente","client","razón social","razon social","unidad ejecutora","hospital"],
  unidad_negocio:  ["sucursal","unidad negocio","unidad de negocio","línea","linea","bu","branch"],
  estado:          ["estado","status"],
  observaciones:   ["adjuntos","adjunto","observaciones","notas"],
  costo:           ["total neto gravado","total neto grabado","neto gravado","neto grabado","costo","cost"],
  total_venta:     ["monto total","total","importe","monto","amount"],
};

function detectColumns(headers) {
  const mapping = {};
  const hLower = headers.map((h) => String(h || "").toLowerCase().trim());
  for (const [field, aliases] of Object.entries(COL_MAP)) {
    const idx = hLower.findIndex((h) => aliases.some((a) => h.includes(a)));
    if (idx !== -1) mapping[field] = headers[idx];
  }
  return mapping;
}

function parseRow(raw, mapping) {
  const get = (field) => {
    const col = mapping[field];
    return col !== undefined ? raw[col] : undefined;
  };
  const fecha = parseDate(get("fecha"));
  const totalVenta = parseNum(get("total_venta"));
  const cantidad   = parseNum(get("cantidad"));
  const precio     = parseNum(get("precio_unitario"));
  const costo      = parseNum(get("costo"));
  const margen     = costo !== null && totalVenta !== null ? totalVenta - costo * (cantidad || 1) : parseNum(get("margen"));

  return {
    fecha,
    comprobante:     String(get("comprobante") || "").trim() || null,
    cliente:         String(get("cliente") || "").trim() || null,
    cuit:            String(get("cuit") || "").trim() || null,
    provincia:       String(get("provincia") || "").trim() || null,
    vendedor:        String(get("vendedor") || "").trim() || null,
    producto:        String(get("producto") || "").trim() || null,
    codigo_producto: String(get("codigo_producto") || "").trim() || null,
    unidad_negocio:  String(get("unidad_negocio") || "").trim() || null,
    cantidad,
    precio_unitario: precio,
    total_venta:     totalVenta,
    costo,
    margen,
    estado:          String(get("estado") || "").trim() || null,
    condicion_venta: String(get("condicion_venta") || "").trim() || null,
    forecast:        parseNum(get("forecast")),
    objetivo:        parseNum(get("objetivo")),
    observaciones:   String(get("observaciones") || "").trim() || null,
  };
}

function validateRow(row, idx, comprobantes) {
  const errors = [];
  if (!row.fecha)       errors.push("Fecha inválida");
  if (!row.cliente)     errors.push("Cliente vacío");
  if (row.total_venta === null) errors.push("Total venta vacío");
  if (row.total_venta < 0)     errors.push("Total negativo");
  if (row.comprobante && comprobantes.has(row.comprobante)) errors.push("Comprobante duplicado");
  if (row.cantidad && row.precio_unitario && row.total_venta) {
    const calc = Math.round(row.cantidad * row.precio_unitario);
    const real = Math.round(row.total_venta);
    if (Math.abs(calc - real) > 1) errors.push(`Total ≠ Cant×Precio (${calc} vs ${real})`);
  }
  return errors;
}

const PALETTE = ["#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#06b6d4","#ec4899","#84cc16","#f97316","#6366f1"];

/* ══════════════════════════════════════════════════════════════════════ */
export default function ImporterPage({ profile, onNavigate }) {
  const [tab, setTab]               = useState("import"); // import | dashboard | history
  const [step, setStep]             = useState(1);        // 1 preview 2 map 3 validate 4 done
  const [xlsxData, setXlsxData]     = useState(null);     // { headers, rows }
  const [mapping, setMapping]       = useState({});
  const [parsed, setParsed]         = useState([]);        // { row, errors }[]
  const [importing, setImporting]   = useState(false);
  const [importId, setImportId]     = useState(null);
  const [filename, setFilename]     = useState("");

  const [sales, setSales]           = useState([]);
  const [imports, setImports]       = useState([]);
  const [loadingBI, setLoadingBI]   = useState(false);

  const [filterVendedor, setFilterVendedor]   = useState("todos");
  const [filterUnidad,   setFilterUnidad]     = useState("todas");
  const [filterMes,      setFilterMes]        = useState("todos");
  const [filterImport,   setFilterImport]     = useState("todos");

  const barRef   = useRef(null);
  const lineRef  = useRef(null);
  const vendRef  = useRef(null);

  useEffect(() => { if (tab === "dashboard" || tab === "history") loadBI(); }, [tab]);
  useEffect(() => { if (!loadingBI && sales.length > 0 && tab === "dashboard") renderCharts(); }, [loadingBI, sales, filterVendedor, filterUnidad, filterMes, filterImport]);

  async function loadBI() {
    setLoadingBI(true);
    const [sRes, iRes] = await Promise.all([
      supabase.from("sales").select("*").order("fecha", { ascending: false }),
      supabase.from("imports").select("*").order("created_at", { ascending: false }),
    ]);
    setSales(sRes.data || []);
    setImports(iRes.data || []);
    setLoadingBI(false);
  }

  /* ── File load ── */
  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setFilename(file.name);

    const XLSX = window.XLSX;
    if (!XLSX) { alert("SheetJS no está cargado. Agregá el script en index.html."); return; }

    const ab = await file.arrayBuffer();
    const wb = XLSX.read(ab, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

    if (raw.length < 2) { alert("El archivo está vacío."); return; }

    const headers = raw[0].map((h) => String(h).trim()).filter(Boolean);
    const rows    = raw.slice(1).filter((r) => r.some((c) => c !== "")).map((r) => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = r[i]; });
      return obj;
    });

    const autoMap = detectColumns(headers);
    setXlsxData({ headers, rows });
    setMapping(autoMap);
    setStep(2);
  }

  /* ── Validate ── */
  function runValidation() {
    const comprobantes = new Set();
    const result = xlsxData.rows.map((raw, i) => {
      const row = parseRow(raw, mapping);
      const errors = validateRow(row, i, comprobantes);
      if (row.comprobante) comprobantes.add(row.comprobante);
      return { row, errors, raw };
    });
    setParsed(result);
    setStep(3);
  }

  /* ── Import ── */
  async function doImport() {
    setImporting(true);
    const ok    = parsed.filter((p) => p.errors.length === 0);
    const total = parsed.length;
    const errCount = parsed.filter((p) => p.errors.length > 0).length;

    const { data: imp, error: impErr } = await supabase.from("imports").insert([{
      owner_id:   profile?.id,
      filename,
      rows_total: total,
      rows_ok:    ok.length,
      rows_error: errCount,
      status:     "completed",
    }]).select().single();

    if (impErr) { alert("Error creando importación: " + impErr.message); setImporting(false); return; }

    const importIdNew = imp.id;

    // Insert in batches of 100
    const rows = ok.map((p) => ({
      ...p.row,
      import_id: importIdNew,
      fecha: p.row.fecha ? p.row.fecha.toISOString().slice(0, 10) : null,
    }));

    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await supabase.from("sales").insert(rows.slice(i, i + 100));
      if (error) console.error("Error insertando batch:", error.message);
    }

    setImportId(importIdNew);
    setImporting(false);
    setStep(4);
    loadBI();
  }

  /* ── Filtros BI ── */
  const filteredSales = useMemo(() => {
    return sales.filter((s) => {
      if (filterVendedor !== "todos" && s.vendedor !== filterVendedor) return false;
      if (filterUnidad   !== "todas" && s.unidad_negocio !== filterUnidad) return false;
      if (filterImport   !== "todos" && s.import_id !== filterImport) return false;
      if (filterMes !== "todos") {
        const d = new Date(s.fecha);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
        if (key !== filterMes) return false;
      }
      return true;
    });
  }, [sales, filterVendedor, filterUnidad, filterMes, filterImport]);

  const vendedores    = useMemo(() => [...new Set(sales.map((s) => s.vendedor).filter(Boolean))], [sales]);
  const unidades      = useMemo(() => [...new Set(sales.map((s) => s.unidad_negocio).filter(Boolean))], [sales]);
  const meses         = useMemo(() => {
    const set = new Set(sales.map((s) => { const d = new Date(s.fecha); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }).filter((m) => m !== "NaN-NaN"));
    return [...set].sort().reverse();
  }, [sales]);

  const kpis = useMemo(() => {
    const total      = filteredSales.reduce((s, r) => s + Number(r.total_venta || 0), 0);
    const costoTotal = filteredSales.filter((r) => r.costo !== null).reduce((s, r) => s + Number(r.costo || 0) * Number(r.cantidad || 1), 0);
    const hasCosto   = filteredSales.some((r) => r.costo !== null);
    const margenTotal = hasCosto ? total - costoTotal : null;
    const forecast   = filteredSales.reduce((s, r) => s + Number(r.forecast || 0), 0);
    const objetivo   = filteredSales.reduce((s, r) => s + Number(r.objetivo || 0), 0);
    const tickets    = filteredSales.filter((r) => r.total_venta > 0).length;
    const clientes   = new Set(filteredSales.map((r) => r.cliente).filter(Boolean)).size;
    const productos  = new Set(filteredSales.map((r) => r.producto).filter(Boolean)).size;
    const avgTicket  = tickets > 0 ? total / tickets : 0;
    const cumplFct   = forecast > 0 ? pct(total, forecast) : null;
    const cumplObj   = objetivo > 0 ? pct(total, objetivo) : null;

    // Mejor vendedor
    const byVend = {};
    filteredSales.forEach((r) => { if (r.vendedor) byVend[r.vendedor] = (byVend[r.vendedor] || 0) + Number(r.total_venta || 0); });
    const mejorVend = Object.entries(byVend).sort((a,b) => b[1]-a[1])[0];

    // Mejor unidad
    const byUnit = {};
    filteredSales.forEach((r) => { if (r.unidad_negocio) byUnit[r.unidad_negocio] = (byUnit[r.unidad_negocio] || 0) + Number(r.total_venta || 0); });
    const mejorUnit = Object.entries(byUnit).sort((a,b) => b[1]-a[1])[0];

    return { total, costoTotal, margenTotal, hasCosto, forecast, objetivo, tickets, clientes, productos, avgTicket, cumplFct, cumplObj, mejorVend, mejorUnit };
  }, [filteredSales]);

  /* ── Charts ── */
  function renderCharts() {
    const Chart = window.Chart;
    if (!Chart) return;
    [barRef, lineRef, vendRef].forEach((r) => { if (r.current?.chartInstance) r.current.chartInstance.destroy(); });

    // Ventas por mes
    const byMonth = {};
    filteredSales.forEach((s) => {
      const d = new Date(s.fecha);
      const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
      byMonth[k] = (byMonth[k] || 0) + Number(s.total_venta || 0);
    });
    const monthLabels = Object.keys(byMonth).sort();

    if (lineRef.current) {
      const ctx = lineRef.current.getContext("2d");
      const grad = ctx.createLinearGradient(0,0,0,200);
      grad.addColorStop(0, "rgba(59,130,246,0.15)");
      grad.addColorStop(1, "rgba(59,130,246,0.01)");
      lineRef.current.chartInstance = new Chart(lineRef.current, {
        type: "line",
        data: { labels: monthLabels, datasets: [{ label: "Ventas", data: monthLabels.map((k) => byMonth[k]), borderColor: "#3b82f6", backgroundColor: grad, fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: "#3b82f6", pointBorderColor: "#fff", pointBorderWidth: 2 }] },
        options: chartOpts({ yMoney: true }),
      });
    }

    // Ventas por unidad de negocio
    const byUnit = {};
    filteredSales.forEach((s) => { const k = s.unidad_negocio || "Sin unidad"; byUnit[k] = (byUnit[k] || 0) + Number(s.total_venta || 0); });
    const unitEntries = Object.entries(byUnit).sort((a,b) => b[1]-a[1]).slice(0,8);

    if (barRef.current) {
      barRef.current.chartInstance = new Chart(barRef.current, {
        type: "bar",
        data: { labels: unitEntries.map((e) => e[0]), datasets: [{ data: unitEntries.map((e) => e[1]), backgroundColor: unitEntries.map((_,i) => PALETTE[i % PALETTE.length] + "33"), borderColor: unitEntries.map((_,i) => PALETTE[i % PALETTE.length]), borderWidth: 1.5, borderRadius: 6 }] },
        options: { ...chartOpts({ yMoney: true }), plugins: { ...chartOpts().plugins, legend: { display: false } } },
      });
    }

    // Ventas por vendedor
    const byVend = {};
    filteredSales.forEach((s) => { const k = s.vendedor || "Sin vendedor"; byVend[k] = (byVend[k] || 0) + Number(s.total_venta || 0); });
    const vendEntries = Object.entries(byVend).sort((a,b) => b[1]-a[1]).slice(0,8);

    if (vendRef.current) {
      vendRef.current.chartInstance = new Chart(vendRef.current, {
        type: "bar",
        data: { labels: vendEntries.map((e) => e[0].split(" ")[0]), datasets: [{ data: vendEntries.map((e) => e[1]), backgroundColor: vendEntries.map((_,i) => PALETTE[i % PALETTE.length] + "33"), borderColor: vendEntries.map((_,i) => PALETTE[i % PALETTE.length]), borderWidth: 1.5, borderRadius: 6 }] },
        options: { ...chartOpts({ yMoney: true }), plugins: { ...chartOpts().plugins, legend: { display: false } } },
      });
    }
  }

  function chartOpts({ yMoney = false } = {}) {
    return {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { backgroundColor: "#0f172a", bodyColor: "#f8fafc", titleColor: "#94a3b8", cornerRadius: 8, padding: 10, callbacks: { label: (ctx) => yMoney ? ` ${compactMoney(ctx.raw)}` : ctx.raw } } },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: "#94a3b8", font: { size: 11, family: "DM Sans" } } },
        y: { beginAtZero: true, border: { display: false }, grid: { color: "#f1f5f9" }, ticks: { color: "#94a3b8", font: { size: 11, family: "DM Sans" }, callback: yMoney ? compactMoney : undefined } },
      },
    };
  }

  async function deleteImport(id) {
    if (!confirm("¿Eliminar esta importación y todas sus ventas?")) return;
    await supabase.from("imports").delete().eq("id", id);
    loadBI();
  }

  const okRows  = parsed.filter((p) => p.errors.length === 0);
  const errRows = parsed.filter((p) => p.errors.length > 0);

  /* ── Ranking top clientes ── */
  const topClientes = useMemo(() => {
    const byC = {};
    filteredSales.forEach((s) => { if (s.cliente) byC[s.cliente] = (byC[s.cliente] || 0) + Number(s.total_venta || 0); });
    return Object.entries(byC).sort((a,b) => b[1]-a[1]).slice(0, 10);
  }, [filteredSales]);

  return (
    <Layout title="BI Comercial" profile={profile} onNavigate={onNavigate}>
      <div className="imp-page">

        {/* MAIN TABS */}
        <div className="imp-main-tabs">
          <button className={`imp-main-tab ${tab === "import" ? "active" : ""}`} onClick={() => setTab("import")}>📥 Importar Excel</button>
          <button className={`imp-main-tab ${tab === "dashboard" ? "active" : ""}`} onClick={() => setTab("dashboard")}>📊 Dashboard BI</button>
          <button className={`imp-main-tab ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}>📋 Historial</button>
        </div>

        {/* ══ IMPORTADOR ══ */}
        {tab === "import" && (
          <div className="imp-section">

            {/* Stepper */}
            <div className="imp-stepper">
              {["Subir archivo","Mapear columnas","Validar","Importar"].map((label, i) => (
                <div key={i} className={`imp-step ${step > i+1 ? "done" : step === i+1 ? "active" : ""}`}>
                  <div className="imp-step__num">{step > i+1 ? "✓" : i+1}</div>
                  <span>{label}</span>
                </div>
              ))}
            </div>

            {/* Step 1 — Subir */}
            {step === 1 && (
              <div className="imp-card imp-upload-card">
                <div className="imp-upload-icon">📊</div>
                <h3>Subí tu archivo Excel</h3>
                <p>El sistema detecta las columnas automáticamente. Formatos soportados: .xlsx, .xls, .csv</p>
                <label className="imp-upload-btn">
                  Seleccionar archivo
                  <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} style={{ display: "none" }}/>
                </label>
                <p className="imp-upload-hint">El archivo no se modifica. Los datos se procesan localmente antes de guardarse.</p>
              </div>
            )}

            {/* Step 2 — Mapear columnas */}
            {step === 2 && xlsxData && (
              <div className="imp-card">
                <div className="imp-card-head">
                  <h3>Mapear columnas</h3>
                  <p>Verificá que cada campo del CRM esté mapeado a la columna correcta del Excel. Las columnas detectadas automáticamente están pre-seleccionadas.</p>
                </div>

                <div className="imp-map-grid">
                  {Object.keys(COL_MAP).map((field) => (
                    <div key={field} className="imp-map-row">
                      <label>{field.replace(/_/g," ")}</label>
                      <select
                        value={mapping[field] || ""}
                        onChange={(e) => setMapping({ ...mapping, [field]: e.target.value || undefined })}
                      >
                        <option value="">— No usar —</option>
                        {xlsxData.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                      </select>
                      {mapping[field] && <span className="imp-map-ok">✓</span>}
                    </div>
                  ))}
                </div>

                <div className="imp-preview">
                  <h4>Previsualización (primeras 5 filas)</h4>
                  <div className="imp-table-wrap">
                    <table className="imp-table">
                      <thead><tr>{xlsxData.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                      <tbody>
                        {xlsxData.rows.slice(0,5).map((r,i) => (
                          <tr key={i}>{xlsxData.headers.map((h) => <td key={h}>{String(r[h] || "")}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="imp-actions">
                  <button className="imp-btn imp-btn--ghost" onClick={() => setStep(1)}>← Volver</button>
                  <button className="imp-btn imp-btn--primary" onClick={runValidation}>Validar datos →</button>
                </div>
              </div>
            )}

            {/* Step 3 — Validar */}
            {step === 3 && (
              <div className="imp-card">
                <div className="imp-card-head">
                  <h3>Resultado de validación</h3>
                  <div className="imp-val-summary">
                    <span className="imp-val-ok">✓ {okRows.length} filas válidas</span>
                    {errRows.length > 0 && <span className="imp-val-err">✕ {errRows.length} filas con errores</span>}
                  </div>
                </div>

                {errRows.length > 0 && (
                  <div className="imp-errors-list">
                    <h4>Filas con errores (no se importarán)</h4>
                    {errRows.slice(0, 20).map((p, i) => (
                      <div key={i} className="imp-error-row">
                        <span className="imp-error-row__num">Fila {parsed.indexOf(p) + 2}</span>
                        <span className="imp-error-row__client">{p.row.cliente || "Sin cliente"}</span>
                        <span className="imp-error-row__errors">{p.errors.join(" · ")}</span>
                      </div>
                    ))}
                    {errRows.length > 20 && <p className="imp-more">… y {errRows.length - 20} errores más</p>}
                  </div>
                )}

                <div className="imp-actions">
                  <button className="imp-btn imp-btn--ghost" onClick={() => setStep(2)}>← Volver</button>
                  <button className="imp-btn imp-btn--primary" onClick={doImport} disabled={importing || okRows.length === 0}>
                    {importing ? "Importando…" : `Importar ${okRows.length} filas válidas →`}
                  </button>
                </div>
              </div>
            )}

            {/* Step 4 — Listo */}
            {step === 4 && (
              <div className="imp-card imp-success-card">
                <div className="imp-success-icon">✓</div>
                <h3>¡Importación completada!</h3>
                <p>{okRows.length} filas importadas correctamente{errRows.length > 0 ? ` · ${errRows.length} filas con errores omitidas` : ""}.</p>
                <div className="imp-success-actions">
                  <button className="imp-btn imp-btn--primary" onClick={() => { setTab("dashboard"); setStep(1); setXlsxData(null); setParsed([]); }}>Ver Dashboard BI →</button>
                  <button className="imp-btn imp-btn--ghost" onClick={() => { setStep(1); setXlsxData(null); setParsed([]); }}>Importar otro archivo</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ DASHBOARD BI ══ */}
        {tab === "dashboard" && (
          <div className="imp-section">
            {loadingBI ? (
              <div className="imp-loading"><div className="imp-pulse"/><span>Cargando análisis…</span></div>
            ) : sales.length === 0 ? (
              <div className="imp-empty-state">
                <p>📊</p>
                <h3>No hay datos importados todavía</h3>
                <p>Importá un archivo Excel para ver el dashboard comercial.</p>
                <button className="imp-btn imp-btn--primary" onClick={() => setTab("import")}>Importar Excel →</button>
              </div>
            ) : (
              <>
                {/* Filtros */}
                <div className="imp-bi-filters">
                  <select value={filterImport} onChange={(e) => setFilterImport(e.target.value)}>
                    <option value="todos">Todas las importaciones</option>
                    {imports.map((i) => <option key={i.id} value={i.id}>{i.filename} ({new Date(i.created_at).toLocaleDateString("es-AR")})</option>)}
                  </select>
                  <select value={filterMes} onChange={(e) => setFilterMes(e.target.value)}>
                    <option value="todos">Todos los meses</option>
                    {meses.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <select value={filterVendedor} onChange={(e) => setFilterVendedor(e.target.value)}>
                    <option value="todos">Todos los vendedores</option>
                    {vendedores.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                  <select value={filterUnidad} onChange={(e) => setFilterUnidad(e.target.value)}>
                    <option value="todas">Todas las unidades</option>
                    {unidades.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>

                {/* KPIs */}
                <section className="imp-kpi-grid">
                  <BiKpi label="Total ventas"        value={compactMoney(kpis.total)}      full={money(kpis.total)}  accent="blue"/>
                  <BiKpi label="Ticket promedio"     value={compactMoney(kpis.avgTicket)}  accent="slate"/>
                  <BiKpi label="Transacciones"       value={kpis.tickets}                  accent="slate"/>
                  <BiKpi label="Clientes activos"    value={kpis.clientes}                 accent="blue"/>
                  <BiKpi label="Productos vendidos"  value={kpis.productos}                accent="slate"/>
                  {kpis.hasCosto && <BiKpi label="Margen bruto" value={compactMoney(kpis.margenTotal)} sub={`${pct(kpis.margenTotal, kpis.total)}% del total`} accent="green"/>}
                  {kpis.cumplFct !== null && <BiKpi label="Cumpl. forecast" value={`${kpis.cumplFct}%`} accent={kpis.cumplFct >= 80 ? "green" : kpis.cumplFct >= 50 ? "amber" : "red"}/>}
                  {kpis.cumplObj !== null && <BiKpi label="Cumpl. objetivo" value={`${kpis.cumplObj}%`} accent={kpis.cumplObj >= 80 ? "green" : kpis.cumplObj >= 50 ? "amber" : "red"}/>}
                  {kpis.mejorVend && <BiKpi label="⭐ Mejor vendedor" value={kpis.mejorVend[0].split(" ")[0]} sub={compactMoney(kpis.mejorVend[1])} accent="gold"/>}
                  {kpis.mejorUnit && <BiKpi label="🏆 Mejor unidad" value={kpis.mejorUnit[0]} sub={compactMoney(kpis.mejorUnit[1])} accent="gold"/>}
                </section>

                {/* Charts */}
                <section className="imp-charts-grid">
                  <div className="imp-chart-card imp-chart-card--wide">
                    <div className="imp-chart-card__header"><h3>Evolución mensual de ventas</h3></div>
                    <div className="imp-chart-box"><canvas ref={lineRef}/></div>
                  </div>
                  <div className="imp-chart-card">
                    <div className="imp-chart-card__header"><h3>Ventas por unidad de negocio</h3></div>
                    <div className="imp-chart-box"><canvas ref={barRef}/></div>
                  </div>
                  <div className="imp-chart-card">
                    <div className="imp-chart-card__header"><h3>Ventas por vendedor</h3></div>
                    <div className="imp-chart-box"><canvas ref={vendRef}/></div>
                  </div>
                </section>

                {/* Ranking clientes */}
                <div className="imp-chart-card">
                  <div className="imp-chart-card__header"><h3>Top clientes</h3><p>Ranking por total facturado</p></div>
                  <div className="imp-ranking">
                    {topClientes.map(([cliente, total], i) => {
                      const maxVal = topClientes[0]?.[1] || 1;
                      return (
                        <div key={cliente} className="imp-rank-row">
                          <span className="imp-rank-pos">#{i+1}</span>
                          <span className="imp-rank-name">{cliente}</span>
                          <div className="imp-rank-bar-wrap">
                            <div className="imp-rank-bar" style={{ width: `${pct(total, maxVal)}%`, background: PALETTE[i % PALETTE.length] }}/>
                          </div>
                          <span className="imp-rank-val">{compactMoney(total)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ══ HISTORIAL ══ */}
        {tab === "history" && (
          <div className="imp-section">
            {imports.length === 0 ? (
              <div className="imp-empty-state">
                <p>📋</p>
                <h3>No hay importaciones todavía</h3>
                <button className="imp-btn imp-btn--primary" onClick={() => setTab("import")}>Importar Excel →</button>
              </div>
            ) : (
              <div className="imp-chart-card">
                <div className="imp-chart-card__header"><h3>Historial de importaciones</h3></div>
                <div className="imp-table-wrap">
                  <table className="imp-table">
                    <thead>
                      <tr>
                        <th>Archivo</th>
                        <th>Fecha</th>
                        <th>Total filas</th>
                        <th>Válidas</th>
                        <th>Errores</th>
                        <th>Estado</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {imports.map((imp) => (
                        <tr key={imp.id}>
                          <td><strong>{imp.filename}</strong></td>
                          <td>{new Date(imp.created_at).toLocaleDateString("es-AR")}</td>
                          <td>{imp.rows_total}</td>
                          <td className="imp-td-green">{imp.rows_ok}</td>
                          <td className={imp.rows_error > 0 ? "imp-td-red" : ""}>{imp.rows_error}</td>
                          <td><span className={`imp-status-badge ${imp.status}`}>{imp.status}</span></td>
                          <td>
                            <button className="imp-del-btn" onClick={() => deleteImport(imp.id)}>Eliminar</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        <footer className="imp-footer">
          <a href="https://www.linkedin.com/in/danieletchudez/" target="_blank" rel="noreferrer">Designed by Daniel Etchudez</a>
        </footer>
      </div>
    </Layout>
  );
}

/* ─── Sub-components ─────────────────────────────────────────────────── */
function BiKpi({ label, value, sub, full, accent }) {
  const colors = { blue:"#3b82f6", green:"#10b981", amber:"#f59e0b", red:"#ef4444", slate:"#64748b", gold:"#f59e0b" };
  const c = colors[accent] || "#3b82f6";
  return (
    <article className="imp-kpi" style={{ borderTopColor: c }} title={full}>
      <span className="imp-kpi__label">{label}</span>
      <strong className="imp-kpi__value" style={{ color: c }}>{value}</strong>
      {sub && <small className="imp-kpi__sub">{sub}</small>}
    </article>
  );
}