import { useEffect, useMemo, useState } from "react";
import { CheckCheck } from "lucide-react";
import Layout from "../components/Layout";
import { EmptyState, MetricKpi, ModuleHeader } from "../components/CRMUI";
import { supabase } from "../lib/supabaseClient";
import "./notifications.css";

const DAY = 86400000;

function daysUntil(value) {
  if (!value) return null;
  const today = new Date();
  const date = new Date(value);
  today.setHours(0,0,0,0);
  date.setHours(0,0,0,0);
  return Math.ceil((date - today) / DAY);
}

function levelFor(severity) {
  if (severity === "urgent") return "red";
  if (severity === "warning") return "amber";
  if (severity === "success") return "green";
  return "blue";
}

export default function NotificationsPage({ profile, onNavigate }) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [persistent, setPersistent] = useState(true);

  useEffect(() => { load(); }, [profile?.id]);

  async function load() {
    setLoading(true);
    await supabase.rpc("refresh_crm_notifications");
    const result = await supabase
      .from("crm_notifications")
      .select("id,title,detail,category,severity,page,record_id,read_at,created_at")
      .eq("recipient_id", profile?.id)
      .order("created_at", { ascending: false })
      .limit(120);

    if (!result.error) {
      setPersistent(true);
      setAlerts((result.data || []).map(row => ({ ...row, level: levelFor(row.severity), type: row.category })));
    } else {
      setPersistent(false);
      setAlerts(await loadLegacyAlerts());
    }
    setLoading(false);
    window.dispatchEvent(new Event("crm:notifications-updated"));
  }

  async function loadLegacyAlerts() {
    const [visits, opportunities, tenders, profiles] = await Promise.all([
      supabase.from("visits").select("id,account_id,visit_date,status,accounts(name)").limit(80),
      supabase.from("opportunities").select("id,name,stage,next_action,expected_close,accounts(name)").limit(80),
      supabase.from("tenders").select("id,institution,process_name,end_date,operational_status,next_action").limit(80),
      supabase.from("profiles").select("id,full_name,email,approved,is_active,role").limit(80),
    ]);
    const rows = [];
    (visits.data || []).forEach(v => {
      const days = daysUntil(v.visit_date);
      if (days !== null && days < 0 && v.status === "pendiente_informe") rows.push({ type: "Visitas", level: "red", title: v.accounts?.name || "Visita sin cliente", detail: `${Math.abs(days)} días vencida`, page: "visits" });
    });
    (opportunities.data || []).forEach(o => {
      const days = daysUntil(o.expected_close);
      const open = !["Ganado","Perdido"].includes(o.stage);
      if (open && !o.next_action) rows.push({ type: "Oportunidades", level: "amber", title: o.name || "Oportunidad", detail: "Sin próxima acción registrada", page: "opportunities" });
      if (open && days !== null && days <= 7) rows.push({ type: "Oportunidades", level: days < 0 ? "red" : "blue", title: o.name || "Oportunidad", detail: days < 0 ? `${Math.abs(days)} días vencida` : `Cierra en ${days} días`, page: "opportunities" });
    });
    (tenders.data || []).forEach(t => {
      const days = daysUntil(t.end_date);
      if (days !== null && days <= 7) rows.push({ type: "Licitaciones", level: days < 0 ? "red" : "blue", title: t.institution || t.process_name || "Licitación", detail: days < 0 ? `${Math.abs(days)} días vencida` : `Vence en ${days} días`, page: "tenders" });
      if (!t.next_action) rows.push({ type: "Licitaciones", level: "slate", title: t.institution || t.process_name || "Licitación", detail: t.operational_status || "Sin seguimiento definido", page: "tenders" });
    });
    (profiles.data || []).forEach(p => {
      if (!p.approved || p.is_active === false) rows.push({ type: "Usuarios", level: "green", title: p.full_name || p.email || "Usuario", detail: p.role || "Sin rol", page: "adminUsers" });
    });
    return rows;
  }

  async function openAlert(alert) {
    if (persistent && alert.id && !alert.read_at) {
      await supabase.from("crm_notifications").update({ read_at: new Date().toISOString() }).eq("id", alert.id);
      window.dispatchEvent(new Event("crm:notifications-updated"));
    }
    onNavigate(alert.page || "notifications", alert.record_id ? { recordId: alert.record_id } : undefined);
  }

  async function markAllRead() {
    if (!persistent || !profile?.id) return;
    await supabase.from("crm_notifications").update({ read_at: new Date().toISOString() }).eq("recipient_id", profile.id).is("read_at", null);
    await load();
  }

  const unread = useMemo(() => alerts.filter(alert => !alert.read_at).length, [alerts]);
  const urgent = alerts.filter(alert => !alert.read_at && alert.level === "red").length;
  const warn = alerts.filter(alert => !alert.read_at && (alert.level === "amber" || alert.level === "blue")).length;

  return (
    <Layout title="Centro de Alertas" profile={profile} onNavigate={onNavigate}>
      <div className="notif-page">
        <ModuleHeader
          title="Centro de Alertas"
          subtitle="Seguimientos, licitaciones y oportunidades en una bandeja operativa."
          actions={<div className="notif-actions">{persistent && unread > 0 && <button className="notif-refresh" onClick={markAllRead}><CheckCheck size={15}/> Marcar leídas</button>}<button className="notif-refresh" onClick={load}>{loading ? "Actualizando..." : "Actualizar"}</button></div>}
        />
        <section className="notif-kpis">
          <MetricKpi label="Sin leer" value={unread} />
          <MetricKpi label="Urgentes" value={urgent} accent="red" />
          <MetricKpi label="Atención" value={warn} accent="amber" />
          <MetricKpi label="Historial" value={alerts.length} accent="green" />
        </section>
        {!persistent && <p className="notif-compat">Vista compatible activa. Ejecutá la migración operativa para habilitar historial y marcado de lectura.</p>}
        <section className="notif-list">
          {loading ? (
            <EmptyState title="Cargando alertas" text="Revisando señales comerciales del CRM." />
          ) : alerts.length === 0 ? (
            <EmptyState title="Sin alertas pendientes" text="No hay vencimientos ni bloqueos relevantes en este momento." />
          ) : alerts.map((alert, index) => (
            <button key={alert.id || `${alert.type}-${index}`} className={`notif-item notif-item--${alert.level}${alert.read_at ? " is-read" : ""}`} onClick={() => openAlert(alert)}>
              <span>{alert.type}</span>
              <strong>{alert.title}</strong>
              <small>{alert.detail}</small>
            </button>
          ))}
        </section>
      </div>
    </Layout>
  );
}
