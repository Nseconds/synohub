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
const REQUESTED_PEOPLE = ["Ajmal", "Amrutha", "Athul", "Celine", "Deepak", "Faizal", "Ivy", "Midhun", "Mohamed Musthafa", "Naseeb", "Nishad", "Rasick", "Reyn", "Shamnad", "Shams", "Shyamjith"];
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



const ChatInterface = ({ onRecordSaved, onNewStaffDetected }: { onRecordSaved?: (savedRecord?: any) => void, onNewStaffDetected?: (name: string) => void }) => {
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

    // Extract newly introduced staff name
    const introMatch = userMsg.match(/(?:i\s*a+m|i'm|ia+m|ia+am|my\s+name\s+is|this\s+is)\s+([a-zA-Z]{3,20})/i);
    if (introMatch && introMatch[1]) {
      const potentialName = introMatch[1].trim();
      const capitalized = potentialName.charAt(0).toUpperCase() + potentialName.slice(1).toLowerCase();
      if (onNewStaffDetected) {
        onNewStaffDetected(capitalized);
      }
    }

    try {
      const history = messages.slice(-5).map(m => ({ role: m.role, content: m.content }));
      const res = await axios.post("/api/chat", { message: userMsg, history });
      setMessages(prev => [...prev, { role: 'assistant', content: res.data.reply }]);
      if (res.data.savedRecord) {
        if (onRecordSaved) {
          onRecordSaved(res.data.savedRecord);
        }
        if (res.data.savedRecord.requestedPerson && onNewStaffDetected) {
          const p = res.data.savedRecord.requestedPerson.trim();
          const capitalized = p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
          onNewStaffDetected(capitalized);
        }
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: "I'm experiencing high traffic. Please try again in 30s." }]);
    } finally {
      setLoading(false);
    }
  };

  const handlePresetClick = async (promptText: string) => {
    if (loading) return;
    setMessages(prev => [...prev, { role: 'user', content: promptText }]);
    setLoading(true);

    // Extract newly introduced staff name from preset click if any
    const introMatch = promptText.match(/(?:i\s*a+m|i'm|ia+m|ia+am|my\s+name\s+is|this\s+is)\s+([a-zA-Z]{3,20})/i);
    if (introMatch && introMatch[1]) {
      const potentialName = introMatch[1].trim();
      const capitalized = potentialName.charAt(0).toUpperCase() + potentialName.slice(1).toLowerCase();
      if (onNewStaffDetected) {
        onNewStaffDetected(capitalized);
      }
    }

    try {
      const history = messages.slice(-5).map(m => ({ role: m.role, content: m.content }));
      const res = await axios.post("/api/chat", { message: promptText, history });
      setMessages(prev => [...prev, { role: 'assistant', content: res.data.reply }]);
      if (res.data.savedRecord) {
        if (onRecordSaved) {
          onRecordSaved(res.data.savedRecord);
        }
        if (res.data.savedRecord.requestedPerson && onNewStaffDetected) {
          const p = res.data.savedRecord.requestedPerson.trim();
          const capitalized = p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
          onNewStaffDetected(capitalized);
        }
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: "I'm experiencing high traffic. Please try again in 30s." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4">
      {/* Primary Chat Area */}
      <div className="flex flex-col h-[700px] border border-zinc-200 rounded-2xl overflow-hidden bg-white shadow-lg">
        {/* Header */}
        <div className="p-4 border-b border-zinc-100 bg-zinc-50/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-teal-accent/10 flex items-center justify-center">
              <Zap size={16} className="text-teal-accent" />
            </div>
            <div>
              <div className="text-sm font-bold text-zinc-800">SynoHub AI Assistant</div>
              <div className="text-[10px] text-zinc-500 uppercase tracking-widest flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-accent animate-pulse" /> Cog-Ops Neural Link
              </div>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-hide bg-zinc-50/30">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-zinc-400 text-center p-8 space-y-4">
               <MessageSquare size={44} className="opacity-15 text-teal-accent" />
               <div className="text-xs font-medium text-zinc-500 max-w-[280px]">
                 Hi there! Ask any query to start a streamlined operational conversation.
               </div>
            </div>
          )}
          {messages.map((m, idx) => (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              key={`msg-${idx}`}
              className={cn(
                "flex flex-col max-w-[85%] gap-1.5",
                m.role === 'user' ? "ml-auto items-end" : "mr-auto items-start"
              )}
            >
              <div className={cn(
                "p-4 rounded-2xl text-xs leading-relaxed shadow-sm",
                m.role === 'user' 
                  ? "bg-zinc-800 text-white rounded-br-none" 
                  : "bg-white text-zinc-700 rounded-bl-none border border-zinc-100"
              )}>
                {m.content}
              </div>
              <span className="text-[9px] text-zinc-400 uppercase tracking-tight px-1 font-bold">
                {m.role === 'user' ? "You" : "SynoAI Officer"}
              </span>
            </motion.div>
          ))}
          {loading && (
            <div className="flex gap-1.5 p-3.5 bg-white border border-zinc-100 w-fit rounded-2xl shadow-sm">
              <div className="w-1.5 h-1.5 rounded-full bg-teal-accent animate-bounce [animation-delay:-0.3s]" />
              <div className="w-1.5 h-1.5 rounded-full bg-teal-accent animate-bounce [animation-delay:-0.15s]" />
              <div className="w-1.5 h-1.5 rounded-full bg-teal-accent animate-bounce" />
            </div>
          )}
        </div>

        {/* Input Bar */}
        <div className="p-4 bg-white border-t border-zinc-100">
          <div className="relative">
            <input 
              type="text" 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Type your message..." 
              className="w-full bg-zinc-50 border border-zinc-200 rounded-xl py-3.5 pl-4 pr-12 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-teal-accent/50 transition-all font-medium"
            />
            <button 
              onClick={handleSend}
              disabled={loading || !input.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2.5 text-zinc-400 hover:text-teal-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [activeTab, setActiveTab ] = useState<string>("overview");
  const [requestedPeopleList, setRequestedPeopleList] = useState<string[]>(REQUESTED_PEOPLE);
  const [defaultRequestedPerson, setDefaultRequestedPerson] = useState<string>("");
  const [pendingStaffName, setPendingStaffName] = useState<string | null>(null);
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

  // Data Manager States
  const [dbTab, setDbTab] = useState<"leads" | "services" | "customers">("leads");
  const [dbSearch, setDbSearch] = useState("");
  const [dbRegion, setDbRegion] = useState("All");
  const [editingItem, setEditingItem] = useState<{ type: 'lead' | 'service' | 'customer', data: any } | null>(null);
  
  // Custom states for existing lead select and visual notifications
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [notification, setNotification] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [dbError, setDbError] = useState<{ error: string; details?: string; connectionConfig?: any } | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(null);
    }, 4500);
  };

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
    otherQty: 0,
    customerName: "",
    contactName: "",
    phone: "",
    email: "",
    designation: "",
    address: "",
    mapLink: "",
    coordinates: "",
    comment: "",
    projectValue: "",
    priceDetails: "",
    accessories: "",
    requestedPerson: defaultRequestedPerson
  });

  const [ticketForm, setTicketForm] = useState<Partial<ServiceTicket>>({
    status: 'New',
    payment: PAYMENT_OPTIONS[0],
    invoiceStatus: INVOICE_STATUSES[0],
    paymentStatus: PAYMENT_STATUSES[0],
    quantity: 1,
    requestedPerson: defaultRequestedPerson
  });

  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showExistingSuggestions, setShowExistingSuggestions] = useState(false);

  // Clear lead form state to pristine defaults
  const resetLeadForm = () => {
    setLeadForm({
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
      otherQty: 0,
      customerName: "",
      contactName: "",
      phone: "",
      email: "",
      designation: "",
      address: "",
      mapLink: "",
      coordinates: "",
      comment: "",
      projectValue: "",
      priceDetails: "",
      accessories: "",
      requestedPerson: defaultRequestedPerson
    });
    setSelectedLeadId(null);
    setShowSuggestions(false);
  };

  // Safe reset when tab is switched
  useEffect(() => {
    if (activeTab === "new-form") {
      resetLeadForm();
    } else if (activeTab === "existing-form") {
      if (!selectedLeadId) {
        resetLeadForm();
      }
    }
  }, [activeTab]);

  // Sync leadForm with selectedLeadId from DB registrations dynamically
  useEffect(() => {
    if (selectedLeadId && data.registrations.length > 0) {
      const selectedReg = data.registrations.find(r => r.id === selectedLeadId);
      if (selectedReg) {
        setLeadForm({
          status: selectedReg.status || 'New Lead',
          region: selectedReg.region || REGIONS[0],
          implementationType: selectedReg.implementationType || IMPLEMENTATION_TYPES[0],
          salesPerson: selectedReg.salesPerson || SALES_PEOPLE[0],
          salesType: selectedReg.salesType || SALES_TYPES[0],
          source: selectedReg.source || SOURCES[0],
          newQty: selectedReg.newQty || 0,
          migrateQty: selectedReg.migrateQty || 0,
          tradingQty: selectedReg.tradingQty || 0,
          serviceQty: selectedReg.serviceQty || 0,
          otherQty: selectedReg.otherQty || 0,
          customerName: selectedReg.customerName || "",
          contactName: selectedReg.contactName || "",
          phone: selectedReg.phone || "",
          email: selectedReg.email || "",
          designation: selectedReg.designation || "",
          address: selectedReg.address || "",
          mapLink: selectedReg.mapLink || "",
          coordinates: selectedReg.coordinates || "",
          comment: selectedReg.comment || "",
          projectValue: selectedReg.projectValue || "",
          priceDetails: selectedReg.priceDetails || "",
          accessories: selectedReg.accessories || "",
          requestedPerson: selectedReg.requestedPerson || ""
        });
      }
    }
  }, [selectedLeadId, data.registrations]);

  const handleLeadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (activeTab === "existing-form" && selectedLeadId) {
        // Update database with existing lead record
        await axios.put(`/api/leads/${selectedLeadId}`, leadForm);
        showToast("Lead configuration updated in database and synchronized with Customers successfully!");
      } else {
        // Create brand-new lead registration in database
        await axios.post("/api/leads/new", leadForm);
        showToast("Lead registration created in database and synchronized with Customers successfully!");
      }
      setIsLeadModalOpen(false);
      fetchData();
      resetLeadForm();
    } catch (err) {
      console.error("Submit error details:", err);
      showToast("Could not submit lead details. Please inspect constraints and connection.", "error");
    }
  };

  const handleSelectCustomer = (cust: Customer) => {
    if (activeTab === "new-form") {
      setLeadForm(prev => ({
        ...prev,
        customerName: cust.name,
        contactName: cust.contactName || prev.contactName || "",
        phone: cust.phone || prev.phone || "",
        email: cust.email || prev.email || "",
        region: cust.region || prev.region || REGIONS[0],
        implementationType: cust.implementationType || prev.implementationType || IMPLEMENTATION_TYPES[0]
      }));
      showToast(`Populated "New Form" with details for: ${cust.name}`);
    } else if (activeTab === "existing-form") {
      const matchingReg = data.registrations.find(r => r.customerName.toLowerCase() === cust.name.toLowerCase());
      if (matchingReg) {
        setSelectedLeadId(matchingReg.id);
        showToast(`Loaded existing Lead ID #${matchingReg.id} for: ${cust.name}`);
      } else {
        setSelectedLeadId(null);
        setLeadForm(prev => ({
          ...prev,
          customerName: cust.name,
          contactName: cust.contactName || "",
          phone: cust.phone || "",
          email: cust.email || "",
          region: cust.region || REGIONS[0],
          implementationType: cust.implementationType || IMPLEMENTATION_TYPES[0],
          source: "Company Lead",
          status: "New Lead",
          requestedPerson: defaultRequestedPerson,
          salesType: "New"
        }));
        showToast(`No lead found. Ready to create a new lead for customer: ${cust.name}`);
      }
    }
  };

  const handleTicketSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await axios.post("/api/services", ticketForm);
      setIsTicketModalOpen(false);
      fetchData();
      showToast(`Service ticket created successfully!`);
      setTicketForm({ 
        status: 'New', 
        payment: PAYMENT_OPTIONS[0], 
        invoiceStatus: INVOICE_STATUSES[0], 
        paymentStatus: PAYMENT_STATUSES[0], 
        quantity: 1,
        requestedPerson: defaultRequestedPerson
      });
    } catch (err) {
      showToast("Failed to create service ticket", "error");
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
      setDbError(null);

      // Extract dynamic requestedPerson and append to listed people if missing
      const dbRequestedPeople = new Set<string>();
      if (res.data.registrations && Array.isArray(res.data.registrations)) {
        res.data.registrations.forEach((r: any) => {
          if (r.requestedPerson && r.requestedPerson.trim()) {
            dbRequestedPeople.add(r.requestedPerson.trim());
          }
        });
      }
      if (res.data.services && Array.isArray(res.data.services)) {
        res.data.services.forEach((s: any) => {
          if (s.requestedPerson && s.requestedPerson.trim()) {
            dbRequestedPeople.add(s.requestedPerson.trim());
          }
        });
      }

      if (dbRequestedPeople.size > 0) {
        setRequestedPeopleList(prev => {
          const merged = [...prev];
          dbRequestedPeople.forEach(person => {
            const trimmed = person.trim();
            const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
            if (capitalized && !merged.some(p => p.toLowerCase() === capitalized.toLowerCase())) {
              merged.push(capitalized);
            }
          });
          return merged;
        });
      }
    } catch (e: any) {
      console.error("Data fetch failed", e);
      if (e.response && e.response.data) {
        setDbError(e.response.data);
      } else {
        setDbError({ 
          error: e.message || "Unknown database connection error",
          details: "Could not reach database API endpoint." 
        });
      }
      // Populate with empty datasets if database fetch fails
      setData({
        registrations: [],
        services: [],
        customers: []
      });
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
    { id: "new-form", label: "New Form", icon: Plus },
    { id: "existing-form", label: "Existing Form", icon: ClipboardList },
    { id: "ai", label: "SynoAI Chat", icon: Sparkles },
  ];

  return (
    <div className="flex h-screen bg-[#F8FAFC] text-zinc-700 font-sans selection:bg-[#00ADC6]/20 relative">
      {/* Toast Notification Container */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -25, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -25, scale: 0.98 }}
            className={cn(
              "fixed top-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-2xl border text-xs font-semibold backdrop-blur-md max-w-md",
              notification.type === "success" 
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600" 
                : "bg-rose-500/10 border-rose-500/20 text-rose-600"
            )}
          >
            <CheckCircle2 size={16} className={cn(notification.type === "success" ? "text-emerald-500" : "text-rose-500")} />
            <span>{notification.message}</span>
            <button onClick={() => setNotification(null)} className="ml-3 hover:opacity-75 transition-opacity text-zinc-400">
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

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
                            {requestedPeopleList.map(p => <option key={p} value={p}>{p}</option>)}
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
            {/* <Modal isOpen={isTicketModalOpen} onClose={() => setIsTicketModalOpen(false)} title="Create Service Ticket">
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
                                {requestedPeopleList.map(p => <option key={p} value={p}>{p}</option>)}
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
            </Modal> */}

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
                    <X size={14} className="hover:text-red-500 cursor-pointer" onClick={resetLeadForm} />
                  </div>
                </div>

                <div className="p-8 space-y-8 flex-1 overflow-y-auto bg-[#F8FAFC]">
                  {searchTerm && (
                    <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden shadow-md mb-6">
                      <div className="bg-[#00ADC6]/5 border-b border-[#00ADC6]/10 px-4 py-2.5 flex items-center justify-between">
                        <span className="text-[11px] font-bold text-[#00ADC6] flex items-center gap-1.5 uppercase tracking-wider">
                          <Search size={12} /> Matched Customer Accounts For "{searchTerm}"
                        </span>
                        <span className="text-[10px] font-mono text-zinc-500 font-bold">{filteredCustomers.length} Found</span>
                      </div>
                      {filteredCustomers.length === 0 ? (
                        <div className="p-6 text-center text-xs text-zinc-400">
                          No matched customer accounts found. Submit form below to create a new one.
                        </div>
                      ) : (
                        <div className="overflow-x-auto max-h-48 scrollbar-thin">
                          <table className="w-full text-left text-[11px]">
                            <thead className="bg-[#F8FAFC] border-b border-zinc-200 text-zinc-500 uppercase text-[9px] tracking-wider font-bold">
                              <tr>
                                <th className="px-4 py-2 bg-zinc-50">Customer Name</th>
                                <th className="px-4 py-2 bg-zinc-50">Implementation Type</th>
                                <th className="px-4 py-2 bg-zinc-50">Sales Person</th>
                                <th className="px-4 py-2 bg-zinc-50">Contact Name</th>
                                <th className="px-4 py-2 bg-zinc-50">Phone</th>
                                <th className="px-4 py-2 bg-zinc-50">Locator Username</th>
                                <th className="px-4 py-2 bg-zinc-50">Locator Status</th>
                                <th className="px-4 py-2 bg-zinc-50 text-center">Vehicle Count</th>
                                <th className="px-4 py-2 text-center bg-zinc-50">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 text-zinc-650">
                              {filteredCustomers.map(cust => {
                                const latestRequest = [...data.registrations].reverse().find(r => r.customerName.toLowerCase() === cust.name.toLowerCase());
                                const salesRep = latestRequest?.salesPerson || latestRequest?.requestedPerson || "Shams";
                                const locatorUsername = cust.name ? cust.name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) : "temco";
                                const locatorStatus = "active";

                                return (
                                  <tr key={cust.id} className="hover:bg-teal-50/40 hover:text-zinc-950 transition-colors cursor-pointer" onClick={() => handleSelectCustomer(cust)}>
                                    <td className="px-4 py-2 font-bold text-zinc-900">{cust.name}</td>
                                    <td className="px-4 py-2 font-medium">
                                      <span className="bg-zinc-100 text-zinc-700 px-1.5 py-0.5 rounded text-[10px] font-semibold">{cust.implementationType || "LOCATOR"}</span>
                                    </td>
                                    <td className="px-4 py-2 font-medium text-zinc-600">{salesRep}</td>
                                    <td className="px-4 py-2">{cust.contactName || "—"}</td>
                                    <td className="px-4 py-2 whitespace-nowrap">{cust.phone || "—"}</td>
                                    <td className="px-4 py-2 font-mono text-zinc-600 font-medium">{locatorUsername}</td>
                                    <td className="px-4 py-2">
                                      <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase">
                                        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                                        {locatorStatus}
                                      </span>
                                    </td>
                                    <td className="px-4 py-2 font-bold text-zinc-800 font-mono text-center">{cust.vehicleCount || 0}</td>
                                    <td className="px-4 py-1.5 text-center">
                                      <button 
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleSelectCustomer(cust);
                                        }}
                                        className="bg-[#00ADC6] hover:opacity-90 text-white font-bold text-[9px] px-2 py-1 rounded shadow-sm uppercase tracking-wide cursor-pointer"
                                      >
                                        Populate
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

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
                       <div className="col-span-2 space-y-1 relative">
                          <label className="text-[10px] text-zinc-500 flex items-center gap-0.5">Customer Name: <span className="text-red-500">*</span></label>
                          <input 
                            required 
                            type="text" 
                            placeholder="Customer Name" 
                            value={leadForm.customerName || ""} 
                            onChange={e => {
                              setLeadForm({...leadForm, customerName: e.target.value});
                              setShowSuggestions(true);
                            }}
                            onFocus={() => setShowSuggestions(true)}
                            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                            className="w-full bg-white border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none" 
                          />
                          {showSuggestions && leadForm.customerName && (
                            (() => {
                              const list = data.customers.filter(c => c.name.toLowerCase().includes(leadForm.customerName!.toLowerCase()));
                              if (list.length === 0) return null;
                              return (
                                <div className="absolute left-0 right-0 z-50 bg-white border border-[#E2E8F0] rounded shadow-lg max-h-48 overflow-y-auto mt-1 divide-y divide-zinc-100">
                                  {list.map(cust => (
                                    <div
                                      key={`suggest-${cust.id}`}
                                      onMouseDown={() => {
                                        setLeadForm(prev => ({
                                          ...prev,
                                          customerName: cust.name,
                                          contactName: cust.contactName || prev.contactName || "",
                                          phone: cust.phone || prev.phone || "",
                                          email: cust.email || prev.email || "",
                                          region: cust.region || prev.region || ""
                                        }));
                                        setShowSuggestions(false);
                                      }}
                                      className="px-3 py-2 text-[11px] text-zinc-700 hover:bg-teal-50/70 cursor-pointer transition-colors"
                                    >
                                      <div className="font-bold text-zinc-950 flex items-center justify-between">
                                        <span>{cust.name}</span>
                                        <span className="text-[8px] bg-zinc-100 font-bold px-1 py-0.5 rounded text-zinc-500 font-mono">Existing</span>
                                      </div>
                                      {cust.contactName && (
                                        <div className="text-[9px] text-zinc-500 mt-0.5">Contact: {cust.contactName} ({cust.phone || "No phone"})</div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              );
                            })()
                          )}
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
                          {requestedPeopleList.map(p => <option key={p} value={p}>{p}</option>)}
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

            {activeTab === "overview" && (() => {
              const regs = data.registrations || [];
              const svcs = data.services || [];
              const custs = data.customers || [];

              // 1. Value Aggregates
              let totalProjectValue = 0;
              let wonProjectValue = 0;
              let pipelineValue = 0;

              regs.forEach(reg => {
                const val = parseFloat(reg.projectValue || "0") || 0;
                totalProjectValue += val;
                if (reg.status === "Completed" || reg.status === "Won" || reg.status === "Approved") {
                  wonProjectValue += val;
                } else if (reg.status !== "Lost" && reg.status !== "Deleted") {
                  pipelineValue += val;
                }
              });

              // 2. Unit quantities
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

              // 3. Region Stats
              const regionMap: Record<string, { count: number, value: number }> = {};
              REGIONS.forEach(r => {
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

              // 4. Sales Representative Performance Leaderboard
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
                .slice(0, 5); // top 5 sales reps

              // 5. Status distribution
              const statusCounts: Record<string, number> = {};
              regs.forEach(reg => {
                const st = reg.status || "New Lead";
                statusCounts[st] = (statusCounts[st] || 0) + 1;
              });

              // 6. Service Ticket distribution
              const pendingServicesCount = svcs.filter(s => s.status !== "Completed" && s.status !== "Solved").length;
              const totalLeads = regs.length;

              // Formatting money
              const formatCurrency = (val: number) => {
                if (val >= 1_000_000) {
                  return `AED ${(val / 1_000_000).toFixed(2)}M`;
                }
                if (val >= 1_000) {
                  return `AED ${(val / 1_000).toFixed(1)}K`;
                }
                return `AED ${val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
              };

              const safePercent = (part: number, total: number) => {
                if (total <= 0) return 0;
                return Math.round((part / total) * 100);
              };

              return (
                <motion.div 
                  key="overview"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-8 pb-10"
                >
                  {/* Database Connection Warning / Troubleshooting Diagnostics */}
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
                          onClick={() => setShowDiagnostics(!showDiagnostics)}
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

                  {/* Top Stats Cards Grid */}
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

                  {/* Main Charts & Analytics Grid */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                     {/* Left Columns Container (Span 2) */}
                     <div className="lg:col-span-2 space-y-6">
                        
                        {/* Device Types Stacked Allocation and Region breakdown */}
                        <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm space-y-6">
                          <div>
                            <h3 className="font-bold text-zinc-950 text-sm tracking-tight flex items-center gap-2">
                              <Database className="text-teal-accent" size={16} />
                              Units Allocation by Tracker Configuration
                            </h3>
                            <p className="text-zinc-500 text-[11px] mt-0.5">Distribution map of {totalRegisteredUnits} trackers requested across all active sales cycles.</p>
                          </div>

                          {/* Combined Multi-Color Progress Indicator */}
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

                          {/* Legends Grid */}
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

                        {/* Recent Activity Logs Feed from CRM */}
                        <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm space-y-6">
                           <div className="flex items-center justify-between">
                              <div>
                                <h3 className="font-bold text-zinc-950 text-sm tracking-tight flex items-center gap-2">
                                  <Clock size={16} className="text-teal-accent" />
                                  Real-Time Activity Feed {searchTerm && <span className="text-xs font-normal text-zinc-400 font-sans">(Filtered)</span>}
                                </h3>
                                <p className="text-zinc-500 text-[11px] mt-0.5">Showing recent registrations and updates. Click to view or edit form.</p>
                              </div>
                           </div>
                           
                           <div className="grid gap-3">
                             {filteredRegistrations.length === 0 ? (
                               <div className="border border-dashed border-zinc-200 rounded-xl p-16 text-center text-zinc-400 text-xs">
                                 {searchTerm ? "No matching saved leads found." : "No recent activity logs found."}
                               </div>
                             ) : (
                               (() => {
                                 const sorted = [...filteredRegistrations].reverse();
                                 const visible = showAllFeed ? sorted : sorted.slice(0, 5);
                                 return (
                                   <>
                                     {visible.map((reg, idx) => (
                                       <div 
                                         key={`dash-reg-${reg.id || idx}-${idx}`} 
                                         onClick={() => {
                                           setSelectedLeadId(reg.id);
                                           setActiveTab("existing-form");
                                         }}
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
                                          <div className="text-right shrink-0">
                                             <div className="text-[10px] font-bold text-zinc-900">Registered By</div>
                                             <p className="text-[9px] text-zinc-400 font-semibold mt-1 uppercase tracking-wider">
                                               {reg.salesPerson || reg.requestedPerson || "Staff"}
                                             </p>
                                          </div>
                                       </div>
                                     ))}
                                     {filteredRegistrations.length > 5 && (
                                       <button 
                                         onClick={(e) => {
                                           e.stopPropagation();
                                           setShowAllFeed(!showAllFeed);
                                         }}
                                         className="w-full py-2.5 border border-dashed border-zinc-200 hover:border-teal-accent/40 rounded-xl text-[10px] font-extrabold uppercase tracking-wider text-zinc-500 hover:text-teal-accent transition-all text-center mt-2"
                                       >
                                         {showAllFeed ? "Collapse Activity Feed" : `View All Saved Logs (${filteredRegistrations.length})`}
                                       </button>
                                     )}
                                   </>
                                 );
                               })()
                             )}
                           </div>
                        </div>
                     </div>

                     {/* Right columns container (leaderboards, geographical splits) */}
                     <div className="space-y-6">
                        {/* Region breakdown progress lists */}
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

                        {/* Top Sales Representatives Leaders */}
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
            })()}



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
                  <div className="text-[11px] font-medium text-zinc-650 flex items-center gap-2">
                    Existing Form - {new Date().toLocaleDateString('en-GB').replace(/\//g, '-')}
                  </div>
                  <div className="flex items-center gap-4 text-zinc-400">
                    <Minus size={14} className="hover:text-zinc-600 cursor-pointer" />
                    <Square size={10} className="hover:text-zinc-600 cursor-pointer" />
                    <X size={14} className="hover:text-red-500 cursor-pointer" onClick={() => setActiveTab("new-form")} />
                  </div>
                </div>

                <div className="p-8 space-y-6 flex-1 overflow-y-auto bg-[#F8FAFC]">
                  {searchTerm && (
                    <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden shadow-md mb-6">
                      <div className="bg-[#00ADC6]/5 border-b border-[#00ADC6]/10 px-4 py-2.5 flex items-center justify-between">
                        <span className="text-[11px] font-bold text-[#00ADC6] flex items-center gap-1.5 uppercase tracking-wider">
                          <Search size={12} /> Matched Customer Accounts For "{searchTerm}"
                        </span>
                        <span className="text-[10px] font-mono text-zinc-500 font-bold">{filteredCustomers.length} Found</span>
                      </div>
                      {filteredCustomers.length === 0 ? (
                        <div className="p-6 text-center text-xs text-zinc-400">
                          No matched customer accounts found. Submit form below to create a new one.
                        </div>
                      ) : (
                        <div className="overflow-x-auto max-h-48 scrollbar-thin">
                          <table className="w-full text-left text-[11px]">
                            <thead className="bg-[#F8FAFC] border-b border-zinc-200 text-zinc-500 uppercase text-[9px] tracking-wider font-bold">
                              <tr>
                                <th className="px-4 py-2 bg-zinc-50">Customer Name</th>
                                <th className="px-4 py-2 bg-zinc-50">Implementation Type</th>
                                <th className="px-4 py-2 bg-zinc-50">Sales Person</th>
                                <th className="px-4 py-2 bg-zinc-50">Contact Name</th>
                                <th className="px-4 py-2 bg-zinc-50">Phone</th>
                                <th className="px-4 py-2 bg-zinc-50">Locator Username</th>
                                <th className="px-4 py-2 bg-zinc-50">Locator Status</th>
                                <th className="px-4 py-2 bg-zinc-50 text-center">Vehicle Count</th>
                                <th className="px-4 py-2 text-center bg-zinc-50">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 text-zinc-650">
                              {filteredCustomers.map(cust => {
                                const latestRequest = [...data.registrations].reverse().find(r => r.customerName.toLowerCase() === cust.name.toLowerCase());
                                const salesRep = latestRequest?.salesPerson || latestRequest?.requestedPerson || "Shams";
                                const locatorUsername = cust.name ? cust.name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) : "temco";
                                const locatorStatus = "active";

                                return (
                                  <tr key={cust.id} className="hover:bg-teal-50/40 hover:text-zinc-950 transition-colors cursor-pointer" onClick={() => handleSelectCustomer(cust)}>
                                    <td className="px-4 py-2 font-bold text-zinc-900">{cust.name}</td>
                                    <td className="px-4 py-2 font-medium">
                                      <span className="bg-zinc-100 text-zinc-700 px-1.5 py-0.5 rounded text-[10px] font-semibold">{cust.implementationType || "LOCATOR"}</span>
                                    </td>
                                    <td className="px-4 py-2 font-medium text-zinc-600">{salesRep}</td>
                                    <td className="px-4 py-2">{cust.contactName || "—"}</td>
                                    <td className="px-4 py-2 whitespace-nowrap">{cust.phone || "—"}</td>
                                    <td className="px-4 py-2 font-mono text-zinc-600 font-medium">{locatorUsername}</td>
                                    <td className="px-4 py-2">
                                      <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase">
                                        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                                        {locatorStatus}
                                      </span>
                                    </td>
                                    <td className="px-4 py-2 font-bold text-zinc-800 font-mono text-center">{cust.vehicleCount || 0}</td>
                                    <td className="px-4 py-1.5 text-center">
                                      <button 
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleSelectCustomer(cust);
                                        }}
                                        className="bg-[#00ADC6] hover:opacity-90 text-white font-bold text-[9px] px-2 py-1 rounded shadow-sm uppercase tracking-wide cursor-pointer"
                                      >
                                        Load Lead
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Operational Target Status Banner */}
                  <div className="mb-4">
                    {selectedLeadId ? (
                      <div className="bg-amber-50 border border-amber-200/50 rounded-xl p-3 flex items-center justify-between text-[11px] text-amber-800">
                        <div className="flex items-center gap-2">
                          <span className="flex h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                          <span>✏️ <strong>Editing Mode:</strong> You are editing lead <strong>ID #{selectedLeadId} ({leadForm.customerName})</strong>. Submitting will execute a direct database <code>PUT</code> update.</span>
                        </div>
                        <button type="button" onClick={resetLeadForm} className="font-bold underline uppercase tracking-tighter text-[9px] hover:text-amber-900">Switch to Create New</button>
                      </div>
                    ) : leadForm.customerName ? (
                      <div className="bg-teal-50 border border-teal-200/50 rounded-xl p-3 text-[11px] text-teal-800 flex items-center gap-2">
                        <span className="flex h-2 w-2 rounded-full bg-[#00ADC6]" />
                        <span>➕ <strong>Create New Lead Mode:</strong> Registering a new lead for customer <strong>{leadForm.customerName}</strong>. Submitting will execute a database <code>POST</code> insert.</span>
                      </div>
                    ) : null}
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
                      <div className="col-span-2 space-y-1 relative">
                        <label className="text-[10px] text-zinc-500 flex items-center gap-0.5">Customer Name: <span className="text-red-500">*</span></label>
                        <input 
                          disabled={!!selectedLeadId}
                          required 
                          type="text" 
                          placeholder="Customer Name" 
                          value={leadForm.customerName || ""} 
                          onChange={e => {
                            setLeadForm({...leadForm, customerName: e.target.value});
                            setShowExistingSuggestions(true);
                          }}
                          onFocus={() => setShowExistingSuggestions(true)}
                          onBlur={() => setTimeout(() => setShowExistingSuggestions(false), 200)}
                          className="w-full disabled:bg-[#E2E8F0]/50 disabled:text-zinc-500 disabled:cursor-not-allowed bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none" 
                        />
                        {showExistingSuggestions && leadForm.customerName && (
                          (() => {
                            const list = data.customers.filter(c => c.name.toLowerCase().includes(leadForm.customerName!.toLowerCase()));
                            if (list.length === 0) return null;
                            return (
                              <div className="absolute left-0 right-0 z-50 bg-white border border-[#E2E8F0] rounded shadow-lg max-h-48 overflow-y-auto mt-1 divide-y divide-zinc-100">
                                {list.map(cust => (
                                  <div
                                    key={`exist-suggest-${cust.id}`}
                                    onMouseDown={() => {
                                      setLeadForm(prev => ({
                                        ...prev,
                                        customerName: cust.name,
                                        contactName: cust.contactName || prev.contactName || "",
                                        phone: cust.phone || prev.phone || "",
                                        email: cust.email || prev.email || "",
                                        region: cust.region || prev.region || ""
                                      }));
                                      setShowExistingSuggestions(false);
                                    }}
                                    className="px-3 py-2 text-[11px] text-zinc-700 hover:bg-teal-50/70 cursor-pointer transition-colors"
                                  >
                                    <div className="font-bold text-zinc-950 flex items-center justify-between">
                                      <span>{cust.name}</span>
                                      <span className="text-[8px] bg-zinc-100 font-bold px-1 py-0.5 rounded text-zinc-500 font-mono">Existing</span>
                                    </div>
                                    {cust.contactName && (
                                      <div className="text-[9px] text-zinc-500 mt-0.5">Contact: {cust.contactName} ({cust.phone || "No phone"})</div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            );
                          })()
                        )}
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-zinc-500 flex items-center gap-0.5">Contact Name: <span className="text-red-500">*</span></label>
                        <input 
                          disabled={!!selectedLeadId}
                          required 
                          type="text" 
                          placeholder="Contact Name" 
                          value={leadForm.contactName || ""} 
                          onChange={e => setLeadForm({...leadForm, contactName: e.target.value})} 
                          className="w-full disabled:bg-[#E2E8F0]/50 disabled:text-zinc-500 disabled:cursor-not-allowed bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none" 
                        />
                        {selectedLeadId && (
                          <div className="text-[8px] text-amber-600 font-bold leading-tight mt-1">
                            ⚠️ Names locked. Mention changes in comments.
                          </div>
                        )}
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
                          {requestedPeopleList.map(p => <option key={p} value={p}>{p}</option>)}
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

                    <div className="flex justify-end gap-3 pt-4">
                      <button 
                        type="button"
                        onClick={resetLeadForm}
                        className="border border-zinc-200 text-zinc-550 px-6 py-2 rounded font-bold text-[10px] uppercase tracking-widest hover:bg-zinc-50 transition-all flex items-center justify-center gap-1.5"
                      >
                        <X size={12} /> Clear Form
                      </button>
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
                <ChatInterface 
                  onNewStaffDetected={(name) => {
                    if (!requestedPeopleList.some(p => p.toLowerCase() === name.toLowerCase())) {
                      setPendingStaffName(name);
                    }
                  }}
                  onRecordSaved={(savedRecord) => {
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
                      requestedPerson: findOptionMatch(savedRecord.requestedPerson, requestedPeopleList),
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
                    if (savedRecord.id) {
                      setSelectedLeadId(savedRecord.id);
                    }
                    showToast(`AI Auto-Saved: Lead "${savedRecord.customerName}" successfully logged into CRM!`, "success");
                  } else if (savedRecord && savedRecord.type === "service") {
                    showToast(`AI Auto-Saved: Service Ticket for "${savedRecord.customerName}" logged!`, "success");
                  }
                }} />
              </motion.div>
            )}


          </AnimatePresence>
        </div>
      </main>

      {/* Visual Edit Modal */}
      {editingItem && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-zinc-950/40 backdrop-blur-sm" onClick={() => setEditingItem(null)} />
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden z-10 flex flex-col max-h-[85vh]"
          >
            <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between bg-zinc-50">
              <h3 className="font-extrabold text-zinc-900 text-xs uppercase tracking-wider flex items-center gap-2">
                <Database size={14} className="text-teal-accent" /> Edit {editingItem.type === 'lead' ? 'Lead Registration' : editingItem.type === 'service' ? 'Service Ticket' : 'Customer Account'}
              </h3>
              <button onClick={() => setEditingItem(null)} className="p-1.5 hover:bg-zinc-250 rounded-lg text-zinc-400">
                <X size={16} />
              </button>
            </div>
            
            <form onSubmit={async (e) => {
              e.preventDefault();
              try {
                if (editingItem.type === 'lead') {
                  await axios.put(`/api/leads/${editingItem.data.id}`, editingItem.data);
                } else if (editingItem.type === 'service') {
                  await axios.put(`/api/services/${editingItem.data.id}`, editingItem.data);
                } else {
                  await axios.put(`/api/customers/${editingItem.data.id}`, editingItem.data);
                }
                setEditingItem(null);
                fetchData();
              } catch (err: any) {
                alert("Failed to update: " + err.message);
              }
            }} className="p-6 overflow-y-auto space-y-4 text-xs">
              
              {editingItem.type === 'lead' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Customer Name</label>
                    <input type="text" required value={editingItem.data.customerName || ""} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, customerName: e.target.value}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs font-semibold" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Contact Name</label>
                    <input type="text" value={editingItem.data.contactName || ""} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, contactName: e.target.value}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs font-semibold" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Phone</label>
                    <input type="text" value={editingItem.data.phone || ""} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, phone: e.target.value}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs font-semibold" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Email</label>
                    <input type="email" value={editingItem.data.email || ""} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, email: e.target.value}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs font-semibold" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Region</label>
                    <select value={editingItem.data.region || ""} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, region: e.target.value}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs font-semibold">
                      {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Status</label>
                    <select value={editingItem.data.status || ""} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, status: e.target.value}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs font-semibold">
                      {LEAD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Implementation Type</label>
                    <select value={editingItem.data.implementationType || ""} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, implementationType: e.target.value}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs font-semibold">
                      {IMPLEMENTATION_TYPES.map(i => <option key={i} value={i}>{i}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Sales Person</label>
                    <select value={editingItem.data.salesPerson || ""} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, salesPerson: e.target.value}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs font-semibold">
                      {SALES_PEOPLE.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">New Qty</label>
                    <input type="number" value={editingItem.data.newQty || 0} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, newQty: parseInt(e.target.value || '0')}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs font-semibold" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Migrate Qty</label>
                    <input type="number" value={editingItem.data.migrateQty || 0} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, migrateQty: parseInt(e.target.value || '0')}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs font-semibold" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Comment</label>
                    <textarea rows={2} value={editingItem.data.comment || ""} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, comment: e.target.value}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-3 text-xs font-semibold" />
                  </div>
                </div>
              )}

              {editingItem.type === 'service' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Customer Name</label>
                    <input type="text" required value={editingItem.data.customerName || ""} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, customerName: e.target.value}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs font-semibold" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Status</label>
                    <select value={editingItem.data.status || "New"} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, status: e.target.value}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs font-semibold">
                      {TICKET_STATUSES.map(ts => <option key={ts} value={ts}>{ts}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Qty</label>
                    <input type="number" value={editingItem.data.quantity || 1} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, quantity: parseInt(e.target.value || '1')}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs font-semibold" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Payment Option</label>
                    <select value={editingItem.data.payment || ""} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, payment: e.target.value}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs font-semibold">
                      {PAYMENT_OPTIONS.map(po => <option key={po} value={po}>{po}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Assignee</label>
                    <input type="text" value={editingItem.data.assignee || ""} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, assignee: e.target.value}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs font-semibold" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Amount (AED)</label>
                    <input type="text" value={editingItem.data.amount || ""} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, amount: e.target.value}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs font-semibold" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Description</label>
                    <textarea rows={3} value={editingItem.data.description || ""} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, description: e.target.value}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-3 text-xs font-semibold" />
                  </div>
                </div>
              )}

              {editingItem.type === 'customer' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Company Name</label>
                    <input type="text" required value={editingItem.data.name || ""} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, name: e.target.value}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs font-semibold" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Contact Name</label>
                    <input type="text" value={editingItem.data.contactName || ""} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, contactName: e.target.value}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs font-semibold" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Phone</label>
                    <input type="text" value={editingItem.data.phone || ""} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, phone: e.target.value}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs font-semibold" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Email</label>
                    <input type="email" value={editingItem.data.email || ""} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, email: e.target.value}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs font-semibold" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Region</label>
                    <input type="text" value={editingItem.data.region || ""} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, region: e.target.value}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs font-semibold" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Vehicle Count</label>
                    <input type="number" value={editingItem.data.vehicleCount || 0} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, vehicleCount: parseInt(e.target.value || '0')}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs font-semibold" />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-zinc-100">
                <button type="button" onClick={() => setEditingItem(null)} className="px-4 py-2 border border-zinc-200 rounded-lg text-zinc-500 font-bold text-[10px] uppercase hover:bg-zinc-50">Cancel</button>
                <button type="submit" className="px-6 py-2 bg-teal-accent text-white rounded-lg font-bold text-[10px] uppercase hover:opacity-95 shadow-md shadow-teal-accent/10">Save Changes</button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Dynamic Staff Registration Confirmation Modal */}
      {pendingStaffName && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-zinc-950/40 backdrop-blur-sm" onClick={() => setPendingStaffName(null)} />
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 border border-zinc-100 z-10"
          >
            <div className="flex items-center gap-3 text-[#0EA5E9] mb-4">
              <div className="w-10 h-10 rounded-full bg-sky-50 flex items-center justify-center">
                <Zap size={20} className="text-[#0EA5E9]" />
              </div>
              <h3 className="text-lg font-bold text-zinc-900">New Staff Coordinator Detected</h3>
            </div>
            
            <p className="text-xs text-zinc-600 mb-6 leading-relaxed">
              We detected a self-introduction from <strong className="text-zinc-900 font-semibold">{pendingStaffName}</strong> in the conversation.
              Would you like to register them as a new SynoHub Fleet Coordinator, update all CRM dropdown forms with their name, and default newly drafted lead registrations or service tickets to them as the Requested Person?
            </p>

            <div className="flex gap-3 justify-end text-[11px]">
              <button 
                type="button"
                onClick={() => {
                  const name = pendingStaffName;
                  setPendingStaffName(null);
                  showToast(`Registration cancelled for "${name}".`, "error");
                }}
                className="px-4 py-2 border border-zinc-200 hover:bg-zinc-50 rounded-lg font-bold text-zinc-600 transition"
              >
                No, Cancel
              </button>
              <button 
                type="button"
                onClick={() => {
                  const name = pendingStaffName;
                  setPendingStaffName(null);
                  
                  // Dynamically register in list
                  setRequestedPeopleList(prev => {
                    if (!prev.some(p => p.toLowerCase() === name.toLowerCase())) {
                      return [...prev, name];
                    }
                    return prev;
                  });

                  // Defaults subsequent lead registrations or service tickets to them as the Requested Person
                  setDefaultRequestedPerson(name);
                  
                  // Pre-populate actual forms
                  setLeadForm(prev => ({ ...prev, requestedPerson: name }));
                  setTicketForm(prev => ({ ...prev, requestedPerson: name }));

                  showToast(`"${name}" is now dynamically registered and set as your session default coordinator!`, "success");
                }}
                className="px-4 py-2 bg-[#0EA5E9] hover:bg-[#0284C7] text-white rounded-lg font-bold shadow-sm transition"
              >
                Yes, Register Coordinator
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

