import { Link, useLocation } from "@tanstack/react-router";
import { MessageCircle, LayoutDashboard, User, LogOut, Moon, Sun } from "lucide-react";
import { useAuth } from "@/providers/auth-context";
import { useTheme } from "@/providers/theme-context";
import { useEffect, useState, type ReactNode } from "react";

export function AppShell({ children, title }: { children: ReactNode; title: string }) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
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
      <header className="flex shrink-0 items-center justify-between border-b border-border/60 px-5 py-4 sm:px-8">
        <div>
          <h1 className="text-lg font-medium tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground capitalize">{today || "\u00a0"}</p>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            aria-label={theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
            title={theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
            onClick={toggleTheme}
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-border/60 text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent/60 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <button
            type="button"
            data-testid="button-logout"
            onClick={() => void logout()}
            className="flex max-w-[220px] min-w-0 items-center gap-2 rounded-full border border-border/60 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
          >
            <span className="truncate">{user?.email}</span>
            <LogOut className="size-3.5 shrink-0" />
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">{children}</main>

      <nav className="grid shrink-0 grid-cols-3 border-t border-border/60 bg-background/90 backdrop-blur">
        {tabs.map(({ to, label, icon: Icon }) => {
          const active = to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              className={`flex flex-col items-center gap-1 py-3 text-xs transition-colors ${
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
