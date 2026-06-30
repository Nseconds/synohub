import React, { useState, useEffect } from "react";
import { LayoutDashboard, Plus, Sparkles, ClipboardList } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { createGuestSession } from "./frontend/api/authApi";
import { updateCustomer } from "./frontend/api/customerApi";
import { fetchDashboardData } from "./frontend/api/dashboardApi";
import { createLead, updateLead, updateServiceRequest } from "./frontend/api/serviceRequestApi";
import { AppBoundary } from "./frontend/components/AppBoundary";
import { AppLayout } from "./frontend/components/AppLayout";
import { EditModal } from "./frontend/components/EditModal";
import { Header } from "./frontend/components/Header";
import { Modal } from "./frontend/components/Modal";
import { NotificationToast } from "./frontend/components/NotificationToast";
import { Sidebar } from "./frontend/components/Sidebar";
import { StaffRegistrationModal } from "./frontend/components/StaffRegistrationModal";
import { IMPLEMENTATION_TYPES, LEAD_STATUSES, PAYMENT_OPTIONS, REGIONS, REQUESTED_PEOPLE, SALES_PEOPLE, SALES_TYPES, SOURCES, TICKET_STATUSES } from "./frontend/constants/options";
import { AiPage } from "./frontend/pages/AiPage";
import { DashboardPage } from "./frontend/pages/DashboardPage";
import { LeadFormPage } from "./frontend/pages/LeadFormPage";
import { LoginPage } from "./frontend/pages/LoginPage";
import type { Customer, Registration, ServiceTicket } from "./frontend/types";
import { isValidStoredUser } from "./frontend/utils/auth";

function findOptionMatch(value: string | undefined, list: string[], defaultValue?: string): string {
  if (!value) return defaultValue !== undefined ? defaultValue : list[0];
  const cleanedVal = value.trim().toUpperCase().replace(/\s*\+\s*/g, "+").replace(/\s+/g, "");
  const normalize = (option: string) => option.trim().toUpperCase().replace(/\s*\+\s*/g, "+").replace(/\s+/g, "");
  const exact = list.find(opt => normalize(opt) === cleanedVal);
  if (exact) return exact;

  const found = list.find(opt => {
    const cleanedOpt = normalize(opt);
    return cleanedOpt.startsWith(cleanedVal) || cleanedOpt.includes(cleanedVal);
  });
  return found || defaultValue || list[0];
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
      } else {
        setDefaultRequestedPerson("");
        setLeadForm(prev => ({ ...prev, requestedPerson: "" }));
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
          status: findOptionMatch(selectedReg.status, LEAD_STATUSES, "New Lead"),
          region: findOptionMatch(selectedReg.region, REGIONS, REGIONS[0]),
          implementationType: findOptionMatch(selectedReg.implementationType, IMPLEMENTATION_TYPES, IMPLEMENTATION_TYPES[0]),
          salesPerson: findOptionMatch(selectedReg.salesPerson, SALES_PEOPLE, SALES_PEOPLE[0]),
          salesType: findOptionMatch(selectedReg.salesType, SALES_TYPES, SALES_TYPES[0]),
          source: findOptionMatch(selectedReg.source, SOURCES, SOURCES[0]),
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
          requestedPerson: findOptionMatch(selectedReg.requestedPerson, requestedPeopleList, "")
        });
      }
    }
  }, [selectedLeadId, data.registrations, requestedPeopleList]);

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
      const message = err instanceof Error ? err.message : "Could not submit lead details. Please inspect constraints and connection.";
      showToast(message, "error");
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
          <NotificationToast
            notification={notification}
            onClose={() => setNotification(null)}
          />
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

            {activeTab === "new-form" && (
              <LeadFormPage
                mode="new"
                leadForm={leadForm}
                setLeadForm={setLeadForm}
                onSubmit={handleLeadSubmit}
                onResetLeadForm={resetLeadForm}
                onCloseExisting={() => setActiveTab("new-form")}
                searchTerm={searchTerm}
                filteredCustomers={filteredCustomers}
                registrations={data?.registrations || []}
                customers={data?.customers || []}
                onSelectCustomer={handleSelectCustomer}
                showSuggestions={showSuggestions}
                setShowSuggestions={setShowSuggestions}
                showExistingSuggestions={showExistingSuggestions}
                setShowExistingSuggestions={setShowExistingSuggestions}
                selectedLeadId={selectedLeadId}
                user={user}
                sources={SOURCES}
                regions={REGIONS}
                leadStatuses={LEAD_STATUSES}
                implementationTypes={IMPLEMENTATION_TYPES}
                salesPeople={SALES_PEOPLE}
                salesTypes={SALES_TYPES}
                requestedPeopleList={requestedPeopleList}
              />
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
              <LeadFormPage
                mode="existing"
                leadForm={leadForm}
                setLeadForm={setLeadForm}
                onSubmit={handleLeadSubmit}
                onResetLeadForm={resetLeadForm}
                onCloseExisting={() => setActiveTab("new-form")}
                searchTerm={searchTerm}
                filteredCustomers={filteredCustomers}
                registrations={data?.registrations || []}
                customers={data?.customers || []}
                onSelectCustomer={handleSelectCustomer}
                showSuggestions={showSuggestions}
                setShowSuggestions={setShowSuggestions}
                showExistingSuggestions={showExistingSuggestions}
                setShowExistingSuggestions={setShowExistingSuggestions}
                selectedLeadId={selectedLeadId}
                user={user}
                sources={SOURCES}
                regions={REGIONS}
                leadStatuses={LEAD_STATUSES}
                implementationTypes={IMPLEMENTATION_TYPES}
                salesPeople={SALES_PEOPLE}
                salesTypes={SALES_TYPES}
                requestedPeopleList={requestedPeopleList}
              />
            )}

            {activeTab === "ai" && (
              <AiPage
                user={user}
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
                }}
              />
            )}


          </AnimatePresence>
      </AppLayout>

      {/* Visual Edit Modal */}
      {editingItem && (
        <EditModal
          editingItem={editingItem}
          setEditingItem={setEditingItem}
          userRole={user?.role}
          onSubmit={async (e) => {
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
          }}
          regions={REGIONS}
          leadStatuses={LEAD_STATUSES}
          implementationTypes={IMPLEMENTATION_TYPES}
          salesPeople={SALES_PEOPLE}
          ticketStatuses={TICKET_STATUSES}
          paymentOptions={PAYMENT_OPTIONS}
        />
      )}

      {/* Dynamic Staff Registration Confirmation Modal */}
      {pendingStaffName && (
        <StaffRegistrationModal
          name={pendingStaffName}
          onCancel={() => {
            const name = pendingStaffName;
            setPendingStaffName(null);
            showToast(`Registration cancelled for "${name}".`, "error");
          }}
          onConfirm={() => {
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

            showToast(`"${name}" is now dynamically registered and set as your session default coordinator!`, "success");
          }}
        />
      )}

  </AppBoundary>
  );
}
