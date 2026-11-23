import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Calculator } from "./Calculator";
import "./app.css";

const root = document.getElementById("root");

if (root) {
  createRoot(root).render(
    <StrictMode>
      <main><Calculator syncUrl /></main>
    </StrictMode>,
  );
}
