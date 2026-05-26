import { useState, useRef, useEffect } from "react";
import "./CRMAssistant.css";

function buildSystemPrompt(crmData, currentPage, profile) {
  const d   = crmData || {};
  const fmt = (n) => new Intl.NumberFormat("es-AR", { style:"currency", currency:"ARS", maximumFractionDigits:0 }).format(Number(n||0));
  const now = new Date().toLocaleDateString("es-AR", { weekday:"long", day:"2-digit", month:"long", year:"numeric" });

  const pageNames = {
    managerDashboard:"Dashboard Comercial", sellerDashboard:"Dashboard Vendedor",
    accounts:"Clientes / Cuentas", opportunities:"Oportunidades",
    campaigns:"Campañas", visits:"Visitas", todayActions:"Acciones Hoy",
    products:"Productos", importer:"BI Comercial", tenders:"Licitaciones",
    cotizador:"Cotizador", salesAnalytics:"Análisis Comercial", adminUsers:"Administración",
  };

  return `Sos el asistente comercial inteligente del CRM de Medi-Cross S.R.L., una droguería especializada en productos médicos (filtros de hemodiálisis, sets IV, apheresis, equipamiento quirúrgico).

Fecha y hora actual: ${now}
Usuario: ${profile?.full_name || "Usuario"} (${profile?.role || "vendedor"})
Módulo activo: ${pageNames[currentPage] || currentPage}

DATOS REALES DEL CRM EN ESTE MOMENTO:
- Pipeline abierto: ${fmt(d.pipeline)} (${d.openOpps || 0} oportunidades abiertas)
- Forecast manual: ${fmt(d.forecast)}
- Objetivo campañas: ${fmt(d.target)}
- Hot deals (prob >= 70%): ${d.hotDeals || 0}
- Oportunidades vencidas: ${d.overdue || 0}
- Sin próxima acción: ${d.noAction || 0}
- A cerrar en 30 días: ${d.closingThisMonth || 0}
- Clientes activos: ${d.accounts || 0}
- Visitas registradas: ${d.visits || 0}
- Clientes fríos (+30d sin visita): ${d.coldAccounts || 0}
- Win rate: ${d.winRate || 0}%

INSTRUCCIONES:
- Respondé siempre en español argentino, de forma concisa y directa
- Usá los datos reales del CRM en tus respuestas
- Si te preguntan la fecha/hora, usá la que figura arriba
- Para preguntas comerciales, dá recomendaciones accionables y concretas
- Podés hacer cálculos, comparaciones y análisis con los datos disponibles
- Mantené un tono profesional pero cercano
- Usá **negrita** para resaltar números y puntos clave
- Máximo 150 palabras por respuesta salvo que se pida más detalle
- Si no tenés datos suficientes para responder algo, decilo claramente`;
}

async function callClaude(messages, systemPrompt) {
  const response = await fetch("/api/assistant", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      system: systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Error ${response.status}`);
  }

  const data = await response.json();
  return data.content || "No pude generar una respuesta.";
}

const QUICK_SUGGESTIONS = [
  "¿Qué fecha es hoy?",
  "¿Qué hago primero hoy?",
  "Analizá mi pipeline",
  "¿Qué riesgos hay?",
  "¿Cómo está el forecast?",
  "¿Qué clientes reactivar?",
];

export default function CRMAssistant({ profile, currentPage, crmData }) {
  const [open,     setOpen]     = useState(false);
  const [messages, setMessages] = useState([]);
  const [input,    setInput]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const bottomRef  = useRef(null);
  const inputRef   = useRef(null);

  useEffect(() => {
    if (open && messages.length === 0) {
      const name = profile?.full_name?.split(" ")[0] || "vendedor";
      const pageNames = {
        managerDashboard:"Dashboard Comercial", sellerDashboard:"Dashboard Vendedor",
        accounts:"Clientes / Cuentas", opportunities:"Oportunidades",
        campaigns:"Campañas", visits:"Visitas", todayActions:"Acciones Hoy",
        products:"Productos", importer:"BI Comercial", tenders:"Licitaciones",
        cotizador:"Cotizador", salesAnalytics:"Análisis Comercial",
      };
      const pageName = pageNames[currentPage] || currentPage;
      const now = new Date().toLocaleDateString("es-AR", { weekday:"long", day:"2-digit", month:"long", year:"numeric" });
      setMessages([{
        role: "assistant",
        content: `Hola **${name}** 👋 Soy tu asistente comercial con IA.\n\nHoy es **${now}**. Estás en **${pageName}**.\n\nTengo acceso a los datos reales de tu CRM. Preguntame lo que quieras.`
      }]);
    }
  }, [open]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  async function sendMessage(e) {
    e?.preventDefault();
    if (!input.trim() || loading) return;
    const userText = input.trim();
    setInput("");
    setLoading(true);
    const newMessages = [...messages, { role:"user", content:userText }];
    setMessages(newMessages);
    try {
      const history = newMessages.filter((_, i) => !(i === 0 && newMessages[0].role === "assistant"));
      const reply = await callClaude(history, buildSystemPrompt(crmData, currentPage, profile));
      setMessages(prev => [...prev, { role:"assistant", content:reply }]);
    } catch (err) {
      setMessages(prev => [...prev, { role:"assistant", content:`⚠ Error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSuggestion(s) {
    if (loading) return;
    setLoading(true);
    const newMessages = [...messages, { role:"user", content:s }];
    setMessages(newMessages);
    try {
      const history = newMessages.filter((_, i) => !(i === 0 && newMessages[0].role === "assistant"));
      const reply = await callClaude(history, buildSystemPrompt(crmData, currentPage, profile));
      setMessages(prev => [...prev, { role:"assistant", content:reply }]);
    } catch (err) {
      setMessages(prev => [...prev, { role:"assistant", content:`⚠ Error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  }

  function clearChat() {
    setMessages([]);
    setTimeout(() => {
      const name = profile?.full_name?.split(" ")[0] || "vendedor";
      const now  = new Date().toLocaleDateString("es-AR", { weekday:"long", day:"2-digit", month:"long", year:"numeric" });
      setMessages([{ role:"assistant", content:`Hola **${name}** 👋 Nueva conversación.\n\nHoy es **${now}**. ¿En qué te ayudo?` }]);
    }, 100);
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function renderContent(text) {
    return text.split("\n").map((line, i) => {
      if (line.startsWith("- ") || line.startsWith("• ")) return <li key={i}>{renderBold(line.slice(2))}</li>;
      if (/^\d+\.\s/.test(line)) return <li key={i}>{renderBold(line.replace(/^\d+\.\s/, ""))}</li>;
      if (line.trim() === "") return <br key={i}/>;
      return <p key={i}>{renderBold(line)}</p>;
    });
  }

  function renderBold(text) {
    return text.split(/\*\*(.*?)\*\*/g).map((part, i) => i % 2 === 1 ? <strong key={i}>{part}</strong> : part);
  }

  return (
    <>
      <button className={`crm-ai-fab ${open ? "crm-ai-fab--open" : ""}`}
        onClick={() => setOpen(o => !o)} title="Asistente Comercial IA">
        {open ? "✕" : "✦"}
      </button>

      {open && (
        <div className="crm-ai-panel">
          <div className="crm-ai-header">
            <div className="crm-ai-header__left">
              <div className="crm-ai-header__dot"/>
              <div>
                <span className="crm-ai-header__title">Medix - Asistente Comercial</span>
                <span className="crm-ai-header__sub">MediCross CRM</span>
              </div>
            </div>
            <button className="crm-ai-clear" onClick={clearChat} title="Nueva conversación">↺</button>
          </div>

          <div className="crm-ai-messages">
            {messages.map((msg, i) => (
              <div key={i} className={`crm-ai-msg crm-ai-msg--${msg.role}`}>
                {msg.role === "assistant" && <div className="crm-ai-msg__avatar">✦</div>}
                <div className="crm-ai-msg__bubble">
                  <ul className="crm-ai-msg__content">
                    {msg.role === "assistant" ? renderContent(msg.content) : <p>{msg.content}</p>}
                  </ul>
                </div>
              </div>
            ))}
            {loading && (
              <div className="crm-ai-msg crm-ai-msg--assistant">
                <div className="crm-ai-msg__avatar">✦</div>
                <div className="crm-ai-msg__bubble crm-ai-msg__bubble--loading"><span/><span/><span/></div>
              </div>
            )}
            <div ref={bottomRef}/>
          </div>

          {messages.length <= 1 && (
            <div className="crm-ai-suggestions">
              {QUICK_SUGGESTIONS.map(s => (
                <button key={s} className="crm-ai-suggestion" onClick={() => handleSuggestion(s)} disabled={loading}>{s}</button>
              ))}
            </div>
          )}

          <form className="crm-ai-input-wrap" onSubmit={sendMessage}>
            <textarea ref={inputRef} className="crm-ai-input" value={input}
              onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
              placeholder="Preguntá cualquier cosa sobre el CRM…" rows={2} disabled={loading}/>
            <button type="submit" className="crm-ai-send" disabled={loading || !input.trim()}>↑</button>
          </form>
        </div>
      )}
    </>
  );
}
