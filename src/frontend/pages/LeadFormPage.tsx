import type React from "react";
import { Minus, Plus, Square, X } from "lucide-react";
import { motion } from "motion/react";
import { CustomersPage } from "./CustomersPage";

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

interface User {
  name: string;
  role: string;
  token: string;
}

interface LeadFormPageProps {
  mode: "new" | "existing";
  leadForm: Partial<Registration>;
  setLeadForm: React.Dispatch<React.SetStateAction<Partial<Registration>>>;
  onSubmit: (event: React.FormEvent) => void;
  onResetLeadForm: () => void;
  onCloseExisting: () => void;
  searchTerm: string;
  filteredCustomers: Customer[];
  registrations: Registration[];
  customers: Customer[];
  onSelectCustomer: (customer: Customer) => void;
  showSuggestions: boolean;
  setShowSuggestions: React.Dispatch<React.SetStateAction<boolean>>;
  showExistingSuggestions: boolean;
  setShowExistingSuggestions: React.Dispatch<React.SetStateAction<boolean>>;
  selectedLeadId: number | null;
  user: User | null;
  sources: string[];
  regions: string[];
  leadStatuses: string[];
  implementationTypes: string[];
  salesPeople: string[];
  salesTypes: string[];
  requestedPeopleList: string[];
}

export const LeadFormPage = ({
  mode,
  leadForm,
  setLeadForm,
  onSubmit,
  onResetLeadForm,
  onCloseExisting,
  searchTerm,
  filteredCustomers,
  registrations,
  customers,
  onSelectCustomer,
  showSuggestions,
  setShowSuggestions,
  showExistingSuggestions,
  setShowExistingSuggestions,
  selectedLeadId,
  user,
  sources,
  regions,
  leadStatuses,
  implementationTypes,
  salesPeople,
  salesTypes,
  requestedPeopleList,
}: LeadFormPageProps) => {
  const isExisting = mode === "existing";
  const customerSuggestionsOpen = isExisting ? showExistingSuggestions : showSuggestions;
  const setCustomerSuggestionsOpen = isExisting ? setShowExistingSuggestions : setShowSuggestions;
  const formSpacing = isExisting ? "space-y-4" : "space-y-6";
  const fieldBg = isExisting ? "bg-[#F1F5F9]" : "bg-white";
  const quantityBg = isExisting ? "bg-[#F1F5F9]" : "bg-white";
  const actionLabel = isExisting ? "Load Lead" : "Populate";
  const title = isExisting ? "Existing Form" : "New Form";
  const dateLabel = new Date().toLocaleDateString("en-GB").replace(/\//g, "-");

  const updateLeadForm = (patch: Partial<Registration>) => {
    setLeadForm(prev => ({ ...prev, ...patch }));
  };

  const fillFromCustomer = (cust: Customer) => {
    setLeadForm(prev => ({
      ...prev,
      customerName: cust.name,
      contactName: cust.contactName || prev.contactName || "",
      phone: cust.phone || prev.phone || "",
      email: cust.email || prev.email || "",
      region: cust.region || prev.region || "",
    }));
    setCustomerSuggestionsOpen(false);
  };

  const suggestionList = customers.filter(c => c && c.name && (c.name || "").toLowerCase().includes((leadForm.customerName || "").toLowerCase()));

  return (
    <motion.div
      key={isExisting ? "existing-form" : "new-form"}
      initial={{ opacity: 0, scale: 0.99 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.99 }}
      className="bg-white rounded-lg shadow-2xl border border-zinc-200 overflow-hidden flex flex-col h-full"
    >
      <div className="bg-zinc-50 border-b border-zinc-200 px-4 py-2 flex items-center justify-between">
        <div className="text-[11px] font-medium text-zinc-600 flex items-center gap-2">
          {title} - {dateLabel}
        </div>
        <div className="flex items-center gap-4 text-zinc-400">
          <Minus size={14} className="hover:text-zinc-600 cursor-pointer" />
          <Square size={10} className="hover:text-zinc-600 cursor-pointer" />
          <X size={14} className="hover:text-red-500 cursor-pointer" onClick={isExisting ? onCloseExisting : onResetLeadForm} />
        </div>
      </div>

      <div className={`p-8 ${isExisting ? "space-y-6" : "space-y-8"} flex-1 overflow-y-auto bg-[#F8FAFC]`}>
        {searchTerm && (
          <CustomersPage
            searchTerm={searchTerm}
            customers={filteredCustomers}
            registrations={registrations}
            actionLabel={actionLabel}
            onSelectCustomer={onSelectCustomer}
          />
        )}

        {isExisting && (
          <div className="mb-4">
            {selectedLeadId ? (
              user?.role !== "admin" ? (
                <div className="bg-rose-50 border border-rose-200/50 rounded-xl p-3 flex items-center justify-between text-[11px] text-rose-800">
                  <div className="flex items-center gap-2">
                    <span className="flex h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
                    <span>🔒 <strong>Read-Only Mode:</strong> You can view this authorized lead <strong>ID #{selectedLeadId} ({leadForm.customerName})</strong>, but edited submissions are restricted.</span>
                  </div>
                  <button type="button" onClick={onResetLeadForm} className="font-bold underline uppercase tracking-tighter text-[9px] hover:text-rose-900">Switch to Create New</button>
                </div>
              ) : (
                <div className="bg-amber-50 border border-amber-200/50 rounded-xl p-3 flex items-center justify-between text-[11px] text-amber-800">
                  <div className="flex items-center gap-2">
                    <span className="flex h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                    <span>✏️ <strong>Editing Mode:</strong> You are editing lead <strong>ID #{selectedLeadId} ({leadForm.customerName})</strong>. Submitting will execute a direct database <code>PUT</code> update.</span>
                  </div>
                  <button type="button" onClick={onResetLeadForm} className="font-bold underline uppercase tracking-tighter text-[9px] hover:text-amber-900">Switch to Create New</button>
                </div>
              )
            ) : leadForm.customerName ? (
              <div className="bg-teal-50 border border-teal-200/50 rounded-xl p-3 text-[11px] text-teal-800 flex items-center gap-2">
                <span className="flex h-2 w-2 rounded-full bg-[#00ADC6]" />
                <span>➕ <strong>Create New Lead Mode:</strong> Registering a new lead for customer <strong>{leadForm.customerName}</strong>. Submitting will execute a database <code>POST</code> insert.</span>
              </div>
            ) : null}
          </div>
        )}

        <form onSubmit={onSubmit} className={formSpacing}>
          <fieldset disabled={isExisting && user?.role !== "admin" && !!selectedLeadId} className={`${isExisting ? "space-y-4" : ""} w-full border-none p-0 m-0`}>
            <div className="grid grid-cols-6 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] text-zinc-500 flex items-center gap-0.5">Source: <span className="text-red-500">*</span></label>
                <select required value={leadForm.source} onChange={e => updateLeadForm({ source: e.target.value })} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none">
                  <option value="">Select Source</option>
                  {sources.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-zinc-500">Region:</label>
                <select value={leadForm.region} onChange={e => updateLeadForm({ region: e.target.value })} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none">
                  <option value="">Select Region</option>
                  {regions.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-zinc-500 flex items-center gap-0.5">Status: <span className="text-red-500">*</span></label>
                <select required value={leadForm.status} onChange={e => updateLeadForm({ status: e.target.value })} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none">
                  {leadStatuses.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-zinc-500 flex items-center gap-0.5">Implementation Type: <span className="text-red-500">*</span></label>
                <select required value={leadForm.implementationType} onChange={e => updateLeadForm({ implementationType: e.target.value })} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none">
                  <option value="">Select Implementation Type</option>
                  {implementationTypes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-zinc-500">Price:</label>
                <input type="text" placeholder="Price Details" value={leadForm.priceDetails || ""} onChange={e => updateLeadForm({ priceDetails: e.target.value })} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-zinc-500">Project Value:</label>
                <input type="text" placeholder="Project Value" value={leadForm.projectValue || ""} onChange={e => updateLeadForm({ projectValue: e.target.value })} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none" />
              </div>
            </div>

            <div className="grid grid-cols-6 gap-4">
              <div className="col-span-2 space-y-1 relative">
                <label className="text-[10px] text-zinc-500 flex items-center gap-0.5">Customer Name: <span className="text-red-500">*</span></label>
                <input
                  disabled={isExisting && !!selectedLeadId}
                  required
                  type="text"
                  placeholder="Customer Name"
                  value={leadForm.customerName || ""}
                  onChange={e => {
                    updateLeadForm({ customerName: e.target.value });
                    setCustomerSuggestionsOpen(true);
                  }}
                  onFocus={() => setCustomerSuggestionsOpen(true)}
                  onBlur={() => setTimeout(() => setCustomerSuggestionsOpen(false), 200)}
                  className={`w-full disabled:bg-[#E2E8F0]/50 disabled:text-zinc-500 disabled:cursor-not-allowed ${fieldBg} border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none`}
                />
                {customerSuggestionsOpen && leadForm.customerName && suggestionList.length > 0 && (
                  <div className="absolute left-0 right-0 z-50 bg-white border border-[#E2E8F0] rounded shadow-lg max-h-48 overflow-y-auto mt-1 divide-y divide-zinc-100">
                    {suggestionList.map(cust => (
                      <div
                        key={`${isExisting ? "exist-" : ""}suggest-${cust.id}`}
                        onMouseDown={() => fillFromCustomer(cust)}
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
                )}
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-zinc-500 flex items-center gap-0.5">Contact Name: <span className="text-red-500">*</span></label>
                <input disabled={isExisting && !!selectedLeadId} required type="text" placeholder="Contact Name" value={leadForm.contactName || ""} onChange={e => updateLeadForm({ contactName: e.target.value })} className={`w-full disabled:bg-[#E2E8F0]/50 disabled:text-zinc-500 disabled:cursor-not-allowed ${fieldBg} border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none`} />
                {isExisting && selectedLeadId && (
                  <div className="text-[8px] text-amber-600 font-bold leading-tight mt-1">
                    ⚠️ Names locked. Mention changes in comments.
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-zinc-500 flex items-center gap-0.5">Phone: <span className="text-red-500">*</span></label>
                <input required type="text" placeholder="Phone" value={leadForm.phone || ""} onChange={e => updateLeadForm({ phone: e.target.value })} className={`w-full ${fieldBg} border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none`} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-zinc-500">Email:</label>
                <input type="email" placeholder="Email" value={leadForm.email || ""} onChange={e => updateLeadForm({ email: e.target.value })} className={`w-full ${fieldBg} border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none`} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-zinc-500">Designation:</label>
                <input type="text" placeholder="Designation" value={leadForm.designation || ""} onChange={e => updateLeadForm({ designation: e.target.value })} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none" />
              </div>
            </div>

            <div className="grid grid-cols-6 gap-4">
              <div className="col-span-2 space-y-1">
                <label className="text-[10px] text-zinc-500">Address:</label>
                <input type="text" placeholder="Address" value={leadForm.address || ""} onChange={e => updateLeadForm({ address: e.target.value })} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none" />
              </div>
              <div className="col-span-2 space-y-1">
                <label className="text-[10px] text-zinc-500">Map Link:</label>
                <input type="text" placeholder="Map Link" value={leadForm.mapLink || ""} onChange={e => updateLeadForm({ mapLink: e.target.value })} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-zinc-500">Coordinates:</label>
                <input type="text" placeholder="Coordinates" value={leadForm.coordinates || ""} onChange={e => updateLeadForm({ coordinates: e.target.value })} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-zinc-500 flex items-center gap-0.5">Sales Person: <span className="text-red-500">*</span></label>
                <select required value={leadForm.salesPerson} onChange={e => updateLeadForm({ salesPerson: e.target.value })} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none">
                  <option value="">Select sales person</option>
                  {salesPeople.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-6 gap-4">
              <div className="col-start-6 space-y-1">
                <label className="text-[10px] text-zinc-500 flex items-center gap-0.5">Sales Type: <span className="text-red-500">*</span></label>
                <select required value={leadForm.salesType} onChange={e => updateLeadForm({ salesType: e.target.value })} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none">
                  <option value="">Select Sales Type</option>
                  {salesTypes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-8 gap-3 items-end">
              {([
                ["New Qty:", "newQty"],
                ["Migrate Qty:", "migrateQty"],
                ["Trading Qty:", "tradingQty"],
                ["Service Qty:", "serviceQty"],
                ["Other Qty:", "otherQty"],
              ] as const).map(([label, key]) => (
                <div key={key} className="space-y-1">
                  <label className="text-[10px] text-zinc-500">{label}</label>
                  <input type="number" value={leadForm[key] || 0} onChange={e => updateLeadForm({ [key]: parseInt(e.target.value) } as Partial<Registration>)} className={`w-full ${quantityBg} border border-[#E2E8F0] rounded px-2 py-1.5 text-[11px] text-zinc-600 focus:outline-none text-center ${isExisting ? "" : "h-8"}`} />
                </div>
              ))}
              <div className="col-span-2 space-y-1">
                <label className="text-[10px] text-zinc-500">Accessories If Any:</label>
                <input type="text" placeholder="Accessories" value={leadForm.accessories || ""} onChange={e => updateLeadForm({ accessories: e.target.value })} className={`w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none ${isExisting ? "" : "h-8"}`} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-zinc-500 flex items-center gap-0.5">Requested Person: <span className="text-red-500">*</span></label>
                <select required value={leadForm.requestedPerson} onChange={e => updateLeadForm({ requestedPerson: e.target.value })} className={`w-full ${quantityBg} border border-[#E2E8F0] rounded px-3 py-1.5 text-[11px] text-zinc-600 focus:outline-none ${isExisting ? "" : "h-8"}`}>
                  <option value="">Select requested person</option>
                  {requestedPeopleList.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <textarea rows={2} placeholder="Comment" value={leadForm.comment || ""} onChange={e => updateLeadForm({ comment: e.target.value })} className="w-full bg-[#F1F5F9] border border-[#E2E8F0] rounded px-4 py-3 text-[11px] text-zinc-600 focus:outline-none resize-none" />
            </div>

            <div className="space-y-4 pt-4 border-t border-zinc-100">
              <h4 className={`text-[11px] text-zinc-400 font-medium ${isExisting ? "tracking-tight" : ""}`}>Additional Contact Details</h4>
              <button type="button" className={`${isExisting ? "w-9 h-9" : "w-8 h-8"} rounded bg-teal-accent flex items-center justify-center text-white shadow-lg shadow-teal-accent/20 hover:scale-105 transition-all`}>
                <Plus size={isExisting ? 20 : 18} />
              </button>
            </div>
          </fieldset>

          <div className={`flex justify-end ${isExisting ? "gap-3 pt-4" : "pt-4"}`}>
            {isExisting && (
              <button type="button" onClick={onResetLeadForm} className="border border-zinc-200 text-zinc-550 px-6 py-2 rounded font-bold text-[10px] uppercase tracking-widest hover:bg-zinc-50 transition-all flex items-center justify-center gap-1.5">
                <X size={12} /> Clear Form
              </button>
            )}
            <button
              type="submit"
              disabled={isExisting && user?.role !== "admin" && !!selectedLeadId}
              className="bg-teal-accent disabled:bg-zinc-300 disabled:text-zinc-500 disabled:cursor-not-allowed text-white px-10 py-2 rounded font-bold text-[10px] uppercase tracking-widest shadow-lg shadow-teal-accent/10 hover:opacity-95 disabled:shadow-none transition-all cursor-pointer"
            >
              {isExisting && user?.role !== "admin" && !!selectedLeadId ? "READ ONLY" : "SAVE"}
            </button>
          </div>
        </form>
      </div>
    </motion.div>
  );
};
