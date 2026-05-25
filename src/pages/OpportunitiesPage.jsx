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

export default function OpportunitiesPage({ profile, onNavigate }) {
  const [opportunities, setOpportunities] = useState([]);
  const [accounts, setAccounts]           = useState([]);
  const [products, setProducts]           = useState([]);
  const [campaigns, setCampaigns]         = useState([]);
  const [form, setForm]                   = useState(EMPTY_FORM);
  const [loading, setLoading]             = useState(false);
  const [filter, setFilter]               = useState("todas"); // ← default "todas"

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    const [oppRes, accRes, prodRes, campRes] = await Promise.all([
      supabase.from("opportunities").select("*, accounts(name), products(name, line), campaigns(name)").order("created_at", { ascending: false }),
      supabase.from("accounts").select("*").order("name"),
      supabase.from("products").select("*").order("name"),
      supabase.from("campaigns").select("*").order("name"),
    ]);
    setOpportunities(oppRes.data || []);
    setAccounts(accRes.data || []);
    setProducts(prodRes.data || []);
    setCampaigns(campRes.data || []);
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
    { key: "ganadas",  label: `✓ Ganadas (${metrics.won})` },
    { key: "perdidas", label: `✗ Perdidas (${metrics.lost})` },
  ];

  return (
    <Layout title="Oportunidades" profile={profile} onNavigate={onNavigate}>
      <div className="opp-page">
        <ModuleHeader
          title="Oportunidades"
          subtitle="Pipeline comercial con forecast, probabilidad y próximas acciones."
        />

        {/* KPIs */}
        <section className="opp-kpis">
          <MetricKpi label="Pipeline abierto"   value={money(metrics.pipeline)} />
          <MetricKpi label="Forecast ponderado" value={money(metrics.forecast)} sub="Monto x probabilidad" />
          <MetricKpi label="Opps. abiertas"     value={metrics.open} />
          <MetricKpi label="Sin próxima acción" value={metrics.noAction} accent="red" />
          <MetricKpi label="Ganadas"            value={metrics.won}  accent="green" sub={metrics.won > 0 ? money(metrics.wonAmount) : undefined} />
          <MetricKpi label="Perdidas"           value={metrics.lost} accent="slate" />
          <MetricKpi
            label="Win rate"
            value={metrics.winRate !== null ? `${metrics.winRate}%` : "—"}
            accent={metrics.winRate >= 50 ? "green" : metrics.winRate !== null ? "amber" : undefined}
            sub={metrics.winRate === null ? "Cargá resultados" : undefined}
          />
        </section>

        {/* FORM */}
        <section className="opp-form-card">
          <div className="opp-form-head">
            <div>
              <h2>{form.id ? "Editar oportunidad" : "Nueva oportunidad"}</h2>
              <p>El forecast se calcula automáticamente: monto × probabilidad.</p>
            </div>
            {form.id && <button className="opp-ghost-btn" onClick={() => setForm(EMPTY_FORM)}>Cancelar edición</button>}
          </div>

          <form className="opp-form" onSubmit={saveOpportunity}>
            <div>
              <label>Nombre oportunidad</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej: EchoLaser Hospital Italiano" required />
            </div>
            <div>
              <label>Cliente</label>
              <select value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })} required>
                <option value="">Seleccionar cliente</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label>Producto</label>
              <select value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}>
                <option value="">Seleccionar producto</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.line}</option>)}
              </select>
            </div>
            <div>
              <label>Campaña</label>
              <select value={form.campaign_id} onChange={(e) => setForm({ ...form, campaign_id: e.target.value })}>
                <option value="">Sin campaña</option>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label>Etapa</label>
              <select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
                {STAGES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label>Monto total ARS</label>
              <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="1200000" />
            </div>
            <div>
              <label>Probabilidad %</label>
              <input type="number" min="0" max="100" value={form.probability} onChange={(e) => setForm({ ...form, probability: e.target.value })} placeholder="70" />
            </div>
            <div>
              <label>Fecha estimada cierre</label>
              <input type="date" value={form.expected_close} onChange={(e) => setForm({ ...form, expected_close: e.target.value })} />
            </div>
            {form.amount && form.probability && (
              <div className="opp-forecast-preview">
                <span>Forecast ponderado</span>
                <strong>{money((Number(form.amount) * Number(form.probability)) / 100)}</strong>
              </div>
            )}
            <div className="opp-form__wide">
              <label>Próxima acción</label>
              <input value={form.next_action} onChange={(e) => setForm({ ...form, next_action: e.target.value })} placeholder="Ej: llamar a compras, enviar cotización, coordinar demo..." />
            </div>
            <button className="opp-submit" disabled={loading}>
              {loading ? "Guardando..." : form.id ? "Guardar cambios" : "Crear oportunidad"}
            </button>
          </form>
        </section>

        {/* TABLA */}
        <section className="opp-table-card">
          <div className="opp-table-head">
            <div>
              <h2>Pipeline comercial</h2>
              <p>Todas las oportunidades — activas, ganadas y perdidas.</p>
            </div>
            <div className="opp-filter-tabs">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  className={`opp-tab ${filter === t.key ? "opp-tab--active" : ""} ${t.key === "ganadas" ? "opp-tab--won" : ""} ${t.key === "perdidas" ? "opp-tab--lost" : ""}`}
                  onClick={() => setFilter(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="opp-table-wrap">
            <table className="opp-table">
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
                    <td colSpan="9" className="opp-empty">
                      <EmptyState
                        title="Sin oportunidades para este filtro"
                        text="Cambiá el filtro o cargá una nueva oportunidad desde el formulario superior."
                      />
                    </td>
                  </tr>
                ) : filteredOpps.map((o) => {
                  const isOpen   = !["Ganado","Perdido"].includes(o.stage);
                  const isWon    = o.stage === "Ganado";
                  const isLost   = o.stage === "Perdido";
                  const weighted = (Number(o.amount || 0) * Number(o.probability || 0)) / 100;
                  const overdue  = o.expected_close && new Date(o.expected_close) < new Date() && isOpen;

                  let rowClass = "";
                  if (isWon)    rowClass = "opp-row--won";
                  else if (isLost)   rowClass = "opp-row--lost";
                  else if (overdue)  rowClass = "opp-row--overdue";

                  return (
                    <tr key={o.id} className={rowClass}>
                      <td className="opp-td-name">
                        <strong>{o.name}</strong>
                        <small>{o.product_line || o.products?.line || "—"} · {o.campaigns?.name || "—"}</small>
                      </td>
                      <td>{o.accounts?.name || "—"}</td>
                      <td>
                        <span
                          className="opp-stage-pill"
                          style={{ background: `${STAGE_COLOR[o.stage]}18`, color: STAGE_COLOR[o.stage], borderColor: `${STAGE_COLOR[o.stage]}40` }}
                        >
                          {o.stage}
                        </span>
                      </td>
                      <td>{money(o.amount)}</td>
                      <td className="opp-td-center">{o.probability ? `${o.probability}%` : "—"}</td>
                      <td>{isOpen ? money(weighted) : "—"}</td>
                      <td className={overdue ? "opp-td-overdue" : ""}>{o.expected_close ? new Date(o.expected_close).toLocaleDateString("es-AR") : "—"}</td>
                      <td className="opp-td-action">{o.next_action || <span className="opp-no-action">Sin acción</span>}</td>
                      <td>
                        <div className="opp-actions">
                          {isOpen && <button className="opp-btn opp-btn--edit" onClick={() => editOpportunity(o)}>Editar</button>}
                          {isOpen && <button className="opp-btn opp-btn--won"  onClick={() => quickClose(o.id, "Ganado")}>✓ Ganado</button>}
                          {isOpen && <button className="opp-btn opp-btn--lost" onClick={() => quickClose(o.id, "Perdido")}>✗ Perdido</button>}
                          {!isOpen && <button className="opp-btn opp-btn--reopen" onClick={() => reopen(o.id)}>↺ Reabrir</button>}
                          <button className="opp-btn opp-btn--del" onClick={() => deleteOpportunity(o.id)}>Borrar</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="opp-mobile-list">
            {filteredOpps.length === 0 ? (
              <EmptyState
                title="Sin oportunidades para este filtro"
                text="Cambiá el filtro o cargá una nueva oportunidad desde el formulario superior."
              />
            ) : filteredOpps.map((o) => {
              const isOpen   = !["Ganado","Perdido"].includes(o.stage);
              const weighted = (Number(o.amount || 0) * Number(o.probability || 0)) / 100;
              return (
                <article key={o.id} className="opp-mobile-card">
                  <div className="opp-mobile-card__top">
                    <div>
                      <strong>{o.name}</strong>
                      <span>{o.accounts?.name || "Sin cliente"}</span>
                    </div>
                    <span
                      className="opp-stage-pill"
                      style={{ background: `${STAGE_COLOR[o.stage]}18`, color: STAGE_COLOR[o.stage], borderColor: `${STAGE_COLOR[o.stage]}40` }}
                    >
                      {o.stage}
                    </span>
                  </div>
                  <div className="opp-mobile-card__meta">
                    <span>Monto: {money(o.amount)}</span>
                    <span>Prob.: {o.probability ? `${o.probability}%` : "—"}</span>
                    <span>Forecast: {isOpen ? money(weighted) : "—"}</span>
                    <span>Cierre: {o.expected_close ? new Date(o.expected_close).toLocaleDateString("es-AR") : "—"}</span>
                  </div>
                  <p>{o.next_action || "Sin próxima acción"}</p>
                  <div className="opp-actions">
                    {isOpen && <button className="opp-btn opp-btn--edit" onClick={() => editOpportunity(o)}>Editar</button>}
                    {isOpen && <button className="opp-btn opp-btn--won" onClick={() => quickClose(o.id, "Ganado")}>Ganado</button>}
                    {isOpen && <button className="opp-btn opp-btn--lost" onClick={() => quickClose(o.id, "Perdido")}>Perdido</button>}
                    {!isOpen && <button className="opp-btn opp-btn--reopen" onClick={() => reopen(o.id)}>Reabrir</button>}
                    <button className="opp-btn opp-btn--del" onClick={() => deleteOpportunity(o.id)}>Borrar</button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <footer className="opp-footer">
          <a href="https://www.linkedin.com/in/danieletchudez/" target="_blank" rel="noreferrer">Designed by Daniel Etchudez</a>
        </footer>

      </div>
    </Layout>
  );
}
