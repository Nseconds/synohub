import { Activity, ChevronRight, Clock, Database, MapPin, Package, Shield, Users, Zap } from "lucide-react";
import { motion } from "motion/react";

interface Registration {
  id: number;
  customerName: string;
  contactName: string;
  region: string;
  status: string;
  salesPerson: string;
  requestedPerson?: string;
  projectValue?: string;
  newQty: number;
  migrateQty: number;
  tradingQty: number;
  serviceQty: number;
  otherQty: number;
}

interface ServiceTicket {
  id: number;
  status: string;
}

interface DashboardError {
  error: string;
  details?: string;
  connectionConfig?: any;
}

interface DashboardPageProps {
  registrations: Registration[];
  services: ServiceTicket[];
  filteredRegistrations: Registration[];
  searchTerm: string;
  dbError: DashboardError | null;
  showDiagnostics: boolean;
  showAllFeed: boolean;
  regions: string[];
  onToggleDiagnostics: () => void;
  onSelectLead: (leadId: number) => void;
  onToggleShowAllFeed: () => void;
}

const StatCard = ({ label, value, icon: Icon, color, subValue }: { label: string, value: string | number, icon: any, color: string, subValue?: string }) => (
  <div className="bg-white border border-zinc-200 p-6 rounded-xl flex flex-col gap-3 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
    <div className="flex items-center justify-between">
      <div className="p-2.5 rounded-lg bg-zinc-50 border border-zinc-100">
        <Icon size={18} className="text-zinc-600" />
      </div>
      {subValue && <span className="text-[10px] font-bold text-teal-accent uppercase tracking-wider">{subValue}</span>}
    </div>
    <div>
      <div className="text-2xl font-bold text-zinc-900">{value}</div>
      <div className="text-xs font-medium text-zinc-500 mt-0.5">{label}</div>
    </div>
  </div>
);

function formatCurrency(val: number) {
  if (val >= 1_000_000) {
    return `AED ${(val / 1_000_000).toFixed(2)}M`;
  }
  if (val >= 1_000) {
    return `AED ${(val / 1_000).toFixed(1)}K`;
  }
  return `AED ${val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function safePercent(part: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

export function DashboardPage({
  registrations,
  services,
  filteredRegistrations,
  searchTerm,
  dbError,
  showDiagnostics,
  showAllFeed,
  regions,
  onToggleDiagnostics,
  onSelectLead,
  onToggleShowAllFeed,
}: DashboardPageProps) {
  const regs = registrations || [];
  const svcs = services || [];

  let wonProjectValue = 0;
  let pipelineValue = 0;

  regs.forEach(reg => {
    const val = parseFloat(reg.projectValue || "0") || 0;
    if (reg.status === "Completed" || reg.status === "Won" || reg.status === "Approved") {
      wonProjectValue += val;
    } else if (reg.status !== "Lost" && reg.status !== "Deleted") {
      pipelineValue += val;
    }
  });

  let newUnits = 0;
  let migrateUnits = 0;
  let tradingUnits = 0;
  let serviceUnits = 0;
  let otherUnits = 0;

  regs.forEach(reg => {
    newUnits += reg.newQty || 0;
    migrateUnits += reg.migrateQty || 0;
    tradingUnits += reg.tradingQty || 0;
    serviceUnits += reg.serviceQty || 0;
    otherUnits += reg.otherQty || 0;
  });

  const totalRegisteredUnits = newUnits + migrateUnits + tradingUnits + serviceUnits + otherUnits;

  const regionMap: Record<string, { count: number, value: number }> = {};
  regions.forEach(r => {
    regionMap[r] = { count: 0, value: 0 };
  });
  regs.forEach(reg => {
    const r = reg.region || "Other";
    if (!regionMap[r]) regionMap[r] = { count: 0, value: 0 };
    regionMap[r].count += 1;
    regionMap[r].value += parseFloat(reg.projectValue || "0") || 0;
  });

  const regionsSorted = Object.entries(regionMap)
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.count - a.count);

  const repPerformanceMap: Record<string, { count: number, value: number, won: number }> = {};
  regs.forEach(reg => {
    const rep = reg.salesPerson || reg.requestedPerson || "Unassigned";
    const val = parseFloat(reg.projectValue || "0") || 0;
    const isWon = reg.status === "Completed" || reg.status === "Won" || reg.status === "Approved";

    if (!repPerformanceMap[rep]) {
      repPerformanceMap[rep] = { count: 0, value: 0, won: 0 };
    }
    repPerformanceMap[rep].count += 1;
    repPerformanceMap[rep].value += val;
    if (isWon) repPerformanceMap[rep].won += val;
  });

  const leaderboardSorted = Object.entries(repPerformanceMap)
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const statusCounts: Record<string, number> = {};
  regs.forEach(reg => {
    const st = reg.status || "New Lead";
    statusCounts[st] = (statusCounts[st] || 0) + 1;
  });

  const pendingServicesCount = svcs.filter(s => s.status !== "Completed" && s.status !== "Solved").length;
  const totalLeads = regs.length;

  return (
    <motion.div
      key="overview"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-8 pb-10"
    >
      {dbError && (
        <div className="bg-amber-50/90 border border-amber-200/80 rounded-xl p-5 shadow-sm text-stone-900 space-y-4">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-amber-100 rounded-lg text-amber-700 mt-1">
              <Database className="w-6 h-6 animate-pulse" />
            </div>
            <div className="flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-amber-950 text-base">Live Database Offline (Demo Mode Active)</h3>
                <span className="px-2 py-0.5 text-xs font-semibold bg-amber-100 border border-amber-200 text-amber-800 rounded-full">Disconnected</span>
              </div>
              <p className="text-sm text-amber-900/85 max-w-4xl leading-relaxed">
                SynoHub SQL Database is currently unreachable on <strong>{dbError.connectionConfig?.host || 'localhost'}</strong>.
                Since this dashboard environment is hosted on isolated, serverless cloud containers, <code>localhost</code> references the container sandbox itself.
                To ensure you have a fully functional preview, we have pre-loaded your SQL dataset as rich <strong>Demo Data</strong> below! You can continue testing leads, reports, and table updates.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={onToggleDiagnostics}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors cursor-pointer"
            >
              <Activity className="w-3.5 h-3.5" />
              {showDiagnostics ? "Hide Setup Guide" : "Troubleshoot Connection"}
            </button>
            <span className="text-xs text-amber-800/60 font-mono">
              Error Code: {dbError.error.split(' ')[0] || 'ECONNREFUSED'}
            </span>
          </div>

          {showDiagnostics && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="border-t border-amber-200/60 pt-4 space-y-4"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white/60 p-4 rounded-lg border border-amber-200/40 space-y-2">
                  <h4 className="text-xs font-bold text-amber-900 uppercase tracking-wider">Attempted Config</h4>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 text-xs font-mono text-stone-700">
                    <div>DB Host:</div>
                    <div className="text-amber-950 font-bold">{dbError.connectionConfig?.host}</div>
                    <div>DB Port:</div>
                    <div className="text-amber-950 font-bold">{dbError.connectionConfig?.port}</div>
                    <div>DB User:</div>
                    <div className="text-amber-950">{dbError.connectionConfig?.user}</div>
                    <div>Database:</div>
                    <div className="text-amber-950">{dbError.connectionConfig?.database}</div>
                    <div>Password:</div>
                    <div className="text-amber-950">
                      {dbError.connectionConfig?.passwordProvided ? "•••••••• (Custom)" : "None Provided"}
                    </div>
                    <div>Socket Path:</div>
                    <div className="text-stone-500 overflow-hidden text-ellipsis whitespace-nowrap" title={dbError.connectionConfig?.socketPath}>
                      {dbError.connectionConfig?.socketPath}
                    </div>
                  </div>
                </div>

                <div className="bg-stone-900 text-stone-200 p-4 rounded-lg font-mono text-xs space-y-1.5 relative overflow-x-auto border border-stone-800 shadow-inner">
                  <div className="flex items-center justify-between pb-1 border-b border-stone-800 mb-1.5 text-stone-400 font-sans text-[10px] uppercase font-bold tracking-wider">
                    <span>Terminal System Exception</span>
                    <span className="text-red-400">● Failure</span>
                  </div>
                  <div className="text-red-400 font-bold">{dbError.error}</div>
                  {dbError.details && <div className="text-stone-400 mt-1">{dbError.details}</div>}
                </div>
              </div>

              <div className="bg-amber-100/45 p-4 rounded-lg border border-amber-200/50 space-y-2 text-xs text-amber-950 leading-relaxed">
                <h4 className="text-xs font-bold uppercase tracking-wider text-amber-900">How to Connect Your SQL Database</h4>
                <ul className="list-decimal pl-4 space-y-1.5">
                  <li>
                    <strong>Host your database or expose your port:</strong> Ensure your MySQL database is running on a cloud instance (e.g., AWS RDS, PlanetScale, Supabase) or expose your local port via a secure tunnel like <code>ngrok tcp 3306</code>.
                  </li>
                  <li>
                    <strong>Configure Credentials:</strong> Open the <strong>Settings</strong> panel of Google AI Studio and navigate to the <strong>Secrets</strong> or Environment Variables section.
                  </li>
                  <li>
                    <strong>Assign connection variables:</strong> Save your database connection configs under these exact keys:
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-2 font-mono text-[11px] bg-white/70 p-2 rounded border border-amber-200 text-stone-800">
                      <div><code>DB_HOST</code></div>
                      <div><code>DB_PORT</code></div>
                      <div><code>DB_USER</code></div>
                      <div><code>DB_PASSWORD</code></div>
                      <div><code>DB_NAME</code></div>
                    </div>
                  </li>
                </ul>
              </div>
            </motion.div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          label="Won Revenue Potential"
          value={formatCurrency(wonProjectValue)}
          icon={Zap}
          color="bg-emerald-500"
          subValue={`Pipeline: ${formatCurrency(pipelineValue)}`}
        />
        <StatCard
          label="Active System Units"
          value={totalRegisteredUnits}
          icon={Package}
          color="bg-teal-accent"
          subValue={`New Tracker: ${newUnits}`}
        />
        <StatCard
          label="Total Leads Count"
          value={totalLeads}
          icon={Users}
          color="bg-sky-500"
          subValue={`Won / Completed: ${(statusCounts["Won"] || 0) + (statusCounts["Completed"] || 0)}`}
        />
        <StatCard
          label="Services Queue Balance"
          value={`${pendingServicesCount} Pending`}
          icon={Shield}
          color="bg-zinc-800"
          subValue={`Total Tickets: ${svcs.length}`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm space-y-6">
            <div>
              <h3 className="font-bold text-zinc-950 text-sm tracking-tight flex items-center gap-2">
                <Database className="text-teal-accent" size={16} />
                Units Allocation by Tracker Configuration
              </h3>
              <p className="text-zinc-500 text-[11px] mt-0.5">Distribution map of {totalRegisteredUnits} trackers requested across all active sales cycles.</p>
            </div>

            <div className="h-6 w-full rounded-lg overflow-hidden flex shadow-inner border border-zinc-100">
              {newUnits > 0 && (
                <div
                  className="h-full bg-teal-accent hover:opacity-95 transition-all text-[10px] font-extrabold text-white flex items-center justify-center pointer-events-none"
                  style={{ width: `${safePercent(newUnits, totalRegisteredUnits)}%` }}
                >
                  {safePercent(newUnits, totalRegisteredUnits) >= 8 && `${safePercent(newUnits, totalRegisteredUnits)}%`}
                </div>
              )}
              {migrateUnits > 0 && (
                <div
                  className="h-full bg-amber-400 hover:opacity-95 transition-all text-[10px] font-extrabold text-[#744210] flex items-center justify-center pointer-events-none"
                  style={{ width: `${safePercent(migrateUnits, totalRegisteredUnits)}%` }}
                >
                  {safePercent(migrateUnits, totalRegisteredUnits) >= 8 && `${safePercent(migrateUnits, totalRegisteredUnits)}%`}
                </div>
              )}
              {tradingUnits > 0 && (
                <div
                  className="h-full bg-rose-500 hover:opacity-95 transition-all text-[10px] font-extrabold text-white flex items-center justify-center pointer-events-none"
                  style={{ width: `${safePercent(tradingUnits, totalRegisteredUnits)}%` }}
                >
                  {safePercent(tradingUnits, totalRegisteredUnits) >= 8 && `${safePercent(tradingUnits, totalRegisteredUnits)}%`}
                </div>
              )}
              {serviceUnits > 0 && (
                <div
                  className="h-full bg-sky-500 hover:opacity-95 transition-all text-[10px] font-extrabold text-white flex items-center justify-center pointer-events-none"
                  style={{ width: `${safePercent(serviceUnits, totalRegisteredUnits)}%` }}
                >
                  {safePercent(serviceUnits, totalRegisteredUnits) >= 8 && `${safePercent(serviceUnits, totalRegisteredUnits)}%`}
                </div>
              )}
              {otherUnits > 0 && (
                <div
                  className="h-full bg-zinc-400 hover:opacity-95 transition-all text-[10px] font-extrabold text-white flex items-center justify-center pointer-events-none"
                  style={{ width: `${safePercent(otherUnits, totalRegisteredUnits)}%` }}
                >
                  {safePercent(otherUnits, totalRegisteredUnits) >= 8 && `${safePercent(otherUnits, totalRegisteredUnits)}%`}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs pt-2">
              <div className="flex items-center gap-2 border-l-4 border-teal-accent pl-2">
                <span className="font-semibold text-zinc-900 block">{newUnits} Unit</span>
                <span className="text-[10px] text-zinc-400 block uppercase font-bold tracking-tight">New Tracker</span>
              </div>
              <div className="flex items-center gap-2 border-l-4 border-amber-400 pl-2">
                <span className="font-semibold text-zinc-900 block">{migrateUnits} Unit</span>
                <span className="text-[10px] text-zinc-400 block uppercase font-bold tracking-tight">Migration</span>
              </div>
              <div className="flex items-center gap-2 border-l-4 border-rose-500 pl-2">
                <span className="font-semibold text-zinc-900 block">{tradingUnits} Unit</span>
                <span className="text-[10px] text-zinc-400 block uppercase font-bold tracking-tight">Trading</span>
              </div>
              <div className="flex items-center gap-2 border-l-4 border-sky-500 pl-2">
                <span className="font-semibold text-zinc-900 block">{serviceUnits} Unit</span>
                <span className="text-[10px] text-zinc-400 block uppercase font-bold tracking-tight">Service</span>
              </div>
              <div className="flex items-center gap-2 border-l-4 border-zinc-400 pl-2">
                <span className="font-semibold text-zinc-900 block">{otherUnits} Unit</span>
                <span className="text-[10px] text-zinc-400 block uppercase font-bold tracking-tight">Other config</span>
              </div>
            </div>
          </div>

          <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-zinc-950 text-sm tracking-tight flex items-center gap-2">
                  <Clock size={16} className="text-teal-accent" />
                  Real-Time Activity Feed
                </h3>
                <p className="text-zinc-500 text-[11px] mt-0.5">Showing recent registrations and updates. Click to view or edit form.</p>
              </div>
            </div>

            <div className="grid gap-3">
              {registrations.length === 0 ? (
                <div className="border border-dashed border-zinc-200 rounded-xl p-16 text-center text-zinc-400 text-xs">
                  No recent activity logs found.
                </div>
              ) : (
                (() => {
                  const sorted = [...registrations].reverse();
                  const visible = showAllFeed ? sorted : sorted.slice(0, 5);
                  return (
                    <>
                      {visible.map((reg, idx) => (
                        <div
                          key={`dash-reg-${reg.id || idx}-${idx}`}
                          onClick={() => onSelectLead(reg.id)}
                          className="flex items-center gap-5 p-4 border border-zinc-100 rounded-xl hover:border-teal-accent/30 hover:bg-zinc-50/50 transition-all group shadow-xs cursor-pointer"
                        >
                          <div className="w-9 h-9 rounded-lg bg-zinc-50 border border-zinc-100 flex items-center justify-center text-zinc-400 group-hover:bg-teal-accent group-hover:text-white group-hover:border-teal-accent transition-all">
                            <ChevronRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-xs font-bold text-zinc-800 truncate group-hover:text-teal-accent transition-colors">{reg.customerName}</h4>
                            <div className="flex items-center gap-3 mt-1 text-[10px]">
                              <span className="text-zinc-500 font-bold bg-zinc-100 px-1.5 py-0.5 rounded uppercase tracking-tighter">{reg.region || "DXB"}</span>
                              <span className={`font-extrabold uppercase tracking-tighter ${
                                reg.status === 'Won' || reg.status === 'Completed' ? 'text-emerald-600' :
                                reg.status === 'Lost' ? 'text-red-500' :
                                'text-zinc-500'
                              }`}>{reg.status}</span>
                              <span className="text-zinc-400 font-semibold">• Contract: {reg.projectValue ? formatCurrency(parseFloat(reg.projectValue)) : "—"}</span>
                            </div>
                          </div>
                          <div className="text-right shrink-0 flex flex-col gap-1.5 justify-center min-w-[100px]">
                            <div>
                              <div className="text-[10px] font-bold text-zinc-900 leading-tight">Sales Person</div>
                              <p className="text-[9px] text-zinc-400 font-semibold uppercase tracking-wider">
                                {reg.salesPerson || "Unassigned"}
                              </p>
                            </div>
                            <div>
                              <div className="text-[10px] font-bold text-zinc-900 leading-tight">Requested Person</div>
                              <p className="text-[9px] text-zinc-400 font-semibold uppercase tracking-wider">
                                {reg.requestedPerson || "Unassigned"}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                      {registrations.length > 5 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleShowAllFeed();
                          }}
                          className="w-full py-2.5 border border-dashed border-zinc-200 hover:border-teal-accent/40 rounded-xl text-[10px] font-extrabold uppercase tracking-wider text-zinc-500 hover:text-teal-accent transition-all text-center mt-2"
                        >
                          {showAllFeed ? "Collapse Activity Feed" : `View All Saved Logs (${registrations.length})`}
                        </button>
                      )}
                    </>
                  );
                })()
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm space-y-4">
            <div>
              <h3 className="font-bold text-zinc-950 text-sm tracking-tight flex items-center gap-2">
                <MapPin size={16} className="text-teal-accent" />
                Regional Market Share
              </h3>
              <p className="text-zinc-500 text-[11px] mt-0.5">Coverage and transaction values spread over regions.</p>
            </div>

            <div className="space-y-3.5 pt-2">
              {regionsSorted.map((reg) => {
                const maxRegionCount = Math.max(...regionsSorted.map(r => r.count)) || 1;
                const widthPct = (reg.count / maxRegionCount) * 100;
                return (
                  <div key={reg.name} className="space-y-1">
                    <div className="flex justify-between text-xs font-semibold">
                      <span className="text-zinc-800">{reg.name}</span>
                      <span className="text-zinc-500 font-mono text-[11px]">{reg.count} Leads ({formatCurrency(reg.value)})</span>
                    </div>
                    <div className="w-full h-1.5 bg-zinc-50 border border-zinc-100 rounded-full overflow-hidden">
                      <div className="h-full bg-teal-accent rounded-full" style={{ width: `${widthPct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm space-y-4">
            <div>
              <h3 className="font-bold text-zinc-950 text-sm tracking-tight flex items-center gap-2">
                <Zap size={16} className="text-amber-500 animate-pulse" />
                Sales Leaderboard
              </h3>
              <p className="text-zinc-500 text-[11px] mt-0.5">Top performing representatives by potential sales volume from leads.</p>
            </div>

            <div className="space-y-3.5 pt-2">
              {leaderboardSorted.length === 0 ? (
                <p className="text-xs text-zinc-400 text-center py-6">No representatives registered yet.</p>
              ) : (
                leaderboardSorted.map((leader, i) => {
                  const maxVal = Math.max(...leaderboardSorted.map(l => l.value)) || 1;
                  const barPct = (leader.value / maxVal) * 100;
                  return (
                    <div key={leader.name} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2 font-bold">
                          <span className="text-[10px] w-4 h-4 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-600 border border-zinc-200">{i + 1}</span>
                          <span className="text-zinc-800">{leader.name}</span>
                        </div>
                        <span className="font-mono text-zinc-600 text-[11px]">{formatCurrency(leader.value)}</span>
                      </div>
                      <div className="w-full h-1.5 bg-zinc-50 border border-zinc-100 rounded-full overflow-hidden">
                        <div className="h-full bg-amber-500 rounded-full" style={{ width: `${barPct}%` }} />
                      </div>
                      <div className="flex justify-between text-[9px] text-zinc-400 font-bold uppercase tracking-wider pl-6">
                        <span>{leader.count} Active Leads</span>
                        <span className="text-emerald-600">Won {formatCurrency(leader.won)}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
