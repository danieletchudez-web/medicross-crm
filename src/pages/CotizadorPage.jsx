import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Layout from "../components/Layout";
import logoUrl from "../assets/logo.jpg";
import { supabase } from "../lib/supabaseClient";
import DashboardComercial from "../components/DashboardComercial";
import CotizadorIntel, { useQuoteHint } from "./CotizadorIntel";
import "./CotizadorPage.css";

const fARS   = (n) => "$ "   + Number(n||0).toLocaleString("es-AR",{minimumFractionDigits:2,maximumFractionDigits:2});
const fUSD   = (n) => "U$D " + Number(n||0).toLocaleString("es-AR",{minimumFractionDigits:2,maximumFractionDigits:2});
const fPct   = (n) => Number(n||0).toFixed(1) + "%";
const parseN = (s) => parseFloat(String(s||"").replace(",",".")) || 0;
const fmtDate = (value) => {
  if (!value) return "Sin fecha";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year.slice(2)}` : "Sin fecha";
};
const normalizeSearchText = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim()
  .replace(/\s+/g, " ");
const searchTokens = (value) => normalizeSearchText(value).split(" ").filter(token => token.length >= 3);
const fieldScore = (value, tokens, weight) => {
  const text = normalizeSearchText(value);
  if (!text || !tokens.length) return 0;
  const words = text.split(" ");
  if (!tokens.every(token => words.some(word => word === token || word.startsWith(token)))) return 0;
  const starts = tokens.every(token => words.some(word => word.startsWith(token)));
  return weight + (text === tokens.join(" ") ? 30 : 0) + (starts ? 10 : 0);
};
const latestByDate = (rows) => [...rows].sort((a, b) =>
  String(b.tenders?.end_date || "").localeCompare(String(a.tenders?.end_date || ""))
)[0] || null;
const OWN_COMPANY_ALIASES = ["MEDI-CROSS", "MEDICROSS", "STORING INSUMOS MEDICOS"];
const isOwnMarketOffer = (row) => {
  const company = normalizeSearchText(row?.empresa).toUpperCase();
  return Boolean(row?.es_nuestra_oferta) || OWN_COMPANY_ALIASES.some(alias => company.includes(normalizeSearchText(alias).toUpperCase()));
};
const parseQuoteNumber = (value) => {
  const n = Number.parseInt(String(value || "").replace(/\D/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const formatQuoteNumber = (value) => {
  const n = parseQuoteNumber(value);
  return n ? String(n).padStart(6, "0") : null;
};
const normalizeFilePart = (value, fallback = "sin_dato") => {
  const clean = String(value || fallback)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .substring(0, 48);
  return clean || fallback;
};
const todayISO = () => new Date().toISOString().slice(0, 10);

function calcR(r, tcGlobal) {
  const tc    = parseN(r.tcInd) > 0 ? parseN(r.tcInd) : tcGlobal;
  const iva   = parseN(r.iva) / 100;
  const mult  = parseN(r.markup) || 1;
  const costo = parseN(r.costo);
  if (costo <= 0 || tc <= 0) return null;
  const cARS    = r.moneda === "ARS" ? costo : costo * tc;
  const cIvaARS = cARS * (1 + iva);
  const cIvaUSD = cIvaARS / tc;
  let pvARSs, pvARSc;
  const pvMan = parseN(r.pvManual);
  if (r.modoManual === "manual" && pvMan > 0) {
    pvARSc = pvMan; pvARSs = pvARSc / (1 + iva);
  } else {
    pvARSs = cARS * mult; pvARSc = pvARSs * (1 + iva);
  }
  const cant  = parseInt(r.cant) || 1;
  const sub   = pvARSc * cant;
  const mkPct = cARS > 0 ? (pvARSs - cARS) / cARS * 100 : 0;
  const gm    = pvARSs > 0 ? (pvARSs - cARS) / pvARSs * 100 : 0;
  return { cARS, cIvaARS, cIvaUSD, pvARSs, pvARSc, pvUSDs: pvARSs/tc, pvUSDc: pvARSc/tc, sub, mkPct, gm, cant, tc };
}

const emptyR = () => ({
  id: Date.now() + Math.random(),
  empresa:"", renglon:"", subitem:"", codigo:"", marca:"", descr:"",
  costo:"", cant:1, moneda:"USD", iva:"10.5", markup:"2",
  tcInd:"", modoManual:"auto", pvManual:"",
  market_reference:null,
});

const VENDEDORES    = ["Monica Somosa","Daniel Etchudez","Soledad Cantero","Otros"];
const ESTADOS       = ["borrador","generado","enviada","evaluacion","aceptada","rechazada","vencida","seguimiento","negociacion","ganada","perdida","facturada","cobrada"];
const ESTADO_LABELS = { borrador:"Borrador", generado:"Generado", enviada:"Enviada", evaluacion:"En evaluación", aceptada:"Aceptada", rechazada:"Rechazada", vencida:"Vencida", seguimiento:"Seguimiento", negociacion:"Negociación", ganada:"Ganada", perdida:"Perdida", facturada:"Facturada", cobrada:"Cobrada" };
const ESTADO_COLORS = {
  borrador:    { bg:"#f3f4f6", color:"#374151" },
  generado:    { bg:"#d1fae5", color:"#065f46" },
  enviada:     { bg:"#dbeafe", color:"#185fa5" },
  evaluacion:  { bg:"#e0e7ff", color:"#4338ca" },
  aceptada:    { bg:"#d1fae5", color:"#047857" },
  rechazada:   { bg:"#fee2e2", color:"#b91c1c" },
  vencida:     { bg:"#ffedd5", color:"#c2410c" },
  seguimiento: { bg:"#fef3c7", color:"#b45309" },
  negociacion: { bg:"#ede9fe", color:"#7c3aed" },
  ganada:      { bg:"#d4edda", color:"#166534" },
  perdida:     { bg:"#fde8e8", color:"#7f1d1d" },
  facturada:   { bg:"#cffafe", color:"#0e7490" },
  cobrada:     { bg:"#d4edda", color:"#064e3b" },
};

function uniqueNames(names) {
  const seen = new Set();
  return names
    .map(v => String(v || "").trim())
    .filter(Boolean)
    .filter(name => {
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function canQuoteUser(user) {
  if (!user?.approved || user?.is_active === false) return false;
  if (user.role === "super_admin") return true;
  return Array.isArray(user.allowed_modules) && user.allowed_modules.includes("cotizador");
}

/* ─── Combobox institución (reutiliza public/instituciones.json) ──── */
const PLAZOS_VENTA = ["Anticipado","Contado","Contado a 7 días","Echeq 15 días","Echeq a 30 días","Echeq a 60 días","Echeq a 90 días","Según Pliego"];
const MANTENIMIENTOS = ["15 días","30 días","60 días","90 días"];
const FORMAS_COBRO = ["Echeq","Transferencia","Cheque Físico","Según pliego"];

let _instCacheCot = null;
async function loadInstCot() {
  if (_instCacheCot) return _instCacheCot;
  const res = await fetch("/instituciones.json");
  _instCacheCot = await res.json();
  return _instCacheCot;
}

function CotInstCombobox({ value, onChange }) {
  const [query,   setQuery]   = useState(value || "");
  const [open,    setOpen]    = useState(false);
  const [results, setResults] = useState([]);
  const wrapRef               = useRef(null);

  useEffect(() => { setQuery(value || ""); }, [value]);

  useEffect(() => {
    function onDown(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  async function handleChange(val) {
    setQuery(val); onChange(val);
    if (val.length < 3) { setResults([]); setOpen(false); return; }
    const data = await loadInstCot();
    const q = val.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const hits = data.filter(r =>
      r.n.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(q) ||
      r.l.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(q)
    ).slice(0, 40);
    setResults(hits);
    setOpen(hits.length > 0);
  }

  function pick(inst) { setQuery(inst.n); onChange(inst.n); setOpen(false); }

  return (
    <div style={{position:"relative",width:"100%"}} ref={wrapRef}>
      <input
        style={{width:"100%"}}
        value={query}
        title={query}
        onChange={e => handleChange(e.target.value)}
        onFocus={e => { e.target.select(); if (results.length > 0) setOpen(true); }}
        placeholder="Buscar hospital, clínica, instituto… o escribir libremente"
        autoComplete="off"
      />
      {open && results.length > 0 && (
        <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,background:"#fff",border:"1px solid #dde3ed",borderRadius:8,boxShadow:"0 8px 24px rgba(0,0,0,.12)",zIndex:9999,maxHeight:260,overflowY:"auto"}}>
          {results.map((inst, idx) => (
            <div key={idx} onMouseDown={() => pick(inst)}
              style={{padding:"8px 12px",borderBottom:"1px solid #f3f4f6",cursor:"pointer"}}
              onMouseEnter={e => e.currentTarget.style.background="#f0f4ff"}
              onMouseLeave={e => e.currentTarget.style.background=""}>
              <div style={{fontWeight:600,fontSize:12,color:"#1e293b",lineHeight:1.3}}>{inst.n}</div>
              <div style={{fontSize:11,color:"#64748b",marginTop:2}}>
                {inst.d && <span>{inst.d} · </span>}
                <span>{inst.l}</span>
                {inst.cp && <span style={{marginLeft:6,background:"#f1f5f9",color:"#475569",borderRadius:4,padding:"1px 5px",fontSize:10}}>{inst.cp}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* Hint contextual por renglón: usa datos de cotizaciones propias ya cargados */
function CotHistHint({ cotHistory, descr, onApply }) {
  const hint = useQuoteHint(cotHistory, descr);
  if (!hint) return null;
  const options = [
    { label: "Conservador", mkPct: hint.p25Markup, price: hint.p25Price },
    { label: "Promedio",    mkPct: hint.medMarkup,  price: hint.medPrice  },
    { label: "Agresivo",    mkPct: hint.p75Markup,  price: hint.p75Price  },
  ].filter(o => o.mkPct != null && o.mkPct > 0);
  return (
    <div className="cot-hist-hint">
      <span>📊</span>
      <span>
        Cotizado internamente <strong>{hint.count}</strong> {hint.count === 1 ? "vez" : "veces"}
        {" · "}Último: <strong>{fARS(hint.lastPrice)}</strong>
        {" · "}Prom: <strong>{fARS(hint.avgPrice)}</strong>
        {hint.avgGM > 0 && <>{" · "}GM prom: <strong>{fPct(hint.avgGM)}</strong></>}
      </span>
      {onApply && options.length > 0 && (
        <div className="cot-hist-hint__sugg">
          <span className="cot-hist-hint__sugg-label">Aplicar:</span>
          {options.map(o => (
            <button key={o.label} type="button" className="cot-hist-hint__sugg-btn"
                    onClick={() => onApply(1 + o.mkPct / 100)}
                    title={`${o.label}: markup ×${(1 + o.mkPct / 100).toFixed(2)} — precio ref. ${fARS(o.price)}`}>
              {o.label} ×{(1 + o.mkPct / 100).toFixed(2)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── UseProductModal ────────────────────────────────────────────────── */
function UseProductModal({ item, renglones, onApply, onClose }) {
  const opts = renglones.map((r, i) => ({
    id: r.id,
    label: `Renglón ${i + 1}${r.descr ? ` — ${r.descr.slice(0, 50)}` : ""}`,
  }));
  const [targetId, setTargetId] = useState(renglones[renglones.length - 1]?.id || "");

  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const fields = [
    { label: "Descripción", value: item.descr },
    { label: "Empresa / Proveedor", value: item.empresa },
    { label: "Marca", value: item.marca },
    { label: "Código", value: item.codigo },
  ].filter(f => f.value);

  return createPortal(
    <div className="qpm-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="qpm-panel upm-panel" role="dialog" aria-modal="true">
        <div className="qpm-header">
          <div className="qpm-title">
            <span className="qpm-num">Usar producto en renglón</span>
          </div>
          <button className="qpm-close" onClick={onClose} title="Cerrar">✕</button>
        </div>

        <div className="upm-body">
          <div className="upm-product">
            <p className="upm-section-lbl">Producto seleccionado</p>
            {fields.map(f => (
              <div key={f.label} className="upm-field">
                <span className="upm-field__lbl">{f.label}</span>
                <span className="upm-field__val">{f.value}</span>
              </div>
            ))}
            {!fields.length && <p className="upm-empty">Sin datos de producto.</p>}
          </div>

          <div className="upm-target">
            <p className="upm-section-lbl">Aplicar en</p>
            {opts.length === 0 ? (
              <p className="upm-empty">No hay renglones en la cotización actual.</p>
            ) : opts.length === 1 ? (
              <p className="upm-single">{opts[0].label}</p>
            ) : (
              <select className="upm-select" value={targetId} onChange={e => setTargetId(e.target.value)}>
                {opts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            )}
          </div>
        </div>

        <div className="qpm-actions">
          <button className="qpm-btn qpm-btn--sec" onClick={onClose}>Cancelar</button>
          <button
            className="qpm-btn qpm-btn--pri"
            disabled={!targetId || !fields.length}
            onClick={() => { onApply(item, targetId); onClose(); }}
          >
            Aplicar al renglón
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ─── QuotePreviewModal ──────────────────────────────────────────────── */
function QuotePreviewModal({ quoteId, onClose, onLoadInEditor, onCreateRevision }) {
  const [cot, setCot]       = useState(null);
  const [loading, setLoad]  = useState(true);
  const [err, setErr]       = useState(null);

  useEffect(() => {
    if (!quoteId) return;
    setLoad(true); setErr(null); setCot(null);
    supabase.from("cotizaciones").select("*").eq("id", quoteId).single()
      .then(({ data, error }) => {
        if (error || !data) setErr("No se pudo cargar la cotización.");
        else setCot(data);
        setLoad(false);
      });
  }, [quoteId]);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const tcG = parseN(cot?.tc) || 1425;
  const rawRenglones = cot?.renglones;
  const renglones = Array.isArray(rawRenglones)
    ? rawRenglones
    : (typeof rawRenglones === "string" ? (() => { try { return JSON.parse(rawRenglones); } catch { return []; } })() : []);
  const total = renglones.reduce((sum, r) => {
    const calc = calcR(r, tcG);
    return sum + (calc ? calc.sub : 0);
  }, 0);
  const estado = cot?.estado || "borrador";
  const badge  = ESTADO_COLORS[estado] || { bg:"#e5e7eb", color:"#374151" };

  return createPortal(
    <div className="qpm-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="qpm-panel" role="dialog" aria-modal="true">
        {/* Header */}
        <div className="qpm-header">
          <div className="qpm-title">
            <span className="qpm-num">Cotización #{cot?.quote_num_formatted || "…"}</span>
            {cot && (
              <span className="qpm-badge" style={{ background: badge.bg, color: badge.color }}>
                {ESTADO_LABELS[estado] || estado}
              </span>
            )}
          </div>
          <button className="qpm-close" onClick={onClose} title="Cerrar">✕</button>
        </div>

        {loading && <div className="qpm-loading">Cargando…</div>}
        {err     && <div className="qpm-err">{err}</div>}

        {cot && !loading && (
          <>
            {/* Meta */}
            <div className="qpm-meta">
              {cot.institucion && <div><span>Institución</span><strong>{cot.institucion}</strong></div>}
              {cot.vendedor    && <div><span>Vendedor</span><strong>{cot.vendedor}</strong></div>}
              {cot.fecha_apert && <div><span>Fecha apertura</span><strong>{cot.fecha_apert}</strong></div>}
              {cot.nro_licit   && <div><span>N° Licitación</span><strong>{cot.nro_licit}</strong></div>}
              <div><span>TC USD→ARS</span><strong>${parseN(cot.tc).toLocaleString("es-AR")}</strong></div>
              {cot.plazo_venta  && <div><span>Plazo de venta</span><strong>{cot.plazo_venta}</strong></div>}
              {cot.forma_cobro  && <div><span>Forma de cobro</span><strong>{cot.forma_cobro}</strong></div>}
            </div>

            {/* Renglones table */}
            <div className="qpm-table-wrap">
              {renglones.length === 0 ? (
                <div className="qpm-empty">Sin renglones cargados en esta cotización.</div>
              ) : (
                <table className="qpm-table">
                  <thead>
                    <tr>
                      <th>#</th><th>Descripción</th><th>Marca</th>
                      <th className="qpm-r">Costo</th>
                      <th className="qpm-r">Markup</th>
                      <th className="qpm-r">PV c/IVA</th>
                      <th className="qpm-r">Cant.</th>
                      <th className="qpm-r">Subtotal</th>
                      <th className="qpm-r">GM %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {renglones.map((r, i) => {
                      const calc = calcR(r, tcG);
                      const rnLabel = [r.renglon, r.subitem].filter(Boolean).join(".");
                      const costoLabel = r.moneda === "ARS"
                        ? fARS(parseN(r.costo))
                        : `USD ${parseN(r.costo).toFixed(2)}`;
                      return (
                        <tr key={i}>
                          <td className="qpm-rn">{rnLabel || i + 1}</td>
                          <td className="qpm-descr" title={r.descr}>{r.descr || "—"}</td>
                          <td>{r.marca || "—"}</td>
                          <td className="qpm-r">{parseN(r.costo) > 0 ? costoLabel : "—"}</td>
                          <td className="qpm-r">{parseN(r.markup) > 0 ? `×${parseN(r.markup).toFixed(2)}` : "—"}</td>
                          <td className="qpm-r">{calc ? fARS(calc.pvARSc) : "—"}</td>
                          <td className="qpm-r">{r.cant || 1}</td>
                          <td className="qpm-r qpm-sub">{calc ? fARS(calc.sub) : "—"}</td>
                          <td className="qpm-r">{calc ? <span className="qpm-gm">{fPct(calc.gm)}</span> : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={7} className="qpm-total-lbl">Total cotización</td>
                      <td className="qpm-r qpm-total">{fARS(total)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </>
        )}

        {/* Actions */}
        <div className="qpm-actions">
          <button className="qpm-btn qpm-btn--sec" onClick={onClose}>Cerrar</button>
          {cot && onCreateRevision && (
            <button className="qpm-btn qpm-btn--rev" onClick={() => { onCreateRevision(quoteId); onClose(); }}
              title="Duplicar esta cotización para modificar precios, conservando el original">
              Nueva versión
            </button>
          )}
          {cot && (
            <button className="qpm-btn qpm-btn--pri" onClick={() => { onLoadInEditor(quoteId); onClose(); }}>
              Cargar en editor
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function CotizadorPage({ profile, onNavigate, initialData, pageKey }) {
  const [vendedor,    setVendedor]    = useState(initialData?.vendedor    || "");
  const [vendedores,  setVendedores]  = useState(VENDEDORES);
  const [tc,          setTc]          = useState("1425");
  const [fechaApert,  setFechaApert]  = useState(initialData?.fechaApert  || "");
  const [nroLicit,    setNroLicit]    = useState(initialData?.nroLicit    || "");
  const [institucion, setInstitucion] = useState(initialData?.institucion || "");
  const [sourceTenderId, setSourceTenderId] = useState(initialData?.tenderId || null);
  const [plazoVenta,  setPlazoVenta]  = useState("");
  const [mantOferta,  setMantOferta]  = useState("");
  const [formaCobro,  setFormaCobro]  = useState("");
  const [condicionesAttempted, setCondicionesAttempted] = useState(false);
  const [renglones,   setRenglones]   = useState([emptyR()]);
  const [docId,       setDocId]       = useState(null);
  const [quoteNum,    setQuoteNum]    = useState(null);
  const [saving,        setSaving]        = useState(false);
  const [toast,         setToast]         = useState(null);
  const [showHistorial, setShowHistorial] = useState(false);
  const [previewQuoteId, setPreviewQuoteId] = useState(null);
  const [useProductItem, setUseProductItem] = useState(null);
  const [showPapelera,  setShowPapelera]  = useState(false);
  const [histItems,      setHistItems]      = useState([]);
  const [papItems,       setPapItems]       = useState([]);
  const [histSearch,     setHistSearch]     = useState("");
  const [filterVendedor, setFilterVendedor] = useState("");
  const [filterMes,      setFilterMes]      = useState("");
  const [loadingHist,    setLoadingHist]    = useState(false);
  const [catalog,        setCatalog]       = useState([]);
  const [catalogOpenId,  setCatalogOpenId] = useState(null);
  const [expirationDays, setExpirationDays] = useState(30);
  const [priceIntel,    setPriceIntel]    = useState({});
  const priceTimers = useRef({});
  const [cotHistory,      setCotHistory]      = useState(null);
  const [activeRenglonId, setActiveRenglonId] = useState(null);
  const cotHistLoadingRef = useRef(false);

  useEffect(() => {
    loadVendedores();
    loadCatalog();
    loadQuoteSettings();
    if (!initialData?.vendedor) {
      const vMatch = vendedores.find(v => profile?.full_name && v.toLowerCase().includes(profile.full_name.split(" ")[0].toLowerCase()));
      if (vMatch) setVendedor(vMatch);
    }
  }, []);

  useEffect(() => {
    if (!initialData?.tenderId) return;
    if (initialData.quoteId) {
      loadCotizacion(initialData.quoteId);
      return;
    }
    setDocId(null);
    setQuoteNum(null);
    setSourceTenderId(initialData.tenderId);
    setInstitucion(initialData.institucion || "");
    setNroLicit(initialData.nroLicit || "");
    setFechaApert(initialData.fechaApert || "");
    if (initialData.vendedor) setVendedor(initialData.vendedor);
    setRenglones([emptyR()]);
    showToast(`Cotización pre-cargada desde Licitaciones: ${initialData.institucion || initialData.nroLicit}`);
    window.scrollTo(0, 0);
  }, [initialData?.tenderId, initialData?.quoteId, initialData?.institucion, initialData?.nroLicit, initialData?.fechaApert, initialData?.vendedor]);

  useEffect(() => {
    if (initialData?.vendedor || vendedor) return;
    const firstName = profile?.full_name?.split(" ")[0]?.toLowerCase();
    if (!firstName) return;
    const vMatch = vendedores.find(v => v.toLowerCase().includes(firstName));
    if (vMatch) setVendedor(vMatch);
  }, [vendedores, profile?.full_name, initialData?.vendedor, vendedor]);

  async function loadVendedores() {
    const { data, error } = await supabase
      .from("profiles")
      .select("full_name,email,role,approved,is_active,allowed_modules")
      .order("full_name", { ascending: true });

    if (error) return;

    const dynamicNames = (data || [])
      .filter(canQuoteUser)
      .map(u => u.full_name || u.email);

    setVendedores(uniqueNames([...dynamicNames, ...VENDEDORES]));
  }

  async function loadCatalog() {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("name", { ascending: true });
    if (!error) setCatalog(data || []);
  }

  async function loadQuoteSettings() {
    const { data } = await supabase
      .from("crm_settings")
      .select("value")
      .eq("key", "quote_expiration_days")
      .maybeSingle();
    const configured = Number(data?.value?.days);
    if (configured > 0) setExpirationDays(configured);
  }

  /* ── Historial cotizaciones (hint contextual) ── */
  async function loadCotHistory() {
    if (cotHistLoadingRef.current || cotHistory !== null) return;
    cotHistLoadingRef.current = true;
    const { data } = await supabase
      .from("cotizaciones")
      .select("tc, renglones, fecha_apert, created_at, estado, institucion")
      .eq("deleted", false)
      .limit(300);
    const flat = [];
    for (const cot of (data || [])) {
      const tcG = parseN(cot.tc) || 1425;
      for (const r of (cot.renglones || [])) {
        if (!r.descr) continue;
        const c = calcR(r, tcG);
        if (!c) continue;
        flat.push({ descr: r.descr, pvARSc: c.pvARSc, mkPct: c.mkPct, gm: c.gm, fecha: cot.fecha_apert || cot.created_at?.slice(0, 10) });
      }
    }
    setCotHistory(flat);
  }

  /* ── A. Usar desde Inteligencia Comercial ── */
  function handleUseFromIntel(item) {
    setUseProductItem(item);
  }

  function applyProductToRenglon(item, targetId) {
    setRenglones(prev => prev.map(r => {
      if (r.id !== targetId) return r;
      return {
        ...r,
        descr:   item.descr   || r.descr,
        empresa: item.empresa  || r.empresa,
        codigo:  item.codigo   || r.codigo,
        marca:   item.marca    || r.marca,
      };
    }));
    const rIdx = renglones.findIndex(r => r.id === targetId);
    showToast(`Producto copiado al Renglón ${rIdx + 1} ✓`);
  }

  /* ── Aplicar sugerencia de markup desde CotHistHint ── */
  function handleApplySuggestion(markupMult) {
    const targetId = activeRenglonId || renglones[renglones.length - 1]?.id;
    if (!targetId) return;
    setRenglones(prev => prev.map(r =>
      r.id !== targetId ? r : { ...r, markup: String(markupMult.toFixed(3)), modoManual: "auto" }
    ));
    showToast(`Markup aplicado: ×${markupMult.toFixed(2)}`);
  }

  /* ── Price Intelligence ── */
  function getPriceStatus(pvARSc, minMarket) {
    if (!pvARSc || !minMarket) return null;
    const diff = (pvARSc - minMarket) / minMarket * 100;
    if (diff <= 0) return "ok";
    if (diff <= 8) return "cerca";
    return "riesgo";
  }

  async function fetchPriceIntel(rowId, descr) {
    const queryTokens = searchTokens(descr);
    if (!queryTokens.length) {
      setPriceIntel(prev => { const n = {...prev}; delete n[rowId]; return n; });
      return;
    }
    setPriceIntel(prev => ({ ...prev, [rowId]: { loading: true } }));
    const { data, error } = await supabase
      .from("tender_comparativas")
      .select(`
        id, tender_id, renglon, descripcion, empresa, es_nuestra_oferta,
        precio_unitario, cantidad, total_ars,
        tenders:tender_id ( id, institution, process_number, end_date )
      `)
      .ilike("descripcion", `%${queryTokens[0].slice(0, 3)}%`)
      .limit(160);
    if (error) {
      setPriceIntel(prev => ({ ...prev, [rowId]: { loading: false, refs: 0, suggestions: [] } }));
      return;
    }
    const grouped = {};
    (data || []).forEach(row => {
      const score = fieldScore(row.descripcion, queryTokens, 100);
      const price = Number(row.precio_unitario);
      if (!score || !Number.isFinite(price) || price < 1) return;
      const key = normalizeSearchText(row.descripcion);
      if (!grouped[key]) grouped[key] = { key, description: row.descripcion, score, rows: [] };
      grouped[key].score = Math.max(grouped[key].score, score);
      grouped[key].rows.push(row);
    });

    const suggestions = Object.values(grouped).map(group => {
      const competitorRows = group.rows.filter(row => !isOwnMarketOffer(row));
      const marketRows = competitorRows.length ? competitorRows : group.rows;
      const minRow = marketRows.reduce((best, row) =>
        Number(row.precio_unitario) < Number(best.precio_unitario) ? row : best
      , marketRows[0]);
      const ownRows = group.rows.filter(isOwnMarketOffer);
      const lastOwnRow = latestByDate(ownRows);
      return {
        ...group,
        refs: group.rows.length,
        minMarket: Number(minRow.precio_unitario),
        minRow,
        lastOwn: lastOwnRow ? Number(lastOwnRow.precio_unitario) : null,
        lastOwnRow,
        suggested: Math.round(Number(minRow.precio_unitario) * 1.02),
        latestRow: latestByDate(group.rows),
      };
    }).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(b.latestRow?.tenders?.end_date || "").localeCompare(String(a.latestRow?.tenders?.end_date || ""));
    }).slice(0, 6);

    const exact = suggestions.find(suggestion => suggestion.key === normalizeSearchText(descr));
    setPriceIntel(prev => ({
      ...prev,
      [rowId]: { loading: false, refs: suggestions.reduce((sum, item) => sum + item.refs, 0), suggestions, selected: exact || null },
    }));
  }

  function debouncedFetchPriceIntel(rowId, descr) {
    clearTimeout(priceTimers.current[rowId]);
    priceTimers.current[rowId] = setTimeout(() => fetchPriceIntel(rowId, descr), 650);
  }

  function applySuggestedPrice(rowId, suggested) {
    setRenglones(prev => prev.map(r => r.id === rowId
      ? { ...r, modoManual: "manual", pvManual: String(suggested) }
      : r
    ));
    showToast("Precio sugerido de mercado aplicado ✓");
  }

  async function getNextQuoteNumber() {
    const { data: numData, error: numError } = await supabase.rpc("next_quote_number");
    const rpcNumber = parseQuoteNumber(numData);
    if (!numError && rpcNumber) return rpcNumber;

    const { data, error } = await supabase
      .from("cotizaciones")
      .select("quote_number,quote_num_formatted")
      .order("quote_number", { ascending: false, nullsFirst: false })
      .limit(20);

    if (error) throw numError || error;

    const maxNumber = (data || []).reduce((max, row) => {
      const number = parseQuoteNumber(row.quote_number) || parseQuoteNumber(row.quote_num_formatted);
      return number && number > max ? number : max;
    }, 0);

    return maxNumber + 1;
  }

  function showToast(msg, type = "ok") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  const totalGeneral = renglones.reduce((s, r) => s + (calcR(r, parseN(tc))?.sub || 0), 0);
  const hasMeaningfulQuoteData = Boolean(
    sourceTenderId ||
    fechaApert.trim() ||
    nroLicit.trim() ||
    institucion.trim() ||
    plazoVenta.trim() ||
    mantOferta.trim() ||
    formaCobro.trim() ||
    renglones.some((row) => [
      row.empresa,
      row.renglon,
      row.subitem,
      row.codigo,
      row.marca,
      row.descr,
      row.costo,
      row.tcInd,
      row.pvManual,
      row.catalog_product_id,
    ].some((value) => String(value || "").trim()))
  );

  const hasCondicionesCompletas = Boolean(plazoVenta.trim() && mantOferta.trim() && formaCobro.trim());

  const missingCondiciones = [
    !plazoVenta.trim() && "Plazo de venta",
    !mantOferta.trim() && "Mantenimiento oferta",
    !formaCobro.trim() && "Forma de cobro",
  ].filter(Boolean);

  const updateR = (id, key, val) => setRenglones(prev => prev.map(r => r.id === id ? {
    ...r,
    [key]: val,
    ...(key === "descr" ? { market_reference: null } : {}),
  } : r));
  const catalogMatches = (query) => {
    const tokens = searchTokens(query);
    if (!tokens.length) return [];
    return catalog
      .map(product => ({
        product,
        score: Math.max(
          fieldScore(product.name, tokens, 120),
          fieldScore(product.sku, tokens, 110),
          fieldScore(product.brand, tokens, 90),
          fieldScore(product.line, tokens, 70),
          fieldScore(product.supplier, tokens, 60),
        ),
      }))
      .filter(match => match.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(match => match.product)
      .slice(0, 6);
  };
  const selectCatalogProduct = (rowId, product) => {
    setRenglones(prev => prev.map(row => row.id === rowId ? {
      ...row,
      catalog_product_id: product.id,
      empresa: product.supplier || row.empresa,
      codigo: product.sku || row.codigo,
      marca: product.brand || product.line || row.marca,
      descr: product.speech || product.name || row.descr,
      costo: product.base_price ? String(product.base_price) : row.costo,
      market_reference: null,
    } : row));
    setCatalogOpenId(null);
    debouncedFetchPriceIntel(rowId, product.speech || product.name || "");
  };
  const selectMarketReference = (rowId, reference) => {
    setRenglones(prev => prev.map(row => row.id === rowId ? {
      ...row,
      descr: reference.description,
      market_reference: {
        description: reference.description,
        suggested: reference.suggested,
        min_market: reference.minMarket,
        company: reference.minRow?.empresa || "",
        institution: reference.minRow?.tenders?.institution || "",
        date: reference.minRow?.tenders?.end_date || "",
        tender_id: reference.minRow?.tender_id || null,
        refs: reference.refs,
      },
    } : row));
    setPriceIntel(prev => ({
      ...prev,
      [rowId]: { ...(prev[rowId] || {}), loading: false, selected: reference },
    }));
    setCatalogOpenId(null);
  };
  const addR    = () => setRenglones(prev => [...prev, emptyR()]);
  const removeR = (id) => {
    if (renglones.length <= 1) { showToast("Debe haber al menos un renglón","err"); return; }
    setRenglones(prev => prev.filter(r => r.id !== id));
  };

  function nuevaCotizacion() {
    if (docId && !confirm("¿Crear nueva cotización? Los datos sin guardar se perderán.")) return;
    setDocId(null); setQuoteNum(null); setSourceTenderId(null);
    setVendedor(""); setTc("1425"); setFechaApert(""); setNroLicit("");
    setInstitucion(""); setPlazoVenta(""); setMantOferta(""); setFormaCobro("");
    setRenglones([emptyR()]);
    const vMatch = vendedores.find(v => profile?.full_name && v.toLowerCase().includes(profile.full_name.split(" ")[0].toLowerCase()));
    if (vMatch) setVendedor(vMatch);
    window.scrollTo(0,0);
  }

  function buildSnap(quoteNumber, quoteNumFormatted) {
    const snap = {
      vendedor, tc: parseN(tc), fecha_apert: fechaApert||null, nro_licit: nroLicit||null,
      institucion: institucion||null, plazo_venta: plazoVenta||null,
      mant_oferta: mantOferta||null, forma_cobro: formaCobro||null,
      renglones: renglones.map(r => ({
        empresa:r.empresa, renglon:r.renglon, subitem:r.subitem, codigo:r.codigo,
        marca:r.marca, descr:r.descr, costo:r.costo, cant:r.cant, moneda:r.moneda,
        iva:String(r.iva), markup:String(r.markup), tcInd:r.tcInd||"",
        modoManual:r.modoManual||"auto", pvManual:r.pvManual||"",
        catalog_product_id:r.catalog_product_id||null,
        market_reference:r.market_reference||null,
      })),
      total_general: totalGeneral,
      updated_at: new Date().toISOString(),
      updated_by: profile?.email || "desconocido",
      owner_id: profile?.id || null,
    };
    if (quoteNumber)       snap.quote_number       = quoteNumber;
    if (quoteNumFormatted) snap.quote_num_formatted = quoteNumFormatted;
    return snap;
  }

  async function linkTenderToQuote(quoteId) {
    if (!sourceTenderId || !quoteId) return;
    const { error } = await supabase
      .from("tenders")
      .update({ linked_quote_id: quoteId, updated_at: new Date().toISOString() })
      .eq("id", sourceTenderId);
    if (error) showToast("La cotización se guardó, pero no se pudo vincular a la licitación: " + error.message, "err");
  }

  async function saveCotizacion({ silent = false } = {}) {
    if (!hasMeaningfulQuoteData) {
      if (!silent) showToast("Completá al menos un dato de la cotización antes de guardar.", "err");
      return { ok: false, reason: "empty_quote" };
    }
    if (!institucion.trim()) {
      showToast("La institución es obligatoria. Completá el campo Institución / Hospital antes de guardar.", "err");
      return { ok: false, reason: "no_institution" };
    }
    setSaving(true);
    try {
      if (docId) {
        let quoteNumberToSave;
        let quoteFormattedToSave;
        if (!formatQuoteNumber(quoteNum)) {
          quoteNumberToSave = await getNextQuoteNumber();
          quoteFormattedToSave = formatQuoteNumber(quoteNumberToSave);
        }
        const { error } = await supabase
          .from("cotizaciones")
          .update(buildSnap(quoteNumberToSave, quoteFormattedToSave))
          .eq("id", docId);
        if (error) throw error;
        await linkTenderToQuote(docId);
        if (quoteFormattedToSave) setQuoteNum(quoteFormattedToSave);
        const savedQuoteNum = quoteFormattedToSave || quoteNum;
        if (!silent) showToast(`Cotización #${savedQuoteNum} actualizada ✓`);
        setSaving(false);
        return { ok: true, quoteNum: savedQuoteNum };
      } else {
        const qNum = await getNextQuoteNumber();
        const qFormatted = formatQuoteNumber(qNum);
        if (!qFormatted) throw new Error("No se pudo generar un número de cotización válido.");
        const snap = { ...buildSnap(qNum, qFormatted), created_at: new Date().toISOString(), created_by: profile?.email||"desconocido", estado:"borrador", deleted:false };
        const { data: newRow, error } = await supabase.from("cotizaciones").insert([snap]).select().single();
        if (error) throw error;
        setDocId(newRow.id); setQuoteNum(qFormatted);
        await linkTenderToQuote(newRow.id);
        if (!silent) showToast(`Cotización #${qFormatted} guardada ✓`);
        setSaving(false);
        return { ok: true, quoteNum: qFormatted, docId: newRow.id };
      }
    } catch(e) {
      showToast("Error al guardar: " + e.message, "err");
      setSaving(false);
      return { ok: false, error: e };
    }
  }

  async function guardar() {
    await saveCotizacion();
  }

  async function ensureSavedForExport() {
    const isRevision = String(quoteNum || "").includes("-R");
    const validQuoteNum = isRevision ? quoteNum : formatQuoteNumber(quoteNum);
    if (validQuoteNum) return { quoteNum: validQuoteNum, savedDocId: docId };
    const result = await saveCotizacion({ silent: true });
    if (!result.ok) return null;
    return { quoteNum: result.quoteNum, savedDocId: result.docId };
  }

  async function abrirHistorial() {
    setLoadingHist(true); setShowHistorial(true);
    const { data, error } = await supabase.from("cotizaciones").select("*").eq("deleted",false).order("created_at",{ascending:false}).limit(100);
    if (!error) {
      const now = Date.now();
      const nextItems = (data || []).map((quote) => {
        const openedAt = quote.fecha_apert || quote.created_at;
        const daysOpen = openedAt ? Math.floor((now - new Date(openedAt).getTime()) / 86400000) : 0;
        if (["enviada", "evaluacion"].includes(quote.estado) && daysOpen > expirationDays) return { ...quote, estado: "vencida" };
        return quote;
      });
      const expired = nextItems.filter((quote, index) => quote.estado === "vencida" && data[index]?.estado !== "vencida");
      if (expired.length) await Promise.all(expired.map((quote) => supabase.from("cotizaciones").update({ estado: "vencida", updated_at: new Date().toISOString() }).eq("id", quote.id)));
      setHistItems(nextItems);
    } else showToast("Error: "+error.message,"err");
    setLoadingHist(false);
  }

  async function cambiarEstado(id, estado) {
    const { error } = await supabase.from("cotizaciones").update({ estado, updated_at:new Date().toISOString(), updated_by:profile?.email||"" }).eq("id",id);
    if (!error) { setHistItems(prev=>prev.map(c=>c.id===id?{...c,estado}:c)); showToast("Estado actualizado"); }
    else showToast("Error: "+error.message,"err");
  }

  async function convertAcceptedQuote(quote) {
    if (quote.accepted_opportunity_id) {
      showToast("Esta cotización ya fue convertida en oportunidad.");
      return;
    }
    const { data: account } = await supabase
      .from("accounts")
      .select("id")
      .ilike("name", quote.institucion || "")
      .limit(1)
      .maybeSingle();
    const firstProduct = (quote.renglones || []).find((row) => row.catalog_product_id);
    const payload = {
      name: `Cotización #${quote.quote_num_formatted || quote.quote_number || ""}${quote.institucion ? ` · ${quote.institucion}` : ""}`,
      account_id: account?.id || null,
      product_id: firstProduct?.catalog_product_id || null,
      stage: "Ganado",
      amount: Number(quote.total_general || 0),
      forecast_amount: Number(quote.total_general || 0),
      probability: 100,
      next_action: "Coordinar entrega y seguimiento postventa",
      source_quote_id: quote.id,
      owner_id: profile?.id || null,
      updated_at: new Date().toISOString(),
    };
    const { data: opportunity, error } = await supabase.from("opportunities").insert([payload]).select("id").single();
    if (error) { showToast("No se pudo crear la oportunidad: " + error.message, "err"); return; }
    await supabase.from("cotizaciones").update({ accepted_opportunity_id: opportunity.id, updated_at: new Date().toISOString() }).eq("id", quote.id);
    setHistItems(prev => prev.map(item => item.id === quote.id ? { ...item, accepted_opportunity_id: opportunity.id } : item));
    showToast("Oportunidad ganada creada desde la cotización.");
  }

  async function softDelete(id, num) {
    if (!confirm(`¿Borrar cotización #${num}?`)) return;
    const { error } = await supabase.from("cotizaciones").update({ deleted:true, deleted_at:new Date().toISOString(), deleted_by_name:profile?.full_name||profile?.email||"desconocido" }).eq("id",id);
    if (!error) { setHistItems(prev=>prev.filter(c=>c.id!==id)); showToast("Cotización eliminada"); }
    else showToast("Error: "+error.message,"err");
  }

  async function abrirPapelera() {
    setShowPapelera(true);
    const { data, error } = await supabase.from("cotizaciones").select("id,quote_num_formatted,vendedor,institucion,total_general,deleted_at,deleted_by_name").eq("deleted",true).order("deleted_at",{ascending:false});
    if (!error) setPapItems(data||[]); else showToast("Error: "+error.message,"err");
  }

  async function restaurar(id, num) {
    if (!confirm(`¿Restaurar #${num}?`)) return;
    const { error } = await supabase.from("cotizaciones").update({ deleted:false, deleted_at:null, deleted_by_name:null, updated_at:new Date().toISOString() }).eq("id",id);
    if (!error) { setPapItems(prev=>prev.filter(c=>c.id!==id)); showToast(`Cotización #${num} restaurada`); }
    else showToast("Error: "+error.message,"err");
  }

  async function createRevision(sourceId) {
    const { data: source, error: fetchErr } = await supabase.from("cotizaciones").select("*").eq("id", sourceId).single();
    if (fetchErr || !source) { showToast("No se pudo cargar la cotización original", "err"); return; }

    // Detectar número base (sin sufijo -Rn) para buscar revisiones existentes
    const baseNum = (source.quote_num_formatted || "").replace(/-R\d+$/, "");

    // Buscar revisiones existentes por patrón de número (sin necesitar columnas nuevas en DB)
    const { data: existingRevs } = await supabase
      .from("cotizaciones")
      .select("quote_num_formatted")
      .ilike("quote_num_formatted", `${baseNum}-R%`)
      .eq("deleted", false);
    const maxRev = (existingRevs || []).reduce((max, r) => {
      const m = String(r.quote_num_formatted || "").match(/-R(\d+)$/);
      return m ? Math.max(max, parseInt(m[1], 10)) : max;
    }, 0);
    const nextRevNum = maxRev + 1;
    const revFormatted = `${baseNum}-R${nextRevNum}`;

    // Snap con campos explícitos — evita enviar columnas que no están en el schema cache de PostgREST
    const snap = {
      vendedor:     source.vendedor       || null,
      tc:           source.tc             || null,
      fecha_apert:  source.fecha_apert    || null,
      nro_licit:    source.nro_licit      || null,
      institucion:  source.institucion    || null,
      plazo_venta:  source.plazo_venta    || null,
      mant_oferta:  source.mant_oferta    || null,
      forma_cobro:  source.forma_cobro    || null,
      renglones:    source.renglones      || [],
      total_general:source.total_general  || 0,
      owner_id:     source.owner_id       || null,
      quote_num_formatted: revFormatted,
      quote_number: null,
      estado: "borrador",
      created_at:   new Date().toISOString(),
      created_by:   profile?.email || "desconocido",
      updated_at:   new Date().toISOString(),
      updated_by:   profile?.email || "",
      deleted: false, deleted_at: null, deleted_by_name: null,
    };

    const { data: newRow, error: insertErr } = await supabase.from("cotizaciones").insert([snap]).select().single();
    if (insertErr) {
      showToast("Error al crear revisión: " + insertErr.message, "err");
      return;
    }
    setHistItems(prev => [newRow, ...prev]);
    await loadCotizacion(newRow.id);
    showToast(`Revisión ${revFormatted} creada — modificá los precios y guardá ✓`);
  }

  async function loadCotizacion(id) {
    const { data, error } = await supabase.from("cotizaciones").select("*").eq("id",id).single();
    if (error||!data) { showToast("No encontrada","err"); return; }
    const rawNum = data.quote_num_formatted || data.quote_number;
    const isRevision = String(rawNum || "").includes("-R");
    const displayNum = isRevision ? rawNum : (formatQuoteNumber(rawNum) || "?");
    setDocId(data.id); setQuoteNum(displayNum);
    setSourceTenderId(data.tender_id || null);
    setVendedor(data.vendedor||""); setTc(String(data.tc||"1425"));
    setFechaApert(data.fecha_apert||""); setNroLicit(data.nro_licit||"");
    setInstitucion(data.institucion||""); setPlazoVenta(data.plazo_venta||"");
    setMantOferta(data.mant_oferta||""); setFormaCobro(data.forma_cobro||"");
    const raws = data.renglones||[];
    setRenglones(raws.length>0 ? raws.map(r=>({
      id:Date.now()+Math.random(), empresa:r.empresa||"", renglon:r.renglon||"", subitem:r.subitem||"",
      codigo:r.codigo||"", marca:r.marca||"", descr:r.descr||"", costo:r.costo||"",
      cant:r.cant||1, moneda:r.moneda||"USD", iva:String(r.iva||"10.5"), markup:String(r.markup||"2"),
      tcInd:r.tcInd||"", modoManual:r.modoManual||"auto", pvManual:r.pvManual||"",
      catalog_product_id:r.catalog_product_id||null,
      market_reference:r.market_reference||null,
    })) : [emptyR()]);
    setShowHistorial(false);
    showToast(`Cotización #${data.quote_num_formatted||"?"} cargada`);
    window.scrollTo(0,0);
  }

  const histVendedores = useMemo(() => [...new Set(histItems.map(c=>c.vendedor).filter(Boolean))].sort(), [histItems]);
  const histMeses = useMemo(() => {
    const meses = [...new Set(histItems.map(c=>c.created_at?.slice(0,7)).filter(Boolean))].sort().reverse();
    return meses;
  }, [histItems]);
  function fmtMes(ym) {
    const [y,m] = (ym||"").split("-");
    return ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"][parseInt(m)-1]+" "+y;
  }
  const histFiltrado = useMemo(() => {
    let items = histItems;
    if (histSearch) {
      const q = histSearch.toLowerCase();
      items = items.filter(c => [c.quote_num_formatted,c.vendedor,c.institucion,c.nro_licit,(c.renglones||[]).map(r=>(r.descr||"")+" "+(r.empresa||"")+" "+(r.marca||"")).join(" ")].join(" ").toLowerCase().includes(q));
    }
    if (filterVendedor) items = items.filter(c => c.vendedor === filterVendedor);
    if (filterMes)      items = items.filter(c => c.created_at?.slice(0,7) === filterMes);
    return items;
  }, [histItems, histSearch, filterVendedor, filterMes]);

  // Agrupa revisiones bajo su cotización original
  const histAgrupado = useMemo(() => {
    const isRev = n => /-R\d+$/.test(n || "");
    const originals = histFiltrado.filter(c => !isRev(c.quote_num_formatted));
    const revisions = histFiltrado.filter(c =>  isRev(c.quote_num_formatted));
    const revsByBase = {};
    revisions.forEach(r => {
      const base = (r.quote_num_formatted || "").replace(/-R\d+$/, "");
      (revsByBase[base] = revsByBase[base] || []).push(r);
    });
    const groups = originals.map(o => ({
      original: o,
      revisions: (revsByBase[o.quote_num_formatted || ""] || [])
        .sort((a,b) => {
          const na = +((a.quote_num_formatted||"").match(/-R(\d+)$/)?.[1]||0);
          const nb = +((b.quote_num_formatted||"").match(/-R(\d+)$/)?.[1]||0);
          return nb - na;
        }),
    }));
    const includedRevIds = new Set(groups.flatMap(g => g.revisions.map(r => r.id)));
    const orphans = revisions.filter(r => !includedRevIds.has(r.id)).map(r => ({ original: r, revisions: [] }));
    return [...groups, ...orphans];
  }, [histFiltrado]);

  /* ── Export PDF ── */
  async function exportPDF() {
    if (!hasCondicionesCompletas) {
      setCondicionesAttempted(true);
      showToast(`Completá antes de exportar: ${missingCondiciones.join(", ")}`, "err");
      return;
    }
    const hasData = renglones.some(r => parseN(r.costo) > 0);
    if (!hasData) { showToast("Ingresá el costo en al menos un renglón","err"); return; }
    const exportResult = await ensureSavedForExport();
    if (!exportResult) return;
    const { quoteNum: exportQuoteNum, savedDocId } = exportResult;
    const tcN   = parseN(tc);
    const fecha = new Date().toLocaleDateString("es-AR",{day:"2-digit",month:"long",year:"numeric"});

    // Fetch logo image for PDF embedding
    let logoImgW = 1400, logoImgH = 400, logoStr = null;
    try {
      const resp = await fetch(logoUrl);
      const buf  = await resp.arrayBuffer();
      const lb   = new Uint8Array(buf);
      for (let i = 0; i < lb.length - 8; i++) {
        if (lb[i] === 0xFF && (lb[i+1] === 0xC0 || lb[i+1] === 0xC2 || lb[i+1] === 0xC1)) {
          logoImgH = (lb[i+5] << 8) | lb[i+6];
          logoImgW = (lb[i+7] << 8) | lb[i+8];
          break;
        }
      }
      let s = "";
      for (let i = 0; i < lb.length; i++) s += String.fromCharCode(lb[i]);
      logoStr = s;
    } catch(e) { /* logo no crítico, cae en texto */ }
    const esc   = (t) => String(t||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[\\]/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)").replace(/[^\x20-\x7E]/g,"").substring(0,110);

    // Splits description text respecting \n and word-wrapping long lines
    function splitDescr(text, maxChars) {
      const out = [];
      for (const para of String(text||"").split(/\n/)) {
        const clean = para.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^\x20-\x7E]/g," ").trim();
        if (!clean) continue;
        if (clean.length <= maxChars) { out.push(clean); continue; }
        const words = clean.split(/\s+/);
        let cur = "";
        for (const w of words) {
          if (!cur) { cur = w; continue; }
          if ((cur+" "+w).length <= maxChars) { cur += " "+w; } else { out.push(cur); cur = w; }
        }
        if (cur) out.push(cur);
      }
      return out;
    }

    const W=595.28, H=841.89;
    // HDR dinámico: mide el contenido real para evitar espacio vacío
    const _nLict = [nroLicit,fechaApert,institucion,plazoVenta,mantOferta,formaCobro].filter(Boolean).length;
    const _hasLicit = !!(nroLicit||institucion||fechaApert);
    const _centerDepth = vendedor ? 82 : 65;                          // bottom of center column (pt from top)
    const _licitDepth  = _hasLicit ? Math.max(27, 24+_nLict*10) : 0; // bottom of licit block
    const HDR = Math.max(Math.max(_centerDepth,_licitDepth)+14, 82);  // +14 padding, min 82
    let ps=[], pageY=H, pages=[];

    const txt  = (x,y,t,sz,b) => ps.push(`BT /${b?"F2":"F1"} ${sz} Tf ${x} ${y} Td (${esc(t)}) Tj ET`);
    const fill = (x,y,w,h,r,g,b) => ps.push(`${r} ${g} ${b} rg ${x} ${y} ${w} ${h} re f 0 0 0 rg`);
    const strk = (x,y,w,h,r,g,b,lw=0.5) => ps.push(`${r} ${g} ${b} RG ${lw} w ${x} ${y} ${w} ${h} re S 0 0 0 RG`);
    const hln  = (x1,y1,x2,r,g,b,lw=0.5) => ps.push(`${r} ${g} ${b} RG ${lw} w ${x1} ${y1} m ${x2} ${y1} l S 0 0 0 RG`);
    const vln  = (x,y1,y2,r,g,b,lw=0.5) => ps.push(`${r} ${g} ${b} RG ${lw} w ${x} ${y1} m ${x} ${y2} l S 0 0 0 RG`);
    const img  = (x,y,w,h) => ps.push(`q ${w} 0 0 ${h} ${x} ${y} cm /Logo Do Q`);

    function drawHeader() {
     // Fondo blanco para todo el header
     fill(0, H-HDR, W, HDR, 1, 1, 1);

     // Fondo blanco en zona logo
     fill(0, H-HDR, 192, HDR, 1, 1, 1);

     // Logo imagen (o texto de fallback si no cargó)
     if (logoStr) {
       const lgW = 150, lgH = Math.round(150 * logoImgH / logoImgW);
       img(21, H - HDR + Math.round((HDR - lgH) / 2), lgW, lgH);
     } else {
       ps.push(".055 .373 .659 rg");
       txt(26, H-HDR+(HDR/2)+8, "MediCross", 22, true);
       ps.push(".055 .373 .659 rg");
       txt(26, H-HDR+(HDR/2)-10, "Productos Medicos Integrales", 7, false);
     }
     ps.push("0 0 0 rg");

      // Línea azul inferior del header
      hln(0, H-HDR-1, W, .055, .373, .659, 2);

      // Separador vertical entre logo y contenido central
      vln(192, H-12, H-HDR+8, .82, .82, .82, .5);

      // Contenido central
      const cx = 202;
      ps.push(".055 .373 .659 rg");
      txt(cx, H-22, "ANALISIS DE PRECIOS", 15, true);
      ps.push(".30 .30 .30 rg");
      txt(cx, H-36, "Drogueria Medi-Cross S.R.L.", 9, false);
      const numLabel = "Cotizacion #"+exportQuoteNum;
      ps.push(".20 .20 .20 rg");
      txt(cx, H-48, numLabel+" | "+fecha, 7.8, true);
      ps.push(".45 .45 .45 rg");
      txt(cx, H-60, "TC: $"+tcN.toLocaleString("es-AR")+" ARS/USD", 7.5, false);

      if (vendedor) {
        fill(cx, H-79, 175, 13, .91, .95, .99);
        strk(cx, H-79, 175, 13, .055, .373, .659, .4);
        ps.push(".055 .373 .659 rg");
        txt(cx+5, H-75, "Vendedor: "+vendedor, 7.5, true);
      }

      // Bloque licitación derecha
      if (nroLicit || institucion || fechaApert) {
        vln(398, H-10, H-HDR+8, .82, .82, .82, .4);
        ps.push(".055 .373 .659 rg");
        txt(406, H-20, "LICITACION", 6.5, true);
        hln(406, H-23, W-12, .055, .373, .659, .25);
        let ly = H-34;
        [[nroLicit,"N.Licit."],[fechaApert,"Apertura"],[institucion,"Institucion"],[plazoVenta,"Plazo"],[mantOferta,"Mant.Oferta"],[formaCobro,"Cobro"]].forEach(([val,lbl]) => {
          if (!val) return;
          ps.push(".55 .55 .55 rg"); txt(406,ly,lbl+":",6.5,false);
          ps.push(".10 .10 .10 rg"); txt(456,ly,String(val).substring(0,20),6.5,true);
          ly -= 10;
        });
      }

      ps.push("0 0 0 rg");
      pageY = H - HDR - 16;
    }

    drawHeader();

    const LX=20, CW=W-40;
    const colDefs=[{l:"#",w:14},{l:"Empresa",w:52},{l:"Renglon",w:26},{l:"Descripcion",w:108},{l:"Marca",w:48},{l:"Costo ARS",w:58},{l:"PV USD s/IVA",w:60},{l:"PV ARS s/IVA",w:60},{l:"PV ARS c/IVA",w:60},{l:"Cant",w:16},{l:"Subtotal",w:70}];
    const totW=colDefs.reduce((s,c)=>s+c.w,0), sc=CW/totW;
    const cw=colDefs.map(c=>({...c,w:Math.round(c.w*sc)}));
    let y=pageY;

    fill(LX,y-14,CW,14,.055,.373,.659); ps.push("1 1 1 rg");
    let cx_=LX; cw.forEach(c=>{txt(cx_+2,y-10,c.l,6,true);cx_+=c.w;}); ps.push("0 0 0 rg"); y-=14;

    renglones.forEach((r,idx)=>{
      const c=calcR(r,tcN); if(!c) return;
      idx%2===0?fill(LX,y-12,CW,12,.97,.97,.97):fill(LX,y-12,CW,12,1,1,1);
      hln(LX,y-12,LX+CW,.82,.82,.82,.3);
      let cx2=LX;
      [String(idx+1),(r.empresa||"-").substring(0,8),((r.renglon||"-")+(r.subitem?"/"+r.subitem:"")).substring(0,6),String(r.descr||"-").split(/\n/)[0].substring(0,28),(r.marca||"-").substring(0,7),fARS(c.cARS),fUSD(c.pvUSDs),fARS(c.pvARSs),fARS(c.pvARSc),String(c.cant),fARS(c.sub)].forEach((v,i)=>{
        const acc=i===8||i===10; ps.push(acc?".055 .373 .659 rg":"0 0 0 rg"); txt(cx2+2,y-8,v,6,acc); cx2+=cw[i].w;
      });
      ps.push("0 0 0 rg"); y-=12;
    });

    fill(LX,y-14,CW,14,.055,.373,.659); ps.push("1 1 1 rg");
    txt(LX+4,y-10,"TOTAL GENERAL c/IVA (ARS)",8,true);
    const ts=fARS(totalGeneral); txt(W-LX-4-ts.length*5.1,y-10,ts,9,true);
    ps.push("0 0 0 rg"); y-=22; pageY=y;

    renglones.forEach((r,idx)=>{
      const c=calcR(r,tcN); if(!c) return;
      const dLines=splitDescr(r.descr||r.codigo||"",90);
      const dH=dLines.length>0?dLines.length*11+8:0;
      if(pageY-(200+dH)<65){pages.push([...ps]);ps=[];drawHeader();}
      y=pageY; y-=6;
      ps.push(".055 .373 .659 rg");
      txt(LX,y,`RENGLON ${idx+1}:`,8,true);
      hln(LX,y-10,W-LX,.055,.373,.659,.3); ps.push("0 0 0 rg"); y-=16;
      dLines.forEach(line=>{
        const sl=line.replace(/[\\]/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)").substring(0,115);
        ps.push(`BT /F1 8 Tf ${LX} ${y} Td (${sl}) Tj ET`);
        y-=11;
      });
      if(dLines.length>0) y-=6;
      ps.push(".38 .38 .38 rg"); txt(LX,y,"Empresa:",8.5,false);    ps.push("0 0 0 rg"); txt(LX+65,y,esc(r.empresa||"-"),8.5,false);
      ps.push(".38 .38 .38 rg"); txt(200,y,"Renglon/Sub:",8.5,false); ps.push("0 0 0 rg"); txt(270,y,(r.renglon||"-")+(r.subitem?"/"+r.subitem:""),8.5,false);
      ps.push(".38 .38 .38 rg"); txt(340,y,"Codigo:",8.5,false);    ps.push("0 0 0 rg"); txt(390,y,esc(r.codigo||"-"),8.5,false);
      ps.push(".38 .38 .38 rg"); txt(450,y,"Marca:",8.5,false);     ps.push("0 0 0 rg"); txt(490,y,esc(r.marca||"-"),8.5,false);
      y-=14;
      fill(LX-2,y-26,CW+4,26,.91,.95,.99); strk(LX-2,y-26,CW+4,26,.055,.373,.659,.55);
      ps.push(".055 .373 .659 rg"); txt(LX+4,y-10,"Costo en ARS:",8.5,true);
      const ca=fARS(c.cARS); txt(W-LX-4-ca.length*5.5,y-10,ca,10,true);
      ps.push("0 0 0 rg"); y-=32;
      const hW=(CW-8)/2;
      fill(LX-2,y-26,hW,26,.94,.98,.94); strk(LX-2,y-26,hW,26,.2,.55,.1,.4);
      ps.push(".15 .43 .08 rg"); txt(LX+4,y-8,"Markup x"+parseN(r.markup).toFixed(2),7.5,true); txt(LX+4,y-20,fPct(c.mkPct),12,true);
      fill(LX-2+hW+8,y-26,hW,26,.91,.95,.99); strk(LX-2+hW+8,y-26,hW,26,.055,.373,.659,.4);
      ps.push(".055 .373 .659 rg"); txt(LX-2+hW+14,y-8,"Gross Margin %",7.5,true); txt(LX-2+hW+14,y-20,fPct(c.gm),12,true);
      ps.push("0 0 0 rg"); y-=32;
      const cW2=(CW-8)/2,cH=36;
      [[fUSD(c.pvUSDs),"PV USD s/IVA"],[fUSD(c.pvUSDc),"PV USD c/IVA"]].forEach(([v,l],i)=>{
        const x=LX-2+i*(cW2+8); fill(x,y-cH,cW2,cH,.91,.95,.99); strk(x,y-cH,cW2,cH,.055,.373,.659,.5);
        ps.push(".055 .373 .659 rg"); txt(x+6,y-7,l,7,false); txt(x+6,y-cH+8,v,10,true);
      }); y-=cH+4;
      [[fARS(c.pvARSs),"PV ARS s/IVA"],[fARS(c.pvARSc),"PV ARS c/IVA"]].forEach(([v,l],i)=>{
        const x=LX-2+i*(cW2+8); fill(x,y-cH,cW2,cH,.96,.96,.96); strk(x,y-cH,cW2,cH,.78,.78,.78,.4);
        ps.push(".12 .12 .12 rg"); txt(x+6,y-7,l,7,false); txt(x+6,y-cH+8,v,10,true);
      }); y-=cH+8;
      fill(LX-2,y-44,CW+4,44,.055,.373,.659);
      ps.push("1 1 1 rg"); txt(LX+6,y-12,"SUBTOTAL C/IVA (ARS) | Cantidad: "+c.cant+" u.",8,false);
      txt(LX+6,y-34,fARS(c.sub),14,true); ps.push("0 0 0 rg"); y-=56; pageY=y;
    });

    hln(LX,52,W-LX,.78,.78,.78,.4); ps.push(".62 .62 .62 rg");
    txt(LX,42,"Analisis de Precios — Medi-Cross S.R.L.",7.5,false);
    if(vendedor) txt(LX,31,"Cotizacion realizada por: "+vendedor,7.5,false);
    txt(W-110,42,fecha,7.5,false); ps.push("0 0 0 rg");
    pages.push([...ps]);

    // Generar PDF sin imagen (logo textual)
    const s2u8=s=>{const u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i)&0xFF;return u;};
    const offs={};
    let pdf="%PDF-1.4\n%\xFF\xFF\n";
    const obj=(n,b)=>{offs[n]=pdf.length;pdf+=`${n} 0 obj\n${b}\nendobj\n`;};
    const nPags=pages.length,baseP=3,baseC=baseP+nPags;
    const fontR1=baseC+nPags,fontR2=fontR1+1,imgObjN=fontR2+1;
    const kids=Array.from({length:nPags},(_,i)=>`${baseP+i} 0 R`).join(" ");
    const xobjRes = logoStr ? ` /XObject << /Logo ${imgObjN} 0 R >>` : "";
    const res=`/Font << /F1 ${fontR1} 0 R /F2 ${fontR2} 0 R >>${xobjRes}`;
    obj(1,"<< /Type /Catalog /Pages 2 0 R >>");
    obj(2,`<< /Type /Pages /Kids [${kids}] /Count ${nPags} >>`);
    for(let i=0;i<nPags;i++) obj(baseP+i,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}]\n /Contents ${baseC+i} 0 R\n /Resources << ${res} >> >>`);
    for(let i=0;i<nPags;i++){const s=pages[i].join("\n");obj(baseC+i,`<< /Length ${s.length} >>\nstream\n${s}\nendstream`);}
    obj(fontR1,"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    obj(fontR2,"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    if (logoStr) {
      offs[imgObjN]=pdf.length;
      pdf+=`${imgObjN} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${logoImgW} /Height ${logoImgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logoStr.length} >>\nstream\n${logoStr}\nendstream\nendobj\n`;
    }
    const totN=logoStr ? imgObjN+1 : fontR2+1;
    let xs=`xref\n0 ${totN}\n0000000000 65535 f \n`;
    for(let i=1;i<totN;i++) xs+=String(offs[i]||0).padStart(10,"0")+" 00000 n \n";
    const tr=`trailer\n<< /Size ${totN} /Root 1 0 R >>\nstartxref\n${pdf.length}\n%%EOF`;
    const fin=s2u8(pdf+xs+tr);

    const fn=`Cotizacion_${exportQuoteNum}_${todayISO()}_${normalizeFilePart(institucion,"sin_institucion")}.pdf`;
    const blob=new Blob([fin],{type:"application/pdf"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download=fn;
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),10000);

    const currentDocId = savedDocId;
    if (currentDocId) {
      const { error: estErr } = await supabase.from("cotizaciones")
        .update({ estado: "generado", updated_at: new Date().toISOString(), updated_by: profile?.email||"" })
        .eq("id", currentDocId);
      if (!estErr) {
        setHistItems(prev => prev.map(c => c.id === currentDocId ? { ...c, estado: "generado" } : c));
      }
    }

    try {
      const file=new File([fin],fn,{type:"application/pdf"});
      const {error:upErr}=await supabase.storage.from("cotizaciones-pdf").upload(`pdfs/${fn}`,file,{upsert:true});
      if(upErr) showToast("PDF descargado (error al subir: "+upErr.message+")","err");
      else showToast("PDF generado y guardado ✓");
    } catch(e) { showToast("PDF generado pero no subido: "+e.message,"err"); }
  }

  return (
    <Layout title="Cotizador" profile={profile} onNavigate={onNavigate}>
      <div className="cot-page">

        {toast && <div className={`cot-toast cot-toast--${toast.type}`}>{toast.msg}</div>}

        {sourceTenderId && (
          <div className="cot-banner-warn">
            📋 Originada en licitación — <strong>{institucion || initialData?.institucion}</strong>
            {(nroLicit || initialData?.nroLicit) ? ` · ${nroLicit || initialData?.nroLicit}` : ""}.
            {!docId && " Completá los renglones y guardá."}
          </div>
        )}

        <div className="cot-header">
          <div className="cot-header__left">
            <h2>
              Cotizador MediCross
              {quoteNum
                ? <span className="cot-quote-badge cot-quote-badge--saved">#{quoteNum} · Guardada</span>
                : <span className="cot-quote-badge cot-quote-badge--new">Nueva</span>
              }
            </h2>
          </div>
          <div className="cot-header-actions">
            <button className="cot-btn cot-btn--ghost" onClick={()=>onNavigate("tenders")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"/><path d="M12 5l-7 7 7 7"/></svg>
              <span>Licitaciones</span>
            </button>
            <button className="cot-btn cot-btn--ghost" onClick={abrirHistorial}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>
              <span>Historial</span>
            </button>
            <div className="cot-toolbar__sep"/>
            <button className="cot-btn cot-btn--danger" onClick={abrirPapelera}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              <span>Papelera</span>
            </button>
            {docId && <>
              <div className="cot-toolbar__sep"/>
              <button className="cot-btn cot-btn--rev-tool" onClick={()=>createRevision(docId)}
                title="Crear nueva versión de precios conservando el original">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                <span>Revisión</span>
              </button>
            </>}
            <div className="cot-toolbar__sep"/>
            <button className="cot-btn cot-btn--ghost" onClick={nuevaCotizacion}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              <span>Nueva</span>
            </button>
            <button
              className={`cot-btn cot-btn--ghost${!hasCondicionesCompletas ? " cot-btn--pdf-blocked" : ""}`}
              onClick={exportPDF}
              title={!hasCondicionesCompletas ? `Falta completar: ${missingCondiciones.join(", ")}` : "Exportar PDF"}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span>PDF</span>
              {!hasCondicionesCompletas && <span className="cot-btn-badge-warn" aria-hidden="true">!</span>}
            </button>
            <div className="cot-toolbar__sep"/>
            <button className="cot-btn cot-btn--primary" onClick={guardar} disabled={saving || !hasMeaningfulQuoteData} title={!hasMeaningfulQuoteData ? "Completá al menos un dato antes de guardar" : "Guardar cotización"}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              <span>{saving ? "Guardando…" : "Guardar"}</span>
            </button>
          </div>
        </div>

        <DashboardComercial pageKey={pageKey} />

        <CotizadorIntel
          onOpenQuote={(id) => setPreviewQuoteId(id)}
          onUseInRenglon={handleUseFromIntel}
        />

        {previewQuoteId && (
          <QuotePreviewModal
            quoteId={previewQuoteId}
            onClose={() => setPreviewQuoteId(null)}
            onLoadInEditor={(id) => { loadCotizacion(id); window.scrollTo(0, 0); }}
            onCreateRevision={(id) => { createRevision(id); setPreviewQuoteId(null); }}
          />
        )}

        {useProductItem && (
          <UseProductModal
            item={useProductItem}
            renglones={renglones}
            onApply={applyProductToRenglon}
            onClose={() => setUseProductItem(null)}
          />
        )}

        <div className="cot-card">
          <h3 className="cot-section-title">⚙️ Parámetros globales</h3>
          <div className="cot-params-grid">
            <div className="cot-field cot-f-2"><label>Vendedor</label>
              <select value={vendedor} onChange={e=>setVendedor(e.target.value)}>
                <option value="">— Seleccionar —</option>
                {vendedores.map(v=><option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div className="cot-field"><label>Tipo de cambio USD → ARS</label>
              <input type="number" value={tc} onChange={e=>setTc(e.target.value)} placeholder="1425"/>
            </div>
            <div className="cot-field cot-f-2"><label>N° Licitación</label>
              <input value={nroLicit} onChange={e=>setNroLicit(e.target.value)} placeholder="Ej: 001/2026"/>
            </div>
            <div className="cot-field"><label>Fecha apertura</label>
              <input type="date" value={fechaApert} onChange={e=>setFechaApert(e.target.value)}/>
            </div>
            <div className="cot-field cot-f-3"><label>Institución / Hospital</label>
              <CotInstCombobox value={institucion} onChange={setInstitucion}/>
            </div>
            <div className={`cot-field${condicionesAttempted && !plazoVenta.trim() ? " cot-field--required-error" : ""}`}><label>Plazo de venta</label>
              <select value={plazoVenta} onChange={e=>setPlazoVenta(e.target.value)}>
                <option value="">— Seleccioná —</option>
                {PLAZOS_VENTA.map(p=><option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className={`cot-field${condicionesAttempted && !mantOferta.trim() ? " cot-field--required-error" : ""}`}><label>Mantenimiento oferta</label>
              <select value={mantOferta} onChange={e=>setMantOferta(e.target.value)}>
                <option value="">— Seleccioná —</option>
                {MANTENIMIENTOS.map(m=><option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className={`cot-field${condicionesAttempted && !formaCobro.trim() ? " cot-field--required-error" : ""}`}><label>Forma de cobro</label>
              <select value={formaCobro} onChange={e=>setFormaCobro(e.target.value)}>
                <option value="">— Seleccioná —</option>
                {FORMAS_COBRO.map(f=><option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>
        </div>

        <h3 className="cot-section-title" style={{marginTop:4}}>📦 Renglones</h3>

        {renglones.map((r,idx) => {
          const calc = calcR(r, parseN(tc));
          const catalogSuggestions = catalogMatches(r.descr);
          const intel = priceIntel[r.id];
          const marketSuggestions = intel?.suggestions || [];
          const showSuggestions = catalogOpenId === r.id && (
            catalogSuggestions.length > 0 || marketSuggestions.length > 0 || intel?.loading
          );
          return (
            <div key={r.id} className="cot-renglon" onFocus={() => setActiveRenglonId(r.id)}>
              <div className="cot-renglon__header">
                <span className="cot-renglon__num">Renglón {idx+1}</span>
                <button className="cot-btn-del" onClick={()=>removeR(r.id)} title="Eliminar renglón">×</button>
              </div>
              <div className="cot-renglon__body">
                <div className="cot-renglon__left">
                  <div className="cot-renglon-ids">
                    <div className="cot-field"><label>Empresa / Proveedor</label>
                      <input value={r.empresa} onChange={e=>updateR(r.id,"empresa",e.target.value)} placeholder="Proveedor"/></div>
                    <div className="cot-field"><label>Renglón N°</label>
                      <input type="number" value={r.renglon} onChange={e=>updateR(r.id,"renglon",e.target.value)} placeholder="N°"/></div>
                    <div className="cot-field"><label>Sub ítem</label>
                      <input type="number" value={r.subitem} onChange={e=>updateR(r.id,"subitem",e.target.value)} placeholder="N°"/></div>
                    <div className="cot-field cot-field--qty"><label>Cantidad</label>
                      <input type="number" value={r.cant} min={1} onChange={e=>updateR(r.id,"cant",e.target.value)}/></div>
                  </div>
                  <div className="cot-grid-2" style={{marginTop:10}}>
                    <div className="cot-field"><label>Código</label>
                      <input value={r.codigo} onChange={e=>updateR(r.id,"codigo",e.target.value)} placeholder="SKU"/></div>
                    <div className="cot-field"><label>Marca</label>
                      <input value={r.marca} onChange={e=>updateR(r.id,"marca",e.target.value)} placeholder="Marca"/></div>
                  </div>
                  <div className="cot-field" style={{marginTop:10}}><label>Descripción del producto</label>
                    <div className="cot-catalog-field">
                      <textarea rows={3} value={r.descr} onFocus={()=>{setCatalogOpenId(r.id);loadCotHistory();}} onChange={e=>{updateR(r.id,"descr",e.target.value);setCatalogOpenId(r.id);debouncedFetchPriceIntel(r.id,e.target.value);}} placeholder="Descripción completa del producto"/>
                      {showSuggestions && (
                        <div className="cot-catalog-menu">
                          {catalogSuggestions.length > 0 && (
                            <section>
                              <span className="cot-catalog-menu__title">Catálogo interno · Share Kit</span>
                              {catalogSuggestions.map(product => (
                                <button type="button" key={product.id} onClick={()=>selectCatalogProduct(r.id, product)}>
                                  <strong>{product.name}</strong>
                                  <small>{[product.sku, product.brand || product.line, product.base_price ? `Costo base ${fARS(product.base_price)}` : ""].filter(Boolean).join(" · ")}</small>
                                  {product.speech && <em>{product.speech}</em>}
                                </button>
                              ))}
                            </section>
                          )}
                          {(intel?.loading || marketSuggestions.length > 0) && (
                            <section className="cot-market-menu">
                              <span className="cot-catalog-menu__title">Inteligencia de mercado · descripciones históricas</span>
                              {intel?.loading ? (
                                <p className="cot-market-menu__loading">Buscando referencias comparables…</p>
                              ) : marketSuggestions.map(reference => (
                                <button type="button" key={reference.key} onClick={()=>selectMarketReference(r.id, reference)}>
                                  <strong>{reference.description}</strong>
                                  <small>
                                    {[
                                      `Sugerido ${fARS(reference.suggested)}`,
                                      `Base ${fmtDate(reference.minRow?.tenders?.end_date)}`,
                                      reference.minRow?.tenders?.institution,
                                      reference.minRow?.empresa,
                                      `${reference.refs} ref.`,
                                    ].filter(Boolean).join(" · ")}
                                  </small>
                                </button>
                              ))}
                            </section>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  {(() => {
                    if (!intel) return null;
                    if (intel.loading) return <div className="cot-pi-loading">Consultando inteligencia de precios…</div>;
                    const selected = intel.selected;
                    if (!selected?.minMarket) return marketSuggestions.length
                      ? <div className="cot-pi-hint">Seleccioná una referencia histórica para consultar precio sugerido, fecha y origen.</div>
                      : null;
                    const status = getPriceStatus(calc?.pvARSc, selected.minMarket);
                    const labels = { ok:"✅ Competitivo", cerca:"⚠ Revisar precio", riesgo:"🔴 Riesgo precio" };
                    return (
                      <div className={`cot-pi-badge cot-pi-badge--${status || "neutral"}`}>
                        <div className="cot-pi-head">
                          <span className="cot-pi-status">{labels[status] || "📊 Referencia mercado"}</span>
                          <span className="cot-pi-refs">{selected.refs} referencias comparables</span>
                        </div>
                        <p className="cot-pi-description">{selected.description}</p>
                        <div className="cot-pi-data">
                          <span>Mín. mercado <strong>{fARS(selected.minMarket)}</strong></span>
                          <span>Fecha base <strong>{fmtDate(selected.minRow?.tenders?.end_date)}</strong></span>
                          <span>Origen <strong>{selected.minRow?.tenders?.institution || "Sin institución"}</strong></span>
                          <span>Empresa <strong>{selected.minRow?.empresa || "Sin empresa"}</strong></span>
                          {selected.lastOwn && <span>Última propia <strong>{fARS(selected.lastOwn)} · {fmtDate(selected.lastOwnRow?.tenders?.end_date)}</strong></span>}
                          <span>Sugerido <strong>{fARS(selected.suggested)}</strong></span>
                        </div>
                        <button type="button" className="cot-pi-use" onClick={() => applySuggestedPrice(r.id, selected.suggested)}>
                          Usar precio sugerido · {fARS(selected.suggested)}
                        </button>
                      </div>
                    );
                  })()}
                  <CotHistHint cotHistory={cotHistory} descr={r.descr}
                    onApply={markupMult => {
                      setActiveRenglonId(r.id);
                      handleApplySuggestion(markupMult);
                    }}
                  />
                  <div className="cot-divider"/>
                  <div className="cot-costs-row">
                    <div className="cot-field"><label>Moneda</label>
                      <select value={r.moneda} onChange={e=>updateR(r.id,"moneda",e.target.value)}>
                        <option value="USD">USD</option><option value="ARS">ARS</option>
                      </select></div>
                    <div className="cot-field"><label>% IVA</label>
                      <select value={r.iva} onChange={e=>updateR(r.id,"iva",e.target.value)}>
                        <option value="10.5">10,5%</option><option value="21">21%</option>
                      </select></div>
                    <div className="cot-field"><label>Multiplicador ×</label>
                      <input value={r.markup} onChange={e=>updateR(r.id,"markup",e.target.value)} placeholder="2"/></div>
                    <div className="cot-field"><label>Costo unitario</label>
                      <input value={r.costo} onChange={e=>updateR(r.id,"costo",e.target.value)} placeholder="0,00"/></div>
                    <div className="cot-field"><label>TC propio (vacío = global)</label>
                      <input value={r.tcInd} onChange={e=>updateR(r.id,"tcInd",e.target.value)} placeholder="ej: 1500"/></div>
                  </div>
                  {calc && (
                    <div className="cot-costo-box">
                      <span>Costo ARS: <strong>{fARS(calc.cARS)}</strong></span>
                      <span style={{color:"#94a3b8",fontSize:11}}>+ IVA {r.iva}% = {fARS(calc.cIvaARS)}</span>
                    </div>
                  )}
                  <div style={{marginTop:12,display:"flex",alignItems:"center",gap:10}}>
                    <label style={{fontSize:11,fontWeight:600,color:"#64748b"}}>Modo precio:</label>
                    <select value={r.modoManual} onChange={e=>updateR(r.id,"modoManual",e.target.value)}
                      style={{height:34,border:"1px solid rgba(15,36,68,.14)",borderRadius:8,fontSize:12.5,fontFamily:"inherit",padding:"0 10px",background:"#f8fafc",outline:"none"}}>
                      <option value="auto">⚙ Automático (markup)</option>
                      <option value="manual">✏ Manual (precio fijo)</option>
                    </select>
                  </div>
                  {r.modoManual==="manual" && (
                    <div className="cot-field" style={{marginTop:10}}>
                      <label style={{color:"#0f2444",fontWeight:700}}>Precio venta manual (ARS c/IVA)</label>
                      <input value={r.pvManual} onChange={e=>updateR(r.id,"pvManual",e.target.value)}
                        placeholder="ej: 11001889"
                        style={{borderColor:"#185fa5",background:"#eff6ff",fontWeight:700,fontSize:16}}/>
                    </div>
                  )}
                </div>
                <div className="cot-renglon__right">
                  {calc ? (
                    <>
                      <div className="cot-mk-row">
                        <div className="cot-mk-card">
                          <span>Markup % <small style={{opacity:.6}}>(base costo)</small></span>
                          <strong>{fPct(calc.mkPct)}</strong>
                        </div>
                        <div className="cot-mk-card cot-mk-card--ok">
                          <span>Gross Margin % <small style={{opacity:.6}}>(base venta)</small></span>
                          <strong>{fPct(calc.gm)}</strong>
                        </div>
                      </div>
                      <div className="cot-pv-grid">
                        <div className="cot-pv cot-pv--acc"><span>PV USD s/IVA</span><strong>{fUSD(calc.pvUSDs)}</strong></div>
                        <div className="cot-pv cot-pv--acc"><span>PV USD c/IVA</span><strong>{fUSD(calc.pvUSDc)}</strong></div>
                        <div className="cot-pv"><span>PV ARS s/IVA</span><strong>{fARS(calc.pvARSs)}</strong></div>
                        <div className="cot-pv"><span>PV ARS c/IVA</span><strong>{fARS(calc.pvARSc)}</strong></div>
                      </div>
                      <div className="cot-divider"/>
                      <div className="cot-subtotal">
                        <div>
                          <span>Subtotal c/IVA</span>
                          <span style={{fontSize:10.5}}>{fARS(calc.pvARSc)} × {calc.cant} u.</span>
                        </div>
                        <strong>{fARS(calc.sub)}</strong>
                      </div>
                    </>
                  ) : (
                    <div className="cot-calc-placeholder">Ingresá el costo para ver el cálculo</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        <button className="cot-btn-add" onClick={addR}>+ Agregar renglón</button>

        {renglones.some(r=>calcR(r,parseN(tc))) && (
          <div className="cot-preview">
            <h3 className="cot-section-title" style={{padding:"16px 18px 0",margin:0}}>📋 Previsualización</h3>
            <div className="cot-table-wrap">
              <table className="cot-table">
                <thead>
                  <tr>
                    <th>#</th><th>Empresa</th><th>Rengl.</th><th>Descripción</th><th>Marca</th>
                    <th>PV USD s/IVA</th><th>PV ARS s/IVA</th><th>PV ARS c/IVA</th><th>Cant.</th><th>Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {renglones.map((r,idx)=>{
                    const c=calcR(r,parseN(tc));
                    return (
                      <tr key={r.id}>
                        <td>{idx+1}</td>
                        <td>{(r.empresa||"-").substring(0,12)}</td>
                        <td>{r.renglon||"-"}{r.subitem?"/"+r.subitem:""}</td>
                        <td title={r.descr||""}>{(r.descr||r.codigo||"-").substring(0,28)}</td>
                        <td>{(r.marca||"-").substring(0,10)}</td>
                        <td className="nr">{c?fUSD(c.pvUSDs):"-"}</td>
                        <td className="nr">{c?fARS(c.pvARSs):"-"}</td>
                        <td className="nb">{c?fARS(c.pvARSc):"-"}</td>
                        <td className="nr">{c?String(c.cant):"-"}</td>
                        <td className="nb">{c?fARS(c.sub):"-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="cot-total-bar">
              <span>TOTAL GENERAL c/IVA (ARS)</span>
              <strong>{fARS(totalGeneral)}</strong>
            </div>
          </div>
        )}

        <div className="cot-actions-bottom">
          <button className="cot-btn cot-btn--ghost" onClick={nuevaCotizacion}>+ Nueva cotización</button>
          <button
            className={`cot-btn cot-btn--ghost${!hasCondicionesCompletas ? " cot-btn--pdf-blocked" : ""}`}
            onClick={exportPDF}
            title={!hasCondicionesCompletas ? `Falta completar: ${missingCondiciones.join(", ")}` : "Exportar PDF"}
          >
            ⬇ Exportar PDF
            {!hasCondicionesCompletas && <span className="cot-btn-badge-warn" aria-hidden="true">!</span>}
          </button>
          <button className="cot-btn cot-btn--primary" onClick={guardar} disabled={saving || !hasMeaningfulQuoteData} title={!hasMeaningfulQuoteData ? "Completá al menos un dato antes de guardar" : "Guardar cotización"}>
            {saving?"Guardando…":"💾 Guardar cotización"}
          </button>
        </div>
      </div>

      {showHistorial && createPortal((
        <div className="cot-overlay" onClick={e=>{if(e.target.classList.contains("cot-overlay"))setShowHistorial(false);}}>
          <div className="cot-modal">
            <div className="cot-modal__header">
              <h3>📋 Historial de cotizaciones</h3>
              <button className="cot-modal__close" onClick={()=>setShowHistorial(false)}>×</button>
            </div>
            <div className="cot-modal__search">
              <input className="cot-search" value={histSearch} onChange={e=>setHistSearch(e.target.value)} placeholder="Buscar por N°, institución, descripción…"/>
              <div className="cot-hist-filters">
                <select className="cot-hist-filter-sel" value={filterVendedor} onChange={e=>setFilterVendedor(e.target.value)}>
                  <option value="">Todos los vendedores</option>
                  {histVendedores.map(v=><option key={v} value={v}>{v}</option>)}
                </select>
                <select className="cot-hist-filter-sel" value={filterMes} onChange={e=>setFilterMes(e.target.value)}>
                  <option value="">Todos los meses</option>
                  {histMeses.map(m=><option key={m} value={m}>{fmtMes(m)}</option>)}
                </select>
                {(filterVendedor||filterMes||histSearch) && (
                  <button className="cot-hist-filter-clear" onClick={()=>{setFilterVendedor("");setFilterMes("");setHistSearch("");}}>
                    ✕ Limpiar
                  </button>
                )}
                <span className="cot-hist-filter-count">{histFiltrado.length} resultado{histFiltrado.length!==1?"s":""}</span>

              </div>
            </div>
            <div className="cot-modal__body">
              {loadingHist ? (
                <p style={{textAlign:"center",color:"#94a3b8",padding:32}}>Cargando…</p>
              ) : histFiltrado.length===0 ? (
                <p style={{textAlign:"center",color:"#94a3b8",padding:32}}>{histItems.length===0?"No hay cotizaciones guardadas.":"Sin resultados."}</p>
              ) : histAgrupado.map(({original: c, revisions: revs})=>(
                <div key={c.id} className="cot-hist-group">
                  {/* Cotización original */}
                  <div className="cot-hist-item" onClick={()=>loadCotizacion(c.id)}>
                    <div className="cot-hist-item__head">
                      <div className="cot-hist-inst">
                        {c.institucion || <span style={{color:"#94a3b8",fontStyle:"italic",fontWeight:400}}>Sin institución</span>}
                      </div>
                      <span className="cot-hist-date">{c.created_at?new Date(c.created_at).toLocaleDateString("es-AR"):"-"}</span>
                    </div>
                    <div className="cot-hist-item__meta">
                      <span className="cot-hist-num">#{c.quote_num_formatted||"???"}</span>
                      {/-R\d+$/.test(c.quote_num_formatted || "") && <span className="cot-hist-rev-badge">Revisión</span>}
                      {c.vendedor&&<span className="cot-hist-vend">{c.vendedor.split(" ")[0]}</span>}
                      <select
                        className="cot-estado-inline"
                        value={c.estado||"borrador"}
                        style={(() => { const s = ESTADO_COLORS[c.estado||"borrador"]||ESTADO_COLORS.borrador; return {background:s.bg,color:s.color}; })()}
                        onChange={e=>{e.stopPropagation();cambiarEstado(c.id,e.target.value);}}
                        onClick={e=>e.stopPropagation()}
                      >
                        {ESTADOS.map(s=><option key={s} value={s}>{ESTADO_LABELS[s]}</option>)}
                      </select>
                      <span className="cot-hist-total">{c.total_general?fARS(c.total_general):"—"}</span>
                    </div>
                    {(c.renglones||[]).map(r=>(r.descr||r.codigo||r.marca||"")).filter(Boolean).length>0&&(
                      <div className="cot-hist-items">{(c.renglones||[]).map(r=>(r.descr||r.codigo||r.marca||"")).filter(Boolean).slice(0,3).join(" · ")}</div>
                    )}
                    <div className="cot-hist-actions" onClick={e=>e.stopPropagation()}>
                      <button className="cot-btn cot-btn--primary cot-btn--sm" onClick={()=>loadCotizacion(c.id)}>Editar</button>
                      <button className="cot-btn cot-btn--rev cot-btn--sm" onClick={()=>{createRevision(c.id);setShowHistorial(false);}} title="Crear revisión de precios">Nueva versión</button>
                      {c.estado==="aceptada"&&<button className="cot-btn cot-btn--success cot-btn--sm" onClick={()=>convertAcceptedQuote(c)}>{c.accepted_opportunity_id?"✓ Oportunidad creada":"✓ Convertir en oportunidad"}</button>}
                      <button className="cot-btn cot-btn--danger cot-btn--sm" onClick={()=>softDelete(c.id,c.quote_num_formatted||"???")}>Borrar</button>
                    </div>
                  </div>
                  {/* Revisiones anidadas */}
                  {revs.length > 0 && (
                    <div className="cot-hist-revs">
                      {revs.map(r=>(
                        <div key={r.id} className="cot-hist-rev-row" onClick={()=>loadCotizacion(r.id)}>
                          <div className="cot-hist-rev-row__meta">
                            <span className="cot-hist-rev-row__num">↳ {r.quote_num_formatted}</span>
                            <select
                              className="cot-estado-inline"
                              value={r.estado||"borrador"}
                              style={(() => { const s = ESTADO_COLORS[r.estado||"borrador"]||ESTADO_COLORS.borrador; return {background:s.bg,color:s.color}; })()}
                              onChange={e=>{e.stopPropagation();cambiarEstado(r.id,e.target.value);}}
                              onClick={e=>e.stopPropagation()}
                            >
                              {ESTADOS.map(s=><option key={s} value={s}>{ESTADO_LABELS[s]}</option>)}
                            </select>
                            <span className="cot-hist-rev-row__total">{r.total_general?fARS(r.total_general):"—"}</span>
                            <span className="cot-hist-rev-row__date">{r.created_at?new Date(r.created_at).toLocaleDateString("es-AR"):"-"}</span>
                          </div>
                          <div className="cot-hist-actions" onClick={e=>e.stopPropagation()}>
                            <button className="cot-btn cot-btn--primary cot-btn--sm" onClick={()=>loadCotizacion(r.id)}>Editar</button>
                            <button className="cot-btn cot-btn--danger cot-btn--sm" onClick={()=>softDelete(r.id,r.quote_num_formatted||"???")}>Borrar</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      ), document.body)}

      {showPapelera && createPortal((
        <div className="cot-overlay" onClick={e=>{if(e.target.classList.contains("cot-overlay"))setShowPapelera(false);}}>
          <div className="cot-modal">
            <div className="cot-modal__header">
              <h3 style={{color:"#dc2626"}}>🗑 Papelera</h3>
              <button className="cot-modal__close" onClick={()=>setShowPapelera(false)}>×</button>
            </div>
            <div className="cot-modal__body">
              {papItems.length===0 ? (
                <p style={{textAlign:"center",color:"#94a3b8",padding:32}}>La papelera está vacía.</p>
              ) : papItems.map(c=>(
                <div key={c.id} className="cot-hist-item" style={{borderColor:"rgba(220,38,38,.2)"}}>
                  <div className="cot-hist-item__top">
                    <span className="cot-hist-num">#{c.quote_num_formatted||"???"}</span>
                    {c.vendedor&&<span className="cot-hist-vend">{c.vendedor.split(" ")[0]}</span>}
                    <span style={{fontSize:11,color:"#64748b",marginLeft:"auto"}}>Borrada por {c.deleted_by_name||"-"}</span>
                  </div>
                  <div style={{fontSize:12,fontWeight:700,color:"#0f2444",marginTop:2}}>
                    {c.institucion||""}{c.total_general?" — Total: "+fARS(c.total_general):""}
                  </div>
                  <div className="cot-hist-actions">
                    <button className="cot-btn cot-btn--sm" style={{background:"#d4edda",color:"#166534",border:"1px solid #6ee7b7"}}
                      onClick={()=>restaurar(c.id,c.quote_num_formatted||"???")}>↩ Restaurar</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ), document.body)}
    </Layout>
  );
}
