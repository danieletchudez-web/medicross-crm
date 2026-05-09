export function buildTodayActions({ accounts = [], visits = [], opportunities = [], products = [] }) {
  const today = new Date();

  function daysSince(date) {
    if (!date) return 999;
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return 999;
    return Math.floor((today - d) / (1000 * 60 * 60 * 24));
  }

  function isOverdue(expectedClose) {
    if (!expectedClose) return false;
    return new Date(expectedClose) < today;
  }

  function potentialValue(potential) {
    const value = String(potential || "").toLowerCase();
    if (value === "alto")  return 40;
    if (value === "medio") return 25;
    return 10;
  }

  function buildReason({ daysWithoutContact, openPipeline, overdueOpps, followStatus, priority }) {
    // Casos críticos primero
    if (overdueOpps > 0 && daysWithoutContact > 30) {
      return `${overdueOpps} oportunidad${overdueOpps > 1 ? "es vencidas" : " vencida"} y más de 30 días sin contacto. Acción urgente.`;
    }
    if (overdueOpps > 0) {
      return `Tiene ${overdueOpps} oportunidad${overdueOpps > 1 ? "es" : ""} con fecha de cierre vencida. Requiere seguimiento inmediato.`;
    }
    if (followStatus === "rojo" && openPipeline > 0) {
      return "Cliente en riesgo con pipeline activo. Priorizar contacto esta semana.";
    }
    if (followStatus === "rojo") {
      return "Cliente marcado en riesgo. Requiere atención comercial urgente.";
    }
    if (daysWithoutContact > 30 && openPipeline > 0) {
      return "Pipeline activo con más de 30 días sin contacto. Retomar seguimiento.";
    }
    if (daysWithoutContact > 30) {
      return "Cliente frío: requiere reactivación comercial.";
    }
    if (openPipeline > 0 && priority === "Alta") {
      return "Oportunidad de alto valor abierta. Empujar hacia cierre.";
    }
    if (openPipeline > 0) {
      return "Hay oportunidad abierta para empujar avance.";
    }
    if (followStatus === "amarillo") {
      return "Cliente en seguimiento. Verificar estado y necesidades actuales.";
    }
    return "Mantener ritmo de contacto y explorar nuevas oportunidades.";
  }

  return accounts
    .map((account) => {
      const accountVisits = visits.filter((v) => v.account_id === account.id);
      const accountOpps   = opportunities.filter((o) => o.account_id === account.id);

      const lastVisit = [...accountVisits].sort(
        (a, b) => new Date(b.visit_date) - new Date(a.visit_date)
      )[0];

      const daysWithoutContact = daysSince(lastVisit?.visit_date);

      /* ── FIX: usar stage en lugar de status, con valores correctos ── */
      const openOpps = accountOpps.filter(
        (o) => !["Ganado", "Perdido"].includes(o.stage)
      );

      const openPipeline = openOpps.reduce(
        (sum, o) => sum + Number(o.amount || 0), 0
      );

      const weightedPipeline = openOpps.reduce(
        (sum, o) => sum + (Number(o.amount || 0) * Number(o.probability || 0)) / 100,
        0
      );

      /* ── NUEVO: contar oportunidades con fecha vencida ── */
      const overdueOpps = openOpps.filter(
        (o) => isOverdue(o.expected_close)
      ).length;

      const mainOpportunity = [...openOpps].sort(
        (a, b) => Number(b.amount || 0) - Number(a.amount || 0)
      )[0];

      const suggestedProduct =
        products.find((p) => p.id === mainOpportunity?.product_id) ||
        products.find((p) => p.id === lastVisit?.product_id) ||
        null;

      /* ── Score ── */
      let score = potentialValue(account.potential);

      // Días sin contacto
      if (daysWithoutContact > 30)      score += 30;
      else if (daysWithoutContact > 15) score += 18;
      else                              score += 6;

      // Pipeline
      if (openPipeline > 0)              score += 20;
      if (weightedPipeline > 10_000_000) score += 10;

      // Follow status
      if (account.follow_status === "rojo")     score += 12;
      if (account.follow_status === "amarillo") score += 6;

      // NUEVO: penalización por oportunidades vencidas
      if (overdueOpps > 0) score += 8; // sube el score para que aparezca primero

      score = Math.min(100, Math.max(0, Math.round(score)));

      let priority = "Baja";
      if (score >= 75)      priority = "Alta";
      else if (score >= 50) priority = "Media";

      const reason = buildReason({
        daysWithoutContact,
        openPipeline,
        overdueOpps,
        followStatus: account.follow_status,
        priority,
      });

      return {
        account,
        score,
        priority,
        reason,
        daysWithoutContact,
        openPipeline,
        weightedPipeline,
        overdueOpps,
        suggestedProduct,
        lastVisit,
        mainOpportunity,
      };
    })
    .sort((a, b) => b.score - a.score);
}