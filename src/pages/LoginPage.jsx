import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import logoImg from "../assets/logo.jpg";

const PASSWORD_RULES = [
  { id: "length",  label: "Mínimo 10 caracteres",            test: v => v.length >= 10 },
  { id: "upper",   label: "Una letra mayúscula",              test: v => /[A-ZÁÉÍÓÚÑ]/.test(v) },
  { id: "lower",   label: "Una letra minúscula",              test: v => /[a-záéíóúñ]/.test(v) },
  { id: "number",  label: "Un número",                        test: v => /\d/.test(v) },
  { id: "special", label: "Un carácter especial: @ # $ % ...", test: v => /[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9]/.test(v) },
];

function isStrongPassword(password) {
  return PASSWORD_RULES.every(rule => rule.test(password));
}

function PasswordChecklist({ password }) {
  return (
    <div style={s.passwordBox}>
      {PASSWORD_RULES.map(rule => {
        const ok = rule.test(password);
        return (
          <span key={rule.id} style={{ ...s.passwordRule, color: ok ? "#047857" : "#64748b" }}>
            <span style={{ ...s.ruleDot, background: ok ? "#10b981" : "#cbd5e1" }} />
            {rule.label}
          </span>
        );
      })}
    </div>
  );
}

function makeCaptchaQuestion() {
  const a = Math.floor(Math.random() * 7) + 3;
  const b = Math.floor(Math.random() * 6) + 2;
  return { label: `${a} + ${b}`, answer: String(a + b) };
}

function hasRecoveryIntent() {
  const params = new URLSearchParams(window.location.search);
  return params.get("recovery") === "1" || window.location.hash.includes("type=recovery");
}

function getAuthErrorMessage(error, fallback) {
  const message = error?.message?.toLowerCase() || "";

  // Supabase can expose implementation details from the configured SMTP
  // provider. Keep those details out of the UI and give the user an action.
  if (
    message.includes("api key") ||
    message.includes("smtp") ||
    message.includes("error sending") ||
    message.includes("failed to send")
  ) {
    return "No pudimos enviar el email en este momento. El servicio de correo necesita ser reconfigurado por un administrador.";
  }

  return fallback;
}

export default function LoginPage({ initialMode, onRecoveryComplete }) {
  const [mode, setMode]         = useState(() => initialMode || (hasRecoveryIntent() ? "recovery" : "login"));
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading]   = useState(false);
  const [message, setMessage]   = useState(null);
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [captchaQuestion, setCaptchaQuestion] = useState(() => makeCaptchaQuestion());

  const needsCaptcha = ["login", "register", "reset"].includes(mode);
  const captchaOk = captchaAnswer.trim() === captchaQuestion.answer;
  const strongPassword = useMemo(() => isStrongPassword(password), [password]);
  const passwordConfirmed = password.length > 0 && password === confirmPassword;

  useEffect(() => {
    if (initialMode === "recovery" || hasRecoveryIntent()) setMode("recovery");
  }, [initialMode]);

  useEffect(() => {
    setCaptchaAnswer("");
    setCaptchaQuestion(makeCaptchaQuestion());
  }, [mode]);

  function refreshLocalCaptcha() {
    setCaptchaQuestion(makeCaptchaQuestion());
    setCaptchaAnswer("");
  }

  function requireCaptcha() {
    if (!needsCaptcha || captchaOk) return true;
    setMessage({ type: "error", text: "Completá la verificación de seguridad antes de continuar." });
    return false;
  }

  async function handleLogin(e) {
    e.preventDefault();
    if (!requireCaptcha()) return;
    setLoading(true);
    setMessage(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setMessage({ type: "error", text: "Email o contraseña incorrectos." });
      setLoading(false);
      refreshLocalCaptcha();
      return;
    }

    window.location.reload();
  }

  async function handleRegister(e) {
    e.preventDefault();
    if (!strongPassword) {
      setMessage({ type: "error", text: "La contraseña debe cumplir todos los requisitos de seguridad." });
      return;
    }
    if (!requireCaptcha()) return;
    setLoading(true);
    setMessage(null);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });

    if (error) {
      setMessage({
        type: "error",
        text: getAuthErrorMessage(error, "No pudimos crear la cuenta. Intentá nuevamente."),
      });
      setLoading(false);
      refreshLocalCaptcha();
      return;
    }

    /* Insertar perfil en tabla profiles */
    if (data?.user) {
      await supabase.from("profiles").insert([{
        id:        data.user.id,
        email,
        full_name: fullName,
        role:      "seller",
        approved:  false,
        allowed_modules: ["sellerDashboard", "visits", "opportunities", "accounts"],
      }]);
    }

    setMessage({
      type: "success",
      text: "Cuenta creada. Revisá tu email para confirmar tu registro. Un administrador aprobará tu acceso.",
    });
    setLoading(false);
  }

  async function handleResetEmail(e) {
    e.preventDefault();
    if (!requireCaptcha()) return;
    setLoading(true);
    setMessage(null);

    const recoveryUrl = new URL(window.location.origin);
    recoveryUrl.searchParams.set("recovery", "1");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: recoveryUrl.toString(),
    });

    if (error) {
      setMessage({
        type: "error",
        text: getAuthErrorMessage(error, "No pudimos enviar el email de recuperación. Intentá nuevamente."),
      });
    } else {
      setMessage({ type: "success", text: "Email de recuperación enviado. Revisá tu bandeja." });
    }
    setLoading(false);
  }

  async function handleNewPassword(e) {
    e.preventDefault();
    if (!strongPassword) {
      setMessage({ type: "error", text: "La nueva contraseña debe cumplir todos los requisitos de seguridad." });
      return;
    }
    setLoading(true);
    setMessage(null);

    if (!passwordConfirmed) {
      setMessage({ type: "error", text: "Las contraseñas no coinciden." });
      setLoading(false);
      return;
    }

    const { data: { session: recoverySession } } = await supabase.auth.getSession();
    if (!recoverySession) {
      setMessage({ type: "error", text: "El enlace venció o ya fue utilizado. Solicitá un nuevo email de recuperación." });
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setMessage({
        type: "error",
        text: getAuthErrorMessage(error, "No pudimos actualizar la contraseña. Solicitá un nuevo enlace."),
      });
      setLoading(false);
      return;
    }

    setMessage({ type: "success", text: "Contraseña actualizada correctamente. Ya podés ingresar con tu nueva clave." });
    setLoading(false);
    setTimeout(async () => {
      await supabase.auth.signOut();
      onRecoveryComplete?.();
      window.location.replace(window.location.origin);
    }, 1500);
  }

  const titles = {
    login:    "Acceso al sistema comercial",
    register: "Crear cuenta nueva",
    reset:    "Recuperar contraseña",
    recovery: "Definí tu nueva contraseña",
  };

  const changeMode = next => {
    setMode(next);
    setMessage(null);
  };

  function CaptchaBox() {
    if (!needsCaptcha) return null;

    return (
      <div style={s.captchaBox}>
        <label style={s.captchaLabel}>Verificación de seguridad</label>
        <div style={s.captchaRow}>
          <span style={s.captchaQuestion}>{captchaQuestion.label} =</span>
          <input
            type="text"
            inputMode="numeric"
            value={captchaAnswer}
            onChange={(e) => setCaptchaAnswer(e.target.value)}
            placeholder="Resultado"
            required
            style={{ ...s.input, margin: 0 }}
          />
          <button type="button" style={s.captchaRefresh} onClick={refreshLocalCaptcha} aria-label="Cambiar captcha">
            ↻
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={s.container}>
      <div style={s.card}>

        {/* LOGO */}
        <div style={s.logoWrap}>
          <img src={logoImg} alt="STORING Medical" style={s.logo} />
        </div>

        <p style={s.subtitle}>{titles[mode]}</p>

        {/* MENSAJE */}
        {message && (
          <div style={{ ...s.message, background: message.type === "error" ? "#fef2f2" : "#f0fdf4", color: message.type === "error" ? "#dc2626" : "#16a34a", border: `1px solid ${message.type === "error" ? "#fecaca" : "#bbf7d0"}` }}>
            {message.text}
          </div>
        )}

        {/* LOGIN */}
        {mode === "login" && (
          <form onSubmit={handleLogin} style={s.form}>
            <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required style={s.input} />
            <input type="password" placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)} required style={s.input} />
            <CaptchaBox />
            <button style={s.button} disabled={loading || !captchaOk}>{loading ? "Ingresando..." : "Ingresar"}</button>
            <div style={s.links}>
              <button type="button" style={s.linkBtn} onClick={() => changeMode("register")}>Crear cuenta</button>
              <span style={s.dot}>·</span>
              <button type="button" style={s.linkBtn} onClick={() => changeMode("reset")}>Olvidé mi contraseña</button>
            </div>
          </form>
        )}

        {/* REGISTRO */}
        {mode === "register" && (
          <form onSubmit={handleRegister} style={s.form}>
            <input type="text" placeholder="Nombre completo" value={fullName} onChange={(e) => setFullName(e.target.value)} required style={s.input} />
            <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required style={s.input} />
            <input type="password" placeholder="Contraseña segura" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} style={s.input} />
            <PasswordChecklist password={password} />
            <CaptchaBox />
            <p style={s.hint}>Tu cuenta quedará pendiente de aprobación por un administrador.</p>
            <button style={s.button} disabled={loading || !strongPassword || !captchaOk}>{loading ? "Registrando..." : "Crear cuenta"}</button>
            <button type="button" style={s.linkBtn} onClick={() => changeMode("login")}>← Volver al login</button>
          </form>
        )}

        {/* RESET */}
        {mode === "reset" && (
          <form onSubmit={handleResetEmail} style={s.form}>
            <input type="email" placeholder="Tu email" value={email} onChange={(e) => setEmail(e.target.value)} required style={s.input} />
            <CaptchaBox />
            <button style={s.button} disabled={loading || !captchaOk}>{loading ? "Enviando..." : "Enviar email de recuperación"}</button>
            <button type="button" style={s.linkBtn} onClick={() => changeMode("login")}>← Volver al login</button>
          </form>
        )}

        {/* RECOVERY */}
        {mode === "recovery" && (
          <form onSubmit={handleNewPassword} style={s.form}>
            <input type="password" placeholder="Nueva contraseña segura" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} style={s.input} />
            <input type="password" placeholder="Repetí la nueva contraseña" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={10} style={s.input} />
            <PasswordChecklist password={password} />
            <button style={s.button} disabled={loading || !strongPassword || !passwordConfirmed}>{loading ? "Guardando..." : "Guardar nueva contraseña"}</button>
          </form>
        )}

      </div>
      <p style={s.credit}>Designed by Daniel Etchudez</p>
    </div>
  );
}

const s = {
  container: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    background: "#f4f6f9",
    fontFamily: "'DM Sans', system-ui, sans-serif",
  },
  card: {
    background: "#ffffff",
    padding: "36px 32px 28px",
    borderRadius: 20,
    width: 380,
    boxShadow: "0 4px 24px rgba(15,23,42,0.08), 0 1px 4px rgba(15,23,42,0.04)",
    border: "1px solid #e8ecf2",
    textAlign: "center",
  },
  logoWrap: {
    display: "flex",
    justifyContent: "center",
    marginBottom: 16,
  },
  logo: {
    width: 160,
    height: "auto",
    objectFit: "contain",
  },
  subtitle: {
    margin: "0 0 20px",
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: 500,
  },
  message: {
    padding: "10px 14px",
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 600,
    marginBottom: 14,
    textAlign: "left",
    lineHeight: 1.4,
  },
  form: {
    display: "grid",
    gap: 10,
  },
  input: {
    padding: "12px 14px",
    borderRadius: 10,
    border: "1px solid #e8ecf2",
    fontSize: 14,
    background: "#f8fafc",
    color: "#0f172a",
    outline: "none",
    fontFamily: "inherit",
    width: "100%",
    boxSizing: "border-box",
  },
  button: {
    padding: "13px 14px",
    borderRadius: 10,
    border: "none",
    background: "#3b82f6",
    color: "white",
    fontWeight: 700,
    fontSize: 14,
    cursor: "pointer",
    fontFamily: "inherit",
    marginTop: 2,
  },
  links: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  dot: {
    color: "#cbd5e1",
    fontSize: 12,
  },
  linkBtn: {
    border: "none",
    background: "transparent",
    color: "#64748b",
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "inherit",
    padding: 0,
  },
  hint: {
    margin: "0",
    fontSize: 11.5,
    color: "#94a3b8",
    textAlign: "left",
    lineHeight: 1.4,
  },
  passwordBox: {
    display: "grid",
    gap: 5,
    padding: "10px 12px",
    borderRadius: 12,
    background: "#f8fafc",
    border: "1px solid #e8ecf2",
    textAlign: "left",
  },
  passwordRule: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    fontSize: 11.5,
    fontWeight: 650,
    lineHeight: 1.2,
  },
  ruleDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    flexShrink: 0,
  },
  captchaBox: {
    display: "grid",
    gap: 7,
    padding: "10px 12px",
    borderRadius: 12,
    background: "#f8fafc",
    border: "1px solid #e8ecf2",
    textAlign: "left",
  },
  captchaLabel: {
    color: "#64748b",
    fontSize: 11.5,
    fontWeight: 750,
  },
  captchaRow: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) 34px",
    alignItems: "center",
    gap: 8,
  },
  captchaQuestion: {
    color: "#0f2444",
    fontSize: 14,
    fontWeight: 800,
    whiteSpace: "nowrap",
  },
  captchaRefresh: {
    width: 34,
    height: 34,
    borderRadius: 10,
    border: "1px solid #dbe4ef",
    background: "#ffffff",
    color: "#2563eb",
    fontWeight: 900,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  credit: {
    marginTop: 20,
    fontSize: 10,
    color: "#cbd5e1",
    fontFamily: "inherit",
  },
};
