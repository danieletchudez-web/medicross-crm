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

function linkLabel(task, accounts, opportunities, tenders, campaigns) {
  if (task.account_id) {
    const a = accounts.find(x => x.id === task.account_id);
    return a ? { icon: "🏥", text: a.name } : { icon: "🏥", text: "Cliente" };
  }
  if (task.opportunity_id) {
    const o = opportunities.find(x => x.id === task.opportunity_id);
    return o ? { icon: "🎯", text: o.name } : { icon: "🎯", text: "Oportunidad" };
  }
  if (task.tender_id) {
    const t = tenders.find(x => x.id === task.tender_id);
    return t ? { icon: "📋", text: t.institution || t.process_name } : { icon: "📋", text: "Licitación" };
  }
  if (task.campaign_id) {
    const c = campaigns.find(x => x.id === task.campaign_id);
    return c ? { icon: "📣", text: c.name } : { icon: "📣", text: "Campaña" };
  }
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
  const [viewMode,     setViewMode]     = useState("list");
  const [draggingId,   setDraggingId]   = useState(null);

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const channel = supabase
      .channel("tasks-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks" },
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [tasksRes, profilesRes, accountsRes, oppsRes, tendersRes, campaignsRes] = await Promise.all([
        supabase.from("tasks").select("*").order("created_at", { ascending: false }),
        supabase.from("profiles").select("id, full_name").order("full_name"),
        supabase.from("accounts").select("id, name").order("name").limit(300),
        supabase.from("opportunities").select("id, name").order("name").limit(200),
        supabase.from("tenders").select("id, institution, process_name, process_number").order("created_at", { ascending: false }).limit(200),
        supabase.from("campaigns").select("id, name").order("name").limit(100),
      ]);
      if (tasksRes.error) console.error("tasks query error:", tasksRes.error);
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

    try {
      if (editing) {
        const { error } = await supabase.from("tasks").update(payload).eq("id", editing);
        if (error) throw error;
        showToastMsg("Tarea actualizada");
      } else {
        payload.created_by = profile?.id || null;
        const { error } = await supabase.from("tasks").insert([payload]);
        if (error) throw error;
        showToastMsg("Tarea creada");
      }
      await load();
      closeForm();
    } catch (err) {
      console.error("Tasks save error:", err);
      showToastMsg("No se pudo guardar la tarea");
    } finally {
      setSaving(false);
    }
  }

  async function toggleComplete(task) {
    const isDone = task.status === "completada";
    const upd = { status: isDone ? "pendiente" : "completada", completed_at: isDone ? null : new Date().toISOString() };
    const { error } = await supabase.from("tasks").update(upd).eq("id", task.id);
    if (!error) {
      await load();
      showToastMsg(isDone ? "Tarea marcada como pendiente" : "Tarea completada");
    }
  }

  async function deleteTask(id) {
    if (!window.confirm("¿Eliminar esta tarea?")) return;
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (!error) {
      await load();
      showToastMsg("Tarea eliminada");
    }
  }

  async function handleDrop(targetStatus) {
    if (!draggingId) return;
    const task = tasks.find(t => t.id === draggingId);
    if (!task || task.status === targetStatus || task.created_by !== profile?.id) {
      setDraggingId(null);
      return;
    }
    setTasks(prev => prev.map(t => t.id === draggingId ? { ...t, status: targetStatus } : t));
    const upd = {
      status: targetStatus,
      completed_at: targetStatus === "completada" ? new Date().toISOString() : null,
    };
    const { error } = await supabase.from("tasks").update(upd).eq("id", draggingId);
    if (error) {
      setTasks(prev => prev.map(t => t.id === draggingId ? { ...t, status: task.status } : t));
      showToastMsg("No se pudo mover la tarea");
    }
    setDraggingId(null);
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

  const kpis = useMemo(() => {
    const active = t => ["pendiente","en_progreso"].includes(t.status);
    const d = t => daysUntil(t.due_date);
    return {
      activas:     tasks.filter(active).length,
      vencidas:    tasks.filter(t => active(t) && d(t) !== null && d(t) < 0).length,
      hoy:         tasks.filter(t => active(t) && d(t) === 0).length,
      manana:      tasks.filter(t => active(t) && d(t) === 1).length,
      en3dias:     tasks.filter(t => active(t) && d(t) !== null && d(t) >= 2 && d(t) <= 3).length,
      completadas: tasks.filter(t => t.status === "completada").length,
    };
  }, [tasks]);

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
      <div className="p-page">

        {toast && <div className="tk-toast">{toast}</div>}

        {/* Metrics Panel */}
        <div className="p-panel">
          <div className="p-hd">
            <div className="p-hd-left">
              <span className="p-title">Tareas</span>
              <span className="p-sub">{`${kpis.activas} activa${kpis.activas !== 1 ? "s" : ""} · ${tasks.length} en total`}</span>
            </div>
            <div className="p-hd-right">
              <button className="p-btn p-btn--primary" onClick={() => openNew()}>+ Nueva tarea</button>
            </div>
          </div>
          <div className="p-metrics">
            <div className="p-metric">
              <span className="p-metric__ey">Pendientes</span>
              <span className="p-metric__val">{loading ? "—" : tasks.filter(t => t.status === "pendiente").length}</span>
              <span className="p-metric__sub">sin iniciar</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">En Progreso</span>
              <span className="p-metric__val">{loading ? "—" : tasks.filter(t => t.status === "en_progreso").length}</span>
              <span className="p-metric__sub">activas</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Vencidas</span>
              <span className="p-metric__val p-metric__down">{loading ? "—" : kpis.vencidas}</span>
              <span className="p-metric__sub">requieren atención</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Completadas</span>
              <span className="p-metric__val p-metric__up">{loading ? "—" : kpis.completadas}</span>
              <span className="p-metric__sub">finalizadas</span>
            </div>
          </div>
        </div>

        {/* Filter Bar Panel */}
        <div className="p-panel">
          <div className="p-toolbar--top">
            <div className="p-pills">
              {[
                { key: "activas",    label: "Activas"     },
                { key: "completada", label: "Completadas" },
                { key: "cancelada",  label: "Canceladas"  },
                { key: "todas",      label: "Todas"       },
              ].map(s => (
                <button
                  key={s.key}
                  className={`p-pill${filter === s.key ? " p-pill--active" : ""}`}
                  onClick={() => setFilter(s.key)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto" }}>
              <input
                className="p-search"
                placeholder="Buscar..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <select className="p-select" value={prioFilter} onChange={e => setPrioFilter(e.target.value)}>
                <option value="">Todas las prioridades</option>
                {PRIORITIES.map(p => <option key={p} value={p}>{PRIO_LABEL[p]}</option>)}
              </select>
              <select className="p-select" value={assignFilter} onChange={e => setAssignFilter(e.target.value)}>
                <option value="">Todos los responsables</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Alerts strip */}
        {!loading && (kpis.vencidas > 0 || kpis.hoy > 0 || kpis.manana > 0 || kpis.en3dias > 0) && (
          <div className="tk-due-alerts">
            {kpis.vencidas > 0 && (
              <div className="tk-due-alert tk-due-alert--red">
                <span className="tk-due-alert__icon">⚠️</span>
                <span><strong>{kpis.vencidas}</strong> tarea{kpis.vencidas !== 1 ? "s" : ""} vencida{kpis.vencidas !== 1 ? "s" : ""}</span>
              </div>
            )}
            {kpis.hoy > 0 && (
              <div className="tk-due-alert tk-due-alert--amber">
                <span className="tk-due-alert__icon">🔔</span>
                <span><strong>{kpis.hoy}</strong> vence{kpis.hoy !== 1 ? "n" : ""} hoy</span>
              </div>
            )}
            {kpis.manana > 0 && (
              <div className="tk-due-alert tk-due-alert--orange">
                <span className="tk-due-alert__icon">⏰</span>
                <span><strong>{kpis.manana}</strong> vence{kpis.manana !== 1 ? "n" : ""} mañana</span>
              </div>
            )}
            {kpis.en3dias > 0 && (
              <div className="tk-due-alert tk-due-alert--blue">
                <span className="tk-due-alert__icon">📅</span>
                <span><strong>{kpis.en3dias}</strong> vence{kpis.en3dias !== 1 ? "n" : ""} en 3 días</span>
              </div>
            )}
          </div>
        )}

        {/* Main Content Panel */}
        <div className="p-panel p-panel--grow">
          <div className="p-hd">
            <div className="p-hd-left">
              <div className="p-tabs">
                <button
                  className={`p-tab${viewMode === "list" ? " p-tab--active" : ""}`}
                  onClick={() => setViewMode("list")}
                >
                  ☰ Lista
                </button>
                <button
                  className={`p-tab${viewMode === "kanban" ? " p-tab--active" : ""}`}
                  onClick={() => setViewMode("kanban")}
                >
                  ⊞ Kanban
                </button>
              </div>
            </div>
          </div>

          {/* Kanban View */}
          {viewMode === "kanban" && (
            <div className="p-body">
              <div className="p-kanban">
                {STATUSES.map(status => {
                  const colTasks = tasks.filter(t => t.status === status);
                  return (
                    <div
                      key={status}
                      className="p-kanban-col"
                      onDragOver={e => e.preventDefault()}
                      onDrop={() => handleDrop(status)}
                    >
                      <div className="p-kanban-hd">
                        <span className={`p-dot--${STATUS_COLOR[status]}`} />
                        <span>{STATUS_LABEL[status]}</span>
                        <span className="p-sub" style={{ marginLeft: "auto" }}>{colTasks.length}</span>
                      </div>
                      {colTasks.length === 0 && (
                        <div className="p-empty">Sin tareas</div>
                      )}
                      {colTasks.map(task => {
                        const due      = dueBadge(task.due_date, task.status);
                        const pColor   = PRIO_COLOR[task.priority] || "#94a3b8";
                        const link     = linkLabel(task, accounts, opportunities, tenders, campaigns);
                        const assignee = profiles.find(p => p.id === task.assigned_to);
                        const initials = assignee?.full_name
                          ? assignee.full_name.split(" ").slice(0,2).map(w=>w[0]).join("").toUpperCase()
                          : null;
                        const isOwner   = task.created_by === profile?.id;
                        const daysDue   = daysUntil(task.due_date);
                        const isOverdue = !["completada","cancelada"].includes(task.status) && daysDue !== null && daysDue < 0;
                        const isDueToday = !["completada","cancelada"].includes(task.status) && daysDue === 0;

                        return (
                          <div
                            key={task.id}
                            className={`p-kanban-card${isOverdue ? " tk-kanban-card--overdue" : ""}${isDueToday ? " tk-kanban-card--today" : ""}${draggingId === task.id ? " tk-kanban-card--dragging" : ""}`}
                            draggable={isOwner}
                            onDragStart={() => isOwner && setDraggingId(task.id)}
                            onDragEnd={() => setDraggingId(null)}
                            style={{ borderLeftColor: pColor, cursor: isOwner ? "grab" : "default" }}
                            onClick={() => isOwner && openEdit(task)}
                          >
                            <div className="tk-kanban-card__title">{task.title}</div>
                            <div className="tk-kanban-card__meta">
                              <span className={`p-badge--${task.priority === "urgente" || task.priority === "alta" ? "red" : task.priority === "media" ? "amber" : "gray"}`}>
                                {PRIO_LABEL[task.priority]}
                              </span>
                              {link && <span className="tk-meta-tag tk-meta-tag--link">{link.icon} {link.text}</span>}
                            </div>
                            <div className="tk-kanban-card__footer">
                              {task.due_date && (
                                <span className="tk-meta-tag" style={{ fontSize: 11 }}>
                                  📅 {new Date(task.due_date + "T00:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
                                </span>
                              )}
                              {due && <span className={`p-badge--${due.cls}`}>{due.label}</span>}
                              {initials && (
                                <span className="p-avatar" style={{ marginLeft: "auto" }} title={assignee?.full_name}>
                                  {initials}
                                </span>
                              )}
                            </div>
                            {!isOwner && <div className="tk-kanban-card__lock" title="Solo el creador puede mover esta tarea">🔒</div>}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* List View */}
          {viewMode === "list" && (
            <div className="p-list">
              {loading ? (
                <div className="p-empty">Cargando tareas…</div>
              ) : filtered.length === 0 ? (
                <div className="p-empty">
                  <div style={{ marginBottom: 8 }}>Sin tareas</div>
                  <div style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>
                    {filter === "activas" ? "No hay tareas activas. Creá una para empezar." : "No hay tareas en esta categoría."}
                  </div>
                  <button className="p-btn p-btn--primary" onClick={() => openNew()}>+ Nueva tarea</button>
                </div>
              ) : filtered.map(task => {
                const due      = dueBadge(task.due_date, task.status);
                const done     = task.status === "completada";
                const pColor   = PRIO_COLOR[task.priority] || "#94a3b8";
                const link     = linkLabel(task, accounts, opportunities, tenders, campaigns);
                const assignee = profiles.find(p => p.id === task.assigned_to);
                const initials = assignee?.full_name
                  ? assignee.full_name.split(" ").slice(0,2).map(w=>w[0]).join("").toUpperCase()
                  : null;
                const assigneeName = assignee?.full_name || null;
                const isOwner  = task.created_by === profile?.id;
                const daysDue  = daysUntil(task.due_date);

                return (
                  <div key={task.id} className="p-row" style={{ borderLeftColor: pColor, borderLeftWidth: 3, borderLeftStyle: "solid" }}>
                    <div className="p-row__rank">
                      <button
                        className={`tk-check${done ? " tk-check--done" : ""}`}
                        onClick={() => isOwner && toggleComplete(task)}
                        title={!isOwner ? "Solo el creador puede modificar esta tarea" : done ? "Marcar pendiente" : "Marcar completada"}
                        style={!isOwner ? { cursor: "default", opacity: 0.4 } : {}}
                      >
                        {done && <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </button>
                    </div>

                    <div className="p-row__main" onClick={() => isOwner && openEdit(task)} style={!isOwner ? { cursor: "default" } : { cursor: "pointer" }}>
                      <div className="p-row__name" style={{ textDecoration: done ? "line-through" : "none", opacity: done ? 0.5 : 1 }}>
                        {task.title}
                      </div>
                      <div className="p-row__sub">
                        {link && <span style={{ marginRight: 8 }}>{link.icon} {link.text}</span>}
                        {task.due_date && (
                          <span style={{ marginRight: 8 }}>
                            📅 {new Date(task.due_date + "T00:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
                          </span>
                        )}
                        {due && <span className={`p-badge--${due.cls}`} style={{ marginRight: 8 }}>{due.label}</span>}
                      </div>
                    </div>

                    <div className="p-row__meta">
                      <span className={`p-badge--${task.priority === "urgente" || task.priority === "alta" ? "red" : task.priority === "media" ? "amber" : "gray"}`}>
                        {PRIO_LABEL[task.priority]}
                      </span>
                      <span className={`p-badge--${STATUS_COLOR[task.status]}`} style={{ marginLeft: 6 }}>
                        {STATUS_LABEL[task.status]}
                      </span>
                      {initials && (
                        <span className="p-avatar" style={{ marginLeft: 8 }} title={assigneeName}>{initials}</span>
                      )}
                      {isOwner && (
                        <div className="p-row__actions">
                          <button className="p-icon-btn" onClick={() => openEdit(task)} title="Editar">✎</button>
                          <button className="p-icon-btn p-icon-btn--del" onClick={() => deleteTask(task.id)} title="Eliminar">✕</button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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
              <button className="p-btn p-btn--ghost" onClick={closeForm}>Cancelar</button>
              <button className="p-btn p-btn--primary" onClick={save} disabled={saving || !form.title.trim()}>
                {saving ? "Guardando…" : editing ? "Guardar cambios" : "Crear tarea"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
