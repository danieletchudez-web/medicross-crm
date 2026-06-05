import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { registerServiceWorker } from "./lib/registerServiceWorker";
import "./components/CRMUI.css";
import "./components/GlobalSearch.css";
// 🔥 ESTA LÍNEA ES LA CLAVE
import "./index.css";

document.documentElement.setAttribute("data-theme", "light");
localStorage.removeItem("theme");

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

registerServiceWorker();
