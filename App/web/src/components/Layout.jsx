import React from "react";
import { Outlet, NavLink } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";

export default function Layout() {
  return (
    <div className="inventory-chat-shiftable min-h-screen bg-background">
      <nav className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 flex items-center h-14 gap-6">
          <span className="font-bold text-lg tracking-tight">
            Smart Appetite Manager
          </span>
          <div className="flex gap-1">
            <NavLink
              to="/inventory"
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`
              }
            >
              Inventory
            </NavLink>
            <NavLink
              to="/recipes"
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`
              }
            >
              Recipes
            </NavLink>
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
