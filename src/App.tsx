import React, { useState, useEffect, useRef } from "react";
import { LayoutDashboard, Users, ClipboardList as TooltipIcon, MessageSquare, Plus, Search, Send, MapPin, Package, Clock, Phone, Mail, ChevronRight, Activity, Zap, Shield, Database, FileUp, Sparkles, CheckCircle2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "./lib/utils";
import axios from "axios";

// --- Types ---
interface Customer {
  id: number;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  region: string;
  implementationType: string;
  vehicleCount: number;
}

interface Registration {
  id: number;
  customerName: string;
  contactName: string;
  phone: string;
  email: string;
  region: string;
  implementationType: string;
  status: string;
  salesPerson: string;
  salesType: string;
  createdAt: string;
}

interface ServiceTicket {
  id: number;
  ticketId: string;
  customerName: string;
  description: string;
  status: string;
  assignee: string;
  payment: string;
  amount: string;
  createdAt: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

// --- Components ---

const StatCard = ({ label, value, icon: Icon, color, subValue }: { label: string, value: string | number, icon: any, color: string, subValue?: string }) => (
  <div className="bg-zinc-900/50 border border-zinc-800 p-5 rounded-2xl flex flex-col gap-4 relative overflow-hidden group">
    <div className={cn("absolute -right-4 -top-4 w-24 h-24 rounded-full opacity-10 transition-transform group-hover:scale-110", color)} />
    <div className="flex items-center justify-between">
      <div className="p-2 rounded-xl bg-zinc-800/50">
        <Icon size={20} className={cn("text-zinc-400")} />
      </div>
      {subValue && <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">{subValue}</span>}
    </div>
    <div>
      <div className="text-3xl font-mono font-medium text-white">{value}</div>
      <div className="text-xs text-zinc-500 uppercase tracking-widest mt-1">{label}</div>
    </div>
  </div>
);

const IngestModule = ({ onSync }: { onSync: () => void }) => {
  const [log, setLog] = useState("");
  const [parsing, setParsing] = useState(false);
  const [extracted, setExtracted] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);

  const handleParse = async () => {
    if (!log.trim()) return;
    setParsing(true);
    try {
      const res = await axios.post("/api/ingest", { rawLog: log });
      setExtracted(res.data.extracted);
    } catch (e: any) {
      console.error(e);
      const errorMsg = e.response?.data?.details || e.message;
      alert(`Parsing failed: ${errorMsg}\n\nTroubleshooting tips:\n1. Ensure Ollama is running (ollama serve)\n2. Ensure model is pulled (ollama pull llama3)\n3. Check OLLAMA_URL in .env`);
    } finally {
      setParsing(false);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      await axios.post("/api/ingest/save", { records: extracted });
      setExtracted([]);
      setLog("");
      onSync();
      alert("Successfully imported records to SynoHub DB.");
    } catch (e) {
      alert("Import failed.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="bg-zinc-900/30 border border-zinc-800 rounded-3xl p-8">
        <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
          <FileUp size={20} className="text-emerald-500" /> WhatsApp Log Ingest
        </h3>
        <p className="text-xs text-zinc-500 mb-6">Paste your WhatsApp chat logs here. Our local AI will analyze and structure the data.</p>
        
        <textarea 
          placeholder="04/05/2026, 1:52 pm - +971 50 000 0000: Service Type : LOCATOR..." 
          value={log}
          onChange={(e) => setLog(e.target.value)}
          className="w-full h-48 bg-zinc-950 border border-zinc-800 rounded-2xl p-4 text-xs font-mono text-zinc-300 focus:outline-none focus:border-emerald-500/50 transition-all resize-none mb-4"
        />

        <button 
          onClick={handleParse}
          disabled={parsing || !log.trim()}
          className="bg-emerald-600 hover:bg-emerald-500 text-black font-bold py-3 px-6 rounded-xl text-sm transition-all flex items-center gap-2 disabled:opacity-50"
        >
          {parsing ? <Activity size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {parsing ? "Analyzing Log..." : "Parse with local AI"}
        </button>
      </div>

      <AnimatePresence>
        {extracted.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-white">Extracted {extracted.length} Records</h4>
              <button 
                onClick={handleImport}
                disabled={importing}
                className="bg-white hover:bg-zinc-200 text-black font-bold py-2 px-4 rounded-lg text-xs transition-colors flex items-center gap-2"
              >
                {importing ? <Activity size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Confirm & Import to DB
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {extracted.map((item, i) => (
                <div key={i} className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-2xl relative">
                  <div className={cn(
                    "absolute top-4 right-4 text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full",
                    item.type === 'registration' ? "bg-amber-500/10 text-amber-500" : "bg-blue-500/10 text-blue-500"
                  )}>
                    {item.type}
                  </div>
                  <h5 className="text-white font-bold text-sm mb-1">{item.customerName}</h5>
                  <p className="text-[11px] text-zinc-500 line-clamp-2">
                    {item.type === 'registration' 
                      ? `${item.implementationType} • ${item.region}`
                      : item.description}
                  </p>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const ChatInterface = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchHistory();
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const fetchHistory = async () => {
    try {
      const res = await axios.get("/api/chat/history");
      setMessages(res.data);
    } catch (e) {
      console.error("Failed to fetch chat history", e);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input;
    setInput("");
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      const history = messages.slice(-5).map(m => ({ role: m.role, content: m.content }));
      const res = await axios.post("/api/chat", { message: userMsg, history });
      setMessages(prev => [...prev, { role: 'assistant', content: res.data.reply }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: "Sorry, I can't reach the Ollama server right now. Please check if it's running." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[600px] border border-zinc-800 rounded-3xl overflow-hidden bg-zinc-950 shadow-2xl">
      <div className="p-4 border-bottom border-zinc-800 bg-zinc-900/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <Zap size={16} className="text-emerald-500" />
          </div>
          <div>
            <div className="text-sm font-medium text-white">SynoAssistant</div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-widest flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Local LLM Powered
            </div>
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-hide">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-zinc-500 text-center p-8 space-y-4">
             <MessageSquare size={48} className="opacity-20" />
             <div className="text-sm">Ask me about your fleet, service tickets, or registrations. I am powered by Ollama llama3.</div>
          </div>
        )}
        {messages.map((m, i) => (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            key={i}
            className={cn(
              "flex flex-col max-w-[85%] gap-1",
              m.role === 'user' ? "ml-auto items-end" : "mr-auto items-start"
            )}
          >
            <div className={cn(
              "p-4 rounded-2xl text-sm leading-relaxed",
              m.role === 'user' 
                ? "bg-emerald-600 text-white rounded-br-none" 
                : "bg-zinc-800 text-zinc-200 rounded-bl-none border border-zinc-700"
            )}>
              {m.content}
            </div>
            <span className="text-[9px] text-zinc-600 uppercase tracking-tight px-1 font-mono">
              {m.role === 'user' ? "You" : "SynoAssistant"}
            </span>
          </motion.div>
        ))}
        {loading && (
          <div className="flex gap-2 p-4 bg-zinc-800/30 w-fit rounded-2xl animate-pulse">
            <div className="w-1.5 h-1.5 rounded-full bg-zinc-600 animate-bounce [animation-delay:-0.3s]" />
            <div className="w-1.5 h-1.5 rounded-full bg-zinc-600 animate-bounce [animation-delay:-0.15s]" />
            <div className="w-1.5 h-1.5 rounded-full bg-zinc-600 animate-bounce" />
          </div>
        )}
      </div>

      <div className="p-4 bg-zinc-900/50 border-t border-zinc-800">
        <div className="relative">
          <input 
            type="text" 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Type your query..." 
            className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl py-3 pl-4 pr-12 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50 transition-all"
          />
          <button 
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-zinc-500 hover:text-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [activeTab, setActiveTab] = useState("overview");
  const [data, setData] = useState<{ registrations: Registration[], services: ServiceTicket[], customers: Customer[] }>({ 
    registrations: [], services: [], customers: [] 
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000); // refresh every 10s
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const res = await axios.get("/api/data");
      setData(res.data);
    } catch (e) {
      console.error("Data fetch failed", e);
    } finally {
      setLoading(false);
    }
  };

  const navItems = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "registrations", label: "Registrations", icon: Package },
    { id: "services", label: "Services", icon: TooltipIcon },
    { id: "customers", label: "Customers", icon: Users },
    { id: "ingest", label: "Log Ingest", icon: FileUp },
    { id: "ai", label: "SynoAI Chat", icon: Zap },
  ];

  return (
    <div className="flex h-screen bg-[#050505] text-zinc-300 font-sans selection:bg-emerald-500/30">
      {/* Sidebar */}
      <aside className="w-64 border-r border-zinc-800 bg-[#080808] flex flex-col pt-8">
        <div className="px-8 mb-10 group cursor-pointer">
          <div className="flex items-center gap-3">
             <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center group-hover:rotate-6 transition-transform">
               <Shield className="text-black" strokeWidth={2.5} size={22} />
             </div>
             <div>
               <h1 className="text-white font-bold tracking-tight text-xl">SynoHub</h1>
               <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-mono">Fleet CRM Pro</p>
             </div>
          </div>
        </div>

        <nav className="flex-1 px-4 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all group",
                activeTab === item.id 
                  ? "bg-emerald-600/10 text-emerald-500" 
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
              )}
            >
              <item.icon size={18} className={cn(activeTab === item.id ? "text-emerald-500" : "text-zinc-500 group-hover:text-zinc-300")} />
              {item.label}
              {activeTab === item.id && (
                <motion.div layoutId="active-nav" className="ml-auto w-1 h-4 bg-emerald-500 rounded-full" />
              )}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-zinc-800">
           <div className="bg-zinc-900/50 rounded-2xl p-4 border border-zinc-800/50">
              <div className="flex items-center gap-2 mb-2">
                 <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                 <span className="text-[10px] text-zinc-400 uppercase tracking-widest font-mono">System Live</span>
              </div>
              <p className="text-[11px] text-zinc-500 leading-tight">Database connected. LLM node active.</p>
           </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-[#050505] relative">
        <header className="sticky top-0 z-20 bg-[#050505]/80 backdrop-blur-md border-b border-zinc-800/50 px-8 py-6 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white capitalize">{activeTab}</h2>
              <p className="text-xs text-zinc-500">Manage your fleet ecosystem in real-time.</p>
            </div>
            <div className="flex items-center gap-4">
               <div className="relative">
                 <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
                 <input 
                   type="text" 
                   placeholder="Quick search..." 
                   className="bg-zinc-900 border border-zinc-800 rounded-full py-2 pl-9 pr-4 text-xs focus:outline-none focus:border-emerald-500/50 transition-all w-64"
                 />
               </div>
               <button className="bg-emerald-600 hover:bg-emerald-500 text-black font-bold p-2 rounded-lg transition-colors">
                 <Plus size={20} />
               </button>
            </div>
        </header>

        <div className="p-8 pb-32">
          <AnimatePresence mode="wait">
            {activeTab === "overview" && (
              <motion.div 
                key="overview"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <StatCard label="Total Registrations" value={data.registrations.length} icon={Package} color="bg-emerald-500" subValue="+12% MT" />
                  <StatCard label="Service Requests" value={data.services.length} icon={TooltipIcon} color="bg-blue-500" subValue="4 Pending" />
                  <StatCard label="Fleet Customers" value={data.customers.length} icon={Users} color="bg-amber-500" />
                  <StatCard label="System Messages" value="1.2k" icon={Activity} color="bg-purple-500" subValue="Cloud Sync" />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                   <div className="lg:col-span-2 space-y-6">
                      <div className="flex items-center justify-between">
                         <h3 className="font-bold text-white flex items-center gap-2">
                           <Clock size={16} className="text-emerald-500" />
                           Recent Activity
                         </h3>
                         <button className="text-[10px] text-zinc-500 uppercase tracking-widest hover:text-emerald-500 transition-colors">View All Logs</button>
                      </div>
                      
                      <div className="space-y-3">
                        {data.registrations.length === 0 ? (
                          <div className="bg-zinc-900/30 border border-zinc-800/50 rounded-2xl p-8 text-center text-zinc-600 text-sm italic">
                            No recent activity found. Syncing with backend...
                          </div>
                        ) : (
                          data.registrations.slice(0, 5).map((reg) => (
                            <div key={reg.id} className="flex items-center gap-4 p-4 bg-zinc-900/30 border border-zinc-800/50 rounded-2xl hover:bg-zinc-800/50 transition-colors group">
                               <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 group-hover:bg-emerald-500 group-hover:text-black transition-all">
                                 <Plus size={18} />
                               </div>
                               <div className="flex-1">
                                  <h4 className="text-sm font-bold text-white group-hover:text-emerald-400 transition-colors">{reg.customerName}</h4>
                                  <p className="text-xs text-zinc-500 flex items-center gap-2 mt-1">
                                    <MapPin size={10} /> {reg.region} • <Package size={10} /> {reg.status}
                                  </p>
                               </div>
                               <div className="text-right">
                                  <span className="text-[10px] font-mono text-zinc-600">New Registration</span>
                                  <p className="text-[10px] text-zinc-500 uppercase tracking-widest mt-1">2m ago</p>
                               </div>
                            </div>
                          ))
                        )}
                      </div>
                   </div>

                   <div className="bg-zinc-900/20 border border-zinc-800 rounded-3xl p-6 flex flex-col gap-6">
                      <div className="flex items-center gap-3">
                         <div className="p-2 rounded-xl bg-emerald-600/20 text-emerald-500">
                           <Database size={20} />
                         </div>
                         <div>
                            <h3 className="font-bold text-white">DB Status</h3>
                            <p className="text-xs text-zinc-500 italic">MySQL Enterprise v8.0</p>
                         </div>
                      </div>
                      
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                           <span className="text-xs text-zinc-400">Total Rows</span>
                           <span className="text-xs font-mono text-white">4,281</span>
                        </div>
                        <div className="flex items-center justify-between">
                           <span className="text-xs text-zinc-400">Read Throughput</span>
                           <span className="text-xs font-mono text-white">12.4 MB/s</span>
                        </div>
                        <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
                           <motion.div initial={{ width: 0 }} animate={{ width: "65%" }} className="h-full bg-emerald-500" />
                        </div>
                        <p className="text-[10px] text-zinc-500 italic">Storage utilization at 65% capacity.</p>
                      </div>

                      <div className="mt-auto pt-6 border-zinc-800">
                         <button className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-xs font-bold transition-colors">Generate Backup</button>
                      </div>
                   </div>
                </div>
              </motion.div>
            )}

            {activeTab === "ai" && (
              <motion.div 
                key="ai"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="max-w-4xl mx-auto"
              >
                <div className="mb-8">
                  <h3 className="text-2xl font-bold text-white">Intelligent Fleet Assistant</h3>
                  <p className="text-sm text-zinc-500 mt-2">Powered by local Ollama instance. No data leaves your network.</p>
                </div>
                <ChatInterface />
              </motion.div>
            )}

            {activeTab === "ingest" && (
              <motion.div 
                key="ingest"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-5xl mx-auto"
              >
                <IngestModule onSync={fetchData} />
              </motion.div>
            )}

            {activeTab === "registrations" && (
              <motion.div 
                key="registrations"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-zinc-900/30 border border-zinc-800 rounded-3xl overflow-hidden shadow-xl"
              >
                <table className="w-full text-sm text-left border-collapse">
                   <thead>
                     <tr className="border-b border-zinc-800 bg-zinc-800/20">
                       <th className="px-6 py-4 text-zinc-400 font-bold uppercase text-[10px] tracking-widest">Customer</th>
                       <th className="px-6 py-4 text-zinc-400 font-bold uppercase text-[10px] tracking-widest">Region</th>
                       <th className="px-6 py-4 text-zinc-400 font-bold uppercase text-[10px] tracking-widest">Status</th>
                       <th className="px-6 py-4 text-zinc-400 font-bold uppercase text-[10px] tracking-widest">Qty</th>
                       <th className="px-6 py-4 text-zinc-400 font-bold uppercase text-[10px] tracking-widest">Actions</th>
                     </tr>
                   </thead>
                   <tbody>
                     {data.registrations.map(reg => (
                        <tr key={reg.id} className="border-b border-zinc-800 hover:bg-zinc-800/30 transition-colors group">
                          <td className="px-6 py-4">
                             <div className="font-bold text-white group-hover:text-emerald-400 transition-colors">{reg.customerName}</div>
                             <div className="text-[10px] text-zinc-500 uppercase tracking-tight mt-1 font-mono">{reg.contactName || "Contact N/A"}</div>
                          </td>
                          <td className="px-6 py-4">
                             <div className="flex items-center gap-2 text-zinc-300">
                               <MapPin size={12} className="text-zinc-600" /> {reg.region || "Unknown"}
                             </div>
                          </td>
                          <td className="px-6 py-4">
                             <span className={cn(
                               "px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider",
                               reg.status === "New Lead" ? "bg-blue-500/10 text-blue-500" : "bg-emerald-500/10 text-emerald-500"
                             )}>
                               {reg.status}
                             </span>
                          </td>
                          <td className="px-6 py-4 font-mono text-zinc-400">{reg.newQty} Units</td>
                          <td className="px-6 py-4">
                             <button className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors">
                                <ChevronRight size={16} />
                             </button>
                          </td>
                        </tr>
                     ))}
                     {data.registrations.length === 0 && (
                        <tr>
                           <td colSpan={5} className="p-12 text-center text-zinc-600 italic">No registrations currently available in DB.</td>
                        </tr>
                     )}
                   </tbody>
                </table>
              </motion.div>
            )}

            {activeTab === "services" && (
              <motion.div 
                key="services"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="grid grid-cols-1 md:grid-cols-2 gap-6"
              >
                {data.services.map(svc => (
                  <div key={svc.id} className="bg-zinc-900/30 border border-zinc-800 p-6 rounded-3xl hover:border-emerald-500/30 shadow-lg group">
                    <div className="flex justify-between items-start mb-4">
                       <span className="text-[10px] font-mono text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded-full">{svc.ticketId}</span>
                       <span className="text-[10px] text-zinc-600 uppercase tracking-widest">{new Date(svc.createdAt).toLocaleDateString()}</span>
                    </div>
                    <h4 className="text-lg font-bold text-white group-hover:text-emerald-400 transition-colors mb-2">{svc.customerName}</h4>
                    <p className="text-xs text-zinc-500 leading-relaxed min-h-[40px] mb-6">{svc.description}</p>
                    <div className="flex items-center justify-between pt-4 border-t border-zinc-800">
                       <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] text-zinc-400">
                             {svc.assignee?.[0] || '?'}
                          </div>
                          <span className="text-[10px] text-zinc-400 font-mono tracking-tight">{svc.assignee || 'Unassigned'}</span>
                       </div>
                       <div className="text-right">
                          <div className="text-xs font-bold text-white">{svc.amount ? `AED ${svc.amount}` : "Quote Needed"}</div>
                          <div className="text-[9px] text-emerald-500 uppercase tracking-widest mt-1">{svc.status}</div>
                       </div>
                    </div>
                  </div>
                ))}
                {data.services.length === 0 && (
                  <div className="col-span-full p-12 bg-zinc-900/20 border border-zinc-800 rounded-3xl text-center text-zinc-600 italic">
                    All clear. No active service tickets.
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === "customers" && (
              <motion.div 
                key="customers"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
              >
                {data.customers.map(cust => (
                  <div key={cust.id} className="bg-zinc-900/40 border border-zinc-800 p-6 rounded-3xl relative overflow-hidden group hover:scale-[1.02] transition-all">
                    <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                       <Shield size={64} />
                    </div>
                    <h4 className="text-xl font-bold text-white mb-1">{cust.name}</h4>
                    <p className="text-xs text-zinc-500 mb-6 flex items-center gap-1 font-mono tracking-tight">
                       <Shield size={10} className="text-emerald-500" /> {cust.implementationType}
                    </p>
                    
                    <div className="space-y-3">
                       <div className="flex items-center gap-2 text-xs">
                          <Phone size={12} className="text-zinc-600" />
                          <span className="text-zinc-400 font-mono">{cust.phone}</span>
                       </div>
                       <div className="flex items-center gap-2 text-xs">
                          <Mail size={12} className="text-zinc-600" />
                          <span className="text-zinc-400 font-mono truncate">{cust.email}</span>
                       </div>
                       <div className="flex items-center gap-2 text-xs">
                          <MapPin size={12} className="text-zinc-600" />
                          <span className="text-zinc-400">{cust.region}</span>
                       </div>
                    </div>

                    <div className="mt-8 flex items-center justify-between p-3 bg-zinc-950/50 rounded-2xl border border-zinc-800/50">
                       <div className="text-center flex-1">
                          <div className="text-sm font-bold text-white font-mono">{cust.vehicleCount}</div>
                          <div className="text-[9px] text-zinc-600 uppercase tracking-widest mt-1">Vehicles</div>
                       </div>
                       <div className="w-[1px] h-4 bg-zinc-800" />
                       <div className="text-center flex-1">
                          <div className="text-sm font-bold text-white font-mono">Won</div>
                          <div className="text-[9px] text-zinc-600 uppercase tracking-widest mt-1">Status</div>
                       </div>
                    </div>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

