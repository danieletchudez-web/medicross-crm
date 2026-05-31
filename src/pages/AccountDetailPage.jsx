import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BriefcaseBusiness,
  Building2,
  CalendarPlus,
  FileText,
  Handshake,
  ReceiptText,
  Timeline,
  Users,
} from "lucide-react";
import Layout from "../components/Layout";
import { EmptyState, ModuleHeader } from "../components/CRMUI";
import { supabase } from "../lib/supabaseClient";
import "./accountDetail.css";

const TABS = [
  ["summary","Resumen",Building2],
  ["timeline","Línea de tiempo",Timeline],
  ["visits","Visitas",Handshake],
  ["opportunities","Oportunidades",BriefcaseBusiness],
  ["tenders","Licitaciones",FileText],
  ["quotes","Cotizaciones",ReceiptText],
  ["sales","Facturación",ReceiptText],
];

function fmtDate(value) {
  return value ? new Date(value).toLocaleDateString("es-AR") : "—";
}

function money(value) {
  return new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:0}).format(Number(value||0));
}

function uniqueById(rows) {
  const map = new Map();
  rows.forEach(row=>row?.id&&map.set(row.id,row));
  return [...map.values()];
}

export default function AccountDetailPage({profile,onNavigate,navigationData}) {
  const accountId = navigationData?.accountId;
  const [account,setAccount] = useState(null);
  const [data,setData] = useState({visits:[],opportunities:[],tenders:[],quotes:[],sales:[]});
  const [active,setActive] = useState("summary");
  const [timelineFilter,setTimelineFilter] = useState("all");
  const [loading,setLoading] = useState(true);

  useEffect(()=>{ if(accountId) loadAccount(); },[accountId]);

  async function loadAccount() {
    setLoading(true);
    const {data:accountRow,error} = await supabase.from("accounts").select("*, profiles(full_name,email)").eq("id",accountId).maybeSingle();
    if (error || !accountRow) { setAccount(null); setLoading(false); return; }
    setAccount(accountRow);
    const name = String(accountRow.name||"").replace(/[%_,]/g," ").trim();
    const [visitsRes,oppsRes,tendersRes,linkedQuotesRes,namedQuotesRes,salesRes] = await Promise.all([
      supabase.from("visits").select("*, products(name,line)").eq("account_id",accountId).order("visit_date",{ascending:false}),
      supabase.from("opportunities").select("*, products(name,line)").eq("account_id",accountId).order("created_at",{ascending:false}),
      name ? supabase.from("tenders").select("*").ilike("institution",`%${name}%`).order("created_at",{ascending:false}) : Promise.resolve({data:[]}),
      supabase.from("cotizaciones").select("*").eq("account_id",accountId).order("created_at",{ascending:false}),
      name ? supabase.from("cotizaciones").select("*").ilike("institucion",`%${name}%`).order("created_at",{ascending:false}) : Promise.resolve({data:[]}),
      name ? supabase.from("sales").select("*").ilike("cliente",`%${name}%`).order("fecha",{ascending:false}) : Promise.resolve({data:[]}),
    ]);
    setData({
      visits:visitsRes.data||[],
      opportunities:oppsRes.data||[],
      tenders:tendersRes.data||[],
      quotes:uniqueById([...(linkedQuotesRes.data||[]),...(namedQuotesRes.data||[])]),
      sales:salesRes.data||[],
    });
    setLoading(false);
  }

  const events = useMemo(()=>{
    const rows = [
      ...data.visits.map(item=>({id:`visit-${item.id}`,type:"visits",date:item.visit_date,title:"Visita comercial",detail:item.result||item.next_action||item.objective||"Actividad registrada",page:"visits"})),
      ...data.opportunities.map(item=>({id:`opp-${item.id}`,type:"opportunities",date:item.created_at,title:item.name||"Oportunidad",detail:`${item.stage||"Sin etapa"} · ${money(item.amount)}`,page:"opportunities"})),
      ...data.tenders.map(item=>({id:`tender-${item.id}`,type:"tenders",date:item.created_at||item.end_date,title:item.process_name||item.process_number||"Licitación",detail:item.operational_status||"Proceso registrado",page:"tenders"})),
      ...data.quotes.map(item=>({id:`quote-${item.id}`,type:"quotes",date:item.created_at,title:`Cotización #${item.quote_num_formatted||"—"}`,detail:item.estado||"Cotización registrada",page:"cotizador"})),
      ...data.sales.map((item,index)=>({id:`sale-${index}`,type:"sales",date:item.fecha,title:"Venta registrada",detail:`${item.producto||item.descripcion||"Comprobante BI"} · ${money(item.total_venta)}`,page:"importer"})),
    ];
    return rows.sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));
  },[data]);
  const filteredEvents = timelineFilter==="all" ? events : events.filter(event=>event.type===timelineFilter);

  if (loading) return <Layout title="Vista 360°" profile={profile} onNavigate={onNavigate}><div className="account360-loading">Preparando ficha del cliente...</div></Layout>;
  if (!account) return <Layout title="Vista 360°" profile={profile} onNavigate={onNavigate}><EmptyState title="Cliente no encontrado" text="Volvé al listado y seleccioná una cuenta válida." action={<button className="account360-btn" onClick={()=>onNavigate("accounts")}>Volver a clientes</button>}/></Layout>;

  return (
    <Layout title="Vista 360° del Cliente" profile={profile} onNavigate={onNavigate}>
      <div className="account360-page">
        <ModuleHeader
          title={account.name}
          subtitle={`${account.type||"Cuenta"} · ${[account.city,account.province].filter(Boolean).join(" · ")||"Ubicación sin completar"}`}
          actions={<button className="account360-btn account360-btn--ghost" onClick={()=>onNavigate("accounts")}><ArrowLeft size={15}/> Volver</button>}
        />

        <section className="account360-hero">
          <div>
            <span>Hub comercial del cliente</span>
            <h2>{account.name}</h2>
            <p>{account.address||"Dirección pendiente"}{account.phone?` · ${account.phone}`:""}</p>
          </div>
          <div className="account360-actions">
            <button className="account360-btn" onClick={()=>onNavigate("visits",{action:"create",accountId:account.id})}><CalendarPlus size={15}/> Nueva visita</button>
            <button className="account360-btn account360-btn--light" onClick={()=>onNavigate("opportunities",{action:"create",accountId:account.id})}>+ Oportunidad</button>
          </div>
        </section>

        <section className="account360-kpis">
          <article className="account360-kpi"><span>Potencial</span><strong>{account.potential||"—"}</strong></article>
          <article className="account360-kpi"><span>Seguimiento</span><strong><span className={`account360-badge account360-badge--${account.follow_status||"verde"}`}>{account.follow_status||"verde"}</span></strong></article>
          <article className="account360-kpi"><span>Visitas</span><strong>{data.visits.length}</strong></article>
          <article className="account360-kpi"><span>Oportunidades</span><strong>{data.opportunities.length}</strong></article>
          <article className="account360-kpi"><span>Licitaciones</span><strong>{data.tenders.length}</strong></article>
          <article className="account360-kpi"><span>Facturación BI</span><strong>{money(data.sales.reduce((sum,row)=>sum+Number(row.total_venta||0),0))}</strong></article>
        </section>

        <nav className="account360-tabs" aria-label="Secciones del cliente">
          {TABS.map(([id,label,Icon])=><button key={id} className={`account360-tab${active===id?" is-active":""}`} onClick={()=>setActive(id)}><Icon size={15}/>{label}</button>)}
        </nav>

        {active==="summary"&&<Summary account={account}/>}
        {active==="timeline"&&<TimelinePanel events={filteredEvents} filter={timelineFilter} onFilter={setTimelineFilter} onNavigate={onNavigate}/>}
        {active==="visits"&&<RecordList rows={data.visits} empty="Todavía no hay visitas para este cliente." render={item=><><strong>{fmtDate(item.visit_date)} · {item.products?.name||"Sin producto"}</strong><p>{item.result||item.next_action||"Sin resultado cargado"}</p></>}/>}
        {active==="opportunities"&&<RecordList rows={data.opportunities} empty="Todavía no hay oportunidades vinculadas." render={item=><><strong>{item.name||"Oportunidad"} · {item.stage||"Sin etapa"}</strong><p>{money(item.amount)} · {item.next_action||"Sin próxima acción"}</p></>}/>}
        {active==="tenders"&&<RecordList rows={data.tenders} empty="No se encontraron licitaciones para esta institución." render={item=><><strong>{item.process_number||"Sin número"} · {item.process_name||"Proceso"}</strong><p>{item.operational_status||"Sin estado"} · cierre {fmtDate(item.end_date)}</p></>}/>}
        {active==="quotes"&&<RecordList rows={data.quotes} empty="No se encontraron cotizaciones vinculadas." render={item=><><strong>#{item.quote_num_formatted||"—"} · {item.estado||"Sin estado"}</strong><p>{fmtDate(item.created_at)} · {money(item.total_general)}</p></>}/>}
        {active==="sales"&&<RecordList rows={data.sales} empty="No se encontraron ventas BI para este cliente." render={item=><><strong>{fmtDate(item.fecha)} · {item.producto||item.descripcion||"Venta"}</strong><p>{money(item.total_venta)}</p></>}/>}
      </div>
    </Layout>
  );
}

function Summary({account}) {
  const contacts = Array.isArray(account.contacts)?account.contacts:[];
  return <section className="account360-grid">
    <article className="account360-panel"><h3>Datos de la cuenta</h3><p>{account.email||"Email pendiente"}</p><p>{account.website||"Sitio web pendiente"}</p><p>{account.address||"Dirección pendiente"}</p></article>
    <article className="account360-panel"><h3><Users size={16}/> Contactos registrados</h3>{contacts.length?contacts.map((contact,index)=><div className="account360-contact" key={`${contact.email||contact.name}-${index}`}><strong>{contact.name||"Sin nombre"}</strong><span>{contact.role||contact.area||"Sin cargo"}{contact.email?` · ${contact.email}`:""}</span></div>):<p>Sin contactos cargados.</p>}</article>
  </section>;
}

function TimelinePanel({events,filter,onFilter,onNavigate}) {
  return <section className="account360-panel">
    <header className="account360-panel-head"><h3>Línea de tiempo comercial</h3><select className="account360-filter" value={filter} onChange={event=>onFilter(event.target.value)}><option value="all">Todos los eventos</option>{TABS.slice(2).map(([id,label])=><option value={id} key={id}>{label}</option>)}</select></header>
    {events.length?events.map(event=><button className="account360-event" key={event.id} onClick={()=>onNavigate(event.page)}><span>{fmtDate(event.date)}</span><strong>{event.title}</strong><p>{event.detail}</p></button>):<EmptyState title="Sin actividad vinculada" text="Los eventos comerciales aparecerán en orden cronológico."/>}
  </section>;
}

function RecordList({rows,empty,render}) {
  return <section className="account360-panel account360-records">{rows.length?rows.map((item,index)=><article className="account360-record" key={item.id||index}>{render(item)}</article>):<EmptyState title="Sin registros" text={empty}/>}</section>;
}
