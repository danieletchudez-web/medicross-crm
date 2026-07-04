import { useEffect, useMemo, useState } from "react";
import Layout from "../components/Layout";
import { EmptyState, MetricKpi, ModuleHeader } from "../components/CRMUI";
import { supabase } from "../lib/supabaseClient";
import "./opportunities.css";

const EMPTY_FORM = {
  id: null,
  name: "",
  account_id: "",
  product_id: "",
  campaign_id: "",
  stage: "Cotización",
  amount: "",
  probability: "",
  expected_close: "",
  next_action: "",
};

const STAGES = ["Lead","Contactado","Reunión","Demo","Cotización","Negociación","Ganado","Perdido"];
const DEFAULT_STAGE_CONFIG = STAGES.map((name, index) => ({ name, probability: [10,20,35,50,65,80,100,0][index] }));

const STAGE_COLOR = {
  "Lead":        "#64748b",
  "Contactado":  "#3b82f6",
  "Reunión":     "#6366f1",
  "Demo":        "#f59e0b",
  "Cotización":  "#f97316",
  "Negociación": "#ef4444",
  "Ganado":      "#10b981",
  "Perdido":     "#94a3b8",
};

function money(value) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(Number(value || 0));
}
function moneyCompact(value) {
  const n = Number(value || 0);
  if (n >= 1_000_000) return `$ ${(n / 1_000_000).toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M`;
  if (n >= 1_000)     return `$ ${(n / 1_000).toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k`;
  return `$ ${n.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;
}

function activityInfo(opportunity) {
  const value = [opportunity.last_movement_at, opportunity.updated_at, opportunity.created_at]
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a))[0];
  const days = value ? Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86400000)) : 0;
  if (days > 30) return { label: "Fría", level: "cold", days };
  if (days >= 15) return { label: "Tibia", level: "warm", days };
  return { label: "Activa", level: "active", days };
}

export default function OpportunitiesPage({ profile, onNavigate, navigationData }) {
  const [opportunities, setOpportunities] = useState([]);
  const [accounts, setAccounts]           = useState([]);
  const [products, setProducts]           = useState([]);
  const [campaigns, setCampaigns]         = useState([]);
  const [form, setForm]                   = useState(EMPTY_FORM);
  const [loading, setLoading]             = useState(false);
  const [filter, setFilter]               = useState("todas"); // ← default "todas"
  const [viewMode, setViewMode]           = useState("table");
  const [draggingId, setDraggingId]       = useState(null);
  const [dragOverStage, setDragOverStage] = useState(null);
  const [movingId, setMovingId]           = useState(null);
  const [stageConfig, setStageConfig]     = useState(DEFAULT_STAGE_CONFIG);
  const [pendingMove, setPendingMove]     = useState(null);

  useEffect(() => { loadData(); }, []);
  useEffect(() => {
    if (navigationData?.action === "create" && navigationData?.accountId) {
      setForm((current) => ({ ...current, account_id: navigationData.accountId }));
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [navigationData]);

  async function loadData() {
    const [oppRes, accRes, prodRes, campRes, configRes] = await Promise.all([
      supabase.from("opportunities").select("*, accounts(name), products(name, line), campaigns(name)").order("created_at", { ascending: false }),
      supabase.from("accounts").select("*").order("name"),
      supabase.from("products").select("*").order("name"),
      supabase.from("campaigns").select("*").order("name"),
      supabase.from("crm_settings").select("value").eq("key", "pipeline_stages").maybeSingle(),
    ]);
    setOpportunities(oppRes.data || []);
    setAccounts(accRes.data || []);
    setProducts(prodRes.data || []);
    setCampaigns(campRes.data || []);
    if (Array.isArray(configRes.data?.value) && configRes.data.value.length) setStageConfig(configRes.data.value);
  }

  const metrics = useMemo(() => {
    const open     = opportunities.filter((o) => !["Ganado","Perdido"].includes(o.stage));
    const pipeline = open.reduce((s, o) => s + Number(o.amount || 0), 0);
    const forecast = open.reduce((s, o) => s + (Number(o.amount || 0) * Number(o.probability || 0)) / 100, 0);
    const won      = opportunities.filter((o) => o.stage === "Ganado").length;
    const lost     = opportunities.filter((o) => o.stage === "Perdido").length;
    const winRate  = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null;
    const noAction = open.filter((o) => !o.next_action).length;
    const wonAmount = opportunities.filter((o) => o.stage === "Ganado").reduce((s, o) => s + Number(o.amount || 0), 0);
    return { pipeline, forecast, open: open.length, noAction, won, lost, winRate, wonAmount };
  }, [opportunities]);

  const filteredOpps = useMemo(() => {
    if (filter === "activas")  return opportunities.filter((o) => !["Ganado","Perdido"].includes(o.stage));
    if (filter === "ganadas")  return opportunities.filter((o) => o.stage === "Ganado");
    if (filter === "perdidas") return opportunities.filter((o) => o.stage === "Perdido");
    return opportunities; // "todas"
  }, [opportunities, filter]);

  async function saveOpportunity(e) {
    e.preventDefault();
    setLoading(true);
    const selectedProduct = products.find((p) => p.id === form.product_id);
    const payload = {
      name:            form.name,
      account_id:      form.account_id || null,
      product_id:      form.product_id || null,
      campaign_id:     form.campaign_id || null,
      product_line:    selectedProduct?.line || null,
      stage:           form.stage,
      amount:          Number(form.amount || 0),
      forecast_amount: Math.round((Number(form.amount || 0) * Number(form.probability || 0)) / 100),
      probability:     Number(form.probability || 0),
      expected_close:  form.expected_close || null,
      next_action:     form.next_action,
      owner_id:        profile?.id || null,
      updated_at:      new Date().toISOString(),
    };
    const result = form.id
      ? await supabase.from("opportunities").update(payload).eq("id", form.id)
      : await supabase.from("opportunities").insert([payload]);
    if (result.error) { alert("Error: " + result.error.message); setLoading(false); return; }
    setForm(EMPTY_FORM);
    setLoading(false);
    loadData();
  }

  async function quickClose(id, stage) {
    const label = stage === "Ganado" ? "ganada" : "perdida";
    if (!confirm(`¿Marcar esta oportunidad como ${label}?`)) return;
    await supabase.from("opportunities").update({ stage, updated_at: new Date().toISOString() }).eq("id", id);
    loadData();
  }

  async function reopen(id) {
    if (!confirm("¿Reabrir esta oportunidad?")) return;
    await supabase.from("opportunities").update({ stage: "Cotización", updated_at: new Date().toISOString() }).eq("id", id);
    loadData();
  }

  async function moveOpportunityToStage(id, nextStage, moveData) {
    const current = opportunities.find((o) => o.id === id);
    if (!current || current.stage === nextStage || movingId === id) return;

    const previous = opportunities;
    const updatedAt = new Date().toISOString();
    const probability = Number(moveData.probability || 0);
    setMovingId(id);
    setOpportunities((items) =>
      items.map((o) => o.id === id ? { ...o, stage: nextStage, next_action: moveData.next_action, next_action_date: moveData.next_action_date, probability, forecast_amount: Math.round(Number(o.amount || 0) * probability / 100), updated_at: updatedAt, last_movement_at: updatedAt } : o)
    );

    const { error } = await supabase
      .from("opportunities")
      .update({ stage: nextStage, next_action: moveData.next_action, next_action_date: moveData.next_action_date, probability, forecast_amount: Math.round(Number(current.amount || 0) * probability / 100), updated_at: updatedAt, last_movement_at: updatedAt })
      .eq("id", id);

    setMovingId(null);
    if (error) {
      setOpportunities(previous);
      alert("Error moviendo oportunidad: " + error.message);
    }
  }

  function handleKanbanDragStart(e, id) {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(id));
  }

  function handleKanbanDragEnd() {
    setDraggingId(null);
    setDragOverStage(null);
  }

  function handleKanbanDragOver(e, stage) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverStage(stage);
  }

  function handleKanbanDrop(e, stage) {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || draggingId;
    setDraggingId(null);
    setDragOverStage(null);
    const opportunity = opportunities.find((item) => item.id === id);
    if (!opportunity || opportunity.stage === stage) return;
    const defaultProbability = stageConfig.find((item) => item.name === stage)?.probability ?? opportunity.probability ?? 0;
    setPendingMove({ id, stage, name: opportunity.name, next_action: opportunity.next_action || "", next_action_date: opportunity.next_action_date || "", probability: defaultProbability });
  }

  async function confirmMove(e) {
    e.preventDefault();
    if (!pendingMove?.next_action.trim() || !pendingMove?.next_action_date) return;
    const draft = pendingMove;
    setPendingMove(null);
    await moveOpportunityToStage(draft.id, draft.stage, draft);
  }

  function editOpportunity(o) {
    setForm({
      id:             o.id,
      name:           o.name || "",
      account_id:     o.account_id || "",
      product_id:     o.product_id || "",
      campaign_id:    o.campaign_id || "",
      stage:          o.stage || "Cotización",
      amount:         o.amount || "",
      probability:    o.probability || "",
      expected_close: o.expected_close || "",
      next_action:    o.next_action || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteOpportunity(id) {
    if (!confirm("¿Seguro que querés borrar esta oportunidad?")) return;
    const { error } = await supabase.from("opportunities").delete().eq("id", id);
    if (error) { alert("Error borrando: " + error.message); return; }
    loadData();
  }

  const TABS = [
    { key: "todas",    label: `Todas (${opportunities.length})` },
    { key: "activas",  label: `Activas (${opportunities.filter((o) => !["Ganado","Perdido"].includes(o.stage)).length})` },
    { key: "ganadas",  label: `Ganadas (${metrics.won})` },
    { key: "perdidas", label: `Perdidas (${metrics.lost})` },
  ];

  return (
    <Layout title="Oportunidades" profile={profile} onNavigate={onNavigate}>
      <div className="p-page">

        {/* METRICS PANEL */}
        <div className="p-panel">
          <div className="p-hd">
            <div className="p-hd-left">
              <span className="p-title">Oportunidades</span>
              <span className="p-sub">Pipeline comercial con forecast, probabilidad y próximas acciones.</span>
            </div>
          </div>
          <div className="p-metrics">
            <div className="p-metric">
              <span className="p-metric__ey">Pipeline abierto</span>
              <span className="p-metric__val">{moneyCompact(metrics.pipeline)}</span>
              <span className="p-metric__sub">{money(metrics.pipeline)}</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Forecast ponderado</span>
              <span className="p-metric__val">{moneyCompact(metrics.forecast)}</span>
              <span className="p-metric__sub">Monto x probabilidad</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Opps. abiertas</span>
              <span className="p-metric__val">{metrics.open}</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Sin próxima acción</span>
              <span className="p-metric__val p-metric__down">{metrics.noAction}</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Ganadas</span>
              <span className="p-metric__val p-metric__up">{metrics.won}</span>
              {metrics.won > 0 && <span className="p-metric__sub">{moneyCompact(metrics.wonAmount)}</span>}
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Perdidas</span>
              <span className="p-metric__val">{metrics.lost}</span>
            </div>
            <div className="p-metric">
              <span className="p-metric__ey">Win rate</span>
              <span className={`p-metric__val ${metrics.winRate !== null && metrics.winRate >= 50 ? "p-metric__up" : metrics.winRate !== null ? "p-metric__down" : ""}`}>
                {metrics.winRate !== null ? `${metrics.winRate}%` : "—"}
              </span>
              {metrics.winRate === null && <span className="p-metric__sub">Cargá resultados</span>}
            </div>
          </div>
        </div>

        {/* FORM PANEL */}
        <div className="p-panel">
          <div className="p-hd">
            <div className="p-hd-left">
              <span className="p-title">{form.id ? "Editar oportunidad" : "Nueva oportunidad"}</span>
              <span className="p-sub">El forecast se calcula automáticamente: monto × probabilidad.</span>
            </div>
            {form.id && (
              <div className="p-hd-right">
                <button className="p-btn p-btn--ghost" onClick={() => setForm(EMPTY_FORM)}>Cancelar edición</button>
              </div>
            )}
          </div>
          <div className="p-body">
            <form className="p-form" onSubmit={saveOpportunity}>
              <div className="p-field p-field--span2">
                <label>Nombre oportunidad</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej: EchoLaser Hospital Italiano" required />
              </div>
              <div className="p-field">
                <label>Cliente</label>
                <select className="p-select" value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })} required>
                  <option value="">Seleccionar cliente</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div className="p-field">
                <label>Producto</label>
                <select className="p-select" value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}>
                  <option value="">Seleccionar producto</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.line}</option>)}
                </select>
              </div>
              <div className="p-field">
                <label>Campaña</label>
                <select className="p-select" value={form.campaign_id} onChange={(e) => setForm({ ...form, campaign_id: e.target.value })}>
                  <option value="">Sin campaña</option>
                  {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="p-field">
                <label>Etapa</label>
                <select className="p-select" value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
                  {stageConfig.map((item) => <option key={item.name}>{item.name}</option>)}
                </select>
              </div>
              <div className="p-field">
                <label>Monto total ARS</label>
                <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="1200000" />
              </div>
              <div className="p-field">
                <label>Probabilidad %</label>
                <input type="number" min="0" max="100" value={form.probability} onChange={(e) => setForm({ ...form, probability: e.target.value })} placeholder="70" />
              </div>
              <div className="p-field">
                <label>Fecha estimada cierre</label>
                <input type="date" value={form.expected_close} onChange={(e) => setForm({ ...form, expected_close: e.target.value })} />
              </div>
              {form.amount && form.probability && (
                <div className="p-field">
                  <label>Forecast ponderado</label>
                  <span style={{ color: "#fff", fontSize: 14, fontWeight: 600, paddingTop: 6, display: "block" }}>
                    {money((Number(form.amount) * Number(form.probability)) / 100)}
                  </span>
                </div>
              )}
              <div className="p-field p-field--span3">
                <label>Próxima acción</label>
                <input value={form.next_action} onChange={(e) => setForm({ ...form, next_action: e.target.value })} placeholder="Ej: llamar a compras, enviar cotización, coordinar demo..." />
              </div>
              <div className="p-form-actions">
                <button className="p-btn p-btn--primary" disabled={loading}>
                  {loading ? "Guardando..." : form.id ? "Guardar cambios" : "Crear oportunidad"}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* PIPELINE PANEL */}
        <div className="p-panel">
          <div className="p-hd">
            <div className="p-hd-left">
              <span className="p-title">Pipeline comercial</span>
              <span className="p-sub">Todas las oportunidades — activas, ganadas y perdidas.</span>
            </div>
            <div className="p-hd-right">
              <nav className="p-tabs">
                <button className={`p-tab ${viewMode === "table" ? "p-tab--active" : ""}`} onClick={() => setViewMode("table")}>Tabla</button>
                <button className={`p-tab ${viewMode === "kanban" ? "p-tab--active" : ""}`} onClick={() => setViewMode("kanban")}>Kanban</button>
              </nav>
            </div>
          </div>

          <div className="p-toolbar p-toolbar--top">
            <nav className="p-pills">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  className={`p-pill ${filter === t.key ? "p-pill--active" : ""}`}
                  onClick={() => setFilter(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          </div>

          {viewMode === "kanban" && (
            <div className="p-body">
              <div className="p-kanban">
                {stageConfig.map(({ name: stage }) => {
                  const rows = filteredOpps.filter(o => o.stage === stage);
                  const totalStage = rows.reduce((sum, o) => sum + Number(o.amount || 0), 0);
                  return (
                    <div
                      key={stage}
                      className={`p-kanban-col ${dragOverStage === stage ? "opp-kanban-col--over" : ""}`}
                      onDragOver={(e) => handleKanbanDragOver(e, stage)}
                      onDragLeave={() => setDragOverStage((current) => current === stage ? null : current)}
                      onDrop={(e) => handleKanbanDrop(e, stage)}
                    >
                      <div className="p-kanban-hd">
                        <strong>{stage}</strong>
                        <span>{rows.length} · {money(totalStage)}</span>
                      </div>
                      {rows.length === 0 ? (
                        <p className="p-empty">Sin oportunidades</p>
                      ) : rows.map(o => (
                        (() => {
                          const activity = activityInfo(o);
                          return (
                            <div
                              key={o.id}
                              className={`p-kanban-card ${draggingId === o.id ? "opp-kanban-card--dragging" : ""} ${movingId === o.id ? "opp-kanban-card--moving" : ""}`}
                              draggable
                              onDragStart={(e) => handleKanbanDragStart(e, o.id)}
                              onDragEnd={handleKanbanDragEnd}
                            >
                              <strong style={{ display: "block", fontSize: 13, color: "#fff", marginBottom: 2 }}>{o.name}</strong>
                              <span style={{ display: "block", fontSize: 11.5, color: "#9ca3af", marginBottom: 4 }}>{o.accounts?.name || "Sin cliente"}</span>
                              <span style={{ display: "block", fontSize: 11, color: "#9ca3af", marginBottom: 2 }}>{money(o.amount)} · {o.probability || 0}%</span>
                              <span className={`p-dot--${activity.level === "active" ? "green" : activity.level === "warm" ? "amber" : "gray"}`} style={{ fontSize: 11, marginRight: 4 }}></span>
                              <span style={{ fontSize: 11, color: "#9ca3af" }}>{activity.label} · sin actividad: {activity.days}d</span>
                              <div className="p-row__actions" style={{ marginTop: 8, display: "flex", gap: 6 }}>
                                <span style={{ fontSize: 11, color: "#6b7280" }}>Arrastrar</span>
                                <button className="p-btn p-btn--ghost" style={{ fontSize: 11, padding: "2px 8px", height: "auto" }} onClick={() => editOpportunity(o)}>Editar</button>
                              </div>
                            </div>
                          );
                        })()
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {viewMode === "table" && (
            <div className="p-table-wrap">
              <table className="p-table">
                <thead>
                  <tr>
                    <th>Oportunidad</th>
                    <th>Cliente</th>
                    <th>Etapa</th>
                    <th>Monto</th>
                    <th>Prob.</th>
                    <th>Forecast</th>
                    <th>Cierre</th>
                    <th>Próxima acción</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOpps.length === 0 ? (
                    <tr>
                      <td colSpan="9" className="p-empty">
                        Sin oportunidades para este filtro. Cambiá el filtro o cargá una nueva oportunidad desde el formulario superior.
                      </td>
                    </tr>
                  ) : filteredOpps.map((o) => {
                    const isOpen   = !["Ganado","Perdido"].includes(o.stage);
                    const isWon    = o.stage === "Ganado";
                    const isLost   = o.stage === "Perdido";
                    const weighted = (Number(o.amount || 0) * Number(o.probability || 0)) / 100;
                    const overdue  = o.expected_close && new Date(o.expected_close) < new Date() && isOpen;

                    let stageClass = "";
                    if (isWon)       stageClass = "p-badge--green";
                    else if (isLost) stageClass = "p-badge--gray";
                    else if (o.stage === "Lead")        stageClass = "p-badge--gray";
                    else if (o.stage === "Contactado")  stageClass = "p-badge--blue";
                    else if (o.stage === "Reunión")     stageClass = "p-badge--purple";
                    else if (o.stage === "Demo")        stageClass = "p-badge--amber";
                    else if (o.stage === "Cotización")  stageClass = "p-badge--amber";
                    else if (o.stage === "Negociación") stageClass = "p-badge--red";
                    else stageClass = "p-badge--gray";

                    const activity = activityInfo(o);

                    return (
                      <tr key={o.id}>
                        <td>
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <strong style={{ color: "#fff", fontSize: 13 }}>{o.name}</strong>
                            <span style={{ fontSize: 11, color: "#9ca3af" }}>{o.product_line || o.products?.line || "—"} · {o.campaigns?.name || "—"}</span>
                            <span style={{ fontSize: 11, color: activity.level === "active" ? "#10b981" : activity.level === "warm" ? "#f59e0b" : "#94a3b8" }}>
                              {activity.label} · sin actividad: {activity.days}d
                            </span>
                          </div>
                        </td>
                        <td>{o.accounts?.name || "—"}</td>
                        <td>
                          <span className={`p-badge ${stageClass}`}>{o.stage}</span>
                        </td>
                        <td>{money(o.amount)}</td>
                        <td style={{ textAlign: "center" }}>{o.probability ? `${o.probability}%` : "—"}</td>
                        <td>{isOpen ? money(weighted) : "—"}</td>
                        <td style={{ color: overdue ? "#ef4444" : undefined }}>
                          {o.expected_close ? new Date(o.expected_close).toLocaleDateString("es-AR") : "—"}
                        </td>
                        <td>{o.next_action || <span style={{ color: "#6b7280", fontStyle: "italic" }}>Sin acción</span>}</td>
                        <td>
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            {isOpen && <button className="p-btn p-btn--ghost" onClick={() => editOpportunity(o)}>Editar</button>}
                            {isOpen && <button className="p-btn p-btn--ghost" onClick={() => quickClose(o.id, "Ganado")}>Ganado</button>}
                            {isOpen && <button className="p-btn p-btn--ghost" onClick={() => quickClose(o.id, "Perdido")}>Perdido</button>}
                            {!isOpen && <button className="p-btn p-btn--ghost" onClick={() => reopen(o.id)}>Reabrir</button>}
                            <button className="p-btn p-btn--danger" onClick={() => deleteOpportunity(o.id)}>Borrar</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {pendingMove && (
          <div className="opp-move-backdrop" role="presentation" onMouseDown={() => setPendingMove(null)}>
            <form className="opp-move-modal" onSubmit={confirmMove} onMouseDown={(event) => event.stopPropagation()}>
              <span className="opp-move-modal__eyebrow">Actualizar pipeline</span>
              <h3>Mover a {pendingMove.stage}</h3>
              <p>{pendingMove.name}</p>
              <label>Próxima acción
                <textarea value={pendingMove.next_action} onChange={(event) => setPendingMove({ ...pendingMove, next_action: event.target.value })} placeholder="Ej: enviar propuesta revisada" required />
              </label>
              <label>Fecha próxima acción
                <input type="date" value={pendingMove.next_action_date} onChange={(event) => setPendingMove({ ...pendingMove, next_action_date: event.target.value })} required />
              </label>
              <label>Probabilidad %
                <input type="number" min="0" max="100" value={pendingMove.probability} onChange={(event) => setPendingMove({ ...pendingMove, probability: event.target.value })} required />
              </label>
              <div className="opp-move-modal__actions">
                <button type="button" className="p-btn p-btn--ghost" onClick={() => setPendingMove(null)}>Cancelar</button>
                <button className="p-btn p-btn--primary">Confirmar movimiento</button>
              </div>
            </form>
          </div>
        )}

        <footer style={{ textAlign: "center", padding: "12px 0", fontSize: 11, color: "#4b5563" }}>
          <a href="https://www.linkedin.com/in/danieletchudez/" target="_blank" rel="noreferrer" style={{ color: "#4b5563", textDecoration: "none" }}>Designed by Daniel Etchudez</a>
        </footer>

      </div>
    </Layout>
  );
}
