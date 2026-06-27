import type { ReactNode } from "react";

interface AppLayoutProps {
  notification: ReactNode;
  sidebar: ReactNode;
  header: ReactNode;
  children: ReactNode;
}

export function AppLayout({ notification, sidebar, header, children }: AppLayoutProps) {
  return (
    <div className="flex h-screen bg-[#F8FAFC] text-zinc-700 font-sans selection:bg-[#00ADC6]/20 relative">
      {notification}
      {sidebar}
      <main className="flex-1 overflow-y-auto relative flex flex-col">
        {header}
        <div className="p-10 flex-1">
          {children}
        </div>
      </main>
    </div>
  );
}
