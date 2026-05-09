export function analyzeSales({ opportunities = [], campaigns = [] }) {
  const open = opportunities.filter(
    (o) => !["Ganado", "Perdido"].includes(o.stage)
  );

  const pipeline = open.reduce((s, o) => s + Number(o.amount || 0), 0);

  const forecast = open.reduce(
    (s, o) =>
      s + (Number(o.amount || 0) * Number(o.probability || 0)) / 100,
    0
  );

  const hotDeals = open.filter((o) => Number(o.probability || 0) >= 70);

  const stalled = open.filter((o) => !o.next_action);

  const overdue = open.filter((o) => {
    if (!o.expected_close) return false;
    return new Date(o.expected_close) < new Date();
  });

  const won = opportunities.filter((o) => o.stage === "Ganado").length;
  const lost = opportunities.filter((o) => o.stage === "Perdido").length;

  const winRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : 0;

  const campaignTarget = campaigns.reduce(
    (s, c) => s + Number(c.target_amount || 0),
    0
  );

  const coverage =
    campaignTarget > 0 ? Math.round((forecast / campaignTarget) * 100) : 0;

  let decision = "Operación estable. Mantener seguimiento comercial.";
  let level = "ok";

  if (pipeline === 0) {
    decision = "No hay pipeline activo. Urgente generar nuevas oportunidades.";
    level = "danger";
  } else if (stalled.length > 0) {
    decision = `${stalled.length} oportunidades no tienen próxima acción. Asignar seguimiento inmediato.`;
    level = "warning";
  } else if (overdue.length > 0) {
    decision = `${overdue.length} oportunidades tienen fecha de cierre vencida. Revisar forecast.`;
    level = "danger";
  } else if (hotDeals.length > 0) {
    decision = `${hotDeals.length} oportunidades calientes. Priorizar cierre esta semana.`;
    level = "ok";
  } else if (coverage < 60 && campaignTarget > 0) {
    decision = "Forecast por debajo del objetivo. Aumentar generación de pipeline.";
    level = "warning";
  }

  return {
    pipeline,
    forecast,
    winRate,
    hotDeals: hotDeals.length,
    stalled: stalled.length,
    overdue: overdue.length,
    campaignTarget,
    coverage,
    decision,
    level,
  };
}