import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installNativeBehaviour } from "./lib/nativeFeel";
import "./index.css";

installNativeBehaviour();

const container = document.getElementById("root");
if (!container) throw new Error("SessionPal could not find the application root.");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
