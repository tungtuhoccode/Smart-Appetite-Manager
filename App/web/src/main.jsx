import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import InventoryPage from "./pages/InventoryPage";
import RecipeDiscoveryPage from "./pages/RecipeDiscoveryPage";
import Layout from "./components/Layout";
import "./index.css";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<App />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/recipes" element={<RecipeDiscoveryPage />} />
      </Route>
    </Routes>
  </BrowserRouter>
);
