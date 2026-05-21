import { useEffect, useState, useCallback, useRef } from "react";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";
import "./CotizadorPage.css";

/* ─── Helpers numéricos ──────────────────────────────────────────────────── */
const fARS  = (n) => "$ " + Number(n||0).toLocaleString("es-AR", { minimumFractionDigits:2, maximumFractionDigits:2 });
const fUSD  = (n) => "U$D " + Number(n||0).toLocaleString("es-AR", { minimumFractionDigits:2, maximumFractionDigits:2 });
const fPct  = (n) => Number(n||0).toFixed(1) + "%";
const fCmp  = (n) => {
  const x = Number(n||0);
  if (x >= 1e9) return "$ " + (x/1e9).toFixed(1) + "MM";
  if (x >= 1e6) return "$ " + (x/1e6).toFixed(1) + "M";
  if (x >= 1e3) return "$ " + (x/1e3).toFixed(0) + "K";
  return "$ " + x.toLocaleString("es-AR", { minimumFractionDigits:0 });
};
const fFull = (n) => "$ " + Number(n||0).toLocaleString("es-AR", { minimumFractionDigits:0 });
const parseN = (s) => parseFloat(String(s||"").replace(",",".")) || 0;

/* ─── Cálculo de un renglón ─────────────────────────────────────────────── */
function calcR(r, tcGlobal) {
  const tc    = parseN(r.tcInd) > 0 ? parseN(r.tcInd) : tcGlobal;
  const iva   = parseN(r.iva) / 100;
  const mult  = parseN(r.markup) || 1;
  const costo = parseN(r.costo);
  if (costo <= 0 || tc <= 0) return null;
  const cARS   = r.moneda === "ARS" ? costo : costo * tc;
  const cIvaARS= cARS * (1 + iva);
  const cIvaUSD= cIvaARS / tc;
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
  return {
    cARS, cIvaARS, cIvaUSD,
    pvARSs, pvARSc,
    pvUSDs: pvARSs / tc, pvUSDc: pvARSc / tc,
    sub, mkPct, gm, cant, tc,
  };
}

/* ─── Renglón vacío ──────────────────────────────────────────────────────── */
const emptyR = () => ({
  id:         Date.now() + Math.random(),
  empresa:"", renglon:"", subitem:"", codigo:"", marca:"", descr:"",
  costo:"",   cant:1,    moneda:"USD", iva:"10.5", markup:"2",
  tcInd:"",   modoManual:"auto",       pvManual:"",
});

const VENDEDORES = ["Monica Somosa","Daniel Etchudez","Soledad Cantero","Otros"];
const ESTADOS    = ["borrador","enviada","seguimiento","negociacion","ganada","perdida","facturada","cobrada"];
const ESTADO_LABELS = {
  borrador:"Borrador", enviada:"Enviada", seguimiento:"Seguimiento",
  negociacion:"Negociación", ganada:"Ganada", perdida:"Perdida",
  facturada:"Facturada", cobrada:"Cobrada",
};

/* ══════════════════════════════════════════════════════════════════════════
   COMPONENTE PRINCIPAL
══════════════════════════════════════════════════════════════════════════ */
export default function CotizadorPage({ profile, onNavigate }) {

  /* ── Parámetros globales ── */
  const [vendedor,    setVendedor]    = useState("");
  const [tc,          setTc]          = useState("1425");
  const [fechaApert,  setFechaApert]  = useState("");
  const [nroLicit,    setNroLicit]    = useState("");
  const [institucion, setInstitucion] = useState("");
  const [plazoVenta,  setPlazoVenta]  = useState("");
  const [mantOferta,  setMantOferta]  = useState("");
  const [formaCobro,  setFormaCobro]  = useState("");

  /* ── Renglones ── */
  const [renglones, setRenglones] = useState([emptyR()]);

  /* ── Cotización en edición ── */
  const [docId,    setDocId]    = useState(null);
  const [quoteNum, setQuoteNum] = useState(null);

  /* ── UI ── */
  const [saving,        setSaving]        = useState(false);
  const [toast,         setToast]         = useState(null);
  const [showHistorial, setShowHistorial] = useState(false);
  const [showPapelera,  setShowPapelera]  = useState(false);
  const [histItems,     setHistItems]     = useState([]);
  const [papItems,      setPapItems]      = useState([]);
  const [histSearch,    setHistSearch]    = useState("");
  const [loadingHist,   setLoadingHist]   = useState(false);

  /* ── Dashboard ── */
  const [dashData, setDashData] = useState([]);
  const [loadingDash, setLoadingDash] = useState(true);

  /* ── Logo para PDF ── */
  const logoB64Ref = useRef(null);
  const logoWRef   = useRef(400);
  const logoHRef   = useRef(114);

  /* ── Init ── */
  useEffect(() => {
    const vMatch = VENDEDORES.find(v =>
      profile?.full_name && v.toLowerCase().includes(profile.full_name.split(" ")[0].toLowerCase())
    );
    if (vMatch) setVendedor(vMatch);

    loadDashData();

    try {
      import("../assets/logo.jpg").then(m => {
        fetch(m.default).then(r=>r.blob()).then(b=>{
          const reader = new FileReader();
          reader.onload = () => {
            logoB64Ref.current = reader.result;
            const img = new Image();
            img.onload = () => { logoWRef.current = img.naturalWidth; logoHRef.current = img.naturalHeight; };
            img.src = reader.result;
          };
          reader.readAsDataURL(b);
        });
      }).catch(()=>{});
    } catch {}
  }, []);

  /* ── Toast ── */
  const showToast = useCallback((msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  /* ── Total general ── */
  const totalGeneral = renglones.reduce((s, r) => {
    const c = calcR(r, parseN(tc));
    return s + (c?.sub || 0);
  }, 0);

  /* ── Modificar renglón ── */
  const updateR = (id, key, val) =>
    setRenglones(prev => prev.map(r => r.id === id ? {...r, [key]: val} : r));
  const addR    = () => setRenglones(prev => [...prev, emptyR()]);
  const removeR = (id) => {
    if (renglones.length <= 1) { showToast("Debe haber al menos un renglón","err"); return; }
    setRenglones(prev => prev.filter(r => r.id !== id));
  };

  /* ── Nueva cotización ── */
  function nuevaCotizacion() {
    if (docId && !confirm("¿Crear nueva cotización? Los datos sin guardar se perderán.")) return;
    setDocId(null); setQuoteNum(null);
    setVendedor(""); setTc("1425"); setFechaApert(""); setNroLicit("");
    setInstitucion(""); setPlazoVenta(""); setMantOferta(""); setFormaCobro("");
    setRenglones([emptyR()]);
    const vMatch = VENDEDORES.find(v =>
      profile?.full_name && v.toLowerCase().includes(profile.full_name.split(" ")[0].toLowerCase())
    );
    if (vMatch) setVendedor(vMatch);
    window.scrollTo(0,0);
  }

  /* ── Snapshot para Supabase ── */
  function buildSnap(quoteNumber, quoteNumFormatted) {
    const snap = {
      vendedor,
      tc:           parseN(tc),
      fecha_apert:  fechaApert || null,
      nro_licit:    nroLicit   || null,
      institucion:  institucion|| null,
      plazo_venta:  plazoVenta || null,
      mant_oferta:  mantOferta || null,
      forma_cobro:  formaCobro || null,
      renglones:    renglones.map(r => ({
        empresa:r.empresa, renglon:r.renglon, subitem:r.subitem,
        codigo:r.codigo,   marca:r.marca,     descr:r.descr,
        costo:r.costo,     cant:r.cant,       moneda:r.moneda,
        iva:String(r.iva), markup:String(r.markup),
        tcInd:r.tcInd||"", modoManual:r.modoManual||"auto", pvManual:r.pvManual||"",
      })),
      total_general: totalGeneral,
      updated_at:    new Date().toISOString(),
      updated_by:    profile?.email || "desconocido",
      owner_id:      profile?.id    || null,
    };
    if (quoteNumber)       snap.quote_number        = quoteNumber;
    if (quoteNumFormatted) snap.quote_num_formatted  = quoteNumFormatted;
    return snap;
  }

  /* ── Guardar cotización ── */
  async function guardar() {
    setSaving(true);
    try {
      if (docId) {
        const { error } = await supabase.from("cotizaciones")
          .update(buildSnap())
          .eq("id", docId);
        if (error) throw error;
        showToast(`Cotización #${quoteNum} actualizada ✓`);
        setDashData(prev => prev.map(d => d.id === docId ? {...d, ...buildSnap(), total_general: totalGeneral} : d));
      } else {
        const { data: numData, error: numError } = await supabase.rpc("next_quote_number");
        if (numError) throw numError;
        const qNum      = numData;
        const qFormatted= String(qNum).padStart(6,"0");
        const snap = {
          ...buildSnap(qNum, qFormatted),
          created_at: new Date().toISOString(),
          created_by: profile?.email || "desconocido",
          estado:     "borrador",
          deleted:    false,
        };
        const { data: newRow, error } = await supabase
          .from("cotizaciones").insert([snap]).select().single();
        if (error) throw error;
        setDocId(newRow.id);
        setQuoteNum(qFormatted);
        showToast(`Cotización #${qFormatted} guardada ✓`);
        setDashData(prev => [{...newRow, _date: new Date(), _gm: calcGM(newRow), _total: totalGeneral}, ...prev]);
      }
    } catch(e) {
      showToast("Error al guardar: " + e.message, "err");
    }
    setSaving(false);
  }

  /* ── Calcular GM desde un registro ── */
  function calcGM(row) {
    const tc_  = parseN(row.tc) || 1425;
    const rens = row.renglones  || [];
    if (!rens.length) return 0;
    let totalPV = 0, totalC = 0;
    rens.forEach(r => {
      const cr = parseN(r.costo); if (!cr) return;
      const mult = parseN(r.markup) || 2;
      const mon  = r.moneda || "USD";
      const cARS = mon === "ARS" ? cr : cr * tc_;
      const cant = parseInt(r.cant) || 1;
      totalPV += cARS * mult * cant;
      totalC  += cARS * cant;
    });
    return totalPV > 0 ? (totalPV - totalC) / totalPV * 100 : 0;
  }

  /* ── Cargar dashboard ── */
  async function loadDashData() {
    setLoadingDash(true);
    const { data, error } = await supabase
      .from("cotizaciones")
      .select("id,quote_num_formatted,vendedor,tc,renglones,total_general,estado,created_at,deleted")
      .eq("deleted", false)
      .order("created_at", { ascending: false })
      .limit(500);
    if (!error && data) {
      setDashData(data.map(d => ({
        ...d,
        _date:  d.created_at ? new Date(d.created_at) : null,
        _gm:    calcGM(d),
        _total: parseN(d.total_general),
      })));
    }
    setLoadingDash(false);
  }

  /* ── KPIs dashboard ── */
  const now    = new Date();
  const thisM  = dashData.filter(d => d._date && d._date.getMonth() === now.getMonth() && d._date.getFullYear() === now.getFullYear());
  const prevMo = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
  const prevYr = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const prevM  = dashData.filter(d => d._date && d._date.getMonth() === prevMo && d._date.getFullYear() === prevYr);
  const avgGM  = arr => { const v = arr.filter(d=>d._gm>0); return v.length ? v.reduce((s,d)=>s+d._gm,0)/v.length : 0; };
  const dashKPIs = {
    gmMes:     avgGM(thisM).toFixed(1),
    gmPrevMes: avgGM(prevM).toFixed(1),
    countMes:  thisM.length,
    totalMes:  thisM.reduce((s,d)=>s+d._total,0),
  };

  /* ── Historial ── */
  async function abrirHistorial() {
    setLoadingHist(true);
    setShowHistorial(true);
    const { data, error } = await supabase
      .from("cotizaciones")
      .select("*")
      .eq("deleted", false)
      .order("created_at", { ascending: false })
      .limit(100);
    if (!error) setHistItems(data || []);
    else showToast("Error cargando historial: " + error.message, "err");
    setLoadingHist(false);
  }

  async function cambiarEstado(id, estado) {
    const { error } = await supabase.from("cotizaciones").update({
      estado, updated_at: new Date().toISOString(), updated_by: profile?.email||"",
    }).eq("id", id);
    if (!error) {
      setHistItems(prev => prev.map(c => c.id === id ? {...c, estado} : c));
      setDashData(prev => prev.map(d => d.id === id ? {...d, estado} : d));
      showToast("Estado actualizado");
    } else showToast("Error: " + error.message, "err");
  }

  async function softDelete(id, num) {
    if (!confirm(`¿Borrar cotización #${num}?`)) return;
    const { error } = await supabase.from("cotizaciones").update({
      deleted:          true,
      deleted_at:       new Date().toISOString(),
      deleted_by_name:  profile?.full_name || profile?.email || "desconocido",
    }).eq("id", id);
    if (!error) {
      setHistItems(prev => prev.filter(c => c.id !== id));
      setDashData(prev => prev.filter(d => d.id !== id));
      showToast("Cotización eliminada");
    } else showToast("Error: " + error.message, "err");
  }

  /* ── Papelera ── */
  async function abrirPapelera() {
    setShowPapelera(true);
    const { data, error } = await supabase
      .from("cotizaciones")
      .select("id,quote_num_formatted,vendedor,institucion,total_general,deleted_at,deleted_by_name")
      .eq("deleted", true)
      .order("deleted_at", { ascending: false });
    if (!error) setPapItems(data || []);
    else showToast("Error: " + error.message, "err");
  }

  async function restaurar(id, num) {
    if (!confirm(`¿Restaurar #${num}?`)) return;
    const { error } = await supabase.from("cotizaciones").update({
      deleted: false, deleted_at: null, deleted_by_name: null,
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    if (!error) {
      setPapItems(prev => prev.filter(c => c.id !== id));
      showToast(`Cotización #${num} restaurada`);
      loadDashData();
    } else showToast("Error: " + error.message, "err");
  }

  /* ── Cargar cotización para editar ── */
  async function loadCotizacion(id) {
    const { data, error } = await supabase.from("cotizaciones").select("*").eq("id", id).single();
    if (error || !data) { showToast("No encontrada", "err"); return; }
    setDocId(data.id);
    setQuoteNum(data.quote_num_formatted || String(data.quote_number) || "?");
    setVendedor(data.vendedor||""); setTc(String(data.tc||"1425"));
    setFechaApert(data.fecha_apert||""); setNroLicit(data.nro_licit||"");
    setInstitucion(data.institucion||""); setPlazoVenta(data.plazo_venta||"");
    setMantOferta(data.mant_oferta||""); setFormaCobro(data.forma_cobro||"");
    const raws = data.renglones || [];
    setRenglones(raws.length > 0 ? raws.map(r => ({
      id: Date.now() + Math.random(),
      empresa:r.empresa||"", renglon:r.renglon||"", subitem:r.subitem||"",
      codigo:r.codigo||"",   marca:r.marca||"",     descr:r.descr||"",
      costo:r.costo||"",     cant:r.cant||1,        moneda:r.moneda||"USD",
      iva:String(r.iva||"10.5"), markup:String(r.markup||"2"),
      tcInd:r.tcInd||"",     modoManual:r.modoManual||"auto", pvManual:r.pvManual||"",
    })) : [emptyR()]);
    setShowHistorial(false);
    showToast(`Cotización #${data.quote_num_formatted||"?"} cargada`);
    window.scrollTo(0,0);
  }

  /* ── Historial filtrado ── */
  const histFiltrado = histSearch
    ? histItems.filter(c => [
        c.quote_num_formatted, c.vendedor, c.institucion, c.nro_licit,
        (c.renglones||[]).map(r=>(r.descr||"")+" "+(r.empresa||"")+" "+(r.marca||"")).join(" ")
      ].join(" ").toLowerCase().includes(histSearch.toLowerCase()))
    : histItems;

  /* ── Export PDF ── */
  async function exportPDF() {
    const hasData = renglones.some(r => parseN(r.costo) > 0);
    if (!hasData) { showToast("Ingresá el costo en al menos un renglón","err"); return; }
    const tcN   = parseN(tc);
    const fecha = new Date().toLocaleDateString("es-AR",{day:"2-digit",month:"long",year:"numeric"});
    const esc   = (t) => String(t||"")
      .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
      .replace(/[\\]/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)")
      .replace(/[^\x20-\x7E]/g,"").substring(0,110);

    const W=595.28, H=841.89;
    const HDR = (nroLicit||institucion||fechaApert) ? 128 : 90;
    let ps=[], pageY=H, pages=[];

    const txt  = (x,y,t,sz,b) => ps.push(`BT /${b?"F2":"F1"} ${sz} Tf ${x} ${y} Td (${esc(t)}) Tj ET`);
    const fill = (x,y,w,h,r,g,b) => ps.push(`${r} ${g} ${b} rg ${x} ${y} ${w} ${h} re f 0 0 0 rg`);
    const strk = (x,y,w,h,r,g,b,lw=0.5) => ps.push(`${r} ${g} ${b} RG ${lw} w ${x} ${y} ${w} ${h} re S 0 0 0 RG`);
    const hln  = (x1,y1,x2,r,g,b,lw=0.5) => ps.push(`${r} ${g} ${b} RG ${lw} w ${x1} ${y1} m ${x2} ${y1} l S 0 0 0 RG`);

    function drawHeader() {
      fill(0,H-HDR,W,HDR,1,1,1);
      hln(0,H-HDR-1,W,.055,.373,.659,2);
      if (logoB64Ref.current) {
        const LLW=175, LLH=Math.round(175*(logoHRef.current/logoWRef.current));
        ps.push(`q ${LLW} 0 0 ${LLH} 18 ${H-HDR+(HDR-LLH)/2} cm /Img1 Do Q`);
      }
      ps.push(".055 .373 .659 rg"); txt(210,H-22,"ANALISIS DE PRECIOS",15,true);
      ps.push(".28 .28 .28 rg");    txt(210,H-37,"Drogueria Medi-Cross S.R.L.",9,false);
      const numLabel = quoteNum ? "Cotizacion #"+quoteNum : "Sin guardar";
      ps.push(".22 .22 .22 rg");    txt(210,H-50,numLabel+" | "+fecha,7.8,true);
      ps.push(".45 .45 .45 rg");    txt(210,H-62,"TC: $"+tcN.toLocaleString("es-AR")+" ARS/USD",7.5,false);
      if (vendedor) {
        fill(210,H-79,175,13,.91,.95,.99); strk(210,H-79,175,13,.055,.373,.659,.4);
        ps.push(".055 .373 .659 rg"); txt(215,H-75,"Vendedor: "+vendedor,7.5,true);
      }
      if (nroLicit||institucion||fechaApert) {
        ps.push(".85 .85 .85 RG .4 w 400 "+(H-HDR+8)+" m 400 "+(H-12)+" l S 0 0 0 RG");
        ps.push(".055 .373 .659 rg"); txt(408,H-20,"LICITACION",6.5,true);
        hln(408,H-23,W-12,.055,.373,.659,.25);
        let ly=H-34;
        [[nroLicit,"N.Licit."],[fechaApert,"Apertura"],[institucion,"Institucion"],
         [plazoVenta,"Plazo"],[mantOferta,"Mant.Oferta"],[formaCobro,"Cobro"]
        ].forEach(([val,lbl]) => {
          if (!val) return;
          ps.push(".55 .55 .55 rg"); txt(408,ly,lbl+":",6.5,false);
          ps.push(".10 .10 .10 rg"); txt(460,ly,String(val).substring(0,20),6.5,true);
          ly-=10;
        });
      }
      ps.push("0 0 0 rg");
      pageY = H-HDR-16;
    }

    drawHeader();

    // Tabla resumen
    const LX=20, CW=W-40;
    const colDefs=[{l:"#",w:14},{l:"Empresa",w:52},{l:"Renglon",w:26},{l:"Descripcion",w:108},
                   {l:"Marca",w:48},{l:"Costo ARS",w:58},{l:"PV USD s/IVA",w:60},
                   {l:"PV ARS s/IVA",w:60},{l:"PV ARS c/IVA",w:60},{l:"Cant",w:16},{l:"Subtotal",w:70}];
    const totW=colDefs.reduce((s,c)=>s+c.w,0), sc=CW/totW;
    const cw=colDefs.map(c=>({...c,w:Math.round(c.w*sc)}));
    let y=pageY;
    fill(LX,y-14,CW,14,.055,.373,.659); ps.push("1 1 1 rg");
    let cx_=LX; cw.forEach(c=>{txt(cx_+2,y-10,c.l,6,true);cx_+=c.w;});
    ps.push("0 0 0 rg"); y-=14;

    renglones.forEach((r,idx)=>{
      const c=calcR(r,tcN); if(!c) return;
      idx%2===0?fill(LX,y-12,CW,12,.97,.97,.97):fill(LX,y-12,CW,12,1,1,1);
      hln(LX,y-12,LX+CW,.82,.82,.82,.3);
      let cx2=LX;
      [String(idx+1),(r.empresa||"-").substring(0,8),
       ((r.renglon||"-")+(r.subitem?"/"+r.subitem:"")).substring(0,6),
       (r.descr||"-").substring(0,22),(r.marca||"-").substring(0,7),
       fARS(c.cARS),fUSD(c.pvUSDs),fARS(c.pvARSs),fARS(c.pvARSc),
       String(c.cant),fARS(c.sub)
      ].forEach((v,i)=>{
        const acc=i===8||i===10; ps.push(acc?".055 .373 .659 rg":"0 0 0 rg");
        txt(cx2+2,y-8,v,6,acc); cx2+=cw[i].w;
      });
      ps.push("0 0 0 rg"); y-=12;
    });

    fill(LX,y-14,CW,14,.055,.373,.659); ps.push("1 1 1 rg");
    txt(LX+4,y-10,"TOTAL GENERAL c/IVA (ARS)",8,true);
    const ts=fARS(totalGeneral); txt(W-LX-4-ts.length*5.1,y-10,ts,9,true);
    ps.push("0 0 0 rg"); y-=22; pageY=y;

    // Detalle renglones
    renglones.forEach((r,idx)=>{
      const c=calcR(r,tcN); if(!c) return;
      if(pageY-200 < 65){ pages.push([...ps]); ps=[]; drawHeader(); }
      y=pageY; y-=6;
      ps.push(".055 .373 .659 rg");
      txt(LX,y,`RENGLON ${idx+1}: ${(r.descr||r.codigo||"sin descripcion").substring(0,70)}`,8,true);
      hln(LX,y-10,W-LX,.055,.373,.659,.3); ps.push("0 0 0 rg"); y-=16;

      ps.push(".38 .38 .38 rg"); txt(LX,y,"Empresa:",8.5,false); ps.push("0 0 0 rg"); txt(LX+65,y,esc(r.empresa||"-"),8.5,false);
      ps.push(".38 .38 .38 rg"); txt(200,y,"Renglon/Sub:",8.5,false); ps.push("0 0 0 rg"); txt(270,y,(r.renglon||"-")+(r.subitem?"/"+r.subitem:""),8.5,false);
      ps.push(".38 .38 .38 rg"); txt(340,y,"Codigo:",8.5,false); ps.push("0 0 0 rg"); txt(390,y,esc(r.codigo||"-"),8.5,false);
      ps.push(".38 .38 .38 rg"); txt(450,y,"Marca:",8.5,false); ps.push("0 0 0 rg"); txt(490,y,esc(r.marca||"-"),8.5,false);
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

      const cW2=(CW-8)/2, cH=36;
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

    // Footer
    hln(LX,52,W-LX,.78,.78,.78,.4); ps.push(".62 .62 .62 rg");
    txt(LX,42,"Analisis de Precios — Medi-Cross S.R.L.",7.5,false);
    if(vendedor) txt(LX,31,"Cotizacion realizada por: "+vendedor,7.5,false);
    txt(W-110,42,fecha,7.5,false); ps.push("0 0 0 rg");
    pages.push([...ps]);

    // Generar binario PDF
    const s2u8 = s => { const u=new Uint8Array(s.length); for(let i=0;i<s.length;i++) u[i]=s.charCodeAt(i)&0xFF; return u; };
    const offs={};
    let pdf="%PDF-1.4\n%\xFF\xFF\n";
    const obj=(n,b)=>{ offs[n]=pdf.length; pdf+=`${n} 0 obj\n${b}\nendobj\n`; };
    const nPags=pages.length, baseP=3, baseC=baseP+nPags;
    const fontR1=baseC+nPags, fontR2=fontR1+1, imgR=fontR2+1;
    const kids=Array.from({length:nPags},(_,i)=>`${baseP+i} 0 R`).join(" ");
    const res=`/Font << /F1 ${fontR1} 0 R /F2 ${fontR2} 0 R >> /XObject << /Img1 ${imgR} 0 R >>`;
    obj(1,"<< /Type /Catalog /Pages 2 0 R >>");
    obj(2,`<< /Type /Pages /Kids [${kids}] /Count ${nPags} >>`);
    for(let i=0;i<nPags;i++) obj(baseP+i,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}]\n /Contents ${baseC+i} 0 R\n /Resources << ${res} >> >>`);
    for(let i=0;i<nPags;i++){ const s=pages[i].join("\n"); obj(baseC+i,`<< /Length ${s.length} >>\nstream\n${s}\nendstream`); }
    obj(fontR1,"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    obj(fontR2,"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

    let fin;
    if (logoB64Ref.current) {
      const bin=atob(logoB64Ref.current.split(",")[1]);
      const jpg=new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++) jpg[i]=bin.charCodeAt(i);
      offs[imgR]=pdf.length;
      const ih=`${imgR} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${logoWRef.current} /Height ${logoHRef.current}\n /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`;
      const iF="\nendstream\nendobj\n";
      const totN=imgR+1;
      let xs=`xref\n0 ${totN}\n0000000000 65535 f \n`;
      for(let i=1;i<totN;i++) xs+=String(offs[i]||0).padStart(10,"0")+" 00000 n \n";
      const tr=`trailer\n<< /Size ${totN} /Root 1 0 R >>\nstartxref\n${pdf.length+ih.length+jpg.length+iF.length}\n%%EOF`;
      const p1=s2u8(pdf+ih), p2=s2u8(iF+xs+tr);
      fin=new Uint8Array(p1.length+jpg.length+p2.length);
      fin.set(p1,0); fin.set(jpg,p1.length); fin.set(p2,p1.length+jpg.length);
    } else {
      const totN=imgR;
      let xs=`xref\n0 ${totN}\n0000000000 65535 f \n`;
      for(let i=1;i<totN;i++) xs+=String(offs[i]||0).padStart(10,"0")+" 00000 n \n";
      const tr=`trailer\n<< /Size ${totN} /Root 1 0 R >>\nstartxref\n${pdf.length}\n%%EOF`;
      fin=s2u8(pdf+xs+tr);
    }

    const fn=`MC_${quoteNum||"nueva"}_${(institucion||"cotizacion").substring(0,20).replace(/\s/g,"_")}_${new Date().toISOString().slice(0,10)}.pdf`;
    const blob=new Blob([fin],{type:"application/pdf"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download=fn;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),10000);

    // Subir a Supabase Storage
    try {
      const file = new File([fin], fn, { type: "application/pdf" });
      const { error: upErr } = await supabase.storage
        .from("cotizaciones-pdf")
        .upload(`pdfs/${fn}`, file, { upsert: true });
      if (upErr) showToast("PDF descargado (error al subir: "+upErr.message+")", "err");
      else showToast("PDF descargado y guardado en la nube ✓");
    } catch(e) {
      showToast("PDF descargado pero no subido: "+e.message, "err");
    }
  }

  /* ══════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════ */
  return (
    <Layout title="Cotizador" profile={profile} onNavigate={onNavigate}>
      <div className="cot-page">

        {/* Toast */}
        {toast && <div className={`cot-toast cot-toast--${toast.type}`}>{toast.msg}</div>}

        {/* Header */}
        <div className="cot-header">
          <div>
            <h2>Cotizador MediCross</h2>
            <p>
              {quoteNum
                ? <span className="cot-quote-badge cot-quote-badge--saved">Cotización #{quoteNum} — Guardada</span>
                : <span className="cot-quote-badge cot-quote-badge--new">Nueva cotización</span>
              }
            </p>
          </div>
          <div className="cot-header-actions">
            <button className="cot-btn cot-btn--ghost" onClick={abrirHistorial}>📋 Historial</button>
            <button className="cot-btn cot-btn--ghost" onClick={abrirPapelera} style={{color:"#dc2626"}}>🗑 Papelera</button>
            <button className="cot-btn cot-btn--ghost" onClick={nuevaCotizacion}>+ Nueva</button>
            <button className="cot-btn cot-btn--ghost" onClick={exportPDF}>⬇ PDF</button>
            <button className="cot-btn cot-btn--primary" onClick={guardar} disabled={saving}>
              {saving ? "Guardando…" : "💾 Guardar"}
            </button>
          </div>
        </div>

        {/* KPIs */}
        <div className="cot-dash-kpis">
          <div className="cot-kpi">
            <span className="cot-kpi__label">GM promedio mes actual</span>
            <span className="cot-kpi__val">{loadingDash?"…":dashKPIs.gmMes+"%"}</span>
            <span className="cot-kpi__sub">vs mes ant: {dashKPIs.gmPrevMes}%</span>
          </div>
          <div className="cot-kpi">
            <span className="cot-kpi__label">Cotizaciones este mes</span>
            <span className="cot-kpi__val">{loadingDash?"…":dashKPIs.countMes}</span>
            <span className="cot-kpi__sub">{dashData.length} totales activas</span>
          </div>
          <div className="cot-kpi cot-kpi--blue">
            <span className="cot-kpi__label">Monto cotizado este mes</span>
            <span className="cot-kpi__val">{loadingDash?"…":fCmp(dashKPIs.totalMes)}</span>
            <span className="cot-kpi__sub">total bruto c/IVA</span>
          </div>
          <div className="cot-kpi">
            <span className="cot-kpi__label">Ganadas / En negociación</span>
            <span className="cot-kpi__val">
              {dashData.filter(d=>d.estado==="ganada").length} /
              {dashData.filter(d=>d.estado==="negociacion").length}
            </span>
            <span className="cot-kpi__sub">del total registrado</span>
          </div>
        </div>

        {/* Parámetros globales */}
        <div className="cot-card">
          <h3 className="cot-section-title">Parámetros globales</h3>
          <div className="cot-grid-4">
            <div className="cot-field">
              <label>Vendedor</label>
              <select value={vendedor} onChange={e=>setVendedor(e.target.value)}>
                <option value="">— Seleccionar —</option>
                {VENDEDORES.map(v=><option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div className="cot-field">
              <label>Tipo de cambio USD → ARS</label>
              <input type="number" value={tc} onChange={e=>setTc(e.target.value)} placeholder="1425"/>
            </div>
            <div className="cot-field">
              <label>Institución / Hospital</label>
              <input value={institucion} onChange={e=>setInstitucion(e.target.value)} placeholder="Nombre"/>
            </div>
            <div className="cot-field">
              <label>N° Licitación</label>
              <input value={nroLicit} onChange={e=>setNroLicit(e.target.value)} placeholder="Ej: 001/2026"/>
            </div>
            <div className="cot-field">
              <label>Fecha apertura</label>
              <input type="date" value={fechaApert} onChange={e=>setFechaApert(e.target.value)}/>
            </div>
            <div className="cot-field">
              <label>Plazo de venta</label>
              <input value={plazoVenta} onChange={e=>setPlazoVenta(e.target.value)} placeholder="Ej: 30 días"/>
            </div>
            <div className="cot-field">
              <label>Mantenimiento oferta</label>
              <input value={mantOferta} onChange={e=>setMantOferta(e.target.value)} placeholder="Ej: 60 días"/>
            </div>
            <div className="cot-field">
              <label>Forma de cobro</label>
              <input value={formaCobro} onChange={e=>setFormaCobro(e.target.value)} placeholder="Ej: Cheque"/>
            </div>
          </div>
        </div>

        {/* Renglones */}
        <h3 className="cot-section-title" style={{marginTop:4}}>Renglones</h3>

        {renglones.map((r, idx) => {
          const calc = calcR(r, parseN(tc));
          return (
            <div key={r.id} className="cot-renglon">
              <div className="cot-renglon__header">
                <span className="cot-renglon__num">Renglón {idx+1}</span>
                <button className="cot-btn-del" onClick={()=>removeR(r.id)}>×</button>
              </div>
              <div className="cot-renglon__body">
                <div className="cot-renglon__left">
                  <div className="cot-grid-3">
                    <div className="cot-field"><label>Empresa / Proveedor</label>
                      <input value={r.empresa} onChange={e=>updateR(r.id,"empresa",e.target.value)} placeholder="Proveedor"/></div>
                    <div className="cot-field"><label>Renglón N°</label>
                      <input type="number" value={r.renglon} onChange={e=>updateR(r.id,"renglon",e.target.value)} placeholder="N°"/></div>
                    <div className="cot-field"><label>Sub ítem</label>
                      <input type="number" value={r.subitem} onChange={e=>updateR(r.id,"subitem",e.target.value)} placeholder="N°"/></div>
                  </div>
                  <div className="cot-grid-2" style={{marginTop:8}}>
                    <div className="cot-field"><label>Código</label>
                      <input value={r.codigo} onChange={e=>updateR(r.id,"codigo",e.target.value)} placeholder="SKU"/></div>
                    <div className="cot-field"><label>Marca</label>
                      <input value={r.marca} onChange={e=>updateR(r.id,"marca",e.target.value)} placeholder="Marca"/></div>
                  </div>
                  <div className="cot-field" style={{marginTop:8}}>
                    <label>Descripción</label>
                    <textarea rows={3} value={r.descr} onChange={e=>updateR(r.id,"descr",e.target.value)}
                      placeholder="Descripción completa del producto"/>
                  </div>
                  <div className="cot-divider"/>
                  <div className="cot-grid-3">
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
                  </div>
                  <div className="cot-grid-2" style={{marginTop:8}}>
                    <div className="cot-field"><label>Costo unitario</label>
                      <input value={r.costo} onChange={e=>updateR(r.id,"costo",e.target.value)} placeholder="0,00"/></div>
                    <div className="cot-field"><label>TC propio (vacío=global)</label>
                      <input value={r.tcInd} onChange={e=>updateR(r.id,"tcInd",e.target.value)} placeholder="ej: 1500"/></div>
                  </div>
                  {calc && (
                    <div className="cot-costo-box">
                      <span>Costo ARS: <strong>{fARS(calc.cARS)}</strong></span>
                      <span style={{color:"#94a3b8",fontSize:11}}>+ IVA {r.iva}% = {fARS(calc.cIvaARS)}</span>
                    </div>
                  )}
                  <div style={{marginTop:10,display:"flex",alignItems:"center",gap:10}}>
                    <label style={{fontSize:12,fontWeight:600,color:"#64748b"}}>Modo precio:</label>
                    <select value={r.modoManual} onChange={e=>updateR(r.id,"modoManual",e.target.value)}
                      style={{height:32,border:"1px solid #e2e8f0",borderRadius:6,fontSize:12,fontFamily:"inherit",padding:"0 8px",background:"#fff"}}>
                      <option value="auto">⚙ Automático</option>
                      <option value="manual">✏ Manual</option>
                    </select>
                  </div>
                  {r.modoManual === "manual" && (
                    <div className="cot-field" style={{marginTop:8}}>
                      <label style={{color:"#0f2444",fontWeight:700}}>Precio venta manual (ARS c/IVA)</label>
                      <input value={r.pvManual} onChange={e=>updateR(r.id,"pvManual",e.target.value)}
                        placeholder="ej: 11001889"
                        style={{borderColor:"#0f2444",background:"#eff6ff",fontWeight:700,fontSize:16}}/>
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
                      <div className="cot-field" style={{maxWidth:130}}>
                        <label>Cantidad</label>
                        <input type="number" value={r.cant} min={1}
                          onChange={e=>updateR(r.id,"cant",e.target.value)}
                          style={{textAlign:"center",fontWeight:700,fontSize:18}}/>
                      </div>
                      <div className="cot-subtotal">
                        <div>
                          <div style={{fontSize:12,opacity:.8}}>Subtotal c/IVA</div>
                          <div style={{fontSize:11,opacity:.6}}>{fARS(calc.pvARSc)} × {calc.cant} u.</div>
                        </div>
                        <strong>{fARS(calc.sub)}</strong>
                      </div>
                    </>
                  ) : (
                    <div className="cot-calc-placeholder">
                      Ingresá el costo para ver el cálculo
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        <button className="cot-btn-add" onClick={addR}>+ Agregar renglón</button>

        {/* Preview */}
        {renglones.some(r => calcR(r, parseN(tc))) && (
          <div className="cot-preview">
            <h3 className="cot-section-title" style={{padding:"14px 16px 0",margin:0}}>Previsualización</h3>
            <div className="cot-table-wrap">
              <table className="cot-table">
                <thead>
                  <tr>
                    <th>#</th><th>Empresa</th><th>Rengl.</th><th>Descripción</th><th>Marca</th>
                    <th>PV USD s/IVA</th><th>PV ARS s/IVA</th><th>PV ARS c/IVA</th><th>Cant.</th><th>Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {renglones.map((r, idx) => {
                    const c = calcR(r, parseN(tc));
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

        {/* Acciones bottom */}
        <div className="cot-actions-bottom">
          <button className="cot-btn cot-btn--ghost" onClick={nuevaCotizacion}>+ Nueva cotización</button>
          <button className="cot-btn cot-btn--ghost" onClick={exportPDF}>⬇ Exportar PDF</button>
          <button className="cot-btn cot-btn--primary" onClick={guardar} disabled={saving}>
            {saving ? "Guardando…" : "💾 Guardar cotización"}
          </button>
        </div>

      </div>

      {/* ══ MODAL HISTORIAL ══ */}
      {showHistorial && (
        <div className="cot-overlay" onClick={e=>{if(e.target.classList.contains("cot-overlay"))setShowHistorial(false);}}>
          <div className="cot-modal">
            <div className="cot-modal__header">
              <h3>Historial de cotizaciones</h3>
              <button className="cot-modal__close" onClick={()=>setShowHistorial(false)}>×</button>
            </div>
            <div style={{padding:"12px 16px",borderBottom:"1px solid #f0f4f8"}}>
              <input className="cot-search" value={histSearch} onChange={e=>setHistSearch(e.target.value)}
                placeholder="Buscar por N°, institución, descripción, vendedor…"/>
            </div>
            <div className="cot-modal__body">
              {loadingHist ? (
                <p style={{textAlign:"center",color:"#94a3b8",padding:32}}>Cargando…</p>
              ) : histFiltrado.length === 0 ? (
                <p style={{textAlign:"center",color:"#94a3b8",padding:32}}>
                  {histItems.length === 0 ? "No hay cotizaciones guardadas." : "Sin resultados."}
                </p>
              ) : histFiltrado.map(c => (
                <div key={c.id} className="cot-hist-item" onClick={()=>loadCotizacion(c.id)}>
                  <div className="cot-hist-item__top">
                    <span className="cot-hist-num">#{c.quote_num_formatted||"???"}</span>
                    {c.vendedor && <span className="cot-hist-vend">{c.vendedor.split(" ")[0]}</span>}
                    <span className={`cot-estado cot-estado--${c.estado||"borrador"}`}>
                      {ESTADO_LABELS[c.estado||"borrador"]}
                    </span>
                    <span className="cot-hist-date">
                      {c.created_at ? new Date(c.created_at).toLocaleDateString("es-AR") : "-"}
                      {c.institucion ? " — "+c.institucion.substring(0,30) : ""}
                    </span>
                  </div>
                  <div style={{fontSize:12,color:"#64748b",marginTop:2}}>
                    {(c.renglones||[]).map(r=>(r.descr||r.codigo||r.marca||"")).filter(Boolean).slice(0,3).join(" · ")}
                  </div>
                  <div style={{fontSize:12,fontWeight:700,color:"#0f2444",marginTop:2}}>
                    Total: {c.total_general ? fARS(c.total_general) : "-"}
                  </div>
                  <div className="cot-hist-actions" onClick={e=>e.stopPropagation()}>
                    <button className="cot-btn cot-btn--primary cot-btn--sm" onClick={()=>loadCotizacion(c.id)}>Editar</button>
                    <select className="cot-estado-select" value={c.estado||"borrador"}
                      onChange={e=>cambiarEstado(c.id,e.target.value)}>
                      {ESTADOS.map(s=><option key={s} value={s}>{ESTADO_LABELS[s]}</option>)}
                    </select>
                    <button className="cot-btn cot-btn--danger cot-btn--sm"
                      onClick={()=>softDelete(c.id,c.quote_num_formatted||"???")}>Borrar</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL PAPELERA ══ */}
      {showPapelera && (
        <div className="cot-overlay" onClick={e=>{if(e.target.classList.contains("cot-overlay"))setShowPapelera(false);}}>
          <div className="cot-modal">
            <div className="cot-modal__header">
              <h3 style={{color:"#dc2626"}}>🗑 Papelera</h3>
              <button className="cot-modal__close" onClick={()=>setShowPapelera(false)}>×</button>
            </div>
            <div className="cot-modal__body">
              {papItems.length === 0 ? (
                <p style={{textAlign:"center",color:"#94a3b8",padding:32}}>La papelera está vacía.</p>
              ) : papItems.map(c => (
                <div key={c.id} className="cot-hist-item" style={{borderColor:"rgba(220,38,38,.2)"}}>
                  <div className="cot-hist-item__top">
                    <span className="cot-hist-num">#{c.quote_num_formatted||"???"}</span>
                    {c.vendedor && <span className="cot-hist-vend">{c.vendedor.split(" ")[0]}</span>}
                    <span style={{fontSize:11,color:"#64748b",marginLeft:"auto"}}>
                      Borrada por {c.deleted_by_name||"-"}
                    </span>
                  </div>
                  <div style={{fontSize:12,fontWeight:700,color:"#0f2444",marginTop:2}}>
                    {c.institucion||""}{c.total_general?" — Total: "+fARS(c.total_general):""}
                  </div>
                  <div className="cot-hist-actions">
                    <button className="cot-btn cot-btn--sm"
                      style={{background:"#d1fae5",color:"#065f46",border:"1px solid #6ee7b7"}}
                      onClick={()=>restaurar(c.id,c.quote_num_formatted||"???")}>
                      ↩ Restaurar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </Layout>
  );
}