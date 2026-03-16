import React from "react";
import { Outlet, NavLink, Link } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import {
  ChefHatIcon,
  LayoutDashboardIcon,
  PackageIcon,
  UtensilsCrossedIcon,
  ShoppingCartIcon,
} from "lucide-react";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", end: true, icon: LayoutDashboardIcon, activeColor: "bg-gray-800 text-white" },
  { to: "/inventory", label: "Inventory", icon: PackageIcon, activeColor: "bg-emerald-600 text-white" },
  { to: "/recipes", label: "Recipes", icon: UtensilsCrossedIcon, activeColor: "bg-orange-500 text-white" },
  { to: "/shopping", label: "Shopping", icon: ShoppingCartIcon, activeColor: "bg-sky-600 text-white" },
];

export default function Layout() {
  return (
    <div className="inventory-chat-shiftable min-h-screen bg-background flex flex-col">
      <nav className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 flex items-center h-14 gap-6">
          <Link to="/" className="flex items-center gap-2.5 shrink-0 group">
            <span className="font-bold text-lg tracking-tight hidden sm:inline">
              Smart Appetite Manager
            </span>
            <span className="font-bold text-lg tracking-tight sm:hidden">
              SAM
            </span>
          </Link>

          <div className="h-6 w-px bg-border hidden sm:block" />

          <div className="flex gap-1">
            {NAV_ITEMS.map(({ to, label, end, icon: Icon, activeColor }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                    isActive
                      ? activeColor
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  }`
                }
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{label}</span>
              </NavLink>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-1.5 chat-hide-branding">
            <span className="text-xs text-muted-foreground hidden md:inline">Powered by</span>
            <img
              src="/SAM-Logo.png"
              alt="Solace Agent Mesh"
              className="h-5 w-5"
            />
            <span className="text-xs font-medium text-muted-foreground hidden md:inline">
              Solace Agent Mesh
            </span>
          </div>
        </div>
      </nav>

      <main className="flex-1">
        <Outlet />
      </main>


      <Toaster richColors position="top-right" />
    </div>
  );
}
