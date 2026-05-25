import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";

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

function compactMoney(v) {
  const n = Number(v || 0); if (!n) return "—";
  if (n >= 1_000_000_000) return `$${(n/1_000_000_000).toFixed(1).replace(".",",")} MM`;
  if (n >= 1_000_000)     return `$${(n/1_000_000).toFixed(1).replace(".",",")} M`;
  if (n >= 1_000)         return `$${Math.round(n/1_000)} K`;
  return `$${n.toLocaleString("es-AR")}`;
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

function Sparkline({ datos, color = "#185fa5" }) {
  if (!datos || datos.length < 2) return null;
  const vals = datos.map(d => d.precio);
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1;
  const W = 120, H = 36, PAD = 4;
  const pts = vals.map((v, i) => {
    const x = PAD + (i / (vals.length - 1)) * (W - PAD * 2);
    const y = PAD + (1 - (v - min) / range) * (H - PAD * 2);
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={W} height={H} style={{display:"block",flexShrink:0}}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2"
        strokeLinejoin="round" strokeLinecap="round"/>
      {vals.map((v, i) => {
        const x = PAD + (i / (vals.length - 1)) * (W - PAD * 2);
        const y = PAD + (1 - (v - min) / range) * (H - PAD * 2);
        return <circle key={i} cx={x} cy={y} r="2.5" fill={color}/>;
      })}
    </svg>
  );
}

export default function PreciosHistoricosPage({ profile, onNavigate }) {
  const [query,    setQuery]    = useState("");
  const [desde,    setDesde]    = useState("");
  const [hasta,    setHasta]    = useState("");
  const [rows,     setRows]     = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [searched, setSearched] = useState(false);
  const [recientes, setRecientes] = useState([]);
  const [showSug,  setShowSug]  = useState(false);
  const inputRef   = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => { setRecientes(getBusquedasRecientes()); }, []);

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
    setRows([]); setSearched(false); setShowSug(false);
    inputRef.current?.focus();
  };

  const elegirSugerencia = (s) => { setQuery(s); buscar(s); };

  const agrupado = useMemo(() => {
    const map = {};
    rows.forEach(r => {
      const tid = r.tender_id;
      if (!map[tid]) map[tid] = { tender: r.tenders, renglones: {} };
      const reng = r.renglon;
      if (!map[tid].renglones[reng]) map[tid].renglones[reng] = { descripcion: r.descripcion, filas: [] };
      map[tid].renglones[reng].filas.push(r);
    });
    return Object.values(map).sort((a, b) =>
      (b.tender?.end_date || "").localeCompare(a.tender?.end_date || "")
    );
  }, [rows]);

  const metricas = useMemo(() => {
    if (!rows.length) return null;
    const nuestras     = rows.filter(r => r.es_nuestra_oferta);
    const licitaciones = new Set(rows.map(r => r.tender_id)).size;
    const empresas     = new Set(rows.map(r => r.empresa)).size;
    const byTenderReng = {};
    rows.forEach(r => {
      const key = `${r.tender_id}_${r.renglon}`;
      if (!byTenderReng[key]) byTenderReng[key] = [];
      byTenderReng[key].push(r);
    });
    let minimoCount = 0;
    Object.values(byTenderReng).forEach(grupo => {
      const min = Math.min(...grupo.map(r => r.precio_unitario).filter(Boolean));
      const nuestra = grupo.find(r => r.es_nuestra_oferta);
      if (nuestra && nuestra.precio_unitario === min) minimoCount++;
    });
    const totalRenglones = Object.keys(byTenderReng).length;
    const preciosNuestros = nuestras
      .filter(r => r.tenders?.end_date)
      .sort((a, b) => a.tenders.end_date.localeCompare(b.tenders.end_date))
      .map(r => ({ fecha: r.tenders.end_date, precio: r.precio_unitario, hospital: r.tenders.institution }));
    const avgNuestro = nuestras.length
      ? nuestras.reduce((s, r) => s + Number(r.precio_unitario || 0), 0) / nuestras.length : null;
    let tendencia = null;
    if (preciosNuestros.length >= 2) {
      const mid  = Math.floor(preciosNuestros.length / 2);
      const avg1 = preciosNuestros.slice(0, mid).reduce((s, r) => s + r.precio, 0) / mid;
      const avg2 = preciosNuestros.slice(mid).reduce((s, r) => s + r.precio, 0) / (preciosNuestros.length - mid);
      const pct  = ((avg2 - avg1) / avg1 * 100).toFixed(1);
      tendencia  = { pct: Number(pct), subiendo: Number(pct) > 0 };
    }
    const conteoEmpresas = {};
    rows.filter(r => !r.es_nuestra_oferta).forEach(r => {
      conteoEmpresas[r.empresa] = (conteoEmpresas[r.empresa] || 0) + 1;
    });
    const topCompetidores = Object.entries(conteoEmpresas)
      .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([nombre, veces]) => ({ nombre, veces }));
    return { licitaciones, empresas, nuestras: nuestras.length, avgNuestro,
      preciosNuestros, minimoCount, totalRenglones, tendencia, topCompetidores };
  }, [rows]);

  function precioMinRenglon(filas) {
    const precios = filas.map(f => f.precio_unitario).filter(Boolean);
    return precios.length ? Math.min(...precios) : null;
  }

  const pctMinimo = metricas && metricas.totalRenglones
    ? Math.round(metricas.minimoCount / metricas.totalRenglones * 100) : 0;

  return (
    <Layout title="Inteligencia de Precios" profile={profile} onNavigate={onNavigate}>
      <div style={{padding:"18px 24px 48px",display:"flex",flexDirection:"column",gap:18,
        fontFamily:"DM Sans, system-ui, sans-serif",background:"#f0f2f5",minHeight:"100vh",
        color:"#0f172a",fontSize:"13.5px"}}>

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
        </div>

        {/* ESTADO VACÍO INICIAL */}
        {!searched && (
          <div style={{background:"#fff",borderRadius:14,border:"1px solid #e2e8f0",
            padding:"52px 24px",textAlign:"center",boxShadow:"0 1px 3px rgba(15,23,42,.04)"}}>
            <div style={{fontSize:44,marginBottom:14}}>📈</div>
            <div style={{fontSize:17,fontWeight:700,color:"#0f2444",marginBottom:6,letterSpacing:"-.3px"}}>
              Historial de precios de mercado
            </div>
            <div style={{fontSize:13,color:"#94a3b8",maxWidth:440,margin:"0 auto",lineHeight:1.7}}>
              Buscá cualquier producto para ver cómo cotizaron todos los proveedores
              en cada licitación, quién fue el más barato y cómo evolucionaron los precios a lo largo del tiempo.
            </div>
            <div style={{display:"flex",justifyContent:"center",gap:28,marginTop:28,flexWrap:"wrap"}}>
              {[
                {icon:"🏆",text:"Precio mínimo por renglón"},
                {icon:"📊",text:"Evolución temporal de precios"},
                {icon:"🏢",text:"Comparativa entre proveedores"},
                {icon:"📅",text:"Filtro por período"},
              ].map(f => (
                <div key={f.text} style={{display:"flex",flexDirection:"column",alignItems:"center",
                  gap:6,fontSize:11.5,color:"#64748b",fontWeight:500}}>
                  <span style={{fontSize:22}}>{f.icon}</span>
                  {f.text}
                </div>
              ))}
            </div>
          </div>
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

        {/* MÉTRICAS */}
        {metricas && !loading && (
          <>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:10}}>
              {[
                {icon:"📋",label:"Licitaciones",val:metricas.licitaciones,color:"#185fa5",sub:"encontradas"},
                {icon:"🏢",label:"Empresas",val:metricas.empresas,color:"#7c3aed",sub:"competidoras"},
                {icon:"📦",label:"Renglones",val:metricas.totalRenglones,color:"#0369a1",sub:"analizados"},
                {
                  icon:"🏆",label:"Precio mínimo",
                  val:`${metricas.minimoCount}/${metricas.totalRenglones}`,
                  color:pctMinimo>=50?"#166534":pctMinimo>=25?"#d97706":"#dc2626",
                  sub:`${pctMinimo}% de las veces`
                },
                {
                  icon:"💰",label:"Nuestro promedio",
                  val:metricas.avgNuestro?compactMoney(metricas.avgNuestro):"—",
                  color:"#0f2444",
                  sub:metricas.tendencia
                    ?(metricas.tendencia.subiendo?`↑ +${metricas.tendencia.pct}% tendencia`:`↓ ${metricas.tendencia.pct}% tendencia`)
                    :"precio unitario"
                },
              ].map(k => (
                <div key={k.label} style={{background:"#fff",borderRadius:11,border:"1px solid #e2e8f0",
                  borderTop:`3px solid ${k.color}`,padding:"14px 16px",
                  boxShadow:"0 1px 3px rgba(15,23,42,.04)",position:"relative",overflow:"hidden"}}>
                  <span style={{position:"absolute",top:10,right:12,fontSize:18,opacity:.12,pointerEvents:"none"}}>{k.icon}</span>
                  <div style={{fontSize:10,fontWeight:600,textTransform:"uppercase",letterSpacing:".6px",
                    color:"#94a3b8",marginBottom:5}}>{k.label}</div>
                  <div style={{fontSize:22,fontWeight:700,color:"#0f2444",fontFamily:"DM Mono,monospace",
                    lineHeight:1.1,marginBottom:3}}>{k.val}</div>
                  <div style={{fontSize:10.5,color:"#94a3b8"}}>{k.sub}</div>
                </div>
              ))}
            </div>

            {/* PANEL ANÁLISIS */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>

              {/* Evolución precios */}
              <div style={{background:"#fff",borderRadius:11,border:"1px solid #e2e8f0",
                padding:"16px 18px",boxShadow:"0 1px 3px rgba(15,23,42,.04)"}}>
                <div style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:".6px",
                  color:"#94a3b8",marginBottom:12}}>Evolución de nuestros precios</div>
                {metricas.preciosNuestros.length >= 2 ? (
                  <>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12}}>
                      <div style={{flex:1,minWidth:0}}>
                        {metricas.preciosNuestros.map((p, i) => (
                          <div key={i} style={{display:"flex",alignItems:"center",gap:8,
                            fontSize:11.5,marginBottom:6}}>
                            <span style={{fontSize:10,color:"#94a3b8",fontFamily:"DM Mono,monospace",
                              flexShrink:0,minWidth:52}}>{fmtDate(p.fecha)}</span>
                            <span style={{fontFamily:"DM Mono,monospace",fontWeight:700,color:"#0f2444",flexShrink:0}}>
                              {compactMoney(p.precio)}
                            </span>
                            <span style={{fontSize:10,color:"#94a3b8",overflow:"hidden",
                              textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                              {p.hospital}
                            </span>
                          </div>
                        ))}
                      </div>
                      <Sparkline datos={metricas.preciosNuestros}
                        color={metricas.tendencia?.subiendo?"#dc2626":"#166534"}/>
                    </div>
                    {metricas.tendencia && (
                      <div style={{marginTop:10,padding:"7px 11px",borderRadius:8,
                        background:metricas.tendencia.subiendo?"#fff5f5":"#f0fdf4",
                        fontSize:11,fontWeight:600,
                        color:metricas.tendencia.subiendo?"#7f1d1d":"#166534"}}>
                        {metricas.tendencia.subiendo
                          ?`↑ Precios subiendo ${metricas.tendencia.pct}% vs período anterior`
                          :`↓ Precios bajando ${Math.abs(metricas.tendencia.pct)}% vs período anterior`}
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{fontSize:12,color:"#94a3b8",padding:"12px 0"}}>
                    {metricas.preciosNuestros.length===1
                      ?"Solo 1 licitación propia — necesitás al menos 2 para ver evolución."
                      :"Sin datos propios para mostrar evolución."}
                  </div>
                )}
              </div>

              {/* Top competidores */}
              <div style={{background:"#fff",borderRadius:11,border:"1px solid #e2e8f0",
                padding:"16px 18px",boxShadow:"0 1px 3px rgba(15,23,42,.04)"}}>
                <div style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:".6px",
                  color:"#94a3b8",marginBottom:12}}>Competidores más frecuentes</div>
                {metricas.topCompetidores.length > 0 ? (
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    {metricas.topCompetidores.map((c, i) => {
                      const pct = Math.round(c.veces / metricas.totalRenglones * 100);
                      const colors = ["#185fa5","#7c3aed","#0369a1"];
                      return (
                        <div key={c.nombre}>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:5,fontSize:12}}>
                            <span style={{fontWeight:600,color:"#334155",overflow:"hidden",
                              textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:200}}>
                              {i===0?"🥇":i===1?"🥈":"🥉"} {c.nombre}
                            </span>
                            <span style={{color:"#64748b",fontSize:11,whiteSpace:"nowrap",flexShrink:0}}>
                              {c.veces} renglón{c.veces!==1?"es":""}
                            </span>
                          </div>
                          <div style={{height:5,background:"#e8ecf2",borderRadius:10,overflow:"hidden"}}>
                            <div style={{height:"100%",width:`${Math.max(pct,4)}%`,
                              background:colors[i],borderRadius:10,transition:"width .4s ease"}}/>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{fontSize:12,color:"#94a3b8"}}>Sin competidores registrados.</div>
                )}
              </div>
            </div>
          </>
        )}

        {/* RESULTADOS */}
        {!loading && agrupado.map((grupo, gi) => (
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
              const nuestra = data.filas.find(f => f.es_nuestra_oferta);
              const ganamos = nuestra && nuestra.precio_unitario === min;
              const empresasReng = [...data.filas].sort((a, b) => a.precio_unitario - b.precio_unitario);
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
                        background:ganamos?"#d4edda":"#fde8e8",
                        color:ganamos?"#166534":"#7f1d1d"}}>
                        {ganamos?"✓ Precio mínimo":`+${((nuestra.precio_unitario-min)/min*100).toFixed(1)}% sobre mínimo`}
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
                          const esNuestra = f.es_nuestra_oferta;
                          const esMin = f.precio_unitario === min;
                          const diff = min&&!esMin?((f.precio_unitario-min)/min*100).toFixed(1):null;
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
                                color:esMin?"#166534":"#0f172a"}}>
                                {esMin&&<span style={{marginRight:4,fontSize:10}}>🏆</span>}
                                {fullMoney(f.precio_unitario)}
                              </td>
                              <td style={{padding:"10px 14px",textAlign:"right",color:"#64748b"}}>{f.cantidad}</td>
                              <td style={{padding:"10px 14px",textAlign:"right",
                                fontFamily:"DM Mono,monospace",color:"#334155"}}>
                                {fullMoney(f.total_ars)}
                              </td>
                              <td style={{padding:"10px 14px",textAlign:"center"}}>
                                {esMin
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
