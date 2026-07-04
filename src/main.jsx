import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { registerServiceWorker } from "./lib/registerServiceWorker";
import "./components/CRMUI.css";
import "./components/GlobalSearch.css";
import "./index.css";
import "./darkmode.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

registerServiceWorker();
