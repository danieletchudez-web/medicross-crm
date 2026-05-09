import { useState, useRef, useEffect } from "react";
import "./CRMAssistant.css";

/* ══════════════════════════════════════════════════════════════════════
   MOTOR DE REGLAS LOCAL
   Analiza los datos del CRM y genera recomendaciones sin API externa
   ══════════════════════════════════════════════════════════════════════ */

function analyzeWithRules(input, crmData, currentPage) {
  const q = input.toLowerCase();
  const d = crmData || {};

  /* ── Helpers ── */
  const fmt = (n) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(Number(n || 0));
  const pct = (n) => `${n}%`;

  /* ══ RESPUESTAS POR INTENCIÓN ══ */

  /* Pipeline */
  if (q.includes("pipeline") || q.includes("oportunidad") || q.includes("negocio")) {
    const lines = [`**Análisis de pipeline actual:**`];
    lines.push(`• Pipeline abierto: **${fmt(d.pipeline)}** (${d.openOpps} oportunidades)`);
    if (d.hotDeals > 0) lines.push(`• Hot deals (prob ≥70%): **${d.hotDeals}** — priorizá el cierre esta semana`);
    if (d.overdue > 0)  lines.push(`• ⚠ Oportunidades vencidas: **${d.overdue}** — actualizá la fecha o cerralas`);
    if (d.noAction > 0) lines.push(`• Sin próxima acción: **${d.noAction}** — definí el siguiente paso hoy`);
    if (d.closingThisMonth > 0) lines.push(`• A cerrar en 30 días: **${d.closingThisMonth}** oportunidades`);

    lines.push(``);
    if (d.overdue > 0 && d.noAction > 0) {
      lines.push(`**Acción prioritaria:** Revisá las ${d.overdue} oportunidades vencidas y las ${d.noAction} sin próxima acción. Son las que más riesgo tienen de perderse.`);
    } else if (d.hotDeals > 0) {
      lines.push(`**Acción prioritaria:** Enfocate en los ${d.hotDeals} hot deals. Tienen alta probabilidad de cierre — una llamada o reunión puede definirlos.`);
    } else {
      lines.push(`**Acción prioritaria:** El pipeline está estable. Mantené el ritmo de seguimiento y cargá forecast en las oportunidades que lo necesiten.`);
    }
    return lines.join("\n");
  }

  /* Forecast */
  if (q.includes("forecast") || q.includes("proyecci") || q.includes("objetivo")) {
    const lines = [`**Análisis de forecast:**`];
    lines.push(`• Forecast manual: **${fmt(d.forecast)}**`);
    lines.push(`• Objetivo campañas: **${fmt(d.target)}**`);
    lines.push(`• Cobertura: **${pct(d.coverage)}**`);
    lines.push(``);
    if (d.coverage >= 100) {
      lines.push(`✅ **Excelente cobertura.** El forecast supera el objetivo. Revisá que los montos estén actualizados y sean realistas.`);
    } else if (d.coverage >= 80) {
      lines.push(`🟡 **Cobertura aceptable.** Estás cerca del objetivo. Identificá 2-3 oportunidades más para sumar forecast y llegar al 100%.`);
    } else if (d.coverage >= 50) {
      lines.push(`🟠 **Cobertura media.** Necesitás más pipeline o actualizar los montos de forecast. Revisá oportunidades sin forecast cargado.`);
    } else {
      lines.push(`🔴 **Cobertura baja.** El forecast cubre menos del 50% del objetivo. Urgente: activar más oportunidades y cargar forecast en todas las abiertas.`);
    }
    return lines.join("\n");
  }

  /* Clientes / visitas */
  if (q.includes("client") || q.includes("visit") || q.includes("contact")) {
    const lines = [`**Análisis de clientes y actividad:**`];
    lines.push(`• Clientes activos: **${d.accounts}**`);
    lines.push(`• Visitas registradas: **${d.visits}**`);
    if (d.coldAccounts > 0) lines.push(`• Clientes fríos (+30 días sin visita): **${d.coldAccounts}** — requieren reactivación`);
    lines.push(``);

    if (d.coldAccounts > 0) {
      lines.push(`**Recomendación:** Tenés ${d.coldAccounts} cliente${d.coldAccounts > 1 ? "s" : ""} sin contacto en más de 30 días. Priorizalos en tu agenda de esta semana — un cliente frío es un cliente en riesgo.`);
    } else {
      lines.push(`**Recomendación:** El ritmo de visitas es bueno. Mantené al menos 1 contacto por semana con clientes de alto potencial y revisá el seguimiento de los que tienen pipeline abierto.`);
    }
    return lines.join("\n");
  }

  /* Win rate / conversión */
  if (q.includes("win") || q.includes("ganadas") || q.includes("perdidas") || q.includes("conversi")) {
    const lines = [`**Análisis de win rate:**`];
    lines.push(`• Win rate actual: **${pct(d.winRate)}**`);
    lines.push(``);
    if (d.winRate >= 60) {
      lines.push(`✅ **Win rate excelente.** Más de la mitad de las oportunidades se cierran. Analizá qué estás haciendo bien para replicarlo.`);
    } else if (d.winRate >= 40) {
      lines.push(`🟡 **Win rate aceptable.** Hay margen de mejora. Revisá en qué etapa se pierden más oportunidades y qué objeciones son las más frecuentes.`);
    } else if (d.winRate > 0) {
      lines.push(`🔴 **Win rate bajo.** Menos del 40% de cierre. Recomendación: revisá la calidad del pipeline desde el inicio — quizás estás cargando oportunidades poco calificadas.`);
    } else {
      lines.push(`Sin datos de win rate todavía. Para calcularlo necesitás registrar oportunidades como Ganadas o Perdidas en el módulo de Oportunidades.`);
    }
    return lines.join("\n");
  }

  /* Prioridad / qué hacer hoy */
  if (q.includes("hoy") || q.includes("prioridad") || q.includes("empezar") || q.includes("primero") || q.includes("hacer")) {
    const lines = [`**Plan de acción para hoy:**`];
    let priority = 1;

    if (d.overdue > 0) {
      lines.push(`${priority++}. 🔴 **Urgente:** Revisá las **${d.overdue}** oportunidades con fecha de cierre vencida. Actualizá o cerralas.`);
    }
    if (d.noAction > 0) {
      lines.push(`${priority++}. 🟠 **Definir próxima acción** en las **${d.noAction}** oportunidades que no la tienen.`);
    }
    if (d.hotDeals > 0) {
      lines.push(`${priority++}. 🟡 **Seguimiento de hot deals:** Contactá los **${d.hotDeals}** prospectos con alta probabilidad de cierre.`);
    }
    if (d.coldAccounts > 0) {
      lines.push(`${priority++}. 📞 **Reactivar clientes fríos:** Hay **${d.coldAccounts}** sin visita en 30+ días. Agendá al menos 2.`);
    }
    if (d.closingThisMonth > 0) {
      lines.push(`${priority++}. 📅 **A cerrar este mes:** Revisá las **${d.closingThisMonth}** oportunidades con fecha próxima.`);
    }

    if (priority === 1) {
      lines.push(`✅ Todo en orden. El pipeline está activo y sin alertas críticas. Aprovechá para cargar nuevas oportunidades o registrar visitas recientes.`);
    }

    return lines.join("\n");
  }

  /* Riesgo */
  if (q.includes("riesgo") || q.includes("problema") || q.includes("alerta") || q.includes("critico") || q.includes("crítico")) {
    const lines = [`**Alertas y riesgos detectados:**`];
    let riesgos = 0;

    if (d.overdue > 0)       { lines.push(`🔴 **${d.overdue}** oportunidades con fecha de cierre vencida`); riesgos++; }
    if (d.noAction > 0)      { lines.push(`🟠 **${d.noAction}** oportunidades sin próxima acción definida`); riesgos++; }
    if (d.coldAccounts > 0)  { lines.push(`🟡 **${d.coldAccounts}** clientes sin contacto en más de 30 días`); riesgos++; }
    if (d.coverage < 50 && d.target > 0) { lines.push(`🔴 Cobertura de forecast **${pct(d.coverage)}** — muy por debajo del objetivo`); riesgos++; }

    if (riesgos === 0) {
      lines.push(`✅ Sin alertas críticas. El CRM está en buen estado operativo.`);
    } else {
      lines.push(``);
      lines.push(`**Total: ${riesgos} punto${riesgos > 1 ? "s" : ""} de atención.** Entrá a "Acciones Hoy" para ver los clientes priorizados automáticamente.`);
    }
    return lines.join("\n");
  }

  /* Campañas */
  if (q.includes("campa") || q.includes("meta") || q.includes("objetivo")) {
    const lines = [`**Estado de campañas:**`];
    lines.push(`• Objetivo total: **${fmt(d.target)}**`);
    lines.push(`• Forecast vs objetivo: **${pct(d.coverage)}**`);
    lines.push(``);
    lines.push(`Para ver el detalle por campaña, andá al módulo **Campañas** donde ves la cobertura individual de cada una.`);
    return lines.join("\n");
  }

  /* Ayuda / qué podés hacer */
  if (q.includes("ayuda") || q.includes("qué pod") || q.includes("que pod") || q.includes("cómo") || q.includes("como funciona")) {
    return `**Soy tu asistente comercial de STORING Medical.** Puedo analizar los datos del CRM y darte recomendaciones concretas.\n\nPreguntame sobre:\n• **Pipeline** — estado de oportunidades y montos\n• **Forecast** — cobertura vs objetivo de campañas\n• **Clientes** — actividad y clientes fríos\n• **Prioridades** — qué hacer hoy\n• **Riesgos** — alertas y problemas detectados\n• **Win rate** — tasa de conversión\n\nUsá las sugerencias de abajo o escribí tu pregunta.`;
  }

  /* Respuesta genérica contextual */
  const lines = [`**Resumen ejecutivo del CRM:**`];
  lines.push(`• Pipeline: **${fmt(d.pipeline)}** (${d.openOpps} opps abiertas)`);
  lines.push(`• Forecast vs objetivo: **${pct(d.coverage)}**`);
  if (d.hotDeals > 0)       lines.push(`• Hot deals: **${d.hotDeals}**`);
  if (d.overdue > 0)        lines.push(`• ⚠ Vencidas: **${d.overdue}**`);
  if (d.noAction > 0)       lines.push(`• ⚠ Sin próxima acción: **${d.noAction}**`);
  if (d.coldAccounts > 0)   lines.push(`• Clientes fríos: **${d.coldAccounts}**`);
  lines.push(``);
  lines.push(`Preguntame algo específico o usá las sugerencias de abajo para un análisis más detallado.`);
  return lines.join("\n");
}

/* ══════════════════════════════════════════════════════════════════════
   COMPONENTE
   ══════════════════════════════════════════════════════════════════════ */

const QUICK_SUGGESTIONS = [
  "¿Qué hago primero hoy?",
  "Analizá mi pipeline",
  "¿Qué riesgos hay?",
  "¿Cómo está el forecast?",
  "¿Qué clientes reactivar?",
  "¿Cómo está el win rate?",
];

export default function CRMAssistant({ profile, currentPage, crmData }) {
  const [open, setOpen]         = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState("");
  const [loading, setLoading]   = useState(false);
  const bottomRef               = useRef(null);
  const inputRef                = useRef(null);

  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{ role: "assistant", content: buildGreeting(profile, currentPage) }]);
    }
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function buildGreeting(profile, page) {
    const name = profile?.full_name?.split(" ")[0] || "vendedor";
    const pageNames = {
      managerDashboard: "Dashboard Comercial",
      sellerDashboard:  "Dashboard Vendedor",
      accounts:         "Clientes / Cuentas",
      opportunities:    "Oportunidades",
      campaigns:        "Campañas",
      visits:           "Visitas",
      todayActions:     "Acciones Hoy",
      products:         "Productos",
    };
    const pageName = pageNames[page] || page;
    return `Hola **${name}** 👋 Soy tu asistente comercial.\n\nEstás en **${pageName}**. Analizo los datos reales de tu CRM para darte recomendaciones concretas.\n\n¿En qué te ayudo?`;
  }

  function sendMessage(e) {
    e?.preventDefault();
    if (!input.trim() || loading) return;

    const userText = input.trim();
    setInput("");
    setLoading(true);

    const newMessages = [...messages, { role: "user", content: userText }];
    setMessages(newMessages);

    /* Simular pequeño delay para naturalidad */
    setTimeout(() => {
      const response = analyzeWithRules(userText, crmData, currentPage);
      setMessages((prev) => [...prev, { role: "assistant", content: response }]);
      setLoading(false);
    }, 400);
  }

  function handleSuggestion(s) {
    setInput(s);
    setTimeout(() => {
      const fakeEvent = { preventDefault: () => {} };
      setInput("");
      setLoading(true);
      const newMessages = [...messages, { role: "user", content: s }];
      setMessages(newMessages);
      setTimeout(() => {
        const response = analyzeWithRules(s, crmData, currentPage);
        setMessages((prev) => [...prev, { role: "assistant", content: response }]);
        setLoading(false);
      }, 400);
    }, 50);
  }

  function clearChat() {
    setMessages([]);
    setTimeout(() => {
      setMessages([{ role: "assistant", content: buildGreeting(profile, currentPage) }]);
    }, 100);
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function renderContent(text) {
    return text.split("\n").map((line, i) => {
      if (line.startsWith("- ") || line.startsWith("• ")) {
        return <li key={i}>{renderBold(line.slice(2))}</li>;
      }
      if (/^\d+\.\s/.test(line)) {
        return <li key={i}>{renderBold(line.replace(/^\d+\.\s/, ""))}</li>;
      }
      if (line.trim() === "") return <br key={i} />;
      return <p key={i}>{renderBold(line)}</p>;
    });
  }

  function renderBold(text) {
    const parts = text.split(/\*\*(.*?)\*\*/g);
    return parts.map((part, i) =>
      i % 2 === 1 ? <strong key={i}>{part}</strong> : part
    );
  }

  return (
    <>
      {/* FAB */}
      <button
        className={`crm-ai-fab ${open ? "crm-ai-fab--open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title="Asistente Comercial"
      >
        {open ? "✕" : "✦"}
      </button>

      {/* PANEL */}
      {open && (
        <div className="crm-ai-panel">

          {/* HEADER */}
          <div className="crm-ai-header">
            <div className="crm-ai-header__left">
              <div className="crm-ai-header__dot" />
              <div>
                <span className="crm-ai-header__title">Asistente Comercial</span>
                <span className="crm-ai-header__sub">STORING Medical · Motor local</span>
              </div>
            </div>
            <button className="crm-ai-clear" onClick={clearChat} title="Nueva conversación">↺</button>
          </div>

          {/* MENSAJES */}
          <div className="crm-ai-messages">
            {messages.map((msg, i) => (
              <div key={i} className={`crm-ai-msg crm-ai-msg--${msg.role}`}>
                {msg.role === "assistant" && <div className="crm-ai-msg__avatar">✦</div>}
                <div className="crm-ai-msg__bubble">
                  <ul className="crm-ai-msg__content">
                    {msg.role === "assistant"
                      ? renderContent(msg.content)
                      : <p>{msg.content}</p>
                    }
                  </ul>
                </div>
              </div>
            ))}

            {loading && (
              <div className="crm-ai-msg crm-ai-msg--assistant">
                <div className="crm-ai-msg__avatar">✦</div>
                <div className="crm-ai-msg__bubble crm-ai-msg__bubble--loading">
                  <span/><span/><span/>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* SUGERENCIAS */}
          {messages.length <= 1 && (
            <div className="crm-ai-suggestions">
              {QUICK_SUGGESTIONS.map((s) => (
                <button key={s} className="crm-ai-suggestion" onClick={() => handleSuggestion(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* INPUT */}
          <form className="crm-ai-input-wrap" onSubmit={sendMessage}>
            <textarea
              ref={inputRef}
              className="crm-ai-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Preguntá sobre tu pipeline, clientes o visitas…"
              rows={2}
              disabled={loading}
            />
            <button type="submit" className="crm-ai-send" disabled={loading || !input.trim()}>↑</button>
          </form>

        </div>
      )}
    </>
  );
}