import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import Layout from "../components/Layout";
import { canOpenModule } from "../lib/moduleAccess";
import "./habits.css";

// ─── Constants ────────────────────────────────────────────────────────────────

const HABIT_COLORS = [
  "#ffffff", "#ef4444", "#f97316", "#eab308",
  "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899",
  "#14b8a6", "#6b7280",
];

const FREQ_OPTIONS = [
  { value: "daily",    label: "Todos los días" },
  { value: "weekdays", label: "Días de semana" },
  { value: "weekend",  label: "Fines de semana" },
  { value: "custom",   label: "Personalizado" },
];

const TYPES = [
  { value: "habit", label: "Hábito",  desc: "Se repite en días fijos o varias veces por semana o mes" },
  { value: "task",  label: "Tarea",   desc: "Una tarea normal, con lista, fecha y prioridad" },
  { value: "study", label: "Estudio", desc: "Un tema de una materia. Sin objetivo" },
];

const PRIORITIES = [
  { value: "none", label: "Ninguna" },
  { value: "alta", label: "Alta" },
  { value: "media", label: "Media" },
  { value: "baja", label: "Baja" },
];

const DOW_LABELS = ["L", "M", "X", "J", "V", "S", "D"];
const WEEK_RANGES = [[1, 7], [8, 14], [15, 21], [22, 28], [29, 37]];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mkDateStr(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function todayStr() {
  const d = new Date();
  return mkDateStr(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function buildMiniCal(year, month) {
  const total    = daysInMonth(year, month);
  const firstDow = new Date(year, month, 1).getDay();
  const offset   = (firstDow + 6) % 7; // Mon=0…Sun=6
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function emptyForm() {
  return {
    title: "", description: "", type: "habit",
    color: "#22c55e", frequency: "daily",
    time_enabled: false, habit_time: "",
    date_enabled: false, habit_date: "",
    priority: "none", category: "",
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function HabitsPage({ profile, onNavigate }) {
  const userId   = profile?.id;
  const hasAccess = profile?.role === "super_admin" || canOpenModule(profile, "habits");

  const [habits,      setHabits]      = useState([]);
  const [completions, setCompletions] = useState([]);
  const [viewMonth,   setViewMonth]   = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() };
  });
  const [activeWeek,  setActiveWeek]  = useState(() => {
    const day = new Date().getDate();
    return WEEK_RANGES.findIndex(([s, e]) => day >= s && day <= e);
  });
  const [loading,      setLoading]     = useState(true);
  const [dbError,      setDbError]     = useState(null);
  const [toast,        setToast]       = useState(null);
  const [showModal,    setShowModal]   = useState(false);
  const [editingHabit, setEditingHabit]= useState(null);
  const [form,         setForm]        = useState(emptyForm);
  const [toggling,     setToggling]    = useState(() => new Set());
  const titleRef  = useRef(null);
  const toastTimer = useRef(null);

  const { year, month } = viewMonth;
  const totalDays  = useMemo(() => daysInMonth(year, month), [year, month]);
  const today      = useMemo(todayStr, []);

  const currentDay = useMemo(() => {
    const n = new Date();
    return (n.getFullYear() === year && n.getMonth() === month) ? n.getDate() : null;
  }, [year, month]);

  const monthDays = useMemo(
    () => Array.from({ length: totalDays }, (_, i) => i + 1),
    [totalDays]
  );

  const weeks = useMemo(
    () => WEEK_RANGES
      .map(([s, e]) => monthDays.filter(d => d >= s && d <= Math.min(e, totalDays)))
      .filter(w => w.length > 0),
    [monthDays, totalDays]
  );

  const miniCalCells = useMemo(() => buildMiniCal(year, month), [year, month]);

  // Completion Set for O(1) lookups
  const completionSet = useMemo(
    () => new Set(completions.map(c => `${c.habit_id}|${c.completed_date}`)),
    [completions]
  );

  const isCompleted = useCallback(
    (habitId, day) => completionSet.has(`${habitId}|${mkDateStr(year, month, day)}`),
    [completionSet, year, month]
  );

  const isFuture = useCallback(
    (day) => mkDateStr(year, month, day) > today,
    [year, month, today]
  );

  // ── Data loading ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!userId || !hasAccess) { setLoading(false); return; }
    loadData();
  }, [userId, year, month, hasAccess]);

  function showToast(msg, type = "success") {
    setToast({ msg, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }

  async function loadData() {
    setLoading(true);
    setDbError(null);
    const startDate = mkDateStr(year, month, 1);
    const endDate   = mkDateStr(year, month, totalDays);
    const [habitsRes, compsRes] = await Promise.all([
      supabase.from("habits").select("*").eq("user_id", userId)
        .order("sort_order", { ascending: true })
        .order("created_at",  { ascending: true }),
      supabase.from("habit_completions").select("habit_id, completed_date")
        .eq("user_id", userId)
        .gte("completed_date", startDate)
        .lte("completed_date", endDate),
    ]);
    if (habitsRes.error) {
      const isTableMissing = /relation|does not exist|42P01/i.test(
        habitsRes.error.message || habitsRes.error.code || ""
      );
      setDbError(isTableMissing
        ? "Las tablas de Hábitos no existen en Supabase aún. Ejecutá las migraciones SQL desde el panel de Supabase."
        : `Error al cargar hábitos: ${habitsRes.error.message}`
      );
      setLoading(false);
      return;
    }
    setHabits(habitsRes.data || []);
    setCompletions(compsRes.data || []);
    setLoading(false);
  }

  // ── Toggle completion ─────────────────────────────────────────────────────

  async function toggleCompletion(habit, day) {
    if (isFuture(day)) return;
    const d   = mkDateStr(year, month, day);
    const key = `${habit.id}|${d}`;
    if (toggling.has(key)) return;

    setToggling(prev => { const n = new Set(prev); n.add(key); return n; });
    const wasDone = completionSet.has(key);

    setCompletions(prev =>
      wasDone
        ? prev.filter(c => !(c.habit_id === habit.id && c.completed_date === d))
        : [...prev, { habit_id: habit.id, completed_date: d }]
    );

    try {
      if (wasDone) {
        await supabase.from("habit_completions").delete()
          .eq("habit_id", habit.id).eq("user_id", userId).eq("completed_date", d);
      } else {
        await supabase.from("habit_completions")
          .insert({ habit_id: habit.id, user_id: userId, completed_date: d });
      }
    } catch {
      setCompletions(prev =>
        wasDone
          ? [...prev, { habit_id: habit.id, completed_date: d }]
          : prev.filter(c => !(c.habit_id === habit.id && c.completed_date === d))
      );
    }

    setToggling(prev => { const n = new Set(prev); n.delete(key); return n; });
  }

  // ── Modal helpers ─────────────────────────────────────────────────────────

  function openAdd() {
    setEditingHabit(null);
    setForm(emptyForm());
    setShowModal(true);
    setTimeout(() => titleRef.current?.focus(), 60);
  }

  function openEdit(habit) {
    setEditingHabit(habit);
    setForm({
      title:        habit.title        || "",
      description:  habit.description  || "",
      type:         habit.type         || "habit",
      color:        habit.color        || "#22c55e",
      frequency:    habit.frequency    || "daily",
      time_enabled: habit.time_enabled || false,
      habit_time:   habit.habit_time   || "",
      date_enabled: habit.date_enabled || false,
      habit_date:   habit.habit_date   || "",
      priority:     habit.priority     || "none",
      category:     habit.category     || "",
    });
    setShowModal(true);
  }

  async function saveHabit() {
    if (!form.title.trim()) return;
    const payload = {
      user_id:      userId,
      title:        form.title.trim(),
      description:  form.description.trim() || null,
      type:         form.type,
      color:        form.color,
      frequency:    form.frequency,
      time_enabled: form.time_enabled,
      habit_time:   form.time_enabled ? form.habit_time : null,
      date_enabled: form.date_enabled,
      habit_date:   form.date_enabled ? form.habit_date : null,
      priority:     form.priority !== "none" ? form.priority : null,
      category:     form.category || null,
      sort_order:   editingHabit ? editingHabit.sort_order : habits.length,
    };
    if (editingHabit) {
      const { data, error } = await supabase.from("habits").update(payload).eq("id", editingHabit.id).select().single();
      if (error) { showToast("Error al guardar: " + error.message, "error"); return; }
      if (data) setHabits(prev => prev.map(h => h.id === data.id ? data : h));
    } else {
      const { data, error } = await supabase.from("habits").insert(payload).select().single();
      if (error) {
        const isTableMissing = /relation|does not exist|42P01/i.test(error.message || error.code || "");
        showToast(
          isTableMissing
            ? "Las tablas de Hábitos no existen en Supabase. Ejecutá el SQL de migraciones primero."
            : "Error al guardar: " + error.message,
          "error"
        );
        return;
      }
      if (data) setHabits(prev => [...prev, data]);
    }
    setShowModal(false);
    showToast(editingHabit ? "Hábito actualizado" : "Hábito guardado");
  }

  async function deleteHabit(habit) {
    if (!confirm(`¿Eliminar "${habit.title}"? Se perderán todas las marcas de este hábito.`)) return;
    const { error } = await supabase.from("habits").delete().eq("id", habit.id);
    if (error) { showToast("Error al eliminar: " + error.message, "error"); return; }
    setHabits(prev => prev.filter(h => h.id !== habit.id));
    setCompletions(prev => prev.filter(c => c.habit_id !== habit.id));
    setShowModal(false);
    showToast("Hábito eliminado");
  }

  // ── Month nav ─────────────────────────────────────────────────────────────

  function prevMonth() {
    setViewMonth(p => p.month === 0 ? { year: p.year - 1, month: 11 } : { year: p.year, month: p.month - 1 });
  }
  function nextMonth() {
    setViewMonth(p => p.month === 11 ? { year: p.year + 1, month: 0 } : { year: p.year, month: p.month + 1 });
  }

  const monthLabel = useMemo(() => {
    const s = new Date(year, month, 1).toLocaleString("es-AR", { month: "long", year: "numeric" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }, [year, month]);

  // ── Stats helpers ─────────────────────────────────────────────────────────

  function weekStats(w) {
    const total = habits.length * w.length;
    const done  = w.reduce((acc, d) => acc + habits.filter(h => isCompleted(h.id, d)).length, 0);
    return { total, done, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
  }

  function dayDoneCount(day) {
    return habits.filter(h => isCompleted(h.id, day)).length;
  }

  function habitWeekCount(habit, wi) {
    const w = weeks[wi];
    return w ? w.filter(d => isCompleted(habit.id, d)).length : 0;
  }

  function habitMonthCount(habit) {
    return completions.filter(c => c.habit_id === habit.id).length;
  }

  const monthStats = useMemo(() => {
    const total = habits.length * totalDays;
    const done  = completions.length;
    return { total, done, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
  }, [habits.length, totalDays, completions.length]);

  // ── Build column header elements for a row ────────────────────────────────
  // Returns a flat array of <th> or <td> elements for week day columns

  function buildDayCols(renderFn) {
    return weeks.flatMap((w, wi) => [
      ...(wi > 0 ? [<td key={`gap-${wi}`} className="hb-td-gap" aria-hidden="true" />] : []),
      ...w.map(d => renderFn(d, wi)),
    ]);
  }

  function buildDayColsHead(renderFn) {
    return weeks.flatMap((w, wi) => [
      ...(wi > 0 ? [<th key={`gap-${wi}`} className="hb-th-gap" aria-hidden="true" />] : []),
      ...w.map(d => renderFn(d, wi)),
    ]);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (!hasAccess) {
    return (
      <Layout title="Hábitos" profile={profile} onNavigate={onNavigate}>
        <div className="hb-page">
          <div className="hb-blocked">
            <h3>Módulo no disponible</h3>
            <p>No tenés acceso al módulo de Hábitos. Comunicate con un administrador para habilitarlo.</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Hábitos" profile={profile} onNavigate={onNavigate}>
      <div className="hb-page">

        {/* ── Toast ── */}
        {toast && (
          <div className={`hb-toast hb-toast--${toast.type}`} role="status">
            {toast.msg}
          </div>
        )}

        {/* ── DB error banner ── */}
        {dbError && (
          <div className="hb-dberror">
            <strong>⚠ Configuración pendiente</strong>
            <span>{dbError}</span>
            <button onClick={() => setDbError(null)}>✕</button>
          </div>
        )}

        {/* ── Header ── */}
        <div className="hb-header">
          <div className="hb-header__left">
            <h1 className="hb-title">Hábitos</h1>
            <p className="hb-subtitle">Tus hábitos y tu constancia del mes.</p>
          </div>
          <div className="hb-header__right">
            <button className="hb-icon-btn" title="Filtros" aria-label="Filtros">
              <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 6h18M7 12h10M11 18h2" />
              </svg>
            </button>
            <button className="hb-btn-primary" onClick={openAdd}>
              + Añadir hábito
            </button>
          </div>
        </div>

        {/* ── Month nav ── */}
        <div className="hb-month-nav">
          <button className="hb-month-btn" onClick={prevMonth} aria-label="Mes anterior">‹</button>
          <span className="hb-month-label">{monthLabel}</span>
          <button className="hb-month-btn" onClick={nextMonth} aria-label="Mes siguiente">›</button>
        </div>

        {/* ── Grid ── */}
        <div className="hb-grid-outer">
          {loading ? (
            <div className="hb-loading">Cargando hábitos…</div>
          ) : habits.length === 0 ? (
            <div className="hb-empty">
              <p>No tenés hábitos registrados aún.</p>
              <button className="hb-btn-primary" onClick={openAdd}>+ Añadir primer hábito</button>
            </div>
          ) : (
            <table className="hb-table" role="grid">
              {/* ── colgroup ── */}
              <colgroup>
                <col className="hb-col-name" />
                {weeks.flatMap((w, wi) => [
                  ...(wi > 0 ? [<col key={`gcol-${wi}`} className="hb-col-gap" />] : []),
                  ...w.map(d => <col key={`dcol-${d}`} className="hb-col-day" />),
                ])}
                <col className="hb-col-gap" />
                <col className="hb-col-mes" />
                <col className="hb-col-cnt" />
              </colgroup>

              <thead>
                {/* Row 1: Week labels */}
                <tr className="hb-tr-labels">
                  <th className="hb-th-name hb-tr-labels-name" scope="col">DIARIOS</th>
                  {weeks.flatMap((w, wi) => [
                    ...(wi > 0 ? [<th key={`glbl-${wi}`} className="hb-th-gap" aria-hidden="true" />] : []),
                    <th
                      key={`sem-${wi}`}
                      className={`hb-th-sem${activeWeek === wi ? " hb-th-sem--active" : ""}`}
                      colSpan={w.length}
                      onClick={() => setActiveWeek(wi)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => { if (e.key === "Enter") setActiveWeek(wi); }}
                    >
                      SEM {wi + 1}
                    </th>,
                  ])}
                  <th className="hb-th-gap" aria-hidden="true" />
                  <th className="hb-th-mes-label" scope="col">MES</th>
                  <th scope="col" />
                </tr>

                {/* Row 2: Day numbers + DOW */}
                <tr className="hb-tr-days">
                  <th className="hb-th-name" aria-hidden="true" />
                  {buildDayColsHead((d) => (
                    <th
                      key={`dn-${d}`}
                      scope="col"
                      className={[
                        "hb-th-day",
                        d === currentDay ? "hb-th-day--today" : "",
                        isFuture(d) ? "hb-th-day--future" : "",
                      ].filter(Boolean).join(" ")}
                    >
                      {d}
                    </th>
                  ))}
                  <th className="hb-th-gap" aria-hidden="true" />
                  <th className="hb-th-dow" scope="col">
                    <div className="hb-th-dow-inner" aria-hidden="true">
                      {DOW_LABELS.map(n => <span key={n}>{n}</span>)}
                    </div>
                  </th>
                  <th scope="col" />
                </tr>

                {/* Row 3: Stats (bar charts per week) */}
                <tr className="hb-tr-stats">
                  <td className="hb-td-stats-name hb-td-name" />
                  {weeks.flatMap((w, wi) => {
                    const s = weekStats(w);
                    return [
                      ...(wi > 0 ? [<td key={`gst-${wi}`} className="hb-td-gap" aria-hidden="true" />] : []),
                      <td key={`st-${wi}`} colSpan={w.length}>
                        <div className="hb-stats-cell">
                          <div className="hb-bars" aria-hidden="true">
                            {w.map(d => {
                              const cnt  = dayDoneCount(d);
                              const fut  = isFuture(d);
                              const pct  = habits.length > 0 ? cnt / habits.length : 0;
                              return (
                                <div key={d} className="hb-bar-slot">
                                  <div
                                    className={`hb-bar${fut || cnt === 0 ? " hb-bar--empty" : ""}`}
                                    style={{ height: fut ? "2px" : `${Math.max(4, Math.round(pct * 100))}%` }}
                                  />
                                </div>
                              );
                            })}
                          </div>
                          <div className="hb-stats-text">
                            <span>{s.done}/{s.total} <strong>{s.pct}%</strong></span>
                            <div className="hb-progress-bar">
                              <div className="hb-progress-fill" style={{ width: `${s.pct}%` }} />
                            </div>
                          </div>
                        </div>
                      </td>,
                    ];
                  })}
                  <td className="hb-td-gap" aria-hidden="true" />
                  <td>
                    <div className="hb-stats-cell">
                      <div style={{ height: 40 }} aria-hidden="true" />
                      <div className="hb-stats-text">
                        <span>{monthStats.done}/{monthStats.total} <strong>{monthStats.pct}%</strong></span>
                        <div className="hb-progress-bar">
                          <div className="hb-progress-fill" style={{ width: `${monthStats.pct}%` }} />
                        </div>
                      </div>
                    </div>
                  </td>
                  <td />
                </tr>
              </thead>

              <tbody>
                {habits.map(habit => (
                  <tr key={habit.id} className="hb-tr-habit">
                    {/* Sticky name cell */}
                    <td className="hb-td-name">
                      <div className="hb-name-inner">
                        <span className="hb-name-dot" style={{ background: habit.color || "#6b7280" }} />
                        <span className="hb-name-text" title={habit.title}>{habit.title}</span>
                        <button
                          className="hb-name-edit"
                          onClick={() => openEdit(habit)}
                          aria-label={`Editar ${habit.title}`}
                        >
                          ···
                        </button>
                      </div>
                    </td>

                    {/* Checkboxes per day */}
                    {weeks.flatMap((w, wi) => [
                      ...(wi > 0 ? [<td key={`hgap-${habit.id}-${wi}`} className="hb-td-gap" aria-hidden="true" />] : []),
                      ...w.map(d => {
                        const done = isCompleted(habit.id, d);
                        const fut  = isFuture(d);
                        return (
                          <td key={`${habit.id}-${d}`} className="hb-td-check">
                            <button
                              className={`hb-check${done ? " hb-check--done" : ""}${fut ? " hb-check--future" : ""}`}
                              onClick={() => toggleCompletion(habit, d)}
                              disabled={fut}
                              aria-checked={done}
                              aria-label={`${habit.title} día ${d}`}
                            />
                          </td>
                        );
                      }),
                    ])}

                    {/* Gap */}
                    <td className="hb-td-gap" aria-hidden="true" />

                    {/* MES mini-calendar */}
                    <td className="hb-td-mes">
                      <div className="hb-mini-cal" role="presentation" aria-hidden="true">
                        {miniCalCells.map((d, i) => (
                          <div
                            key={`mc-${habit.id}-${i}`}
                            className={[
                              "hb-mc",
                              d === null ? "hb-mc--nil" : isCompleted(habit.id, d) ? "hb-mc--done" : "",
                              d === currentDay ? "hb-mc--today" : "",
                            ].filter(Boolean).join(" ")}
                          />
                        ))}
                      </div>
                    </td>

                    {/* Week count */}
                    <td className="hb-td-cnt" aria-label={`${habitWeekCount(habit, activeWeek)} días esta semana`}>
                      {habitWeekCount(habit, activeWeek)}
                    </td>
                  </tr>
                ))}

                {/* Add row */}
                <tr className="hb-tr-add">
                  <td colSpan={999}>
                    <button className="hb-add-row-btn" onClick={openAdd}>
                      <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      Añadir hábito
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>

        {/* ── Modal ── */}
        {showModal && (
          <HabitModal
            form={form}
            setForm={setForm}
            editing={editingHabit}
            titleRef={titleRef}
            onSave={saveHabit}
            onDelete={() => editingHabit && deleteHabit(editingHabit)}
            onClose={() => setShowModal(false)}
          />
        )}
      </div>
    </Layout>
  );
}

// ─── Modal component ──────────────────────────────────────────────────────────

function HabitModal({ form, setForm, editing, titleRef, onSave, onDelete, onClose }) {
  const typeName = TYPES.find(t => t.value === form.type)?.label || "hábito";

  function upd(field, value) {
    setForm(f => ({ ...f, [field]: value }));
  }

  return (
    <div
      className="hb-overlay"
      onClick={e => { if (e.target.classList.contains("hb-overlay")) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={`${editing ? "Editar" : "Añadir"} ${typeName}`}
    >
      <div className="hb-modal">
        <div className="hb-modal__handle" aria-hidden="true" />

        <div className="hb-modal__head">
          <h2>{editing ? "Editar" : "Añadir"} {typeName}</h2>
          <button className="hb-modal__close" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        <div className="hb-modal__body">
          {/* Title */}
          <input
            ref={titleRef}
            className="hb-field-title"
            placeholder="Título"
            value={form.title}
            onChange={e => upd("title", e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && form.title.trim()) onSave(); }}
          />

          {/* Description */}
          <div className="hb-field-icon-row">
            <span className="hb-field-icon" aria-hidden="true">≡</span>
            <textarea
              className="hb-field-desc"
              placeholder="Añadir descripción…"
              value={form.description}
              onChange={e => upd("description", e.target.value)}
              rows={2}
            />
          </div>

          <div className="hb-modal-sep" />

          {/* Type */}
          <div className="hb-prop hb-prop--block">
            <span className="hb-prop__label">
              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/>
              </svg>
              Tipo
            </span>
            <div className="hb-type-grid">
              {TYPES.map(t => (
                <button
                  key={t.value}
                  className={`hb-type-btn${form.type === t.value ? " hb-type-btn--active" : ""}`}
                  onClick={() => upd("type", t.value)}
                >
                  <span>{t.label}</span>
                  <small>{t.desc}</small>
                </button>
              ))}
            </div>
          </div>

          <div className="hb-modal-sep" />

          {/* Color (all types) */}
          <div className="hb-prop hb-prop--block">
            <span className="hb-prop__label">
              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/>
              </svg>
              Color
            </span>
            <div className="hb-color-row">
              {HABIT_COLORS.map(c => (
                <button
                  key={c}
                  className={`hb-color-dot${form.color === c ? " hb-color-dot--active" : ""}`}
                  style={{ background: c, color: c }}
                  onClick={() => upd("color", c)}
                  aria-label={`Color ${c}`}
                  aria-pressed={form.color === c}
                />
              ))}
            </div>
          </div>

          {/* Habit-only fields */}
          {form.type === "habit" && (
            <>
              <div className="hb-prop">
                <span className="hb-prop__label">
                  <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M17 2H7a2 2 0 00-2 2v16l7-3 7 3V4a2 2 0 00-2-2z"/>
                  </svg>
                  Repetir
                </span>
                <select className="hb-field-select" value={form.frequency} onChange={e => upd("frequency", e.target.value)}>
                  {FREQ_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="hb-prop">
                <span className="hb-prop__label">
                  <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                  </svg>
                  Hora
                </span>
                <label className="hb-toggle">
                  <input type="checkbox" checked={form.time_enabled} onChange={e => upd("time_enabled", e.target.checked)} />
                  <span className="hb-toggle__track" />
                </label>
              </div>
              {form.time_enabled && (
                <div className="hb-prop">
                  <span className="hb-prop__label" />
                  <input type="time" className="hb-field-input" value={form.habit_time} onChange={e => upd("habit_time", e.target.value)} style={{ maxWidth: 140 }} />
                </div>
              )}
            </>
          )}

          {/* Task-only fields */}
          {form.type === "task" && (
            <>
              <div className="hb-prop">
                <span className="hb-prop__label">
                  <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
                  </svg>
                  Fecha
                </span>
                <label className="hb-toggle">
                  <input type="checkbox" checked={form.date_enabled} onChange={e => upd("date_enabled", e.target.checked)} />
                  <span className="hb-toggle__track" />
                </label>
              </div>
              {form.date_enabled && (
                <div className="hb-prop">
                  <span className="hb-prop__label" />
                  <input type="date" className="hb-field-input" value={form.habit_date} onChange={e => upd("habit_date", e.target.value)} style={{ maxWidth: 180 }} />
                </div>
              )}
              <div className="hb-prop">
                <span className="hb-prop__label">
                  <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                  </svg>
                  Hora
                </span>
                <label className="hb-toggle">
                  <input type="checkbox" checked={form.time_enabled} onChange={e => upd("time_enabled", e.target.checked)} />
                  <span className="hb-toggle__track" />
                </label>
              </div>
              {form.time_enabled && (
                <div className="hb-prop">
                  <span className="hb-prop__label" />
                  <input type="time" className="hb-field-input" value={form.habit_time} onChange={e => upd("habit_time", e.target.value)} style={{ maxWidth: 140 }} />
                </div>
              )}
              <div className="hb-prop">
                <span className="hb-prop__label">
                  <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                  </svg>
                  Prioridad
                </span>
                <select className="hb-field-select" value={form.priority} onChange={e => upd("priority", e.target.value)}>
                  {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
            </>
          )}

          {/* Delete (edit mode) */}
          {editing && (
            <button className="hb-delete-btn" onClick={onDelete}>
              Eliminar hábito
            </button>
          )}
        </div>

        <div className="hb-modal__foot">
          <button className="hb-modal-btn hb-modal-btn--ghost" onClick={onClose}>Cancelar</button>
          <button
            className="hb-modal-btn hb-modal-btn--primary"
            onClick={onSave}
            disabled={!form.title.trim()}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
