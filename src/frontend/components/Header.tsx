import { Search } from "lucide-react";

interface HeaderProps {
  activeTab: string;
  searchTerm: string;
  onSearchChange: (value: string) => void;
}

export function Header({ activeTab, searchTerm, onSearchChange }: HeaderProps) {
  return (
    <header className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-zinc-200 px-10 py-6 flex items-center justify-between shadow-sm">
      <div>
        <h2 className="text-lg font-bold text-zinc-900 capitalize tracking-tight flex items-center gap-3">
          {activeTab}
          <span className="h-4 w-px bg-zinc-200" />
          <span className="text-[10px] text-zinc-400 font-medium">Synced {new Date().toLocaleTimeString()}</span>
        </h2>
      </div>
      <div className="flex items-center gap-4">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Global Search..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="bg-zinc-50 border border-zinc-200 rounded-lg py-2 pl-9 pr-4 text-[11px] font-medium focus:outline-none focus:border-teal-accent/30 transition-all w-72"
          />
        </div>
        <div className="flex items-center gap-2 border-l border-zinc-200 pl-4 ml-2">
          <div className="w-8 h-8 rounded-full bg-zinc-100 border border-zinc-200" />
        </div>
      </div>
    </header>
  );
}
