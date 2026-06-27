import React, { useState, useEffect, useRef } from "react";
import { LayoutDashboard, Plus, Phone, Activity, Zap, Database, Sparkles, CheckCircle2, Minus, Square, X, ClipboardList } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "./lib/utils";
import { createGuestSession } from "./frontend/api/authApi";
import { fetchChatHistory, sendChatMessage, sendSafeQuery } from "./frontend/api/chatApi";
import { updateCustomer } from "./frontend/api/customerApi";
import { fetchDashboardData } from "./frontend/api/dashboardApi";
import { createLead, createServiceRequest, updateLead, updateServiceRequest } from "./frontend/api/serviceRequestApi";
import { AppLayout } from "./frontend/components/AppLayout";
import { Header } from "./frontend/components/Header";
import { Sidebar } from "./frontend/components/Sidebar";
import { ChatPage, type CompareProvider, type SafeQueryAiMode } from "./frontend/pages/ChatPage";
import { CustomersPage } from "./frontend/pages/CustomersPage";
import { DashboardPage } from "./frontend/pages/DashboardPage";
import { LoginPage } from "./frontend/pages/LoginPage";
import { ServiceRequestsPage } from "./frontend/pages/ServiceRequestsPage";

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

const isValidStoredUser = (value: any): value is { name: string; role: string; token: string } => {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof value.name === "string" &&
    typeof value.role === "string" &&
    typeof value.token === "string" &&
    value.token.length > 0 &&
    (value.role === "admin" || value.role === "staff" || value.role === "guest")
  );
};

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
  username?: string;
}

const normalizeQueryText = (text: string) => {
  return text
    .toLowerCase()
    .replace(/\b(pednig|pendng|pendig|penidng|pendign|pendingg)\b/g, "pending")
    .replace(/\b(recrds|recrd|reocrds|recrods|recods)\b/g, "records")
    .replace(/\b(acount|accout|accoount)\b/g, "account");
};

const isSafeQueryMessage = (text: string) => {
  const normalized = normalizeQueryText(text).trim();
  if (/\b(update|assign|reassign|re-assign|cancel|delete|create|mark|change)\b/.test(normalized) || /^new\s+lead\b/.test(normalized)) return false;
  if (/^(show|list|view)$/.test(normalized)) return true;
  if (/\bpending\b/.test(normalized) && /\b(my|list|account|ticket|tickets|request|requests|lead|leads|queue)\b/.test(normalized)) return true;
  if (/\b(pending|open|active|ongoing|unresolved)\b/.test(normalized) && !/\b(create|register|add|new|save|file)\b/.test(normalized)) return true;
  if (/\b(today|today's|todays)\b/.test(normalized) && /\b(record|records|ticket|tickets|request|requests|lead|leads|job|jobs|task|tasks|work|worklist)\b/.test(normalized)) return true;
  if (/\b(migration|migrations|migrate)\b/.test(normalized) && /\b(show|list|view|get|find|how\s+many|count|total|ticket|tickets|request|requests|job|jobs|task|tasks|there)\b/.test(normalized)) return true;
  if (/\b(find|show|view|get|search)\b/.test(normalized) && /\b(ticket|request)\b.*\b(id|number|#)?\s*\d+\b/.test(normalized)) return true;
  if (/\b(need|needs|requiring|require|requires)\s+attention\b/.test(normalized) || /\battention\s+(ticket|tickets|request|requests|queue)\b/.test(normalized)) return true;
  if (/\b(unassigned|free\s+today|available|overload|overloaded|balance|rebalance|workload\s+analysis)\b/.test(normalized)) return true;
  if (/\b(customer\s+profile|customer\s+details|last\s+request|last\s+service|recent\s+activity|open\s+(tickets|jobs)|tickets\s+for|jobs\s+for)\b/.test(normalized)) return true;
  if (/\b(no\s+connection|ignition|battery\s+low|battery\s+issues?|tracker\s+not\s+working|offline|sim\s+replacement|recurring\s+faults?|vehicle\s+history|device\s+history|migration\s+history|reinstallation|installation\s+history|common\s+issues?)\b/.test(normalized)) return true;
  if (/\b(sla|alerts?|trend\s+analysis|queue\s+snapshot|operational\s+dashboard|service\s+statistics|full\s+overview|overall\s+fleet\s+status|recommended\s+actions|high\s+priority\s+customers)\b/.test(normalized)) return true;
  if (/\b(customer|account|company)\b/.test(normalized) && /\b(exist|exists|available|registered|present|in\s+(?:our\s+)?database)\b/.test(normalized)) return true;
  const mentionsStaff = REQUESTED_PEOPLE.some(name => new RegExp(`\\b${name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(normalized));
  if (mentionsStaff && /\b(record|records|ticket|tickets|request|requests|lead|leads|job|jobs|task|tasks|workload|working\s+on|assigned)\b/.test(normalized)) return true;
  if (/\b(total|count|how\s+many|overall)\b/.test(normalized) && /\b(record|records|ticket|tickets|request|requests|lead|leads|job|jobs|task|tasks|customer|customers|database|crm|system)\b/.test(normalized)) return true;
  const hasQueryAction = /\b(show|list|view|find|get|search|latest|recent|last|pending|open|completed|closed|history|summary|workload|duplicate|highest|lowest|total|count|attention)\b/.test(normalized);
  const hasQueryObject = /\b(ticket|tickets|request|requests|lead|leads|record|records|job|jobs|task|tasks|migration|migrations|migrate|customer|customers|account|company|staff|technician|region|status|dashboard|chat|messages|fleet|vehicle|vehicles|device|devices|issue|issues|fault|faults|phone|email|database|crm|system)\b/.test(normalized);
  return hasQueryAction && hasQueryObject;
};

const ChatInterface = ({ onRecordSaved, onNewStaffDetected, forcedInput, onInputLoaded, userKey, currentUser, staffOptions = REQUESTED_PEOPLE }: { onRecordSaved?: (savedRecord?: any) => void, onNewStaffDetected?: (name: string) => void, forcedInput?: string, onInputLoaded?: () => void, userKey?: string, currentUser?: { name: string; role: string; token: string } | null, staffOptions?: string[] }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeChatScopeRef = useRef("");
  const historyRequestRef = useRef(0);
  const [selectedChatTarget, setSelectedChatTarget] = useState("admin");
  const [aiMode, setAiMode] = useState<SafeQueryAiMode>("local");
  const [compareProviders, setCompareProviders] = useState<CompareProvider[]>(["gemini", "local"]);
  const isAdminViewingOtherChat = currentUser?.role === "admin" && selectedChatTarget !== "admin";
  const chatScopeKey = `${userKey || ""}|${currentUser?.role || ""}|${selectedChatTarget}|${aiMode}`;

  const getBaseChatChannel = (target: string) => {
    if (!currentUser) return "";
    if (currentUser.role === "admin") return target || "admin";
    if (currentUser.role === "staff") return `staff:${currentUser.name.trim()}`;
    return `guest:${currentUser.name.trim().toLowerCase()}`;
  };

  const getModeChatChannel = (mode: SafeQueryAiMode, target = selectedChatTarget) => {
    const channelMode = mode === "gpt-oss" ? "nvidia" : mode === "cohere" ? "openrouter" : mode;
    return `${getBaseChatChannel(target)}|ai:${channelMode}`;
  };

  const filterModeMessages = (items: Message[], mode: SafeQueryAiMode, target: string) => {
    const expectedChannel = getModeChatChannel(mode, target);
    return items.filter(item => !item.username || item.username === expectedChannel);
  };

  const toggleCompareProvider = (provider: CompareProvider) => {
    setCompareProviders(prev => {
      if (prev.includes(provider)) {
        const next = prev.filter(item => item !== provider);
        return next.length > 0 ? next : prev;
      }
      return [...prev, provider];
    });
  };

  useEffect(() => {
    activeChatScopeRef.current = chatScopeKey;
    setMessages([]);
    fetchHistory(chatScopeKey, aiMode, selectedChatTarget, currentUser?.role);
  }, [chatScopeKey, aiMode, selectedChatTarget, currentUser?.role]);

  useEffect(() => {
    if (currentUser?.role !== "admin") return;
    setSelectedChatTarget("admin");
  }, [currentUser?.role]);

  useEffect(() => {
    if (forcedInput) {
      setInput(forcedInput);
      if (onInputLoaded) onInputLoaded();
    }
  }, [forcedInput, onInputLoaded]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const fetchHistory = async (
    scopeKey: string,
    mode: SafeQueryAiMode,
    target: string,
    role?: string,
  ) => {
    const requestId = historyRequestRef.current + 1;
    historyRequestRef.current = requestId;
    try {
      const history = await fetchChatHistory({
        ...(role === "admin" ? { target } : {}),
        aiMode: mode,
        cacheBust: Date.now(),
      });
      if (historyRequestRef.current !== requestId || activeChatScopeRef.current !== scopeKey) return;
      setMessages(filterModeMessages(Array.isArray(history) ? history : [], mode, target));
    } catch (e) {
      console.error("Failed to fetch chat history", e);
    }
  };

  const handleSend = async () => {
    if (isAdminViewingOtherChat) return;
    if (!input.trim() || loading) return;
    const userMsg = input;
    const messageChannel = getModeChatChannel(aiMode, selectedChatTarget);
    setInput("");
    setMessages(prev => [...prev, { role: 'user', content: userMsg, username: messageChannel }]);
    setLoading(true);
    const sendScopeKey = chatScopeKey;

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
      const useSafeQuery = isSafeQueryMessage(userMsg);
      const payload: any = { message: userMsg, aiMode };
      if (aiMode === "compare") {
        payload.compareProviders = compareProviders;
      }
      if (!useSafeQuery && currentUser?.role === "admin") {
        payload.selectedChatTarget = selectedChatTarget;
      }
      const res: any = useSafeQuery ? await sendSafeQuery(payload) : await sendChatMessage(payload);
      if (activeChatScopeRef.current !== sendScopeKey) return;
      setMessages(prev => [...prev, { role: 'assistant', content: res.answer || res.reply, username: messageChannel }]);
      if (res.savedRecord) {
        if (onRecordSaved) {
          onRecordSaved(res.savedRecord);
        }
        if (res.savedRecord.requestedPerson && onNewStaffDetected) {
          const p = res.savedRecord.requestedPerson.trim();
          const capitalized = p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
          onNewStaffDetected(capitalized);
        }
      }
    } catch (e) {
      if (activeChatScopeRef.current !== sendScopeKey) return;
      const errorMessage = (e as any)?.response?.data?.error || (e as Error).message || "I'm experiencing high traffic. Please try again in 30s.";
      setMessages(prev => [...prev, { role: 'assistant', content: errorMessage, username: messageChannel }]);
    } finally {
      setLoading(false);
    }
  };

  const handlePresetClick = async (promptText: string) => {
    if (isAdminViewingOtherChat) return;
    if (loading) return;
    const messageChannel = getModeChatChannel(aiMode, selectedChatTarget);
    setMessages(prev => [...prev, { role: 'user', content: promptText, username: messageChannel }]);
    setLoading(true);
    const sendScopeKey = chatScopeKey;

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
      const useSafeQuery = isSafeQueryMessage(promptText);
      const payload: any = { message: promptText, aiMode };
      if (aiMode === "compare") {
        payload.compareProviders = compareProviders;
      }
      if (!useSafeQuery && currentUser?.role === "admin") {
        payload.selectedChatTarget = selectedChatTarget;
      }
      const res: any = useSafeQuery ? await sendSafeQuery(payload) : await sendChatMessage(payload);
      if (activeChatScopeRef.current !== sendScopeKey) return;
      setMessages(prev => [...prev, { role: 'assistant', content: res.answer || res.reply, username: messageChannel }]);
      if (res.savedRecord) {
        if (onRecordSaved) {
          onRecordSaved(res.savedRecord);
        }
        if (res.savedRecord.requestedPerson && onNewStaffDetected) {
          const p = res.savedRecord.requestedPerson.trim();
          const capitalized = p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
          onNewStaffDetected(capitalized);
        }
      }
    } catch (e) {
      if (activeChatScopeRef.current !== sendScopeKey) return;
      const errorMessage = (e as any)?.response?.data?.error || (e as Error).message || "I'm experiencing high traffic. Please try again in 30s.";
      setMessages(prev => [...prev, { role: 'assistant', content: errorMessage, username: messageChannel }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ChatPage
      currentUser={currentUser ?? null}
      selectedChatTarget={selectedChatTarget}
      isAdminViewingOtherChat={isAdminViewingOtherChat}
      aiMode={aiMode}
      compareProviders={compareProviders}
      staffOptions={staffOptions}
      chatScopeKey={chatScopeKey}
      scrollRef={scrollRef}
      messages={messages}
      loading={loading}
      input={input}
      onAiModeChange={setAiMode}
      onToggleCompareProvider={toggleCompareProvider}
      onChatTargetChange={setSelectedChatTarget}
      onInputChange={setInput}
      onSend={handleSend}
    />
  );
};

class AppBoundary extends React.Component<any, any> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: any, errorInfo: any) {
    console.error("SynoHub layout crash caught:", error, errorInfo);
    try {
      localStorage.removeItem("synohub-user");
    } catch (e) {}
  }
  render() {
    const { children, fallback } = (this as any).props;
    if (this.state.hasError) {
      return fallback;
    }
    return children;
  }
}

export default function App() {
  const [user, setUser] = useState<{ name: string; role: string; token: string } | null>(() => {
    try {
      const saved = localStorage.getItem("synohub-user");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (isValidStoredUser(parsed)) {
          return parsed;
        } else {
          localStorage.removeItem("synohub-user");
        }
      }
    } catch (e) {
      try {
        localStorage.removeItem("synohub-user");
      } catch (err) {}
    }
    return null;
  });

  const [activeTab, setActiveTab ] = useState<string>(() => {
    try {
      const saved = localStorage.getItem("synohub-user");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (isValidStoredUser(parsed) && parsed.role !== "guest") {
          return "overview";
        }
      }
    } catch (e) {}
    return "new-form";
  });

  const [requestedPeopleList, setRequestedPeopleList] = useState<string[]>(REQUESTED_PEOPLE);
  const [defaultRequestedPerson, setDefaultRequestedPerson] = useState<string>("");
  const [pendingStaffName, setPendingStaffName] = useState<string | null>(null);
  const [prefilledChatPrompt, setPrefilledChatPrompt] = useState("");
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

  // Synchronize authenticated user credentials to form defaults
  useEffect(() => {
    if (user) {
      if (user.role === "staff") {
        setDefaultRequestedPerson(user.name);
        setLeadForm(prev => ({ ...prev, requestedPerson: user.name }));
        setTicketForm(prev => ({ ...prev, requestedPerson: user.name }));
      } else {
        setDefaultRequestedPerson("");
        setLeadForm(prev => ({ ...prev, requestedPerson: "" }));
        setTicketForm(prev => ({ ...prev, requestedPerson: "" }));
      }
    }
  }, [user]);

  useEffect(() => {
    const handleAuthExpired = () => {
      setUser(null);
      setActiveTab("new-form");
      setLoading(false);
    };
    window.addEventListener("synohub-auth-expired", handleAuthExpired);
    return () => window.removeEventListener("synohub-auth-expired", handleAuthExpired);
  }, []);

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
    if (selectedLeadId && data?.registrations && data.registrations.length > 0) {
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
        await updateLead(selectedLeadId, leadForm);
        showToast("Lead configuration updated in database and synchronized with Customers successfully!");
      } else {
        // Create brand-new lead registration in database
        await createLead(leadForm);
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
      const matchingReg = (data?.registrations || []).find(r => r && r.customerName && cust?.name && (r.customerName || '').toLowerCase() === (cust.name || '').toLowerCase());
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
      await createServiceRequest(ticketForm);
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
    if (!user) {
      setLoading(false);
      return;
    }
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [user?.token]);

  const fetchData = async () => {
    try {
      const res: any = await fetchDashboardData();
      setData({
        registrations: res && Array.isArray(res.registrations) ? res.registrations : [],
        services: res && Array.isArray(res.services) ? res.services : [],
        customers: res && Array.isArray(res.customers) ? res.customers : []
      });
      setDbError(null);

      // Extract dynamic requestedPerson and append to listed people if missing
      const dbRequestedPeople = new Set<string>();
      if (res?.registrations && Array.isArray(res.registrations)) {
        res.registrations.forEach((r: any) => {
          if (r?.requestedPerson && r.requestedPerson.trim()) {
            dbRequestedPeople.add(r.requestedPerson.trim());
          }
        });
      }
      if (res?.services && Array.isArray(res.services)) {
        res.services.forEach((s: any) => {
          if (s?.requestedPerson && s.requestedPerson.trim()) {
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
            if (capitalized && !merged.some(p => (p || '').toLowerCase() === capitalized.toLowerCase())) {
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

  const filteredRegistrations = (data?.registrations || []).filter(reg => {
    if (!reg) return false;
    const matchesSearch = ((reg.customerName || '').toLowerCase()).includes((searchTerm || '').toLowerCase()) || 
                          ((reg.contactName || '').toLowerCase()).includes((searchTerm || '').toLowerCase());
    const matchesRegion = filterRegion === "All" || reg.region === filterRegion;
    const matchesStatus = filterStatus === "All" || reg.status === filterStatus;
    return matchesSearch && matchesRegion && matchesStatus;
  });

  const filteredServices = (data?.services || []).filter(svc => {
    if (!svc) return false;
    const matchesSearch = ((svc.customerName || '').toLowerCase()).includes((searchTerm || '').toLowerCase()) || 
                          ((svc.ticketId || '').toLowerCase()).includes((searchTerm || '').toLowerCase());
    const matchesStatus = filterStatus === "All" || svc.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const filteredCustomers = (data?.customers || []).filter(cust => 
    cust && cust.name && ((cust.name || '').toLowerCase()).includes((searchTerm || '').toLowerCase())
  );


  const navItems = [
    { id: "overview", label: "Dashboard", icon: LayoutDashboard },
    { id: "new-form", label: "New Form", icon: Plus },
    { id: "existing-form", label: "Existing Form", icon: ClipboardList },
    { id: "ai", label: "SynoAI Chat", icon: Sparkles },
  ].filter(item => {
    if (!user) return false;
    if (user.role === "guest") {
      return item.id === "new-form" || item.id === "existing-form" || item.id === "ai";
    }
    return true;
  });

  if (!user) {
    return (
      <LoginPage
        onLoginSuccess={(loggedUser) => {
          localStorage.setItem("synohub-user", JSON.stringify(loggedUser));
          setUser(loggedUser);
          if (loggedUser.role === "guest") {
            setActiveTab("new-form");
          } else {
            setActiveTab("overview");
          }
          showToast(`Welcome back, ${loggedUser.name}!`);
        }} 
        onProceedAsGuest={async () => {
          const res: any = await createGuestSession();
          const guestUser = { name: res.name, role: res.role, token: res.token };
          localStorage.setItem("synohub-user", JSON.stringify(guestUser));
          setUser(guestUser);
          setActiveTab("new-form");
          showToast("Accessing as Public Guest. Data retrieval is secured.");
        }}
      />
    );
  }

  const handleLoginSuccessRecovery = (loggedUser: any) => {
    if (!isValidStoredUser(loggedUser)) {
      try {
        localStorage.removeItem("synohub-user");
      } catch (e) {}
      setUser(null);
      return;
    }
    try {
      localStorage.setItem("synohub-user", JSON.stringify(loggedUser));
    } catch (e) {}
    setUser(loggedUser);
    window.location.reload();
  };

  const handleProceedAsGuestRecovery = async () => {
    try {
      const res: any = await createGuestSession();
      const guestUser = { name: res.name, role: res.role, token: res.token };
      localStorage.setItem("synohub-user", JSON.stringify(guestUser));
      setUser(guestUser);
      window.location.reload();
    } catch (e) {
      console.error("Guest recovery failed", e);
    }
  };

  const errorFallback = (
    <LoginPage
      onLoginSuccess={handleLoginSuccessRecovery}
      onProceedAsGuest={handleProceedAsGuestRecovery}
    />
  );

  return (
    <AppBoundary fallback={errorFallback}>
      <AppLayout
        notification={
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
        }
        sidebar={
          <Sidebar
            activeTab={activeTab}
            navItems={navItems}
            user={user}
            onNavigate={(tabId) => {
              setActiveTab(tabId);
              setFilterStatus("All");
              setFilterRegion("All");
            }}
            onLogout={() => {
              localStorage.removeItem("synohub-user");
              setUser(null);
              showToast("Signed out successfully");
            }}
          />
        }
        header={
          <Header
            activeTab={activeTab}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
          />
        }
      >
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
                    <CustomersPage
                      searchTerm={searchTerm}
                      customers={filteredCustomers}
                      registrations={data?.registrations || []}
                      actionLabel="Populate"
                      onSelectCustomer={handleSelectCustomer}
                    />
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
                              const list = (data?.customers || []).filter(c => c && c.name && (c.name || '').toLowerCase().includes((leadForm.customerName || '').toLowerCase()));
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

            {activeTab === "overview" && (
              <DashboardPage
                registrations={data.registrations || []}
                services={data.services || []}
                filteredRegistrations={filteredRegistrations}
                searchTerm={searchTerm}
                dbError={dbError}
                showDiagnostics={showDiagnostics}
                showAllFeed={showAllFeed}
                regions={REGIONS}
                onToggleDiagnostics={() => setShowDiagnostics(!showDiagnostics)}
                onSelectLead={(leadId) => {
                  setSelectedLeadId(leadId);
                  setActiveTab("existing-form");
                }}
                onToggleShowAllFeed={() => setShowAllFeed(!showAllFeed)}
              />
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
                    <CustomersPage
                      searchTerm={searchTerm}
                      customers={filteredCustomers}
                      registrations={data?.registrations || []}
                      actionLabel="Load Lead"
                      onSelectCustomer={handleSelectCustomer}
                    />
                  )}

                  {/* Operational Target Status Banner */}
                  <div className="mb-4">
                    {selectedLeadId ? (
                      user?.role !== "admin" ? (
                        <div className="bg-rose-50 border border-rose-200/50 rounded-xl p-3 flex items-center justify-between text-[11px] text-rose-800">
                          <div className="flex items-center gap-2">
                            <span className="flex h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
                            <span>🔒 <strong>Read-Only Mode:</strong> You can view this authorized lead <strong>ID #{selectedLeadId} ({leadForm.customerName})</strong>, but edited submissions are restricted.</span>
                          </div>
                          <button type="button" onClick={resetLeadForm} className="font-bold underline uppercase tracking-tighter text-[9px] hover:text-rose-900">Switch to Create New</button>
                        </div>
                      ) : (
                        <div className="bg-amber-50 border border-amber-200/50 rounded-xl p-3 flex items-center justify-between text-[11px] text-amber-800">
                          <div className="flex items-center gap-2">
                            <span className="flex h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                            <span>✏️ <strong>Editing Mode:</strong> You are editing lead <strong>ID #{selectedLeadId} ({leadForm.customerName})</strong>. Submitting will execute a direct database <code>PUT</code> update.</span>
                          </div>
                          <button type="button" onClick={resetLeadForm} className="font-bold underline uppercase tracking-tighter text-[9px] hover:text-amber-900">Switch to Create New</button>
                        </div>
                      )
                    ) : leadForm.customerName ? (
                      <div className="bg-teal-50 border border-teal-200/50 rounded-xl p-3 text-[11px] text-teal-800 flex items-center gap-2">
                        <span className="flex h-2 w-2 rounded-full bg-[#00ADC6]" />
                        <span>➕ <strong>Create New Lead Mode:</strong> Registering a new lead for customer <strong>{leadForm.customerName}</strong>. Submitting will execute a database <code>POST</code> insert.</span>
                      </div>
                    ) : null}
                  </div>

                  <form onSubmit={handleLeadSubmit} className="space-y-4">
                    <fieldset disabled={user?.role !== "admin" && !!selectedLeadId} className="space-y-4 w-full border-none p-0 m-0">
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
                            const list = (data?.customers || []).filter(c => c && c.name && (c.name || '').toLowerCase().includes((leadForm.customerName || '').toLowerCase()));
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
                    </fieldset>

                    <div className="flex justify-end gap-3 pt-4">
                      <button 
                        type="button"
                        onClick={resetLeadForm}
                        className="border border-zinc-200 text-zinc-550 px-6 py-2 rounded font-bold text-[10px] uppercase tracking-widest hover:bg-zinc-50 transition-all flex items-center justify-center gap-1.5"
                      >
                        <X size={12} /> Clear Form
                      </button>
                      <button 
                        type="submit" 
                        disabled={user?.role !== "admin" && !!selectedLeadId}
                        className="bg-teal-accent disabled:bg-zinc-300 disabled:text-zinc-500 disabled:cursor-not-allowed text-white px-10 py-2 rounded font-bold text-[10px] uppercase tracking-widest shadow-lg shadow-teal-accent/10 hover:opacity-95 disabled:shadow-none transition-all cursor-pointer"
                      >
                        {user?.role !== "admin" && !!selectedLeadId ? "READ ONLY" : "SAVE"}
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
                  currentUser={user}
                  userKey={user ? `${user.role}:${user.name}` : "guest:guest"}
                  staffOptions={requestedPeopleList}
                  forcedInput={prefilledChatPrompt}
                  onInputLoaded={() => setPrefilledChatPrompt("")}
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
      </AppLayout>

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
              if (user?.role !== "admin") return;
              try {
                if (editingItem.type === 'lead') {
                  await updateLead(editingItem.data.id, editingItem.data);
                } else if (editingItem.type === 'service') {
                  await updateServiceRequest(editingItem.data.id, editingItem.data);
                } else {
                  await updateCustomer(editingItem.data.id, editingItem.data);
                }
                setEditingItem(null);
                fetchData();
              } catch (err: any) {
                alert("Failed to update: " + err.message);
              }
            }} className="p-6 overflow-y-auto space-y-4 text-xs">
              <fieldset disabled={user?.role !== "admin"} className="space-y-4 w-full border-none p-0 m-0">
              
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
                <ServiceRequestsPage
                  editingItem={editingItem}
                  setEditingItem={setEditingItem}
                  ticketStatuses={TICKET_STATUSES}
                  paymentOptions={PAYMENT_OPTIONS}
                />
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
              </fieldset>

              <div className="flex justify-end gap-3 pt-4 border-t border-zinc-100">
                <button type="button" onClick={() => setEditingItem(null)} className="px-4 py-2 border border-zinc-200 rounded-lg text-zinc-500 font-bold text-[10px] uppercase hover:bg-zinc-50">Cancel</button>
                <button 
                  type="submit" 
                  disabled={user?.role !== "admin"}
                  className="px-6 py-2 bg-teal-accent disabled:bg-zinc-300 disabled:text-zinc-500 disabled:cursor-not-allowed disabled:shadow-none text-white rounded-lg font-bold text-[10px] uppercase hover:opacity-95 shadow-md shadow-teal-accent/10 whitespace-nowrap cursor-pointer"
                >
                  {user?.role !== "admin" ? "Read Only" : "Save Changes"}
                </button>
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

  </AppBoundary>
  );
}
