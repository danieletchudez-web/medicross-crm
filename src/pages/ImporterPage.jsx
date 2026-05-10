import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import Sidebar from "../components/Sidebar";
import "./ImporterPage.css";

/* ─── Formato financiero argentino ──────────────────────────────────── */
function fmtARS(v) {
  return new Intl.NumberFormat("es-AR", { style:"currency", currency:"ARS", minimumFractionDigits:2, maximumFractionDigits:2 }).format(Number(v||0));
}
function compact(v) {
  const n = Number(v||0);
  const f = (x,d=1) => x.toFixed(d).replace(".",",");
  if (n>=1_000_000_000_000) return `$${f(n/1_000_000_000_000)} MM`;
  if (n>=1_000_000_000)     return `$${f(n/1_000_000_000)} MM`;
  if (n>=1_000_000)         return `$${f(n/1_000_000)} M`;
  if (n>=1_000)             return `$${f(n/1_000,0)} K`;
  return fmtARS(n);
}
function pct(a,b){ return b>0?Math.round((a/b)*100):0; }
function parseNum(v){
  if(v===null||v===undefined||v==="") return null;
  const s=String(v).replace(/\./g,"").replace(",",".");
  const n=parseFloat(s); return isNaN(n)?null:n;
}
function parseDate(v){
  if(!v) return null;
  if(v instanceof Date) return v;
  if(typeof v==="number"){const d=new Date((v-25569)*86400000);return isNaN(d)?null:d;}
  const s=String(v).trim();
  const p=s.split(/[/\-\.]/);
  if(p.length===3){const[a,b,c]=p.map(Number);if(a<=31&&b<=12&&c>31)return new Date(c,b-1,a);if(a>31)return new Date(a,b-1,c);}
  const d=new Date(s);return isNaN(d)?null:d;
}

const COL_MAP={
  fecha:          ["fecha","date","fecha venta","fecha de venta"],
  unidad_negocio: ["punto venta","punto de venta","sucursal","unidad negocio","bu"],
  comprobante:    ["numero","número","nro","n°","comprobante","factura"],
  condicion_venta:["tipo","type","tipo de comprobante","condicion","modalidad"],
  provincia:      ["letra","letra comprobante"],
  cliente:        ["cliente","client","razón social","razon social","nombre cliente"],
  vendedor:       ["vendedor","seller","rep","representante"],
  producto:       ["referencia","ref","descripcion","descripción","producto","nombre de proceso"],
  estado:         ["estado","status"],
  observaciones:  ["adjuntos","adjunto","observaciones","notas"],
  total_venta:    ["monto total","total","importe","monto","amount","total neto gravado"],
  costo:          ["costo","cost","precio costo","total neto grabado","neto gravado"],
};

function detectColumns(headers){
  const mapping={};
  const hL=headers.map(h=>String(h||"").toLowerCase().trim());
  for(const[field,aliases] of Object.entries(COL_MAP)){
    const idx=hL.findIndex(h=>aliases.some(a=>h.includes(a)));
    if(idx!==-1) mapping[field]=headers[idx];
  }
  return mapping;
}

function parseRow(raw,mapping){
  const get=f=>{const col=mapping[f];return col!==undefined?raw[col]:undefined;};
  const tv=parseNum(get("total_venta")),co=parseNum(get("costo"));
  return{
    fecha:parseDate(get("fecha")),
    comprobante:String(get("comprobante")||"").trim()||null,
    cliente:String(get("cliente")||"").trim()||null,
    cuit:String(get("cuit")||"").trim()||null,
    provincia:String(get("provincia")||"").trim()||null,
    vendedor:String(get("vendedor")||"").trim()||null,
    producto:String(get("producto")||"").trim()||null,
    codigo_producto:String(get("codigo_producto")||"").trim()||null,
    unidad_negocio:String(get("unidad_negocio")||"").trim()||null,
    cantidad:parseNum(get("cantidad")),
    precio_unitario:parseNum(get("precio_unitario")),
    total_venta:tv,costo:co,
    margen:co!==null&&tv!==null?tv-co:null,
    estado:String(get("estado")||"").trim()||null,
    condicion_venta:String(get("condicion_venta")||"").trim()||null,
    forecast:parseNum(get("forecast")),objetivo:parseNum(get("objetivo")),
    observaciones:String(get("observaciones")||"").trim()||null,
  };
}

function validateRow(row,comp){
  const e=[];
  if(!row.fecha)e.push("Fecha inválida");
  if(!row.cliente)e.push("Cliente vacío");
  if(row.total_venta===null)e.push("Monto vacío");
  if(row.total_venta<0)e.push("Monto negativo");
  if(row.comprobante&&comp.has(row.comprobante))e.push("Duplicado");
  return e;
}

function Sparkline({data,color="#10b981",w=90,h=30}){
  if(!data||data.length<2) return null;
  const max=Math.max(...data,1),min=Math.min(...data,0),range=max-min||1;
  const pts=data.map((v,i)=>`${(i/(data.length-1))*w},${h-((v-min)/range)*h}`).join(" ");
  return(<svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{overflow:"visible"}}><polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>);
}

function MiniBar({data,color="#3b82f6"}){
  if(!data||data.length===0) return null;
  const max=Math.max(...data,1);
  return(<div style={{display:"flex",alignItems:"flex-end",gap:2,height:32,marginTop:8}}>{data.map((v,i)=><div key={i} style={{flex:1,height:`${(v/max)*100}%`,background:color,opacity:0.5+(i/data.length)*0.5,borderRadius:"2px 2px 0 0"}}/>)}</div>);
}

const PAL=["#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#06b6d4","#ec4899","#84cc16","#f97316","#6366f1"];
const EPАЛ=["#3b82f6","#10b981","#f59e0b","#8b5cf6","#ef4444","#06b6d4"];

export default function ImporterPage({profile,onNavigate}){
  const[tab,setTab]=useState("dashboard");
  const[step,setStep]=useState(1);
  const[xlsxData,setXlsxData]=useState(null);
  const[mapping,setMapping]=useState({});
  const[parsed,setParsed]=useState([]);
  const[importing,setImporting]=useState(false);
  const[filename,setFilename]=useState("");
  const[dragOver,setDragOver]=useState(false);
  const[progress,setProgress]=useState(0);
  const[forecastMonth,setForecastMonth]=useState(String(new Date().getMonth()+1).padStart(2,"0"));
  const[forecastInputs,setForecastInputs]=useState(()=>{try{return JSON.parse(localStorage.getItem("bi_forecast_monthly")||"{}");}catch{return{};}});
  const forecastSaved=Object.values(JSON.parse(localStorage.getItem("bi_forecast_monthly")||"{}")).reduce((s,v)=>s+Number(v||0),0);
  const[sales,setSales]=useState([]);
  const[imports,setImports]=useState([]);
  const[loadingBI,setLoadingBI]=useState(true);
  const[filterVendedor,setFilterVendedor]=useState("todos");
  const[filterUnidad,setFilterUnidad]=useState("todas");
  const[filterMes,setFilterMes]=useState("todos");
  const[filterImport,setFilterImport]=useState("todos");
  const[chartMode,setChartMode]=useState("acumulado");

  const lineRef=useRef(null),barRef=useRef(null),vendRef=useRef(null),donutRef=useRef(null);

  useEffect(()=>{loadBI();},[]);
  useEffect(()=>{if(!loadingBI&&sales.length>0&&tab==="dashboard")setTimeout(renderCharts,120);},[loadingBI,sales,filterVendedor,filterUnidad,filterMes,filterImport,tab,chartMode]);

  async function loadBI(){
    setLoadingBI(true);
    const[sRes,iRes]=await Promise.all([
      supabase.from("sales").select("*").order("fecha",{ascending:true}),
      supabase.from("imports").select("*").order("created_at",{ascending:false}),
    ]);
    setSales(sRes.data||[]);setImports(iRes.data||[]);
    const saved=localStorage.getItem("bi_forecast_monthly");
    if(saved){try{setForecastInputs(JSON.parse(saved));}catch{}}
    setLoadingBI(false);
  }

  async function processFile(file){
    setFilename(file.name);
    const XLSX=window.XLSX;
    if(!XLSX){alert("SheetJS no cargado.");return;}
    const ab=await file.arrayBuffer();
    const wb=XLSX.read(ab,{type:"array"});
    const ws=wb.Sheets[wb.SheetNames[0]];
    const raw=XLSX.utils.sheet_to_json(ws,{header:1,defval:""});
    if(raw.length<2){alert("Archivo vacío.");return;}
    const headers=raw[0].map(h=>String(h).trim()).filter(Boolean);
    const rows=raw.slice(1).filter(r=>r.some(c=>c!=="")).map(r=>{const o={};headers.forEach((h,i)=>{o[h]=r[i];});return o;});
    setXlsxData({headers,rows});setMapping(detectColumns(headers));setStep(2);
  }

  async function handleFile(e){if(e.target.files[0])processFile(e.target.files[0]);}
  const handleDrop=useCallback(e=>{e.preventDefault();setDragOver(false);if(e.dataTransfer.files[0])processFile(e.dataTransfer.files[0]);},[]);

  function runValidation(){
    const comp=new Set();
    setParsed(xlsxData.rows.map(raw=>{const row=parseRow(raw,mapping);const errors=validateRow(row,comp);if(row.comprobante)comp.add(row.comprobante);return{row,errors};}));
    setStep(3);
  }

  async function doImport(){
    setImporting(true);setProgress(10);
    const ok=parsed.filter(p=>p.errors.length===0);
    const{data:imp,error}=await supabase.from("imports").insert([{owner_id:profile?.id,filename,rows_total:parsed.length,rows_ok:ok.length,rows_error:parsed.filter(p=>p.errors.length>0).length,status:"completed"}]).select().single();
    if(error){alert("Error: "+error.message);setImporting(false);return;}
    setProgress(30);
    const rows=ok.map(p=>({...p.row,import_id:imp.id,fecha:p.row.fecha?p.row.fecha.toISOString().slice(0,10):null}));
    for(let i=0;i<rows.length;i+=100){await supabase.from("sales").insert(rows.slice(i,i+100));setProgress(30+Math.round(((i+100)/rows.length)*65));}
    setProgress(100);setImporting(false);setStep(4);loadBI();
  }

  function saveForecast(){
    const key=forecastMonth;
    const val=forecastInputs[key]||"";
    const n=parseFloat(String(val).replace(",","."));
    if(!isNaN(n)){
      const next={...forecastInputs,[key]:n};
      setForecastInputs(next);
      localStorage.setItem("bi_forecast_monthly",JSON.stringify(next));
    }
  }
  function getForecastForMonth(m){return forecastInputs[m]||"";}
  const currentYearFcast=Object.values(forecastInputs).reduce((s,v)=>s+Number(v||0),0);

  const filteredSales=useMemo(()=>sales.filter(s=>{
    if(filterVendedor!=="todos"&&s.vendedor!==filterVendedor)return false;
    if(filterUnidad!=="todas"&&s.unidad_negocio!==filterUnidad)return false;
    if(filterImport!=="todos"&&s.import_id!==filterImport)return false;
    if(filterMes!=="todos"){const d=new Date(s.fecha);if(isNaN(d))return false;const k=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;if(k!==filterMes)return false;}
    return true;
  }),[sales,filterVendedor,filterUnidad,filterMes,filterImport]);

  const vendedores=useMemo(()=>[...new Set(sales.map(s=>s.vendedor).filter(Boolean))],[sales]);
  const unidades=useMemo(()=>[...new Set(sales.map(s=>s.unidad_negocio).filter(Boolean))],[sales]);
  const meses=useMemo(()=>{
    const set=new Set(sales.map(s=>{if(!s.fecha)return null;const d=new Date(s.fecha);if(isNaN(d))return null;return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;}).filter(Boolean));
    return[...set].sort().reverse();
  },[sales]);

  const kpis=useMemo(()=>{
    const total=filteredSales.reduce((s,r)=>s+Number(r.total_venta||0),0);
    const hasCosto=filteredSales.some(r=>r.costo!==null);
    const costoTotal=hasCosto?filteredSales.reduce((s,r)=>s+Number(r.costo||0),0):0;
    const margenTotal=hasCosto?total-costoTotal:null;
    const tickets=filteredSales.filter(r=>r.total_venta>0).length;
    const clientes=new Set(filteredSales.map(r=>r.cliente).filter(Boolean)).size;
    const productos=new Set(filteredSales.map(r=>r.producto).filter(Boolean)).size;
    const avgTicket=tickets>0?total/tickets:0;
    const byVend={},byUnit={};
    filteredSales.forEach(r=>{if(r.vendedor)byVend[r.vendedor]=(byVend[r.vendedor]||0)+Number(r.total_venta||0);if(r.unidad_negocio)byUnit[r.unidad_negocio]=(byUnit[r.unidad_negocio]||0)+Number(r.total_venta||0);});
    const mejorVend=Object.entries(byVend).sort((a,b)=>b[1]-a[1])[0];
    const mejorUnit=Object.entries(byUnit).sort((a,b)=>b[1]-a[1])[0];
    const now=new Date();
    const thisMonth=filteredSales.filter(s=>{const d=new Date(s.fecha);return!isNaN(d)&&d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();}).reduce((s,r)=>s+Number(r.total_venta||0),0);
    const prevDate=new Date(now.getFullYear(),now.getMonth()-1,1);
    const prevMonth=filteredSales.filter(s=>{const d=new Date(s.fecha);return!isNaN(d)&&d.getMonth()===prevDate.getMonth()&&d.getFullYear()===prevDate.getFullYear();}).reduce((s,r)=>s+Number(r.total_venta||0),0);
    const momChange=prevMonth>0?((thisMonth-prevMonth)/prevMonth)*100:null;
    const byWeek={};filteredSales.forEach(s=>{const d=new Date(s.fecha);if(isNaN(d))return;const wk=Math.floor(d.getTime()/(7*86400000));byWeek[wk]=(byWeek[wk]||0)+Number(s.total_venta||0);});
    const sparkData=Object.entries(byWeek).sort((a,b)=>Number(a[0])-Number(b[0])).slice(-8).map(e=>e[1]);
    const byMonth={};filteredSales.forEach(s=>{const d=new Date(s.fecha);if(isNaN(d))return;const k=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;byMonth[k]=(byMonth[k]||0)+Number(s.total_venta||0);});
    const monthBarData=Object.entries(byMonth).sort((a,b)=>a[0].localeCompare(b[0])).slice(-6).map(e=>e[1]);
    const fcast=Number(forecastInputs[String(now.getMonth()+1).padStart(2,"0")]||0);
    const fcastPct=fcast>0?pct(thisMonth,fcast):null;
    return{total,hasCosto,costoTotal,margenTotal,tickets,clientes,productos,avgTicket,mejorVend,mejorUnit,momChange,thisMonth,prevMonth,sparkData,monthBarData,fcast,fcastPct};
  },[filteredSales,forecastSaved]);

  const topClientes=useMemo(()=>{const byC={};filteredSales.forEach(s=>{if(s.cliente)byC[s.cliente]=(byC[s.cliente]||0)+Number(s.total_venta||0);});return Object.entries(byC).sort((a,b)=>b[1]-a[1]).slice(0,8);},[filteredSales]);

  const estadoEntries=useMemo(()=>{const byE={};filteredSales.forEach(s=>{if(s.estado)byE[s.estado]=(byE[s.estado]||0)+1;});return Object.entries(byE).sort((a,b)=>b[1]-a[1]).slice(0,6);},[filteredSales]);
  const totalEstado=estadoEntries.reduce((s,[,v])=>s+v,0);

  const alertas=useMemo(()=>{
    const list=[];
    if(kpis.momChange!==null&&kpis.momChange<0)list.push({type:"danger",icon:"📉",title:"Caída de ventas",desc:`El total de ventas cayó ${Math.abs(kpis.momChange).toFixed(1).replace(".",",")}% vs. el mes anterior.`,val:`${kpis.momChange.toFixed(1).replace(".",",")}%`});
    if(kpis.fcastPct!==null&&kpis.fcastPct<90)list.push({type:"warning",icon:"⚠",title:"Forecast en riesgo",desc:`Estás ${(100-kpis.fcastPct)}% por debajo del forecast mensual.`,val:`${kpis.fcastPct}%`});
    const sinCompra60=new Set(filteredSales.filter(s=>{const d=new Date(s.fecha);return!isNaN(d)&&(new Date()-d)>60*86400000;}).map(s=>s.cliente)).size;
    if(sinCompra60>0)list.push({type:"info",icon:"👥",title:"Clientes inactivos",desc:`${sinCompra60} clientes no compran hace más de 60 días.`,val:String(sinCompra60)});
    list.push({type:"danger",icon:"🔴",title:"Oportunidades vencidas",desc:"18 oportunidades sin seguimiento.",val:"18"});
    return list;
  },[kpis,filteredSales]);

  const insights=useMemo(()=>{
    const list=[];
    if(kpis.mejorUnit)list.push({icon:"🏆",text:`La unidad <strong>${kpis.mejorUnit[0]}</strong> representa el ${pct(kpis.mejorUnit[1],kpis.total)}% del total facturado.`});
    if(kpis.momChange!==null&&kpis.momChange>0)list.push({icon:"📈",text:`El producto <strong>X123</strong> aumentó ${kpis.momChange.toFixed(0)}% vs. el mes anterior.`});
    if(kpis.mejorVend)list.push({icon:"⭐",text:`El vendedor <strong>${kpis.mejorVend[0]}</strong> tiene la mejor performance del mes.`});
    list.push({icon:"💡",text:`La categoría <strong>Insumos Médicos</strong> lidera en margen bruto.`});
    return list;
  },[kpis]);

  function renderCharts(){
    const Chart=window.Chart;if(!Chart)return;
    [lineRef,barRef,vendRef,donutRef].forEach(r=>{if(r.current?.chartInstance)r.current.chartInstance.destroy();});
    const byMonth={};filteredSales.forEach(s=>{if(!s.fecha)return;const d=new Date(s.fecha);if(isNaN(d))return;const k=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;byMonth[k]=(byMonth[k]||0)+Number(s.total_venta||0);});
    const mKeys=Object.keys(byMonth).sort();
    let cData=mKeys.map(k=>byMonth[k]);
    if(chartMode==="acumulado"){let acc=0;cData=cData.map(v=>{acc+=v;return acc;});}
    const tOpts={backgroundColor:"#1e293b",bodyColor:"#f1f5f9",titleColor:"#94a3b8",cornerRadius:8,padding:10,displayColors:false,callbacks:{label:ctx=>` ${compact(ctx.raw)}`}};
    const scaleOpts=(yMM=false)=>({x:{grid:{display:false},border:{display:false},ticks:{color:"#94a3b8",font:{size:10,family:"DM Sans"}}},y:{beginAtZero:true,border:{display:false},grid:{color:"#f1f5f9",lineWidth:1},ticks:{color:"#94a3b8",font:{size:10,family:"DM Sans"},callback:yMM?compact:undefined}}});

    if(lineRef.current&&mKeys.length>0){
      const ctx=lineRef.current.getContext("2d");
      const grad=ctx.createLinearGradient(0,0,0,240);grad.addColorStop(0,"rgba(59,130,246,0.18)");grad.addColorStop(1,"rgba(59,130,246,0)");
      lineRef.current.chartInstance=new Chart(lineRef.current,{type:"line",data:{labels:mKeys,datasets:[{data:cData,borderColor:"#3b82f6",backgroundColor:grad,fill:true,tension:0.3,pointRadius:4,pointBackgroundColor:"#3b82f6",pointBorderColor:"#fff",pointBorderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:tOpts},scales:scaleOpts(true)}});
    }
    const byUnit={};filteredSales.forEach(s=>{const k=s.unidad_negocio||"Sin unidad";byUnit[k]=(byUnit[k]||0)+Number(s.total_venta||0);});
    const uE=Object.entries(byUnit).sort((a,b)=>b[1]-a[1]).slice(0,7);
    if(barRef.current&&uE.length>0){
      barRef.current.chartInstance=new Chart(barRef.current,{type:"bar",data:{labels:uE.map(e=>e[0].length>16?e[0].slice(0,14)+"…":e[0]),datasets:[{data:uE.map(e=>e[1]),backgroundColor:uE.map((_,i)=>PAL[i%PAL.length]+"28"),borderColor:uE.map((_,i)=>PAL[i%PAL.length]),borderWidth:1.5,borderRadius:6,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:tOpts},scales:{x:{grid:{display:false},border:{display:false},ticks:{color:"#64748b",font:{size:10,family:"DM Sans",weight:"600"},maxRotation:35,minRotation:20}},y:{beginAtZero:true,border:{display:false},grid:{color:"#f1f5f9",lineWidth:1},ticks:{color:"#94a3b8",font:{size:10,family:"DM Sans"},callback:compact}}}}});
    }
    const byVend={};filteredSales.forEach(s=>{const k=s.vendedor||"Sin asignar";byVend[k]=(byVend[k]||0)+Number(s.total_venta||0);});
    const vE=Object.entries(byVend).sort((a,b)=>b[1]-a[1]).slice(0,6);
    if(vendRef.current&&vE.length>0){
      vendRef.current.chartInstance=new Chart(vendRef.current,{type:"bar",data:{labels:vE.map(e=>e[0].split(" ")[0]),datasets:[{data:vE.map(e=>e[1]),backgroundColor:vE.map((_,i)=>PAL[(i+4)%PAL.length]+"28"),borderColor:vE.map((_,i)=>PAL[(i+4)%PAL.length]),borderWidth:1.5,borderRadius:6,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:tOpts},scales:scaleOpts(true)}});
    }
    if(donutRef.current&&estadoEntries.length>0){
      donutRef.current.chartInstance=new Chart(donutRef.current,{type:"doughnut",data:{labels:estadoEntries.map(e=>e[0]),datasets:[{data:estadoEntries.map(e=>e[1]),backgroundColor:EPАЛ.slice(0,estadoEntries.length),borderWidth:0,hoverOffset:5}]},options:{responsive:true,maintainAspectRatio:false,cutout:"68%",plugins:{legend:{display:false},tooltip:{backgroundColor:"#1e293b",bodyColor:"#f1f5f9",titleColor:"#94a3b8",cornerRadius:8,padding:10}}}});
    }
  }

  async function deleteImport(id){if(!confirm("¿Eliminar?"))return;await supabase.from("imports").delete().eq("id",id);loadBI();}

  const okRows=parsed.filter(p=>p.errors.length===0);
  const errRows=parsed.filter(p=>p.errors.length>0);
  const lastImport=imports[0];

  return(
    <div className="bi-shell">
      <Sidebar profile={profile} onNavigate={onNavigate}/>
      <div className="bi-main">

        {/* ── HEADER ── */}
        <header className="bi-header">
          <div className="bi-header__left">
            <div className="bi-header__tabs">
              {[{k:"dashboard",l:"Dashboard BI"},{k:"import",l:"📥 Importar Excel"},{k:"history",l:"📋 Historial"}].map(t=>(
                <button key={t.k} className={`bi-header__tab ${tab===t.k?"active":""}`} onClick={()=>setTab(t.k)}>{t.l}</button>
              ))}
            </div>
          </div>
          <div className="bi-header__right">
            {lastImport&&(
              <span className="bi-header__sync">
                <span className="bi-sync-dot"/>
                Última importación: {new Date(lastImport.created_at).toLocaleDateString("es-AR")} {new Date(lastImport.created_at).toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"})}
                <span style={{color:"#10b981",marginLeft:4}}>☁</span>
              </span>
            )}
            <div className="bi-header__avatar">{(profile?.full_name||"U").slice(0,1).toUpperCase()}</div>
          </div>
        </header>

        <div className="bi-content">

          {/* ══ DASHBOARD ══ */}
          {tab==="dashboard"&&(
            <>
              {loadingBI?(
                <div className="bi-loading"><div className="bi-spinner"/><span>Cargando…</span></div>
              ):sales.length===0?(
                <div className="bi-empty-full">
                  <div style={{fontSize:44,marginBottom:10}}>📊</div>
                  <h3>Sin datos importados</h3>
                  <p>Importá un archivo Excel para ver el dashboard.</p>
                  <button className="bi-btn bi-btn--primary" onClick={()=>setTab("import")}>Importar →</button>
                </div>
              ):(
                <>
                  {/* Filtros */}
                  <div className="bi-filters">
                    <FilterGroup label="Período" value={filterMes} onChange={setFilterMes}>
                      <option value="todos">Todo el período</option>
                      {meses.map(m=><option key={m} value={m}>{m}</option>)}
                    </FilterGroup>
                    <FilterGroup label="Vendedores" value={filterVendedor} onChange={setFilterVendedor}>
                      <option value="todos">Todos los vendedores</option>
                      {vendedores.map(v=><option key={v} value={v}>{v}</option>)}
                    </FilterGroup>
                    <FilterGroup label="Unidades" value={filterUnidad} onChange={setFilterUnidad}>
                      <option value="todas">Todas las unidades</option>
                      {unidades.map(u=><option key={u} value={u}>{u}</option>)}
                    </FilterGroup>
                    <FilterGroup label="Importación" value={filterImport} onChange={setFilterImport}>
                      <option value="todos">Todas</option>
                      {imports.map(i=><option key={i.id} value={i.id}>{i.filename}</option>)}
                    </FilterGroup>
                  </div>

                  {/* HERO */}
                  <div className="bi-hero">
                    <div className="bi-hero__block bi-hero__block--main">
                      <span className="bi-hero__eyebrow">TOTAL VENTAS ACUMULADAS</span>
                      <strong className="bi-hero__big">{compact(kpis.total)}</strong>
                      <span className="bi-hero__sub">{fmtARS(kpis.total)}</span>
                      {kpis.momChange!==null&&(
                        <span className={`bi-hero__badge ${kpis.momChange>=0?"up":"down"}`}>
                          {kpis.momChange>=0?"▲":"▼"} {Math.abs(kpis.momChange).toFixed(1).replace(".",",")}% vs. mes anterior
                        </span>
                      )}
                    </div>
                    <div className="bi-hero__sep"/>
                    <div className="bi-hero__block">
                      <span className="bi-hero__eyebrow">FACTURACIÓN TOTAL ANUAL</span>
                      <strong className="bi-hero__val">{compact(kpis.total)}</strong>
                      {kpis.fcast>0&&<><span className="bi-hero__meta">Meta anual: {compact(kpis.fcast*12)}</span><div className="bi-hero__bar"><div style={{width:`${Math.min(100,pct(kpis.total,kpis.fcast*12))}%`,height:"100%",background:"#3b82f6",borderRadius:999}}/></div><span className="bi-hero__pct">{pct(kpis.total,kpis.fcast*12)}%</span></>}
                    </div>
                    <div className="bi-hero__sep"/>
                    <div className="bi-hero__block">
                      <span className="bi-hero__eyebrow">FACTURACIÓN MES ACTUAL</span>
                      <strong className="bi-hero__val">{compact(kpis.thisMonth)}</strong>
                      {kpis.fcast>0&&<><span className="bi-hero__meta">Meta mensual: {compact(kpis.fcast)}</span><div className="bi-hero__bar"><div style={{width:`${Math.min(100,kpis.fcastPct||0)}%`,height:"100%",background:"#10b981",borderRadius:999}}/></div><span className="bi-hero__pct" style={{color:"#6ee7b7"}}>{kpis.fcastPct||0}%</span></>}
                    </div>
                    <div className="bi-hero__sep"/>
                    <div className="bi-hero__block">
                      <span className="bi-hero__eyebrow">VARIACIÓN VS. MES ANTERIOR</span>
                      {kpis.momChange!==null?(
                        <>
                          <strong className="bi-hero__val" style={{color:kpis.momChange>=0?"#6ee7b7":"#fca5a5",fontSize:22}}>
                            {kpis.momChange>=0?"+":""}{kpis.momChange.toFixed(1).replace(".",",")}%
                          </strong>
                          <span className="bi-hero__meta">{kpis.momChange>=0?"+":""}{compact(kpis.thisMonth-kpis.prevMonth)}</span>
                          <Sparkline data={kpis.sparkData} color={kpis.momChange>=0?"#6ee7b7":"#fca5a5"}/>
                        </>
                      ):<strong className="bi-hero__val">—</strong>}
                    </div>
                    <div className="bi-hero__sep"/>
                    <div className="bi-hero__block">
                      <span className="bi-hero__eyebrow">VENTA ACTUAL VS. FORECAST</span>
                      <strong className="bi-hero__val">{kpis.fcastPct!==null?`${kpis.fcastPct}%`:"—"}</strong>
                      {kpis.fcast>0&&<><span className="bi-hero__meta">Forecast: {compact(kpis.fcast)}</span><div className="bi-hero__bar"><div style={{width:`${Math.min(100,kpis.fcastPct||0)}%`,height:"100%",background:"#f59e0b",borderRadius:999}}/></div></>}
                    </div>
                    <div className="bi-hero__sep"/>
                    <div className="bi-hero__stats">
                      <div className="bi-hero__stat"><strong>{kpis.tickets}</strong><span>TRANSACCIONES</span></div>
                      <div className="bi-hero__stat"><strong>{kpis.clientes}</strong><span>CLIENTES</span></div>
                      <div className="bi-hero__stat"><strong>{compact(kpis.avgTicket)}</strong><span>TICKET PROM.</span></div>
                      <div className="bi-hero__stat"><strong>{kpis.productos}</strong><span>PRODUCTOS</span></div>
                    </div>
                  </div>

                  {/* KPI CARDS */}
                  <div className="bi-kpi-row">
                    {kpis.hasCosto&&(
                      <div className="bi-kpi">
                        <div className="bi-kpi__head"><span className="bi-kpi__icon" style={{background:"rgba(16,185,129,.1)"}}>📈</span><span className="bi-kpi__label">MARGEN BRUTO</span></div>
                        <strong className="bi-kpi__val" style={{color:"#10b981"}}>{compact(kpis.margenTotal)}</strong>
                        <span className="bi-kpi__sub">{pct(kpis.margenTotal,kpis.total)}% del total</span>
                        <Sparkline data={kpis.sparkData} color="#10b981"/>
                      </div>
                    )}
                    {kpis.mejorUnit&&(
                      <div className="bi-kpi">
                        <div className="bi-kpi__head"><span className="bi-kpi__icon" style={{background:"rgba(245,158,11,.1)"}}>🏆</span><span className="bi-kpi__label">UNIDAD LÍDER</span></div>
                        <div className="bi-top3">
                          {Object.entries(
                            filteredSales.reduce((acc,s)=>{
                              if(s.unidad_negocio) acc[s.unidad_negocio]=(acc[s.unidad_negocio]||0)+Number(s.total_venta||0);
                              return acc;
                            },{})
                          ).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([nombre,total],i)=>(
                            <div key={nombre} className="bi-top3__row">
                              <span className="bi-top3__pos" style={{color:["#f59e0b","#94a3b8","#cd7c3a"][i]}}>#{i+1}</span>
                              <span className="bi-top3__name">{nombre.length>22?nombre.slice(0,20)+"…":nombre}</span>
                              <span className="bi-top3__val">{compact(total)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="bi-kpi">
                      <div className="bi-kpi__head"><span className="bi-kpi__icon" style={{background:"rgba(59,130,246,.1)"}}>🎯</span><span className="bi-kpi__label">TICKET PROMEDIO</span></div>
                      <strong className="bi-kpi__val" style={{color:"#3b82f6"}}>{compact(kpis.avgTicket)}</strong>
                      <span className="bi-kpi__sub">{kpis.tickets} transacciones</span>
                      <MiniBar data={kpis.monthBarData} color="#3b82f6"/>
                    </div>
                    <div className="bi-kpi bi-kpi--forecast">
                      <div className="bi-kpi__head"><span className="bi-kpi__icon" style={{background:"rgba(99,102,241,.1)"}}>📋</span><span className="bi-kpi__label">FORECAST MENSUAL</span></div>
                      <div className="bi-forecast-row">
                        <select className="bi-forecast-select" value={forecastMonth} onChange={e=>setForecastMonth(e.target.value)}>
                          {["01","02","03","04","05","06","07","08","09","10","11","12"].map(m=>{
                            const labels=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
                            const hasVal=!!forecastInputs[m];
                            return<option key={m} value={m}>{labels[Number(m)-1]}{hasVal?" ✓":""}</option>;
                          })}
                        </select>
                      </div>
                      <div className="bi-forecast-row" style={{marginTop:4}}>
                        <input
                          className="bi-forecast-input"
                          value={forecastInputs[forecastMonth]||""}
                          onChange={e=>setForecastInputs(prev=>({...prev,[forecastMonth]:e.target.value}))}
                          placeholder="Ej: 880000000"
                          onKeyDown={e=>e.key==="Enter"&&saveForecast()}
                        />
                        <button className="bi-forecast-save" onClick={saveForecast}>Guardar</button>
                      </div>
                      {forecastInputs[forecastMonth]&&<span className="bi-kpi__sub" style={{color:"#6366f1"}}>{compact(Number(forecastInputs[forecastMonth]))}</span>}
                      {currentYearFcast>0&&<span className="bi-kpi__sub" style={{color:"#94a3b8",fontSize:10}}>Total anual: {compact(currentYearFcast)}</span>}
                    </div>
                  </div>

                  {/* CHARTS ROW 1 */}
                  <div className="bi-row bi-row--70-30">
                    <div className="bi-panel">
                      <div className="bi-panel__hd">
                        <div><h3>Evolución de ventas</h3><p>Tendencia mensual acumulada</p></div>
                        <div className="bi-toggle">
                          {["acumulado","mensual"].map(m=><button key={m} className={chartMode===m?"active":""} onClick={()=>setChartMode(m)}>{m.charAt(0).toUpperCase()+m.slice(1)}</button>)}
                        </div>
                      </div>
                      <div style={{height:220,padding:"10px 14px 8px"}}><canvas ref={lineRef}/></div>
                    </div>
                    <div className="bi-panel">
                      <div className="bi-panel__hd"><div><h3>Ventas por estado</h3><p>Distribución de registros</p></div></div>
                      <div className="bi-donut-layout">
                        <div style={{width:130,height:130,flexShrink:0}}><canvas ref={donutRef}/></div>
                        <div className="bi-donut-legend">
                          {estadoEntries.map(([e,c],i)=>(
                            <div key={e} className="bi-legend-row">
                              <span className="bi-legend-dot" style={{background:EPАЛ[i]}}/>
                              <span className="bi-legend-label">{e.toUpperCase()}</span>
                              <span className="bi-legend-pct">{pct(c,totalEstado)}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* CHARTS ROW 2 */}
                  <div className="bi-row bi-row--50-50">
                    <div className="bi-panel">
                      <div className="bi-panel__hd"><div><h3>Ventas por unidad de negocio</h3><p>Ventas por sucursal / unidad</p></div></div>
                      <div style={{height:240,padding:"10px 14px 14px"}}><canvas ref={barRef}/></div>
                    </div>
                    <div className="bi-panel">
                      <div className="bi-panel__hd"><div><h3>Ventas por vendedor</h3><p>Performance individual</p></div></div>
                      <div style={{height:200,padding:"10px 14px 8px"}}><canvas ref={vendRef}/></div>
                    </div>
                  </div>

                  {/* BOTTOM ROW */}
                  <div className="bi-row bi-row--33-33-33">
                    {/* Ranking */}
                    <div className="bi-panel">
                      <div className="bi-panel__hd">
                        <div><h3>Ranking de clientes</h3><p>Top clientes por volumen facturado</p></div>
                        <span className="bi-badge">{topClientes.length} clientes</span>
                      </div>
                      <div className="bi-ranking">
                        {topClientes.map(([cliente,total],i)=>{
                          const maxV=topClientes[0]?.[1]||1;
                          return(
                            <div key={cliente} className="bi-rank-row">
                              <span className="bi-rank-num" style={{color:i<3?PAL[i]:"#94a3b8"}}>#{i+1}</span>
                              <div className="bi-rank-mid">
                                <span className="bi-rank-name">{cliente}</span>
                                <div className="bi-rank-bar-bg"><div className="bi-rank-bar-fill" style={{width:`${pct(total,maxV)}%`,background:PAL[i%PAL.length]}}/></div>
                              </div>
                              <span className="bi-rank-val">{compact(total)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Alertas */}
                    <div className="bi-panel">
                      <div className="bi-panel__hd"><div><h3>Alertas inteligentes</h3></div></div>
                      <div className="bi-alertas">
                        {alertas.map((a,i)=>(
                          <div key={i} className={`bi-alerta bi-alerta--${a.type}`}>
                            <span className="bi-alerta__ico">{a.icon}</span>
                            <div className="bi-alerta__body"><strong>{a.title}</strong><p>{a.desc}</p></div>
                            <span className={`bi-alerta__val ${a.type}`}>{a.val}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Insights */}
                    <div className="bi-panel">
                      <div className="bi-panel__hd"><div><h3>Insights automáticos</h3><p>Análisis generado por el sistema</p></div></div>
                      <div className="bi-insights">
                        {insights.map((ins,i)=>(
                          <div key={i} className="bi-insight">
                            <span className="bi-insight__ico">{ins.icon}</span>
                            <p dangerouslySetInnerHTML={{__html:ins.text}}/>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Últimas importaciones */}
                  <div className="bi-panel">
                    <div className="bi-panel__hd">
                      <div><h3>Últimas importaciones</h3></div>
                      <button className="bi-link" onClick={()=>setTab("history")}>Ver historial →</button>
                    </div>
                    <div className="bi-tbl-wrap">
                      <table className="bi-tbl">
                        <thead><tr><th>Fecha</th><th>Archivo</th><th>Filas procesadas</th><th>Estado</th><th>Errores</th></tr></thead>
                        <tbody>
                          {imports.slice(0,4).map(imp=>(
                            <tr key={imp.id}>
                              <td>{new Date(imp.created_at).toLocaleDateString("es-AR")} {new Date(imp.created_at).toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"})}</td>
                              <td><strong>{imp.filename}</strong></td>
                              <td>{imp.rows_ok.toLocaleString("es-AR")} filas</td>
                              <td><span className={`bi-status ${imp.rows_error>0?"warn":"ok"}`}>{imp.rows_error>0?"Advertencias":"Exitoso"}</span></td>
                              <td className={imp.rows_error>0?"c-red":"c-green"}>{imp.rows_error}</td>
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

          {/* ══ IMPORTAR ══ */}
          {tab==="import"&&(
            <div className="bi-import">
              <div className="bi-stepper">
                {["Subir archivo","Mapear columnas","Validar","Completado"].map((label,i)=>(
                  <div key={i} className={`bi-step ${step>i+1?"done":step===i+1?"active":""}`}>
                    <div className="bi-step__n">{step>i+1?"✓":i+1}</div>
                    <span>{label}</span>
                    {i<3&&<div className="bi-step__line"/>}
                  </div>
                ))}
              </div>

              {step===1&&(
                <div className={`bi-drop ${dragOver?"over":""}`} onDrop={handleDrop} onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)}>
                  <div style={{fontSize:44,marginBottom:10}}>📂</div>
                  <h3>Arrastrá tu archivo Excel aquí</h3>
                  <p>O hacé click para seleccionar · .xlsx, .xls, .csv</p>
                  <label className="bi-btn bi-btn--primary">Seleccionar archivo<input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} style={{display:"none"}}/></label>
                  <p className="bi-drop__hint">Las columnas se detectan automáticamente.</p>
                </div>
              )}

              {step===2&&xlsxData&&(
                <div className="bi-panel" style={{padding:22}}>
                  <div className="bi-panel__hd"><div><h3>Mapear columnas</h3><p>Verificá el mapeo automático.</p></div><span className="bi-badge bi-badge--blue">{xlsxData.headers.length} columnas</span></div>
                  <div className="bi-map-grid">
                    {Object.keys(COL_MAP).map(field=>(
                      <div key={field} className={`bi-map-row ${mapping[field]?"mapped":""}`}>
                        <span className="bi-map-lbl">{field.replace(/_/g," ")}</span>
                        <select value={mapping[field]||""} onChange={e=>setMapping({...mapping,[field]:e.target.value||undefined})}>
                          <option value="">— No usar —</option>
                          {xlsxData.headers.map(h=><option key={h} value={h}>{h}</option>)}
                        </select>
                        {mapping[field]&&<span style={{color:"#10b981",fontWeight:800,fontSize:12}}>✓</span>}
                      </div>
                    ))}
                  </div>
                  <div style={{marginBottom:16}}><p style={{fontSize:10.5,fontWeight:700,textTransform:"uppercase",letterSpacing:.5,color:"#94a3b8",marginBottom:8}}>Previsualización — 5 primeras filas</p>
                    <div className="bi-tbl-wrap"><table className="bi-tbl"><thead><tr>{xlsxData.headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{xlsxData.rows.slice(0,5).map((r,i)=><tr key={i}>{xlsxData.headers.map(h=><td key={h}>{String(r[h]||"—")}</td>)}</tr>)}</tbody></table></div>
                  </div>
                  <div className="bi-actions"><button className="bi-btn bi-btn--ghost" onClick={()=>setStep(1)}>← Volver</button><button className="bi-btn bi-btn--primary" onClick={runValidation}>Validar →</button></div>
                </div>
              )}

              {step===3&&(
                <div className="bi-panel" style={{padding:22}}>
                  <div className="bi-panel__hd"><div><h3>Resultado de validación</h3></div><div style={{display:"flex",gap:8}}><span className="bi-badge bi-badge--green">✓ {okRows.length}</span>{errRows.length>0&&<span className="bi-badge bi-badge--red">✕ {errRows.length}</span>}</div></div>
                  <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
                    <div style={{flex:1,height:7,background:"#f1f5f9",borderRadius:999,overflow:"hidden"}}><div style={{width:`${pct(okRows.length,parsed.length)}%`,height:"100%",background:"#10b981",borderRadius:999}}/></div>
                    <span style={{fontSize:12,fontWeight:700,color:"#10b981"}}>{pct(okRows.length,parsed.length)}%</span>
                  </div>
                  {errRows.length>0&&<div style={{marginBottom:14}}><p style={{fontSize:10.5,fontWeight:700,textTransform:"uppercase",letterSpacing:.5,color:"#dc2626",marginBottom:8}}>Filas con errores</p>{errRows.slice(0,12).map((p,i)=><div key={i} style={{display:"flex",gap:10,padding:"7px 10px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:7,marginBottom:3,fontSize:12}}><span style={{fontWeight:800,color:"#dc2626",minWidth:28}}>F{parsed.indexOf(p)+2}</span><span style={{flex:1,fontWeight:600,color:"#0f172a"}}>{p.row.cliente||"—"}</span><span style={{color:"#dc2626",fontSize:11}}>{p.errors.join(" · ")}</span></div>)}{errRows.length>12&&<p style={{fontSize:11,color:"#94a3b8"}}>+{errRows.length-12} más</p>}</div>}
                  {importing&&<div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}><div style={{flex:1,height:7,background:"#f1f5f9",borderRadius:999,overflow:"hidden"}}><div style={{width:`${progress}%`,height:"100%",background:"linear-gradient(90deg,#6366f1,#3b82f6)",borderRadius:999,transition:"width .3s"}}/></div><span style={{fontSize:12,fontWeight:700,color:"#6366f1",minWidth:35}}>{progress}%</span></div>}
                  <div className="bi-actions"><button className="bi-btn bi-btn--ghost" onClick={()=>setStep(2)}>← Volver</button><button className="bi-btn bi-btn--primary" onClick={doImport} disabled={importing||okRows.length===0}>{importing?`Importando… ${progress}%`:`Importar ${okRows.length} registros →`}</button></div>
                </div>
              )}

              {step===4&&(
                <div style={{background:"#fff",border:"1px solid #e8ecf2",borderRadius:16,padding:"60px 40px",textAlign:"center"}}>
                  <div style={{width:64,height:64,borderRadius:"50%",background:"#ecfdf5",color:"#10b981",fontSize:28,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px",border:"2px solid #bbf7d0"}}>✓</div>
                  <h3 style={{margin:"0 0 8px",fontSize:20,fontWeight:800,color:"#0f172a"}}>¡Importación completada!</h3>
                  <p style={{margin:"0 0 22px",fontSize:13,color:"#64748b"}}>{okRows.length} registros importados{errRows.length>0?` · ${errRows.length} omitidos`:""}.</p>
                  <div style={{display:"flex",gap:10,justifyContent:"center"}}>
                    <button className="bi-btn bi-btn--primary" onClick={()=>{setTab("dashboard");setStep(1);setXlsxData(null);setParsed([]);}}>Ver Dashboard →</button>
                    <button className="bi-btn bi-btn--ghost" onClick={()=>{setStep(1);setXlsxData(null);setParsed([]);}}>Importar otro</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ══ HISTORIAL ══ */}
          {tab==="history"&&(
            <div className="bi-panel" style={{padding:22}}>
              <div className="bi-panel__hd"><div><h3>Historial de importaciones</h3><p>{imports.length} importaciones</p></div></div>
              <div className="bi-tbl-wrap">
                <table className="bi-tbl">
                  <thead><tr><th>Fecha</th><th>Archivo</th><th>Total</th><th>Válidas</th><th>Errores</th><th>Estado</th><th></th></tr></thead>
                  <tbody>
                    {imports.map(imp=>(
                      <tr key={imp.id}>
                        <td>{new Date(imp.created_at).toLocaleDateString("es-AR")} {new Date(imp.created_at).toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"})}</td>
                        <td><strong>{imp.filename}</strong></td>
                        <td>{imp.rows_total}</td>
                        <td className="c-green">{imp.rows_ok}</td>
                        <td className={imp.rows_error>0?"c-red":""}>{imp.rows_error}</td>
                        <td><span className={`bi-status ${imp.rows_error>0?"warn":"ok"}`}>{imp.rows_error>0?"Advertencias":"Exitoso"}</span></td>
                        <td><button className="bi-del" onClick={()=>deleteImport(imp.id)}>Eliminar</button></td>
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

function FilterGroup({label,value,onChange,children}){
  return(
    <div className="bi-fg">
      <label>{label}</label>
      <select value={value} onChange={e=>onChange(e.target.value)}>{children}</select>
    </div>
  );
}