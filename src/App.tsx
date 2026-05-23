import React, { useState, useEffect, useRef } from "react";
import { LayoutDashboard, Users, ClipboardList as TooltipIcon, MessageSquare, Plus, Search, Send, MapPin, Package, Clock, Phone, Mail, ChevronRight, Activity, Zap, Shield, Database, FileUp, Sparkles, CheckCircle2, Minus, Square, X, ClipboardList } from "lucide-react";
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
  designation?: string;
  phone: string;
  email: string;
  region: string;
  address?: string;
  mapLink?: string;
  coordinates?: string;
  source?: string;
  status: string;
  implementationType: string;
  salesPerson: string;
  salesType: string;
  requestedPerson?: string;
  comment?: string;
  projectValue?: string;
  priceDetails?: string;
  accessories?: string;
  newQty: number;
  migrateQty: number;
  tradingQty: number;
  serviceQty: number;
  otherQty: number;
  createdAt: string;
}

interface ServiceTicket {
  id: number;
  ticketId: string;
  customerName: string;
  description: string;
  status: string;
  quantity?: number;
  requestedPerson?: string;
  payment?: string;
  invoiceStatus?: string;
  paymentStatus?: string;
  amount: string;
  assignee: string;
  createdAt: string;
}

const SOURCES = ["Door to Door", "Referral", "Company Lead", "Cold Calling", "Dealer", "Other", "MECAF2019"];
const REGIONS = ["Sharjah", "Dubai", "Abu Dhabi", "Ajman", "Fujairah", "Ras Al Khaimah", "Umm Al Quwain"];
const LEAD_STATUSES = ["New Lead", "Proposed", "Won", "Hold", "Lost", "Completed", "Duplicate", "Demo", "Check for Migration", "Pseudo Leads", "Deleted"];
const IMPLEMENTATION_TYPES = ["LOCATOR", "ASATEEL", "LOCATOR+ASATEEL", "SECUREPATH", "LOCATOR+SECUREPATH", "RASID", "SERVICE", "SHAHIN", "SECUREPATH PREMIUM", "LOCATOR+SECUREPATH PREMIUM", "LOCATOR+RASID", "OTHER"];
const SALES_PEOPLE = ["Ajmal", "Deepak", "Nishad", "Shams", "Umar", "Vishal"];
const SALES_TYPES = ["New", "Migration", "Trading", "New and Migrate", "New and Trading", "Migrate and Trading", "New and Migrate and Trading", "Existing"];
const REQUESTED_PEOPLE = ["Ajmal", "Amrutha", "Athul", "Celine", "Deepak", "Faizal", "Ivy", "Midhun", "Mohamed Musthafa", "Naseeb", "Nisam", "Nishad", "Rasick", "Reyn", "Shamnad", "Shams", "Shyamjith", "Umar", "Vaishakh Tech"];
const TICKET_STATUSES = ["New", "Hold", "Ongoing", "Completed", "Followed up"];
const PAYMENT_OPTIONS = ["Applicable", "Not Applicable"];
const INVOICE_STATUSES = ["Not Invoiced", "Invoiced"];
const PAYMENT_STATUSES = ["Not Paid", "Paid"];

const Modal = ({ isOpen, onClose, title, children }: { isOpen: boolean, onClose: () => void, title: string, children: React.ReactNode }) => (
  <AnimatePresence>
    {isOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0 }} 
          animate={{ opacity: 1 }} 
          exit={{ opacity: 0 }} 
          onClick={onClose}
          className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm" 
        />
        <motion.div 
          initial={{ opacity: 0, scale: 0.95, y: 20 }} 
          animate={{ opacity: 1, scale: 1, y: 0 }} 
          exit={{ opacity: 0, scale: 0.95, y: 20 }} 
          className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden relative z-10 flex flex-col"
        >
          <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between bg-zinc-50">
            <h3 className="font-bold text-zinc-900 flex items-center gap-2">
               <Plus size={18} className="text-teal-accent" /> {title}
            </h3>
            <button onClick={onClose} className="p-2 hover:bg-zinc-200 rounded-lg transition-colors text-zinc-400">
               <Activity size={18} />
            </button>
          </div>
          <div className="p-8 overflow-y-auto">
            {children}
          </div>
        </motion.div>
      </div>
    )}
  </AnimatePresence>
);

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

// --- Components ---

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

const IngestModule = ({ onSync }: { onSync: () => void }) => {
  const [log, setLog] = useState("");
  const [parsing, setParsing] = useState(false);
  const [extracted, setExtracted] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);

  const handleParse = async () => {
    if (!log.trim()) return;
    setParsing(true);
    try {
      const res = await axios.post("/api/chat", { 
        message: `EXTRACT DATA FROM THIS LOG INTO JSON FORMAT: \n\n${log}`, 
        history: [{ role: 'user', content: 'Extract data from WhatsApp logs.' }]
      });
      // Logic for extraction here would usually involve a specific endpoint, 
      // but assuming we're using the AI for it.
      onSync();
    } catch (e: any) {
      console.error(e);
      alert("Extraction failed.");
    } finally {
      setParsing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-zinc-100 bg-zinc-50 flex items-center justify-between">
          <h3 className="text-sm font-bold text-zinc-800 flex items-center gap-2">
            <FileUp size={16} className="text-teal-accent" /> Log Ingest Processor
          </h3>
        </div>
        <div className="p-6">
          <p className="text-xs text-zinc-500 mb-4">Paste WhatsApp logs to auto-extract registrations and service tickets.</p>
          <textarea 
            placeholder="Paste raw log data..." 
            value={log}
            onChange={(e) => setLog(e.target.value)}
            className="w-full h-40 bg-zinc-50 border border-zinc-100 rounded-lg p-4 text-xs font-mono text-zinc-700 focus:outline-none focus:border-teal-accent/30 transition-all resize-none mb-4"
          />
          <button 
            onClick={handleParse}
            disabled={parsing || !log.trim()}
            className="bg-teal-accent hover:opacity-90 text-white font-bold py-2 px-6 rounded-lg text-xs transition-all flex items-center gap-2 disabled:opacity-50 ml-auto"
          >
            {parsing ? <Activity size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {parsing ? "Processing..." : "Process Log"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ChatInterface = ({ onRecordSaved }: { onRecordSaved?: (savedRecord?: any) => void }) => {
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
      if (onRecordSaved) {
        onRecordSaved(res.data.savedRecord);
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: "I'm experiencing high traffic. Please try again in 30s." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[600px] border border-zinc-200 rounded-xl overflow-hidden bg-white shadow-xl">
      <div className="p-4 border-b border-zinc-100 bg-zinc-50/80 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-teal-accent/10 flex items-center justify-center">
            <Zap size={16} className="text-teal-accent" />
          </div>
          <div>
            <div className="text-sm font-bold text-zinc-800">SynoHub AI</div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-widest flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-accent animate-pulse" /> Local Analytics Node
            </div>
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-hide bg-zinc-50/30">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-zinc-400 text-center p-8 space-y-4">
             <MessageSquare size={40} className="opacity-10" />
             <div className="text-xs max-w-[200px]">How can I help you manage your fleet records today?</div>
          </div>
        )}
        {messages.map((m, idx) => (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            key={`msg-${idx}`}
            className={cn(
              "flex flex-col max-w-[85%] gap-1",
              m.role === 'user' ? "ml-auto items-end" : "mr-auto items-start"
            )}
          >
            <div className={cn(
              "p-4 rounded-xl text-xs leading-relaxed shadow-sm",
              m.role === 'user' 
                ? "bg-zinc-800 text-white rounded-br-none" 
                : "bg-white text-zinc-700 rounded-bl-none border border-zinc-100"
            )}>
              {m.content}
            </div>
            <span className="text-[9px] text-zinc-400 uppercase tracking-tight px-1 font-bold">
              {m.role === 'user' ? "User" : "SynoAI"}
            </span>
          </motion.div>
        ))}
        {loading && (
          <div className="flex gap-1.5 p-3 bg-white border border-zinc-100 w-fit rounded-xl shadow-sm">
            <div className="w-1 h-1 rounded-full bg-zinc-300 animate-bounce [animation-delay:-0.3s]" />
            <div className="w-1 h-1 rounded-full bg-zinc-300 animate-bounce [animation-delay:-0.15s]" />
            <div className="w-1 h-1 rounded-full bg-zinc-300 animate-bounce" />
          </div>
        )}
      </div>

      <div className="p-4 bg-white border-t border-zinc-100">
        <div className="relative">
          <input 
            type="text" 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Type your message..." 
            className="w-full bg-zinc-50 border border-zinc-200 rounded-lg py-3 pl-4 pr-12 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-teal-accent/50 transition-all font-medium"
          />
          <button 
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-zinc-400 hover:text-teal-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [data, setData] = useState<{ registrations: Registration[], services: ServiceTicket[], customers: Customer[] }>({ 
    registrations: [], services: [], customers: [] 
  });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterRegion, setFilterRegion] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");
  const [isLeadModalOpen, setIsLeadModalOpen] = useState(false);
  const [isTicketModalOpen, setIsTicketModalOpen] = useState(false);
  const [showAllFeed, setShowAllFeed] = useState(false);

  const [leadForm, setLeadForm] = useState<Partial<Registration>>({
    status: 'New Lead',
    region: REGIONS[0],
    implementationType: IMPLEMENTATION_TYPES[0],
    salesPerson: SALES_PEOPLE[0],
    salesType: SALES_TYPES[0],
    source: SOURCES[0],
    newQty: 0,
    migrateQty: 0,
    tradingQty: 0,
    serviceQty: 0,
    otherQty: 0
  });

  const [ticketForm, setTicketForm] = useState<Partial<ServiceTicket>>({
    status: 'New',
    payment: PAYMENT_OPTIONS[0],
    invoiceStatus: INVOICE_STATUSES[0],
    paymentStatus: PAYMENT_STATUSES[0],
    quantity: 1
  });

  const handleLeadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await axios.post("/api/leads/new", leadForm);
      setIsLeadModalOpen(false);
      fetchData();
      setLeadForm({ status: 'New Lead', region: REGIONS[0], implementationType: IMPLEMENTATION_TYPES[0], salesPerson: SALES_PEOPLE[0], salesType: SALES_TYPES[0], source: SOURCES[0], newQty: 0, migrateQty: 0, tradingQty: 0, serviceQty: 0, otherQty: 0 });
    } catch (err) {
      alert("Failed to save lead");
    }
  };

  const handleTicketSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await axios.post("/api/services", ticketForm);
      setIsTicketModalOpen(false);
      fetchData();
      setTicketForm({ status: 'New', payment: PAYMENT_OPTIONS[0], invoiceStatus: INVOICE_STATUSES[0], paymentStatus: PAYMENT_STATUSES[0], quantity: 1 });
    } catch (err) {
      alert("Failed to create ticket");
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
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

  const filteredRegistrations = data.registrations.filter(reg => {
    const matchesSearch = reg.customerName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         reg.contactName?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRegion = filterRegion === "All" || reg.region === filterRegion;
    const matchesStatus = filterStatus === "All" || reg.status === filterStatus;
    return matchesSearch && matchesRegion && matchesStatus;
  });

  const filteredServices = data.services.filter(svc => {
    const matchesSearch = svc.customerName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         svc.ticketId.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === "All" || svc.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const filteredCustomers = data.customers.filter(cust => 
    cust.name.toLowerCase().includes(searchTerm.toLowerCase())
  );


  const navItems = [
    { id: "overview", label: "Dashboard", icon: LayoutDashboard },
    { id: "new-form", label: "New Lead Entry", icon: Plus },
    { id: "existing-form", label: "Existing Form", icon: ClipboardList },
    { id: "add-service", label: "Add Service", icon: TooltipIcon },
    { id: "ingest", label: "Log Processor", icon: FileUp },
    { id: "ai", label: "SynoAI Chat", icon: Sparkles },
  ];

  return (
    <div className="flex h-screen bg-background text-zinc-700 font-sans selection:bg-teal-accent/20">
      {/* Sidebar */}
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
              onClick={() => {
                setActiveTab(item.id);
                setFilterStatus("All");
                setFilterRegion("All");
              }}
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

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto relative flex flex-col">
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
                   onChange={(e) => setSearchTerm(e.target.value)}
                   className="bg-zinc-50 border border-zinc-200 rounded-lg py-2 pl-9 pr-4 text-[11px] font-medium focus:outline-none focus:border-teal-accent/30 transition-all w-72"
                 />
               </div>
               <div className="flex items-center gap-2 border-l border-zinc-200 pl-4 ml-2">
                  <div className="w-8 h-8 rounded-full bg-zinc-100 border border-zinc-200" />
               </div>
            </div>
        </header>

        <div className="p-10 flex-1">
          <AnimatePresence mode="wait">
            {/* Lead Creation Modal */}
            <Modal isOpen={isLeadModalOpen} onClose={() => setIsLeadModalOpen(false)} title="Register New Lead">
               <form onSubmit={handleLeadSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 <div className="space-y-4">
                    <div>
                        <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Customer Name *</label>
                        <input required type="text" value={leadForm.customerName || ""} onChange={e => setLeadForm({...leadForm, customerName: e.target.value})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs focus:outline-none focus:border-teal-accent/50" />
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Contact Name</label>
                        <input type="text" value={leadForm.contactName || ""} onChange={e => setLeadForm({...leadForm, contactName: e.target.value})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs focus:outline-none focus:border-teal-accent/50" />
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Designation</label>
                        <input type="text" value={leadForm.designation || ""} onChange={e => setLeadForm({...leadForm, designation: e.target.value})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs focus:outline-none focus:border-teal-accent/50" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Phone</label>
                            <input type="text" value={leadForm.phone || ""} onChange={e => setLeadForm({...leadForm, phone: e.target.value})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs focus:outline-none focus:border-teal-accent/50" />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Email</label>
                            <input type="email" value={leadForm.email || ""} onChange={e => setLeadForm({...leadForm, email: e.target.value})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs focus:outline-none focus:border-teal-accent/50" />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Region</label>
                            <select value={leadForm.region} onChange={e => setLeadForm({...leadForm, region: e.target.value})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs focus:outline-none focus:border-teal-accent/50">
                                {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Source</label>
                            <select value={leadForm.source} onChange={e => setLeadForm({...leadForm, source: e.target.value})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs focus:outline-none focus:border-teal-accent/50">
                                {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Address</label>
                        <textarea rows={2} value={leadForm.address || ""} onChange={e => setLeadForm({...leadForm, address: e.target.value})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs focus:outline-none focus:border-teal-accent/50 resize-none" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Coordinates</label>
                            <input type="text" placeholder="Lat, Long" value={leadForm.coordinates || ""} onChange={e => setLeadForm({...leadForm, coordinates: e.target.value})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs focus:outline-none focus:border-teal-accent/50" />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Map Link</label>
                            <input type="text" value={leadForm.mapLink || ""} onChange={e => setLeadForm({...leadForm, mapLink: e.target.value})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs focus:outline-none focus:border-teal-accent/50" />
                        </div>
                    </div>
                 </div>

                 <div className="space-y-4">
                     <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Status</label>
                            <select value={leadForm.status} onChange={e => setLeadForm({...leadForm, status: e.target.value})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs focus:outline-none focus:border-teal-accent/50">
                                {LEAD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Implementation Type</label>
                            <select value={leadForm.implementationType} onChange={e => setLeadForm({...leadForm, implementationType: e.target.value})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs focus:outline-none focus:border-teal-accent/50">
                                {IMPLEMENTATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Sales Person</label>
                            <select value={leadForm.salesPerson} onChange={e => setLeadForm({...leadForm, salesPerson: e.target.value})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs focus:outline-none focus:border-teal-accent/50">
                                {SALES_PEOPLE.map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Sales Type</label>
                            <select value={leadForm.salesType} onChange={e => setLeadForm({...leadForm, salesType: e.target.value})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs focus:outline-none focus:border-teal-accent/50">
                                {SALES_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </div>
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Requested Person</label>
                        <select value={leadForm.requestedPerson} onChange={e => setLeadForm({...leadForm, requestedPerson: e.target.value})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs focus:outline-none focus:border-teal-accent/50">
                            <option value="">Select requested person</option>
                            {REQUESTED_PEOPLE.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-center">
                        <div>
                            <label className="block text-[8px] font-bold text-zinc-400 uppercase mb-1">New</label>
                            <input type="number" min="0" value={leadForm.newQty || 0} onChange={e => setLeadForm({...leadForm, newQty: parseInt(e.target.value)})} className="w-full bg-zinc-50 border border-zinc-200 rounded p-1 text-xs text-center" />
                        </div>
                        <div>
                            <label className="block text-[8px] font-bold text-zinc-400 uppercase mb-1">Migrate</label>
                            <input type="number" min="0" value={leadForm.migrateQty || 0} onChange={e => setLeadForm({...leadForm, migrateQty: parseInt(e.target.value)})} className="w-full bg-zinc-50 border border-zinc-200 rounded p-1 text-xs text-center" />
                        </div>
                        <div>
                            <label className="block text-[8px] font-bold text-zinc-400 uppercase mb-1">Trading</label>
                            <input type="number" min="0" value={leadForm.tradingQty || 0} onChange={e => setLeadForm({...leadForm, tradingQty: parseInt(e.target.value)})} className="w-full bg-zinc-50 border border-zinc-200 rounded p-1 text-xs text-center" />
                        </div>
                        <div>
                            <label className="block text-[8px] font-bold text-zinc-400 uppercase mb-1">Other</label>
                            <input type="number" min="0" value={leadForm.otherQty || 0} onChange={e => setLeadForm({...leadForm, otherQty: parseInt(e.target.value)})} className="w-full bg-zinc-50 border border-zinc-200 rounded p-1 text-xs text-center" />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Project Value</label>
                            <input type="text" value={leadForm.projectValue || ""} onChange={e => setLeadForm({...leadForm, projectValue: e.target.value})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs focus:outline-none focus:border-teal-accent/50" />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Accessories</label>
                            <input type="text" value={leadForm.accessories || ""} onChange={e => setLeadForm({...leadForm, accessories: e.target.value})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs focus:outline-none focus:border-teal-accent/50" />
                        </div>
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Comment</label>
                        <textarea rows={2} value={leadForm.comment || ""} onChange={e => setLeadForm({...leadForm, comment: e.target.value})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs focus:outline-none focus:border-teal-accent/50 resize-none" />
                    </div>
                    <button type="submit" className="w-full bg-teal-accent text-white font-bold py-3 rounded-xl shadow-lg shadow-teal-accent/20 hover:opacity-90 transition-all text-xs uppercase tracking-widest mt-4">Save Record</button>
                 </div>
               </form>
            </Modal>

            {/* Ticket Creation Modal */}
            <Modal isOpen={isTicketModalOpen} onClose={() => setIsTicketModalOpen(false)} title="Create Service Ticket">
               <form onSubmit={handleTicketSubmit} className="space-y-6">
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                       <div>
                            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Customer Name *</label>
                            <input required type="text" value={ticketForm.customerName || ""} onChange={e => setTicketForm({...ticketForm, customerName: e.target.value})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs focus:outline-none focus:border-teal-accent/50" />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Ticket Status</label>
                            <select value={ticketForm.status} onChange={e => setTicketForm({...ticketForm, status: e.target.value})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs focus:outline-none focus:border-teal-accent/50">
                                {TICKET_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Quantity</label>
                            <input type="number" min="1" value={ticketForm.quantity || 1} onChange={e => setTicketForm({...ticketForm, quantity: parseInt(e.target.value)})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs focus:outline-none focus:border-teal-accent/50" />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Requested Person</label>
                            <select value={ticketForm.requestedPerson} onChange={e => setTicketForm({...ticketForm, requestedPerson: e.target.value})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs focus:outline-none focus:border-teal-accent/50">
                                <option value="">Select requested person</option>
                                {REQUESTED_PEOPLE.map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                        </div>
                    </div>
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                             <div>
                                <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Payment</label>
                                <select value={ticketForm.payment} onChange={e => setTicketForm({...ticketForm, payment: e.target.value})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs focus:outline-none focus:border-teal-accent/50">
                                    {PAYMENT_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                                </select>
                             </div>
                             <div>
                                <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Amount</label>
                                <input type="text" placeholder="AED 0.00" value={ticketForm.amount || ""} onChange={e => setTicketForm({...ticketForm, amount: e.target.value})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs focus:outline-none focus:border-teal-accent/50" />
                             </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                             <div>
                                <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Invoice Status</label>
                                <select value={ticketForm.invoiceStatus} onChange={e => setTicketForm({...ticketForm, invoiceStatus: e.target.value})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs focus:outline-none focus:border-teal-accent/50">
                                    {INVOICE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                             </div>
                             <div>
                                <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Payment Status</label>
                                <select value={ticketForm.paymentStatus} onChange={e => setTicketForm({...ticketForm, paymentStatus: e.target.value})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs focus:outline-none focus:border-teal-accent/50">
                                    {PAYMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                             </div>
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Assignee</label>
                            <input type="text" placeholder="Technical Team / Person" value={ticketForm.assignee || ""} onChange={e => setTicketForm({...ticketForm, assignee: e.target.value})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs focus:outline-none focus:border-teal-accent/50" />
                        </div>
                    </div>
                 </div>
                 <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Description / Issue *</label>
                    <textarea required rows={4} value={ticketForm.description || ""} onChange={e => setTicketForm({...ticketForm, description: e.target.value})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-3 text-xs focus:outline-none focus:border-teal-accent/50 resize-none" />
                 </div>
                 <button type="submit" className="w-full bg-zinc-900 text-white font-bold py-3 rounded-xl hover:opacity-90 transition-all text-xs uppercase tracking-widest">Generate Ticket</button>
               </form>
            </Modal>

            {activeTab === "new-form" && (
              <motion.div 
                key="new-form"
                initial={{ opacity: 0, scale: 0.99 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.99 }}
                className="bg-white rounded-lg shadow-2xl border border-zinc-200 overflow-hidden flex flex-col h-full"
              >
                {/* Window Header */}
                <div className="bg-zinc-50 border-b border-zinc-200 px-4 py-2 flex items-center justify-between">
                  <div className="text-[11px] font-medium text-zinc-600 flex items-center gap-2">
                    New Form - {new Date().toLocaleDateString('en-GB').replace(/\//g, '-')}
                  </div>
                  <div className="flex items-center gap-4 text-zinc-400">
                    <Minus size={14} className="hover:text-zinc-600 cursor-pointer" />
                    <Square size={10} className="hover:text-zinc-600 cursor-pointer" />
                    <X size={14} className="hover:text-red-500 cursor-pointer" onClick={() => setActiveTab("overview")} />
                  </div>
                </div>

                <div className="p-8 space-y-8 flex-1 overflow-y-auto bg-[#F8FAFC]">
                  {/* Top Search Bar Row */}
                  <div className="flex justify-end gap-2 items-center mb-4">
                    <div className="relative group">
                      <select 
                        onChange={(e) => {
                          const cust = data.customers.find(c => c.name === e.target.value);
                          if (cust) {
                            setLeadForm({
                              ...leadForm,
                              customerName: cust.name,
                              contactName: cust.contactName,
                              phone: cust.phone,
                              email: cust.email,
                              region: cust.region,
                              implementationType: cust.implementationType
                            });
                          }
                        }}
                        className="bg-white border border-[#E2E8F0] rounded py-1.5 px-3 text-[11px] w-64 focus:outline-none focus:ring-1 focus:ring-teal-accent/20"
                      >
                        <option value="">Search Existing Customer...</option>
                        {data.customers.map((c, idx) => <option key={`${c.id}-${idx}`} value={c.name}>{c.name}</option>)}
                      </select>
                    </div>
                    <button className="p-1.5 bg-teal-accent rounded text-white hover:opacity-90 transition-all">
                      <Search size={14} />
                    </button>
                    <button 
                      onClick={() => setLeadForm({ status: 'New Lead', region: REGIONS[0], implementationType: IMPLEMENTATION_TYPES[0], salesPerson: SALES_PEOPLE[0], salesType: SALES_TYPES[0], source: SOURCES[0], newQty: 0, migrateQty: 0, tradingQty: 0, serviceQty: 0, otherQty: 0 })}
                      className="p-1.5 bg-[#EF4444] rounded text-white hover:opacity-90 transition-all"
                    >
                      <Activity size={14} className="rotate-90" />
                    </button>
                  </div>

                  <form onSubmit={handleLeadSubmit} className="space-y-6">
                    {/* Main Grid */}
                    <div className="grid grid-cols-6 gap-x-6 gap-y-4">
                      {/* Column 1 */}
                      <div className="space-y-4">
                        <div className="space-y-1">
                          <label className="text-[10px] text-zinc-500 flex items-center gap-0.5">Source: <span className="text-red-500">*</span></label>
                          <select 
                            required
                            value={leadForm.source} 
                            onChange={e => setLeadForm({...leadForm, source: e.target.value})}
                            className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none"
                          >
                            <option value="">Select Source</option>
                            {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                      </div>

                      {/* Column 2 */}
                      <div className="space-y-4">
                        <div className="space-y-1">
                          <label className="text-[10px] text-zinc-500">Region:</label>
                          <select 
                            value={leadForm.region} 
                            onChange={e => setLeadForm({...leadForm, region: e.target.value})}
                            className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none"
                          >
                            <option value="">Select Region</option>
                            {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                        </div>
                      </div>

                      {/* Column 3 */}
                      <div className="space-y-4">
                        <div className="space-y-1">
                          <label className="text-[10px] text-zinc-500 flex items-center gap-0.5">Status: <span className="text-red-500">*</span></label>
                          <select 
                            required
                            value={leadForm.status} 
                            onChange={e => setLeadForm({...leadForm, status: e.target.value})}
                            className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none"
                          >
                            {LEAD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                      </div>

                      {/* Column 4 */}
                      <div className="space-y-4">
                        <div className="space-y-1">
                          <label className="text-[10px] text-zinc-500 flex items-center gap-0.5">Implementation Type: <span className="text-red-500">*</span></label>
                          <select 
                            required
                            value={leadForm.implementationType} 
                            onChange={e => setLeadForm({...leadForm, implementationType: e.target.value})}
                            className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none"
                          >
                            <option value="">Select Implementation Type</option>
                            {IMPLEMENTATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                      </div>

                      {/* Column 5 */}
                      <div className="space-y-4">
                        <div className="space-y-1">
                          <label className="text-[10px] text-zinc-500">Price:</label>
                          <input 
                             type="text"
                             placeholder="Price Details"
                             value={leadForm.priceDetails || ""}
                             onChange={e => setLeadForm({...leadForm, priceDetails: e.target.value})}
                             className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none"
                          />
                        </div>
                      </div>

                      {/* Column 6 */}
                      <div className="space-y-4">
                        <div className="space-y-1">
                          <label className="text-[10px] text-zinc-500">Project Value:</label>
                          <input 
                            type="text"
                            placeholder="Project Value"
                            value={leadForm.projectValue || ""} 
                            onChange={e => setLeadForm({...leadForm, projectValue: e.target.value})}
                            className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Customer Info Row */}
                    <div className="grid grid-cols-6 gap-x-6 gap-y-4">
                       <div className="col-span-2 space-y-1">
                          <label className="text-[10px] text-zinc-500 flex items-center gap-0.5">Customer Name: <span className="text-red-500">*</span></label>
                          <input required type="text" placeholder="Customer Name" value={leadForm.customerName || ""} onChange={e => setLeadForm({...leadForm, customerName: e.target.value})} className="w-full bg-white border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none" />
                       </div>
                       <div className="space-y-1">
                          <label className="text-[10px] text-zinc-500 flex items-center gap-0.5">Contact Name: <span className="text-red-500">*</span></label>
                          <input required type="text" placeholder="Contact Name" value={leadForm.contactName || ""} onChange={e => setLeadForm({...leadForm, contactName: e.target.value})} className="w-full bg-white border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none" />
                       </div>
                       <div className="space-y-1">
                          <label className="text-[10px] text-zinc-500 flex items-center gap-0.5">Phone: <span className="text-red-500">*</span></label>
                          <input required type="text" placeholder="Phone" value={leadForm.phone || ""} onChange={e => setLeadForm({...leadForm, phone: e.target.value})} className="w-full bg-white border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none" />
                       </div>
                       <div className="space-y-1">
                         <label className="text-[10px] text-zinc-500">Email:</label>
                         <input type="email" placeholder="Email" value={leadForm.email || ""} onChange={e => setLeadForm({...leadForm, email: e.target.value})} className="w-full bg-white border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none" />
                       </div>
                       <div className="space-y-1">
                          <label className="text-[10px] text-zinc-500">Designation:</label>
                          <input type="text" placeholder="Designation" value={leadForm.designation || ""} onChange={e => setLeadForm({...leadForm, designation: e.target.value})} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none" />
                       </div>
                    </div>

                    {/* Location/Sales Row */}
                    <div className="grid grid-cols-6 gap-x-6 gap-y-4">
                       <div className="col-span-2 space-y-1">
                          <label className="text-[10px] text-zinc-500">Address:</label>
                          <input type="text" placeholder="Address" value={leadForm.address || ""} onChange={e => setLeadForm({...leadForm, address: e.target.value})} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none" />
                       </div>
                       <div className="col-span-2 space-y-1">
                          <label className="text-[10px] text-zinc-500">Map Link:</label>
                          <input type="text" placeholder="Map Link" value={leadForm.mapLink || ""} onChange={e => setLeadForm({...leadForm, mapLink: e.target.value})} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none" />
                       </div>
                       <div className="space-y-1">
                          <label className="text-[10px] text-zinc-500">Coordinates:</label>
                          <input type="text" placeholder="Coordinates" value={leadForm.coordinates || ""} onChange={e => setLeadForm({...leadForm, coordinates: e.target.value})} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none" />
                       </div>
                       <div className="space-y-1">
                          <label className="text-[10px] text-zinc-500 flex items-center gap-0.5">Sales Person: <span className="text-red-500">*</span></label>
                          <select required value={leadForm.salesPerson} onChange={e => setLeadForm({...leadForm, salesPerson: e.target.value})} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none">
                            {SALES_PEOPLE.map(p => <option key={p} value={p}>{p}</option>)}
                          </select>
                       </div>
                    </div>

                    <div className="grid grid-cols-6 gap-4">
                       <div className="col-start-6 space-y-1">
                          <label className="text-[10px] text-zinc-500 flex items-center gap-0.5">Sales Type: <span className="text-red-500">*</span></label>
                          <select required value={leadForm.salesType} onChange={e => setLeadForm({...leadForm, salesType: e.target.value})} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none">
                            {SALES_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                    </div>

                    {/* Quantities Row */}
                    <div className="grid grid-cols-8 gap-3 items-end">
                      <div className="space-y-1">
                        <label className="text-[10px] text-zinc-500">New Qty:</label>
                        <input type="number" value={leadForm.newQty} onChange={e => setLeadForm({...leadForm, newQty: parseInt(e.target.value)})} className="w-full bg-white border border-[#E2E8F0] rounded px-2 py-1.5 text-[11px] text-zinc-600 focus:outline-none text-center h-8" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-zinc-500">Migrate Qty:</label>
                        <input type="number" value={leadForm.migrateQty} onChange={e => setLeadForm({...leadForm, migrateQty: parseInt(e.target.value)})} className="w-full bg-white border border-[#E2E8F0] rounded px-2 py-1.5 text-[11px] text-zinc-600 focus:outline-none text-center h-8" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-zinc-500">Trading Qty:</label>
                        <input type="number" value={leadForm.tradingQty} onChange={e => setLeadForm({...leadForm, tradingQty: parseInt(e.target.value)})} className="w-full bg-white border border-[#E2E8F0] rounded px-2 py-1.5 text-[11px] text-zinc-600 focus:outline-none text-center h-8" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-zinc-500">Service Qty:</label>
                        <input type="number" value={leadForm.serviceQty} onChange={e => setLeadForm({...leadForm, serviceQty: parseInt(e.target.value)})} className="w-full bg-white border border-[#E2E8F0] rounded px-2 py-1.5 text-[11px] text-zinc-600 focus:outline-none text-center h-8" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-zinc-500">Other Qty:</label>
                        <input type="number" value={leadForm.otherQty} onChange={e => setLeadForm({...leadForm, otherQty: parseInt(e.target.value)})} className="w-full bg-white border border-[#E2E8F0] rounded px-2 py-1.5 text-[11px] text-zinc-600 focus:outline-none text-center h-8" />
                      </div>
                      <div className="col-span-2 space-y-1">
                        <label className="text-[10px] text-zinc-500">Accessories If Any:</label>
                        <input type="text" placeholder="Accessories" value={leadForm.accessories || ""} onChange={e => setLeadForm({...leadForm, accessories: e.target.value})} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none h-8" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-zinc-500 flex items-center gap-0.5">Requested Person: <span className="text-red-500">*</span></label>
                        <select required value={leadForm.requestedPerson} onChange={e => setLeadForm({...leadForm, requestedPerson: e.target.value})} className="w-full bg-white border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none h-8">
                          <option value="">Select requested person</option>
                          {REQUESTED_PEOPLE.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                    </div>

                    {/* Comment Section */}
                    <div className="space-y-1">
                      <textarea 
                        rows={2} 
                        placeholder="Comment"
                        value={leadForm.comment || ""} 
                        onChange={e => setLeadForm({...leadForm, comment: e.target.value})}
                        className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-4 py-3 text-[11px] text-zinc-600 focus:outline-none"
                      />
                    </div>

                    {/* Additional Contact Details */}
                    <div className="space-y-4 pt-4 border-t border-zinc-100">
                      <h4 className="text-[11px] text-zinc-400 font-medium">Additional Contact Details</h4>
                      <button type="button" className="w-8 h-8 rounded bg-teal-accent flex items-center justify-center text-white shadow-lg shadow-teal-accent/20 hover:scale-105 transition-all">
                        <Plus size={18} />
                      </button>
                    </div>

                    <div className="flex justify-end pt-4">
                      <button 
                        type="submit" 
                        className="bg-teal-accent text-white px-10 py-2 rounded font-bold text-[10px] uppercase tracking-widest shadow-lg shadow-teal-accent/10 hover:opacity-95 transition-all"
                      >
                        SAVE
                      </button>
                    </div>
                  </form>
                </div>
              </motion.div>
            )}

            {activeTab === "overview" && (
              <motion.div 
                key="overview"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <StatCard label="Total Leads" value={data.registrations.length} icon={Package} color="bg-teal-accent" subValue="+14% MOM" />
                  <StatCard label="Service Queue" value={data.services.length} icon={Shield} color="bg-zinc-800" subValue="High Priority" />
                  <StatCard label="Active Clients" value={data.customers.length} icon={Users} color="bg-teal-accent" />
                  <StatCard label="Data Points" value="842" icon={Database} color="bg-zinc-800" subValue="Realtime" />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                   <div className="lg:col-span-2 space-y-6">
                      <div className="flex items-center justify-between border-b border-zinc-100 pb-4">
                         <h3 className="font-bold text-zinc-800 flex items-center gap-2">
                           <Clock size={16} className="text-teal-accent" />
                           Dynamic Feed {searchTerm && <span className="text-xs font-normal text-zinc-400 font-sans">(Filtered)</span>}
                         </h3>
                         <button 
                           onClick={() => {
                             const headers = "ID,Customer Name,Contact Name,Phone,Region,Status,Sales Person,Sales Type,Quantity,Comment\n";
                             const rows = data.registrations.map(r => 
                               `"${r.id || ''}","${(r.customerName || '').replace(/"/g, '""')}","${(r.contactName || '').replace(/"/g, '""')}","${(r.phone || '').replace(/"/g, '""')}","${(r.region || '').replace(/"/g, '""')}","${(r.status || '').replace(/"/g, '""')}","${(r.salesPerson || '').replace(/"/g, '""')}","${(r.salesType || '').replace(/"/g, '""')}","${(r.newQty || 0) + (r.migrateQty || 0) + (r.tradingQty || 0) + (r.serviceQty || 0) + (r.otherQty || 0)}","${(r.comment || '').replace(/"/g, '""')}"`
                             ).join("\n");
                             const blob = new Blob([headers + rows], { type: "text/csv;charset=utf-8;" });
                             const url = URL.createObjectURL(blob);
                             const link = document.createElement("a");
                             link.setAttribute("href", url);
                             link.setAttribute("download", `synohub-leads-${new Date().toISOString().split('T')[0]}.csv`);
                             link.click();
                           }}
                           className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest hover:text-teal-accent transition-colors"
                         >
                           Export .CSV
                         </button>
                      </div>
                      
                      <div className="grid gap-4">
                        {filteredRegistrations.length === 0 ? (
                          <div className="bg-white border border-zinc-100 rounded-xl p-12 text-center text-zinc-400 text-sm">
                            {searchTerm ? "No matching saved leads found." : "No recent activity logs found."}
                          </div>
                        ) : (
                          (() => {
                            const sorted = [...filteredRegistrations].reverse();
                            const visible = showAllFeed ? sorted : sorted.slice(0, 4);
                            return (
                              <>
                                {visible.map((reg, idx) => (
                                  <div key={`dash-reg-${reg.id || idx}-${idx}`} className="flex items-center gap-5 p-5 bg-white border border-zinc-100 rounded-xl hover:border-teal-accent/30 transition-all group shadow-sm">
                                     <div className="w-10 h-10 rounded-lg bg-zinc-50 border border-zinc-100 flex items-center justify-center text-zinc-400 group-hover:bg-teal-accent group-hover:text-white transition-all">
                                       <Plus size={18} />
                                     </div>
                                     <div className="flex-1">
                                        <h4 className="text-sm font-bold text-zinc-800 group-hover:text-teal-accent transition-colors">{reg.customerName}</h4>
                                        <div className="flex items-center gap-3 mt-1">
                                          <span className="text-[10px] text-zinc-500 font-medium bg-zinc-100 px-1.5 py-0.5 rounded uppercase tracking-tighter">{reg.region || "Abu Dhabi"}</span>
                                          <span className={`text-[10px] font-bold uppercase tracking-tighter ${
                                            reg.status === 'Won' ? 'text-green-600' : 
                                            reg.status === 'Lost' ? 'text-red-500' :
                                            'text-teal-accent'
                                          }`}>{reg.status}</span>
                                          <span className="text-[10px] text-zinc-400">• Qty: {(reg.newQty || 0) + (reg.migrateQty || 0) + (reg.tradingQty || 0) + (reg.serviceQty || 0) + (reg.otherQty || 0) || 1}</span>
                                        </div>
                                     </div>
                                     <div className="text-right">
                                        <div className="text-[10px] font-bold text-zinc-900">Lead Created</div>
                                        <p className="text-[9px] text-zinc-400 font-medium mt-1">
                                          {reg.createdAt ? new Date(reg.createdAt).toLocaleDateString('en-GB') : "Recently"}
                                        </p>
                                     </div>
                                  </div>
                                ))}
                                {filteredRegistrations.length > 4 && (
                                  <button 
                                    onClick={() => setShowAllFeed(!showAllFeed)}
                                    className="w-full py-3 border border-dashed border-zinc-200 rounded-xl text-xs font-bold text-zinc-500 hover:text-teal-accent hover:border-teal-accent/50 transition-all text-center"
                                  >
                                    {showAllFeed ? "Collapse List" : `Show All Saved Leads (${filteredRegistrations.length})`}
                                  </button>
                                )}
                              </>
                            );
                          })()
                        )}
                      </div>
                   </div>

                   <div className="space-y-6">
                      <div className="bg-zinc-800 rounded-2xl p-6 text-white overflow-hidden relative shadow-lg">
                        <div className="relative z-10">
                          <h3 className="font-bold text-base mb-1">System Capacity</h3>
                          <p className="text-xs text-zinc-400 mb-6">Cluster Node: DXB-01</p>
                          <div className="space-y-5">
                            <div className="space-y-2">
                               <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-teal-accent">
                                 <span>Compute</span>
                                 <span>24%</span>
                               </div>
                               <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                                 <div className="h-full bg-teal-accent" style={{ width: '24%' }} />
                               </div>
                            </div>
                            <div className="space-y-2">
                               <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-white">
                                 <span>Memory</span>
                                 <span>48%</span>
                               </div>
                               <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                                 <div className="h-full bg-white" style={{ width: '48%' }} />
                               </div>
                            </div>
                          </div>
                        </div>
                        <div className="absolute -bottom-6 -right-6 text-white/5">
                          <Activity size={120} />
                        </div>
                      </div>

                      <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm">
                         <h4 className="text-xs font-bold text-zinc-800 mb-4 uppercase tracking-widest">Admin Tools</h4>
                         <div className="grid grid-cols-2 gap-3 mt-4">
                            <button className="p-3 rounded-xl border border-zinc-100 hover:border-teal-accent/30 hover:bg-teal-accent/5 transition-all text-center">
                               <TooltipIcon size={14} className="mx-auto text-zinc-400 mb-2" />
                               <span className="text-[9px] font-bold text-zinc-600 block uppercase">Audit</span>
                            </button>
                            <button className="p-3 rounded-xl border border-zinc-100 hover:border-teal-accent/30 hover:bg-teal-accent/5 transition-all text-center">
                               <Mail size={14} className="mx-auto text-zinc-400 mb-2" />
                               <span className="text-[9px] font-bold text-zinc-600 block uppercase">Broadcast</span>
                            </button>
                         </div>
                      </div>
                   </div>
                </div>
              </motion.div>
            )}

            {activeTab === "add-service" && (
              <motion.div 
                key="add-service"
                initial={{ opacity: 0, scale: 0.99 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.99 }}
                className="bg-white rounded-lg shadow-2xl border border-zinc-200 overflow-hidden flex flex-col h-full max-w-3xl mx-auto"
              >
                {/* Window Header */}
                <div className="bg-zinc-50 border-b border-zinc-200 px-4 py-3 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-zinc-800">Add Service</h3>
                  <X size={16} className="text-zinc-400 hover:text-zinc-600 cursor-pointer" onClick={() => setActiveTab("overview")} />
                </div>

                <div className="p-8 space-y-6 flex-1 overflow-y-auto bg-white border-t border-zinc-100">
                  <form onSubmit={handleTicketSubmit} className="space-y-6">
                    {/* Customer Selection Row */}
                    <div className="space-y-1">
                      <label className="text-[11px] text-zinc-500 font-medium">Select Customers: <span className="text-red-500">*</span></label>
                      <div className="flex gap-2">
                        <select 
                          required
                          value={ticketForm.customerName || ""} 
                          onChange={e => setTicketForm({...ticketForm, customerName: e.target.value})}
                          className="flex-1 bg-white border border-[#E2E8F0] rounded px-3 py-2 text-[11px] text-zinc-600 focus:outline-none focus:ring-1 focus:ring-teal-accent/20"
                        >
                          <option value="">Type to select or create...</option>
                          {data.customers.map((c, idx) => <option key={`${c.id}-${idx}`} value={c.name}>{c.name}</option>)}
                        </select>
                        <button type="button" className="p-2 bg-[#64748B] rounded text-white hover:opacity-90">
                          <Activity size={16} className="rotate-90" />
                        </button>
                      </div>
                    </div>

                    {/* Info Box */}
                    {(() => {
                      const selectedCust = data.customers.find(c => c.name === ticketForm.customerName);
                      return (
                        <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-lg p-4 space-y-1 text-[11px] text-[#991B1B]">
                          <div>Implementation Type: <span className="font-bold">{selectedCust?.implementationType || '-'}</span></div>
                          <div>Contact Name: <span className="font-bold">{selectedCust?.contactName || '-'}</span></div>
                          <div>Phone: <span className="font-bold">{selectedCust?.phone || '-'}</span></div>
                          <div>Email: <span className="font-bold">{selectedCust?.email || '-'}</span></div>
                          <div>Address: <span className="font-bold">-</span></div>
                          <div>Region: <span className="font-bold">{selectedCust?.region || '-'}</span></div>
                          <div>Locator Plan: <span className="font-bold">-</span></div>
                          <div>Locator Username: <span className="font-bold">-</span></div>
                          <div>Vehicle Count: <span className="font-bold">{selectedCust?.vehicleCount || '0'}</span></div>
                        </div>
                      );
                    })()}

                    {/* Description */}
                    <div className="space-y-1">
                      <label className="text-[11px] text-zinc-500 font-medium">Description: <span className="text-red-500">*</span></label>
                      <textarea 
                        required
                        rows={4}
                        value={ticketForm.description || ""} 
                        onChange={e => setTicketForm({...ticketForm, description: e.target.value})}
                        className="w-full bg-white border border-[#E2E8F0] rounded px-3 py-2 text-[11px] text-zinc-600 focus:outline-none"
                      />
                    </div>

                    {/* Location Button */}
                    <div className="flex justify-end">
                      <button type="button" className="px-3 py-1.5 border border-[#3B82F6] text-[#3B82F6] rounded text-[11px] font-medium flex items-center gap-1.5 hover:bg-blue-50 transition-colors">
                        <Plus size={14} /> Location
                      </button>
                    </div>

                    {/* Bottom Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                      <div className="space-y-1">
                        <label className="text-[11px] text-zinc-500 font-medium">Status:</label>
                        <select value={ticketForm.status} onChange={e => setTicketForm({...ticketForm, status: e.target.value})} className="w-full bg-white border border-[#E2E8F0] rounded px-3 py-2 text-[11px] text-zinc-600 focus:outline-none">
                          {TICKET_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] text-zinc-500 font-medium">Quantity:</label>
                        <input type="number" min="1" value={ticketForm.quantity} onChange={e => setTicketForm({...ticketForm, quantity: parseInt(e.target.value)})} className="w-full bg-white border border-[#E2E8F0] rounded px-3 py-2 text-[11px] text-zinc-600 focus:outline-none" />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] text-zinc-500 font-medium">Level 1 Assignee:</label>
                        <select value={ticketForm.assignee} onChange={e => setTicketForm({...ticketForm, assignee: e.target.value})} className="w-full bg-white border border-[#E2E8F0] rounded px-3 py-2 text-[11px] text-zinc-600 focus:outline-none">
                          <option value="">Select</option>
                          {SALES_PEOPLE.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] text-zinc-500 font-medium">Requested Person: <span className="text-red-500">*</span></label>
                        <select required value={ticketForm.requestedPerson} onChange={e => setTicketForm({...ticketForm, requestedPerson: e.target.value})} className="w-full bg-white border border-[#E2E8F0] rounded px-3 py-2 text-[11px] text-zinc-600 focus:outline-none">
                          <option value="">Select requested person</option>
                          {REQUESTED_PEOPLE.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] text-zinc-500 font-medium">Payment:</label>
                        <select value={ticketForm.payment} onChange={e => setTicketForm({...ticketForm, payment: e.target.value})} className="w-full bg-white border border-[#E2E8F0] rounded px-3 py-2 text-[11px] text-zinc-600 focus:outline-none">
                          {PAYMENT_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] text-zinc-500 font-medium">Invoice Status:</label>
                        <select value={ticketForm.invoiceStatus} onChange={e => setTicketForm({...ticketForm, invoiceStatus: e.target.value})} className="w-full bg-white border border-[#E2E8F0] rounded px-3 py-2 text-[11px] text-zinc-600 focus:outline-none">
                          {INVOICE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] text-zinc-500 font-medium">Amount:</label>
                        <input type="text" value={ticketForm.amount || ""} onChange={e => setTicketForm({...ticketForm, amount: e.target.value})} className="w-full bg-white border border-[#E2E8F0] rounded px-3 py-2 text-[11px] text-zinc-600 focus:outline-none" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] text-zinc-500 font-medium">Payment Status:</label>
                        <select value={ticketForm.paymentStatus} onChange={e => setTicketForm({...ticketForm, paymentStatus: e.target.value})} className="w-full bg-white border border-[#E2E8F0] rounded px-3 py-2 text-[11px] text-zinc-600 focus:outline-none">
                          {PAYMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-6 border-t border-zinc-100">
                      <button type="submit" className="bg-[#22C55E] text-white px-6 py-2 rounded text-[11px] font-bold hover:opacity-90 transition-all">
                        Submit
                      </button>
                      <button type="button" onClick={() => setActiveTab("overview")} className="bg-[#64748B] text-white px-6 py-2 rounded text-[11px] font-bold hover:opacity-90 transition-all">
                        Close
                      </button>
                    </div>
                  </form>
                </div>
              </motion.div>
            )}

            {activeTab === "existing-form" && (
              <motion.div 
                key="existing-form"
                initial={{ opacity: 0, scale: 0.99 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.99 }}
                className="bg-white rounded-lg shadow-2xl border border-zinc-200 overflow-hidden flex flex-col h-full"
              >
                {/* Window Header */}
                <div className="bg-zinc-50 border-b border-zinc-200 px-4 py-2 flex items-center justify-between">
                  <div className="text-[11px] font-medium text-zinc-600 flex items-center gap-2">
                    Existing Form - {new Date().toLocaleDateString('en-GB').replace(/\//g, '-')}
                  </div>
                  <div className="flex items-center gap-4 text-zinc-400">
                    <Minus size={14} className="hover:text-zinc-600 cursor-pointer" />
                    <Square size={10} className="hover:text-zinc-600 cursor-pointer" />
                    <X size={14} className="hover:text-red-500 cursor-pointer" onClick={() => setActiveTab("overview")} />
                  </div>
                </div>

                <div className="p-8 space-y-6 flex-1 overflow-y-auto bg-[#F8FAFC]">
                  {/* Top Search Bar Row */}
                  <div className="flex justify-end gap-2 items-center mb-4">
                    <div className="relative group">
                      <select 
                        onChange={(e) => {
                          const cust = data.customers.find(c => c.name === e.target.value);
                          if (cust) {
                            setLeadForm({
                              ...leadForm,
                              customerName: cust.name,
                              contactName: cust.contactName,
                              phone: cust.phone,
                              email: cust.email,
                              region: cust.region,
                              implementationType: cust.implementationType
                            });
                          }
                        }}
                        className="bg-white border border-[#E2E8F0] rounded py-1.5 px-3 text-[11px] w-64 focus:outline-none focus:ring-1 focus:ring-teal-accent/20"
                      >
                        <option value="">Search Existing Customer...</option>
                        {data.customers.map((c, idx) => <option key={`${c.id}-${idx}`} value={c.name}>{c.name}</option>)}
                      </select>
                    </div>
                    <button className="p-1.5 bg-teal-accent rounded text-white hover:opacity-90 transition-all">
                      <Search size={14} />
                    </button>
                    <button 
                       onClick={() => setLeadForm({ status: 'New Lead', region: REGIONS[0], implementationType: IMPLEMENTATION_TYPES[0], salesPerson: SALES_PEOPLE[0], salesType: SALES_TYPES[0], source: SOURCES[0], newQty: 0, migrateQty: 0, tradingQty: 0, serviceQty: 0, otherQty: 0 })}
                       className="p-1.5 bg-[#EF4444] rounded text-white hover:opacity-90 transition-all"
                    >
                      <Activity size={14} className="rotate-90" />
                    </button>
                  </div>

                  <form onSubmit={handleLeadSubmit} className="space-y-4">
                    {/* Row 1: Source, Region, Status, Imp Type, Price, Proj Value */}
                    <div className="grid grid-cols-6 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] text-zinc-500 flex items-center gap-0.5">Source: <span className="text-red-500">*</span></label>
                        <select required value={leadForm.source} onChange={e => setLeadForm({...leadForm, source: e.target.value})} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none">
                          <option value="">Select Source</option>
                          {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-zinc-500">Region:</label>
                        <select value={leadForm.region} onChange={e => setLeadForm({...leadForm, region: e.target.value})} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none">
                          <option value="">Select Region</option>
                          {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-zinc-500 flex items-center gap-0.5">Status: <span className="text-red-500">*</span></label>
                        <select required value={leadForm.status} onChange={e => setLeadForm({...leadForm, status: e.target.value})} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none">
                          {LEAD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-zinc-500 flex items-center gap-0.5">Implementation Type: <span className="text-red-500">*</span></label>
                        <select required value={leadForm.implementationType} onChange={e => setLeadForm({...leadForm, implementationType: e.target.value})} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none">
                           <option value="">Select Implementation Type</option>
                           {IMPLEMENTATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-zinc-500">Price:</label>
                        <input type="text" placeholder="Price Details" value={leadForm.priceDetails || ""} onChange={e => setLeadForm({...leadForm, priceDetails: e.target.value})} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-zinc-500">Project Value:</label>
                        <input type="text" placeholder="Project Value" value={leadForm.projectValue || ""} onChange={e => setLeadForm({...leadForm, projectValue: e.target.value})} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none" />
                      </div>
                    </div>

                    {/* Row 2: Customer Name, Contact Name, Phone, Email, Designation */}
                    <div className="grid grid-cols-6 gap-4">
                      <div className="col-span-2 space-y-1">
                        <label className="text-[10px] text-zinc-500 flex items-center gap-0.5">Customer Name: <span className="text-red-500">*</span></label>
                        <input required type="text" placeholder="Customer Name" value={leadForm.customerName || ""} onChange={e => setLeadForm({...leadForm, customerName: e.target.value})} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-zinc-500 flex items-center gap-0.5">Contact Name: <span className="text-red-500">*</span></label>
                        <input required type="text" placeholder="Contact Name" value={leadForm.contactName || ""} onChange={e => setLeadForm({...leadForm, contactName: e.target.value})} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-zinc-500 flex items-center gap-0.5">Phone: <span className="text-red-500">*</span></label>
                        <input required type="text" placeholder="Phone" value={leadForm.phone || ""} onChange={e => setLeadForm({...leadForm, phone: e.target.value})} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-zinc-500">Email:</label>
                        <input type="email" placeholder="Email" value={leadForm.email || ""} onChange={e => setLeadForm({...leadForm, email: e.target.value})} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-zinc-500">Designation:</label>
                        <input type="text" placeholder="Designation" value={leadForm.designation || ""} onChange={e => setLeadForm({...leadForm, designation: e.target.value})} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none" />
                      </div>
                    </div>

                    {/* Row 3: Address, Map Link, Coordinates, Sales Person, Sales Type */}
                    <div className="grid grid-cols-6 gap-4">
                      <div className="col-span-2 space-y-1">
                        <label className="text-[10px] text-zinc-500">Address:</label>
                        <input type="text" placeholder="Address" value={leadForm.address || ""} onChange={e => setLeadForm({...leadForm, address: e.target.value})} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none" />
                      </div>
                      <div className="col-span-2 space-y-1">
                        <label className="text-[10px] text-zinc-500">Map Link:</label>
                        <input type="text" placeholder="Map Link" value={leadForm.mapLink || ""} onChange={e => setLeadForm({...leadForm, mapLink: e.target.value})} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-zinc-500">Coordinates:</label>
                        <input type="text" placeholder="Coordinates" value={leadForm.coordinates || ""} onChange={e => setLeadForm({...leadForm, coordinates: e.target.value})} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-zinc-500 flex items-center gap-0.5">Sales Person: <span className="text-red-500">*</span></label>
                        <select required value={leadForm.salesPerson} onChange={e => setLeadForm({...leadForm, salesPerson: e.target.value})} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none">
                          <option value="">Select sales person</option>
                          {SALES_PEOPLE.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-6 gap-4">
                       <div className="col-start-6 space-y-1">
                          <label className="text-[10px] text-zinc-500 flex items-center gap-0.5">Sales Type: <span className="text-red-500">*</span></label>
                          <select required value={leadForm.salesType} onChange={e => setLeadForm({...leadForm, salesType: e.target.value})} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none">
                            <option value="">Select Sales Type</option>
                            {SALES_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                    </div>

                    {/* Row 4: Qtys, Accessories, Req Person */}
                    <div className="grid grid-cols-8 gap-3 items-end">
                      <div className="space-y-1">
                        <label className="text-[10px] text-zinc-500">New Qty:</label>
                        <input type="number" value={leadForm.newQty} onChange={e => setLeadForm({...leadForm, newQty: parseInt(e.target.value)})} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-2 py-1.5 text-[11px] text-zinc-600 focus:outline-none text-center" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-zinc-500">Migrate Qty:</label>
                        <input type="number" value={leadForm.migrateQty} onChange={e => setLeadForm({...leadForm, migrateQty: parseInt(e.target.value)})} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-2 py-1.5 text-[11px] text-zinc-600 focus:outline-none text-center" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-zinc-500">Trading Qty:</label>
                        <input type="number" value={leadForm.tradingQty} onChange={e => setLeadForm({...leadForm, tradingQty: parseInt(e.target.value)})} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-2 py-1.5 text-[11px] text-zinc-600 focus:outline-none text-center" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-zinc-500">Service Qty:</label>
                        <input type="number" value={leadForm.serviceQty} onChange={e => setLeadForm({...leadForm, serviceQty: parseInt(e.target.value)})} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-2 py-1.5 text-[11px] text-zinc-600 focus:outline-none text-center" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-zinc-500">Other Qty:</label>
                        <input type="number" value={leadForm.otherQty} onChange={e => setLeadForm({...leadForm, otherQty: parseInt(e.target.value)})} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-2 py-1.5 text-[11px] text-zinc-600 focus:outline-none text-center" />
                      </div>
                      <div className="col-span-2 space-y-1">
                        <label className="text-[10px] text-zinc-500">Accessories If Any:</label>
                        <input type="text" placeholder="Accessories" value={leadForm.accessories || ""} onChange={e => setLeadForm({...leadForm, accessories: e.target.value})} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-zinc-500 flex items-center gap-0.5">Requested Person: <span className="text-red-500">*</span></label>
                        <select required value={leadForm.requestedPerson} onChange={e => setLeadForm({...leadForm, requestedPerson: e.target.value})} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none">
                          <option value="">Select requested person</option>
                          {REQUESTED_PEOPLE.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                    </div>

                    {/* Comment Section */}
                    <div className="space-y-1">
                      <textarea rows={2} placeholder="Comment" value={leadForm.comment || ""} onChange={e => setLeadForm({...leadForm, comment: e.target.value})} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-4 py-3 text-[11px] text-zinc-600 focus:outline-none resize-none" />
                    </div>

                    {/* Additional Contact Details */}
                    <div className="space-y-4 pt-4 border-t border-zinc-100">
                      <h4 className="text-[11px] text-zinc-400 font-medium tracking-tight">Additional Contact Details</h4>
                      <button type="button" className="w-9 h-9 rounded bg-teal-accent flex items-center justify-center text-white shadow-lg shadow-teal-accent/20 hover:scale-105 transition-all">
                        <Plus size={20} />
                      </button>
                    </div>

                    <div className="flex justify-end pt-4">
                      <button type="submit" className="bg-teal-accent text-white px-10 py-2 rounded font-bold text-[10px] uppercase tracking-widest shadow-lg shadow-teal-accent/10 hover:opacity-95 transition-all">
                        SAVE
                      </button>
                    </div>
                  </form>
                </div>
              </motion.div>
            )}

            {activeTab === "ai" && (
              <motion.div 
                key="ai"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.02 }}
                className="max-w-4xl mx-auto"
              >
                <div className="mb-8 text-center">
                  <h3 className="text-2xl font-bold text-zinc-900 tracking-tight">SynoHub Cloud Intelligence</h3>
                  <p className="text-sm text-zinc-500 mt-2">Manage your entire fleet via cognitive automation.</p>
                </div>
                <ChatInterface onRecordSaved={(savedRecord) => {
                  fetchData();
                  if (savedRecord && savedRecord.type === "registration") {
                    const findOptionMatch = (value: string | undefined, list: string[], defaultValue?: string): string => {
                      if (!value) return defaultValue !== undefined ? defaultValue : list[0];
                      const cleanedVal = value.trim().toUpperCase().replace(/\s*\+\s*/g, '+').replace(/\s+/g, '');
                      const found = list.find(opt => {
                        const cleanedOpt = opt.trim().toUpperCase().replace(/\s*\+\s*/g, '+').replace(/\s+/g, '');
                        return cleanedOpt === cleanedVal || cleanedOpt.startsWith(cleanedVal) || cleanedOpt.includes(cleanedVal) || cleanedVal.includes(cleanedOpt);
                      });
                      return found || defaultValue || list[0];
                    };

                    setLeadForm({
                      customerName: savedRecord.customerName || "",
                      contactName: savedRecord.contactName || "",
                      phone: savedRecord.phone || "",
                      email: savedRecord.email || "",
                      region: findOptionMatch(savedRecord.region, REGIONS, REGIONS[0]),
                      address: savedRecord.address || "",
                      mapLink: savedRecord.mapLink || "",
                      coordinates: savedRecord.coordinates || "",
                      source: findOptionMatch(savedRecord.source, SOURCES, "Company Lead"),
                      status: findOptionMatch(savedRecord.status, LEAD_STATUSES, "New Lead"),
                      implementationType: findOptionMatch(savedRecord.implementationType, IMPLEMENTATION_TYPES, "LOCATOR"),
                      salesPerson: findOptionMatch(savedRecord.salesPerson, SALES_PEOPLE, "Nishad"),
                      salesType: findOptionMatch(savedRecord.salesType, SALES_TYPES, "New"),
                      requestedPerson: findOptionMatch(savedRecord.requestedPerson, REQUESTED_PEOPLE),
                      comment: savedRecord.comment || "",
                      projectValue: savedRecord.projectValue || "",
                      priceDetails: savedRecord.priceDetails || "",
                      accessories: savedRecord.accessories || "",
                      newQty: savedRecord.newQty || savedRecord.qty || 0,
                      migrateQty: savedRecord.migrateQty || 0,
                      tradingQty: savedRecord.tradingQty || 0,
                      serviceQty: savedRecord.serviceQty || 0,
                      otherQty: savedRecord.otherQty || 0
                    });
                    setActiveTab("existing-form");
                  }
                }} />
              </motion.div>
            )}

            {activeTab === "ingest" && (
              <motion.div 
                key="ingest"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-4xl mx-auto"
              >
                <IngestModule onSync={fetchData} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

