import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bell, BellOff, CheckCheck, RefreshCw } from "lucide-react";
import Layout from "../components/Layout";
import { EmptyState, MetricKpi, ModuleHeader } from "../components/CRMUI";
import { supabase } from "../lib/supabaseClient";
import "./notifications.css";

const DAY = 86400000;
const QUOTE_EXPIRY_DAYS = 30;

function daysUntil(value) {
  if (!value) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const date  = new Date(value); date.setHours(0,0,0,0);
  return Math.ceil((date - today) / DAY);
}

function daysSince(value) {
  if (!value) return null;
  const d = daysUntil(value);
  return d === null ? null : -d;
}

function levelFor(severity) {
  if (severity === "urgent") return "red";
  if (severity === "warning") return "amber";
  if (severity === "success") return "green";
  return "blue";
}

const CATEGORY_ICONS = {
  "Tareas":        "✅",
  "Oportunidades": "🎯",
  "Licitaciones":  "📋",
  "Visitas":       "🤝",
  "Cotizaciones":  "💰",
  "Clientes":      "🏥",
  "Usuarios":      "👤",
};

const ALL_CATEGORIES = ["Todas", "Tareas", "Oportunidades", "Licitaciones", "Visitas", "Cotizaciones", "Clientes", "Usuarios"];

async function loadLegacyAlerts(profileId) {
  const [visitsRes, oppsRes, tendersRes, profilesRes, quotesRes, accountsRes, visitDatesRes, tasksRes] =
    await Promise.all([
      supabase.from("visits")
        .select("id,account_id,visit_date,status,next_action_date,accounts(name)")
        .limit(200),
      supabase.from("opportunities")
        .select("id,name,stage,next_action,expected_close,accounts(name)")
        .limit(200),
      supabase.from("tenders")
        .select("id,institution,process_name,end_date,operational_status,next_action")
        .limit(200),
      supabase.from("profiles")
        .select("id,full_name,email,approved,is_active,role")
        .limit(80),
      supabase.from("cotizaciones")
        .select("id,quote_num_formatted,institucion,vendedor,estado,created_at")
        .eq("deleted", false)
        .limit(200),
      supabase.from("accounts")
        .select("id,name,follow_status")
        .eq("follow_status", "red")
        .limit(100),
      supabase.from("visits")
        .select("account_id,visit_date")
        .order("visit_date", { ascending: false })
        .limit(500),
      profileId
        ? supabase.from("tasks")
            .select("id,title,due_date,status")
            .in("status", ["pendiente","en_progreso"])
            .not("due_date", "is", null)
            .or(`created_by.eq.${profileId},assigned_to.eq.${profileId}`)
        : Promise.resolve({ data: [] }),
    ]);

  const rows = [];

  // ── Tareas ────────────────────────────────────────────────
  (tasksRes.data || []).forEach(t => {
    const d = daysUntil(t.due_date);
    if (d === null) return;
    if (d < 0) {
      rows.push({ type: "Tareas", level: "red", title: t.title, detail: `Vencida hace ${Math.abs(d)} día${Math.abs(d)!==1?"s":""}`, page: "tasks" });
    } else if (d === 0) {
      rows.push({ type: "Tareas", level: "red", title: t.title, detail: "Vence hoy", page: "tasks" });
    } else if (d === 1) {
      rows.push({ type: "Tareas", level: "amber", title: t.title, detail: "Vence mañana", page: "tasks" });
    } else if (d <= 3) {
      rows.push({ type: "Tareas", level: "amber", title: t.title, detail: `Vence en ${d} días`, page: "tasks" });
    }
  });

  // ── Visitas ──────────────────────────────────────────────
  (visitsRes.data || []).forEach(v => {
    const dVisit = daysUntil(v.visit_date);
    if (dVisit !== null && dVisit < 0 && v.status === "pendiente_informe") {
      rows.push({
        type: "Visitas", level: "red",
        title: v.accounts?.name || "Visita sin cliente",
        detail: `Informe vencido hace ${Math.abs(dVisit)} día${Math.abs(dVisit)!==1?"s":""}`,
        page: "visits",
      });
    }
    const dAction = daysUntil(v.next_action_date);
    if (dAction !== null && dAction < 0 && v.status === "realizada") {
      rows.push({
        type: "Visitas", level: "amber",
        title: v.accounts?.name || "Visita",
        detail: `Seguimiento vencido hace ${Math.abs(dAction)} día${Math.abs(dAction)!==1?"s":""}`,
        page: "visits",
      });
    }
  });

  // ── Oportunidades ────────────────────────────────────────
  (oppsRes.data || []).forEach(o => {
    const open = !["Ganado","Perdido"].includes(o.stage);
    if (!open) return;
    if (!o.next_action) {
      rows.push({
        type: "Oportunidades", level: "amber",
        title: o.name || o.accounts?.name || "Oportunidad",
        detail: "Sin próxima acción registrada",
        page: "opportunities",
      });
    }
    const d = daysUntil(o.expected_close);
    if (d !== null && d < 0) {
      rows.push({
        type: "Oportunidades", level: "red",
        title: o.name || o.accounts?.name || "Oportunidad",
        detail: `Cierre vencido hace ${Math.abs(d)} día${Math.abs(d)!==1?"s":""}`,
        page: "opportunities",
      });
    } else if (d !== null && d <= 7) {
      rows.push({
        type: "Oportunidades", level: "blue",
        title: o.name || o.accounts?.name || "Oportunidad",
        detail: `Cierra en ${d} día${d!==1?"s":""}`,
        page: "opportunities",
      });
    }
  });

  // ── Licitaciones ─────────────────────────────────────────
  (tendersRes.data || []).forEach(t => {
    const closed = ["cobrada","finalizada","perdida"].includes(t.operational_status?.toLowerCase());
    if (closed) return;
    const d = daysUntil(t.end_date);
    if (d !== null && d < 0) {
      rows.push({
        type: "Licitaciones", level: "red",
        title: t.institution || t.process_name || "Licitación",
        detail: `Venció hace ${Math.abs(d)} día${Math.abs(d)!==1?"s":""}`,
        page: "tenders",
      });
    } else if (d !== null && d <= 5) {
      rows.push({
        type: "Licitaciones", level: d <= 2 ? "red" : "amber",
        title: t.institution || t.process_name || "Licitación",
        detail: `Vence en ${d} día${d!==1?"s":""}`,
        page: "tenders",
      });
    }
    if (!t.next_action && !t.operational_status) {
      rows.push({
        type: "Licitaciones", level: "slate",
        title: t.institution || t.process_name || "Licitación",
        detail: "Sin seguimiento registrado",
        page: "tenders",
      });
    }
  });

  // ── Cotizaciones ─────────────────────────────────────────
  (quotesRes.data || []).forEach(q => {
    const active = ["enviada","evaluacion","seguimiento","negociacion"].includes(q.estado);
    if (!active) return;
    const sent = ["enviada","evaluacion"].includes(q.estado);
    if (!sent) return;
    const dOpen = daysSince(q.created_at);
    if (dOpen === null) return;
    const dLeft = QUOTE_EXPIRY_DAYS - dOpen;
    if (dLeft < 0) {
      rows.push({
        type: "Cotizaciones", level: "red",
        title: q.institucion || q.quote_num_formatted || "Cotización",
        detail: `Vencida hace ${Math.abs(dLeft)} día${Math.abs(dLeft)!==1?"s":" "} — ${q.vendedor||"sin vendedor"}`,
        page: "cotizador",
      });
    } else if (dLeft <= 3) {
      rows.push({
        type: "Cotizaciones", level: "amber",
        title: q.institucion || q.quote_num_formatted || "Cotización",
        detail: `Vence en ${dLeft} día${dLeft!==1?"s":""} — ${q.vendedor||"sin vendedor"}`,
        page: "cotizador",
      });
    }
  });

  // ── Clientes en rojo ──────────────────────────────────────
  const visitsByAccount = {};
  (visitDatesRes.data || []).forEach(v => {
    if (!visitsByAccount[v.account_id]) visitsByAccount[v.account_id] = v.visit_date;
  });
  (accountsRes.data || []).forEach(a => {
    const lastVisit = visitsByAccount[a.id];
    const ago = lastVisit ? daysSince(lastVisit) : null;
    if (ago === null || ago > 45) {
      rows.push({
        type: "Clientes", level: "amber",
        title: a.name,
        detail: ago === null
          ? "Seguimiento rojo — sin visitas registradas"
          : `Seguimiento rojo — última visita hace ${ago} días`,
        page: "accounts",
      });
    }
  });

  // ── Usuarios pendientes ───────────────────────────────────
  (profilesRes.data || []).forEach(p => {
    if (!p.approved || p.is_active === false) {
      rows.push({
        type: "Usuarios", level: "green",
        title: p.full_name || p.email || "Usuario",
        detail: `Pendiente de aprobación — ${p.role || "sin rol"}`,
        page: "adminUsers",
      });
    }
  });

  return rows;
}

export default function NotificationsPage({ profile, onNavigate, pageKey }) {
  const [alerts,   setAlerts]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [filter,   setFilter]   = useState("Todas");
  const [persistent, setPersistent] = useState(true);

  useEffect(() => { load(); }, [profile?.id, pageKey]);

  async function load() {
    setLoading(true);
    const result = await supabase
      .from("crm_notifications")
      .select("id,title,detail,category,severity,page,record_id,read_at,created_at")
      .eq("recipient_id", profile?.id)
      .order("created_at", { ascending: false })
      .limit(120);

    let computed = [];
    if (!result.error && result.data?.length > 0) {
      setPersistent(true);
      computed = (result.data || []).map(row => ({ ...row, level: levelFor(row.severity), type: row.category }));
    } else {
      setPersistent(false);
      computed = await loadLegacyAlerts(profile?.id);
    }

    // Siempre agrega alertas de tareas propias (independiente del modo)
    if (profile?.id) {
      const tRes = await supabase.from("tasks")
        .select("id,title,due_date,status")
        .in("status", ["pendiente","en_progreso"])
        .not("due_date", "is", null)
        .or(`created_by.eq.${profile.id},assigned_to.eq.${profile.id}`);
      (tRes.data || []).forEach(t => {
        const d = daysUntil(t.due_date);
        if (d === null || d > 3) return;
        const detail = d < 0 ? `Vencida hace ${Math.abs(d)} día${Math.abs(d)!==1?"s":""}` : d === 0 ? "Vence hoy" : d === 1 ? "Vence mañana" : `Vence en ${d} días`;
        const level  = d <= 0 ? "red" : "amber";
        computed = [{ type: "Tareas", level, title: t.title, detail, page: "tasks" }, ...computed];
      });
    }

    setAlerts(computed);
    setLoading(false);

    const unreadCount = computed.filter(a => !a.read_at && (a.level === "red" || a.level === "amber")).length;
    window.dispatchEvent(new CustomEvent("crm:notifications-updated", { detail: { legacyCount: unreadCount } }));
  }

  async function openAlert(alert) {
    if (persistent && alert.id && !alert.read_at) {
      await supabase.from("crm_notifications").update({ read_at: new Date().toISOString() }).eq("id", alert.id);
      window.dispatchEvent(new CustomEvent("crm:notifications-updated", { detail: {} }));
    }
    onNavigate(alert.page || "notifications", alert.record_id ? { recordId: alert.record_id } : undefined);
  }

  async function markAllRead() {
    if (!persistent || !profile?.id) return;
    await supabase.from("crm_notifications").update({ read_at: new Date().toISOString() }).eq("recipient_id", profile.id).is("read_at", null);
    await load();
  }

  const filtered = useMemo(() =>
    filter === "Todas" ? alerts : alerts.filter(a => a.type === filter),
  [alerts, filter]);

  const unread  = alerts.filter(a => !a.read_at).length;
  const urgent  = alerts.filter(a => !a.read_at && a.level === "red").length;
  const warn    = alerts.filter(a => !a.read_at && (a.level === "amber" || a.level === "blue")).length;

  const countFor = cat =>
    cat === "Todas" ? alerts.length : alerts.filter(a => a.type === cat).length;

  return (
    <Layout title="Centro de Alertas" profile={profile} onNavigate={onNavigate}>
      <div className="p-page">
        <div className="p-panel">

          <div className="p-hd">
            <div className="p-hd-left">
              <span className="p-title">Centro de Alertas</span>
              <span className="p-sub">Seguimientos, licitaciones, cotizaciones y oportunidades en una bandeja operativa.</span>
            </div>
            <div className="p-hd-right">
              {persistent && unread > 0 && (
                <button className="p-btn p-btn--ghost" onClick={markAllRead}>
                  <CheckCheck size={14}/> Marcar leídas
                </button>
              )}
              <button className="p-btn p-btn--ghost" onClick={load} disabled={loading}>
                <RefreshCw size={14} className={loading ? "notif-spin" : ""}/>
                {loading ? "Actualizando…" : "Actualizar"}
              </button>
            </div>
          </div>

          <div className="p-metrics">
            <div className="p-metric">
              <span className="p-metric__ey">Sin leer</span>
              <span className="p-metric__val">{loading ? "—" : unread}</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Urgentes</span>
              <span className="p-metric__val p-metric__down">{loading ? "—" : urgent}</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Atención</span>
              <span className="p-metric__val">{loading ? "—" : warn}</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Total</span>
              <span className="p-metric__val p-metric__up">{loading ? "—" : alerts.length}</span>
            </div>
          </div>

          <div className="p-toolbar p-toolbar--top">
            <div className="p-pills">
              {ALL_CATEGORIES.map(cat => (
                <button
                  key={cat}
                  className={`p-pill${filter === cat ? " p-pill--active" : ""}`}
                  onClick={() => setFilter(cat)}
                >
                  {CATEGORY_ICONS[cat] && <span>{CATEGORY_ICONS[cat]}</span>}
                  {cat}
                  {countFor(cat) > 0 && (
                    <span className="p-badge--gray" style={{ marginLeft: 4 }}>{countFor(cat)}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="p-list">
            {loading ? (
              <div className="p-empty">Analizando el CRM… Revisando vencimientos, seguimientos y alertas operativas.</div>
            ) : filtered.length === 0 ? (
              <div className="p-empty">
                <BellOff size={32} color="#cbd5e1" />
                <p>{filter === "Todas" ? "Sin alertas pendientes" : `Sin alertas en ${filter}`}</p>
              </div>
            ) : filtered.map((alert, index) => (
              <button
                key={alert.id || `${alert.type}-${index}`}
                className="p-row"
                onClick={() => openAlert(alert)}
                style={{ background: "none", border: "none", width: "100%", textAlign: "left", cursor: "pointer" }}
              >
                <div className="p-row__rank" style={{ fontSize: 18 }}>
                  {CATEGORY_ICONS[alert.type] || <Bell size={14}/>}
                </div>
                <div className="p-row__main">
                  <div className="p-row__name">{alert.title}</div>
                  <div className="p-row__sub">{alert.detail}</div>
                </div>
                <div className="p-row__meta">
                  <span className={`p-badge--${alert.level === "slate" ? "gray" : alert.level || "blue"}`}>
                    {alert.type}
                  </span>
                  {!alert.read_at && (
                    <span className={`p-dot p-dot--${alert.level === "red" ? "red" : alert.level === "amber" ? "amber" : "blue"}`} aria-label="Sin leer"/>
                  )}
                </div>
              </button>
            ))}
          </div>

        </div>
      </div>
    </Layout>
  );
}
