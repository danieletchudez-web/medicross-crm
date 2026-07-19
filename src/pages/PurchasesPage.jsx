import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Inbox, RefreshCw, Search, UserCheck, Users } from "lucide-react";
import Layout from "../components/Layout";
import QuotationWorkflow from "./cotizador/QuotationWorkflow";
import { getWorkflowConfig, getWorkflowMetrics } from "../services/quotationWorkflow";
import "./purchases.css";

const activeStates = ["pendiente_costos", "en_gestion_compras", "costos_parciales", "revision_solicitada"];
const statusLabel = value => ({
  pendiente_costos: "Nueva", en_gestion_compras: "En gestión", costos_parciales: "Costos parciales",
  costos_completos: "Costos completos", revision_solicitada: "Revisión solicitada",
  definicion_comercial: "Definición comercial", lista_para_licitaciones: "Lista para Licitaciones",
}[value] || String(value || "Sin estado").replaceAll("_", " "));
const dateLabel = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString("es-AR") : "—";

export default function PurchasesPage({ profile, onNavigate, navigationData, pageKey }) {
  const [rows, setRows] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(navigationData?.recordId || navigationData?.quoteId || null);
  const [filters, setFilters] = useState({ search: "", status: profile?.department === "compras" ? "active" : "", priority: "", owner: "all", deadline: "" });
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [config, metrics] = await Promise.all([getWorkflowConfig(), getWorkflowMetrics()]);
      if (!config.enabled) throw new Error("El flujo colaborativo no está habilitado.");
      setRows(metrics || []);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load, pageKey]);
  useEffect(() => {
    const incoming = navigationData?.recordId || navigationData?.quoteId;
    if (incoming) setSelectedId(incoming);
  }, [navigationData]);

  const stats = useMemo(() => {
    const now = new Date(), soon = new Date(Date.now() + 3 * 86400000);
    return {
      fresh: rows.filter(r => r.workflow_status === "pendiente_costos").length,
      pending: rows.filter(r => activeStates.includes(r.workflow_status)).length,
      managing: rows.filter(r => r.workflow_status === "en_gestion_compras").length,
      partial: rows.filter(r => r.workflow_status === "costos_parciales").length,
      complete: rows.filter(r => r.workflow_status === "costos_completos").length,
      urgent: rows.filter(r => r.priority === "urgente").length,
      due: rows.filter(r => r.internal_deadline && new Date(`${r.internal_deadline}T23:59:59`) >= now && new Date(`${r.internal_deadline}T23:59:59`) <= soon).length,
      mine: rows.filter(r => r.purchasing_owner_id === profile?.id).length,
      unassigned: rows.filter(r => activeStates.includes(r.workflow_status) && !r.purchasing_owner_id).length,
    };
  }, [rows, profile?.id]);

  const visible = useMemo(() => rows.filter(row => {
    const needle = filters.search.trim().toLowerCase();
    if (needle && ![row.quote_num_formatted, row.institucion].some(value => String(value || "").toLowerCase().includes(needle))) return false;
    if (filters.status === "active" && !activeStates.includes(row.workflow_status)) return false;
    if (filters.status === "pending_send" && row.workflow_status) return false;
    if (filters.status && !["active", "pending_send"].includes(filters.status) && row.workflow_status !== filters.status) return false;
    if (filters.priority && row.priority !== filters.priority) return false;
    if (filters.owner === "mine" && row.purchasing_owner_id !== profile?.id) return false;
    if (filters.owner === "unassigned" && row.purchasing_owner_id) return false;
    if (filters.deadline && row.internal_deadline !== filters.deadline) return false;
    return true;
  }).sort((a, b) => {
    const weight = value => value === "urgente" ? 0 : value === "alta" ? 1 : 2;
    return weight(a.priority) - weight(b.priority) || String(a.internal_deadline || "9999").localeCompare(String(b.internal_deadline || "9999"));
  }), [rows, filters, profile?.id]);

  if (selectedId) return <Layout title="Compras" profile={profile} onNavigate={onNavigate} pageKey={pageKey}>
    <div className="p-page purchases-page">
      <button className="p-btn p-btn--ghost purchases-back" onClick={() => { setSelectedId(null); load(); }}>← Volver a solicitudes</button>
      <QuotationWorkflow quotationId={selectedId} profile={profile} context="purchases" />
    </div>
  </Layout>;

  const cards = [
    ["Nuevas", stats.fresh, Inbox], ["Pendientes", stats.pending, Clock3], ["En gestión", stats.managing, UserCheck],
    ["Parciales", stats.partial, AlertTriangle], ["Completas", stats.complete, CheckCircle2], ["Urgentes", stats.urgent, AlertTriangle],
    ["Próximos vencimientos", stats.due, Clock3], ["Asignadas a mí", stats.mine, UserCheck], ["Sin asignar", stats.unassigned, Users],
  ];
  return <Layout title="Compras" profile={profile} onNavigate={onNavigate} pageKey={pageKey}>
    <div className="p-page purchases-page">
      <section className="purchases-hero"><div><span>Centro operativo</span><h2>Solicitudes de costos</h2><p>Costos, proveedores, disponibilidad y documentación en una sola bandeja.</p></div><button className="p-btn p-btn--ghost" onClick={load} disabled={loading}><RefreshCw size={15}/> Actualizar</button></section>
      <section className="purchases-kpis">{cards.map(([label, value, Icon]) => <article key={label}><Icon size={16}/><div><b>{value}</b><span>{label}</span></div></article>)}</section>
      <section className="purchases-panel">
        <div className="purchases-filters">
          <label className="purchases-search"><Search size={15}/><input placeholder="Buscar número o institución…" value={filters.search} onChange={e => setFilters({ ...filters, search: e.target.value })}/></label>
          <select value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}><option value="">Todas las cotizaciones</option><option value="active">Solicitudes activas</option><option value="pending_send">Sin enviar a Compras</option><option value="pendiente_costos">Nuevas</option><option value="en_gestion_compras">En gestión</option><option value="costos_parciales">Parciales</option><option value="costos_completos">Completas</option></select>
          <select value={filters.priority} onChange={e => setFilters({ ...filters, priority: e.target.value })}><option value="">Todas las prioridades</option><option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option></select>
          <select value={filters.owner} onChange={e => setFilters({ ...filters, owner: e.target.value })}><option value="all">Todos los responsables</option><option value="mine">Mis solicitudes</option><option value="unassigned">Sin asignar</option></select>
          <input type="date" aria-label="Fecha límite" value={filters.deadline} onChange={e => setFilters({ ...filters, deadline: e.target.value })}/>
        </div>
        {error ? <div className="purchases-state purchases-state--error">{error}</div> : loading ? <div className="purchases-state">Cargando solicitudes…</div> : !visible.length ? <div className="purchases-state"><Inbox size={24}/><b>No hay solicitudes para estos filtros</b><span>Las cotizaciones enviadas desde Ventas aparecerán aquí.</span></div> : <div className="purchases-table-wrap"><table className="purchases-table"><thead><tr><th>Número</th><th>Institución</th><th>Fecha límite</th><th>Progreso</th><th>Estado</th><th>Prioridad</th><th>Gestión</th></tr></thead><tbody>{visible.map(row => { const total = Number(row.total_items || 0), ready = Number(row.available_items || 0); return <tr key={row.quotation_id} onClick={() => setSelectedId(row.quotation_id)}><td><b>#{row.quote_num_formatted || "—"}</b></td><td>{row.institucion || "Sin institución"}</td><td>{dateLabel(row.internal_deadline)}</td><td><div className="purchases-progress"><span>{ready}/{total}</span><i><i style={{ width: `${total ? ready / total * 100 : 0}%` }}/></i></div></td><td><span className="purchases-badge">{statusLabel(row.workflow_status)}</span></td><td><span className={`purchases-priority purchases-priority--${row.priority || "normal"}`}>{row.priority || "normal"}</span></td><td>{row.purchasing_owner_id === profile?.id ? "Asignada a mí" : row.purchasing_owner_id ? "Asignada" : "Sin asignar"}</td></tr>; })}</tbody></table></div>}
      </section>
    </div>
  </Layout>;
}
