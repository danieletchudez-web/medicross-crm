import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./darkmode.css";
import "./components/CRMUI.css";
// 🔥 ESTA LÍNEA ES LA CLAVE
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
