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
  "Oportunidades": "🎯",
  "Licitaciones":  "📋",
  "Visitas":       "🤝",
  "Cotizaciones":  "💰",
  "Clientes":      "🏥",
  "Usuarios":      "👤",
};

const ALL_CATEGORIES = ["Todas", "Oportunidades", "Licitaciones", "Visitas", "Cotizaciones", "Clientes", "Usuarios"];

async function loadLegacyAlerts() {
  const [visitsRes, oppsRes, tendersRes, profilesRes, quotesRes, accountsRes, visitDatesRes] =
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
    ]);

  const rows = [];

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
    const closed = ["cobrada","finalizada","perdida"].includes(t.operational_status);
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
    if (!t.next_action) {
      rows.push({
        type: "Licitaciones", level: "slate",
        title: t.institution || t.process_name || "Licitación",
        detail: `Estado: ${t.operational_status || "Sin seguimiento"}`,
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

export default function NotificationsPage({ profile, onNavigate }) {
  const [alerts,   setAlerts]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [filter,   setFilter]   = useState("Todas");
  const [persistent, setPersistent] = useState(true);

  useEffect(() => { load(); }, [profile?.id]);

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
      computed = await loadLegacyAlerts();
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
      <div className="notif-page">
        <ModuleHeader
          title="Centro de Alertas"
          subtitle="Seguimientos, licitaciones, cotizaciones y oportunidades en una bandeja operativa."
          actions={
            <div className="notif-actions">
              {persistent && unread > 0 && (
                <button className="notif-refresh" onClick={markAllRead}>
                  <CheckCheck size={14}/> Marcar leídas
                </button>
              )}
              <button className="notif-refresh" onClick={load} disabled={loading}>
                <RefreshCw size={14} className={loading ? "notif-spin" : ""}/>
                {loading ? "Actualizando…" : "Actualizar"}
              </button>
            </div>
          }
        />

        <section className="notif-kpis">
          <MetricKpi label="Sin leer"  value={loading ? "—" : unread} />
          <MetricKpi label="Urgentes"  value={loading ? "—" : urgent} accent="red" />
          <MetricKpi label="Atención"  value={loading ? "—" : warn}   accent="amber" />
          <MetricKpi label="Total"     value={loading ? "—" : alerts.length} accent="green" />
        </section>

        <div className="notif-filters">
          {ALL_CATEGORIES.map(cat => (
            <button
              key={cat}
              className={`notif-filter-btn${filter === cat ? " active" : ""}`}
              onClick={() => setFilter(cat)}
            >
              {CATEGORY_ICONS[cat] && <span>{CATEGORY_ICONS[cat]}</span>}
              {cat}
              {countFor(cat) > 0 && <span className="notif-filter-count">{countFor(cat)}</span>}
            </button>
          ))}
        </div>

        <section className="notif-list">
          {loading ? (
            <EmptyState title="Analizando el CRM…" text="Revisando vencimientos, seguimientos y alertas operativas." />
          ) : filtered.length === 0 ? (
            <div className="notif-empty">
              <BellOff size={32} color="#cbd5e1" />
              <p>{filter === "Todas" ? "Sin alertas pendientes" : `Sin alertas en ${filter}`}</p>
            </div>
          ) : filtered.map((alert, index) => (
            <button
              key={alert.id || `${alert.type}-${index}`}
              className={`notif-item notif-item--${alert.level}${alert.read_at ? " is-read" : ""}`}
              onClick={() => openAlert(alert)}
            >
              <span className="notif-item__cat">
                {CATEGORY_ICONS[alert.type] || <Bell size={12}/>} {alert.type}
              </span>
              <strong className="notif-item__title">{alert.title}</strong>
              <small className="notif-item__detail">{alert.detail}</small>
              {!alert.read_at && <span className="notif-item__dot" aria-label="Sin leer"/>}
            </button>
          ))}
        </section>
      </div>
    </Layout>
  );
}
