import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarPlus,
  CheckCircle2,
  Clock3,
  MessageCircle,
  PackageOpen,
  RefreshCw,
  Search,
  SlidersHorizontal,
  TrendingUp,
  X,
} from "lucide-react";
import Layout from "../components/Layout";
import { EmptyState, MetricKpi, ModuleHeader } from "../components/CRMUI";
import { supabase } from "../lib/supabaseClient";
import { buildTodayActions } from "../services/decisionEngine";
import "./todayActions.css";

function moneyARS(value) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export default function TodayActionsPage({ profile, onNavigate }) {
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("todas");
  const [focusFilter, setFocusFilter] = useState("todos");

  useEffect(() => { loadActions(); }, []);

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

  function shareProduct(product) {
    if (!product) {
      alert("Este cliente todavía no tiene producto sugerido.");
      return;
    }

    const text = `Hola, te comparto información sobre ${product.name}.

${product.speech || ""}

${product.brochure_url   ? `Brochure: ${product.brochure_url}`        : ""}
${product.tech_sheet_url ? `Ficha técnica: ${product.tech_sheet_url}` : ""}
${product.video_url      ? `Video: ${product.video_url}`              : ""}

Quedo atento para coordinar una presentación.`;

    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  }

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
      <div className="ta-page">
        <ModuleHeader
          title="Acciones Hoy"
          subtitle="Agenda comercial priorizada por potencial, pipeline, vencimientos y tiempo sin contacto."
          actions={(
            <>
              <button className="ta-header-btn" type="button" onClick={loadActions}>
                <RefreshCw size={16} /> Actualizar
              </button>
              <button className="ta-header-btn ta-header-btn--primary" type="button" onClick={() => onNavigate("visits", { action: "create", source: "todayActions" })}>
                <CalendarPlus size={16} /> Registrar visita
              </button>
            </>
          )}
        />

        <section className="ta-kpi-grid">
          <MetricKpi label="Clientes priorizados" value={actions.length} sub="cuentas analizadas" accent="blue" />
          <MetricKpi label="Prioridad alta" value={high} sub="requieren contacto" accent="red" />
          <MetricKpi label="+30 días sin contacto" value={cold} sub="cuentas para reactivar" accent="amber" />
          <MetricKpi label="Pipeline priorizado" value={moneyARS(prioritizedPipeline)} sub="monto abierto" accent="green" />
        </section>

        <section className={`ta-insight ${high || overdue ? "ta-insight--alert" : "ta-insight--ok"}`}>
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
        </section>

        <section className="ta-worklist">
          <header className="ta-worklist__head">
            <div>
              <span>Bandeja priorizada</span>
              <h2>Próximas mejores acciones</h2>
              <p>{filteredActions.length} cliente{filteredActions.length !== 1 ? "s" : ""} en esta vista</p>
            </div>
          </header>

          <div className="ta-toolbar">
            <label className="ta-search">
              <Search size={16} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cliente, ciudad o producto..." />
            </label>
            <label className="ta-select-wrap">
              <SlidersHorizontal size={15} />
              <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
                <option value="todas">Todas las prioridades</option>
                <option value="Alta">Prioridad alta</option>
                <option value="Media">Prioridad media</option>
                <option value="Baja">Prioridad baja</option>
              </select>
            </label>
            <label className="ta-select-wrap">
              <TrendingUp size={15} />
              <select value={focusFilter} onChange={(event) => setFocusFilter(event.target.value)}>
                <option value="todos">Todos los enfoques</option>
                <option value="vencidas">Oportunidades vencidas</option>
                <option value="sin_contacto">Más de 30 días sin contacto</option>
                <option value="pipeline">Con pipeline abierto</option>
                <option value="sin_producto">Sin producto sugerido</option>
              </select>
            </label>
            {(search || priorityFilter !== "todas" || focusFilter !== "todos") && (
              <button className="ta-clear-btn" type="button" onClick={clearFilters} title="Limpiar filtros">
                <X size={16} />
              </button>
            )}
          </div>

          <div className="ta-grid">
            {filteredActions.length === 0 ? (
              <EmptyState
                title={actions.length ? "No hay acciones con esos filtros" : "Todavía no hay clientes cargados"}
                text={actions.length ? "Probá con otra prioridad o enfoque comercial." : "Cargá una cuenta para comenzar a priorizar la agenda."}
                action={actions.length ? <button className="ta-header-btn" type="button" onClick={clearFilters}>Limpiar filtros</button> : null}
              />
            ) : filteredActions.slice(0, 12).map((item, index) => (
              <article key={item.account.id} className={`ta-card ta-card--${item.priority.toLowerCase()}`}>
                <div className="ta-card__top">
                  <div className="ta-card__rank">{String(index + 1).padStart(2, "0")}</div>
                  <div className="ta-card__info">
                    <span className="ta-card__eyebrow">{item.priority} prioridad</span>
                    <h3 className="ta-card__name">{item.account.name}</h3>
                    <p className="ta-card__location">
                      {item.account.city || "—"} · {item.account.province || "—"} · Potencial {item.account.potential || "Medio"}
                    </p>
                  </div>
                  <div className="ta-score">
                    <span>Score</span>
                    <strong>{item.score}</strong>
                  </div>
                </div>

                <div className="ta-scorebar">
                  <span>Score comercial</span>
                  <div><i style={{ width: `${item.score}%` }} /></div>
                  <strong>{item.score}/100</strong>
                </div>

                <div className="ta-metrics">
                  <TaMetric icon={<Clock3 size={14} />} label="Sin contacto" value={`${item.daysWithoutContact} días`} />
                  <TaMetric icon={<TrendingUp size={14} />} label="Pipeline" value={moneyARS(item.openPipeline)} />
                  <TaMetric icon={<PackageOpen size={14} />} label="Producto" value={item.suggestedProduct?.name || "Sin producto"} />
                </div>

                <div className="ta-decision">
                  <span>Próxima mejor acción</span>
                  <p>{item.reason}</p>
                </div>

                <div className="ta-actions">
                  <button
                    className="ta-btn ta-btn--primary"
                    onClick={() => shareProduct(item.suggestedProduct, item.account.name)}
                  >
                    <MessageCircle size={15} /> Compartir Share Kit
                  </button>
                  <button
                    className="ta-btn ta-btn--secondary"
                    onClick={() => onNavigate("visits", { action: "create", source: "todayActions" })}
                  >
                    <CalendarPlus size={15} /> Registrar visita
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
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
