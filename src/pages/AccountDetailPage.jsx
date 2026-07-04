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
  if (!account) return <Layout title="Vista 360°" profile={profile} onNavigate={onNavigate}><EmptyState title="Cliente no encontrado" text="Volvé al listado y seleccioná una cuenta válida." action={<button className="p-btn p-btn--ghost" onClick={()=>onNavigate("accounts")}>Volver a clientes</button>}/></Layout>;

  return (
    <Layout title="Vista 360° del Cliente" profile={profile} onNavigate={onNavigate}>
      <div className="p-page">

        {/* Top panel: account header + metrics */}
        <div className="p-panel">
          <div className="p-hd">
            <div className="p-hd-left">
              <span className="p-title">{account.name}</span>
              <span className="p-sub">{account.type||"Cuenta"} · {[account.city,account.province].filter(Boolean).join(" · ")||"Ubicación sin completar"}</span>
            </div>
            <div className="p-hd-right">
              <button className="p-btn p-btn--ghost" onClick={()=>onNavigate("accounts")}><ArrowLeft size={15}/> Volver</button>
              <button className="p-btn p-btn--primary" onClick={()=>onNavigate("visits",{action:"create",accountId:account.id})}><CalendarPlus size={15}/> Nueva visita</button>
              <button className="p-btn p-btn--ghost" onClick={()=>onNavigate("opportunities",{action:"create",accountId:account.id})}>+ Oportunidad</button>
            </div>
          </div>

          <div className="p-metrics">
            <div className="p-metric">
              <span className="p-metric__ey">Potencial</span>
              <span className="p-metric__val">{account.potential||"—"}</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Seguimiento</span>
              <span className="p-metric__val">
                <span className={`p-badge--${account.follow_status==="rojo"?"red":account.follow_status==="amarillo"?"amber":"green"}`}>{account.follow_status||"verde"}</span>
              </span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Visitas</span>
              <span className="p-metric__val">{data.visits.length}</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Oportunidades</span>
              <span className="p-metric__val">{data.opportunities.length}</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Licitaciones</span>
              <span className="p-metric__val">{data.tenders.length}</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Facturación BI</span>
              <span className="p-metric__val">{money(data.sales.reduce((sum,row)=>sum+Number(row.total_venta||0),0))}</span>
            </div>
          </div>
        </div>

        {/* Tabs nav */}
        <nav className="p-tabs" aria-label="Secciones del cliente">
          {TABS.map(([id,label,Icon])=>(
            <button key={id} className={`p-tab${active===id?" p-tab--active":""}`} onClick={()=>setActive(id)}>
              <Icon size={15}/> {label}
            </button>
          ))}
        </nav>

        {/* Tab content panels */}
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
  return (
    <div className="p-cols p-cols--2">
      <div className="p-panel">
        <div className="p-hd">
          <div className="p-hd-left">
            <span className="p-title">Datos de la cuenta</span>
          </div>
        </div>
        <div className="p-body">
          <div className="p-list">
            <div className="p-row"><span className="p-row__main"><span className="p-row__name">{account.email||"Email pendiente"}</span></span></div>
            <div className="p-row"><span className="p-row__main"><span className="p-row__name">{account.website||"Sitio web pendiente"}</span></span></div>
            <div className="p-row"><span className="p-row__main"><span className="p-row__name">{account.address||"Dirección pendiente"}</span></span></div>
          </div>
        </div>
      </div>
      <div className="p-panel">
        <div className="p-hd">
          <div className="p-hd-left">
            <span className="p-title"><Users size={14}/> Contactos registrados</span>
          </div>
        </div>
        <div className="p-body">
          {contacts.length ? (
            <div className="p-list">
              {contacts.map((contact,index)=>(
                <div className="p-row" key={`${contact.email||contact.name}-${index}`}>
                  <div className="p-row__main">
                    <span className="p-row__name">{contact.name||"Sin nombre"}</span>
                    <span className="p-row__sub">{contact.role||contact.area||"Sin cargo"}{contact.email?` · ${contact.email}`:""}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="p-empty">Sin contactos cargados.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function TimelinePanel({events,filter,onFilter,onNavigate}) {
  return (
    <div className="p-panel">
      <div className="p-hd">
        <div className="p-hd-left">
          <span className="p-title">Línea de tiempo comercial</span>
        </div>
        <div className="p-hd-right">
          <select className="p-select" value={filter} onChange={event=>onFilter(event.target.value)}>
            <option value="all">Todos los eventos</option>
            {TABS.slice(2).map(([id,label])=><option value={id} key={id}>{label}</option>)}
          </select>
        </div>
      </div>
      <div className="p-body">
        {events.length ? (
          <div className="p-list">
            {events.map(event=>(
              <button className="p-row" key={event.id} onClick={()=>onNavigate(event.page)} style={{width:"100%",textAlign:"left",background:"none",border:"none",cursor:"pointer"}}>
                <div className="p-row__main">
                  <span className="p-row__sub">{fmtDate(event.date)}</span>
                  <span className="p-row__name">{event.title}</span>
                  <span className="p-row__sub">{event.detail}</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState title="Sin actividad vinculada" text="Los eventos comerciales aparecerán en orden cronológico."/>
        )}
      </div>
    </div>
  );
}

function RecordList({rows,empty,render}) {
  return (
    <div className="p-panel">
      <div className="p-body">
        {rows.length ? (
          <div className="p-list">
            {rows.map((item,index)=>(
              <div className="p-row" key={item.id||index}>
                <div className="p-row__main">
                  {render(item)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="Sin registros" text={empty}/>
        )}
      </div>
    </div>
  );
}
