import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function RegisterPage({ onGoLogin }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function register(e) {
    e.preventDefault();

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
      },
    });

    if (error) {
      alert("Error registrando usuario: " + error.message);
      return;
    }

    alert("Usuario registrado. Debe ser aprobado por el administrador.");
    onGoLogin();
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={register}>
        <h1>Crear usuario</h1>
        <p>El acceso queda pendiente de aprobación.</p>

        <label>Nombre completo</label>
        <input
          placeholder="Nombre y apellido"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
        />

        <label>Email</label>
        <input
          type="email"
          placeholder="usuario@storingmedical.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <label>Contraseña</label>
        <input
          type="password"
          placeholder="Mínimo 6 caracteres"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <button>Registrarme</button>

        <span className="auth-link" onClick={onGoLogin}>
          Ya tengo usuario
        </span>
      </form>
    </div>
  );
}