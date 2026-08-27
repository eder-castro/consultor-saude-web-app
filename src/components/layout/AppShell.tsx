import { Link, useLocation } from "@tanstack/react-router";
import { MessageCircle, LayoutDashboard, User, Wifi, WifiOff } from "lucide-react";
import { useApiConfig, isMockMode } from "@/lib/api-config";
import { useEffect, useState, type ReactNode } from "react";

export function AppShell({ children, title }: { children: ReactNode; title: string }) {
  const cfg = useApiConfig();
  const mock = isMockMode(cfg);
  const location = useLocation();
  const [today, setToday] = useState("");

  useEffect(() => {
    const updateDate = () =>
      setToday(
        new Date().toLocaleDateString("pt-BR", {
          weekday: "short",
          day: "2-digit",
          month: "short",
        }),
      );

    updateDate();
    const timer = window.setInterval(updateDate, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const tabs = [
    { to: "/", label: "Chat", icon: MessageCircle },
    { to: "/dashboard", label: "Dia", icon: LayoutDashboard },
    { to: "/perfil", label: "Perfil", icon: User },
  ] as const;

  return (
    <div className="flex h-[100dvh] flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h1 className="text-base font-semibold tracking-tight">{title}</h1>
          <p className="text-xs text-muted-foreground capitalize">{today || "\u00a0"}</p>
        </div>
        <div
          className={`flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs ${
            mock ? "text-muted-foreground" : "text-primary"
          }`}
        >
          {mock ? <WifiOff className="size-3" /> : <Wifi className="size-3" />}
          {mock ? "Demo" : "Online"}
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">{children}</main>

      <nav className="grid shrink-0 grid-cols-3 border-t border-border bg-card">
        {tabs.map(({ to, label, icon: Icon }) => {
          const active = to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              className={`flex flex-col items-center gap-0.5 py-2.5 text-xs transition-colors ${
                active ? "text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="size-5" />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
