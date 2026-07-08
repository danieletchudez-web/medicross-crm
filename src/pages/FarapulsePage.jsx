import { useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, Calendar, ChevronRight,
  Package, PlusCircle, Search, Stethoscope, X, Zap,
  TrendingUp, Clock, FileText, DollarSign, BarChart2,
} from "lucide-react";
import Layout from "../components/Layout";
import { EmptyState, ModuleHeader } from "../components/CRMUI";
import { supabase } from "../lib/supabaseClient";
import "./farapulse.css";

// ─── Pipeline ────────────────────────────────────────────────
export const PIPELINE_STAGES = [
  { key: "lead",                label: "Lead",                color: "#64748b", step: 1  },
  { key: "oportunidad",         label: "Oportunidad",         color: "#6366f1", step: 2  },
  { key: "cotizacion_enviada",  label: "Cotización enviada",  color: "#3b82f6", step: 3  },
  { key: "negociacion",         label: "Negociación",         color: "#f59e0b", step: 4  },
  { key: "orden_compra",        label: "Orden de compra",     color: "#f97316", step: 5  },
  { key: "cirugia_programada",  label: "Cirugía programada",  color: "#8b5cf6", step: 6  },
  { key: "material_preparado",  label: "Material preparado",  color: "#06b6d4", step: 7  },
  { key: "material_entregado",  label: "Material entregado",  color: "#14b8a6", step: 8  },
  { key: "cirugia_realizada",   label: "Cirugía realizada",   color: "#22c55e", step: 9  },
  { key: "material_devuelto",   label: "Material devuelto",   color: "#84cc16", step: 10 },
  { key: "facturacion",         label: "Facturación",         color: "#eab308", step: 11 },
  { key: "cobranza",            label: "Cobranza",            color: "#f43f5e", step: 12 },
  { key: "cerrado",             label: "Cerrado",             color: "#10b981", step: 13 },
];

export const PRIORITY_CONFIG = {
  baja:    { label: "Baja",    color: "#64748b" },
  media:   { label: "Media",   color: "#3b82f6" },
  alta:    { label: "Alta",    color: "#f59e0b" },
  urgente: { label: "Urgente", color: "#ef4444" },
};

export const CHECKLIST_ITEMS = [
  { key: "oc_received",         label: "Orden de compra recibida",  required: true  },
  { key: "material_reserved",   label: "Material reservado",         required: true  },
  { key: "material_packed",     label: "Material embalado",          required: true  },
  { key: "material_shipped",    label: "Material despachado",        required: true  },
  { key: "instrumentador",      label: "Instrumentador confirmado",  required: true  },
  { key: "doctor_confirmed",    label: "Médico confirmado",          required: true  },
  { key: "hospital_confirmed",  label: "Hospital confirmado",        required: true  },
  { key: "logistics_confirmed", label: "Logística confirmada",       required: true  },
  { key: "equipment_available", label: "Equipo disponible",          required: false },
  { key: "equipment_tested",    label: "Equipo probado",             required: false },
  { key: "docs_sent",           label: "Documentación enviada",      required: false },
  { key: "consents",            label: "Consentimientos",            required: false },
];

export function stageFor(key) {
  return PIPELINE_STAGES.find(s => s.key === key) || PIPELINE_STAGES[0];
}

// ─── Helpers ─────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return null;
  return new Date(d + "T00:00:00").toLocaleDateString("es-AR", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function money(v) {
  const n = Number(v || 0);
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toLocaleString("es-AR")}`;
}

// ─── Empty form ───────────────────────────────────────────────
const EMPTY_FORM = {
  id: null, institution: "", account_id: "", doctor_name: "",
  electrophysiologist: "", buyer_name: "", patient_name: "",
  social_security: "", oc_number: "", quote_number: "",
  surgery_number: "", surgery_date: "", surgery_time: "",
  operating_room: "", city: "", province: "",
  seller_id: "", status: "lead", priority: "media", notes: "",
};

// ─── Component ────────────────────────────────────────────────
export default function FarapulsePage({ profile, onNavigate }) {
  const [procedures, setProcedures] = useState([]);
  const [accounts,   setAccounts]   = useState([]);
  const [sellers,    setSellers]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showForm,   setShowForm]   = useState(false);
  const [form,       setForm]       = useState(EMPTY_FORM);
  const [saving,     setSaving]     = useState(false);
  const [filter,     setFilter]     = useState("todas");
  const [search,     setSearch]     = useState("");

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [procRes, accRes, selRes] = await Promise.all([
        supabase
          .from("farapulse_procedures")
          .select("*, accounts(name)")
          .eq("deleted", false)
          .order("created_at", { ascending: false }),
        supabase.from("accounts").select("id, name").order("name"),
        supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
      ]);
      setProcedures(procRes.data || []);
      setAccounts(accRes.data   || []);
      setSellers(selRes.data    || []);
    } finally {
      setLoading(false);
    }
  }

  async function saveForm() {
    if (!form.institution) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      if (!form.id) {
        const { count } = await supabase
          .from("farapulse_procedures")
          .select("id", { count: "exact", head: true });
        const year = new Date().getFullYear();
        const code = `FP-${year}-${String((count || 0) + 1).padStart(3, "0")}`;
        const { data: newProc } = await supabase
          .from("farapulse_procedures")
          .insert([{ ...form, id: undefined, internal_code: code, created_by: profile.id, created_at: now, updated_at: now }])
          .select()
          .single();
        // Initialize checklist
        if (newProc?.id) {
          await supabase.from("farapulse_procedure_checklist").insert(
            CHECKLIST_ITEMS.map(item => ({
              procedure_id: newProc.id,
              item_key:     item.key,
              label:        item.label,
              is_required:  item.required,
              is_checked:   false,
            }))
          );
          // First timeline entry
          await supabase.from("farapulse_procedure_timeline").insert([{
            procedure_id: newProc.id,
            action:       "created",
            description:  `Procedimiento creado · Estado inicial: Lead`,
            user_id:      profile.id,
            user_name:    profile.full_name,
          }]);
        }
      } else {
        const { id, ...rest } = form;
        await supabase
          .from("farapulse_procedures")
          .update({ ...rest, updated_at: now })
          .eq("id", id);
      }
      setShowForm(false);
      setForm(EMPTY_FORM);
      await loadData();
    } finally {
      setSaving(false);
    }
  }

  function openNew() {
    setForm({ ...EMPTY_FORM, seller_id: profile.id });
    setShowForm(true);
  }

  function openDetail(proc) {
    onNavigate("farapulseDetail", { procedureId: proc.id });
  }

  const set = f => val => setForm(prev => ({ ...prev, [f]: val }));

  // ─── Filtered list ────────────────────────────────────────
  const filtered = useMemo(() => {
    return procedures.filter(p => {
      if (filter !== "todas" && p.status !== filter) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return [p.internal_code, p.institution, p.doctor_name,
              p.patient_name, p.oc_number, p.accounts?.name]
        .some(v => (v || "").toLowerCase().includes(q));
    });
  }, [procedures, filter, search]);

  // ─── KPIs ─────────────────────────────────────────────────
  const now        = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const kpis = {
    thisMonth:        procedures.filter(p => new Date(p.created_at) >= monthStart).length,
    scheduled:        procedures.filter(p => p.status === "cirugia_programada").length,
    pendingOC:        procedures.filter(p => ["lead","oportunidad","cotizacion_enviada","negociacion"].includes(p.status)).length,
    toInvoice:        procedures.filter(p => ["cirugia_realizada","material_devuelto"].includes(p.status)).length,
    pendingCollection:procedures.filter(p => ["facturacion","cobranza"].includes(p.status)).length,
    materialOut:      procedures.filter(p => p.status === "material_entregado").length,
  };

  // ─── Render ───────────────────────────────────────────────
  return (
    <Layout title="Procedimientos Farapulse" profile={profile} onNavigate={onNavigate}>
      <div className="fp-page">

        <ModuleHeader
          title="Gestión Integral Farapulse"
          subtitle="ERP operativo · ciclo completo de procedimientos"
          actions={
            <button className="fp-btn-primary" onClick={openNew}>
              <PlusCircle size={15} strokeWidth={2.2} />
              Nuevo procedimiento
            </button>
          }
        />

        {/* ── KPI row ───────────────────────────────────────── */}
        <div className="fp-kpi-row">
          {[
            { label: "Este mes",            value: kpis.thisMonth,         sub: "procedimientos",       icon: BarChart2,    cls: "" },
            { label: "Cirugías programadas",value: kpis.scheduled,         sub: "con fecha asignada",   icon: Calendar,     cls: "fp-kpi--blue" },
            { label: "Sin OC",              value: kpis.pendingOC,         sub: "esperando orden",      icon: FileText,     cls: "fp-kpi--amber" },
            { label: "A facturar",          value: kpis.toInvoice,         sub: "cirugías realizadas",  icon: DollarSign,   cls: "fp-kpi--purple" },
            { label: "Cobranza pendiente",  value: kpis.pendingCollection, sub: "facturas emitidas",    icon: TrendingUp,   cls: "fp-kpi--red" },
            { label: "Material en campo",   value: kpis.materialOut,       sub: "pendiente de retorno", icon: Package,      cls: "fp-kpi--teal" },
          ].map(k => (
            <div key={k.label} className={`fp-kpi ${k.cls}`}>
              <k.icon size={18} strokeWidth={1.8} className="fp-kpi__icon" />
              <strong className="fp-kpi__value">{k.value}</strong>
              <span className="fp-kpi__label">{k.label}</span>
              <small className="fp-kpi__sub">{k.sub}</small>
            </div>
          ))}
        </div>

        {/* ── Pipeline filter ───────────────────────────────── */}
        <div className="fp-pipeline-filter">
          <button
            className={`fp-pill${filter === "todas" ? " fp-pill--active" : ""}`}
            onClick={() => setFilter("todas")}
          >
            Todos ({procedures.length})
          </button>
          {PIPELINE_STAGES.map(s => {
            const cnt = procedures.filter(p => p.status === s.key).length;
            if (!cnt) return null;
            return (
              <button
                key={s.key}
                className={`fp-pill${filter === s.key ? " fp-pill--active" : ""}`}
                style={filter === s.key ? { "--pill-accent": s.color } : {}}
                onClick={() => setFilter(filter === s.key ? "todas" : s.key)}
              >
                <span className="fp-pill__dot" style={{ background: s.color }} />
                {s.label} ({cnt})
              </button>
            );
          })}
        </div>

        {/* ── Search bar ────────────────────────────────────── */}
        <div className="fp-toolbar">
          <div className="fp-search-box">
            <Search size={13} strokeWidth={2} />
            <input
              placeholder="Buscar por institución, médico, paciente, OC, código…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button className="fp-search-clear" onClick={() => setSearch("")}>
                <X size={12} />
              </button>
            )}
          </div>
          <span className="fp-count">{filtered.length} resultado{filtered.length !== 1 ? "s" : ""}</span>
        </div>

        {/* ── Table ─────────────────────────────────────────── */}
        {loading ? (
          <div className="fp-loading">
            <Activity size={20} className="fp-loading__icon" />
            Cargando procedimientos…
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title={search || filter !== "todas" ? "Sin resultados" : "Todavía no hay procedimientos"}
            text={search || filter !== "todas"
              ? "Probá ajustando los filtros o el texto de búsqueda."
              : "Creá el primer procedimiento Farapulse para comenzar."}
            action={
              !search && filter === "todas" && (
                <button className="fp-btn-primary" onClick={openNew}>
                  <PlusCircle size={14} /> Nuevo procedimiento
                </button>
              )
            }
          />
        ) : (
          <div className="fp-table-wrap">
            <table className="fp-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Institución / Paciente</th>
                  <th>Médico / Electrofisiólogo</th>
                  <th>Cirugía</th>
                  <th>Estado</th>
                  <th>Prioridad</th>
                  <th>OC</th>
                  <th>Vendedor</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const stage = stageFor(p.status);
                  const prio  = PRIORITY_CONFIG[p.priority] || PRIORITY_CONFIG.media;
                  const seller = sellers.find(s => s.id === p.seller_id);
                  return (
                    <tr key={p.id} className="fp-table__row" onClick={() => openDetail(p)}>
                      <td>
                        <span className="fp-code">{p.internal_code || "—"}</span>
                      </td>
                      <td>
                        <div className="fp-cell-main">{p.institution || p.accounts?.name || "—"}</div>
                        {p.patient_name && <div className="fp-cell-sub">{p.patient_name}</div>}
                      </td>
                      <td>
                        <div className="fp-cell-main">{p.doctor_name || "—"}</div>
                        {p.electrophysiologist && (
                          <div className="fp-cell-sub">{p.electrophysiologist}</div>
                        )}
                      </td>
                      <td>
                        {p.surgery_date
                          ? <span className="fp-date">{fmtDate(p.surgery_date)}</span>
                          : <span className="fp-na">Sin fecha</span>}
                      </td>
                      <td>
                        <span
                          className="fp-status-badge"
                          style={{ "--b-color": stage.color }}
                        >
                          {stage.label}
                        </span>
                      </td>
                      <td>
                        <span className="fp-prio" style={{ color: prio.color }}>
                          {prio.label}
                        </span>
                      </td>
                      <td>
                        <span className="fp-cell-main">{p.oc_number || <span className="fp-na">—</span>}</span>
                      </td>
                      <td>
                        <span className="fp-cell-sub">{seller?.full_name || "—"}</span>
                      </td>
                      <td>
                        <span className="fp-row-arrow"><ChevronRight size={15} /></span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── New/Edit Modal ────────────────────────────────── */}
        {showForm && (
          <div className="fp-modal-overlay" onClick={() => setShowForm(false)}>
            <div className="fp-modal" onClick={e => e.stopPropagation()}>
              <div className="fp-modal__hd">
                <div>
                  <h3>Nuevo procedimiento Farapulse</h3>
                  <p>Se generará automáticamente el código interno y el checklist.</p>
                </div>
                <button className="fp-modal__close" onClick={() => setShowForm(false)}>
                  <X size={18} />
                </button>
              </div>

              <div className="fp-modal__body">
                <fieldset className="fp-fieldset">
                  <legend>Institución y equipo médico</legend>
                  <div className="fp-form-grid">
                    <label className="fp-label">
                      <span>Institución *</span>
                      <input value={form.institution} onChange={e => set("institution")(e.target.value)} placeholder="Hospital / Clínica" />
                    </label>
                    <label className="fp-label">
                      <span>Cuenta vinculada</span>
                      <select value={form.account_id} onChange={e => set("account_id")(e.target.value)}>
                        <option value="">Sin cuenta</option>
                        {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    </label>
                    <label className="fp-label">
                      <span>Médico responsable</span>
                      <input value={form.doctor_name} onChange={e => set("doctor_name")(e.target.value)} placeholder="Dr. Apellido Nombre" />
                    </label>
                    <label className="fp-label">
                      <span>Electrofisiólogo</span>
                      <input value={form.electrophysiologist} onChange={e => set("electrophysiologist")(e.target.value)} placeholder="Nombre" />
                    </label>
                    <label className="fp-label">
                      <span>Comprador</span>
                      <input value={form.buyer_name} onChange={e => set("buyer_name")(e.target.value)} placeholder="Nombre del comprador" />
                    </label>
                    <label className="fp-label">
                      <span>Paciente</span>
                      <input value={form.patient_name} onChange={e => set("patient_name")(e.target.value)} placeholder="Opcional" />
                    </label>
                    <label className="fp-label">
                      <span>Obra Social</span>
                      <input value={form.social_security} onChange={e => set("social_security")(e.target.value)} placeholder="Nombre obra social" />
                    </label>
                  </div>
                </fieldset>

                <fieldset className="fp-fieldset">
                  <legend>Cirugía y lugar</legend>
                  <div className="fp-form-grid">
                    <label className="fp-label">
                      <span>Fecha de cirugía</span>
                      <input type="date" value={form.surgery_date} onChange={e => set("surgery_date")(e.target.value)} />
                    </label>
                    <label className="fp-label">
                      <span>Hora</span>
                      <input type="time" value={form.surgery_time} onChange={e => set("surgery_time")(e.target.value)} />
                    </label>
                    <label className="fp-label">
                      <span>Quirófano</span>
                      <input value={form.operating_room} onChange={e => set("operating_room")(e.target.value)} placeholder="Nro / nombre" />
                    </label>
                    <label className="fp-label">
                      <span>Ciudad</span>
                      <input value={form.city} onChange={e => set("city")(e.target.value)} placeholder="Ciudad" />
                    </label>
                    <label className="fp-label">
                      <span>Provincia</span>
                      <input value={form.province} onChange={e => set("province")(e.target.value)} placeholder="Provincia" />
                    </label>
                    <label className="fp-label">
                      <span>Número de OC</span>
                      <input value={form.oc_number} onChange={e => set("oc_number")(e.target.value)} placeholder="OC-000001" />
                    </label>
                    <label className="fp-label">
                      <span>Número de cotización</span>
                      <input value={form.quote_number} onChange={e => set("quote_number")(e.target.value)} placeholder="COT-000001" />
                    </label>
                  </div>
                </fieldset>

                <fieldset className="fp-fieldset">
                  <legend>Asignación y estado</legend>
                  <div className="fp-form-grid">
                    <label className="fp-label">
                      <span>Estado inicial</span>
                      <select value={form.status} onChange={e => set("status")(e.target.value)}>
                        {PIPELINE_STAGES.map(s => <option key={s.key} value={s.key}>{s.step}. {s.label}</option>)}
                      </select>
                    </label>
                    <label className="fp-label">
                      <span>Prioridad</span>
                      <select value={form.priority} onChange={e => set("priority")(e.target.value)}>
                        {Object.entries(PRIORITY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                    </label>
                    <label className="fp-label">
                      <span>Vendedor responsable</span>
                      <select value={form.seller_id} onChange={e => set("seller_id")(e.target.value)}>
                        <option value="">Sin asignar</option>
                        {sellers.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                      </select>
                    </label>
                    <label className="fp-label fp-label--full">
                      <span>Observaciones</span>
                      <textarea
                        value={form.notes}
                        onChange={e => set("notes")(e.target.value)}
                        rows={3}
                        placeholder="Notas generales sobre este procedimiento…"
                      />
                    </label>
                  </div>
                </fieldset>
              </div>

              <div className="fp-modal__ft">
                <button className="fp-btn-ghost" onClick={() => setShowForm(false)}>Cancelar</button>
                <button
                  className="fp-btn-primary"
                  onClick={saveForm}
                  disabled={saving || !form.institution}
                >
                  {saving ? "Creando…" : "Crear procedimiento"}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </Layout>
  );
}
