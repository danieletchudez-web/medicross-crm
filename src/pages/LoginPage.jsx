import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import logoImg from "../assets/logo.jpg";

export default function LoginPage() {
  const [mode, setMode]         = useState("login");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading]   = useState(false);
  const [message, setMessage]   = useState(null);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("type=recovery")) setMode("recovery");
  }, []);

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setMessage({ type: "error", text: "Email o contraseña incorrectos." });
      setLoading(false);
      return;
    }

    window.location.reload();
  }

  async function handleRegister(e) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });

    if (error) {
      setMessage({ type: "error", text: error.message });
      setLoading(false);
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
    setLoading(true);
    setMessage(null);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });

    if (error) {
      setMessage({ type: "error", text: error.message });
    } else {
      setMessage({ type: "success", text: "Email de recuperación enviado. Revisá tu bandeja." });
    }
    setLoading(false);
  }

  async function handleNewPassword(e) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setMessage({ type: "error", text: error.message });
      setLoading(false);
      return;
    }

    setMessage({ type: "success", text: "Contraseña actualizada correctamente." });
    setLoading(false);
    setTimeout(() => { window.location.href = window.location.origin; }, 1500);
  }

  const titles = {
    login:    "Acceso al sistema comercial",
    register: "Crear cuenta nueva",
    reset:    "Recuperar contraseña",
    recovery: "Definí tu nueva contraseña",
  };

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
            <button style={s.button} disabled={loading}>{loading ? "Ingresando..." : "Ingresar"}</button>
            <div style={s.links}>
              <button type="button" style={s.linkBtn} onClick={() => { setMode("register"); setMessage(null); }}>Crear cuenta</button>
              <span style={s.dot}>·</span>
              <button type="button" style={s.linkBtn} onClick={() => { setMode("reset"); setMessage(null); }}>Olvidé mi contraseña</button>
            </div>
          </form>
        )}

        {/* REGISTRO */}
        {mode === "register" && (
          <form onSubmit={handleRegister} style={s.form}>
            <input type="text" placeholder="Nombre completo" value={fullName} onChange={(e) => setFullName(e.target.value)} required style={s.input} />
            <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required style={s.input} />
            <input type="password" placeholder="Contraseña (mín. 6 caracteres)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} style={s.input} />
            <p style={s.hint}>Tu cuenta quedará pendiente de aprobación por un administrador.</p>
            <button style={s.button} disabled={loading}>{loading ? "Registrando..." : "Crear cuenta"}</button>
            <button type="button" style={s.linkBtn} onClick={() => { setMode("login"); setMessage(null); }}>← Volver al login</button>
          </form>
        )}

        {/* RESET */}
        {mode === "reset" && (
          <form onSubmit={handleResetEmail} style={s.form}>
            <input type="email" placeholder="Tu email" value={email} onChange={(e) => setEmail(e.target.value)} required style={s.input} />
            <button style={s.button} disabled={loading}>{loading ? "Enviando..." : "Enviar email de recuperación"}</button>
            <button type="button" style={s.linkBtn} onClick={() => { setMode("login"); setMessage(null); }}>← Volver al login</button>
          </form>
        )}

        {/* RECOVERY */}
        {mode === "recovery" && (
          <form onSubmit={handleNewPassword} style={s.form}>
            <input type="password" placeholder="Nueva contraseña" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} style={s.input} />
            <button style={s.button} disabled={loading}>{loading ? "Guardando..." : "Guardar nueva contraseña"}</button>
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
  credit: {
    marginTop: 20,
    fontSize: 10,
    color: "#cbd5e1",
    fontFamily: "inherit",
  },
};