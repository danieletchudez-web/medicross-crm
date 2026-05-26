const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

const json = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(init.headers || {}),
    },
  });

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}

export async function onRequestPost({ request, env }) {
  if (!env.ANTHROPIC_API_KEY) {
    return json(
      { error: "Falta configurar ANTHROPIC_API_KEY en Cloudflare Pages." },
      { status: 500 },
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Solicitud inválida." }, { status: 400 });
  }

  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const safeMessages = messages
    .filter((message) => ["user", "assistant"].includes(message?.role) && typeof message?.content === "string")
    .slice(-12)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, 4000),
    }));

  if (!safeMessages.length) {
    return json({ error: "No hay mensajes para responder." }, { status: 400 });
  }

  const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 400,
      system: typeof payload.system === "string" ? payload.system.slice(0, 8000) : "",
      messages: safeMessages,
    }),
  });

  const data = await anthropicResponse.json().catch(() => ({}));

  if (!anthropicResponse.ok) {
    return json(
      { error: data.error?.message || `Error ${anthropicResponse.status}` },
      { status: anthropicResponse.status },
    );
  }

  return json({ content: data.content?.[0]?.text || "No pude generar una respuesta." });
}
