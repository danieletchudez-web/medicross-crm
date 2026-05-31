import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import {
  ArrowRight, Building2, CalendarDays, Calculator, Clock3,
  Database, FileSpreadsheet, History, ShieldCheck,
} from "lucide-react";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";
import "./preciosHistoricos.css";

function fmtDate(d) {
  if (!d) return "—";
  const [y, m, dd] = String(d).slice(0, 10).split("-");
  return `${dd}/${m}/${y.slice(2)}`;
}

function fullMoney(v) {
  const n = Number(v || 0);
  if (!n) return "—";
  return "$" + n.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function comparablePrice(rowOrValue) {
  const value = typeof rowOrValue === "object" ? rowOrValue?.precio_unitario : rowOrValue;
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

function comparableMoney(v) {
  const n = comparablePrice(v);
  return n === null ? "—" : fullMoney(n);
}

function pctVsMin(value, min) {
  const price = comparablePrice(value);
  if (price === null || !min || price === min) return null;
  return ((price - min) / min * 100).toFixed(1);
}

function rowDate(row) {
  return row?.tenders?.end_date || "";
}

function newestRow(rowsList) {
  return [...rowsList].sort((a, b) => rowDate(b).localeCompare(rowDate(a)))[0] || null;
}

function daysSince(dateValue) {
  if (!dateValue) return null;
  const dt = new Date(`${String(dateValue).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((now - dt) / 86400000));
}

function avg(values) {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

function normalizeProductText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const OWN_COMPANY_ALIASES = ["MEDI-CROSS", "MEDICROSS", "STORING INSUMOS MEDICOS"];

function normalizeCompanyText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function isOwnCompany(value) {
  const name = normalizeCompanyText(value);
  return OWN_COMPANY_ALIASES.some(alias => name.includes(normalizeCompanyText(alias)));
}

function isOwnOffer(row) {
  return Boolean(row?.es_nuestra_oferta) || isOwnCompany(row?.empresa);
}

function productKey(row) {
  return normalizeProductText(row?.descripcion).slice(0, 160) || `renglon-${row?.renglon || "s/d"}`;
}

function shortText(value, max = 110) {
  const text = String(value || "Sin descripción").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

const SUGERENCIAS = [
  "cateter","filtro","dialisis","ablacion","introductor",
  "aguja","set","bandeja","apheresis","nefrologia",
];

const STORAGE_KEY = "ip_busquedas_recientes";
function getBusquedasRecientes() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
}
function saveBusqueda(q) {
  try {
    const prev = getBusquedasRecientes().filter(b => b.toLowerCase() !== q.toLowerCase());
    localStorage.setItem(STORAGE_KEY, JSON.stringify([q, ...prev].slice(0, 8)));
  } catch { /* recent searches are optional */ }
}

function MarketEvolutionChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div className="ph-empty-chart">
        Todavía no hay fechas comparables para mostrar evolución de mercado.
      </div>
    );
  }

  if (data.length === 1) {
    const point = data[0];
    return (
      <div className="ph-market-snapshot">
        <div>
          <span>Lectura puntual</span>
          <strong>{fmtDate(point.date)}</strong>
          <small>Se necesita una segunda fecha comparable para construir tendencia.</small>
        </div>
        {[
          ["Mínimo", point.min],
          ["Promedio", point.avg],
          ["Máximo", point.max],
          ["Oferta propia", point.own],
        ].map(([label, value]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value ? fullMoney(value) : "—"}</strong>
          </article>
        ))}
      </div>
    );
  }

  const W = 760;
  const H = 260;
  const PAD_X = 46;
  const PAD_Y = 28;
  const seriesKeys = ["min", "avg", "max", "own"];
  const values = data
    .flatMap(point => seriesKeys.map(key => point[key]))
    .filter(value => Number.isFinite(value) && value > 0);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;

  const xFor = index => PAD_X + (index / Math.max(data.length - 1, 1)) * (W - PAD_X * 2);
  const yFor = value => {
    if (!Number.isFinite(value) || value <= 0) return null;
    return PAD_Y + (1 - (value - minVal) / range) * (H - PAD_Y * 2);
  };
  const pathFor = key => data
    .map((point, index) => {
      const y = yFor(point[key]);
      if (y === null) return null;
      return `${index === 0 ? "M" : "L"} ${xFor(index).toFixed(1)} ${y.toFixed(1)}`;
    })
    .filter(Boolean)
    .join(" ");
  const colors = {
    min: "#10b981",
    avg: "#3b82f6",
    max: "#ef4444",
    own: "#0f2444",
  };

  return (
    <div className="ph-chart-wrap">
      <svg className="ph-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Evolución de precios de mercado">
        {[0, 1, 2, 3].map(i => {
          const y = PAD_Y + i * ((H - PAD_Y * 2) / 3);
          return <line key={i} x1={PAD_X} x2={W - PAD_X} y1={y} y2={y} className="ph-chart-grid"/>;
        })}
        {seriesKeys.map(key => (
          <path key={key} d={pathFor(key)} fill="none" stroke={colors[key]} strokeWidth={key === "own" ? 3 : 2.4}
            strokeLinecap="round" strokeLinejoin="round" className="ph-chart-line"/>
        ))}
        {data.map((point, index) => (
          <g key={`${point.date}-${index}`}>
            {seriesKeys.map(key => {
              const y = yFor(point[key]);
              if (y === null) return null;
              return <circle key={key} cx={xFor(index)} cy={y} r={key === "own" ? 4 : 3} fill={colors[key]} className="ph-chart-dot"/>;
            })}
            <text x={xFor(index)} y={H - 4} textAnchor="middle" className="ph-chart-label">{fmtDate(point.date)}</text>
          </g>
        ))}
      </svg>
      <div className="ph-chart-legend">
        <span><i style={{ background:"#10b981" }}/>Mínimo</span>
        <span><i style={{ background:"#3b82f6" }}/>Promedio</span>
        <span><i style={{ background:"#ef4444" }}/>Máximo</span>
        <span><i style={{ background:"#0f2444" }}/>Nuestra empresa</span>
      </div>
    </div>
  );
}

export default function PreciosHistoricosPage({ profile, onNavigate }) {
  const [query,    setQuery]    = useState("");
  const [desde,    setDesde]    = useState("");
  const [hasta,    setHasta]    = useState("");
  const [rows,     setRows]     = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [latestRows, setLatestRows] = useState([]);
  const [latestLoading, setLatestLoading] = useState(true);
  const [searched, setSearched] = useState(false);
  const [recientes, setRecientes] = useState([]);
  const [showSug,  setShowSug]  = useState(false);
  const [institutionFilter, setInstitutionFilter] = useState("");
  const [jurisdictionFilter, setJurisdictionFilter] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [selectedProductKey, setSelectedProductKey] = useState("");
  const [marketSearch, setMarketSearch] = useState("");
  const [marketSort, setMarketSort] = useState({ key: "fecha", dir: "desc" });
  const [marketPage, setMarketPage] = useState(1);
  const [analysisView, setAnalysisView] = useState("resumen");
  const inputRef   = useRef(null);
  const debounceRef = useRef(null);
  const marketPageSize = 10;

  useEffect(() => { setRecientes(getBusquedasRecientes()); }, []);

  useEffect(() => {
    async function loadLatestRows() {
      setLatestLoading(true);

      const { data: recentTenders, error: tendersError } = await supabase
        .from("tenders")
        .select("id")
        .order("end_date", { ascending:false, nullsFirst:false })
        .limit(40);

      if (tendersError) console.error(tendersError);
      const recentTenderIds = (recentTenders || []).map(tender => tender.id);

      if (!recentTenderIds.length) {
        setLatestRows([]);
        setLatestLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("tender_comparativas")
        .select(`
          id, renglon, descripcion, empresa, es_nuestra_oferta,
          precio_unitario, cantidad, total_ars, adjudicado, moneda,
          tender_id,
          tenders:tender_id (
            id, institution, process_number, process_name,
            end_date, jurisdiction, operational_status
          )
        `)
        .in("tender_id", recentTenderIds)
        .limit(500);

      if (error) console.error(error);
      setLatestRows(data || []);
      setLatestLoading(false);
    }

    loadLatestRows();
  }, []);

  const buscar = useCallback(async (q = query) => {
    if (!q.trim()) return;
    setLoading(true);
    setSearched(true);
    setShowSug(false);
    saveBusqueda(q.trim());
    setRecientes(getBusquedasRecientes());

    const { data, error } = await supabase
      .from("tender_comparativas")
      .select(`
        id, renglon, descripcion, empresa, es_nuestra_oferta,
        precio_unitario, cantidad, total_ars, adjudicado, moneda,
        tender_id,
        tenders:tender_id (
          id, institution, process_number, process_name,
          end_date, jurisdiction, operational_status
        )
      `)
      .ilike("descripcion", `%${q.trim()}%`)
      .order("renglon");

    if (error) { console.error(error); setLoading(false); return; }
    let result = data || [];
    if (desde) result = result.filter(r => r.tenders?.end_date && r.tenders.end_date >= desde);
    if (hasta) result = result.filter(r => r.tenders?.end_date && r.tenders.end_date <= hasta);
    setSelectedProductKey("");
    setRows(result);
    setLoading(false);
  }, [query, desde, hasta]);

  useEffect(() => {
    if (!query.trim() || !searched) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => buscar(query), 700);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  const limpiar = () => {
    setQuery(""); setDesde(""); setHasta("");
    setInstitutionFilter(""); setJurisdictionFilter(""); setCompanyFilter("");
    setSelectedProductKey("");
    setRows([]); setSearched(false); setShowSug(false);
    inputRef.current?.focus();
  };

  const elegirSugerencia = (s) => { setQuery(s); buscar(s); };

  const latestQuotes = useMemo(() => {
    const grouped = {};
    latestRows.forEach(row => {
      const key = row.tender_id || row.tenders?.id;
      if (!key) return;
      if (!grouped[key]) {
        grouped[key] = {
          id: key,
          tender: row.tenders,
          latestDate: rowDate(row),
          products: {},
          companies: new Set(),
          rows: [],
        };
      }
      const group = grouped[key];
      group.rows.push(row);
      if (rowDate(row) > group.latestDate) group.latestDate = rowDate(row);
      if (row.empresa) group.companies.add(row.empresa);
      const keyProduct = productKey(row);
      if (!group.products[keyProduct]) {
        group.products[keyProduct] = {
          key: keyProduct,
          description: row.descripcion || "Sin descripción",
          rows: 0,
        };
      }
      group.products[keyProduct].rows += 1;
    });

    return Object.values(grouped)
      .map(group => ({
        ...group,
        products: Object.values(group.products),
        companiesCount: group.companies.size,
      }))
      .sort((a, b) => (b.latestDate || "").localeCompare(a.latestDate || ""))
      .slice(0, 8);
  }, [latestRows]);

  const filterOptions = useMemo(() => {
    const institutions = [...new Set(rows.map(r => r.tenders?.institution).filter(Boolean))].sort();
    const jurisdictions = [...new Set(rows.map(r => r.tenders?.jurisdiction).filter(Boolean))].sort();
    const companies = [...new Set(rows.map(r => r.empresa).filter(Boolean))].sort();
    return { institutions, jurisdictions, companies };
  }, [rows]);

  const baseFilteredRows = useMemo(() => rows.filter(row => {
    if (institutionFilter && row.tenders?.institution !== institutionFilter) return false;
    if (jurisdictionFilter && row.tenders?.jurisdiction !== jurisdictionFilter) return false;
    if (companyFilter && row.empresa !== companyFilter) return false;
    return true;
  }), [rows, institutionFilter, jurisdictionFilter, companyFilter]);

  const productGroups = useMemo(() => {
    const groups = {};
    baseFilteredRows.forEach(row => {
      const key = productKey(row);
      if (!groups[key]) {
        groups[key] = {
          key,
          title: row.descripcion || "Sin descripción",
          rows: [],
          latestDate: "",
          institutions: new Set(),
          companies: new Set(),
        };
      }
      groups[key].rows.push(row);
      if (rowDate(row) > groups[key].latestDate) {
        groups[key].latestDate = rowDate(row);
        groups[key].title = row.descripcion || groups[key].title;
      }
      if (row.tenders?.institution) groups[key].institutions.add(row.tenders.institution);
      if (row.empresa) groups[key].companies.add(row.empresa);
    });

    return Object.values(groups).map(group => {
      const valid = group.rows
        .map(row => ({ row, price: comparablePrice(row) }))
        .filter(item => item.price !== null);
      const ownRows = valid.filter(item => isOwnOffer(item.row)).map(item => item.row);
      const compRows = valid.filter(item => !isOwnOffer(item.row)).map(item => item.row);
      const minItem = valid.length
        ? valid.reduce((best, item) => item.price < best.price ? item : best, valid[0])
        : null;
      const lastOwn = newestRow(ownRows);
      const lastComp = newestRow(compRows);
      const ownPrice = comparablePrice(lastOwn);
      const minPrice = minItem?.price || null;
      const diff = ownPrice !== null && minPrice
        ? Number(((ownPrice - minPrice) / minPrice * 100).toFixed(1))
        : null;
      const status = ownPrice === null || !minPrice
        ? { label: "Sin referencia propia", color: "#64748b", bg: "#f1f5f9" }
        : ownPrice <= minPrice
          ? { label: "Competitivo", color: "#059669", bg: "#dcfce7" }
          : diff <= 8
            ? { label: "Cerca", color: "#d97706", bg: "#fef3c7" }
            : { label: "Revisar precio", color: "#dc2626", bg: "#fee2e2" };

      return {
        ...group,
        refs: group.rows.length,
        validRefs: valid.length,
        minRow: minItem?.row || null,
        minPrice,
        lastOwn,
        lastComp,
        diff,
        status,
        institutionsCount: group.institutions.size,
        companiesCount: group.companies.size,
      };
    }).sort((a, b) => {
      if (b.latestDate !== a.latestDate) return b.latestDate.localeCompare(a.latestDate);
      return b.validRefs - a.validRefs;
    });
  }, [baseFilteredRows]);

  const activeProductKey = productGroups.some(group => group.key === selectedProductKey)
    ? selectedProductKey
    : productGroups.length === 1
      ? productGroups[0].key
      : "";

  const focusedProduct = productGroups.find(group => group.key === activeProductKey) || null;

  const filteredRows = useMemo(() => (
    activeProductKey
      ? baseFilteredRows.filter(row => productKey(row) === activeProductKey)
      : baseFilteredRows
  ), [baseFilteredRows, activeProductKey]);

  useEffect(() => {
    setMarketPage(1);
  }, [marketSearch, activeProductKey, institutionFilter, jurisdictionFilter, companyFilter, rows.length]);

  useEffect(() => {
    setAnalysisView("resumen");
  }, [activeProductKey, rows.length]);

  const agrupado = useMemo(() => {
    const map = {};
    filteredRows.forEach(r => {
      const tid = r.tender_id;
      if (!map[tid]) map[tid] = { tender: r.tenders, renglones: {} };
      const reng = r.renglon;
      if (!map[tid].renglones[reng]) map[tid].renglones[reng] = { descripcion: r.descripcion, filas: [] };
      map[tid].renglones[reng].filas.push(r);
    });
    return Object.values(map).sort((a, b) =>
      (b.tender?.end_date || "").localeCompare(a.tender?.end_date || "")
    );
  }, [filteredRows]);

  const metricas = useMemo(() => {
    if (!filteredRows.length) return null;
    const nuestras     = filteredRows.filter(isOwnOffer);
    const licitaciones = new Set(filteredRows.map(r => r.tender_id)).size;
    const empresas     = new Set(filteredRows.map(r => r.empresa)).size;
    const byTenderReng = {};
    filteredRows.forEach(r => {
      const key = `${r.tender_id}_${r.renglon}`;
      if (!byTenderReng[key]) byTenderReng[key] = [];
      byTenderReng[key].push(r);
    });
    let minimoCount = 0;
    let renglonesComparables = 0;
    Object.values(byTenderReng).forEach(grupo => {
      const precios = grupo.map(comparablePrice).filter(p => p !== null);
      const min = precios.length ? Math.min(...precios) : null;
      if (min === null) return;
      renglonesComparables++;
      const nuestra = grupo.find(isOwnOffer);
      if (comparablePrice(nuestra) === min) minimoCount++;
    });
    const totalRenglones = renglonesComparables;
    const preciosNuestros = nuestras
      .filter(r => r.tenders?.end_date)
      .sort((a, b) => a.tenders.end_date.localeCompare(b.tenders.end_date))
      .map(r => ({ fecha: r.tenders.end_date, precio: comparablePrice(r), hospital: r.tenders.institution }))
      .filter(r => r.precio !== null);
    const preciosValidosNuestros = nuestras.map(comparablePrice).filter(p => p !== null);
    const avgNuestro = preciosValidosNuestros.length
      ? preciosValidosNuestros.reduce((s, p) => s + p, 0) / preciosValidosNuestros.length : null;
    let tendencia = null;
    if (preciosNuestros.length >= 2) {
      const mid  = Math.floor(preciosNuestros.length / 2);
      const avg1 = preciosNuestros.slice(0, mid).reduce((s, r) => s + r.precio, 0) / mid;
      const avg2 = preciosNuestros.slice(mid).reduce((s, r) => s + r.precio, 0) / (preciosNuestros.length - mid);
      const pct  = ((avg2 - avg1) / avg1 * 100).toFixed(1);
      tendencia  = { pct: Number(pct), subiendo: Number(pct) > 0 };
    }
    const conteoEmpresas = {};
    filteredRows.filter(r => !isOwnOffer(r)).forEach(r => {
      conteoEmpresas[r.empresa] = (conteoEmpresas[r.empresa] || 0) + 1;
    });
    const topCompetidores = Object.entries(conteoEmpresas)
      .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([nombre, veces]) => ({ nombre, veces }));
    return { licitaciones, empresas, nuestras: nuestras.length, avgNuestro,
      preciosNuestros, minimoCount, totalRenglones, tendencia, topCompetidores };
  }, [filteredRows]);

  function precioMinRenglon(filas) {
    const precios = filas.map(comparablePrice).filter(p => p !== null);
    return precios.length ? Math.min(...precios) : null;
  }

  const showFocusedAnalysis = Boolean(activeProductKey);

  const decision = useMemo(() => {
    const validRows = filteredRows
      .map(r => ({ ...r, precioComparable: comparablePrice(r) }))
      .filter(r => r.precioComparable !== null);
    if (!validRows.length) return null;

    const propias = validRows.filter(isOwnOffer);
    const competencia = validRows.filter(r => !isOwnOffer(r));
    const ultimaPropia = newestRow(propias);
    const ultimaCompetencia = newestRow(competencia);
    const adjudicadas = validRows.filter(r => r.adjudicado);
    const ultimaAdjudicada = newestRow(adjudicadas);
    const preciosCompetencia = competencia.map(r => r.precioComparable);
    const preciosTodos = validRows.map(r => r.precioComparable);
    const minimoMercado = preciosCompetencia.length ? Math.min(...preciosCompetencia) : Math.min(...preciosTodos);
    const minimoRow = (preciosCompetencia.length ? competencia : validRows)
      .find(r => r.precioComparable === minimoMercado) || null;
    const promedioMercado = preciosCompetencia.length ? avg(preciosCompetencia) : avg(preciosTodos);
    const ultimoDato = newestRow(validRows);
    const antiguedad = daysSince(rowDate(ultimoDato));

    const competidores = Object.values(competencia.reduce((acc, row) => {
      const key = row.empresa || "Sin empresa";
      const current = acc[key];
      if (!current || rowDate(row) > rowDate(current)) acc[key] = row;
      return acc;
    }, {})).sort((a, b) => rowDate(b).localeCompare(rowDate(a))).slice(0, 5);

    const refs = validRows.length;
    const confianza = refs >= 8 && (antiguedad === null || antiguedad <= 180)
      ? { level: "Alta", color: "#059669", bg: "#dcfce7" }
      : refs >= 3 && (antiguedad === null || antiguedad <= 365)
        ? { level: "Media", color: "#d97706", bg: "#fef3c7" }
        : { level: "Baja", color: "#dc2626", bg: "#fee2e2" };

    const ownPrice = ultimaPropia?.precioComparable ?? null;
    const diffMercado = ownPrice !== null && minimoMercado
      ? Number(((ownPrice - minimoMercado) / minimoMercado * 100).toFixed(1))
      : null;

    let estado = { label: "Datos insuficientes", color: "#64748b", bg: "#f1f5f9" };
    if (ownPrice !== null && minimoMercado) {
      if (ownPrice <= minimoMercado) estado = { label: "Competitivo", color: "#059669", bg: "#dcfce7" };
      else if (diffMercado <= 8) estado = { label: "Cerca del mercado", color: "#d97706", bg: "#fef3c7" };
      else estado = { label: "Riesgo por precio", color: "#dc2626", bg: "#fee2e2" };
    } else if (!ultimaPropia && competencia.length) {
      estado = { label: "Sin referencia propia", color: "#d97706", bg: "#fef3c7" };
    }

    const base = ultimaAdjudicada?.precioComparable || minimoMercado || promedioMercado || ownPrice;
    const sugerido = base ? Math.round(base * 1.02) : null;
    const fuenteSugerido = ultimaAdjudicada || minimoRow || ultimaPropia || ultimoDato || null;
    const tipoFuenteSugerido = ultimaAdjudicada
      ? "Última adjudicación"
      : minimoRow
        ? "Mínimo de mercado"
        : ultimaPropia
          ? "Última oferta propia"
          : ultimoDato
            ? "Última referencia"
            : "Sin referencia";
    const fechaFuenteSugerido = rowDate(fuenteSugerido);
    const diasFuenteSugerido = daysSince(fechaFuenteSugerido);
    const vigenciaSugerido = diasFuenteSugerido === null
      ? { label: "Sin fecha verificable", tone: "gray" }
      : diasFuenteSugerido <= 90
        ? { label: "Referencia vigente", tone: "green" }
        : diasFuenteSugerido <= 180
          ? { label: "Revisar vigencia", tone: "amber" }
          : { label: "Referencia antigua", tone: "red" };
    const detalleFuenteSugerido = fuenteSugerido
      ? `${tipoFuenteSugerido} · ${fmtDate(fechaFuenteSugerido)}${diasFuenteSugerido !== null ? ` · hace ${diasFuenteSugerido} días` : ""}`
      : "Sin fecha de referencia";
    const motivo = ultimaAdjudicada
      ? "Basado en la última adjudicación registrada, con 2% de colchón operativo."
      : minimoMercado
        ? "Basado en el menor precio comparable del mercado, con 2% de colchón operativo."
        : ownPrice
          ? "Basado en nuestra última cotización comparable."
          : "No hay suficientes referencias para sugerir precio.";

    return {
      validRows,
      refs,
      propias,
      competencia,
      competidores,
      ultimaPropia,
      ultimaCompetencia,
      ultimaAdjudicada,
      minimoRow,
      minimoMercado,
      promedioMercado,
      sugerido,
      fuenteSugerido,
      tipoFuenteSugerido,
      fechaFuenteSugerido,
      diasFuenteSugerido,
      vigenciaSugerido,
      detalleFuenteSugerido,
      motivo,
      confianza,
      estado,
      diffMercado,
      antiguedad,
    };
  }, [filteredRows]);

  const marketTrend = useMemo(() => {
    const byDate = {};
    filteredRows.forEach(row => {
      const price = comparablePrice(row);
      const date = rowDate(row);
      if (price === null || !date) return;
      if (!byDate[date]) byDate[date] = { date, prices: [], own: [] };
      byDate[date].prices.push(price);
      if (isOwnOffer(row)) byDate[date].own.push(price);
    });
    return Object.values(byDate)
      .map(point => ({
        date: point.date,
        min: Math.min(...point.prices),
        avg: avg(point.prices),
        max: Math.max(...point.prices),
        own: avg(point.own),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredRows]);

  const competitiveIntel = useMemo(() => {
    const byGroup = {};
    const competitorRows = filteredRows.filter(row => !isOwnOffer(row));
    competitorRows.forEach(row => {
      const key = `${row.tender_id}_${row.renglon}`;
      if (!byGroup[key]) byGroup[key] = [];
      byGroup[key].push(row);
    });

    const companies = {};
    const ensureCompany = name => {
      const key = name || "Sin empresa";
      if (!companies[key]) {
        companies[key] = {
          name: key, refs: 0, adjudicaciones: 0, minimos: 0,
          total: 0, lastDate: "", prices: [], latestRow: null,
        };
      }
      return companies[key];
    };

    competitorRows.forEach(row => {
      const company = ensureCompany(row.empresa);
      company.refs += 1;
      company.total += Number(row.total_ars || 0);
      if (row.adjudicado) company.adjudicaciones += 1;
      const price = comparablePrice(row);
      if (price !== null) company.prices.push(price);
      if (rowDate(row) > company.lastDate) {
        company.lastDate = rowDate(row);
        company.latestRow = row;
      }
    });

    Object.values(byGroup).forEach(groupRows => {
      const min = precioMinRenglon(groupRows);
      if (min === null) return;
      groupRows.forEach(row => {
        if (comparablePrice(row) === min) ensureCompany(row.empresa).minimos += 1;
      });
    });

    const rawRanking = Object.values(companies);
    const totalRefs = rawRanking.reduce((sum, item) => sum + item.refs, 0) || 1;
    const ranking = rawRanking
      .map(item => ({
        ...item,
        avgPrice: avg(item.prices),
        lastPrice: comparablePrice(item.latestRow),
        participation: Math.round(item.refs / totalRefs * 100),
      }))
      .sort((a, b) => b.refs - a.refs || b.minimos - a.minimos || b.adjudicaciones - a.adjudicaciones);
    return {
      ranking,
      totalRefs,
      frecuentes: [...ranking].sort((a, b) => b.refs - a.refs).slice(0, 5),
      adjudicaciones: [...ranking].sort((a, b) => b.adjudicaciones - a.adjudicaciones || b.refs - a.refs).slice(0, 5),
      minimos: [...ranking].sort((a, b) => b.minimos - a.minimos || b.refs - a.refs).slice(0, 5),
    };
  }, [filteredRows]);

  const marketRows = useMemo(() => {
    const byGroup = {};
    filteredRows.forEach(row => {
      const key = `${row.tender_id}_${row.renglon}`;
      if (!byGroup[key]) byGroup[key] = [];
      byGroup[key].push(row);
    });
    const minByGroup = Object.fromEntries(
      Object.entries(byGroup).map(([key, groupRows]) => [key, precioMinRenglon(groupRows)])
    );

    const q = marketSearch.trim().toLowerCase();
    const list = filteredRows.map(row => {
      const min = minByGroup[`${row.tender_id}_${row.renglon}`];
      const price = comparablePrice(row);
      const diff = price !== null && min ? Number(((price - min) / min * 100).toFixed(1)) : null;
      return {
        id: row.id,
        row,
        fecha: rowDate(row),
        institucion: row.tenders?.institution || "—",
        jurisdiccion: row.tenders?.jurisdiction || "—",
        expediente: row.tenders?.process_number || "—",
        renglon: row.renglon || "—",
        descripcion: row.descripcion || "",
        empresa: row.empresa || "—",
        precio: price,
        cantidad: Number(row.cantidad || 0),
        total: Number(row.total_ars || 0),
        resultado: row.adjudicado ? "Adjudicada" : isOwnOffer(row) ? "Oferta propia" : "Presentada",
        adjudicado: Boolean(row.adjudicado),
        diff,
        min,
      };
    }).filter(item => {
      if (!q) return true;
      return [
        item.fecha, item.institucion, item.jurisdiccion, item.expediente,
        item.renglon, item.descripcion, item.empresa, item.resultado,
      ].join(" ").toLowerCase().includes(q);
    });

    const sortValue = item => {
      switch (marketSort.key) {
        case "fecha": return item.fecha || "";
        case "institucion": return item.institucion;
        case "jurisdiccion": return item.jurisdiccion;
        case "expediente": return item.expediente;
        case "renglon": return Number(item.renglon) || 0;
        case "empresa": return item.empresa;
        case "precio": return item.precio ?? Number.POSITIVE_INFINITY;
        case "cantidad": return item.cantidad;
        case "total": return item.total;
        case "resultado": return item.resultado;
        case "adjudicado": return item.adjudicado ? 1 : 0;
        case "diff": return item.diff ?? Number.POSITIVE_INFINITY;
        default: return item.fecha || "";
      }
    };

    return [...list].sort((a, b) => {
      const av = sortValue(a);
      const bv = sortValue(b);
      const dir = marketSort.dir === "asc" ? 1 : -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [filteredRows, marketSearch, marketSort]);

  const marketTotalPages = Math.max(1, Math.ceil(marketRows.length / marketPageSize));
  const marketPageRows = marketRows.slice((marketPage - 1) * marketPageSize, marketPage * marketPageSize);

  const insights = useMemo(() => {
    if (!metricas || !decision) return [];
    const firstTrend = marketTrend[0];
    const lastTrend = marketTrend[marketTrend.length - 1];
    const trendPct = firstTrend?.avg && lastTrend?.avg
      ? Number(((lastTrend.avg - firstTrend.avg) / firstTrend.avg * 100).toFixed(1))
      : null;
    const leaderMin = competitiveIntel.minimos[0];
    const leaderAdj = competitiveIntel.adjudicaciones.find(item => item.adjudicaciones > 0);
    return [
      {
        label: "Cobertura histórica",
        value: `${metricas.licitaciones} licitación${metricas.licitaciones !== 1 ? "es" : ""}`,
        text: `${marketRows.length} referencias comparables para este producto.`,
      },
      {
        label: "Líder de precio",
        value: leaderMin?.name || "Sin dato",
        text: leaderMin ? `${leaderMin.minimos} mínimo${leaderMin.minimos !== 1 ? "s" : ""} registrado${leaderMin.minimos !== 1 ? "s" : ""}.` : "Todavía no hay mínimos comparables.",
      },
      {
        label: "Posición propia",
        value: decision.diffMercado === null ? "Sin referencia" : `${decision.diffMercado > 0 ? "+" : ""}${decision.diffMercado}%`,
        text: decision.diffMercado === null
          ? "Falta una cotización propia comparable."
          : "Diferencia de la última referencia propia contra mínimo mercado.",
      },
      {
        label: "Recomendación",
        value: decision.sugerido ? fullMoney(decision.sugerido) : "—",
        text: decision.fechaFuenteSugerido
          ? `${decision.motivo} Base: ${fmtDate(decision.fechaFuenteSugerido)}.`
          : decision.motivo,
      },
      {
        label: "Tendencia mercado",
        value: trendPct === null ? "Sin tendencia" : `${trendPct > 0 ? "+" : ""}${trendPct}%`,
        text: trendPct === null
          ? "Falta una segunda fecha comparable."
          : trendPct > 0
            ? "El promedio de mercado viene subiendo."
            : "El promedio de mercado viene bajando o estable.",
      },
      {
        label: "Adjudicaciones",
        value: leaderAdj?.name || "Sin adjudicación",
        text: leaderAdj ? `${leaderAdj.adjudicaciones} adjudicación${leaderAdj.adjudicaciones !== 1 ? "es" : ""} detectada${leaderAdj.adjudicaciones !== 1 ? "s" : ""}.` : "No hay adjudicaciones cargadas para esta búsqueda.",
      },
    ];
  }, [metricas, decision, marketTrend, competitiveIntel, marketRows.length]);

  const sortMarketBy = key => {
    setMarketSort(prev => ({
      key,
      dir: prev.key === key && prev.dir === "asc" ? "desc" : "asc",
    }));
  };

  const quickDecision = useMemo(() => {
    if (!decision) return null;
    if (decision.diffMercado === null) {
      return {
        title: "Completar referencia propia",
        text: "Hay mercado comparable, pero falta una cotización propia para medir posición real.",
        action: "Usar precio sugerido con cautela",
        tone: "amber",
      };
    }
    if (decision.diffMercado <= 0) {
      return {
        title: "Competir con margen controlado",
        text: "La última referencia propia está al nivel del mínimo o por debajo del mercado.",
        action: "Mantener estrategia",
        tone: "green",
      };
    }
    if (decision.diffMercado <= 8) {
      return {
        title: "Ajuste fino recomendado",
        text: "Nuestra empresa está cerca del mercado. Conviene revisar margen antes de cotizar.",
        action: "Cotizar cerca del sugerido",
        tone: "amber",
      };
    }
    return {
      title: "Riesgo por precio",
      text: "La última referencia propia está lejos del mínimo comparable. Requiere revisión comercial.",
      action: "Recalcular precio",
      tone: "red",
    };
  }, [decision]);

  return (
    <Layout title="Inteligencia de Precios" profile={profile} onNavigate={onNavigate}>
      <div className="ph-page" style={{padding:"18px 24px 48px",display:"flex",flexDirection:"column",gap:18,
        fontFamily:"DM Sans, system-ui, sans-serif",minHeight:"100vh",fontSize:"13.5px"}}>

        {/* HEADER */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
          flexWrap:"wrap",gap:12,paddingBottom:14,borderBottom:"1px solid rgba(15,36,68,.09)"}}>
          <div>
            <h2 style={{margin:0,fontSize:22,fontWeight:700,color:"#0f2444",letterSpacing:"-.5px",
              display:"flex",alignItems:"center",gap:8}}>
              <span style={{display:"inline-block",width:4,height:22,background:"#185fa5",
                borderRadius:4,flexShrink:0}}/>
              Inteligencia de Precios
            </h2>
            <p style={{margin:"3px 0 0",fontSize:12,color:"#94a3b8",paddingLeft:12}}>
              Historial de precios por producto en todas las licitaciones cargadas
            </p>
          </div>
          <button onClick={() => onNavigate("tenders")}
            style={{padding:"7px 14px",borderRadius:8,border:"1px solid #e2e8f0",background:"#fff",
              fontSize:12.5,fontWeight:500,cursor:"pointer",color:"#334155",fontFamily:"inherit",
              display:"flex",alignItems:"center",gap:6}}>
            ← Volver a Licitaciones
          </button>
        </div>

        {/* BUSCADOR */}
        <div style={{background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",
          padding:"20px 22px",boxShadow:"0 2px 8px rgba(15,23,42,.06)"}}>
          <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end"}}>

            {/* Input */}
            <div style={{flex:"2 1 280px",display:"flex",flexDirection:"column",gap:5,position:"relative"}}>
              <label style={{fontSize:11,fontWeight:600,color:"#64748b",
                textTransform:"uppercase",letterSpacing:".5px"}}>Producto / Descripción</label>
              <div style={{position:"relative",display:"flex",alignItems:"center"}}>
                <span style={{position:"absolute",left:11,fontSize:14,color:"#94a3b8",pointerEvents:"none"}}>🔍</span>
                <input ref={inputRef} value={query}
                  onChange={e => { setQuery(e.target.value); setShowSug(true); }}
                  onKeyDown={e => { if(e.key==="Enter") buscar(); if(e.key==="Escape") setShowSug(false); }}
                  onFocus={() => setShowSug(true)}
                  onBlur={() => setTimeout(() => setShowSug(false), 160)}
                  placeholder="Ej: cateter, filtro, dialisis, ablacion…"
                  style={{width:"100%",padding:"10px 12px 10px 34px",border:"1px solid #e2e8f0",
                    borderRadius:9,fontSize:13,fontFamily:"inherit",outline:"none",
                    color:"#0f172a",boxSizing:"border-box"}}
                />
              </div>
              {/* Dropdown */}
              {showSug && !query && (recientes.length > 0 || true) && (
                <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,zIndex:50,
                  background:"#fff",border:"1px solid #e2e8f0",borderRadius:10,
                  boxShadow:"0 8px 24px rgba(15,23,42,.12)",overflow:"hidden"}}>
                  {recientes.length > 0 && (
                    <>
                      <div style={{padding:"8px 14px 4px",fontSize:10,fontWeight:600,
                        textTransform:"uppercase",letterSpacing:".5px",color:"#94a3b8"}}>
                        Recientes
                      </div>
                      {recientes.map(r => (
                        <button key={r} onMouseDown={() => elegirSugerencia(r)}
                          style={{width:"100%",padding:"8px 14px",background:"none",border:"none",
                            textAlign:"left",fontSize:13,cursor:"pointer",color:"#334155",
                            fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontSize:11,color:"#94a3b8"}}>🕐</span>{r}
                        </button>
                      ))}
                      <div style={{height:1,background:"#f0f4f8",margin:"4px 0"}}/>
                    </>
                  )}
                  <div style={{padding:"8px 14px 4px",fontSize:10,fontWeight:600,
                    textTransform:"uppercase",letterSpacing:".5px",color:"#94a3b8"}}>
                    Sugerencias
                  </div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:6,padding:"6px 14px 12px"}}>
                    {SUGERENCIAS.map(s => (
                      <button key={s} onMouseDown={() => elegirSugerencia(s)}
                        style={{padding:"4px 10px",borderRadius:20,border:"1px solid #e2e8f0",
                          background:"#f8fafc",fontSize:11.5,cursor:"pointer",color:"#475569",
                          fontFamily:"inherit",fontWeight:500}}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Desde */}
            <div style={{flex:"1 1 140px",display:"flex",flexDirection:"column",gap:5}}>
              <label style={{fontSize:11,fontWeight:600,color:"#64748b",
                textTransform:"uppercase",letterSpacing:".5px"}}>Desde</label>
              <input type="date" value={desde} onChange={e => setDesde(e.target.value)}
                style={{padding:"10px 12px",border:"1px solid #e2e8f0",borderRadius:9,
                  fontSize:13,fontFamily:"inherit",outline:"none",color:"#0f172a"}}/>
            </div>

            {/* Hasta */}
            <div style={{flex:"1 1 140px",display:"flex",flexDirection:"column",gap:5}}>
              <label style={{fontSize:11,fontWeight:600,color:"#64748b",
                textTransform:"uppercase",letterSpacing:".5px"}}>Hasta</label>
              <input type="date" value={hasta} onChange={e => setHasta(e.target.value)}
                style={{padding:"10px 12px",border:"1px solid #e2e8f0",borderRadius:9,
                  fontSize:13,fontFamily:"inherit",outline:"none",color:"#0f172a"}}/>
            </div>

            {/* Buscar */}
            <button onClick={() => buscar()} disabled={loading || !query.trim()}
              style={{padding:"10px 22px",borderRadius:9,border:"none",
                background: query.trim() ? "#0f2444" : "#e2e8f0",
                color: query.trim() ? "#fff" : "#94a3b8",
                fontSize:13,fontWeight:600,cursor:query.trim()?"pointer":"default",
                fontFamily:"inherit",whiteSpace:"nowrap",
                boxShadow: query.trim() ? "0 2px 8px rgba(15,36,68,.2)" : "none",
                transition:"all .15s"}}>
              {loading ? "⏳ Buscando…" : "Buscar"}
            </button>

            {searched && (
              <button onClick={limpiar}
                style={{padding:"10px 14px",borderRadius:9,border:"1px solid #e2e8f0",
                  background:"#fff",fontSize:12.5,fontWeight:500,cursor:"pointer",
                  color:"#64748b",fontFamily:"inherit"}}>✕</button>
            )}
          </div>

          {/* Chips rápidos cuando no hay búsqueda previa */}
          {!searched && (
            <div style={{marginTop:14,display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
              <span style={{fontSize:11,color:"#94a3b8",fontWeight:500,marginRight:2}}>
                Búsquedas frecuentes:
              </span>
              {SUGERENCIAS.slice(0, 7).map(s => (
                <button key={s} onClick={() => elegirSugerencia(s)}
                  style={{padding:"3px 11px",borderRadius:20,border:"1px solid #e2e8f0",
                    background:"#f8fafc",fontSize:11.5,cursor:"pointer",color:"#475569",
                    fontFamily:"inherit",fontWeight:500,transition:"all .12s"}}
                  onMouseOver={e=>{e.currentTarget.style.background="#eff6ff";e.currentTarget.style.borderColor="#bfdbfe";e.currentTarget.style.color="#1e40af";}}
                  onMouseOut={e=>{e.currentTarget.style.background="#f8fafc";e.currentTarget.style.borderColor="#e2e8f0";e.currentTarget.style.color="#475569";}}>
                  {s}
                </button>
              ))}
            </div>
          )}

          {searched && rows.length > 0 && (
            <div style={{marginTop:16,paddingTop:14,borderTop:"1px solid #eef2f7",
              display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",
              gap:10,alignItems:"end"}}>
              {[
                {
                  label:"Institución",
                  value:institutionFilter,
                  onChange:setInstitutionFilter,
                  options:filterOptions.institutions,
                  all:"Todas las instituciones",
                },
                {
                  label:"Jurisdicción",
                  value:jurisdictionFilter,
                  onChange:setJurisdictionFilter,
                  options:filterOptions.jurisdictions,
                  all:"Todas las jurisdicciones",
                },
                {
                  label:"Empresa",
                  value:companyFilter,
                  onChange:setCompanyFilter,
                  options:filterOptions.companies,
                  all:"Todas las empresas",
                },
              ].map(filter => (
                <div key={filter.label} style={{display:"flex",flexDirection:"column",gap:5}}>
                  <label style={{fontSize:10.5,fontWeight:700,color:"#94a3b8",
                    textTransform:"uppercase",letterSpacing:".6px"}}>{filter.label}</label>
                  <select value={filter.value} onChange={e => filter.onChange(e.target.value)}
                    style={{padding:"9px 11px",border:"1px solid #e2e8f0",borderRadius:9,
                      fontSize:12.5,fontFamily:"inherit",outline:"none",color:"#0f172a",
                      background:"#f8fafc"}}>
                    <option value="">{filter.all}</option>
                    {filter.options.map(option => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>
              ))}
              {(institutionFilter || jurisdictionFilter || companyFilter) && (
                <button onClick={() => {
                  setInstitutionFilter("");
                  setJurisdictionFilter("");
                  setCompanyFilter("");
                  setSelectedProductKey("");
                }}
                  style={{padding:"9px 12px",borderRadius:9,border:"1px solid #e2e8f0",
                    background:"#fff",fontSize:12.5,fontWeight:700,cursor:"pointer",
                    color:"#64748b",fontFamily:"inherit",height:38}}>
                  Limpiar filtros
                </button>
              )}
              <div style={{fontSize:11.5,color:"#94a3b8",fontWeight:700,
                alignSelf:"center",justifySelf:"end"}}>
                {filteredRows.length} de {rows.length} referencias
              </div>
            </div>
          )}
        </div>

        {/* ACTIVIDAD RECIENTE INICIAL */}
        {!searched && (
          <section className="ph-latest">
            <div className="ph-latest__head">
              <div>
                <span className="ph-eyebrow ph-latest__eyebrow"><History size={14}/>Actividad reciente</span>
                <h3>Últimas cotizaciones comparadas</h3>
                <p>
                  Abrí un producto reciente para analizar precios de mercado o usá el buscador
                  para consultar cualquier referencia histórica.
                </p>
              </div>
              {!latestLoading && <span className="ph-pill">{latestQuotes.length} licitaciones</span>}
            </div>

            {latestLoading && (
              <div className="ph-latest-grid" aria-label="Cargando cotizaciones recientes">
                {[0, 1, 2, 3].map(item => (
                  <div key={item} className="ph-latest-card ph-latest-card--loading">
                    <span/><span/><span/><span/>
                  </div>
                ))}
              </div>
            )}

            {!latestLoading && latestQuotes.length === 0 && (
              <div className="ph-latest-empty">
                <FileSpreadsheet size={25}/>
                <strong>Sin comparativas recientes</strong>
                <span>Importá un Excel BAC desde Licitaciones para comenzar a construir el historial.</span>
                <button type="button" onClick={() => onNavigate("tenders")}>
                  Ir a Licitaciones <ArrowRight size={15}/>
                </button>
              </div>
            )}

            {!latestLoading && latestQuotes.length > 0 && (
              <div className="ph-latest-grid">
                {latestQuotes.map(quote => (
                  <article key={quote.id} className="ph-latest-card">
                    <div className="ph-latest-card__top">
                      <div className="ph-latest-card__institution">
                        <Building2 size={17}/>
                        <div>
                          <strong>{quote.tender?.institution || "Sin institución"}</strong>
                          <span>{quote.tender?.process_number || "Sin expediente"}</span>
                        </div>
                      </div>
                      <span className="ph-latest-card__date"><Clock3 size={14}/>{fmtDate(quote.latestDate)}</span>
                    </div>

                    <p>{shortText(quote.tender?.process_name || quote.products[0]?.description, 112)}</p>

                    <div className="ph-latest-card__meta">
                      <span>{quote.products.length} producto{quote.products.length !== 1 ? "s" : ""}</span>
                      <span>{quote.companiesCount} empresa{quote.companiesCount !== 1 ? "s" : ""}</span>
                      <span>{quote.rows.length} referencia{quote.rows.length !== 1 ? "s" : ""}</span>
                    </div>

                    <div className="ph-latest-card__products">
                      {quote.products.slice(0, 3).map(product => (
                        <button key={product.key} type="button" onClick={() => elegirSugerencia(product.description)}>
                          <span>{shortText(product.description, 64)}</span>
                          <ArrowRight size={13}/>
                        </button>
                      ))}
                    </div>

                    {quote.products.length > 3 && (
                      <small>+{quote.products.length - 3} productos disponibles. Usá el buscador para acotar.</small>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {/* LOADING */}
        {loading && (
          <div style={{background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",
            padding:"48px",textAlign:"center"}}>
            <div style={{fontSize:28,marginBottom:10}}>⏳</div>
            <div style={{fontSize:13,color:"#94a3b8"}}>Buscando en el historial de licitaciones…</div>
          </div>
        )}

        {/* SIN RESULTADOS */}
        {searched && !loading && rows.length === 0 && (
          <div style={{background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",
            padding:"48px",textAlign:"center",boxShadow:"0 1px 3px rgba(15,23,42,.04)"}}>
            <div style={{fontSize:32,marginBottom:10}}>🔍</div>
            <div style={{fontWeight:600,fontSize:15,color:"#334155",marginBottom:4}}>Sin resultados</div>
            <div style={{fontSize:12.5,color:"#94a3b8",marginBottom:18}}>
              No encontramos comparativas con "<strong>{query}</strong>" en el período seleccionado.
            </div>
            <div style={{display:"flex",justifyContent:"center",gap:8,flexWrap:"wrap"}}>
              {SUGERENCIAS.slice(0, 5).map(s => (
                <button key={s} onClick={() => elegirSugerencia(s)}
                  style={{padding:"5px 12px",borderRadius:20,border:"1px solid #e2e8f0",
                    background:"#f8fafc",fontSize:12,cursor:"pointer",color:"#475569",fontFamily:"inherit"}}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {searched && !loading && rows.length > 0 && filteredRows.length === 0 && (
          <div style={{background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",
            padding:"28px",textAlign:"center",boxShadow:"0 1px 3px rgba(15,23,42,.04)"}}>
            <div style={{fontSize:15,fontWeight:800,color:"#0f2444",marginBottom:6}}>
              Sin coincidencias con los filtros aplicados
            </div>
            <div style={{fontSize:12.5,color:"#94a3b8",marginBottom:14}}>
              La búsqueda encontró referencias, pero ninguna coincide con institución, jurisdicción o empresa seleccionada.
            </div>
            <button onClick={() => {
              setInstitutionFilter("");
              setJurisdictionFilter("");
              setCompanyFilter("");
              setSelectedProductKey("");
            }}
              style={{padding:"8px 13px",borderRadius:9,border:"1px solid #bfdbfe",
                background:"#eff6ff",fontSize:12.5,fontWeight:800,cursor:"pointer",
                color:"#185fa5",fontFamily:"inherit"}}>
              Ver todas las referencias
            </button>
          </div>
        )}

        {searched && !loading && baseFilteredRows.length > 0 && (
          <div style={{background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",
            boxShadow:"0 2px 8px rgba(15,23,42,.06)",padding:"18px 20px"}}>
            <div style={{display:"flex",justifyContent:"space-between",gap:12,
              alignItems:"flex-start",flexWrap:"wrap",marginBottom:14}}>
              <div>
                <div style={{fontSize:11,fontWeight:800,textTransform:"uppercase",
                  letterSpacing:".7px",color:"#94a3b8",marginBottom:4}}>
                  Paso 1 · Elegí el producto exacto
                </div>
                <h3 style={{margin:0,fontSize:18,color:"#0f2444",letterSpacing:"-.35px"}}>
                  {productGroups.length} producto{productGroups.length !== 1 ? "s" : ""} encontrado{productGroups.length !== 1 ? "s" : ""}
                </h3>
                <p style={{margin:"5px 0 0",fontSize:12.5,color:"#64748b",lineHeight:1.45}}>
                  La búsqueda puede traer varios renglones distintos. Seleccioná uno para ver precio sugerido, última oferta propia y competidores.
                </p>
              </div>
              {focusedProduct && (
                <button onClick={() => setSelectedProductKey("")}
                  disabled={productGroups.length === 1}
                  style={{padding:"8px 12px",borderRadius:9,border:"1px solid #e2e8f0",
                    background:productGroups.length === 1 ? "#f8fafc" : "#fff",
                    color:productGroups.length === 1 ? "#94a3b8" : "#64748b",
                    fontSize:12,fontWeight:800,cursor:productGroups.length === 1 ? "default" : "pointer",
                    fontFamily:"inherit"}}>
                  Ver todos
                </button>
              )}
            </div>

            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",
              gap:10}}>
              {productGroups.slice(0, 12).map(group => {
                const active = group.key === activeProductKey;
                return (
                  <button key={group.key} onClick={() => setSelectedProductKey(group.key)}
                    style={{textAlign:"left",border:active?"1px solid #185fa5":"1px solid #e2e8f0",
                      borderTop:active?"4px solid #185fa5":"4px solid #e2e8f0",
                      background:active?"#eff6ff":"#fff",borderRadius:11,padding:"13px 14px",
                      boxShadow:active?"0 8px 18px rgba(24,95,165,.14)":"0 1px 3px rgba(15,23,42,.04)",
                      cursor:"pointer",fontFamily:"inherit",transition:"all .16s ease"}}>
                    <div style={{display:"flex",justifyContent:"space-between",gap:10,
                      alignItems:"flex-start",marginBottom:8}}>
                      <span style={{fontSize:10.5,fontWeight:900,color:group.status.color,
                        background:group.status.bg,borderRadius:999,padding:"4px 8px",
                        whiteSpace:"nowrap"}}>
                        {group.status.label}
                      </span>
                      <span style={{fontSize:10.5,color:"#94a3b8",fontWeight:800,
                        whiteSpace:"nowrap"}}>
                        {group.validRefs} refs.
                      </span>
                    </div>
                    <div style={{fontSize:13.5,fontWeight:800,color:"#0f2444",lineHeight:1.35,
                      minHeight:38,marginBottom:10}}>
                      {shortText(group.title, 92)}
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",
                      gap:8}}>
                      <div style={{background:"#f8fafc",border:"1px solid #eef2f7",
                        borderRadius:8,padding:"8px"}}>
                        <div style={{fontSize:9.5,fontWeight:800,color:"#94a3b8",
                          textTransform:"uppercase",letterSpacing:".5px"}}>Mínimo</div>
                        <div style={{fontFamily:"DM Mono,monospace",fontWeight:900,
                          color:"#0f172a",fontSize:13,marginTop:2}}>
                          {group.minPrice ? fullMoney(group.minPrice) : "—"}
                        </div>
                      </div>
                      <div style={{background:"#f8fafc",border:"1px solid #eef2f7",
                        borderRadius:8,padding:"8px"}}>
                        <div style={{fontSize:9.5,fontWeight:800,color:"#94a3b8",
                          textTransform:"uppercase",letterSpacing:".5px"}}>Oferta propia</div>
                        <div style={{fontFamily:"DM Mono,monospace",fontWeight:900,
                          color:"#0f172a",fontSize:13,marginTop:2}}>
                          {group.lastOwn ? comparableMoney(group.lastOwn) : "—"}
                        </div>
                      </div>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",gap:8,
                      color:"#94a3b8",fontSize:10.5,fontWeight:700,marginTop:9}}>
                      <span>{group.institutionsCount} institución{group.institutionsCount !== 1 ? "es" : ""}</span>
                      <span>{group.companiesCount} empresa{group.companiesCount !== 1 ? "s" : ""}</span>
                      <span>{fmtDate(group.latestDate)}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            {productGroups.length > 12 && (
              <div style={{marginTop:10,fontSize:12,color:"#94a3b8",fontWeight:700}}>
                Mostrando los 12 productos más recientes. Usá institución, jurisdicción o una búsqueda más específica para acotar.
              </div>
            )}
          </div>
        )}

        {/* CAPA EJECUTIVA */}
        {showFocusedAnalysis && decision && !loading && (
          <section className="ph-exec">
            <div className="ph-exec__head">
              <div>
                <span className="ph-eyebrow">Decisión comercial</span>
                <h3>{quickDecision?.title || decision.estado.label}</h3>
                <p>{quickDecision?.text || "Revisá las referencias comparables antes de cotizar."}</p>
              </div>
              <div className="ph-exec__badges">
                <span className="ph-status" style={{"--status-bg":decision.estado.bg,"--status-color":decision.estado.color}}>
                  {decision.estado.label}
                </span>
                <span className="ph-status" style={{"--status-bg":decision.confianza.bg,"--status-color":decision.confianza.color}}>
                  Confianza {decision.confianza.level}
                </span>
              </div>
            </div>

            <div className="ph-decision-grid">
              <article className={`ph-decision-card ph-decision-card--primary ph-decision-card--${quickDecision?.tone || "blue"}`}>
                <span>Precio sugerido</span>
                <strong>{decision.sugerido ? fullMoney(decision.sugerido) : "—"}</strong>
                <small>{quickDecision?.action || "Revisar referencias"}</small>
              </article>
              <article className="ph-decision-card">
                <span>Mínimo de mercado</span>
                <strong>{decision.minimoMercado ? fullMoney(decision.minimoMercado) : "—"}</strong>
                <small>{decision.minimoRow?.empresa || "Sin empresa comparable"}</small>
              </article>
              <article className="ph-decision-card">
                <span>Última oferta propia</span>
                <strong>{decision.ultimaPropia ? comparableMoney(decision.ultimaPropia) : "—"}</strong>
                <small>{decision.ultimaPropia ? `${fmtDate(rowDate(decision.ultimaPropia))} · ${decision.ultimaPropia.tenders?.institution || "Sin institución"}` : "Sin cotización propia comparable"}</small>
              </article>
              <article className="ph-decision-card">
                <span>Base de recomendación</span>
                <strong>{fmtDate(decision.fechaFuenteSugerido)}</strong>
                <small>{decision.detalleFuenteSugerido}</small>
              </article>
            </div>

            <details className="ph-evidence ph-evidence--details">
              <summary className="ph-evidence__head">
                <div>
                  <span className="ph-eyebrow">Trazabilidad de la recomendación</span>
                  <strong>Ver cómo se obtuvo el precio sugerido</strong>
                </div>
                <span className={`ph-freshness ph-freshness--${decision.vigenciaSugerido.tone}`}>
                  {decision.vigenciaSugerido.label}
                </span>
              </summary>
              <div className="ph-evidence-grid">
                <article>
                  <CalendarDays size={17}/>
                  <span>Fecha base</span>
                  <strong>{fmtDate(decision.fechaFuenteSugerido)}</strong>
                  <small>{decision.diasFuenteSugerido !== null ? `Hace ${decision.diasFuenteSugerido} días` : "Sin fecha disponible"}</small>
                </article>
                <article>
                  <Database size={17}/>
                  <span>Referencia utilizada</span>
                  <strong>{decision.tipoFuenteSugerido}</strong>
                  <small>{decision.fuenteSugerido?.empresa || "Sin empresa informada"}</small>
                </article>
                <article>
                  <Calculator size={17}/>
                  <span>Criterio de cálculo</span>
                  <strong>Referencia + 2%</strong>
                  <small>Colchón operativo configurable</small>
                </article>
                <article>
                  <FileSpreadsheet size={17}/>
                  <span>Origen del dato</span>
                  <strong>{decision.fuenteSugerido?.tenders?.institution || "Sin institución"}</strong>
                  <small>{decision.fuenteSugerido?.tenders?.process_number || "Sin expediente"}</small>
                </article>
              </div>
            </details>

            <details className="ph-more-metrics">
              <summary>
                <ShieldCheck size={16}/>
                Ver indicadores complementarios
              </summary>
              <div className="ph-exec-grid">
                {[
                  { icon:"◆", label:"Estado comercial", value:decision.estado.label, sub:"Diagnóstico contra mercado comparable", tone:"blue" },
                  { icon:"$", label:"Precio sugerido actual", value:decision.sugerido ? fullMoney(decision.sugerido) : "—", sub:decision.sugerido ? decision.detalleFuenteSugerido : decision.motivo, tone:"green" },
                  { icon:"↕", label:"Diferencia vs mínimo", value:decision.diffMercado === null ? "—" : `${decision.diffMercado > 0 ? "+" : ""}${decision.diffMercado}%`, sub:decision.minimoRow ? `Mínimo: ${decision.minimoRow.empresa}` : "Sin mínimo comparable", tone:decision.diffMercado !== null && decision.diffMercado > 8 ? "red" : "amber" },
                  { icon:"M", label:"Última oferta propia", value:decision.ultimaPropia ? comparableMoney(decision.ultimaPropia) : "—", sub:decision.ultimaPropia ? `${fmtDate(rowDate(decision.ultimaPropia))} · ${decision.ultimaPropia.tenders?.institution || "Sin institución"}` : "Sin cotización propia comparable", tone:"navy" },
                  { icon:"✓", label:"Última adjudicación", value:decision.ultimaAdjudicada ? comparableMoney(decision.ultimaAdjudicada) : "—", sub:decision.ultimaAdjudicada ? `${decision.ultimaAdjudicada.empresa} · ${fmtDate(rowDate(decision.ultimaAdjudicada))}` : "No hay adjudicación cargada", tone:"green" },
                  { icon:"◎", label:"Nivel de confianza", value:decision.confianza.level, sub:`${decision.refs} referencias · ${decision.antiguedad ?? "s/d"} días desde el último dato`, tone:"blue" },
                ].map(card => (
                  <article key={card.label} className={`ph-kpi ph-kpi--${card.tone}`}>
                    <span className="ph-kpi__icon">{card.icon}</span>
                    <span className="ph-kpi__label">{card.label}</span>
                    <strong>{card.value}</strong>
                    <small>{card.sub}</small>
                  </article>
                ))}
              </div>
            </details>
          </section>
        )}

        {showFocusedAnalysis && decision && !loading && (
          <div className="ph-view-tabs">
            {[
              ["resumen", "Resumen ejecutivo"],
              ["historial", "Historial"],
              ["competidores", "Competidores"],
              ["detalle", "Detalle operativo"],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={analysisView === key ? "active" : ""}
                onClick={() => setAnalysisView(key)}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* INTELIGENCIA VISUAL */}
        {showFocusedAnalysis && metricas && !loading && (
          <>
            {analysisView === "resumen" && (
            <div className="ph-grid ph-grid--analysis">
              <section className="ph-panel ph-panel--wide">
                <div className="ph-panel__head">
                  <div>
                    <span className="ph-eyebrow">Evolución de mercado</span>
                    <h3>Precio mínimo, promedio, máximo y oferta propia</h3>
                  </div>
                  <span className="ph-pill">{marketTrend.length} fechas</span>
                </div>
                <MarketEvolutionChart data={marketTrend}/>
              </section>

              <section className="ph-panel">
                <div className="ph-panel__head">
                  <div>
                    <span className="ph-eyebrow">Insights automáticos</span>
                    <h3>Qué mirar ahora</h3>
                  </div>
                </div>
                <div className="ph-insights">
                  {insights.map(item => (
                    <article key={item.label} className="ph-insight">
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                      <small>{item.text}</small>
                    </article>
                  ))}
                </div>
              </section>
            </div>
            )}

            {analysisView === "competidores" && (
            <section className="ph-panel">
              <div className="ph-panel__head">
                <div>
                  <span className="ph-eyebrow">Inteligencia competitiva</span>
                  <h3>Mapa competitivo del producto</h3>
                  <p className="ph-muted">Compará posición de precio, presencia y actividad reciente de cada empresa.</p>
                </div>
                <span className="ph-pill">{competitiveIntel.ranking.length} empresas</span>
              </div>
              <div className="ph-competitive-summary">
                <article>
                  <span>Mínimo de mercado</span>
                  <strong>{decision.minimoMercado ? fullMoney(decision.minimoMercado) : "—"}</strong>
                  <small>{decision.minimoRow?.empresa || "Sin referencia comparable"}</small>
                </article>
                <article>
                  <span>Mayor presencia</span>
                  <strong>{competitiveIntel.frecuentes[0]?.name || "—"}</strong>
                  <small>{competitiveIntel.frecuentes[0] ? `${competitiveIntel.frecuentes[0].refs} referencias · ${competitiveIntel.frecuentes[0].participation}% del total` : "Sin actividad registrada"}</small>
                </article>
                <article>
                  <span>Líder de precio</span>
                  <strong>{competitiveIntel.minimos[0]?.name || "—"}</strong>
                  <small>{competitiveIntel.minimos[0] ? `${competitiveIntel.minimos[0].minimos} mínimo${competitiveIntel.minimos[0].minimos !== 1 ? "s" : ""} registrado${competitiveIntel.minimos[0].minimos !== 1 ? "s" : ""}` : "Sin mínimos comparables"}</small>
                </article>
              </div>

              {competitiveIntel.ranking.length > 0 ? (
                <div className="ph-competitor-table-wrap">
                  <table className="ph-competitor-table">
                    <thead>
                      <tr>
                        <th>Empresa</th>
                        <th>Último precio</th>
                        <th>Vs. mínimo</th>
                        <th>Participación</th>
                        <th>Mínimos</th>
                        <th>Adjudicaciones</th>
                        <th>Última actividad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {competitiveIntel.ranking.map(item => {
                        const diff = item.lastPrice !== null && decision.minimoMercado
                          ? Number(((item.lastPrice - decision.minimoMercado) / decision.minimoMercado * 100).toFixed(1))
                          : null;
                        return (
                          <tr key={item.name}>
                            <td><strong>{item.name}</strong><small>{item.refs} referencia{item.refs !== 1 ? "s" : ""}</small></td>
                            <td className="ph-money">{comparableMoney(item.lastPrice)}</td>
                            <td>{diff === null ? <span className="ph-muted">—</span> : diff === 0 ? <span className="ph-chip ph-chip--ok">Mínimo</span> : <span className="ph-chip ph-chip--bad">+{diff}%</span>}</td>
                            <td>
                              <div className="ph-participation">
                                <span>{item.participation}%</span>
                                <i><b style={{ width:`${item.participation}%` }}/></i>
                              </div>
                            </td>
                            <td>{item.minimos}</td>
                            <td>{item.adjudicaciones || "—"}</td>
                            <td>{fmtDate(item.lastDate)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="ph-muted">No hay competidores comparables para este producto.</p>
              )}
            </section>
            )}

            {analysisView === "historial" && (
            <section className="ph-panel ph-history">
              <div className="ph-panel__head">
                <div>
                  <span className="ph-eyebrow">Historial de mercado</span>
                  <h3>Todas las licitaciones donde aparece el producto</h3>
                </div>
                <span className="ph-pill">{marketRows.length} filas</span>
              </div>
              <div className="ph-history-tools">
                <input value={marketSearch} onChange={e => setMarketSearch(e.target.value)}
                  placeholder="Filtrar por institución, empresa, expediente, resultado..."/>
                <div className="ph-pagination">
                  <button disabled={marketPage <= 1} onClick={() => setMarketPage(p => Math.max(1, p - 1))}>Anterior</button>
                  <span>{marketPage} / {marketTotalPages}</span>
                  <button disabled={marketPage >= marketTotalPages} onClick={() => setMarketPage(p => Math.min(marketTotalPages, p + 1))}>Siguiente</button>
                </div>
              </div>
              <div className="ph-table-wrap">
                <table className="ph-table">
                  <thead>
                    <tr>
                      {[
                        ["fecha","Fecha"],["institucion","Institución"],["jurisdiccion","Jurisdicción"],
                        ["expediente","Expediente"],["renglon","Renglón"],["empresa","Empresa"],
                        ["precio","Precio unitario"],["cantidad","Cantidad"],["total","Total"],
                        ["resultado","Resultado"],["adjudicado","Adjudicado"],["diff","Dif. vs mínimo"],
                      ].map(([key, label]) => (
                        <th key={key}>
                          <button onClick={() => sortMarketBy(key)}>
                            {label} {marketSort.key === key ? (marketSort.dir === "asc" ? "↑" : "↓") : ""}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {marketPageRows.map(item => (
                      <tr key={item.id}>
                        <td>{fmtDate(item.fecha)}</td>
                        <td><strong>{item.institucion}</strong></td>
                        <td>{item.jurisdiccion}</td>
                        <td>{item.expediente}</td>
                        <td>R{item.renglon}</td>
                        <td>{item.empresa}</td>
                        <td className="ph-money">{comparableMoney(item.precio)}</td>
                        <td>{item.cantidad || "—"}</td>
                        <td className="ph-money">{fullMoney(item.total)}</td>
                        <td><span className="ph-chip">{item.resultado}</span></td>
                        <td>{item.adjudicado ? <span className="ph-chip ph-chip--ok">Sí</span> : <span className="ph-muted">—</span>}</td>
                        <td>
                          {item.diff === null
                            ? <span className="ph-chip">—</span>
                            : item.diff === 0
                              ? <span className="ph-chip ph-chip--ok">Mínimo</span>
                              : <span className="ph-chip ph-chip--bad">+{item.diff}%</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            )}

            {analysisView === "detalle" && (
            <div className="ph-detail-title">
              <span className="ph-eyebrow">Detalle operativo</span>
              <h3>Vista por licitación</h3>
            </div>
            )}
          </>
        )}

        {/* RESULTADOS */}
        {showFocusedAnalysis && !loading && analysisView === "detalle" && agrupado.map((grupo, gi) => (
          <div key={grupo.tender?.id||gi} style={{background:"#fff",borderRadius:12,
            border:"1px solid #e2e8f0",overflow:"hidden",boxShadow:"0 1px 4px rgba(15,23,42,.06)"}}>

            {/* Header licitación */}
            <div style={{background:"linear-gradient(135deg,#0f2444 0%,#1a3a6b 100%)",
              padding:"13px 18px",display:"flex",alignItems:"center",
              justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:13.5,color:"#fff",
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {grupo.tender?.institution||"—"}
                </div>
                <div style={{fontSize:11,color:"rgba(255,255,255,.5)",marginTop:2,
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {grupo.tender?.process_number||"—"}
                  {grupo.tender?.process_name?` · ${grupo.tender.process_name}`:""}
                </div>
              </div>
              <div style={{display:"flex",gap:10,alignItems:"center",flexShrink:0}}>
                <div style={{fontSize:11,color:"rgba(255,255,255,.65)",
                  display:"flex",alignItems:"center",gap:5}}>
                  <span>📅</span>
                  <strong style={{color:"#fff"}}>{fmtDate(grupo.tender?.end_date)}</strong>
                </div>
                {grupo.tender?.jurisdiction && (
                  <span style={{fontSize:10,background:"rgba(255,255,255,.12)",
                    color:"rgba(255,255,255,.8)",padding:"2px 8px",borderRadius:20,fontWeight:600}}>
                    {grupo.tender.jurisdiction}
                  </span>
                )}
                <button onClick={() => onNavigate("tenders")}
                  style={{padding:"5px 12px",borderRadius:6,border:"1px solid rgba(255,255,255,.25)",
                    background:"rgba(255,255,255,.12)",color:"#fff",fontSize:11,cursor:"pointer",
                    fontFamily:"inherit",fontWeight:500}}>
                  Ver licitación →
                </button>
              </div>
            </div>

            {/* Renglones */}
            {Object.entries(grupo.renglones).map(([reng, data]) => {
              const min = precioMinRenglon(data.filas);
              const nuestra = data.filas.find(isOwnOffer);
              const nuestraPrice = comparablePrice(nuestra);
              const ganamos = min !== null && nuestraPrice === min;
              const nuestraDiff = pctVsMin(nuestra, min);
              const empresasReng = [...data.filas].sort((a, b) => {
                const pa = comparablePrice(a);
                const pb = comparablePrice(b);
                if (pa === null && pb === null) return String(a.empresa || "").localeCompare(String(b.empresa || ""));
                if (pa === null) return 1;
                if (pb === null) return -1;
                return pa - pb;
              });
              return (
                <div key={reng} style={{borderTop:"1px solid #f0f4f8"}}>
                  <div style={{padding:"10px 18px 8px",background:"#f8fafc",
                    display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,flex:1,minWidth:0}}>
                      <span style={{fontFamily:"DM Mono,monospace",fontWeight:700,fontSize:10.5,
                        color:"#0f2444",background:"#e2e8f0",borderRadius:5,padding:"2px 8px",flexShrink:0}}>
                        R{reng}
                      </span>
                      <span style={{fontSize:12,color:"#334155",fontWeight:500,overflow:"hidden",
                        textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                        {data.descripcion?.slice(0,140)}{(data.descripcion?.length||0)>140?"…":""}
                      </span>
                    </div>
                    {nuestra && (
                      <span style={{fontSize:10,fontWeight:700,borderRadius:20,padding:"3px 10px",
                        whiteSpace:"nowrap",flexShrink:0,
                        background:nuestraPrice === null || min === null ? "#e2e8f0" : ganamos ? "#d4edda" : "#fde8e8",
                        color:nuestraPrice === null || min === null ? "#64748b" : ganamos ? "#166534" : "#7f1d1d"}}>
                        {nuestraPrice === null || min === null
                          ? "Sin precio comparable"
                          : ganamos
                            ? "✓ Precio mínimo"
                            : `+${nuestraDiff}% sobre mínimo`}
                      </span>
                    )}
                  </div>
                  <div style={{overflowX:"auto"}}>
                    <table style={{borderCollapse:"collapse",width:"100%",fontSize:12}}>
                      <thead>
                        <tr style={{background:"#f0f4f8"}}>
                          <th style={thStyle}>Empresa</th>
                          <th style={{...thStyle,textAlign:"right"}}>Precio unitario</th>
                          <th style={{...thStyle,textAlign:"right"}}>Cantidad</th>
                          <th style={{...thStyle,textAlign:"right"}}>Total ARS</th>
                          <th style={{...thStyle,textAlign:"center"}}>vs Mínimo</th>
                          <th style={{...thStyle,textAlign:"center"}}>Adjudicado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {empresasReng.map((f, i) => {
                          const esNuestra = isOwnOffer(f);
                          const price = comparablePrice(f);
                          const esMin = min !== null && price === min;
                          const diff = pctVsMin(f, min);
                          return (
                            <tr key={f.id} style={{
                              background:esNuestra?"#eff6ff":f.adjudicado?"#f0fdf4":i%2===0?"#fff":"#fafbfc",
                              borderBottom:"1px solid #f0f4f8"}}>
                              <td style={{padding:"10px 14px",fontWeight:esNuestra?700:500,color:"#0f172a"}}>
                                {esNuestra&&<span style={{color:"#185fa5",marginRight:5,fontSize:12}}>★</span>}
                                {f.empresa}
                              </td>
                              <td style={{padding:"10px 14px",textAlign:"right",
                                fontFamily:"DM Mono,monospace",fontWeight:700,
                                color:esMin?"#166534":price === null ? "#94a3b8" : "#0f172a"}}>
                                {esMin&&<span style={{marginRight:4,fontSize:10}}>🏆</span>}
                                {comparableMoney(f.precio_unitario)}
                              </td>
                              <td style={{padding:"10px 14px",textAlign:"right",color:"#64748b"}}>{f.cantidad}</td>
                              <td style={{padding:"10px 14px",textAlign:"right",
                                fontFamily:"DM Mono,monospace",color:"#334155"}}>
                                {fullMoney(f.total_ars)}
                              </td>
                              <td style={{padding:"10px 14px",textAlign:"center"}}>
                                {price === null || min === null
                                  ? <span style={{fontSize:10,background:"#eef2f7",color:"#64748b",
                                      borderRadius:20,padding:"3px 10px",fontWeight:700}}>—</span>
                                  : esMin
                                  ?<span style={{fontSize:10,background:"#d4edda",color:"#166534",
                                      borderRadius:20,padding:"3px 10px",fontWeight:700}}>Mínimo</span>
                                  :<span style={{fontSize:10,background:"#fde8e8",color:"#7f1d1d",
                                      borderRadius:20,padding:"3px 10px",fontWeight:600}}>+{diff}%</span>
                                }
                              </td>
                              <td style={{padding:"10px 14px",textAlign:"center"}}>
                                {f.adjudicado
                                  ?<span style={{fontSize:10,background:"#d4edda",color:"#166534",
                                      borderRadius:20,padding:"3px 10px",fontWeight:700}}>✓ ADJ</span>
                                  :<span style={{color:"#e2e8f0",fontSize:11}}>—</span>
                                }
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        ))}

      </div>
    </Layout>
  );
}

const thStyle = {
  padding:"8px 14px", textAlign:"left", fontSize:10, fontWeight:600,
  textTransform:"uppercase", letterSpacing:".5px", color:"#64748b",
  whiteSpace:"nowrap", borderBottom:"1px solid #e2e8f0",
};
