import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarPlus,
  CheckCircle2,
  Clock3,
  MessageCircle,
  PackageOpen,
  RefreshCw,
  Search,
  TrendingUp,
  X,
} from "lucide-react";
import Layout from "../components/Layout";
import { EmptyState, MetricKpi, ModuleHeader } from "../components/CRMUI";
import { supabase } from "../lib/supabaseClient";
import { canOpenModule } from "../lib/moduleAccess";
import { buildTodayActions } from "../services/decisionEngine";
import "./todayActions.css";

// ── Habits helpers (same logic as HabitsPage, no shared dep needed) ───────────
function freqToDays(freq) {
  if (!freq || freq === "daily")  return [0,1,2,3,4,5,6];
  if (freq === "weekdays")        return [0,1,2,3,4];
  if (freq === "weekend")         return [5,6];
  try { const p = JSON.parse(freq); if (Array.isArray(p)) return p.filter(n => n >= 0 && n <= 6); } catch {}
  return [0,1,2,3,4,5,6];
}
function todayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function todayDow() { return (new Date().getDay() + 6) % 7; } // 0=Lun…6=Dom

function moneyARS(value) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export default function TodayActionsPage({ profile, onNavigate }) {
  const userId = profile?.id;
  const hasHabits = profile?.role === "super_admin" || canOpenModule(profile, "habits");

  const [actions,        setActions]        = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [search,         setSearch]         = useState("");
  const [priorityFilter, setPriorityFilter] = useState("todas");
  const [focusFilter,    setFocusFilter]    = useState("todos");

  // ── Habits widget state ──────────────────────────────────────────────────
  const [allHabits,       setAllHabits]       = useState([]);
  const [todayDone,       setTodayDone]       = useState(new Set());
  const [togglingSet,     setTogglingSet]     = useState(new Set());
  const [habitsReady,     setHabitsReady]     = useState(false);
  const notifFiredRef = useRef(false);

  useEffect(() => { loadActions(); }, []);
  useEffect(() => { if (hasHabits && userId) loadTodayHabits(); }, [userId, hasHabits]);

  async function loadTodayHabits() {
    const today = todayDateStr();
    const [hRes, cRes] = await Promise.all([
      supabase.from("habits").select("id,title,color,frequency,time_enabled,habit_time,type").eq("user_id", userId),
      supabase.from("habit_completions").select("habit_id").eq("completed_date", today).eq("user_id", userId),
    ]);
    setAllHabits(hRes.data || []);
    setTodayDone(new Set((cRes.data || []).map(c => c.habit_id)));
    setHabitsReady(true);
  }

  async function toggleTodayHabit(habit) {
    if (togglingSet.has(habit.id)) return;
    const today   = todayDateStr();
    const wasDone = todayDone.has(habit.id);
    setTogglingSet(prev => new Set([...prev, habit.id]));
    setTodayDone(prev => { const n = new Set(prev); wasDone ? n.delete(habit.id) : n.add(habit.id); return n; });
    try {
      if (wasDone) {
        await supabase.from("habit_completions").delete().eq("habit_id", habit.id).eq("user_id", userId).eq("completed_date", today);
      } else {
        await supabase.from("habit_completions").insert({ habit_id: habit.id, user_id: userId, completed_date: today });
      }
    } catch {
      setTodayDone(prev => { const n = new Set(prev); wasDone ? n.add(habit.id) : n.delete(habit.id); return n; });
    }
    setTogglingSet(prev => { const n = new Set(prev); n.delete(habit.id); return n; });
  }

  async function loadActions() {
    setLoading(true);

    const [accountsRes, visitsRes, oppsRes, productsRes] = await Promise.all([
      supabase.from("accounts").select("*").order("name"),
      supabase.from("visits").select("*"),
      supabase.from("opportunities").select("*"),
      supabase.from("products").select("*"),
    ]);

    const result = buildTodayActions({
      accounts:     accountsRes.data || [],
      visits:       visitsRes.data   || [],
      opportunities: oppsRes.data    || [],
      products:     productsRes.data || [],
    });

    setActions(result);
    setLoading(false);
  }

  function shareProduct(product, accountName) {
    if (!product) {
      alert("Este cliente todavía no tiene producto sugerido.");
      return;
    }

    const text = `Hola${accountName ? ` para ${accountName}` : ""}, te comparto información sobre ${product.name}.

${product.speech || ""}

${product.brochure_url   ? `Brochure: ${product.brochure_url}`        : ""}
${product.tech_sheet_url ? `Ficha técnica: ${product.tech_sheet_url}` : ""}
${product.video_url      ? `Video: ${product.video_url}`              : ""}

Quedo atento para coordinar una presentación.`;

    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  }

  // ── Today's scheduled habits ────────────────────────────────────────────
  const todayHabits = useMemo(() => {
    const dow = todayDow();
    return allHabits.filter(h => h.type === "habit" && freqToDays(h.frequency).includes(dow));
  }, [allHabits]);

  const doneTodayCount = useMemo(
    () => todayHabits.filter(h => todayDone.has(h.id)).length,
    [todayHabits, todayDone]
  );

  // Browser notification — once per day
  useEffect(() => {
    if (!habitsReady || todayHabits.length === 0 || notifFiredRef.current) return;
    if (!("Notification" in window)) return;
    const key = `hb-notif-${todayDateStr()}`;
    if (localStorage.getItem(key)) return;
    notifFiredRef.current = true;

    function fire() {
      const pending = todayHabits.filter(h => !todayDone.has(h.id));
      if (!pending.length) return;
      new Notification("Hábitos pendientes hoy 📋", {
        body: pending.length === 1
          ? `Recordá completar: ${pending[0].title}`
          : `Tenés ${pending.length} hábitos por completar hoy`,
        icon: "/favicon.ico",
        tag: "habitos-hoy",
      });
      localStorage.setItem(key, "1");
    }

    if (Notification.permission === "granted") {
      fire();
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then(perm => { if (perm === "granted") fire(); });
    }
  }, [habitsReady, todayHabits]);

  const high = actions.filter((a) => a.priority === "Alta").length;
  const cold = actions.filter((a) => a.daysWithoutContact > 30).length;
  const overdue = actions.filter((a) => a.overdueOpps > 0).length;
  const prioritizedPipeline = actions.reduce((sum, item) => sum + Number(item.openPipeline || 0), 0);

  const filteredActions = useMemo(() => {
    const query = search.trim().toLowerCase();
    return actions.filter((item) => {
      const account = item.account || {};
      const matchesQuery = !query || [
        account.name,
        account.city,
        account.province,
        account.potential,
        item.suggestedProduct?.name,
      ].some((value) => String(value || "").toLowerCase().includes(query));
      const matchesPriority = priorityFilter === "todas" || item.priority === priorityFilter;
      const matchesFocus =
        focusFilter === "todos" ||
        (focusFilter === "sin_contacto" && item.daysWithoutContact > 30) ||
        (focusFilter === "pipeline" && item.openPipeline > 0) ||
        (focusFilter === "vencidas" && item.overdueOpps > 0) ||
        (focusFilter === "sin_producto" && !item.suggestedProduct);
      return matchesQuery && matchesPriority && matchesFocus;
    });
  }, [actions, focusFilter, priorityFilter, search]);

  function clearFilters() {
    setSearch("");
    setPriorityFilter("todas");
    setFocusFilter("todos");
  }

  if (loading) {
    return (
      <Layout title="Acciones Hoy" profile={profile} onNavigate={onNavigate}>
        <div className="ta-loading"><div className="ta-loading__pulse" /><span>Cargando recomendaciones…</span></div>
      </Layout>
    );
  }

  return (
    <Layout title="Acciones Hoy" profile={profile} onNavigate={onNavigate}>
      <div className="p-page">

        {/* KPI Panel */}
        <div className="p-panel">
          <div className="p-hd">
            <div className="p-hd-left">
              <span className="p-title">Acciones Hoy</span>
              <span className="p-sub">Agenda comercial priorizada por potencial, pipeline, vencimientos y tiempo sin contacto.</span>
            </div>
            <div className="p-hd-right">
              <button className="p-btn p-btn--ghost" type="button" onClick={loadActions}>
                <RefreshCw size={16} /> Actualizar
              </button>
              <button className="p-btn p-btn--primary" type="button" onClick={() => onNavigate("visits", { action: "create", source: "todayActions" })}>
                <CalendarPlus size={16} /> Registrar visita
              </button>
            </div>
          </div>

          <div className="p-metrics">
            <div className="p-metric">
              <span className="p-metric__ey">Clientes priorizados</span>
              <span className="p-metric__val">{actions.length}</span>
              <span className="p-metric__sub">cuentas analizadas</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Prioridad alta</span>
              <span className="p-metric__val">{high}</span>
              <span className="p-metric__sub">requieren contacto</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">+30 días sin contacto</span>
              <span className="p-metric__val">{cold}</span>
              <span className="p-metric__sub">cuentas para reactivar</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Pipeline priorizado</span>
              <span className="p-metric__val">{moneyARS(prioritizedPipeline)}</span>
              <span className="p-metric__sub">monto abierto</span>
            </div>
          </div>

          <div className="p-body">
            <div className={`ta-insight ${high || overdue ? "ta-insight--alert" : "ta-insight--ok"}`}>
              <div className="ta-insight__icon">
                {high || overdue ? <AlertTriangle size={19} /> : <CheckCircle2 size={19} />}
              </div>
              <div>
                <span>Lectura operativa</span>
                <strong>{high || overdue ? "Hay acciones comerciales para resolver hoy" : "Agenda comercial bajo control"}</strong>
                <p>
                  {high || overdue
                    ? `${high} cliente${high !== 1 ? "s" : ""} de prioridad alta y ${overdue} con oportunidades vencidas.`
                    : "No hay oportunidades vencidas ni cuentas críticas en la bandeja actual."}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Hábitos de hoy ── */}
        {habitsReady && todayHabits.length > 0 && (
          <div className="ta-habits-card">
            <div className="ta-habits-hd">
              <span className="ta-habits-title">
                <span className="ta-habits-ico">🎯</span>
                Hábitos de hoy
              </span>
              <div className="ta-habits-meta">
                {doneTodayCount === todayHabits.length ? (
                  <span className="ta-habits-all-done">✓ ¡Todos completados!</span>
                ) : (
                  <span className="ta-habits-count">{doneTodayCount} / {todayHabits.length}</span>
                )}
                <button type="button" className="ta-habits-nav" onClick={() => onNavigate("habits")}>
                  Ver todos →
                </button>
              </div>
            </div>

            <div className="ta-habits-progress-bar">
              <div className="ta-habits-progress-fill"
                   style={{ width: `${Math.round(doneTodayCount / todayHabits.length * 100)}%` }} />
            </div>

            <div className="ta-habits-list">
              {todayHabits.map(h => {
                const done = todayDone.has(h.id);
                const busy = togglingSet.has(h.id);
                return (
                  <button key={h.id} type="button" disabled={busy}
                          className={`ta-habit-row${done ? " ta-habit-row--done" : ""}`}
                          onClick={() => toggleTodayHabit(h)}>
                    <span className="ta-habit-dot" style={{ background: h.color || "#22c55e" }} />
                    <span className="ta-habit-name">{h.title}</span>
                    {h.time_enabled && h.habit_time && (
                      <span className="ta-habit-time">{h.habit_time.slice(0, 5)}</span>
                    )}
                    <span className={`ta-habit-check${done ? " ta-habit-check--done" : ""}`}>
                      {done ? "✓" : "○"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Worklist Panel */}
        <div className="p-panel">
          <div className="p-hd">
            <div className="p-hd-left">
              <span className="p-title">Bandeja priorizada</span>
              <span className="p-sub">{filteredActions.length} cliente{filteredActions.length !== 1 ? "s" : ""} en esta vista</span>
            </div>
          </div>

          <div className="p-toolbar--top">
            <label className="p-search">
              <Search size={16} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cliente, ciudad o producto..." />
            </label>
            <select className="p-select" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
              <option value="todas">Todas las prioridades</option>
              <option value="Alta">Prioridad alta</option>
              <option value="Media">Prioridad media</option>
              <option value="Baja">Prioridad baja</option>
            </select>
            <select className="p-select" value={focusFilter} onChange={(event) => setFocusFilter(event.target.value)}>
              <option value="todos">Todos los enfoques</option>
              <option value="vencidas">Oportunidades vencidas</option>
              <option value="sin_contacto">Más de 30 días sin contacto</option>
              <option value="pipeline">Con pipeline abierto</option>
              <option value="sin_producto">Sin producto sugerido</option>
            </select>
            {(search || priorityFilter !== "todas" || focusFilter !== "todos") && (
              <button className="p-btn p-btn--ghost p-btn--icon" type="button" onClick={clearFilters} title="Limpiar filtros">
                <X size={16} />
              </button>
            )}
          </div>

          <div className="p-list">
            {filteredActions.length === 0 ? (
              <div className="p-empty">
                {actions.length
                  ? "No hay acciones con esos filtros. Probá con otra prioridad o enfoque comercial."
                  : "Todavía no hay clientes cargados. Cargá una cuenta para comenzar a priorizar la agenda."}
                {actions.length > 0 && (
                  <button className="p-btn p-btn--ghost" type="button" onClick={clearFilters} style={{ marginLeft: 12 }}>Limpiar filtros</button>
                )}
              </div>
            ) : filteredActions.slice(0, 12).map((item, index) => (
              <div key={item.account.id} className="p-row">
                <span className="p-row__rank">{String(index + 1).padStart(2, "0")}</span>
                <div className="p-row__main">
                  <div className="p-row__name">
                    {item.account.name}
                    {item.priority === "Alta" && <span className="p-badge--red" style={{ marginLeft: 8 }}>Alta</span>}
                    {item.priority === "Media" && <span className="p-badge--amber" style={{ marginLeft: 8 }}>Media</span>}
                    {item.priority === "Baja" && <span className="p-badge--gray" style={{ marginLeft: 8 }}>Baja</span>}
                  </div>
                  <div className="p-row__sub">
                    {item.account.city || "—"} · {item.account.province || "—"} · Potencial {item.account.potential || "Medio"}
                    &nbsp;·&nbsp;<Clock3 size={12} style={{ display: "inline", verticalAlign: "middle" }} /> {item.daysWithoutContact} días sin contacto
                    &nbsp;·&nbsp;<TrendingUp size={12} style={{ display: "inline", verticalAlign: "middle" }} /> {moneyARS(item.openPipeline)}
                    {item.suggestedProduct && <>&nbsp;·&nbsp;<PackageOpen size={12} style={{ display: "inline", verticalAlign: "middle" }} /> {item.suggestedProduct.name}</>}
                  </div>
                  <div className="p-row__sub" style={{ marginTop: 4 }}>{item.reason}</div>
                </div>
                <div className="p-row__meta">
                  <span className="p-row__val">Score {item.score}</span>
                  <div className="p-progress" style={{ width: 80, marginTop: 4 }}>
                    <div
                      className={`p-progress-fill ${item.score >= 70 ? "p-progress-fill--green" : item.score >= 40 ? "p-progress-fill--amber" : "p-progress-fill--red"}`}
                      style={{ width: `${item.score}%` }}
                    />
                  </div>
                </div>
                <div className="p-row__actions">
                  <button
                    className="p-icon-btn"
                    title="Compartir Share Kit"
                    onClick={() => shareProduct(item.suggestedProduct, item.account.name)}
                  >
                    <MessageCircle size={15} />
                  </button>
                  <button
                    className="p-icon-btn"
                    title="Registrar visita"
                    onClick={() => onNavigate("visits", { action: "create", source: "todayActions" })}
                  >
                    <CalendarPlus size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </Layout>
  );
}

function TaMetric({ icon, label, value }) {
  return (
    <div className="ta-metric">
      <span>{icon}{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
