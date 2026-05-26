import { useEffect, useState } from "react";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";
import DashboardComercial from "../components/DashboardComercial";
import "./CotizadorPage.css";

const fARS   = (n) => "$ "   + Number(n||0).toLocaleString("es-AR",{minimumFractionDigits:2,maximumFractionDigits:2});
const fUSD   = (n) => "U$D " + Number(n||0).toLocaleString("es-AR",{minimumFractionDigits:2,maximumFractionDigits:2});
const fPct   = (n) => Number(n||0).toFixed(1) + "%";
const parseN = (s) => parseFloat(String(s||"").replace(",",".")) || 0;

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
});

const VENDEDORES    = ["Monica Somosa","Daniel Etchudez","Soledad Cantero","Otros"];
const ESTADOS       = ["borrador","enviada","seguimiento","negociacion","ganada","perdida","facturada","cobrada"];
const ESTADO_LABELS = { borrador:"Borrador", enviada:"Enviada", seguimiento:"Seguimiento", negociacion:"Negociación", ganada:"Ganada", perdida:"Perdida", facturada:"Facturada", cobrada:"Cobrada" };

export default function CotizadorPage({ profile, onNavigate, initialData }) {
  const [vendedor,    setVendedor]    = useState(initialData?.vendedor    || "");
  const [tc,          setTc]          = useState("1425");
  const [fechaApert,  setFechaApert]  = useState(initialData?.fechaApert  || "");
  const [nroLicit,    setNroLicit]    = useState(initialData?.nroLicit    || "");
  const [institucion, setInstitucion] = useState(initialData?.institucion || "");
  const [plazoVenta,  setPlazoVenta]  = useState("");
  const [mantOferta,  setMantOferta]  = useState("");
  const [formaCobro,  setFormaCobro]  = useState("");
  const [renglones,   setRenglones]   = useState([emptyR()]);
  const [docId,       setDocId]       = useState(null);
  const [quoteNum,    setQuoteNum]    = useState(null);
  const [saving,        setSaving]        = useState(false);
  const [toast,         setToast]         = useState(null);
  const [showHistorial, setShowHistorial] = useState(false);
  const [showPapelera,  setShowPapelera]  = useState(false);
  const [histItems,     setHistItems]     = useState([]);
  const [papItems,      setPapItems]      = useState([]);
  const [histSearch,    setHistSearch]    = useState("");
  const [loadingHist,   setLoadingHist]   = useState(false);

  useEffect(() => {
    if (!initialData?.vendedor) {
      const vMatch = VENDEDORES.find(v => profile?.full_name && v.toLowerCase().includes(profile.full_name.split(" ")[0].toLowerCase()));
      if (vMatch) setVendedor(vMatch);
    }
    if (initialData?.institucion || initialData?.nroLicit)
      showToast(`Cotización pre-cargada desde Licitaciones: ${initialData.institucion || initialData.nroLicit}`);
  }, []);

  function showToast(msg, type = "ok") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  const totalGeneral = renglones.reduce((s, r) => s + (calcR(r, parseN(tc))?.sub || 0), 0);

  const updateR = (id, key, val) => setRenglones(prev => prev.map(r => r.id === id ? {...r, [key]: val} : r));
  const addR    = () => setRenglones(prev => [...prev, emptyR()]);
  const removeR = (id) => {
    if (renglones.length <= 1) { showToast("Debe haber al menos un renglón","err"); return; }
    setRenglones(prev => prev.filter(r => r.id !== id));
  };

  function nuevaCotizacion() {
    if (docId && !confirm("¿Crear nueva cotización? Los datos sin guardar se perderán.")) return;
    setDocId(null); setQuoteNum(null);
    setVendedor(""); setTc("1425"); setFechaApert(""); setNroLicit("");
    setInstitucion(""); setPlazoVenta(""); setMantOferta(""); setFormaCobro("");
    setRenglones([emptyR()]);
    const vMatch = VENDEDORES.find(v => profile?.full_name && v.toLowerCase().includes(profile.full_name.split(" ")[0].toLowerCase()));
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

  async function guardar() {
    setSaving(true);
    try {
      if (docId) {
        const { error } = await supabase.from("cotizaciones").update(buildSnap()).eq("id", docId);
        if (error) throw error;
        showToast(`Cotización #${quoteNum} actualizada ✓`);
      } else {
        const { data: numData, error: numError } = await supabase.rpc("next_quote_number");
        if (numError) throw numError;
        const qNum = numData, qFormatted = String(qNum).padStart(6,"0");
        const snap = { ...buildSnap(qNum, qFormatted), created_at: new Date().toISOString(), created_by: profile?.email||"desconocido", estado:"borrador", deleted:false };
        const { data: newRow, error } = await supabase.from("cotizaciones").insert([snap]).select().single();
        if (error) throw error;
        setDocId(newRow.id); setQuoteNum(qFormatted);
        showToast(`Cotización #${qFormatted} guardada ✓`);
      }
    } catch(e) { showToast("Error al guardar: " + e.message, "err"); }
    setSaving(false);
  }

  async function abrirHistorial() {
    setLoadingHist(true); setShowHistorial(true);
    const { data, error } = await supabase.from("cotizaciones").select("*").eq("deleted",false).order("created_at",{ascending:false}).limit(100);
    if (!error) setHistItems(data||[]); else showToast("Error: "+error.message,"err");
    setLoadingHist(false);
  }

  async function cambiarEstado(id, estado) {
    const { error } = await supabase.from("cotizaciones").update({ estado, updated_at:new Date().toISOString(), updated_by:profile?.email||"" }).eq("id",id);
    if (!error) { setHistItems(prev=>prev.map(c=>c.id===id?{...c,estado}:c)); showToast("Estado actualizado"); }
    else showToast("Error: "+error.message,"err");
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

  async function loadCotizacion(id) {
    const { data, error } = await supabase.from("cotizaciones").select("*").eq("id",id).single();
    if (error||!data) { showToast("No encontrada","err"); return; }
    setDocId(data.id); setQuoteNum(data.quote_num_formatted||String(data.quote_number)||"?");
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
    })) : [emptyR()]);
    setShowHistorial(false);
    showToast(`Cotización #${data.quote_num_formatted||"?"} cargada`);
    window.scrollTo(0,0);
  }

  const histFiltrado = histSearch
    ? histItems.filter(c => [c.quote_num_formatted,c.vendedor,c.institucion,c.nro_licit,(c.renglones||[]).map(r=>(r.descr||"")+" "+(r.empresa||"")+" "+(r.marca||"")).join(" ")].join(" ").toLowerCase().includes(histSearch.toLowerCase()))
    : histItems;

  /* ── Export PDF ── */
  async function exportPDF() {
    const hasData = renglones.some(r => parseN(r.costo) > 0);
    if (!hasData) { showToast("Ingresá el costo en al menos un renglón","err"); return; }
    const tcN   = parseN(tc);
    const fecha = new Date().toLocaleDateString("es-AR",{day:"2-digit",month:"long",year:"numeric"});
    const esc   = (t) => String(t||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[\\]/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)").replace(/[^\x20-\x7E]/g,"").substring(0,110);

    const W=595.28, H=841.89;
    const HDR = (nroLicit||institucion||fechaApert) ? 136 : 100;
    let ps=[], pageY=H, pages=[];

    const txt  = (x,y,t,sz,b) => ps.push(`BT /${b?"F2":"F1"} ${sz} Tf ${x} ${y} Td (${esc(t)}) Tj ET`);
    const fill = (x,y,w,h,r,g,b) => ps.push(`${r} ${g} ${b} rg ${x} ${y} ${w} ${h} re f 0 0 0 rg`);
    const strk = (x,y,w,h,r,g,b,lw=0.5) => ps.push(`${r} ${g} ${b} RG ${lw} w ${x} ${y} ${w} ${h} re S 0 0 0 RG`);
    const hln  = (x1,y1,x2,r,g,b,lw=0.5) => ps.push(`${r} ${g} ${b} RG ${lw} w ${x1} ${y1} m ${x2} ${y1} l S 0 0 0 RG`);
    const vln  = (x,y1,y2,r,g,b,lw=0.5) => ps.push(`${r} ${g} ${b} RG ${lw} w ${x} ${y1} m ${x} ${y2} l S 0 0 0 RG`);

    function drawHeader() {
     // Fondo blanco para todo el header
     fill(0, H-HDR, W, HDR, 1, 1, 1);

     // Fondo blanco en zona logo
     fill(0, H-HDR, 192, HDR, 1, 1, 1);

     // Logo textual en azul sobre fondo blanco
     ps.push(".055 .373 .659 rg");
     txt(26, H-HDR+(HDR/2)+8, "MediCross", 22, true);

     ps.push(".055 .373 .659 rg");
     txt(26, H-HDR+(HDR/2)-10, "Productos Medicos Integrales", 7, false);

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
      const numLabel = quoteNum ? "Cotizacion #"+quoteNum : "Sin guardar";
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
      [String(idx+1),(r.empresa||"-").substring(0,8),((r.renglon||"-")+(r.subitem?"/"+r.subitem:"")).substring(0,6),(r.descr||"-").substring(0,22),(r.marca||"-").substring(0,7),fARS(c.cARS),fUSD(c.pvUSDs),fARS(c.pvARSs),fARS(c.pvARSc),String(c.cant),fARS(c.sub)].forEach((v,i)=>{
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
      if(pageY-200<65){pages.push([...ps]);ps=[];drawHeader();}
      y=pageY; y-=6;
      ps.push(".055 .373 .659 rg");
      txt(LX,y,`RENGLON ${idx+1}: ${(r.descr||r.codigo||"sin descripcion").substring(0,70)}`,8,true);
      hln(LX,y-10,W-LX,.055,.373,.659,.3); ps.push("0 0 0 rg"); y-=16;
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
    const fontR1=baseC+nPags,fontR2=fontR1+1;
    const kids=Array.from({length:nPags},(_,i)=>`${baseP+i} 0 R`).join(" ");
    const res=`/Font << /F1 ${fontR1} 0 R /F2 ${fontR2} 0 R >>`;
    obj(1,"<< /Type /Catalog /Pages 2 0 R >>");
    obj(2,`<< /Type /Pages /Kids [${kids}] /Count ${nPags} >>`);
    for(let i=0;i<nPags;i++) obj(baseP+i,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}]\n /Contents ${baseC+i} 0 R\n /Resources << ${res} >> >>`);
    for(let i=0;i<nPags;i++){const s=pages[i].join("\n");obj(baseC+i,`<< /Length ${s.length} >>\nstream\n${s}\nendstream`);}
    obj(fontR1,"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    obj(fontR2,"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const totN=fontR2+1;
    let xs=`xref\n0 ${totN}\n0000000000 65535 f \n`;
    for(let i=1;i<totN;i++) xs+=String(offs[i]||0).padStart(10,"0")+" 00000 n \n";
    const tr=`trailer\n<< /Size ${totN} /Root 1 0 R >>\nstartxref\n${pdf.length}\n%%EOF`;
    const fin=s2u8(pdf+xs+tr);

    const fn=`MC_${quoteNum||"nueva"}_${(institucion||"cotizacion").substring(0,20).replace(/\s/g,"_")}_${new Date().toISOString().slice(0,10)}.pdf`;
    const blob=new Blob([fin],{type:"application/pdf"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download=fn;
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),10000);

    try {
      const file=new File([fin],fn,{type:"application/pdf"});
      const {error:upErr}=await supabase.storage.from("cotizaciones-pdf").upload(`pdfs/${fn}`,file,{upsert:true});
      if(upErr) showToast("PDF descargado (error al subir: "+upErr.message+")","err");
      else showToast("PDF descargado y guardado en la nube ✓");
    } catch(e) { showToast("PDF descargado pero no subido: "+e.message,"err"); }
  }

  return (
    <Layout title="Cotizador" profile={profile} onNavigate={onNavigate}>
      <div className="cot-page">

        {toast && <div className={`cot-toast cot-toast--${toast.type}`}>{toast.msg}</div>}

        {initialData?.institucion && !docId && (
          <div className="cot-banner-warn">
            📋 Cotización iniciada desde Licitaciones — <strong>{initialData.institucion}</strong>
            {initialData.nroLicit ? ` · ${initialData.nroLicit}` : ""}. Completá los renglones y guardá.
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
            <button className="cot-btn cot-btn--ghost" onClick={()=>onNavigate("tenders")}>← Licitaciones</button>
            <button className="cot-btn cot-btn--ghost" onClick={abrirHistorial}>📋 Historial</button>
            <button className="cot-btn cot-btn--ghost" onClick={abrirPapelera} style={{color:"#dc2626"}}>🗑 Papelera</button>
            <button className="cot-btn cot-btn--ghost" onClick={nuevaCotizacion}>+ Nueva</button>
            <button className="cot-btn cot-btn--ghost" onClick={exportPDF}>⬇ PDF</button>
            <button className="cot-btn cot-btn--primary" onClick={guardar} disabled={saving}>
              {saving?"Guardando…":"💾 Guardar"}
            </button>
          </div>
        </div>

        <DashboardComercial />

        <div className="cot-card">
          <h3 className="cot-section-title">⚙️ Parámetros globales</h3>
          <div className="cot-grid-4">
            <div className="cot-field"><label>Vendedor</label>
              <select value={vendedor} onChange={e=>setVendedor(e.target.value)}>
                <option value="">— Seleccionar —</option>
                {VENDEDORES.map(v=><option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div className="cot-field"><label>Tipo de cambio USD → ARS</label>
              <input type="number" value={tc} onChange={e=>setTc(e.target.value)} placeholder="1425"/>
            </div>
            <div className="cot-field"><label>Institución / Hospital</label>
              <input value={institucion} onChange={e=>setInstitucion(e.target.value)} placeholder="Nombre"/>
            </div>
            <div className="cot-field"><label>N° Licitación</label>
              <input value={nroLicit} onChange={e=>setNroLicit(e.target.value)} placeholder="Ej: 001/2026"/>
            </div>
            <div className="cot-field"><label>Fecha apertura</label>
              <input type="date" value={fechaApert} onChange={e=>setFechaApert(e.target.value)}/>
            </div>
            <div className="cot-field"><label>Plazo de venta</label>
              <input value={plazoVenta} onChange={e=>setPlazoVenta(e.target.value)} placeholder="Ej: 30 días"/>
            </div>
            <div className="cot-field"><label>Mantenimiento oferta</label>
              <input value={mantOferta} onChange={e=>setMantOferta(e.target.value)} placeholder="Ej: 60 días"/>
            </div>
            <div className="cot-field"><label>Forma de cobro</label>
              <input value={formaCobro} onChange={e=>setFormaCobro(e.target.value)} placeholder="Ej: Cheque"/>
            </div>
          </div>
        </div>

        <h3 className="cot-section-title" style={{marginTop:4}}>📦 Renglones</h3>

        {renglones.map((r,idx) => {
          const calc = calcR(r, parseN(tc));
          return (
            <div key={r.id} className="cot-renglon">
              <div className="cot-renglon__header">
                <span className="cot-renglon__num">Renglón {idx+1}</span>
                <button className="cot-btn-del" onClick={()=>removeR(r.id)} title="Eliminar renglón">×</button>
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
                  <div className="cot-grid-2" style={{marginTop:10}}>
                    <div className="cot-field"><label>Código</label>
                      <input value={r.codigo} onChange={e=>updateR(r.id,"codigo",e.target.value)} placeholder="SKU"/></div>
                    <div className="cot-field"><label>Marca</label>
                      <input value={r.marca} onChange={e=>updateR(r.id,"marca",e.target.value)} placeholder="Marca"/></div>
                  </div>
                  <div className="cot-field" style={{marginTop:10}}><label>Descripción del producto</label>
                    <textarea rows={3} value={r.descr} onChange={e=>updateR(r.id,"descr",e.target.value)} placeholder="Descripción completa del producto"/>
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
                  <div className="cot-grid-2" style={{marginTop:10}}>
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
                      <div className="cot-field" style={{maxWidth:140}}>
                        <label>Cantidad</label>
                        <input type="number" value={r.cant} min={1} onChange={e=>updateR(r.id,"cant",e.target.value)}
                          style={{textAlign:"center",fontWeight:700,fontSize:20}}/>
                      </div>
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
          <button className="cot-btn cot-btn--ghost" onClick={exportPDF}>⬇ Exportar PDF</button>
          <button className="cot-btn cot-btn--primary" onClick={guardar} disabled={saving}>
            {saving?"Guardando…":"💾 Guardar cotización"}
          </button>
        </div>
      </div>

      {showHistorial && (
        <div className="cot-overlay" onClick={e=>{if(e.target.classList.contains("cot-overlay"))setShowHistorial(false);}}>
          <div className="cot-modal">
            <div className="cot-modal__header">
              <h3>📋 Historial de cotizaciones</h3>
              <button className="cot-modal__close" onClick={()=>setShowHistorial(false)}>×</button>
            </div>
            <div className="cot-modal__search">
              <input className="cot-search" value={histSearch} onChange={e=>setHistSearch(e.target.value)} placeholder="Buscar por N°, institución, descripción, vendedor…"/>
            </div>
            <div className="cot-modal__body">
              {loadingHist ? (
                <p style={{textAlign:"center",color:"#94a3b8",padding:32}}>Cargando…</p>
              ) : histFiltrado.length===0 ? (
                <p style={{textAlign:"center",color:"#94a3b8",padding:32}}>{histItems.length===0?"No hay cotizaciones guardadas.":"Sin resultados."}</p>
              ) : histFiltrado.map(c=>(
                <div key={c.id} className="cot-hist-item" onClick={()=>loadCotizacion(c.id)}>
                  <div className="cot-hist-item__top">
                    <span className="cot-hist-num">#{c.quote_num_formatted||"???"}</span>
                    {c.vendedor&&<span className="cot-hist-vend">{c.vendedor.split(" ")[0]}</span>}
                    <span className={`cot-estado cot-estado--${c.estado||"borrador"}`}>{ESTADO_LABELS[c.estado||"borrador"]}</span>
                    <span className="cot-hist-date">{c.created_at?new Date(c.created_at).toLocaleDateString("es-AR"):"-"}{c.institucion?" — "+c.institucion.substring(0,30):""}</span>
                  </div>
                  <div style={{fontSize:12,color:"#64748b",marginTop:2}}>
                    {(c.renglones||[]).map(r=>(r.descr||r.codigo||r.marca||"")).filter(Boolean).slice(0,3).join(" · ")}
                  </div>
                  <div style={{fontSize:12,fontWeight:700,color:"#0f2444",marginTop:2}}>Total: {c.total_general?fARS(c.total_general):"-"}</div>
                  <div className="cot-hist-actions" onClick={e=>e.stopPropagation()}>
                    <button className="cot-btn cot-btn--primary cot-btn--sm" onClick={()=>loadCotizacion(c.id)}>Editar</button>
                    <select className="cot-estado-select" value={c.estado||"borrador"} onChange={e=>cambiarEstado(c.id,e.target.value)}>
                      {ESTADOS.map(s=><option key={s} value={s}>{ESTADO_LABELS[s]}</option>)}
                    </select>
                    <button className="cot-btn cot-btn--danger cot-btn--sm" onClick={()=>softDelete(c.id,c.quote_num_formatted||"???")}>Borrar</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showPapelera && (
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
      )}
    </Layout>
  );
}
