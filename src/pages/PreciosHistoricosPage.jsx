import { useEffect, useMemo, useState } from "react";
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

const NUESTRA_EMPRESA = "MEDI-CROSS";

export default function PreciosHistoricosPage({ profile, onNavigate }) {
  const [query,      setQuery]      = useState("");
  const [desde,      setDesde]      = useState("");
  const [hasta,      setHasta]      = useState("");
  const [rows,       setRows]       = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [searched,   setSearched]   = useState(false);

  async function buscar() {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);

    // Traer comparativas que coincidan con la descripción
    let q = supabase
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
      .ilike("descripcion", `%${query.trim()}%`)
      .order("renglon");

    const { data, error } = await q;
    if (error) { console.error(error); setLoading(false); return; }

    let result = data || [];

    // Filtrar por rango de fechas usando end_date de la licitación
    if (desde) {
      result = result.filter(r => r.tenders?.end_date && r.tenders.end_date >= desde);
    }
    if (hasta) {
      result = result.filter(r => r.tenders?.end_date && r.tenders.end_date <= hasta);
    }

    setRows(result);
    setLoading(false);
  }

  // Agrupar por licitación → renglón
  const agrupado = useMemo(() => {
    const map = {};
    rows.forEach(r => {
      const tid = r.tender_id;
      if (!map[tid]) {
        map[tid] = {
          tender: r.tenders,
          renglones: {},
        };
      }
      const reng = r.renglon;
      if (!map[tid].renglones[reng]) {
        map[tid].renglones[reng] = { descripcion: r.descripcion, filas: [] };
      }
      map[tid].renglones[reng].filas.push(r);
    });
    // Ordenar por fecha desc
    return Object.values(map).sort((a, b) => {
      const fa = a.tender?.end_date || "";
      const fb = b.tender?.end_date || "";
      return fb.localeCompare(fa);
    });
  }, [rows]);

  // Métricas resumen
  const metricas = useMemo(() => {
    if (!rows.length) return null;
    const nuestras   = rows.filter(r => r.es_nuestra_oferta);
    const licitaciones = new Set(rows.map(r => r.tender_id)).size;
    const empresas     = new Set(rows.map(r => r.empresa)).size;

    // Precios nuestros para evolución
    const preciosNuestros = nuestras
      .filter(r => r.tenders?.end_date)
      .sort((a, b) => a.tenders.end_date.localeCompare(b.tenders.end_date))
      .map(r => ({ fecha: r.tenders.end_date, precio: r.precio_unitario, hospital: r.tenders.institution }));

    const avgNuestro = nuestras.length
      ? nuestras.reduce((s, r) => s + Number(r.precio_unitario || 0), 0) / nuestras.length
      : null;

    // Cuántas veces fuimos precio mínimo
    let minimoCount = 0;
    const byTenderReng = {};
    rows.forEach(r => {
      const key = `${r.tender_id}_${r.renglon}`;
      if (!byTenderReng[key]) byTenderReng[key] = [];
      byTenderReng[key].push(r);
    });
    Object.values(byTenderReng).forEach(grupo => {
      const min = Math.min(...grupo.map(r => r.precio_unitario).filter(Boolean));
      const nuestra = grupo.find(r => r.es_nuestra_oferta);
      if (nuestra && nuestra.precio_unitario === min) minimoCount++;
    });

    return { licitaciones, empresas, nuestras: nuestras.length, avgNuestro, preciosNuestros, minimoCount, totalRenglones: Object.keys(byTenderReng).length };
  }, [rows]);

  function precioMinRenglon(filas) {
    const precios = filas.map(f => f.precio_unitario).filter(Boolean);
    return precios.length ? Math.min(...precios) : null;
  }

  return (
    <Layout title="Inteligencia de Precios" profile={profile} onNavigate={onNavigate}>
      <div style={{
        padding:"18px 24px 40px", display:"flex", flexDirection:"column", gap:16,
        fontFamily:"DM Sans, system-ui, sans-serif", background:"#f0f2f5", minHeight:"100vh",
        color:"#0f172a", fontSize:"13.5px",
      }}>

        {/* Header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
          <div>
            <h2 style={{margin:0,fontSize:20,fontWeight:600,color:"#0f2444",letterSpacing:"-.4px"}}>
              🔍 Inteligencia de Precios
            </h2>
            <p style={{margin:"2px 0 0",fontSize:12,color:"#94a3b8"}}>
              Buscá precios históricos por producto en todas las licitaciones
            </p>
          </div>
          <button
            onClick={() => onNavigate("tenders")}
            style={{padding:"7px 14px",borderRadius:8,border:"1px solid #e2e8f0",background:"#fff",
              fontSize:12.5,fontWeight:500,cursor:"pointer",color:"#334155",fontFamily:"inherit"}}>
            ← Volver a Licitaciones
          </button>
        </div>

        {/* Buscador */}
        <div style={{background:"#fff",borderRadius:12,border:"1px solid #e2e8f0",padding:"16px 20px",
          boxShadow:"0 1px 3px rgba(15,23,42,.04)"}}>
          <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end"}}>
            <div style={{flex:"2 1 280px",display:"flex",flexDirection:"column",gap:4}}>
              <label style={{fontSize:11,fontWeight:600,color:"#64748b",textTransform:"uppercase",letterSpacing:".5px"}}>
                Producto / Descripción
              </label>
              <input
                value={query} onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && buscar()}
                placeholder="Ej: cateter, filtro, dialisis, ablacion…"
                style={{padding:"9px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,
                  fontFamily:"inherit",outline:"none",color:"#0f172a"}}
              />
            </div>
            <div style={{flex:"1 1 140px",display:"flex",flexDirection:"column",gap:4}}>
              <label style={{fontSize:11,fontWeight:600,color:"#64748b",textTransform:"uppercase",letterSpacing:".5px"}}>
                Desde
              </label>
              <input type="date" value={desde} onChange={e => setDesde(e.target.value)}
                style={{padding:"9px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,
                  fontFamily:"inherit",outline:"none",color:"#0f172a"}}/>
            </div>
            <div style={{flex:"1 1 140px",display:"flex",flexDirection:"column",gap:4}}>
              <label style={{fontSize:11,fontWeight:600,color:"#64748b",textTransform:"uppercase",letterSpacing:".5px"}}>
                Hasta
              </label>
              <input type="date" value={hasta} onChange={e => setHasta(e.target.value)}
                style={{padding:"9px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,
                  fontFamily:"inherit",outline:"none",color:"#0f172a"}}/>
            </div>
            <button onClick={buscar} disabled={loading || !query.trim()}
              style={{padding:"9px 20px",borderRadius:8,border:"none",background:"#0f2444",color:"#fff",
                fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap",
                opacity: (!query.trim() || loading) ? .5 : 1}}>
              {loading ? "Buscando…" : "🔍 Buscar"}
            </button>
            {searched && (
              <button onClick={() => { setQuery(""); setDesde(""); setHasta(""); setRows([]); setSearched(false); }}
                style={{padding:"9px 14px",borderRadius:8,border:"1px solid #e2e8f0",background:"#fff",
                  fontSize:12.5,fontWeight:500,cursor:"pointer",color:"#64748b",fontFamily:"inherit"}}>
                ✕ Limpiar
              </button>
            )}
          </div>
        </div>

        {/* Métricas resumen */}
        {metricas && (
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:10}}>
            {[
              { label:"Licitaciones encontradas", val: metricas.licitaciones, color:"#185fa5" },
              { label:"Empresas competidoras",    val: metricas.empresas,     color:"#7c3aed" },
              { label:"Renglones analizados",     val: metricas.totalRenglones, color:"#0369a1" },
              { label:"Veces precio mínimo",      val: `${metricas.minimoCount} / ${metricas.totalRenglones}`, color:"#166534" },
              { label:"Nuestro precio promedio",  val: metricas.avgNuestro ? fullMoney(metricas.avgNuestro) : "—", color:"#0f2444" },
            ].map(k => (
              <div key={k.label} style={{background:"#fff",borderRadius:10,border:"1px solid #e2e8f0",
                borderTop:`3px solid ${k.color}`,padding:"12px 14px",boxShadow:"0 1px 3px rgba(15,23,42,.04)"}}>
                <div style={{fontSize:10,fontWeight:600,textTransform:"uppercase",letterSpacing:".6px",
                  color:"#94a3b8",marginBottom:6}}>{k.label}</div>
                <div style={{fontSize:22,fontWeight:700,color:"#0f2444",fontFamily:"DM Mono,monospace",
                  lineHeight:1.1}}>{k.val}</div>
              </div>
            ))}
          </div>
        )}

        {/* Resultados */}
        {searched && !loading && rows.length === 0 && (
          <div style={{textAlign:"center",padding:"48px",background:"#fff",borderRadius:12,
            border:"1px solid #e2e8f0",color:"#94a3b8"}}>
            <div style={{fontSize:32,marginBottom:10}}>🔍</div>
            <div style={{fontWeight:500,fontSize:14}}>Sin resultados</div>
            <div style={{fontSize:12,marginTop:4}}>Probá con otro término o ampliá el rango de fechas</div>
          </div>
        )}

        {agrupado.map(grupo => (
          <div key={grupo.tender?.id} style={{background:"#fff",borderRadius:12,
            border:"1px solid #e2e8f0",overflow:"hidden",boxShadow:"0 1px 3px rgba(15,23,42,.04)"}}>

            {/* Header licitación */}
            <div style={{background:"#0f2444",padding:"12px 16px",display:"flex",
              alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
              <div>
                <div style={{fontWeight:700,fontSize:13,color:"#fff"}}>
                  {grupo.tender?.institution || "—"}
                </div>
                <div style={{fontSize:11,color:"rgba(255,255,255,.6)",marginTop:2}}>
                  {grupo.tender?.process_number || "—"} · {grupo.tender?.process_name || ""}
                </div>
              </div>
              <div style={{display:"flex",gap:10,alignItems:"center"}}>
                <div style={{fontSize:11,color:"rgba(255,255,255,.7)"}}>
                  📅 Apertura: <strong style={{color:"#fff"}}>{fmtDate(grupo.tender?.end_date)}</strong>
                </div>
                <button
                  onClick={() => onNavigate("tenders")}
                  style={{padding:"4px 10px",borderRadius:6,border:"1px solid rgba(255,255,255,.2)",
                    background:"rgba(255,255,255,.1)",color:"#fff",fontSize:11,cursor:"pointer",
                    fontFamily:"inherit"}}>
                  Ver licitación →
                </button>
              </div>
            </div>

            {/* Renglones */}
            {Object.entries(grupo.renglones).map(([reng, data]) => {
              const min      = precioMinRenglon(data.filas);
              const nuestra  = data.filas.find(f => f.es_nuestra_oferta);
              const ganamos  = nuestra && nuestra.precio_unitario === min;
              const empresasReng = [...data.filas].sort((a, b) => a.precio_unitario - b.precio_unitario);

              return (
                <div key={reng} style={{borderTop:"1px solid #f0f4f8"}}>
                  {/* Descripción del renglón */}
                  <div style={{padding:"10px 16px 6px",background:"#f8fafc",
                    display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontFamily:"DM Mono,monospace",fontWeight:700,fontSize:11,
                        color:"#0f2444",background:"#e2e8f0",borderRadius:4,padding:"2px 7px"}}>
                        R{reng}
                      </span>
                      <span style={{fontSize:12,color:"#334155",fontWeight:500}}>
                        {data.descripcion?.slice(0, 120)}{data.descripcion?.length > 120 ? "…" : ""}
                      </span>
                    </div>
                    {nuestra && (
                      <span style={{
                        fontSize:10,fontWeight:700,borderRadius:20,padding:"2px 10px",whiteSpace:"nowrap",
                        background: ganamos ? "#d4edda" : "#fde8e8",
                        color:      ganamos ? "#166534" : "#7f1d1d",
                      }}>
                        {ganamos ? "✓ Fuimos precio mínimo" : `+${((nuestra.precio_unitario - min) / min * 100).toFixed(1)}% sobre mínimo`}
                      </span>
                    )}
                  </div>

                  {/* Tabla de empresas */}
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
                          const esMin     = f.precio_unitario === min;
                          const diff      = min && !esMin
                            ? ((f.precio_unitario - min) / min * 100).toFixed(1)
                            : null;
                          return (
                            <tr key={f.id} style={{
                              background: esNuestra ? "#eff6ff" : f.adjudicado ? "#f0fdf4" : i%2===0 ? "#fff" : "#fafbfc",
                              borderBottom:"1px solid #f0f4f8",
                            }}>
                              <td style={{padding:"9px 14px",fontWeight: esNuestra ? 700 : 500,color:"#0f172a"}}>
                                {esNuestra && <span style={{color:"#185fa5",marginRight:5}}>★</span>}
                                {f.empresa}
                              </td>
                              <td style={{padding:"9px 14px",textAlign:"right",fontFamily:"DM Mono,monospace",
                                fontWeight:700,color: esMin ? "#166534" : "#0f172a"}}>
                                {esMin && <span style={{marginRight:4,fontSize:10}}>🏆</span>}
                                {fullMoney(f.precio_unitario)}
                              </td>
                              <td style={{padding:"9px 14px",textAlign:"right",color:"#64748b"}}>{f.cantidad}</td>
                              <td style={{padding:"9px 14px",textAlign:"right",fontFamily:"DM Mono,monospace",
                                color:"#334155"}}>{fullMoney(f.total_ars)}</td>
                              <td style={{padding:"9px 14px",textAlign:"center"}}>
                                {esMin
                                  ? <span style={{fontSize:10,background:"#d4edda",color:"#166534",
                                      borderRadius:20,padding:"2px 8px",fontWeight:700}}>Mínimo</span>
                                  : <span style={{fontSize:10,background:"#fde8e8",color:"#7f1d1d",
                                      borderRadius:20,padding:"2px 8px",fontWeight:600}}>+{diff}%</span>
                                }
                              </td>
                              <td style={{padding:"9px 14px",textAlign:"center"}}>
                                {f.adjudicado
                                  ? <span style={{fontSize:10,background:"#d4edda",color:"#166534",
                                      borderRadius:20,padding:"2px 8px",fontWeight:700}}>✓ ADJ</span>
                                  : <span style={{color:"#e2e8f0",fontSize:11}}>—</span>
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
  padding: "8px 14px",
  textAlign: "left",
  fontSize: 10,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: ".5px",
  color: "#64748b",
  whiteSpace: "nowrap",
};