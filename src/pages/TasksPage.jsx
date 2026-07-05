import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import Layout from "../components/Layout";
import "./tasks.css";

// ─── Constants ────────────────────────────────────────────────────────────────
const STATUSES    = ["pendiente", "en_progreso", "completada", "cancelada"];
const STATUS_LABEL  = { pendiente: "Pendiente", en_progreso: "En progreso", completada: "Completada", cancelada: "Cancelada" };
const STATUS_ACCENT = { pendiente: "#3b82f6",   en_progreso: "#f59e0b",     completada: "#22c55e",    cancelada:  "#6b7280"  };

const PRIORITIES = ["urgente", "alta", "media", "baja"];
const PRIO_LABEL  = { urgente: "Urgente", alta: "Alta", media: "Media", baja: "Baja" };
const PRIO_ACCENT = { urgente: "#ef4444", alta: "#3b82f6", media: "#f59e0b", baja: "#6b7280" };
const PRIO_TAGCLS = { urgente: "tk2-tag--red", alta: "tk2-tag--blue", media: "tk2-tag--amber", baja: "tk2-tag--gray" };

const LINK_TYPES = [
  { key: "none",           label: "Sin vínculo" },
  { key: "account_id",     label: "🏥 Cliente" },
  { key: "opportunity_id", label: "🎯 Oportunidad" },
  { key: "tender_id",      label: "📋 Licitación" },
  { key: "campaign_id",    label: "📣 Campaña" },
];

const VIEWS = [
  { key: "lista",      label: "Lista" },
  { key: "dias",       label: "Días" },
  { key: "tablero",    label: "Tablero" },
  { key: "kanban",     label: "Kanban" },
  { key: "eisenhower", label: "Eisenhower" },
];

const EISENHOWER = [
  { key: "urgente", label: "HACER AHORA", sub: "Urgente · Importante",       accent: "#ef4444" },
  { key: "alta",    label: "PROGRAMAR",   sub: "No urgente · Importante",    accent: "#3b82f6" },
  { key: "media",   label: "DELEGAR",     sub: "Urgente · No importante",    accent: "#f59e0b" },
  { key: "baja",    label: "EVALUAR",     sub: "No urgente · No importante", accent: "#6b7280" },
];

const QA_PLACEHOLDERS = [
  "Reunión viernes 14h",
  "Comprar pan mañana 9h",
  "Llamar a cliente el lunes",
  "Revisar propuesta miércoles",
  "Enviar informe hoy 17h",
];

const DAY = 86400000;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function daysUntil(d) {
  if (!d) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const date  = new Date(d); date.setHours(0, 0, 0, 0);
  return Math.ceil((date - today) / DAY);
}

function fmtDate(d) {
  if (!d) return null;
  return new Date(d + "T00:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" });
}

function dueBadge(due_date, status) {
  if (status === "completada" || status === "cancelada") return null;
  const d = daysUntil(due_date);
  if (d === null) return null;
  if (d < 0)   return { label: `Vencida ${Math.abs(d)}d`, cls: "tk2-tag--red" };
  if (d === 0) return { label: "Hoy",                      cls: "tk2-tag--amber" };
  if (d === 1) return { label: "Mañana",                   cls: "tk2-tag--amber" };
  return null;
}

function linkOf(task, accounts, opportunities, tenders, campaigns) {
  if (task.account_id)     { const a = accounts.find(x => x.id === task.account_id);         return a ? { icon: "🏥", text: a.name } : null; }
  if (task.opportunity_id) { const o = opportunities.find(x => x.id === task.opportunity_id); return o ? { icon: "🎯", text: o.name } : null; }
  if (task.tender_id)      { const t = tenders.find(x => x.id === task.tender_id);            return t ? { icon: "📋", text: t.institution || t.process_name } : null; }
  if (task.campaign_id)    { const c = campaigns.find(x => x.id === task.campaign_id);        return c ? { icon: "📣", text: c.name } : null; }
  return null;
}

function detectLinkType(task) {
  if (task.campaign_id)    return "campaign_id";
  if (task.tender_id)      return "tender_id";
  if (task.opportunity_id) return "opportunity_id";
  if (task.account_id)     return "account_id";
  return "none";
}

const EMPTY_FORM = {
  title: "", description: "", priority: "media", status: "pendiente",
  due_date: "", assigned_to: "",
  link_type: "none",
  account_id: "", opportunity_id: "", tender_id: "", campaign_id: "",
};

// ─── Small components ─────────────────────────────────────────────────────────
function Checkbox({ done, onClick, disabled }) {
  return (
    <button
      className={`tk2-check${done ? " tk2-check--done" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={done ? "Marcar pendiente" : "Completar"}
    >
      {done && (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </button>
  );
}

function TaskRow({ task, onCheck, onEdit, link, isOwner }) {
  const done  = task.status === "completada";
  const due   = dueBadge(task.due_date, task.status);
  const accent = PRIO_ACCENT[task.priority] || "#6b7280";

  return (
    <div className={`tk2-row${done ? " tk2-row--done" : ""}`} style={{ "--row-accent": accent }}>
      <Checkbox done={done} onClick={onCheck} disabled={!isOwner} />
      <div className="tk2-row__body" onClick={isOwner ? onEdit : undefined} style={{ cursor: isOwner ? "pointer" : "default" }}>
        <span className={`tk2-row__title${done ? " tk2-row__title--strike" : ""}`}>{task.title}</span>
        <div className="tk2-row__tags">
          {link && <span className="tk2-tag tk2-tag--link">{link.icon} {link.text}</span>}
          {due   && <span className={`tk2-tag ${due.cls}`}>{due.label}</span>}
          <span className={`tk2-tag ${PRIO_TAGCLS[task.priority] || "tk2-tag--gray"}`}>
            {PRIO_LABEL[task.priority]}
          </span>
        </div>
      </div>
      {task.due_date && <span className="tk2-row__date">{fmtDate(task.due_date)}</span>}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function TasksPage({ profile, onNavigate }) {
  const [tasks,          setTasks]          = useState([]);
  const [profiles,       setProfiles]       = useState([]);
  const [accounts,       setAccounts]       = useState([]);
  const [opportunities,  setOpportunities]  = useState([]);
  const [tenders,        setTenders]        = useState([]);
  const [campaigns,      setCampaigns]      = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [filter,         setFilter]         = useState("activas");
  const [search,         setSearch]         = useState("");
  const [showForm,       setShowForm]       = useState(false);
  const [editing,        setEditing]        = useState(null);
  const [form,           setForm]           = useState(EMPTY_FORM);
  const [saving,         setSaving]         = useState(false);
  const [toast,          setToast]          = useState("");
  const [viewMode,       setViewMode]       = useState("lista");
  const [draggingId,     setDraggingId]     = useState(null);
  const [quickAdd,       setQuickAdd]       = useState("");
  const [qaIdx,          setQaIdx]          = useState(0);
  const [showFilter,     setShowFilter]     = useState(false);

  useEffect(() => {
    const id = setInterval(() => setQaIdx(i => (i + 1) % QA_PLACEHOLDERS.length), 3500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const ch = supabase.channel("tasks-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => load())
      .subscribe();
    return () => supabase.removeChannel(ch);
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

  function openNew(preload = {}) {
    setEditing(null);
    setForm({ ...EMPTY_FORM, assigned_to: profile?.id || "", ...preload });
    setShowForm(true);
  }

  function openEdit(task) {
    setEditing(task.id);
    setForm({
      title: task.title || "", description: task.description || "",
      priority: task.priority || "media", status: task.status || "pendiente",
      due_date: task.due_date || "", assigned_to: task.assigned_to || "",
      link_type: detectLinkType(task),
      account_id: task.account_id || "", opportunity_id: task.opportunity_id || "",
      tender_id: task.tender_id || "", campaign_id: task.campaign_id || "",
    });
    setShowForm(true);
  }

  function closeForm() { setShowForm(false); setEditing(null); }

  async function save() {
    if (!form.title.trim()) return;
    setSaving(true);
    const payload = {
      title: form.title.trim(), description: form.description.trim() || null,
      priority: form.priority, status: form.status, due_date: form.due_date || null,
      assigned_to: form.assigned_to || null,
      account_id:     form.link_type === "account_id"     ? form.account_id     || null : null,
      opportunity_id: form.link_type === "opportunity_id" ? form.opportunity_id || null : null,
      tender_id:      form.link_type === "tender_id"      ? form.tender_id      || null : null,
      campaign_id:    form.link_type === "campaign_id"    ? form.campaign_id    || null : null,
      completed_at: form.status === "completada" ? new Date().toISOString() : null,
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
      await load(); closeForm();
    } catch (err) {
      showToastMsg("No se pudo guardar la tarea");
    } finally {
      setSaving(false);
    }
  }

  async function delTask(id) {
    if (!window.confirm("¿Eliminar esta tarea?")) return;
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (!error) { await load(); showToastMsg("Tarea eliminada"); }
  }

  async function toggleComplete(task) {
    const isDone = task.status === "completada";
    const upd = { status: isDone ? "pendiente" : "completada", completed_at: isDone ? null : new Date().toISOString() };
    try {
      const { error } = await supabase.from("tasks").update(upd).eq("id", task.id);
      if (error) throw error;
      await load();
      showToastMsg(isDone ? "Marcada como pendiente" : "¡Tarea completada!");
    } catch(err) {
      console.error("[Tasks] toggleComplete error:", err);
      showToastMsg("No se pudo actualizar la tarea");
    }
  }

  async function handleDrop(targetStatus) {
    if (!draggingId) return;
    const task = tasks.find(t => t.id === draggingId);
    if (!task || task.status === targetStatus || task.created_by !== profile?.id) { setDraggingId(null); return; }
    setTasks(prev => prev.map(t => t.id === draggingId ? { ...t, status: targetStatus } : t));
    const { error } = await supabase.from("tasks").update({
      status: targetStatus, completed_at: targetStatus === "completada" ? new Date().toISOString() : null
    }).eq("id", draggingId);
    if (error) { setTasks(prev => prev.map(t => t.id === draggingId ? { ...t, status: task.status } : t)); showToastMsg("No se pudo mover"); }
    setDraggingId(null);
  }

  const [eisDropTarget, setEisDropTarget] = useState(null);

  async function handleEisDrop(targetPriority) {
    setEisDropTarget(null);
    if (!draggingId) return;
    const task = tasks.find(t => t.id === draggingId);
    if (!task || task.priority === targetPriority || task.created_by !== profile?.id) { setDraggingId(null); return; }
    setTasks(prev => prev.map(t => t.id === draggingId ? { ...t, priority: targetPriority } : t));
    const { error } = await supabase.from("tasks").update({ priority: targetPriority }).eq("id", draggingId);
    if (error) { setTasks(prev => prev.map(t => t.id === draggingId ? { ...t, priority: task.priority } : t)); showToastMsg("No se pudo mover"); }
    setDraggingId(null);
  }

  async function handleQuickAdd(e) {
    if (e.key !== "Enter" || e.isComposing || !quickAdd.trim()) return;
    const title = quickAdd.trim();
    setQuickAdd("");
    try {
      const { error } = await supabase.from("tasks").insert([{
        title, priority: "media", status: "pendiente", created_by: profile?.id || null,
      }]);
      if (error) throw error;
      await load();
      showToastMsg("Tarea creada");
    } catch(err) {
      console.error("[Tasks] handleQuickAdd error:", err);
      showToastMsg("No se pudo crear la tarea");
      setQuickAdd(title);
    }
  }

  const F = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const filtered = useMemo(() => {
    let list = tasks;
    if (filter === "activas")    list = list.filter(t => t.status === "pendiente" || t.status === "en_progreso");
    else if (filter !== "todas") list = list.filter(t => t.status === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(t => t.title?.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q));
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
  }, [tasks, filter, search]);

  const kpis = useMemo(() => {
    const active = t => ["pendiente","en_progreso"].includes(t.status);
    const d = t => daysUntil(t.due_date);
    return {
      activas:     tasks.filter(active).length,
      vencidas:    tasks.filter(t => active(t) && d(t) !== null && d(t) < 0).length,
      hoy:         tasks.filter(t => active(t) && d(t) === 0).length,
      completadas: tasks.filter(t => t.status === "completada").length,
    };
  }, [tasks]);

  // Date heading
  const now = new Date();
  const dayNum   = now.getDate();
  const month    = now.toLocaleDateString("es-AR", { month: "long" });
  const weekday  = now.toLocaleDateString("es-AR", { weekday: "long" });
  const dateStr  = `${weekday.charAt(0).toUpperCase() + weekday.slice(1)}, ${dayNum} ${month.charAt(0).toUpperCase() + month.slice(1)}`;

  // Link options for form
  const linkOptions = useMemo(() => {
    if (form.link_type === "account_id")     return accounts.map(a => ({ id: a.id, label: a.name }));
    if (form.link_type === "opportunity_id") return opportunities.map(o => ({ id: o.id, label: o.name }));
    if (form.link_type === "tender_id")      return tenders.map(t => ({ id: t.id, label: `${t.institution || t.process_name} ${t.process_number ? `(${t.process_number})` : ""}`.trim() }));
    if (form.link_type === "campaign_id")    return campaigns.map(c => ({ id: c.id, label: c.name }));
    return [];
  }, [form.link_type, accounts, opportunities, tenders, campaigns]);

  const linkValue = form[form.link_type] || "";

  // ── Views ──────────────────────────────────────────────────────────────────

  function renderLista() {
    if (loading) return <div className="tk2-empty">Cargando tareas…</div>;
    if (!filtered.length) return (
      <div className="tk2-empty">
        <p>Sin tareas en esta categoría</p>
        <button className="tk2-btn-new" onClick={() => openNew()}>+ Nueva tarea</button>
      </div>
    );
    return (
      <div className="tk2-list">
        {filtered.map(task => (
          <TaskRow
            key={task.id}
            task={task}
            onCheck={() => toggleComplete(task)}
            onEdit={() => openEdit(task)}
            link={linkOf(task, accounts, opportunities, tenders, campaigns)}
            isOwner={task.created_by === profile?.id}
          />
        ))}
      </div>
    );
  }

  function renderDias() {
    const groups = [
      { key: "vencidas",    label: "Vencidas",       tasks: filtered.filter(t => { const d = daysUntil(t.due_date); return d !== null && d < 0 && t.status !== "completada" && t.status !== "cancelada"; }) },
      { key: "hoy",         label: "Hoy",             tasks: filtered.filter(t => daysUntil(t.due_date) === 0 && t.status !== "completada" && t.status !== "cancelada") },
      { key: "manana",      label: "Mañana",          tasks: filtered.filter(t => daysUntil(t.due_date) === 1 && t.status !== "completada" && t.status !== "cancelada") },
      { key: "semana",      label: "Esta semana",     tasks: filtered.filter(t => { const d = daysUntil(t.due_date); return d !== null && d >= 2 && d <= 7 && t.status !== "completada" && t.status !== "cancelada"; }) },
      { key: "adelante",    label: "Más adelante",    tasks: filtered.filter(t => { const d = daysUntil(t.due_date); return d !== null && d > 7 && t.status !== "completada" && t.status !== "cancelada"; }) },
      { key: "sin_fecha",   label: "Sin fecha",       tasks: filtered.filter(t => !t.due_date && t.status !== "completada" && t.status !== "cancelada") },
      { key: "completadas", label: "Completadas",     tasks: filtered.filter(t => t.status === "completada") },
    ].filter(g => g.tasks.length > 0);

    if (loading) return <div className="tk2-empty">Cargando…</div>;
    if (!groups.length) return <div className="tk2-empty"><p>Sin tareas</p></div>;

    return (
      <div className="tk2-dias">
        {groups.map(g => (
          <div key={g.key} className="tk2-dias__group">
            <div className="tk2-dias__label">
              <span>{g.label}</span>
              <span className="tk2-dias__count">{g.tasks.length}</span>
            </div>
            <div className="tk2-list">
              {g.tasks.map(task => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onCheck={() => toggleComplete(task)}
                  onEdit={() => openEdit(task)}
                  link={linkOf(task, accounts, opportunities, tenders, campaigns)}
                  isOwner={task.created_by === profile?.id}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  function renderTablero() {
    return (
      <div className="tk2-tablero">
        <div className="tk2-kpis">
          {[
            { label: "Activas",     val: kpis.activas,     accent: "#3b82f6" },
            { label: "Vencidas",    val: kpis.vencidas,    accent: "#ef4444" },
            { label: "Hoy",         val: kpis.hoy,         accent: "#f59e0b" },
            { label: "Completadas", val: kpis.completadas, accent: "#22c55e" },
          ].map(k => (
            <div key={k.label} className="tk2-kpi" style={{ "--k-accent": k.accent }}>
              <span className="tk2-kpi__val">{loading ? "—" : k.val}</span>
              <span className="tk2-kpi__label">{k.label}</span>
            </div>
          ))}
        </div>
        {renderLista()}
      </div>
    );
  }

  function renderKanban() {
    return (
      <div className="tk2-kanban">
        {STATUSES.map(status => {
          const col = tasks.filter(t => t.status === status);
          const accent = STATUS_ACCENT[status] || "#6b7280";
          return (
            <div
              key={status}
              className="tk2-kanban-col"
              style={{ "--col-accent": accent }}
              onDragOver={e => e.preventDefault()}
              onDrop={() => handleDrop(status)}
            >
              <div className="tk2-kanban-hd">
                <span className="tk2-kanban-dot" />
                <span className="tk2-kanban-hd__title">{STATUS_LABEL[status]}</span>
                <span className="tk2-kanban-hd__count">{col.length}</span>
              </div>
              {col.length === 0 && <div className="tk2-kanban-empty">Sin tareas</div>}
              {col.map(task => {
                const isOwner = task.created_by === profile?.id;
                const link = linkOf(task, accounts, opportunities, tenders, campaigns);
                const due  = dueBadge(task.due_date, task.status);
                return (
                  <div
                    key={task.id}
                    className={`tk2-card${draggingId === task.id ? " tk2-card--dragging" : ""}`}
                    style={{ "--card-accent": PRIO_ACCENT[task.priority] || "#6b7280", cursor: isOwner ? "grab" : "default" }}
                    draggable={isOwner}
                    onDragStart={() => isOwner && setDraggingId(task.id)}
                    onDragEnd={() => setDraggingId(null)}
                    onClick={() => isOwner && openEdit(task)}
                  >
                    <div className="tk2-card__title">{task.title}</div>
                    <div className="tk2-card__tags">
                      <span className={`tk2-tag ${PRIO_TAGCLS[task.priority]}`}>{PRIO_LABEL[task.priority]}</span>
                      {link && <span className="tk2-tag tk2-tag--link">{link.icon}</span>}
                      {due  && <span className={`tk2-tag ${due.cls}`}>{due.label}</span>}
                    </div>
                    {task.due_date && (
                      <div className="tk2-card__footer">
                        <span className="tk2-card__date">{fmtDate(task.due_date)}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  }

  function renderEisenhower() {
    const allTasks = filter === "todas" ? tasks : tasks.filter(t => t.status !== "cancelada");
    return (
      <div className="tk2-eisenhower">
        {EISENHOWER.map(q => {
          const qTasks = allTasks.filter(t => t.priority === q.key);
          const isTarget = eisDropTarget === q.key && draggingId;
          return (
            <div
              key={q.key}
              className={`tk2-quadrant${isTarget ? " tk2-quadrant--drop-target" : ""}`}
              style={{ "--q-accent": q.accent }}
              onDragOver={e => { e.preventDefault(); setEisDropTarget(q.key); }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setEisDropTarget(null); }}
              onDrop={() => handleEisDrop(q.key)}
            >
              <div className="tk2-quadrant__hd">
                <span className="tk2-quadrant__label" style={{ color: q.accent }}>{q.label}</span>
                <span className="tk2-quadrant__count">{qTasks.length}</span>
              </div>
              <div className="tk2-quadrant__sub">{q.sub}</div>
              <div className="tk2-quadrant__list">
                {qTasks.length === 0 && <div className="tk2-quadrant__empty">Sin tareas · arrastrá aquí</div>}
                {qTasks.map(task => {
                  const done    = task.status === "completada";
                  const isOwner = task.created_by === profile?.id;
                  const link    = linkOf(task, accounts, opportunities, tenders, campaigns);
                  return (
                    <div
                      key={task.id}
                      className={`tk2-qtask${done ? " tk2-qtask--done" : ""}${draggingId === task.id ? " tk2-qtask--dragging" : ""}`}
                    >
                      {isOwner && (
                        <span
                          className="tk2-qtask__drag-handle"
                          draggable="true"
                          onDragStart={e => { setDraggingId(task.id); e.dataTransfer.effectAllowed = "move"; }}
                          onDragEnd={() => { setDraggingId(null); setEisDropTarget(null); }}
                          aria-label="Arrastrar tarea"
                          title="Arrastrar a otro cuadrante"
                        >⠿</span>
                      )}
                      <Checkbox done={done} onClick={() => toggleComplete(task)} disabled={!isOwner} />
                      <div className="tk2-qtask__body" onClick={() => isOwner && openEdit(task)} style={{ cursor: isOwner ? "pointer" : "default" }}>
                        <span className={`tk2-qtask__title${done ? " tk2-qtask__title--strike" : ""}`}>{task.title}</span>
                        <div className="tk2-qtask__tags">
                          {link && <span className="tk2-tag tk2-tag--link">{link.icon} {link.text}</span>}
                          {task.status === "en_progreso" && <span className="tk2-tag tk2-tag--amber">En curso</span>}
                        </div>
                      </div>
                      {task.due_date && (
                        <span className="tk2-qtask__time">{fmtDate(task.due_date)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
              {qTasks.length === 0 && (
                <button className="tk2-quadrant__add" onClick={() => openNew({ priority: q.key })}>+ Agregar</button>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <Layout title="Tareas" profile={profile} onNavigate={onNavigate}>
      <div className="tk2-page">

        {/* Toast */}
        {toast && (
          <div className="tk2-toast" role="status">
            <span>{toast}</span>
          </div>
        )}

        {/* Header */}
        <div className="tk2-header">
          <div className="tk2-header__left">
            <h1 className="tk2-date-str">{dateStr}</h1>
          </div>

          <div className="tk2-header__tabs">
            {VIEWS.map(v => (
              <button
                key={v.key}
                className={`tk2-tab${viewMode === v.key ? " tk2-tab--active" : ""}`}
                onClick={() => setViewMode(v.key)}
              >
                {v.label}
              </button>
            ))}
          </div>

          <div className="tk2-header__right">
            <button
              className={`tk2-icon-btn${showFilter ? " tk2-icon-btn--active" : ""}`}
              onClick={() => setShowFilter(f => !f)}
              title="Filtrar"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
              </svg>
            </button>
            <button className="tk2-btn-new" onClick={() => openNew()}>+ Nueva tarea</button>
          </div>
        </div>

        {/* Filter panel */}
        {showFilter && (
          <div className="tk2-filters">
            <div className="tk2-filters__pills">
              {[
                { key: "activas",    label: "Activas"     },
                { key: "completada", label: "Completadas" },
                { key: "cancelada",  label: "Canceladas"  },
                { key: "todas",      label: "Todas"       },
              ].map(s => (
                <button
                  key={s.key}
                  className={`tk2-fpill${filter === s.key ? " tk2-fpill--active" : ""}`}
                  onClick={() => setFilter(s.key)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <input
              className="tk2-search"
              placeholder="Buscar tarea…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        )}

        {/* View content */}
        <div className="tk2-content">
          {viewMode === "lista"      && renderLista()}
          {viewMode === "dias"       && renderDias()}
          {viewMode === "tablero"    && renderTablero()}
          {viewMode === "kanban"     && renderKanban()}
          {viewMode === "eisenhower" && renderEisenhower()}
        </div>

        {/* Quick-add bar */}
        <div className="tk2-quickadd">
          <input
            className="tk2-quickadd__input"
            placeholder={QA_PLACEHOLDERS[qaIdx]}
            value={quickAdd}
            onChange={e => setQuickAdd(e.target.value)}
            onKeyDown={handleQuickAdd}
          />
          <button
            className="tk2-quickadd__plus"
            onClick={() => openNew(quickAdd.trim() ? { title: quickAdd.trim() } : {})}
            title="Nueva tarea"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        </div>

      </div>

      {/* Task form modal / bottom sheet */}
      {showForm && (
        <div className="tk2-overlay" onClick={e => e.target === e.currentTarget && closeForm()}>
          <div className="tk2-modal">
            <div className="tk2-modal__handle" />
            <div className="tk2-modal__head">
              <h2>{editing ? "Editar tarea" : "Nueva tarea"}</h2>
              <button className="tk2-modal__close" onClick={closeForm} aria-label="Cerrar">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <div className="tk2-modal__body">
              <div className="tk2-field">
                <label>Título *</label>
                <input autoFocus value={form.title} onChange={e => F("title", e.target.value)} placeholder="¿Qué hay que hacer?" />
              </div>

              <div className="tk2-field">
                <label>Descripción</label>
                <textarea rows={2} value={form.description} onChange={e => F("description", e.target.value)} placeholder="Detalles o contexto…" />
              </div>

              <div className="tk2-field-row">
                <div className="tk2-field">
                  <label>Prioridad</label>
                  <select value={form.priority} onChange={e => F("priority", e.target.value)}>
                    {PRIORITIES.map(p => <option key={p} value={p}>{PRIO_LABEL[p]}</option>)}
                  </select>
                </div>
                <div className="tk2-field">
                  <label>Estado</label>
                  <select value={form.status} onChange={e => F("status", e.target.value)}>
                    {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </div>
              </div>

              <div className="tk2-field-row">
                <div className="tk2-field">
                  <label>Fecha límite</label>
                  <input type="date" value={form.due_date} onChange={e => F("due_date", e.target.value)} />
                </div>
                <div className="tk2-field">
                  <label>Responsable</label>
                  <select value={form.assigned_to} onChange={e => F("assigned_to", e.target.value)}>
                    <option value="">Sin asignar</option>
                    {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                  </select>
                </div>
              </div>

              <div className="tk2-field-sep">Vincular con CRM</div>

              <div className="tk2-field">
                <label>Tipo de vínculo</label>
                <div className="tk2-link-pills">
                  {LINK_TYPES.map(lt => (
                    <button
                      key={lt.key}
                      type="button"
                      className={`tk2-link-pill${form.link_type === lt.key ? " tk2-link-pill--active" : ""}`}
                      onClick={() => F("link_type", lt.key)}
                    >
                      {lt.label}
                    </button>
                  ))}
                </div>
              </div>

              {form.link_type !== "none" && (
                <div className="tk2-field">
                  <label>{LINK_TYPES.find(l => l.key === form.link_type)?.label}</label>
                  <select value={linkValue} onChange={e => F(form.link_type, e.target.value)}>
                    <option value="">Seleccionar…</option>
                    {linkOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                </div>
              )}
            </div>

            <div className="tk2-modal__foot">
              {editing && (
                <button className="tk2-modal-btn tk2-modal-btn--danger" onClick={() => { closeForm(); delTask(editing); }}>
                  Eliminar
                </button>
              )}
              <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <button className="tk2-modal-btn tk2-modal-btn--ghost" onClick={closeForm}>Cancelar</button>
                <button className="tk2-modal-btn tk2-modal-btn--primary" onClick={save} disabled={saving || !form.title.trim()}>
                  {saving ? "Guardando…" : editing ? "Guardar" : "Crear tarea"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
