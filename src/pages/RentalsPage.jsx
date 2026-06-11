import { useEffect, useMemo, useState } from "react";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";
import "./rentals.css";

// ─── Constants ────────────────────────────────────────────────────────────────
const TECHNOLOGIES = ["Farapulse", "EchoLaser", "Ecógrafo", "Fusión de imágenes", "Otro"];
const TECH_PREFIX  = { "Farapulse":"FAR","EchoLaser":"ELA","Ecógrafo":"ECO","Fusión de imágenes":"FUS","Otro":"GEN" };
const TECH_COLOR   = { "Farapulse":"#ef4444","EchoLaser":"#6366f1","Ecógrafo":"#0891b2","Fusión de imágenes":"#7c3aed","Otro":"#64748b" };

const STATUS_META = {
  solicitud_recibida:         { label:"Solicitud recibida",   color:"#6366f1", bg:"#eef2ff" },
  en_revision_comercial:      { label:"En revisión",          color:"#8b5cf6", bg:"#f5f3ff" },
  verificando_disponibilidad: { label:"Verificando disp.",    color:"#f59e0b", bg:"#fffbeb" },
  cotizacion_enviada:         { label:"Cotización enviada",   color:"#3b82f6", bg:"#eff6ff" },
  pendiente_confirmacion:     { label:"Pend. confirmación",   color:"#f97316", bg:"#fff7ed" },
  confirmado:                 { label:"Confirmado",           color:"#10b981", bg:"#ecfdf5" },
  programado_calendario:      { label:"Programado",           color:"#059669", bg:"#d1fae5" },
  equipo_preparado:           { label:"Equipo preparado",     color:"#0891b2", bg:"#ecfeff" },
  equipo_entregado:           { label:"Entregado",            color:"#0284c7", bg:"#eff6ff" },
  procedimiento_realizado:    { label:"Realizado",            color:"#16a34a", bg:"#dcfce7" },
  equipo_retirado:            { label:"Retirado",             color:"#15803d", bg:"#f0fdf4" },
  pendiente_facturacion:      { label:"Pend. facturación",    color:"#dc2626", bg:"#fef2f2" },
  facturado:                  { label:"Facturado",            color:"#2563eb", bg:"#eff6ff" },
  cerrado:                    { label:"Cerrado",              color:"#64748b", bg:"#f8fafc" },
  cancelado:                  { label:"Cancelado",            color:"#94a3b8", bg:"#f1f5f9" },
  // Legacy compat
  solicitud:       { label:"Solicitud",       color:"#6366f1", bg:"#eef2ff" },
  cotizacion:      { label:"Cotización",      color:"#3b82f6", bg:"#eff6ff" },
  aprobado:        { label:"Aprobado",        color:"#10b981", bg:"#ecfdf5" },
  reservado:       { label:"Reservado",       color:"#059669", bg:"#d1fae5" },
  entregado:       { label:"Entregado",       color:"#0284c7", bg:"#eff6ff" },
  en_procedimiento:{ label:"En procedimiento",color:"#16a34a", bg:"#dcfce7" },
  retirado:        { label:"Retirado",        color:"#15803d", bg:"#f0fdf4" },
};

const WORKFLOW = [
  "solicitud_recibida","en_revision_comercial","verificando_disponibilidad",
  "cotizacion_enviada","pendiente_confirmacion","confirmado","programado_calendario",
  "equipo_preparado","equipo_entregado","procedimiento_realizado","equipo_retirado",
  "pendiente_facturacion","facturado","cerrado",
];

const NEXT_STATUS = {
  solicitud_recibida:         { to:"en_revision_comercial",      btn:"Revisar solicitud" },
  en_revision_comercial:      { to:"verificando_disponibilidad", btn:"Validar disponibilidad" },
  verificando_disponibilidad: { to:"cotizacion_enviada",         btn:"Enviar cotización" },
  cotizacion_enviada:         { to:"pendiente_confirmacion",     btn:"Pend. de confirmación" },
  pendiente_confirmacion:     { to:"confirmado",                 btn:"Confirmar caso" },
  confirmado:                 { to:"programado_calendario",      btn:"Programar en calendario" },
  programado_calendario:      { to:"equipo_preparado",           btn:"Equipo preparado" },
  equipo_preparado:           { to:"equipo_entregado",           btn:"Confirmar entrega" },
  equipo_entregado:           { to:"procedimiento_realizado",    btn:"Confirmar procedimiento" },
  procedimiento_realizado:    { to:"equipo_retirado",            btn:"Confirmar retiro" },
  equipo_retirado:            { to:"pendiente_facturacion",      btn:"Ir a facturación" },
  pendiente_facturacion:      { to:"facturado",                  btn:"Registrar factura", needsInvoice:true },
  facturado:                  { to:"cerrado",                    btn:"Cerrar caso" },
  // Legacy
  solicitud:        { to:"cotizacion",        btn:"Avanzar" },
  cotizacion:       { to:"aprobado",          btn:"Avanzar" },
  aprobado:         { to:"reservado",         btn:"Avanzar" },
  reservado:        { to:"entregado",         btn:"Avanzar" },
  entregado:        { to:"en_procedimiento",  btn:"Avanzar" },
  en_procedimiento: { to:"retirado",          btn:"Avanzar" },
  retirado:         { to:"facturado",         btn:"Avanzar" },
};

const CHECKLIST_ITEMS = [
  { key:"quote_associated",         label:"Cotización asociada"             },
  { key:"quote_approved",           label:"Cotización aprobada"             },
  { key:"equipment_assigned",       label:"Equipo asignado"                 },
  { key:"consumables_assigned",     label:"Consumibles asignados"           },
  { key:"specialist_assigned",      label:"Especialista clínico asignado"   },
  { key:"instrumentadora_assigned", label:"Instrumentadora asignada"        },
  { key:"delivery_logistics",       label:"Logística de entrega programada" },
  { key:"retrieval_logistics",      label:"Logística de retiro programada"  },
  { key:"calendar_blocked",         label:"Calendario bloqueado"            },
  { key:"equipment_prepared",       label:"Equipo preparado y verificado"   },
  { key:"equipment_delivered",      label:"Equipo entregado"                },
  { key:"procedure_done",           label:"Procedimiento realizado"         },
  { key:"equipment_retrieved",      label:"Equipo retirado"                 },
  { key:"billing_done",             label:"Facturación realizada"           },
  { key:"case_closed",              label:"Caso cerrado"                    },
];

const EMPTY_FORM = {
  id:null, case_number:"", technology:"EchoLaser", status:"solicitud_recibida",
  account_id:"", opportunity_id:"",
  doctor_name:"", institution:"", procedure_room:"", procedure_city:"",
  procedure_name:"",
  delivery_date:"", procedure_date:"", procedure_time:"", retrieval_date:"",
  equipment_id:"",
  requires_consumables:false, requires_clinical_specialist:false,
  requires_instrumentadora:false, requires_ecographer:false,
  requires_image_fusion:false, requires_logistics:false,
  assigned_specialist:"",
  base_amount:"", consumables_amount:"", logistics_amount:"",
  instrumentation_amount:"", other_amount:"", cost_amount:"",
  quoted_amount:"", approved_amount:"", invoiced_amount:"",
  invoice_number:"", is_billable:true,
  ela_procedure_type:"", ela_estimated_fibers:"", ela_used_fibers:"",
  ela_requires_ecographer:false, ela_requires_fusion:false,
  ela_operator_doctor:"", ela_clinical_specialist:"",
  far_electrophysiologist:"", far_procedure_type:"", far_consumables_detail:"",
  far_clinical_specialist:"", far_room:"", far_estimated_duration:"",
  notes:"", internal_notes:"", cancellation_reason:"",
  checklist:{}, owner_id:"",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function money(v) {
  return new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:0}).format(Number(v||0));
}
function compactMoney(v) {
  const n=Number(v||0);
  if (n>=1_000_000) return `$${(n/1_000_000).toFixed(1).replace(".",",")} M`;
  if (n>=1_000) return `$${(n/1_000).toFixed(0)} K`;
  return money(n);
}
function fDate(v) {
  if (!v) return "—";
  const [y,m,d]=String(v).slice(0,10).split("-");
  return `${d}/${m}/${y}`;
}
function fDateTime(v) {
  if (!v) return "—";
  return new Date(v).toLocaleString("es-AR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
}
function totalAmount(f) {
  return ["base_amount","consumables_amount","logistics_amount","instrumentation_amount","other_amount"]
    .reduce((s,k)=>s+Number(f[k]||0),0);
}
function marginPct(f) {
  const total=totalAmount(f), cost=Number(f.cost_amount||0);
  if (!total||!cost) return 0;
  return Math.round(((total-cost)/total)*100);
}
function getMarginClass(pct) {
  return pct>=45?"":pct>=30?"ren-margin-preview__fill--warn":"ren-margin-preview__fill--bad";
}
function sMeta(status) {
  return STATUS_META[status]||{label:status||"—",color:"#64748b",bg:"#f8fafc"};
}
function checklistPct(checklist) {
  if (!checklist) return 0;
  const done=CHECKLIST_ITEMS.filter(i=>checklist[i.key]?.checked).length;
  return Math.round((done/CHECKLIST_ITEMS.length)*100);
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function RentalsPage({ profile, onNavigate, navigationData, pageKey }) {
  const [rentals,    setRentals]    = useState([]);
  const [equipment,  setEquipment]  = useState([]);
  const [accounts,   setAccounts]   = useState([]);
  const [opps,       setOpps]       = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [toast,      setToast]      = useState(null);

  // Form
  const [showForm,   setShowForm]   = useState(false);
  const [form,       setForm]       = useState(EMPTY_FORM);

  // Detail 360°
  const [selected,      setSelected]      = useState(null);
  const [detailTab,     setDetailTab]     = useState("general");
  const [caseEvents,    setCaseEvents]    = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  // Advance modal
  const [showAdvance,    setShowAdvance]    = useState(null);
  const [advanceComment, setAdvanceComment] = useState("");
  const [advanceInvoice, setAdvanceInvoice] = useState("");
  const [advanceSaving,  setAdvanceSaving]  = useState(false);

  // Filters / view
  const [view,            setView]            = useState("tabla");
  const [searchText,      setSearchText]      = useState("");
  const [filterStatus,    setFilterStatus]    = useState("todos");
  const [filterTech,      setFilterTech]      = useState("todos");
  const [filterEquipment, setFilterEquipment] = useState("todos");
  const [ganttOffset,     setGanttOffset]     = useState(0);

  useEffect(()=>{ loadData(); },[]);

  useEffect(()=>{
    if (navigationData?.action==="create") {
      setForm({...EMPTY_FORM, account_id:navigationData.accountId||"", opportunity_id:navigationData.opportunityId||"", equipment_id:navigationData.equipmentId||""});
      setShowForm(true);
    }
    if (navigationData?.equipmentId && !navigationData?.action) setFilterEquipment(navigationData.equipmentId);
  },[navigationData]);

  async function loadData() {
    setLoading(true);
    const [renRes,eqRes,accRes,oppRes] = await Promise.all([
      supabase.from("equipment_rentals").select("*, equipment(name,brand,category,status), accounts(name)").order("created_at",{ascending:false}),
      supabase.from("equipment").select("id,name,brand,category,status").order("name"),
      supabase.from("accounts").select("id,name").order("name"),
      supabase.from("opportunities").select("id,name,account_id").order("name"),
    ]);
    setRentals(renRes.data||[]);
    setEquipment(eqRes.data||[]);
    setAccounts(accRes.data||[]);
    setOpps(oppRes.data||[]);
    setLoading(false);
  }

  async function loadCaseEvents(caseId) {
    setLoadingEvents(true);
    const {data} = await supabase.from("rental_case_events").select("*").eq("case_id",caseId).order("changed_at",{ascending:false});
    setCaseEvents(data||[]);
    setLoadingEvents(false);
  }

  function showToast(msg,type="ok") {
    setToast({msg,type});
    setTimeout(()=>setToast(null),3200);
  }

  function generateCaseNumber(technology) {
    const prefix=TECH_PREFIX[technology]||"GEN";
    const year=new Date().getFullYear();
    const existing=rentals.filter(r=>r.case_number&&r.case_number.startsWith(`${prefix}-${year}`)).length;
    return `${prefix}-${year}-${String(existing+1).padStart(3,"0")}`;
  }

  async function handleSave() {
    if (!form.equipment_id||!form.procedure_date) {
      showToast("Equipo y fecha de procedimiento son obligatorios","err");
      return;
    }
    setSaving(true);
    const total=totalAmount(form), margin=marginPct(form);
    const caseNumber=form.id?form.case_number:generateCaseNumber(form.technology);
    const payload={
      case_number:caseNumber, technology:form.technology,
      equipment_id:form.equipment_id,
      account_id:form.account_id||null, opportunity_id:form.opportunity_id||null,
      doctor_name:form.doctor_name, institution:form.institution,
      procedure_room:form.procedure_room, procedure_city:form.procedure_city,
      procedure_name:form.procedure_name, status:form.status,
      delivery_date:form.delivery_date||null, procedure_date:form.procedure_date||null,
      procedure_time:form.procedure_time||null, retrieval_date:form.retrieval_date||null,
      requires_consumables:form.requires_consumables,
      requires_clinical_specialist:form.requires_clinical_specialist,
      requires_instrumentadora:form.requires_instrumentadora,
      requires_ecographer:form.requires_ecographer,
      requires_image_fusion:form.requires_image_fusion,
      requires_logistics:form.requires_logistics,
      assigned_specialist:form.assigned_specialist,
      base_amount:Number(form.base_amount||0), consumables_amount:Number(form.consumables_amount||0),
      logistics_amount:Number(form.logistics_amount||0), instrumentation_amount:Number(form.instrumentation_amount||0),
      other_amount:Number(form.other_amount||0), total_amount:total,
      cost_amount:Number(form.cost_amount||0), profit_margin:margin,
      quoted_amount:Number(form.quoted_amount||0), approved_amount:Number(form.approved_amount||0),
      invoiced_amount:Number(form.invoiced_amount||0), invoice_number:form.invoice_number||null,
      is_billable:form.is_billable,
      ela_procedure_type:form.ela_procedure_type||null, ela_estimated_fibers:form.ela_estimated_fibers?Number(form.ela_estimated_fibers):null,
      ela_used_fibers:form.ela_used_fibers?Number(form.ela_used_fibers):null,
      ela_requires_ecographer:form.ela_requires_ecographer, ela_requires_fusion:form.ela_requires_fusion,
      ela_operator_doctor:form.ela_operator_doctor||null, ela_clinical_specialist:form.ela_clinical_specialist||null,
      far_electrophysiologist:form.far_electrophysiologist||null, far_procedure_type:form.far_procedure_type||null,
      far_consumables_detail:form.far_consumables_detail||null, far_clinical_specialist:form.far_clinical_specialist||null,
      far_room:form.far_room||null, far_estimated_duration:form.far_estimated_duration||null,
      notes:form.notes, internal_notes:form.internal_notes,
      seller_id:profile?.id||null, owner_id:form.owner_id||profile?.id||null,
      updated_at:new Date().toISOString(),
    };
    if (form.id) {
      await supabase.from("equipment_rentals").update(payload).eq("id",form.id);
      showToast("Caso actualizado");
    } else {
      payload.rental_number=caseNumber;
      payload.request_date=new Date().toISOString().slice(0,10);
      payload.created_at=new Date().toISOString();
      payload.checklist={};
      const {data:inserted}=await supabase.from("equipment_rentals").insert(payload).select().single();
      if (inserted) {
        await supabase.from("rental_case_events").insert({case_id:inserted.id,from_status:null,to_status:payload.status,changed_by:profile?.id||null,comment:"Caso creado"}).catch(()=>{});
      }
      showToast("Caso creado: "+caseNumber);
    }
    setSaving(false);
    setShowForm(false);
    loadData();
  }

  function openAdvance(cas) {
    const next=NEXT_STATUS[cas.status];
    if (!next) return;
    setShowAdvance({...next,caseId:cas.id,fromStatus:cas.status,cas});
    setAdvanceComment(""); setAdvanceInvoice(cas.invoice_number||"");
  }

  async function confirmAdvance() {
    if (!showAdvance) return;
    setAdvanceSaving(true);
    const {caseId,to,fromStatus,needsInvoice,cas}=showAdvance;
    const upd={status:to,status_changed_at:new Date().toISOString(),status_changed_by:profile?.id||null,updated_at:new Date().toISOString()};
    if (needsInvoice&&advanceInvoice) upd.invoice_number=advanceInvoice;
    await supabase.from("equipment_rentals").update(upd).eq("id",caseId);
    await supabase.from("rental_case_events").insert({case_id:caseId,from_status:fromStatus,to_status:to,changed_by:profile?.id||null,comment:advanceComment||null}).catch(()=>{});

    // Side effects
    if (to==="programado_calendario"&&cas.procedure_date) await createCalendarEvents(cas);
    if (to==="equipo_entregado") await supabase.from("equipment").update({status:"reservado"}).eq("id",cas.equipment_id);
    if (to==="procedimiento_realizado") await supabase.from("equipment").update({status:"en_cirugia"}).eq("id",cas.equipment_id);
    if (to==="equipo_retirado") await supabase.from("equipment").update({status:"disponible",next_available_date:null}).eq("id",cas.equipment_id);

    showToast(`Estado → ${sMeta(to).label}`);
    setShowAdvance(null);
    if (selected?.id===caseId) {
      setSelected(prev=>({...prev,status:to,...(upd.invoice_number?{invoice_number:upd.invoice_number}:{})}));
      loadCaseEvents(caseId);
    }
    loadData();
    setAdvanceSaving(false);
  }

  async function createCalendarEvents(rental) {
    const addDays=(dateStr,n)=>{const d=new Date(dateStr+"T00:00:00");d.setDate(d.getDate()+n);return d.toISOString().slice(0,10);};
    const caseNum=rental.case_number||rental.rental_number||"";
    const eqName=rental.equipment?.name||"Equipo";
    const events=[];
    if (rental.procedure_date) {
      events.push({rental_id:rental.id,equipment_id:rental.equipment_id,event_type:"preparacion",event_date:addDays(rental.procedure_date,-2),title:`Preparación — ${caseNum}`,description:`${eqName} · ${rental.institution||""}`,color:"#0891b2"});
      events.push({rental_id:rental.id,equipment_id:rental.equipment_id,event_type:"procedimiento",event_date:rental.procedure_date,title:`Procedimiento — ${rental.doctor_name||caseNum}`,description:`${rental.procedure_name||""} · ${rental.institution||""}`,color:"#059669"});
      events.push({rental_id:rental.id,equipment_id:rental.equipment_id,event_type:"retiro",event_date:addDays(rental.procedure_date,1),title:`Retiro — ${caseNum}`,description:rental.institution||"",color:"#f97316"});
    }
    if (rental.delivery_date) {
      events.push({rental_id:rental.id,equipment_id:rental.equipment_id,event_type:"entrega",event_date:rental.delivery_date,title:`Entrega — ${caseNum}`,description:`${eqName} → ${rental.institution||""}`,color:"#10b981"});
    }
    if (events.length) await supabase.from("equipment_calendar_events").insert(events).catch(()=>{});
  }

  async function handleCancel(cas) {
    const reason=window.prompt("Motivo de cancelación (obligatorio):");
    if (!reason||!reason.trim()) return;
    await supabase.from("equipment_rentals").update({status:"cancelado",cancellation_reason:reason,updated_at:new Date().toISOString()}).eq("id",cas.id);
    await supabase.from("rental_case_events").insert({case_id:cas.id,from_status:cas.status,to_status:"cancelado",changed_by:profile?.id||null,comment:`Cancelado: ${reason}`}).catch(()=>{});
    showToast("Caso cancelado");
    setSelected(null);
    loadData();
  }

  async function toggleChecklist(key) {
    if (!selected) return;
    const current=selected.checklist||{};
    const wasChecked=current[key]?.checked||false;
    const updated={...current,[key]:{checked:!wasChecked,checked_by:profile?.full_name||"—",checked_at:new Date().toISOString()}};
    setSelected(prev=>({...prev,checklist:updated}));
    await supabase.from("equipment_rentals").update({checklist:updated}).eq("id",selected.id);
  }

  function openCreate() { setForm(EMPTY_FORM); setShowForm(true); }
  function openEdit(cas) {
    setForm({...EMPTY_FORM,...cas,
      base_amount:cas.base_amount||"",consumables_amount:cas.consumables_amount||"",
      logistics_amount:cas.logistics_amount||"",instrumentation_amount:cas.instrumentation_amount||"",
      other_amount:cas.other_amount||"",cost_amount:cas.cost_amount||"",
    });
    setShowForm(true);
  }

  function hasDateConflict(equipmentId,procedureDate,excludeId=null) {
    if (!procedureDate||!equipmentId) return false;
    return rentals.some(r=>{
      if (r.equipment_id!==equipmentId) return false;
      if (r.id===excludeId) return false;
      if (["cerrado","cancelado"].includes(r.status)) return false;
      const from=r.delivery_date||r.procedure_date, to=r.retrieval_date||r.procedure_date;
      if (!from||!to) return false;
      return procedureDate>=from&&procedureDate<=to;
    });
  }
  function equipmentAvailability(eq) {
    if (["fuera_de_servicio","en_mantenimiento"].includes(eq.status)) return {disabled:true,label:`(${eq.status.replace("_"," ")})`,tag:"blocked"};
    const conflict=hasDateConflict(eq.id,form.procedure_date,form.id);
    return conflict?{disabled:false,label:"⚠ Conflicto de fecha",tag:"conflict"}:{disabled:false,label:"✓ Disponible",tag:"ok"};
  }

  // ─── Derived ──────────────────────────────────────────────────────────────
  const filtered = useMemo(()=>{
    const q=searchText.toLowerCase();
    return rentals.filter(r=>{
      if (filterStatus!=="todos"&&r.status!==filterStatus) return false;
      if (filterTech!=="todos"&&r.technology!==filterTech) return false;
      if (filterEquipment!=="todos"&&r.equipment_id!==filterEquipment) return false;
      if (q&&!`${r.case_number} ${r.rental_number} ${r.doctor_name} ${r.institution} ${r.procedure_name} ${r.equipment?.name} ${r.accounts?.name} ${r.technology}`.toLowerCase().includes(q)) return false;
      return true;
    });
  },[rentals,filterStatus,filterTech,filterEquipment,searchText]);

  const kpis = useMemo(()=>{
    const active=rentals.filter(r=>!["cerrado","cancelado"].includes(r.status));
    const confirmed=rentals.filter(r=>["confirmado","programado_calendario"].includes(r.status));
    const pendingBill=rentals.filter(r=>r.status==="pendiente_facturacion");
    const billed=rentals.filter(r=>["facturado","cerrado"].includes(r.status));
    const totalBilled=billed.reduce((s,r)=>s+Number(r.total_amount||0),0);
    const avgMargin=active.length?Math.round(active.reduce((s,r)=>s+Number(r.profit_margin||0),0)/active.length):0;
    const today=new Date().toISOString().slice(0,10);
    const todayEvents=rentals.filter(r=>r.delivery_date===today||r.procedure_date===today||r.retrieval_date===today).length;
    return {active:active.length,confirmed:confirmed.length,pendingBill:pendingBill.length,totalBilled,avgMargin,todayEvents,total:rentals.length};
  },[rentals]);

  const ganttDays = useMemo(()=>{
    const days=[];
    const base=new Date(); base.setDate(base.getDate()-ganttOffset);
    for (let i=0;i<14;i++){const d=new Date(base);d.setDate(d.getDate()+i);days.push(d.toISOString().slice(0,10));}
    return days;
  },[ganttOffset]);

  const ganttEquipment = useMemo(()=>
    equipment.map(eq=>({...eq,blocks:rentals.filter(r=>r.equipment_id===eq.id&&!["cerrado","cancelado"].includes(r.status)&&(r.delivery_date||r.procedure_date))}))
  ,[equipment,rentals]);

  // ─── Render ───────────────────────────────────────────────────────────────
  const F = (k,v)=>setForm(f=>({...f,[k]:v}));

  return (
    <Layout title="Alquileres" profile={profile} onNavigate={onNavigate} pageKey={pageKey}>
      <div className="ren-page">

        {toast&&<div className={`ren-toast ren-toast--${toast.type==="err"?"err":"ok"}`}>{toast.msg}</div>}

        {/* KPIs */}
        <div className="ren-kpis">
          {[
            {label:"Casos activos",   val:kpis.active,      cls:"blue",   sub:"en curso"},
            {label:"Confirmados",     val:kpis.confirmed,   cls:"green",  sub:"agendados"},
            {label:"Pend. facturar",  val:kpis.pendingBill, cls:kpis.pendingBill>0?"red":"green", sub:"requieren factura"},
            {label:"Facturado",       val:compactMoney(kpis.totalBilled), cls:"", sub:"facturado + cerrado"},
            {label:"Margen promedio", val:kpis.avgMargin+"%", cls:"green", sub:"activos"},
            {label:"Eventos hoy",     val:kpis.todayEvents, cls:"orange", sub:"entregas / proc. / retiros"},
          ].map(({label,val,cls,sub})=>(
            <div key={label} className="ren-kpi">
              <span className="ren-kpi__label">{label}</span>
              <strong className={`ren-kpi__value${cls?" ren-kpi__value--"+cls:""}`}>{val}</strong>
              <span className="ren-kpi__sub">{sub}</span>
            </div>
          ))}
        </div>

        {/* Panel */}
        <div className="ren-panel">
          <div className="ren-panel-head">
            <div style={{display:"flex",alignItems:"center",gap:14}}>
              <h2>Casos Rental ({filtered.length})</h2>
              <div className="ren-view-toggle">
                <button className={view==="tabla"?"active":""} onClick={()=>setView("tabla")}>Tabla</button>
                <button className={view==="timeline"?"active":""} onClick={()=>setView("timeline")}>Timeline</button>
              </div>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button className="ren-btn-ghost" style={{fontSize:12}} onClick={()=>window.open("/rental-request","_blank")}>🔗 Formulario solicitud</button>
              <button className="ren-btn-primary" onClick={openCreate}>+ Nuevo caso</button>
            </div>
          </div>

          <div className="ren-filters">
            <input className="ren-search" placeholder="Buscar caso, médico, institución…" value={searchText} onChange={e=>setSearchText(e.target.value)} />
            <select className="ren-select" value={filterTech} onChange={e=>setFilterTech(e.target.value)}>
              <option value="todos">Todas las tecnologías</option>
              {TECHNOLOGIES.map(t=><option key={t} value={t}>{t}</option>)}
            </select>
            <select className="ren-select" value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
              <option value="todos">Todos los estados</option>
              {WORKFLOW.map(s=><option key={s} value={s}>{sMeta(s).label}</option>)}
            </select>
            <select className="ren-select" value={filterEquipment} onChange={e=>setFilterEquipment(e.target.value)}>
              <option value="todos">Todos los equipos</option>
              {equipment.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>

          {/* Tabla */}
          {view==="tabla"&&(
            loading?<div className="ren-empty"><p>Cargando…</p></div>:
            filtered.length===0?<div className="ren-empty"><strong>Sin casos</strong><p>Creá el primer caso o ajustá los filtros.</p></div>:
            <div className="ren-table-wrap">
              <table className="ren-table">
                <thead><tr>
                  <th>Caso</th><th>Tecnología</th><th>Equipo</th>
                  <th>Médico / Institución</th><th>Procedimiento</th>
                  <th>Total</th><th>Check</th><th>Estado</th><th></th>
                </tr></thead>
                <tbody>
                  {filtered.map(r=>{
                    const meta=sMeta(r.status);
                    const pct=checklistPct(r.checklist);
                    const tc=TECH_COLOR[r.technology]||"#64748b";
                    return (
                      <tr key={r.id} onClick={()=>{setSelected(r);setDetailTab("general");loadCaseEvents(r.id);}}>
                        <td>
                          <span className="ren-table__num">{r.case_number||r.rental_number||"—"}</span>
                          {r.procedure_date&&<div className="ren-table__sub">🏥 {fDate(r.procedure_date)}</div>}
                        </td>
                        <td><span className="ren-tech-badge" style={{background:tc+"22",color:tc,border:`1px solid ${tc}44`}}>{r.technology||"—"}</span></td>
                        <td>
                          <div className="ren-table__name">{r.equipment?.name||"—"}</div>
                          <div className="ren-table__sub">{r.equipment?.brand||""}</div>
                        </td>
                        <td>
                          <div className="ren-table__name">{r.doctor_name||"—"}</div>
                          <div className="ren-table__sub">{r.institution}</div>
                        </td>
                        <td style={{fontSize:12,color:"#475569"}}>{r.procedure_name||"—"}</td>
                        <td style={{fontWeight:700}}>{money(r.total_amount)}</td>
                        <td>
                          <div className="ren-checklist-mini">
                            <div className="ren-checklist-mini__track"><div className="ren-checklist-mini__fill" style={{width:`${pct}%`}}/></div>
                            <span className="ren-checklist-mini__label">{pct}%</span>
                          </div>
                        </td>
                        <td>
                          <span className="ren-status-badge" style={{background:meta.bg,color:meta.color,border:`1px solid ${meta.color}33`}}>
                            <span className="ren-badge-dot" style={{background:meta.color}}/>
                            {meta.label}
                          </span>
                        </td>
                        <td onClick={e=>e.stopPropagation()}>
                          <button className="ren-btn-ghost" style={{padding:"6px 10px",fontSize:12}} onClick={()=>openEdit(r)}>Editar</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Timeline / Gantt */}
          {view==="timeline"&&(
            <div>
              <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center"}}>
                <button className="ren-btn-ghost" style={{padding:"5px 10px",fontSize:12}} onClick={()=>setGanttOffset(o=>o+7)}>← Anterior</button>
                <button className="ren-btn-ghost" style={{padding:"5px 10px",fontSize:12}} onClick={()=>setGanttOffset(0)}>Hoy</button>
                <button className="ren-btn-ghost" style={{padding:"5px 10px",fontSize:12}} onClick={()=>setGanttOffset(o=>Math.max(0,o-7))}>Siguiente →</button>
              </div>
              <div className="ren-gantt">
                <div className="ren-gantt-header" style={{gridTemplateColumns:`160px repeat(${ganttDays.length},1fr)`}}>
                  <div style={{padding:"0 14px"}}>Equipo</div>
                  {ganttDays.map(d=>{const dt=new Date(d+"T00:00:00");return <div key={d} style={{textAlign:"center",fontSize:10}}><div>{["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"][dt.getDay()]}</div><div>{dt.getDate()}/{dt.getMonth()+1}</div></div>;})}
                </div>
                {ganttEquipment.map(eq=>(
                  <div key={eq.id} className="ren-gantt-row" style={{gridTemplateColumns:`160px repeat(${ganttDays.length},1fr)`}}>
                    <div className="ren-gantt-label">{eq.name}<div className="ren-gantt-label__sub">{eq.brand}</div></div>
                    {ganttDays.map(day=>{
                      const blocks=eq.blocks.filter(r=>r.delivery_date===day||r.procedure_date===day||r.retrieval_date===day);
                      const today=new Date().toISOString().slice(0,10);
                      return (
                        <div key={day} style={{background:day===today?"rgba(91,124,250,0.05)":undefined,borderLeft:day===today?"2px solid #5b7cfa":"1px solid #f1f5f9",display:"flex",flexDirection:"column",gap:2,padding:"4px 2px"}}>
                          {blocks.map(r=>{
                            const color=r.procedure_date===day?"#f97316":r.delivery_date===day?"#10b981":"#8b5cf6";
                            return <div key={r.id} onClick={()=>{setSelected(r);setDetailTab("general");loadCaseEvents(r.id);}} style={{background:color,color:"#fff",borderRadius:4,padding:"2px 4px",fontSize:9,fontWeight:700,cursor:"pointer",overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}} title={r.case_number||r.rental_number}>
                              {r.procedure_date===day?"🏥":r.delivery_date===day?"📦":"📤"} {r.doctor_name||r.institution||r.case_number}
                            </div>;
                          })}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Create / Edit Drawer ───────────────────────────────────────── */}
        {showForm&&(
          <div className="ren-modal-overlay" onClick={e=>e.target===e.currentTarget&&setShowForm(false)}>
            <div className="ren-modal">
              <div className="ren-modal-head">
                <h3>{form.id?"Editar caso":"Nuevo caso rental"}</h3>
                <button className="ren-modal-close" onClick={()=>setShowForm(false)}>×</button>
              </div>

              {/* Tecnología */}
              <div className="ren-modal-section">
                <div className="ren-modal-section-title">Tecnología</div>
                <div className="ren-tech-selector">
                  {TECHNOLOGIES.map(t=>{
                    const tc=TECH_COLOR[t];
                    return <button key={t} className={`ren-tech-option${form.technology===t?" active":""}`}
                      style={form.technology===t?{background:tc+"22",border:`2px solid ${tc}`,color:tc}:{}}
                      onClick={()=>F("technology",t)}>{t}</button>;
                  })}
                </div>
              </div>

              {/* Vinculación */}
              <div className="ren-modal-section">
                <div className="ren-modal-section-title">Vinculación</div>
                <div className="ren-form-row">
                  <div className="ren-field">
                    <label>Cliente</label>
                    <select value={form.account_id} onChange={e=>F("account_id",e.target.value)}>
                      <option value="">Seleccionar cliente…</option>
                      {accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                  <div className="ren-field">
                    <label>Oportunidad</label>
                    <select value={form.opportunity_id} onChange={e=>F("opportunity_id",e.target.value)}>
                      <option value="">Sin oportunidad</option>
                      {opps.filter(o=>!form.account_id||o.account_id===form.account_id).map(o=><option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* Equipo */}
              <div className="ren-modal-section">
                <div className="ren-modal-section-title">Equipo y servicios</div>
                <div className="ren-field ren-field--full">
                  <label>Equipo a asignar *</label>
                  <select value={form.equipment_id} onChange={e=>F("equipment_id",e.target.value)}>
                    <option value="">Seleccionar equipo…</option>
                    {equipment.map(e=>{const av=equipmentAvailability(e);return <option key={e.id} value={e.id} disabled={av.disabled}>{e.name} — {e.brand} · {av.label}</option>;})}
                  </select>
                </div>
                <div className="ren-services-check">
                  {[["requires_consumables","Consumibles"],["requires_clinical_specialist","Especialista clínico"],["requires_instrumentadora","Instrumentadora"],["requires_ecographer","Ecógrafo"],["requires_image_fusion","Fusión de imagen"],["requires_logistics","Logística"]].map(([k,label])=>(
                    <label key={k} className="ren-check-option"><input type="checkbox" checked={form[k]} onChange={e=>F(k,e.target.checked)}/>{label}</label>
                  ))}
                </div>
                <div className="ren-field ren-field--full">
                  <label>Especialista asignado</label>
                  <input value={form.assigned_specialist} onChange={e=>F("assigned_specialist",e.target.value)} placeholder="Nombre del especialista"/>
                </div>
              </div>

              {/* Médico y lugar */}
              <div className="ren-modal-section">
                <div className="ren-modal-section-title">Médico y lugar</div>
                <div className="ren-form-row">
                  <div className="ren-field"><label>Médico</label><input value={form.doctor_name} onChange={e=>F("doctor_name",e.target.value)} placeholder="Dr. Nombre Apellido"/></div>
                  <div className="ren-field"><label>Institución</label><input value={form.institution} onChange={e=>F("institution",e.target.value)} placeholder="Hospital Italiano"/></div>
                </div>
                <div className="ren-form-row">
                  <div className="ren-field"><label>Sala / Quirófano</label><input value={form.procedure_room} onChange={e=>F("procedure_room",e.target.value)} placeholder="Quirófano 3"/></div>
                  <div className="ren-field"><label>Ciudad</label><input value={form.procedure_city} onChange={e=>F("procedure_city",e.target.value)} placeholder="Buenos Aires"/></div>
                </div>
                <div className="ren-field ren-field--full"><label>Procedimiento</label><input value={form.procedure_name} onChange={e=>F("procedure_name",e.target.value)} placeholder="Ablación renal EchoLaser"/></div>
              </div>

              {/* Fechas */}
              <div className="ren-modal-section">
                <div className="ren-modal-section-title">Fechas</div>
                <div className="ren-form-row">
                  <div className="ren-field"><label>Entrega 📦</label><input type="date" value={form.delivery_date} onChange={e=>F("delivery_date",e.target.value)}/></div>
                  <div className="ren-field"><label>Procedimiento 🏥 *</label><input type="date" value={form.procedure_date} onChange={e=>F("procedure_date",e.target.value)}/></div>
                </div>
                <div className="ren-form-row">
                  <div className="ren-field"><label>Horario estimado</label><input type="time" value={form.procedure_time} onChange={e=>F("procedure_time",e.target.value)}/></div>
                  <div className="ren-field"><label>Retiro 📤</label><input type="date" value={form.retrieval_date} onChange={e=>F("retrieval_date",e.target.value)}/></div>
                </div>
              </div>

              {/* EchoLaser specific */}
              {form.technology==="EchoLaser"&&(
                <div className="ren-modal-section">
                  <div className="ren-modal-section-title">EchoLaser — Datos específicos</div>
                  <div className="ren-form-row">
                    <div className="ren-field">
                      <label>Tipo de procedimiento</label>
                      <select value={form.ela_procedure_type} onChange={e=>F("ela_procedure_type",e.target.value)}>
                        <option value="">Seleccionar…</option>
                        {["HPB","Terapia focal próstata","Tiroides","Otro"].map(t=><option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="ren-field"><label>Médico operador</label><input value={form.ela_operator_doctor} onChange={e=>F("ela_operator_doctor",e.target.value)} placeholder="Dr. Nombre"/></div>
                  </div>
                  <div className="ren-form-row">
                    <div className="ren-field"><label>Fibras estimadas</label><input type="number" value={form.ela_estimated_fibers} onChange={e=>F("ela_estimated_fibers",e.target.value)} placeholder="0"/></div>
                    <div className="ren-field"><label>Fibras utilizadas</label><input type="number" value={form.ela_used_fibers} onChange={e=>F("ela_used_fibers",e.target.value)} placeholder="0"/></div>
                  </div>
                  <div className="ren-field ren-field--full"><label>Especialista clínico</label><input value={form.ela_clinical_specialist} onChange={e=>F("ela_clinical_specialist",e.target.value)} placeholder="Nombre"/></div>
                  <div className="ren-services-check">
                    <label className="ren-check-option"><input type="checkbox" checked={form.ela_requires_ecographer} onChange={e=>F("ela_requires_ecographer",e.target.checked)}/>Ecógrafo requerido</label>
                    <label className="ren-check-option"><input type="checkbox" checked={form.ela_requires_fusion} onChange={e=>F("ela_requires_fusion",e.target.checked)}/>Fusión requerida</label>
                  </div>
                </div>
              )}

              {/* Farapulse specific */}
              {form.technology==="Farapulse"&&(
                <div className="ren-modal-section">
                  <div className="ren-modal-section-title">Farapulse — Datos específicos</div>
                  <div className="ren-form-row">
                    <div className="ren-field"><label>Electrofisiólogo</label><input value={form.far_electrophysiologist} onChange={e=>F("far_electrophysiologist",e.target.value)} placeholder="Dr. Nombre"/></div>
                    <div className="ren-field"><label>Tipo de procedimiento</label><input value={form.far_procedure_type} onChange={e=>F("far_procedure_type",e.target.value)} placeholder="Ablación FA"/></div>
                  </div>
                  <div className="ren-form-row">
                    <div className="ren-field"><label>Sala / quirófano</label><input value={form.far_room} onChange={e=>F("far_room",e.target.value)} placeholder="Sala 2"/></div>
                    <div className="ren-field"><label>Duración estimada</label><input value={form.far_estimated_duration} onChange={e=>F("far_estimated_duration",e.target.value)} placeholder="3 hs"/></div>
                  </div>
                  <div className="ren-form-row">
                    <div className="ren-field"><label>Especialista clínico</label><input value={form.far_clinical_specialist} onChange={e=>F("far_clinical_specialist",e.target.value)} placeholder="Nombre"/></div>
                    <div className="ren-field"><label>Consumibles detalle</label><input value={form.far_consumables_detail} onChange={e=>F("far_consumables_detail",e.target.value)} placeholder="Sheath, mapping…"/></div>
                  </div>
                </div>
              )}

              {/* Montos */}
              <div className="ren-modal-section">
                <div className="ren-modal-section-title">Montos</div>
                <div className="ren-form-row">
                  <div className="ren-field"><label>Alquiler equipo $</label><input type="number" value={form.base_amount} onChange={e=>F("base_amount",e.target.value)} placeholder="0"/></div>
                  <div className="ren-field"><label>Consumibles $</label><input type="number" value={form.consumables_amount} onChange={e=>F("consumables_amount",e.target.value)} placeholder="0"/></div>
                </div>
                <div className="ren-form-row">
                  <div className="ren-field"><label>Logística $</label><input type="number" value={form.logistics_amount} onChange={e=>F("logistics_amount",e.target.value)} placeholder="0"/></div>
                  <div className="ren-field"><label>Instrumentación $</label><input type="number" value={form.instrumentation_amount} onChange={e=>F("instrumentation_amount",e.target.value)} placeholder="0"/></div>
                </div>
                <div className="ren-form-row">
                  <div className="ren-field"><label>Otros $</label><input type="number" value={form.other_amount} onChange={e=>F("other_amount",e.target.value)} placeholder="0"/></div>
                  <div className="ren-field"><label>Costo real $</label><input type="number" value={form.cost_amount} onChange={e=>F("cost_amount",e.target.value)} placeholder="0"/></div>
                </div>
                <div className="ren-amounts-summary">
                  {[["Alquiler",form.base_amount],["Consumibles",form.consumables_amount],["Logística",form.logistics_amount],["Instrumentación",form.instrumentation_amount],["Otros",form.other_amount]].filter(([,v])=>Number(v)>0).map(([label,v])=>(
                    <div key={label} className="ren-amounts-row"><span className="ren-amounts-row__label">{label}</span><span className="ren-amounts-row__value">{money(v)}</span></div>
                  ))}
                  <div className="ren-amounts-row ren-amounts-total"><span className="ren-amounts-row__label">TOTAL</span><span className="ren-amounts-row__value">{money(totalAmount(form))}</span></div>
                  {Number(form.cost_amount)>0&&<div className="ren-margin-preview"><span style={{fontSize:12,color:"#64748b"}}>Margen:</span><div className="ren-margin-preview__track"><div className={`ren-margin-preview__fill ${getMarginClass(marginPct(form))}`} style={{width:`${Math.min(marginPct(form),100)}%`}}/></div><span className="ren-margin-preview__label">{marginPct(form)}%</span></div>}
                </div>
              </div>

              {/* Notas */}
              <div className="ren-modal-section">
                <div className="ren-modal-section-title">Notas</div>
                <div className="ren-field ren-field--full"><label>Notas al cliente</label><textarea value={form.notes} onChange={e=>F("notes",e.target.value)} placeholder="Condiciones especiales…"/></div>
                <div className="ren-field ren-field--full"><label>Notas internas</label><textarea value={form.internal_notes} onChange={e=>F("internal_notes",e.target.value)} placeholder="Instrucciones logísticas…"/></div>
              </div>

              <div style={{display:"flex",justifyContent:"flex-end",gap:10,paddingTop:8,borderTop:"1px solid #e8ecf2"}}>
                <button className="ren-btn-ghost" onClick={()=>setShowForm(false)}>Cancelar</button>
                <button className="ren-btn-primary" onClick={handleSave} disabled={saving||!form.equipment_id||!form.procedure_date}>
                  {saving?"Guardando…":form.id?"Guardar cambios":"Crear caso"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── 360° Case Detail ──────────────────────────────────────────── */}
        {selected&&(
          <div className="ren-detail-overlay" onClick={e=>e.target===e.currentTarget&&setSelected(null)}>
            <div className="ren-detail360">

              {/* Head */}
              <div className="ren-detail360-head">
                <div className="ren-detail360-head-left">
                  <span className="ren-detail360-case-num">{selected.case_number||selected.rental_number||"—"}</span>
                  {selected.technology&&<span className="ren-tech-badge" style={{background:TECH_COLOR[selected.technology]+"22",color:TECH_COLOR[selected.technology]||"#64748b",border:`1px solid ${TECH_COLOR[selected.technology]||"#e2e8f0"}44`,marginLeft:8}}>{selected.technology}</span>}
                  <span className="ren-status-badge" style={{background:sMeta(selected.status).bg,color:sMeta(selected.status).color,border:`1px solid ${sMeta(selected.status).color}33`,marginLeft:8}}>
                    <span className="ren-badge-dot" style={{background:sMeta(selected.status).color}}/>
                    {sMeta(selected.status).label}
                  </span>
                </div>
                <div className="ren-detail360-head-right">
                  {NEXT_STATUS[selected.status]&&(
                    <button className="ren-btn-success" onClick={()=>openAdvance(selected)}>▶ {NEXT_STATUS[selected.status].btn}</button>
                  )}
                  {!["cerrado","cancelado"].includes(selected.status)&&(
                    <button className="ren-btn-ghost" style={{color:"#dc2626",borderColor:"#fecaca"}} onClick={()=>handleCancel(selected)}>Cancelar</button>
                  )}
                  <button className="ren-modal-close" onClick={()=>setSelected(null)}>×</button>
                </div>
              </div>

              {/* Workflow progress */}
              <div className="ren-workflow-bar">
                {WORKFLOW.slice(0,-1).map(s=>{
                  const idx=WORKFLOW.indexOf(s), curIdx=WORKFLOW.indexOf(selected.status);
                  const isDone=idx<curIdx, isCur=idx===curIdx;
                  return <div key={s} className={`ren-workflow-step${isDone?" done":isCur?" current":""}`}
                    style={isCur?{background:sMeta(s).bg,borderColor:sMeta(s).color,color:sMeta(s).color}:{}} title={sMeta(s).label}>
                    <div className="ren-workflow-step__dot" style={isDone?{background:"#10b981"}:isCur?{background:sMeta(s).color}:{}}/>
                    <span>{sMeta(s).label}</span>
                  </div>;
                })}
              </div>

              {/* Tabs */}
              <div className="ren-detail360-tabs">
                {[["general","General"],["checklist","Checklist"],["finanzas","Finanzas"],["actividad","Actividad"]].map(([t,label])=>(
                  <button key={t} className={`ren-detail360-tab${detailTab===t?" active":""}`} onClick={()=>setDetailTab(t)}>{label}</button>
                ))}
              </div>

              <div className="ren-detail360-body">

                {/* TAB: General */}
                {detailTab==="general"&&(
                  <div className="ren-detail360-grid">
                    <div className="ren-detail-section">
                      <div className="ren-detail-section-title">Cliente / Médico</div>
                      {[["Cliente",selected.accounts?.name],["Médico",selected.doctor_name],["Institución",selected.institution],["Sala",selected.procedure_room],["Ciudad",selected.procedure_city],["Procedimiento",selected.procedure_name]].map(([label,val])=>(
                        <div key={label} className="ren-detail-row"><span className="ren-detail-row__label">{label}</span><span className="ren-detail-row__value">{val||"—"}</span></div>
                      ))}
                    </div>
                    <div className="ren-detail-section">
                      <div className="ren-detail-section-title">Fechas</div>
                      <div className="ren-detail-row"><span className="ren-detail-row__label">📦 Entrega</span><span className="ren-detail-row__value">{fDate(selected.delivery_date)}</span></div>
                      <div className="ren-detail-row"><span className="ren-detail-row__label">🏥 Procedimiento</span><span className="ren-detail-row__value">{fDate(selected.procedure_date)}{selected.procedure_time&&` · ${selected.procedure_time}`}</span></div>
                      <div className="ren-detail-row"><span className="ren-detail-row__label">📤 Retiro</span><span className="ren-detail-row__value">{fDate(selected.retrieval_date)}</span></div>
                    </div>
                    <div className="ren-detail-section">
                      <div className="ren-detail-section-title">Equipo y servicios</div>
                      <div className="ren-detail-row"><span className="ren-detail-row__label">Equipo</span><span className="ren-detail-row__value">{selected.equipment?.name||"—"}</span></div>
                      <div className="ren-detail-row"><span className="ren-detail-row__label">Marca</span><span className="ren-detail-row__value">{selected.equipment?.brand||"—"}</span></div>
                      {selected.assigned_specialist&&<div className="ren-detail-row"><span className="ren-detail-row__label">Especialista</span><span className="ren-detail-row__value">{selected.assigned_specialist}</span></div>}
                      <div className="ren-services-tags">
                        {selected.requires_consumables&&<span className="ren-svc-tag">Consumibles</span>}
                        {selected.requires_clinical_specialist&&<span className="ren-svc-tag">Esp. clínico</span>}
                        {selected.requires_instrumentadora&&<span className="ren-svc-tag">Instrumentadora</span>}
                        {selected.requires_ecographer&&<span className="ren-svc-tag">Ecógrafo</span>}
                        {selected.requires_image_fusion&&<span className="ren-svc-tag">Fusión imagen</span>}
                        {selected.requires_logistics&&<span className="ren-svc-tag">Logística</span>}
                      </div>
                    </div>
                    {selected.technology==="EchoLaser"&&(selected.ela_procedure_type||selected.ela_estimated_fibers||selected.ela_operator_doctor)&&(
                      <div className="ren-detail-section">
                        <div className="ren-detail-section-title" style={{color:"#6366f1"}}>EchoLaser</div>
                        {selected.ela_procedure_type&&<div className="ren-detail-row"><span className="ren-detail-row__label">Tipo</span><span className="ren-detail-row__value">{selected.ela_procedure_type}</span></div>}
                        {selected.ela_estimated_fibers&&<div className="ren-detail-row"><span className="ren-detail-row__label">Fibras est.</span><span className="ren-detail-row__value">{selected.ela_estimated_fibers}</span></div>}
                        {selected.ela_used_fibers&&<div className="ren-detail-row"><span className="ren-detail-row__label">Fibras usadas</span><span className="ren-detail-row__value">{selected.ela_used_fibers}</span></div>}
                        {selected.ela_operator_doctor&&<div className="ren-detail-row"><span className="ren-detail-row__label">Operador</span><span className="ren-detail-row__value">{selected.ela_operator_doctor}</span></div>}
                        {selected.ela_clinical_specialist&&<div className="ren-detail-row"><span className="ren-detail-row__label">Especialista</span><span className="ren-detail-row__value">{selected.ela_clinical_specialist}</span></div>}
                      </div>
                    )}
                    {selected.technology==="Farapulse"&&(selected.far_electrophysiologist||selected.far_procedure_type)&&(
                      <div className="ren-detail-section">
                        <div className="ren-detail-section-title" style={{color:"#ef4444"}}>Farapulse</div>
                        {selected.far_electrophysiologist&&<div className="ren-detail-row"><span className="ren-detail-row__label">Electrofisiólogo</span><span className="ren-detail-row__value">{selected.far_electrophysiologist}</span></div>}
                        {selected.far_procedure_type&&<div className="ren-detail-row"><span className="ren-detail-row__label">Tipo</span><span className="ren-detail-row__value">{selected.far_procedure_type}</span></div>}
                        {selected.far_room&&<div className="ren-detail-row"><span className="ren-detail-row__label">Sala</span><span className="ren-detail-row__value">{selected.far_room}</span></div>}
                        {selected.far_estimated_duration&&<div className="ren-detail-row"><span className="ren-detail-row__label">Duración est.</span><span className="ren-detail-row__value">{selected.far_estimated_duration}</span></div>}
                        {selected.far_clinical_specialist&&<div className="ren-detail-row"><span className="ren-detail-row__label">Especialista</span><span className="ren-detail-row__value">{selected.far_clinical_specialist}</span></div>}
                      </div>
                    )}
                    {(selected.notes||selected.internal_notes)&&(
                      <div className="ren-detail-section">
                        <div className="ren-detail-section-title">Notas</div>
                        {selected.notes&&<p style={{fontSize:13,color:"#334155",margin:"0 0 8px"}}>{selected.notes}</p>}
                        {selected.internal_notes&&<p style={{fontSize:12,color:"#64748b",margin:0,background:"#f8fafc",padding:"8px 10px",borderRadius:8}}>{selected.internal_notes}</p>}
                      </div>
                    )}
                  </div>
                )}

                {/* TAB: Checklist */}
                {detailTab==="checklist"&&(
                  <div>
                    <div className="ren-checklist-header">
                      <span>Progreso del caso</span>
                      <strong>{checklistPct(selected.checklist)}%</strong>
                    </div>
                    <div className="ren-checklist-bar"><div className="ren-checklist-bar__fill" style={{width:`${checklistPct(selected.checklist)}%`}}/></div>
                    <div className="ren-checklist-list">
                      {CHECKLIST_ITEMS.map(item=>{
                        const entry=selected.checklist?.[item.key];
                        const isChecked=entry?.checked||false;
                        return (
                          <label key={item.key} className={`ren-checklist-item${isChecked?" done":""}`}>
                            <input type="checkbox" checked={isChecked} onChange={()=>toggleChecklist(item.key)}/>
                            <span className="ren-checklist-item__label">{item.label}</span>
                            {isChecked&&entry?.checked_by&&<span className="ren-checklist-item__meta">{entry.checked_by} · {fDateTime(entry.checked_at)}</span>}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* TAB: Finanzas */}
                {detailTab==="finanzas"&&(
                  <div className="ren-detail360-grid">
                    <div className="ren-detail-section">
                      <div className="ren-detail-section-title">Desglose</div>
                      {[["Alquiler equipo",selected.base_amount],["Consumibles",selected.consumables_amount],["Logística",selected.logistics_amount],["Instrumentación",selected.instrumentation_amount],["Otros",selected.other_amount]].map(([label,v])=>Number(v)>0&&(
                        <div key={label} className="ren-detail-row"><span className="ren-detail-row__label">{label}</span><span className="ren-detail-row__value">{money(v)}</span></div>
                      ))}
                      <div className="ren-detail-row" style={{borderTop:"1px solid #e8ecf2",paddingTop:6,marginTop:4}}>
                        <span className="ren-detail-row__label" style={{fontWeight:700}}>TOTAL</span>
                        <span className="ren-detail-row__value" style={{fontSize:15,color:"#5b7cfa"}}>{money(selected.total_amount)}</span>
                      </div>
                      <div className="ren-detail-row"><span className="ren-detail-row__label">Costo real</span><span className="ren-detail-row__value">{money(selected.cost_amount)}</span></div>
                      <div className="ren-detail-row">
                        <span className="ren-detail-row__label">Margen</span>
                        <span className="ren-detail-row__value" style={{color:Number(selected.profit_margin)>=45?"#10b981":"#f97316",fontWeight:700}}>{selected.profit_margin}%</span>
                      </div>
                    </div>
                    <div className="ren-detail-section">
                      <div className="ren-detail-section-title">Facturación</div>
                      {[["Cotizado",selected.quoted_amount],["Aprobado",selected.approved_amount],["Facturado",selected.invoiced_amount]].map(([label,v])=>(
                        <div key={label} className="ren-detail-row"><span className="ren-detail-row__label">{label}</span><span className="ren-detail-row__value">{money(v)}</span></div>
                      ))}
                      <div className="ren-detail-row"><span className="ren-detail-row__label">N° Factura</span><span className="ren-detail-row__value">{selected.invoice_number||"—"}</span></div>
                      <div className="ren-detail-row"><span className="ren-detail-row__label">Facturable</span><span className="ren-detail-row__value">{selected.is_billable===false?"No":"Sí"}</span></div>
                    </div>
                  </div>
                )}

                {/* TAB: Actividad */}
                {detailTab==="actividad"&&(
                  loadingEvents?<p style={{color:"#94a3b8",fontSize:13,padding:20}}>Cargando historial…</p>:
                  caseEvents.length===0?<p style={{color:"#94a3b8",fontSize:13,padding:20}}>Sin historial de cambios aún.</p>:
                  <div className="ren-timeline-list">
                    {caseEvents.map(ev=>(
                      <div key={ev.id} className="ren-timeline-item">
                        <div className="ren-timeline-dot" style={{background:sMeta(ev.to_status).color}}/>
                        <div className="ren-timeline-content">
                          <div className="ren-timeline-label">
                            {ev.from_status?`${sMeta(ev.from_status).label} → ${sMeta(ev.to_status).label}`:sMeta(ev.to_status).label}
                          </div>
                          {ev.comment&&<div className="ren-timeline-comment">"{ev.comment}"</div>}
                          <div className="ren-timeline-meta">{fDateTime(ev.changed_at)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="ren-detail360-footer">
                <button className="ren-btn-ghost" onClick={()=>{openEdit(selected);setSelected(null);}}>Editar caso</button>
                {selected.opportunity_id&&(
                  <button className="ren-btn-ghost" onClick={()=>onNavigate("opportunities",{navigationData:{id:selected.opportunity_id}})}>Ver oportunidad</button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Advance State Modal ───────────────────────────────────────── */}
        {showAdvance&&(
          <div className="ren-advance-overlay" onClick={e=>e.target===e.currentTarget&&setShowAdvance(null)}>
            <div className="ren-advance-modal">
              <h4 style={{margin:"0 0 16px",fontSize:16,fontWeight:800,color:"#0f172a"}}>Avanzar estado</h4>
              <div className="ren-advance-arrow">
                <span className="ren-status-badge" style={{background:sMeta(showAdvance.fromStatus).bg,color:sMeta(showAdvance.fromStatus).color}}>{sMeta(showAdvance.fromStatus).label}</span>
                <span style={{fontSize:18,color:"#94a3b8",margin:"0 10px"}}>→</span>
                <span className="ren-status-badge" style={{background:sMeta(showAdvance.to).bg,color:sMeta(showAdvance.to).color}}>{sMeta(showAdvance.to).label}</span>
              </div>
              {showAdvance.needsInvoice&&(
                <div className="ren-field" style={{marginTop:14}}>
                  <label>Número de factura</label>
                  <input value={advanceInvoice} onChange={e=>setAdvanceInvoice(e.target.value)} placeholder="FAC-0001" autoFocus/>
                </div>
              )}
              <div className="ren-field" style={{marginTop:14}}>
                <label>Comentario (opcional)</label>
                <textarea rows={2} value={advanceComment} onChange={e=>setAdvanceComment(e.target.value)} placeholder="Observaciones del cambio de estado…"/>
              </div>
              <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:16}}>
                <button className="ren-btn-ghost" onClick={()=>setShowAdvance(null)}>Cancelar</button>
                <button className="ren-btn-primary" onClick={confirmAdvance} disabled={advanceSaving}>{advanceSaving?"Guardando…":"Confirmar"}</button>
              </div>
            </div>
          </div>
        )}

      </div>
    </Layout>
  );
}
