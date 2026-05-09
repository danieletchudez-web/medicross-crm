export function calculateClientScore(client, visits = [], opportunities = []) {
  const today = new Date();

  // Última visita
  const clientVisits = visits.filter(v => v.client_id === client.id);
  const lastVisit = clientVisits.sort(
    (a, b) => new Date(b.visit_date) - new Date(a.visit_date)
  )[0];

  let daysWithoutVisit = 999;

  if (lastVisit) {
    const diff = today - new Date(lastVisit.visit_date);
    daysWithoutVisit = Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  // POTENCIAL
  const potentialScore = {
    alto: 40,
    medio: 25,
    bajo: 10,
  }[client.potential] || 10;

  // FRECUENCIA
  let frequencyScore = 0;
  if (clientVisits.length >= 5) frequencyScore = 20;
  else if (clientVisits.length >= 2) frequencyScore = 10;

  // PIPELINE
  const clientOpps = opportunities.filter(o => o.client_id === client.id);
  const pipelineScore = clientOpps.length > 0 ? 20 : 0;

  // PENALIZACIÓN por abandono
  let inactivityPenalty = 0;
  if (daysWithoutVisit > 30) inactivityPenalty = -30;
  else if (daysWithoutVisit > 15) inactivityPenalty = -15;

  const score =
    potentialScore +
    frequencyScore +
    pipelineScore +
    inactivityPenalty;

  // SEMÁFORO
  let status = "green";
  if (daysWithoutVisit > 30) status = "red";
  else if (daysWithoutVisit > 15) status = "yellow";

  // PRIORIDAD
  let priority = "low";
  if (status === "red" && score > 40) priority = "high";
  else if (status === "yellow") priority = "medium";

  return {
    score: Math.max(0, Math.min(100, score)),
    status,
    priority,
    daysWithoutVisit,
  };
}