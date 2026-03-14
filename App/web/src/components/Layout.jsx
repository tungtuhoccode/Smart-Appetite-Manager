import React from "react";
import { Outlet, NavLink, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", end: true, activeColor: "bg-gray-800 text-white" },
  { to: "/inventory", label: "Inventory", activeColor: "bg-emerald-600 text-white" },
  { to: "/recipes", label: "Recipes", activeColor: "bg-orange-500 text-white" },
  { to: "/shopping", label: "Shopping", activeColor: "bg-sky-600 text-white" },
];

export default function Layout() {
  return (
    <div className="inventory-chat-shiftable min-h-screen bg-background">
      <nav className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 flex items-center h-14 gap-6">
          <span className="font-bold text-lg tracking-tight">
            Smart Appetite Manager
          </span>
          <div className="flex gap-1">
            {NAV_ITEMS.map(({ to, label, end, activeColor }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? activeColor
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1.5 chat-hide-branding">
            <span className="text-xs text-muted-foreground">Powered by</span>
            <img
              src="/SAM-Logo.png"
              alt="Solace Agent Mesh"
              className="h-5 w-5"
            />
            <span className="text-xs font-medium text-muted-foreground">
              Solace Agent Mesh
            </span>
          </div>
        </div>
      </nav>
      <main>
        <Outlet />
      </main>
      <Toaster richColors position="top-right" />
    </div>
  );
}
