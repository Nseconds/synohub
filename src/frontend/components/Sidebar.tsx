import type { ComponentType } from "react";
import { Shield } from "lucide-react";
import { cn } from "../../lib/utils";

interface SidebarUser {
  name: string;
  role: string;
}

interface NavItem {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}

interface SidebarProps {
  activeTab: string;
  navItems: NavItem[];
  user: SidebarUser | null;
  onNavigate: (tabId: string) => void;
  onLogout: () => void;
}

export function Sidebar({ activeTab, navItems, user, onNavigate, onLogout }: SidebarProps) {
  return (
    <aside className="w-64 border-r border-zinc-200 bg-white flex flex-col pt-8 shadow-sm z-30">
      <div className="px-8 mb-10 group cursor-pointer">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-teal-accent flex items-center justify-center shadow-lg shadow-teal-accent/20 transition-transform group-hover:scale-105">
            <Shield className="text-white" strokeWidth={2.5} size={18} />
          </div>
          <div>
            <h1 className="text-zinc-900 font-bold tracking-tight text-lg">SynoHub</h1>
            <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">Fleet Intelligence</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-4 space-y-0.5">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-xs font-bold transition-all",
              activeTab === item.id
                ? "bg-teal-accent text-white shadow-md shadow-teal-accent/20"
                : "text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100"
            )}
          >
            <item.icon size={16} className={cn(activeTab === item.id ? "text-white" : "text-zinc-400")} />
            {item.label}
          </button>
        ))}
      </nav>

      {user && (
        <div className="px-6 pb-2">
          <div className="bg-zinc-50 rounded-xl p-3 border border-zinc-100 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-[11px] font-bold text-zinc-900 truncate max-w-[125px]" title={user.name}>
                  {user.name}
                </span>
                <span className={cn(
                  "text-[9px] font-mono tracking-wider uppercase px-1.5 py-0.5 rounded w-max mt-0.5",
                  user.role === "admin" ? "bg-rose-50 border border-rose-100 text-rose-600" :
                  user.role === "staff" ? "bg-teal-50 border border-teal-100 text-teal-600" : "bg-zinc-100 border border-zinc-200 text-zinc-600"
                )}>
                  {user.role}
                </span>
              </div>
              <button
                onClick={onLogout}
                className="text-[10px] text-zinc-400 hover:text-rose-500 font-bold uppercase tracking-wider pl-2 transition-colors cursor-pointer"
                title="Sign Out"
              >
                Exit
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="p-6">
        <div className="bg-zinc-50 rounded-xl p-4 border border-zinc-100">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-1.5 h-1.5 rounded-full bg-teal-accent animate-pulse" />
            <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">v2.4 Stable</span>
          </div>
          <p className="text-[10px] text-zinc-500 leading-tight">All systems operational.</p>
        </div>
      </div>
    </aside>
  );
}
