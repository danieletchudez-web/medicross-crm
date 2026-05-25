import { useEffect, useMemo, useState } from "react";
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

export default function NotificationsPage({ profile, onNavigate }) {
  const [data, setData] = useState({ visits: [], opportunities: [], tenders: [], profiles: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [visits, opportunities, tenders, profiles] = await Promise.all([
      supabase.from("visits").select("id,account_id,visit_date,status,report_status,accounts(name)").limit(80),
      supabase.from("opportunities").select("id,name,stage,next_action,expected_close,accounts(name)").limit(80),
      supabase.from("tenders").select("id,institution,process_name,due_date,status,next_action").limit(80),
      supabase.from("profiles").select("id,full_name,email,approved,is_active,role").limit(80),
    ]);
    setData({
      visits: visits.data || [],
      opportunities: opportunities.data || [],
      tenders: tenders.data || [],
      profiles: profiles.data || [],
    });
    setLoading(false);
  }

  const alerts = useMemo(() => {
    const rows = [];
    data.visits.forEach(v => {
      const d = daysUntil(v.visit_date);
      if (d !== null && d < 0) rows.push({ type: "Visita vencida", level: "red", title: v.accounts?.name || "Visita sin cliente", detail: `${Math.abs(d)} días vencida`, page: "visits" });
      if (v.report_status === "pendiente" || v.status === "Pendiente Informe") rows.push({ type: "Informe pendiente", level: "amber", title: v.accounts?.name || "Visita", detail: "Completar resultado de visita", page: "visits" });
    });
    data.opportunities.forEach(o => {
      const d = daysUntil(o.expected_close);
      const open = !["Ganado","Perdido"].includes(o.stage);
      if (open && !o.next_action) rows.push({ type: "Sin próxima acción", level: "amber", title: o.name || "Oportunidad", detail: o.accounts?.name || "Pipeline abierto", page: "opportunities" });
      if (open && d !== null && d <= 7) rows.push({ type: "Cierre cercano", level: d < 0 ? "red" : "blue", title: o.name || "Oportunidad", detail: d < 0 ? `${Math.abs(d)} días vencida` : `Cierra en ${d} días`, page: "opportunities" });
    });
    data.tenders.forEach(t => {
      const d = daysUntil(t.due_date);
      if (d !== null && d <= 7) rows.push({ type: "Licitación crítica", level: d < 0 ? "red" : "blue", title: t.institution || t.process_name || "Licitación", detail: d < 0 ? `${Math.abs(d)} días vencida` : `Vence en ${d} días`, page: "tenders" });
      if (!t.next_action) rows.push({ type: "Licitación sin acción", level: "slate", title: t.institution || t.process_name || "Licitación", detail: t.status || "Sin seguimiento definido", page: "tenders" });
    });
    data.profiles.forEach(p => {
      if (!p.approved || p.is_active === false) rows.push({ type: "Usuario pendiente", level: "green", title: p.full_name || p.email || "Usuario", detail: p.role || "Sin rol", page: "adminUsers" });
    });
    return rows;
  }, [data]);

  const urgent = alerts.filter(a => a.level === "red").length;
  const warn = alerts.filter(a => a.level === "amber" || a.level === "blue").length;
  const users = alerts.filter(a => a.type === "Usuario pendiente").length;

  return (
    <Layout title="Centro de Alertas" profile={profile} onNavigate={onNavigate}>
      <div className="notif-page">
        <ModuleHeader
          title="Centro de Alertas"
          subtitle="Visitas, licitaciones, oportunidades y usuarios pendientes en una sola bandeja."
          actions={<button className="notif-refresh" onClick={load}>{loading ? "Actualizando..." : "Actualizar"}</button>}
        />
        <section className="notif-kpis">
          <MetricKpi label="Alertas totales" value={alerts.length} />
          <MetricKpi label="Urgentes" value={urgent} accent="red" />
          <MetricKpi label="Atención" value={warn} accent="amber" />
          <MetricKpi label="Usuarios pendientes" value={users} accent="green" />
        </section>
        <section className="notif-list">
          {loading ? (
            <EmptyState title="Cargando alertas" text="Revisando señales comerciales del CRM." />
          ) : alerts.length === 0 ? (
            <EmptyState title="Sin alertas pendientes" text="No hay vencimientos ni bloqueos relevantes en este momento." />
          ) : alerts.map((alert, idx) => (
            <button key={`${alert.type}-${idx}`} className={`notif-item notif-item--${alert.level}`} onClick={() => onNavigate(alert.page)}>
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
