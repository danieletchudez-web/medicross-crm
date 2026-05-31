import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CalendarPlus,
  ClipboardCheck,
  FileText,
  History,
  Image,
  Paperclip,
  Pencil,
  Play,
  RefreshCw,
  Search,
  Square,
  Timer,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import Layout from "../components/Layout";
import { EmptyState, MetricKpi, ModuleHeader } from "../components/CRMUI";
import { supabase } from "../lib/supabaseClient";
import "./visits.css";

const EMPTY_FORM = {
  account_id:"", product_id:"", contact_name:"",
  visit_type:"presencial", visit_date:new Date().toISOString().slice(0,10),
  visit_time:"", status:"programada", priority:"media",
  business_unit:"", pipeline_stage:"", objective:"", notes:"",
  result:"", objection:"", next_step:"", next_action:"",
  next_action_date:"", followup_date:"", commercial_potential:"", materials:[],
  present_contacts:[], attachments:[], pending_files:[],
  started_at:"", ended_at:"", duration_minutes:"", is_draft:false,
};

const VISIT_TYPES = [
  {value:"presencial",label:"Presencial"},{value:"virtual",label:"Virtual"},
  {value:"telefono",label:"Llamada"},{value:"seguimiento",label:"Seguimiento"},
  {value:"demo",label:"Demo"},{value:"capacitacion",label:"Capacitación"},
  {value:"cotizacion",label:"Cotización"},{value:"postventa",label:"Postventa"},
];
const STATUS_OPTIONS = [
  {value:"borrador",          label:"Borrador",          color:"#64748b"},
  {value:"programada",       label:"Programada",       color:"#185fa5"},
  {value:"realizada",        label:"Realizada",         color:"#2d7d46"},
  {value:"reprogramada",     label:"Reprogramada",      color:"#d97706"},
  {value:"cancelada",        label:"Cancelada",         color:"#dc2626"},
  {value:"pendiente_informe",label:"Pendiente informe", color:"#7c3aed"},
];
const PRIORITY_OPTIONS = [
  {value:"alta",  label:"Alta",   color:"#dc2626"},
  {value:"media", label:"Media",  color:"#d97706"},
  {value:"baja",  label:"Baja",   color:"#2d7d46"},
];
const BUSINESS_UNITS  = ["EchoLaser","Diálisis","Osypka","VAC","Fresenius Kabi","Kangaroo","Otra"];
const PIPELINE_STAGES = ["Lead","Contacto","Reunión","Demo","Cotización","Negociación","Ganado","Perdido"];
const MATERIAL_LABELS = {speech:"Speech",brochure:"Brochure",video:"Video",ficha_tecnica:"Ficha técnica"};

function money(v) {
  return new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:0}).format(Number(v||0));
}
function getFollowupAlert(visitDate,followupDate) {
  const today=new Date(); today.setHours(0,0,0,0);
  if (!followupDate) return null;
  const follow=new Date(followupDate); follow.setHours(0,0,0,0);
  const d=Math.ceil((follow-today)/86400000);
  if (d<0)   return {tone:"overdue",label:`Vencido hace ${Math.abs(d)}d`};
  if (d===0) return {tone:"today",  label:"Seguimiento HOY"};
  if (d<=2)  return {tone:"urgent", label:`Seguimiento en ${d}d`};
  if (d<=7)  return {tone:"soon",   label:`Seguimiento en ${d}d`};
  return {tone:"ok",label:`Seguimiento en ${d}d`};
}
function getTimelineData(visitDate,followupDate) {
  if (!visitDate) return null;
  const today=new Date(); today.setHours(0,0,0,0);
  const visit=new Date(visitDate); visit.setHours(0,0,0,0);
  const daysSinceVisit=Math.ceil((today-visit)/86400000);
  if (!followupDate) return {daysSinceVisit,totalSpan:null,progress:null};
  const follow=new Date(followupDate); follow.setHours(0,0,0,0);
  const totalSpan=Math.ceil((follow-visit)/86400000);
  const elapsed=Math.ceil((today-visit)/86400000);
  const progress=totalSpan>0?Math.min(100,Math.max(0,Math.round((elapsed/totalSpan)*100))):100;
  return {daysSinceVisit,totalSpan,progress};
}
function buildPayload(f,profileId) {
  const presentContacts = Array.isArray(f.present_contacts) ? f.present_contacts : [];
  return {
    account_id:f.account_id||null, product_id:f.product_id||null,
    contact_name:presentContacts.map(contact=>contact.name).filter(Boolean).join(", ")||f.contact_name||null,
    present_contacts:presentContacts,
    attachments:Array.isArray(f.attachments)?f.attachments:[],
    started_at:f.started_at||null, ended_at:f.ended_at||null,
    duration_minutes:Number(f.duration_minutes||0)||null, is_draft:Boolean(f.is_draft),
    visit_type:f.visit_type,
    visit_date:f.visit_date, visit_time:f.visit_time||null, status:f.status,
    priority:f.priority, business_unit:f.business_unit||null,
    pipeline_stage:f.pipeline_stage||null, objective:f.objective||null,
    notes:f.notes||null, result:f.result||null, objection:f.objection||null,
    next_step:f.next_step||null, next_action:f.next_action||null,
    next_action_date:f.next_action_date||null, followup_date:f.followup_date||null,
    commercial_potential:Number(f.commercial_potential||0), materials:f.materials,
    owner_id:profileId||null, updated_at:new Date().toISOString(),
  };
}

function useMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 600);
  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth <= 600);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return isMobile;
}

function formatElapsed(totalSeconds) {
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function ContactPicker({ f, setF, accounts, onCreateContact }) {
  const account = accounts.find(item => item.id === f.account_id);
  const contacts = Array.isArray(account?.contacts) ? account.contacts : [];
  const selected = Array.isArray(f.present_contacts) ? f.present_contacts : [];

  function addContact(event) {
    const index = Number(event.target.value);
    if (!Number.isInteger(index)) return;
    const contact = contacts[index];
    if (!contact || selected.some(item => item.name === contact.name && item.email === contact.email)) return;
    setF({ ...f, present_contacts: [...selected, contact], contact_name: "" });
    event.target.value = "";
  }

  return (
    <div className="vf-contact-picker">
      <div className="vf-contact-picker__row">
        <select value="" onChange={addContact} disabled={!f.account_id}>
          <option value="">{f.account_id ? "Agregar contacto presente" : "Elegí un cliente primero"}</option>
          {contacts.map((contact, index) => (
            <option key={`${contact.email||contact.name}-${index}`} value={index}>
              {contact.name||"Sin nombre"}{contact.role?` · ${contact.role}`:""}
            </option>
          ))}
        </select>
        <button type="button" className="vf-link-btn" onClick={() => onCreateContact(f, setF)} disabled={!f.account_id}>
          + Nuevo contacto
        </button>
      </div>
      {selected.length > 0 && (
        <div className="vf-contact-chips">
          {selected.map((contact, index) => (
            <span className="vf-contact-chip" key={`${contact.email||contact.name}-${index}`}>
              {contact.name||"Sin nombre"}
              <button type="button" onClick={() => setF({ ...f, present_contacts:selected.filter((_, itemIndex)=>itemIndex!==index) })} title="Quitar contacto">
                <X size={12}/>
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function AttachmentPicker({ f, setF }) {
  const attachments = Array.isArray(f.attachments) ? f.attachments : [];
  const pendingFiles = Array.isArray(f.pending_files) ? f.pending_files : [];

  function onPick(event) {
    const incoming = [...event.target.files];
    const available = Math.max(0, 5 - attachments.length - pendingFiles.length);
    const accepted = incoming.slice(0, available).filter(file => {
      if (!["image/jpeg","image/png","application/pdf"].includes(file.type)) {
        alert(`${file.name}: formato no permitido. Usá JPG, PNG o PDF.`);
        return false;
      }
      if (file.size > 10 * 1024 * 1024) {
        alert(`${file.name}: supera el límite de 10 MB.`);
        return false;
      }
      return true;
    });
    setF({ ...f, pending_files:[...pendingFiles, ...accepted] });
    event.target.value = "";
  }

  return (
    <div className="vf-attachments">
      <label className="vf-upload-btn">
        <Paperclip size={15}/> Adjuntar archivo
        <input type="file" accept=".jpg,.jpeg,.png,.pdf" multiple onChange={onPick}/>
      </label>
      <small>{attachments.length + pendingFiles.length}/5 archivos · JPG, PNG o PDF · máximo 10 MB</small>
      {(attachments.length > 0 || pendingFiles.length > 0) && (
        <div className="vf-attachment-list">
          {attachments.map((file, index) => (
            <a className="vf-attachment" key={file.path||index} href={file.url} target="_blank" rel="noreferrer">
              {file.type?.startsWith("image/") ? <Image size={15}/> : <FileText size={15}/>}
              <span>{file.name}</span>
            </a>
          ))}
          {pendingFiles.map((file, index) => (
            <span className="vf-attachment vf-attachment--pending" key={`${file.name}-${index}`}>
              {file.type.startsWith("image/") ? <Image size={15}/> : <FileText size={15}/>}
              <span>{file.name}</span>
              <button type="button" onClick={() => setF({ ...f, pending_files:pendingFiles.filter((_, itemIndex)=>itemIndex!==index) })} title="Quitar archivo">
                <X size={12}/>
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function VisitTimer({ f, elapsed, onStart, onFinish }) {
  const running = Boolean(f.started_at && !f.ended_at);
  return (
    <div className={`vf-timer ${running ? "vf-timer--running" : ""}`}>
      <div className="vf-timer__readout">
        <Timer size={17}/>
        <div>
          <span>Tiempo de visita</span>
          <strong>{running ? formatElapsed(elapsed) : f.duration_minutes ? `${f.duration_minutes} min` : "Sin iniciar"}</strong>
        </div>
      </div>
      {running ? (
        <button type="button" className="vf-timer__btn vf-timer__btn--stop" onClick={onFinish}><Square size={13}/> Finalizar visita</button>
      ) : (
        <button type="button" className="vf-timer__btn" onClick={onStart}><Play size={13}/> Iniciar visita</button>
      )}
    </div>
  );
}

/* ── VisitForm DESKTOP ─────────────────────────────────────────────── */
function VisitForm({f,setF,isEdit,onSubmit,onCancel,accounts,products,loading,onToggleMaterial,onCreateContact,elapsed,onStartTimer,onFinishTimer}) {
  return (
    <div className="vf-wrap">
      <div className="vf-section">
        <span className="vf-section__label">Datos principales</span>
        <div className="vf-grid">
          <div className="vf-field vf-field--wide">
            <label>Cliente *</label>
            <select value={f.account_id} onChange={e=>setF({...f,account_id:e.target.value})} required>
              <option value="">Seleccionar cliente</option>
              {accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="vf-field vf-field--wide">
            <label>Contactos presentes</label>
            <ContactPicker f={f} setF={setF} accounts={accounts} onCreateContact={onCreateContact}/>
          </div>
          <div className="vf-field">
            <label>Producto / línea</label>
            <select value={f.product_id} onChange={e=>setF({...f,product_id:e.target.value})}>
              <option value="">Seleccionar producto</option>
              {products.map(p=><option key={p.id} value={p.id}>{p.name} · {p.line}</option>)}
            </select>
          </div>
          <div className="vf-field">
            <label>Unidad de negocio</label>
            <select value={f.business_unit} onChange={e=>setF({...f,business_unit:e.target.value})}>
              <option value="">Seleccionar</option>
              {BUSINESS_UNITS.map(b=><option key={b}>{b}</option>)}
            </select>
          </div>
        </div>
      </div>

      <VisitTimer f={f} elapsed={elapsed} onStart={onStartTimer} onFinish={onFinishTimer}/>

      <div className="vf-section">
        <span className="vf-section__label">Fecha, tipo y estado</span>
        <div className="vf-grid">
          <div className="vf-field"><label>Fecha visita</label>
            <input type="date" value={f.visit_date} onChange={e=>setF({...f,visit_date:e.target.value})}/></div>
          <div className="vf-field"><label>Hora</label>
            <input type="time" value={f.visit_time} onChange={e=>setF({...f,visit_time:e.target.value})}/></div>
          <div className="vf-field"><label>Tipo</label>
            <select value={f.visit_type} onChange={e=>setF({...f,visit_type:e.target.value})}>
              {VISIT_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
          <div className="vf-field"><label>Estado</label>
            <select value={f.status} onChange={e=>setF({...f,status:e.target.value})}>
              {STATUS_OPTIONS.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
          <div className="vf-field"><label>Prioridad</label>
            <select value={f.priority} onChange={e=>setF({...f,priority:e.target.value})}>
              {PRIORITY_OPTIONS.map(p=><option key={p.value} value={p.value}>{p.label}</option>)}</select></div>
          <div className="vf-field"><label>Etapa pipeline</label>
            <select value={f.pipeline_stage} onChange={e=>setF({...f,pipeline_stage:e.target.value})}>
              <option value="">Seleccionar</option>
              {PIPELINE_STAGES.map(s=><option key={s}>{s}</option>)}</select></div>
          <div className="vf-field"><label>Potencial ARS</label>
            <input type="number" value={f.commercial_potential} onChange={e=>setF({...f,commercial_potential:e.target.value})} placeholder="0"/></div>
        </div>
      </div>

      <div className="vf-section">
        <span className="vf-section__label">Contenido</span>
        <div className="vf-grid">
          <div className="vf-field vf-field--full"><label>Objetivo</label>
            <input value={f.objective} onChange={e=>setF({...f,objective:e.target.value})} placeholder="¿Qué querías lograr?"/></div>
          <div className="vf-field vf-field--full"><label>Notas</label>
            <textarea value={f.notes} onChange={e=>setF({...f,notes:e.target.value})} placeholder="Resumen de la conversación..."/></div>
          <div className="vf-field vf-field--full"><label>Resultado concreto</label>
            <textarea value={f.result} onChange={e=>setF({...f,result:e.target.value})} placeholder="¿Qué se acordó?" rows={2}/></div>
          <div className="vf-field"><label>Objeción</label>
            <input value={f.objection} onChange={e=>setF({...f,objection:e.target.value})} placeholder="Precio, timing..."/></div>
          <div className="vf-field vf-field--wide"><label>Material enviado</label>
            <div className="vf-materials">
              {["speech","brochure","video","ficha_tecnica"].map(m=>(
                <button type="button" key={m} className={`vf-material-btn ${f.materials.includes(m)?"active":""}`}
                  onClick={()=>onToggleMaterial(m)}>{MATERIAL_LABELS[m]}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="vf-section">
        <span className="vf-section__label">Próximos pasos</span>
        <div className="vf-grid">
          <div className="vf-field vf-field--wide"><label>Próximo compromiso</label>
            <input value={f.next_step} onChange={e=>setF({...f,next_step:e.target.value})} placeholder="Enviar cotización..."/></div>
          <div className="vf-field vf-field--wide"><label>Próxima acción</label>
            <input value={f.next_action} onChange={e=>setF({...f,next_action:e.target.value})} placeholder="Llamar al comprador..."/></div>
          <div className="vf-field"><label>Fecha próxima acción</label>
            <input type="date" value={f.next_action_date} onChange={e=>setF({...f,next_action_date:e.target.value})}/></div>
          <div className="vf-field"><label>Fecha seguimiento</label>
            <input type="date" value={f.followup_date} onChange={e=>setF({...f,followup_date:e.target.value})}/></div>
        </div>
      </div>

      <div className="vf-section">
        <span className="vf-section__label">Archivos adjuntos</span>
        <AttachmentPicker f={f} setF={setF}/>
      </div>

      <div className="vf-actions">
        {onCancel&&<button type="button" className="vf-btn vf-btn--cancel" onClick={onCancel}>Cancelar</button>}
        <button type={isEdit?"button":"submit"} className="vf-btn vf-btn--save"
          onClick={isEdit?onSubmit:undefined} disabled={loading}>
          {loading?"Guardando...":isEdit?"💾 Guardar cambios":"✓ Guardar visita"}
        </button>
      </div>
    </div>
  );
}

/* ── VisitFormMobile ───────────────────────────────────────────────── */
function VisitFormMobile({f,setF,isEdit,onSubmit,onCancel,accounts,products,loading,onToggleMaterial,onCreateContact,elapsed,onStartTimer,onFinishTimer}) {
  const [step, setStep] = useState(1);
  const stepLabels = ["¿Con quién?","¿Qué pasó?","¿Qué sigue?"];
  return (
    <div className="vf-wrap">
      <div style={{display:"flex",gap:6,marginBottom:4}}>
        {stepLabels.map((label,i) => (
          <button key={i} type="button"
            style={{flex:1,padding:"10px 4px",borderRadius:10,border:"none",cursor:"pointer",
              fontWeight:700,fontSize:12,fontFamily:"inherit",
              background:step===i+1?"#0f2444":step>i+1?"#e0f2fe":"#f1f5f9",
              color:step===i+1?"#fff":step>i+1?"#0369a1":"#94a3b8"}}
            onClick={()=>setStep(i+1)}>
            {step>i+1?"✓ ":""}{label}
          </button>
        ))}
      </div>
      {step===1&&(
        <div className="vf-section">
          <div className="vf-grid">
            <div className="vf-field vf-field--full"><label>Cliente *</label>
              <select value={f.account_id} onChange={e=>setF({...f,account_id:e.target.value})} required>
                <option value="">Seleccionar cliente</option>
                {accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
              </select></div>
            <div className="vf-field vf-field--full"><label>Contactos presentes</label>
              <ContactPicker f={f} setF={setF} accounts={accounts} onCreateContact={onCreateContact}/></div>
            <div className="vf-field vf-field--full"><label>Producto / línea</label>
              <select value={f.product_id} onChange={e=>setF({...f,product_id:e.target.value})}>
                <option value="">Seleccionar producto</option>
                {products.map(p=><option key={p.id} value={p.id}>{p.name} · {p.line}</option>)}
              </select></div>
            <div className="vf-field vf-field--full"><label>Fecha visita</label>
              <input type="date" value={f.visit_date} onChange={e=>setF({...f,visit_date:e.target.value})}/></div>
            <div className="vf-field vf-field--full"><label>Tipo</label>
              <select value={f.visit_type} onChange={e=>setF({...f,visit_type:e.target.value})}>
                {VISIT_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
            <div className="vf-field vf-field--full"><label>Estado</label>
              <select value={f.status} onChange={e=>setF({...f,status:e.target.value})}>
                {STATUS_OPTIONS.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
            <div className="vf-field vf-field--full"><label>Prioridad</label>
              <select value={f.priority} onChange={e=>setF({...f,priority:e.target.value})}>
                {PRIORITY_OPTIONS.map(p=><option key={p.value} value={p.value}>{p.label}</option>)}</select></div>
          </div>
          <VisitTimer f={f} elapsed={elapsed} onStart={onStartTimer} onFinish={onFinishTimer}/>
          <div className="vf-actions">
            {onCancel&&<button type="button" className="vf-btn vf-btn--cancel" onClick={onCancel}>Cancelar</button>}
            <button type="button" className="vf-btn vf-btn--save" onClick={()=>setStep(2)}>Siguiente →</button>
          </div>
        </div>
      )}
      {step===2&&(
        <div className="vf-section">
          <div className="vf-grid">
            <div className="vf-field vf-field--full"><label>Objetivo</label>
              <input value={f.objective} onChange={e=>setF({...f,objective:e.target.value})} placeholder="¿Qué querías lograr?"/></div>
            <div className="vf-field vf-field--full"><label>Notas</label>
              <textarea value={f.notes} onChange={e=>setF({...f,notes:e.target.value})} placeholder="Resumen de la conversación..."/></div>
            <div className="vf-field vf-field--full"><label>Resultado concreto</label>
              <textarea value={f.result} onChange={e=>setF({...f,result:e.target.value})} placeholder="¿Qué se acordó?" rows={2}/></div>
            <div className="vf-field vf-field--full"><label>Objeción principal</label>
              <input value={f.objection} onChange={e=>setF({...f,objection:e.target.value})} placeholder="Precio, timing..."/></div>
            <div className="vf-field vf-field--full"><label>Material enviado</label>
              <div className="vf-materials">
                {["speech","brochure","video","ficha_tecnica"].map(m=>(
                  <button type="button" key={m} className={`vf-material-btn ${f.materials.includes(m)?"active":""}`}
                    onClick={()=>onToggleMaterial(m)}>{MATERIAL_LABELS[m]}</button>
                ))}
              </div></div>
          </div>
          <div className="vf-actions">
            <button type="button" className="vf-btn vf-btn--cancel" onClick={()=>setStep(1)}>← Atrás</button>
            <button type="button" className="vf-btn vf-btn--save" onClick={()=>setStep(3)}>Siguiente →</button>
          </div>
        </div>
      )}
      {step===3&&(
        <div className="vf-section">
          <div className="vf-grid">
            <div className="vf-field vf-field--full"><label>Próxima acción</label>
              <input value={f.next_action} onChange={e=>setF({...f,next_action:e.target.value})} placeholder="Llamar al comprador..."/></div>
            <div className="vf-field vf-field--full"><label>Fecha próxima acción</label>
              <input type="date" value={f.next_action_date} onChange={e=>setF({...f,next_action_date:e.target.value})}/></div>
            <div className="vf-field vf-field--full"><label>Fecha de seguimiento</label>
              <input type="date" value={f.followup_date} onChange={e=>setF({...f,followup_date:e.target.value})}/></div>
            <div className="vf-field vf-field--full"><label>Próximo compromiso</label>
              <input value={f.next_step} onChange={e=>setF({...f,next_step:e.target.value})} placeholder="Demo, visita técnica..."/></div>
          </div>
          <AttachmentPicker f={f} setF={setF}/>
          <div className="vf-actions">
            <button type="button" className="vf-btn vf-btn--cancel" onClick={()=>setStep(2)}>← Atrás</button>
            <button type={isEdit?"button":"submit"} className="vf-btn vf-btn--save"
              onClick={isEdit?onSubmit:undefined} disabled={loading}>
              {loading?"Guardando...":isEdit?"💾 Guardar cambios":"✓ Guardar visita"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   VisitsPage — componente principal
══════════════════════════════════════════════════════════════════════ */
export default function VisitsPage({profile,onNavigate,navigationData,pageKey}) {
  const isMobile = useMobile();
  const [visits,       setVisits]       = useState([]);
  const [accounts,     setAccounts]     = useState([]);
  const [products,     setProducts]     = useState([]);
  const [form,         setForm]         = useState(EMPTY_FORM);
  const [loading,      setLoading]      = useState(false);
  const [editingId,    setEditingId]    = useState(null);
  const [editForm,     setEditForm]     = useState(null);
  const [deletingId,   setDeletingId]   = useState(null);
  const [filterStatus, setFilterStatus] = useState("todas");
  const [activeTab,    setActiveTab]    = useState("history");
  const [search,       setSearch]       = useState("");
  const [attentionOnly,setAttentionOnly]= useState(false);
  const [quickOpen,    setQuickOpen]    = useState(false);
  const [quickForm,    setQuickForm]    = useState({account_id:"",product_id:"",result:""});
  const [elapsed,      setElapsed]      = useState(0);

  useEffect(()=>{ loadData(); },[]);
  useEffect(()=>{
    const stored = localStorage.getItem("medicross_visit_timer");
    if (!stored) return;
    try {
      const timer = JSON.parse(stored);
      if (!timer.started_at) return;
      setForm(current=>({...current,started_at:timer.started_at,ended_at:""}));
    } catch { localStorage.removeItem("medicross_visit_timer"); }
  },[]);

  useEffect(()=>{
    const startedAt = form.started_at;
    if (!startedAt || form.ended_at) { setElapsed(0); return; }
    const update = () => setElapsed(Math.max(0,Math.floor((Date.now()-new Date(startedAt).getTime())/1000)));
    update();
    const timer = window.setInterval(update,1000);
    return () => window.clearInterval(timer);
  },[form.ended_at,form.started_at]);

  async function loadData() {
    const [vRes,aRes,pRes] = await Promise.all([
      supabase.from("visits").select("*, accounts(name), products(name, line)").order("visit_date",{ascending:false}),
      supabase.from("accounts").select("*").order("name"),
      supabase.from("products").select("*").order("name"),
    ]);
    setVisits(vRes.data||[]);
    setAccounts(aRes.data||[]);
    setProducts(pRes.data||[]);
  }

  const toggleMaterialNew  = m => setForm(p=>({...p,materials:p.materials.includes(m)?p.materials.filter(x=>x!==m):[...p.materials,m]}));
  const toggleMaterialEdit = m => setEditForm(p=>({...p,materials:p.materials.includes(m)?p.materials.filter(x=>x!==m):[...p.materials,m]}));

  async function uploadAttachments(visitId,currentAttachments,pendingFiles) {
    const uploaded = [...(currentAttachments||[])];
    for (const file of pendingFiles||[]) {
      const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g,"-");
      const path = `${profile?.id||"unassigned"}/${visitId}/${crypto.randomUUID()}-${cleanName}`;
      const {error} = await supabase.storage.from("visit-attachments").upload(path,file,{contentType:file.type,upsert:false});
      if (error) throw error;
      const {data} = supabase.storage.from("visit-attachments").getPublicUrl(path);
      uploaded.push({name:file.name,path,url:data.publicUrl,type:file.type,size:file.size});
    }
    return uploaded;
  }

  async function saveVisit(e) {
    e?.preventDefault();
    setLoading(true);
    const {data,error} = await supabase.from("visits").insert([buildPayload(form,profile?.id)]).select("id").single();
    if (error) alert("Error: "+error.message);
    else {
      try {
        const attachments = await uploadAttachments(data.id,form.attachments,form.pending_files);
        if (attachments.length) await supabase.from("visits").update({attachments}).eq("id",data.id);
        localStorage.removeItem("medicross_visit_timer");
        setForm({...EMPTY_FORM,materials:[],present_contacts:[],attachments:[],pending_files:[]});
        setActiveTab("history");
        await loadData();
      } catch (uploadError) {
        alert("La visita se guardó, pero no se pudieron subir todos los adjuntos: "+uploadError.message);
      }
    }
    setLoading(false);
  }

  async function saveQuickVisit(e) {
    e.preventDefault();
    setLoading(true);
    const payload = buildPayload({
      ...EMPTY_FORM,
      account_id:quickForm.account_id,
      product_id:quickForm.product_id,
      result:quickForm.result,
      next_action:quickForm.result,
      status:"borrador",
      is_draft:true,
    },profile?.id);
    const {error} = await supabase.from("visits").insert([payload]);
    if (error) alert("Error: "+error.message);
    else {
      setQuickOpen(false);
      setQuickForm({account_id:"",product_id:"",result:""});
      setActiveTab("history");
      await loadData();
    }
    setLoading(false);
  }

  async function createContact(targetForm,setTargetForm) {
    const account = accounts.find(item=>item.id===targetForm.account_id);
    if (!account) return;
    const name = prompt("Nombre completo del nuevo contacto");
    if (!name?.trim()) return;
    const role = prompt("Cargo o área del contacto (opcional)")||"";
    const contact = {name:name.trim(),role:role.trim(),area:"",phone:"",email:""};
    const contacts = [...(Array.isArray(account.contacts)?account.contacts:[]),contact];
    const {error} = await supabase.from("accounts").update({contacts}).eq("id",account.id);
    if (error) { alert("Error: "+error.message); return; }
    setAccounts(current=>current.map(item=>item.id===account.id?{...item,contacts}:item));
    setTargetForm({...targetForm,present_contacts:[...(targetForm.present_contacts||[]),contact],contact_name:""});
  }

  function startTimer(targetForm,setTargetForm) {
    const started_at = new Date().toISOString();
    localStorage.setItem("medicross_visit_timer",JSON.stringify({started_at}));
    setTargetForm({...targetForm,started_at,ended_at:"",duration_minutes:""});
  }

  function finishTimer(targetForm,setTargetForm) {
    if (!targetForm.started_at) return;
    const ended_at = new Date().toISOString();
    const duration_minutes = Math.max(1,Math.ceil((new Date(ended_at)-new Date(targetForm.started_at))/60000));
    localStorage.removeItem("medicross_visit_timer");
    setTargetForm({...targetForm,ended_at,duration_minutes});
  }

  function startEdit(v) {
    setEditingId(v.id);
    setEditForm({
      account_id:v.account_id||"", product_id:v.product_id||"", contact_name:v.contact_name||"",
      visit_type:v.visit_type||"presencial", visit_date:v.visit_date?.slice(0,10)||"",
      visit_time:v.visit_time||"", status:v.status||"programada", priority:v.priority||"media",
      business_unit:v.business_unit||"", pipeline_stage:v.pipeline_stage||"",
      objective:v.objective||"", notes:v.notes||"", result:v.result||"",
      objection:v.objection||"", next_step:v.next_step||"", next_action:v.next_action||"",
      next_action_date:v.next_action_date||"", followup_date:v.followup_date||"",
      commercial_potential:v.commercial_potential||"", materials:v.materials||[],
      present_contacts:Array.isArray(v.present_contacts)?v.present_contacts:[],
      attachments:Array.isArray(v.attachments)?v.attachments:[], pending_files:[],
      started_at:v.started_at||"", ended_at:v.ended_at||"",
      duration_minutes:v.duration_minutes||"", is_draft:Boolean(v.is_draft),
    });
  }
  function cancelEdit() { setEditingId(null); setEditForm(null); }

  async function saveEdit(id) {
    setLoading(true);
    try {
      const attachments = await uploadAttachments(id,editForm.attachments,editForm.pending_files);
      const {error} = await supabase.from("visits").update({...buildPayload(editForm,profile?.id),attachments}).eq("id",id);
      if (error) alert("Error: "+error.message);
      else { setEditingId(null); setEditForm(null); await loadData(); }
    } catch (error) { alert("Error: "+error.message); }
    setLoading(false);
  }

  async function deleteVisit(id) {
    if (!confirm("¿Eliminar esta visita?")) return;
    setDeletingId(id);
    const {error} = await supabase.from("visits").delete().eq("id",id);
    if (error) alert("Error: "+error.message);
    else await loadData();
    setDeletingId(null);
  }

  function openNewVisit(initial={}) {
    setForm({...EMPTY_FORM,materials:[],present_contacts:[],attachments:[],pending_files:[],...initial});
    setActiveTab("form");
    window.scrollTo({top:0,behavior:"smooth"});
  }

  useEffect(()=>{
    if (navigationData?.action === "create") openNewVisit({account_id:navigationData.accountId||""});
    if (navigationData?.action === "quick") {
      setQuickForm({account_id:navigationData.accountId||"",product_id:"",result:""});
      setQuickOpen(true);
    }
  },[navigationData,pageKey]);

  const stats = useMemo(()=>{
    const today = new Date().toISOString().slice(0,10);
    const requiresAttention = visits.filter(v=>{
      const alert = getFollowupAlert(v.visit_date,v.followup_date);
      return alert && ["overdue","today","urgent"].includes(alert.tone);
    }).length;
    return {
      total:      visits.length,
      programadas:visits.filter(v=>v.status==="programada").length,
      realizadas: visits.filter(v=>v.status==="realizada").length,
      pendientes: visits.filter(v=>v.status==="pendiente_informe").length,
      hoy:        visits.filter(v=>v.visit_date?.slice(0,10)===today).length,
      requiresAttention,
    };
  },[visits]);

  const filteredVisits = useMemo(()=>{
    const query = search.trim().toLowerCase();
    return visits.filter(v=>{
      const alert = getFollowupAlert(v.visit_date,v.followup_date);
      const matchesStatus = filterStatus==="todas" || v.status===filterStatus;
      const matchesAttention = !attentionOnly || (alert && ["overdue","today","urgent"].includes(alert.tone));
      const matchesQuery = !query || [
        v.accounts?.name,
        v.products?.name,
        v.products?.line,
        v.contact_name,
        v.business_unit,
        v.objective,
        v.next_action,
      ].some(value=>String(value||"").toLowerCase().includes(query));
      return matchesStatus && matchesAttention && matchesQuery;
    });
  },[attentionOnly,filterStatus,search,visits]);

  const statusInfo   = s => STATUS_OPTIONS.find(x=>x.value===s)||{label:s,color:"#94a3b8"};
  const priorityInfo = p => PRIORITY_OPTIONS.find(x=>x.value===p)||{label:p,color:"#94a3b8"};

  const FormComponent = isMobile ? VisitFormMobile : VisitForm;

  const kpiData = [
    {label:"Visitas registradas", value:stats.total,              accent:"blue",  sub:"historial comercial"},
    {label:"Agenda de hoy",       value:stats.hoy,                accent:"green", sub:"visitas programadas"},
    {label:"Pendientes informe",  value:stats.pendientes,         accent:"amber", sub:"visitas por cerrar"},
    {label:"Requieren atención",  value:stats.requiresAttention,  accent:"red",   sub:"seguimientos próximos"},
  ];

  return (
    <Layout title="Visitas Comerciales" profile={profile} onNavigate={onNavigate}>
      <div className="visits-page">

        <ModuleHeader
          title="Visitas Comerciales"
          subtitle="Historial operativo, próximos seguimientos y resultados de cada contacto comercial."
          actions={(
            <>
              <button className="visits-header-btn" type="button" onClick={loadData}>
                <RefreshCw size={16}/> Actualizar
              </button>
              <button className="visits-header-btn" type="button" onClick={() => onNavigate("calendar")}>
                <CalendarDays size={16}/> Calendario
              </button>
              <button className="visits-header-btn visits-header-btn--quick" type="button" onClick={() => setQuickOpen(true)}>
                <Zap size={16}/> Visita rápida
              </button>
              <button className="visits-header-btn visits-header-btn--primary" type="button" onClick={openNewVisit}>
                <CalendarPlus size={16}/> Nueva visita
              </button>
            </>
          )}
        />

        <section className="visits-kpi-grid">
          {kpiData.map(k => <MetricKpi key={k.label} {...k}/>)}
        </section>

        <section className={`visits-insight ${stats.requiresAttention ? "visits-insight--alert" : "visits-insight--ok"}`}>
          <div className="visits-insight__icon">
            {stats.requiresAttention ? <AlertTriangle size={19}/> : <ClipboardCheck size={19}/>}
          </div>
          <div>
            <span>Lectura operativa</span>
            <strong>{stats.requiresAttention ? "Hay seguimientos para resolver" : "Agenda de visitas bajo control"}</strong>
            <p>
              {stats.requiresAttention
                ? `${stats.requiresAttention} visita${stats.requiresAttention!==1?"s":""} con seguimiento vencido o próximo.`
                : `${stats.programadas} visita${stats.programadas!==1?"s":""} programada${stats.programadas!==1?"s":""} y ${stats.pendientes} informe${stats.pendientes!==1?"s":""} pendiente${stats.pendientes!==1?"s":""}.`}
            </p>
          </div>
          {stats.requiresAttention>0&&(
            <button type="button" className="visits-insight__action" onClick={()=>{setActiveTab("history");setAttentionOnly(true);}}>
              Ver seguimientos
            </button>
          )}
        </section>

        <div className="visits-tabs">
          <button className={`visits-tab ${activeTab==="form"?"active":""}`}
            onClick={openNewVisit}>
            <CalendarPlus size={15}/> Nueva visita
          </button>
          <button className={`visits-tab ${activeTab==="history"?"active":""}`}
            onClick={()=>setActiveTab("history")}>
            <History size={15}/> Historial ({visits.length})
          </button>
        </div>

        {/* TAB NUEVA VISITA */}
        {activeTab==="form" && (
          <section className="visits-panel">
            <header className="visits-panel__header">
              <div>
                <h2 className="visits-panel__title">Nueva visita</h2>
                <p className="visits-panel__sub">Completá los datos de la visita, el resultado y la próxima acción.</p>
              </div>
            </header>
            <form onSubmit={saveVisit}>
              <FormComponent f={form} setF={setForm} isEdit={false}
                accounts={accounts} products={products} loading={loading}
                onToggleMaterial={toggleMaterialNew}
                onCreateContact={createContact}
                elapsed={elapsed}
                onStartTimer={()=>startTimer(form,setForm)}
                onFinishTimer={()=>finishTimer(form,setForm)}/>
            </form>
          </section>
        )}

        {/* TAB HISTORIAL */}
        {activeTab==="history" && (
          <section className="visits-panel">
            <header className="visits-panel__header">
              <div>
                <h2 className="visits-panel__title">Actividad comercial reciente</h2>
                <p className="visits-panel__sub">{filteredVisits.length} visita{filteredVisits.length!==1?"s":""} en esta vista</p>
              </div>
            </header>

            <div className="visits-history-toolbar">
              <label className="visits-search">
                <Search size={16}/>
                <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar cliente, producto, unidad o próxima acción..."/>
              </label>
              <div className="visits-filter-tabs">
                {[
                  {key:"todas",             label:`Todas (${visits.length})`},
                  {key:"programada",        label:`Programadas (${stats.programadas})`},
                  {key:"realizada",         label:`Realizadas (${stats.realizadas})`},
                  {key:"pendiente_informe", label:`Pend. informe (${stats.pendientes})`},
                ].map(t=>(
                  <button key={t.key} className={`visits-filter-tab ${filterStatus===t.key?"active":""}`}
                    onClick={()=>setFilterStatus(t.key)}>{t.label}</button>
                ))}
                <button className={`visits-filter-tab ${attentionOnly?"active":""}`} onClick={()=>setAttentionOnly(value=>!value)}>
                  Seguimientos ({stats.requiresAttention})
                </button>
              </div>
            </div>

            <div className="visits-history">
              {filteredVisits.length===0 ? (
                <EmptyState
                  title="Sin visitas en esta vista"
                  text="Cambiá los filtros o registrá una nueva visita comercial."
                  action={<button className="visits-header-btn visits-header-btn--primary" type="button" onClick={openNewVisit}><CalendarPlus size={15}/> Nueva visita</button>}
                />
              ) : filteredVisits.map(v => {
                const alert    = getFollowupAlert(v.visit_date,v.followup_date);
                const timeline = getTimelineData(v.visit_date,v.followup_date);
                const si = statusInfo(v.status);
                const pi = priorityInfo(v.priority);
                return (
                  <article className={`visits-item ${alert?`visits-item--${alert.tone}`:""}`} key={v.id}>
                    {editingId===v.id ? (
                      <FormComponent f={editForm} setF={setEditForm} isEdit={true}
                        onSubmit={()=>saveEdit(v.id)} onCancel={cancelEdit}
                        accounts={accounts} products={products} loading={loading}
                        onToggleMaterial={toggleMaterialEdit}
                        onCreateContact={createContact}
                        elapsed={0}
                        onStartTimer={()=>startTimer(editForm,setEditForm)}
                        onFinishTimer={()=>finishTimer(editForm,setEditForm)}/>
                    ) : (
                      <>
                        {alert && (
                          <div className={`visits-alert visits-alert--${alert.tone}`}>
                            <span className="visits-alert__dot"/>{alert.label}
                          </div>
                        )}

                        <div className="visits-item__top">
                          <div className="visits-item__avatar">
                            {(v.accounts?.name||"?").slice(0,1).toUpperCase()}
                          </div>
                          <div className="visits-item__head">
                            <strong>{v.accounts?.name||"Sin cliente"}</strong>
                            <span>
                              {v.contact_name&&<em>{v.contact_name} · </em>}
                              {v.products?.name||"Sin producto"} · {VISIT_TYPES.find(t=>t.value===v.visit_type)?.label||v.visit_type}
                              {v.visit_time&&` · ${v.visit_time.slice(0,5)}`}
                            </span>
                          </div>
                          <div className="visits-item__badges">
                            <span className="visits-badge" style={{background:`${si.color}18`,color:si.color,borderColor:`${si.color}40`}}>{si.label}</span>
                            <span className="visits-badge" style={{background:`${pi.color}18`,color:pi.color,borderColor:`${pi.color}40`}}>{pi.label}</span>
                          </div>
                          <div className="visits-item__actions">
                            <button className="visits-action-btn visits-action-btn--edit" onClick={()=>startEdit(v)} title="Editar"><Pencil size={14}/></button>
                            <button className="visits-action-btn visits-action-btn--delete" onClick={()=>deleteVisit(v.id)} disabled={deletingId===v.id} title="Eliminar">
                              {deletingId===v.id?"…":<Trash2 size={14}/>}
                            </button>
                          </div>
                        </div>

                        <div className="visits-item__meta-row">
                          {v.business_unit&&<span className="visits-meta-chip">🏢 {v.business_unit}</span>}
                          {v.pipeline_stage&&<span className="visits-meta-chip">📊 {v.pipeline_stage}</span>}
                          {v.commercial_potential>0&&<span className="visits-meta-chip">💰 {money(v.commercial_potential)}</span>}
                          {v.visit_date&&<span className="visits-meta-chip">📅 {new Date(v.visit_date).toLocaleDateString("es-AR")}</span>}
                          {v.duration_minutes>0&&<span className="visits-meta-chip"><Timer size={13}/> {v.duration_minutes} min</span>}
                          {(v.attachments||[]).length>0&&<span className="visits-meta-chip"><Paperclip size={13}/> {v.attachments.length}</span>}
                        </div>

                        {v.objective&&(
                          <div className="visits-objective">
                            <span>Objetivo</span><p>{v.objective}</p>
                          </div>
                        )}

                        {timeline&&(
                          <div className="visits-timeline">
                            <div className="visits-timeline__labels">
                              <span>Visita: {v.visit_date?new Date(v.visit_date).toLocaleDateString("es-AR"):"—"}</span>
                              {v.followup_date&&<span>Seguimiento: {new Date(v.followup_date).toLocaleDateString("es-AR")}</span>}
                            </div>
                            {timeline.totalSpan!==null&&(
                              <>
                                <div className="visits-timeline__track">
                                  <div className={`visits-timeline__fill visits-timeline__fill--${alert?.tone||"ok"}`} style={{width:`${timeline.progress}%`}}/>
                                  <div className="visits-timeline__cursor" style={{left:`${timeline.progress}%`}}/>
                                </div>
                                <div className="visits-timeline__info">
                                  <span>{timeline.daysSinceVisit}d desde visita</span>
                                  <span>{timeline.totalSpan}d totales · {timeline.progress}%</span>
                                </div>
                              </>
                            )}
                            {timeline.totalSpan===null&&(
                              <div className="visits-timeline__info">
                                <span>{timeline.daysSinceVisit}d desde la visita · Sin seguimiento agendado</span>
                              </div>
                            )}
                          </div>
                        )}

                        {v.notes&&<p className="visits-item__notes">{v.notes}</p>}

                        {v.result&&(
                          <div className="visits-result">
                            <span>Resultado</span><p>{v.result}</p>
                          </div>
                        )}

                        <div className="visits-item__meta">
                          {(v.present_contacts||[]).map((contact,index)=>(
                            <span className="visits-tag" key={`${contact.email||contact.name}-${index}`}>👤 {contact.name}</span>
                          ))}
                          {v.next_action&&<span className="visits-tag">↗ {v.next_action}</span>}
                          {v.next_step&&<span className="visits-tag">📋 {v.next_step}</span>}
                          {v.objection&&<span className="visits-tag visits-tag--red">⚑ {v.objection}</span>}
                          {v.next_action_date&&<span className="visits-tag visits-tag--blue">🗓 Acción: {new Date(v.next_action_date).toLocaleDateString("es-AR")}</span>}
                          {(v.materials||[]).map(m=>(
                            <span className="visits-tag visits-tag--blue" key={m}>{MATERIAL_LABELS[m]||m}</span>
                          ))}
                        </div>
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {quickOpen&&(
          <div className="visits-modal-backdrop" role="presentation" onMouseDown={()=>setQuickOpen(false)}>
            <section className="visits-quick-modal" role="dialog" aria-modal="true" aria-labelledby="quick-visit-title" onMouseDown={event=>event.stopPropagation()}>
              <header>
                <div className="visits-quick-modal__icon"><Zap size={18}/></div>
                <div>
                  <span>Modo de campo</span>
                  <h2 id="quick-visit-title">Visita rápida</h2>
                  <p>Guardá lo esencial ahora y completá el informe después.</p>
                </div>
                <button type="button" className="visits-quick-modal__close" onClick={()=>setQuickOpen(false)} title="Cerrar"><X size={17}/></button>
              </header>
              <form onSubmit={saveQuickVisit}>
                <label>Cliente *
                  <select value={quickForm.account_id} onChange={event=>setQuickForm({...quickForm,account_id:event.target.value})} required>
                    <option value="">Seleccionar cliente</option>
                    {accounts.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}
                  </select>
                </label>
                <label>Producto *
                  <select value={quickForm.product_id} onChange={event=>setQuickForm({...quickForm,product_id:event.target.value})} required>
                    <option value="">Seleccionar producto</option>
                    {products.map(product=><option key={product.id} value={product.id}>{product.name}</option>)}
                  </select>
                </label>
                <label>Resultado / próxima acción *
                  <textarea value={quickForm.result} onChange={event=>setQuickForm({...quickForm,result:event.target.value})} placeholder="Ej: enviar cotización y llamar el martes..." required/>
                </label>
                <div className="visits-quick-modal__actions">
                  <button type="button" className="vf-btn vf-btn--cancel" onClick={()=>setQuickOpen(false)}>Cancelar</button>
                  <button className="vf-btn vf-btn--save" disabled={loading}>{loading?"Guardando...":"Guardar borrador"}</button>
                </div>
              </form>
            </section>
          </div>
        )}

        <footer className="visits-footer">
          <a href="https://www.linkedin.com/in/danieletchudez/" target="_blank" rel="noreferrer">Designed by Daniel Etchudez</a>
        </footer>

      </div>
    </Layout>
  );
}
