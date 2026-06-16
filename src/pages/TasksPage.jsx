import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import Layout from "../components/Layout";
import { EmptyState, MetricKpi, ModuleHeader } from "../components/CRMUI";
import "./tasks.css";

const STATUSES = ["pendiente", "en_progreso", "completada", "cancelada"];
const STATUS_LABEL = { pendiente: "Pendiente", en_progreso: "En progreso", completada: "Completada", cancelada: "Cancelada" };
const STATUS_COLOR = { pendiente: "blue", en_progreso: "amber", completada: "green", cancelada: "slate" };

const PRIORITIES = ["urgente", "alta", "media", "baja"];
const PRIO_LABEL  = { urgente: "Urgente", alta: "Alta", media: "Media", baja: "Baja" };
const PRIO_COLOR  = { urgente: "#ef4444", alta: "#f97316", media: "#3b82f6", baja: "#94a3b8" };
const PRIO_BG     = { urgente: "#fef2f2", alta: "#fff7ed", media: "#eff6ff", baja: "#f8fafc" };

const LINK_TYPES = [
  { key: "none",           label: "Sin vínculo" },
  { key: "account_id",     label: "🏥 Cliente / Cuenta" },
  { key: "opportunity_id", label: "🎯 Oportunidad" },
  { key: "tender_id",      label: "📋 Licitación" },
  { key: "campaign_id",    label: "📣 Campaña" },
];

const DAY = 86400000;
function daysUntil(d) {
  if (!d) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const date  = new Date(d); date.setHours(0,0,0,0);
  return Math.ceil((date - today) / DAY);
}
function dueBadge(due_date, status) {
  if (status === "completada" || status === "cancelada") return null;
  const d = daysUntil(due_date);
  if (d === null) return null;
  if (d < 0)   return { label: `Vencida ${Math.abs(d)}d`, cls: "red" };
  if (d === 0) return { label: "Hoy",                      cls: "amber" };
  if (d === 1) return { label: "Mañana",                   cls: "amber" };
  if (d <= 3)  return { label: `En ${d}d`,                 cls: "blue" };
  return null;
}

const EMPTY_FORM = {
  title: "", description: "", priority: "media", status: "pendiente",
  due_date: "", assigned_to: "",
  link_type: "none",
  account_id: "", opportunity_id: "", tender_id: "", campaign_id: "",
};

function linkLabel(task) {
  if (task.accounts)      return { icon: "🏥", text: task.accounts.name };
  if (task.opportunities) return { icon: "🎯", text: task.opportunities.name };
  if (task.tenders)       return { icon: "📋", text: task.tenders.institution || task.tenders.process_name };
  if (task.campaigns)     return { icon: "📣", text: task.campaigns.name };
  return null;
}

export default function TasksPage({ profile, onNavigate }) {
  const [tasks,        setTasks]        = useState([]);
  const [profiles,     setProfiles]     = useState([]);
  const [accounts,     setAccounts]     = useState([]);
  const [opportunities,setOpportunities]= useState([]);
  const [tenders,      setTenders]      = useState([]);
  const [campaigns,    setCampaigns]    = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [filter,       setFilter]       = useState("activas");
  const [prioFilter,   setPrioFilter]   = useState("");
  const [assignFilter, setAssignFilter] = useState("");
  const [search,       setSearch]       = useState("");
  const [showForm,     setShowForm]     = useState(false);
  const [editing,      setEditing]      = useState(null);
  const [form,         setForm]         = useState(EMPTY_FORM);
  const [saving,       setSaving]       = useState(false);
  const [toast,        setToast]        = useState("");

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [tasksRes, profilesRes, accountsRes, oppsRes, tendersRes, campaignsRes] = await Promise.all([
        supabase.from("tasks").select(`
          id, title, description, status, priority, due_date,
          assigned_to, created_by, account_id, opportunity_id, tender_id, campaign_id,
          completed_at, created_at, updated_at,
          profiles!tasks_assigned_to_fkey(id, full_name),
          accounts(id, name),
          opportunities(id, name),
          tenders(id, institution, process_name),
          campaigns(id, name)
        `).order("created_at", { ascending: false }),
        supabase.from("profiles").select("id, full_name").order("full_name"),
        supabase.from("accounts").select("id, name").order("name").limit(300),
        supabase.from("opportunities").select("id, name").order("name").limit(200),
        supabase.from("tenders").select("id, institution, process_name, process_number").order("created_at", { ascending: false }).limit(200),
        supabase.from("campaigns").select("id, name").order("name").limit(100),
      ]);
      setTasks(tasksRes.data || []);
      setProfiles(profilesRes.data || []);
      setAccounts(accountsRes.data || []);
      setOpportunities(oppsRes.data || []);
      setTenders(tendersRes.data || []);
      setCampaigns(campaignsRes.data || []);
    } catch (err) {
      console.error("Tasks load error:", err);
    } finally {
      setLoading(false);
    }
  }

  function showToastMsg(msg) { setToast(msg); setTimeout(() => setToast(""), 2800); }

  function detectLinkType(task) {
    if (task.campaign_id)     return "campaign_id";
    if (task.tender_id)       return "tender_id";
    if (task.opportunity_id)  return "opportunity_id";
    if (task.account_id)      return "account_id";
    return "none";
  }

  function openNew(preload = {}) {
    setEditing(null);
    setForm({ ...EMPTY_FORM, assigned_to: profile?.id || "", ...preload });
    setShowForm(true);
  }

  function openEdit(task) {
    setEditing(task.id);
    setForm({
      title:          task.title          || "",
      description:    task.description    || "",
      priority:       task.priority       || "media",
      status:         task.status         || "pendiente",
      due_date:       task.due_date       || "",
      assigned_to:    task.assigned_to    || "",
      link_type:      detectLinkType(task),
      account_id:     task.account_id     || "",
      opportunity_id: task.opportunity_id || "",
      tender_id:      task.tender_id      || "",
      campaign_id:    task.campaign_id    || "",
    });
    setShowForm(true);
  }

  function closeForm() { setShowForm(false); setEditing(null); }

  async function save() {
    if (!form.title.trim()) return;
    setSaving(true);
    const payload = {
      title:          form.title.trim(),
      description:    form.description.trim() || null,
      priority:       form.priority,
      status:         form.status,
      due_date:       form.due_date || null,
      assigned_to:    form.assigned_to || null,
      account_id:     form.link_type === "account_id"     ? form.account_id     || null : null,
      opportunity_id: form.link_type === "opportunity_id" ? form.opportunity_id || null : null,
      tender_id:      form.link_type === "tender_id"      ? form.tender_id      || null : null,
      campaign_id:    form.link_type === "campaign_id"    ? form.campaign_id    || null : null,
      completed_at:   form.status === "completada" ? new Date().toISOString() : null,
    };
    if (editing) {
      await supabase.from("tasks").update(payload).eq("id", editing);
      showToastMsg("Tarea actualizada");
    } else {
      payload.created_by = profile?.id || null;
      await supabase.from("tasks").insert([payload]);
      showToastMsg("Tarea creada");
    }
    setSaving(false);
    closeForm();
    load();
  }

  async function toggleComplete(task) {
    const isDone = task.status === "completada";
    const upd = { status: isDone ? "pendiente" : "completada", completed_at: isDone ? null : new Date().toISOString() };
    await supabase.from("tasks").update(upd).eq("id", task.id);
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, ...upd } : t));
  }

  async function deleteTask(id) {
    if (!window.confirm("¿Eliminar esta tarea?")) return;
    await supabase.from("tasks").delete().eq("id", id);
    setTasks(prev => prev.filter(t => t.id !== id));
    showToastMsg("Tarea eliminada");
  }

  const filtered = useMemo(() => {
    let list = tasks;
    if (filter === "activas")    list = list.filter(t => t.status === "pendiente" || t.status === "en_progreso");
    else if (filter !== "todas") list = list.filter(t => t.status === filter);
    if (prioFilter)    list = list.filter(t => t.priority === prioFilter);
    if (assignFilter)  list = list.filter(t => t.assigned_to === assignFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(t =>
        t.title?.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        t.accounts?.name?.toLowerCase().includes(q) ||
        t.tenders?.institution?.toLowerCase().includes(q) ||
        t.opportunities?.name?.toLowerCase().includes(q) ||
        t.campaigns?.name?.toLowerCase().includes(q)
      );
    }
    const pOrder = { urgente: 0, alta: 1, media: 2, baja: 3 };
    return [...list].sort((a, b) => {
      if (a.status === "completada" && b.status !== "completada") return 1;
      if (b.status === "completada" && a.status !== "completada") return -1;
      const pd = (pOrder[a.priority] ?? 2) - (pOrder[b.priority] ?? 2);
      if (pd !== 0) return pd;
      if (a.due_date && b.due_date) return new Date(a.due_date) - new Date(b.due_date);
      if (a.due_date) return -1; if (b.due_date) return 1;
      return 0;
    });
  }, [tasks, filter, prioFilter, assignFilter, search]);

  const kpis = useMemo(() => ({
    activas:     tasks.filter(t => t.status === "pendiente" || t.status === "en_progreso").length,
    vencidas:    tasks.filter(t => ["pendiente","en_progreso"].includes(t.status) && daysUntil(t.due_date) !== null && daysUntil(t.due_date) < 0).length,
    hoy:         tasks.filter(t => ["pendiente","en_progreso"].includes(t.status) && daysUntil(t.due_date) === 0).length,
    completadas: tasks.filter(t => t.status === "completada").length,
  }), [tasks]);

  const F = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Opciones del selector secundario según link_type
  const linkOptions = useMemo(() => {
    if (form.link_type === "account_id")     return accounts.map(a => ({ id: a.id, label: a.name }));
    if (form.link_type === "opportunity_id") return opportunities.map(o => ({ id: o.id, label: o.name }));
    if (form.link_type === "tender_id")      return tenders.map(t => ({ id: t.id, label: `${t.institution || t.process_name} ${t.process_number ? `(${t.process_number})` : ""}`.trim() }));
    if (form.link_type === "campaign_id")    return campaigns.map(c => ({ id: c.id, label: c.name }));
    return [];
  }, [form.link_type, accounts, opportunities, tenders, campaigns]);

  const linkValue = form[form.link_type] || "";

  return (
    <Layout title="Tareas" profile={profile} onNavigate={onNavigate}>
      <div className="tk-page">

        {toast && <div className="tk-toast">{toast}</div>}

        <ModuleHeader
          title="Tareas"
          subtitle={`${kpis.activas} activa${kpis.activas !== 1 ? "s" : ""} · ${tasks.length} en total`}
          actions={<button className="tk-btn tk-btn--primary" onClick={() => openNew()}>+ Nueva tarea</button>}
        />

        <section className="tk-kpis">
          <MetricKpi label="Activas"     value={loading ? "—" : kpis.activas} />
          <MetricKpi label="Vencidas"    value={loading ? "—" : kpis.vencidas}    accent="red"   />
          <MetricKpi label="Hoy"         value={loading ? "—" : kpis.hoy}         accent="amber" />
          <MetricKpi label="Completadas" value={loading ? "—" : kpis.completadas} accent="green" />
        </section>

        <div className="tk-filters">
          <div className="tk-status-tabs">
            {[
              { key: "activas",    label: "Activas"      },
              { key: "completada", label: "Completadas"  },
              { key: "cancelada",  label: "Canceladas"   },
              { key: "todas",      label: "Todas"        },
            ].map(s => (
              <button key={s.key} className={`tk-tab${filter === s.key ? " active" : ""}`} onClick={() => setFilter(s.key)}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="tk-filters-right">
            <select className="tk-select" value={prioFilter} onChange={e => setPrioFilter(e.target.value)}>
              <option value="">Todas las prioridades</option>
              {PRIORITIES.map(p => <option key={p} value={p}>{PRIO_LABEL[p]}</option>)}
            </select>
            <select className="tk-select" value={assignFilter} onChange={e => setAssignFilter(e.target.value)}>
              <option value="">Todos los responsables</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
            <input className="tk-search" placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        <div className="tk-list">
          {loading ? (
            <EmptyState title="Cargando tareas…" text="" />
          ) : filtered.length === 0 ? (
            <EmptyState
              title="Sin tareas"
              text={filter === "activas" ? "No hay tareas activas. Creá una para empezar." : "No hay tareas en esta categoría."}
              action={{ label: "+ Nueva tarea", onClick: () => openNew() }}
            />
          ) : filtered.map(task => {
            const due     = dueBadge(task.due_date, task.status);
            const done    = task.status === "completada";
            const pColor  = PRIO_COLOR[task.priority] || "#94a3b8";
            const link    = linkLabel(task);
            const initials = task.profiles?.full_name
              ? task.profiles.full_name.split(" ").slice(0,2).map(w=>w[0]).join("").toUpperCase()
              : null;

            return (
              <div key={task.id} className={`tk-item${done ? " tk-item--done" : ""}`} style={{ borderLeftColor: pColor }}>
                <button
                  className={`tk-check${done ? " tk-check--done" : ""}`}
                  onClick={() => toggleComplete(task)}
                  title={done ? "Marcar pendiente" : "Marcar completada"}
                >
                  {done && <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </button>

                <div className="tk-item__body" onClick={() => openEdit(task)}>
                  <div className="tk-item__title">{task.title}</div>
                  {task.description && <div className="tk-item__desc">{task.description}</div>}
                  <div className="tk-item__meta">
                    {link && <span className="tk-meta-tag tk-meta-tag--link">{link.icon} {link.text}</span>}
                    {task.due_date && (
                      <span className="tk-meta-tag">
                        📅 {new Date(task.due_date + "T00:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
                      </span>
                    )}
                    {due && <span className={`tk-due tk-due--${due.cls}`}>{due.label}</span>}
                  </div>
                </div>

                <div className="tk-item__right">
                  <span className="tk-prio-badge" style={{ color: pColor, background: PRIO_BG[task.priority] }}>
                    {PRIO_LABEL[task.priority]}
                  </span>
                  <span className={`tk-status-badge tk-status-badge--${STATUS_COLOR[task.status]}`}>
                    {STATUS_LABEL[task.status]}
                  </span>
                  {initials && <span className="tk-avatar" title={task.profiles?.full_name}>{initials}</span>}
                  <div className="tk-item__actions">
                    <button className="tk-action-btn" onClick={() => openEdit(task)} title="Editar">✎</button>
                    <button className="tk-action-btn tk-action-btn--del" onClick={() => deleteTask(task.id)} title="Eliminar">✕</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Drawer */}
      {showForm && (
        <div className="tk-overlay" onClick={e => e.target === e.currentTarget && closeForm()}>
          <div className="tk-drawer">
            <div className="tk-drawer__head">
              <h2>{editing ? "Editar tarea" : "Nueva tarea"}</h2>
              <button className="tk-drawer__close" onClick={closeForm}>✕</button>
            </div>

            <div className="tk-drawer__body">

              <div className="tk-field">
                <label>Título *</label>
                <input autoFocus value={form.title} onChange={e => F("title", e.target.value)} placeholder="¿Qué hay que hacer?" />
              </div>

              <div className="tk-field">
                <label>Descripción</label>
                <textarea rows={3} value={form.description} onChange={e => F("description", e.target.value)} placeholder="Detalles, contexto, pasos..." />
              </div>

              <div className="tk-field-row">
                <div className="tk-field">
                  <label>Prioridad</label>
                  <select value={form.priority} onChange={e => F("priority", e.target.value)}>
                    {PRIORITIES.map(p => <option key={p} value={p}>{PRIO_LABEL[p]}</option>)}
                  </select>
                </div>
                <div className="tk-field">
                  <label>Estado</label>
                  <select value={form.status} onChange={e => F("status", e.target.value)}>
                    {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </div>
              </div>

              <div className="tk-field-row">
                <div className="tk-field">
                  <label>Fecha límite</label>
                  <input type="date" value={form.due_date} onChange={e => F("due_date", e.target.value)} />
                </div>
                <div className="tk-field">
                  <label>Responsable</label>
                  <select value={form.assigned_to} onChange={e => F("assigned_to", e.target.value)}>
                    <option value="">Sin asignar</option>
                    {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                  </select>
                </div>
              </div>

              {/* Vínculo con CRM */}
              <div className="tk-field-section">
                <span className="tk-field-section__label">Vincular con el CRM</span>
              </div>

              <div className="tk-field">
                <label>Tipo de vínculo</label>
                <div className="tk-link-pills">
                  {LINK_TYPES.map(lt => (
                    <button
                      key={lt.key}
                      type="button"
                      className={`tk-link-pill${form.link_type === lt.key ? " active" : ""}`}
                      onClick={() => { F("link_type", lt.key); }}
                    >
                      {lt.label}
                    </button>
                  ))}
                </div>
              </div>

              {form.link_type !== "none" && (
                <div className="tk-field">
                  <label>{LINK_TYPES.find(l => l.key === form.link_type)?.label}</label>
                  <select
                    value={linkValue}
                    onChange={e => F(form.link_type, e.target.value)}
                  >
                    <option value="">Seleccionar…</option>
                    {linkOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                </div>
              )}

            </div>

            <div className="tk-drawer__foot">
              <button className="tk-btn tk-btn--ghost" onClick={closeForm}>Cancelar</button>
              <button className="tk-btn tk-btn--primary" onClick={save} disabled={saving || !form.title.trim()}>
                {saving ? "Guardando…" : editing ? "Guardar cambios" : "Crear tarea"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
