import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const SOURCES = ["Door to Door","Referral","Company Lead","Cold Calling","Dealer","Other","MECAF2019"];
const REGIONS = ["Sharjah","Dubai","Abu Dhabi","Ajman","Fujairah","Ras Al Khaimah","Umm Al Quwain"];
const LEAD_STATUSES = ["New Lead","Proposed","Won","Hold","Lost","Completed","Duplicate","Demo","Check for Migration","Pseudo Leads","Deleted"];
const IMPL_TYPES = ["LOCATOR","ASATEEL","LOCATOR+ASATEEL","SECUREPATH","LOCATOR+SECUREPATH","RASID","SERVICE","SHAHIN","SECUREPATH PREMIUM","LOCATOR+SECUREPATH PREMIUM","LOCATOR+RASID","OTHER"];
const SALES_PEOPLE = ["Ajmal","Deepak","Nishad","Shams","Umar","Vishal"];
const SALES_TYPES = ["New","Migration","Trading","New and Migrate","New and Trading","Migrate and Trading","New and Migrate and Trading","Existing"];
const REQ_PEOPLE = ["Ajmal","Amrutha","Athul","Celine","Deepak","Faizal","Ivy","Midhun","Mohamed Musthafa","Naseeb","Nisam","Nishad","Rasick","Reyn","Shamnad","Shams","Shyamjith","Umar","Vaishakh Tech"];
const TICKET_STATUSES = ["New","Hold","Ongoing","Completed","Followed up"];
const PAY_OPTIONS = ["Applicable","Not Applicable"];
const INV_STATUSES = ["Not Invoiced","Invoiced"];
const PAY_STATUSES = ["Not Paid","Paid"];
const ISSUE_TYPES = ["No Connection","GPS Offline","Device Offline","Ignition Issue","Power Cut","Camera Fault","Tracking Stopped","Device Not Responding","Battery Issue","Signal Lost"];
const TECHNICIANS = ["Athul","Faizal","Midhun","Rasick","Reyn","Shamnad","Shyamjith","Vaishakh Tech"];

// ─── INITIAL SEED DATA ────────────────────────────────────────────────────────
const SEED_CUSTOMERS = [
  { id:1, name:"Emirates Freight LLC", contactName:"Khaled Al Mansoori", phone:"+971501234567", email:"khaled@emiratesfreight.ae", region:"Dubai", implementationType:"LOCATOR", vehicleCount:45 },
  { id:2, name:"Haya Decorations", contactName:"Fatima Al Zaabi", phone:"+971509876543", email:"fatima@haya.ae", region:"Abu Dhabi", implementationType:"LOCATOR+ASATEEL", vehicleCount:12 },
  { id:3, name:"Clymet Logistics", contactName:"Ravi Kumar", phone:"+971551122334", email:"ravi@clymet.ae", region:"Sharjah", implementationType:"SECUREPATH", vehicleCount:28 },
  { id:4, name:"Inspirentals Abu Dhabi", contactName:"Ahmed Siddiqui", phone:"+971508887766", email:"ahmed@inspirentals.ae", region:"Abu Dhabi", implementationType:"LOCATOR", vehicleCount:7 },
  { id:5, name:"Gulf Star Transport", contactName:"Priya Menon", phone:"+971564433221", email:"priya@gulfstar.ae", region:"Dubai", implementationType:"ASATEEL", vehicleCount:33 },
];

const SEED_LEADS = [
  { id:1, customerName:"Emirates Freight LLC", contactName:"Khaled Al Mansoori", designation:"Fleet Manager", phone:"+971501234567", email:"khaled@emiratesfreight.ae", region:"Dubai", address:"Al Quoz Industrial Area", mapLink:"", coordinates:"", source:"Company Lead", status:"Won", implementationType:"LOCATOR", salesPerson:"Nishad", salesType:"New", requestedPerson:"Athul", comment:"Large fleet expansion", projectValue:"AED 85,000", priceDetails:"450/unit", accessories:"Panic button x45", newQty:45, migrateQty:0, tradingQty:0, serviceQty:0, otherQty:0, createdAt:"2025-01-15" },
  { id:2, customerName:"Haya Decorations", contactName:"Fatima Al Zaabi", designation:"Director", phone:"+971509876543", email:"fatima@haya.ae", region:"Abu Dhabi", address:"Mussafah Industrial", mapLink:"", coordinates:"", source:"Referral", status:"Proposed", implementationType:"LOCATOR+ASATEEL", salesPerson:"Shams", salesType:"New", requestedPerson:"Rasick", comment:"Budget discussion ongoing", projectValue:"AED 22,000", priceDetails:"", accessories:"", newQty:12, migrateQty:0, tradingQty:0, serviceQty:0, otherQty:0, createdAt:"2025-02-10" },
  { id:3, customerName:"Clymet Logistics", contactName:"Ravi Kumar", designation:"Operations Head", phone:"+971551122334", email:"ravi@clymet.ae", region:"Sharjah", address:"Industrial Area 18", mapLink:"", coordinates:"", source:"Cold Calling", status:"Won", implementationType:"SECUREPATH", salesPerson:"Deepak", salesType:"Migration", requestedPerson:"Shyamjith", comment:"Migration from old provider", projectValue:"AED 42,000", priceDetails:"", accessories:"", newQty:0, migrateQty:28, tradingQty:0, serviceQty:0, otherQty:0, createdAt:"2025-03-05" },
];

const SEED_SERVICES = [
  { id:1, ticketId:"SVC-001", customerName:"Emirates Freight LLC", description:"No Connection - 3 units offline since yesterday. Vehicles: DXB-1234, DXB-1235, DXB-1236", status:"Ongoing", quantity:3, requestedPerson:"Athul", payment:"Applicable", invoiceStatus:"Not Invoiced", paymentStatus:"Not Paid", amount:"AED 450", assignee:"Faizal", createdAt:"2025-05-20" },
  { id:2, ticketId:"SVC-002", customerName:"Haya Decorations", description:"GPS Offline - Tracker not updating location for van ABD-5678", status:"New", quantity:1, requestedPerson:"Rasick", payment:"Not Applicable", invoiceStatus:"Not Invoiced", paymentStatus:"Not Paid", amount:"", assignee:"", createdAt:"2025-05-22" },
  { id:3, ticketId:"SVC-003", customerName:"Gulf Star Transport", description:"Device Not Responding - unit completely dead, possible power cut", status:"Hold", quantity:1, requestedPerson:"Reyn", payment:"Applicable", invoiceStatus:"Invoiced", paymentStatus:"Paid", amount:"AED 150", assignee:"Midhun", createdAt:"2025-05-23" },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const cn = (...classes) => classes.filter(Boolean).join(" ");
const uid = () => Math.random().toString(36).slice(2,8).toUpperCase();
const statusColor = (s) => {
  const m = { Won:"bg-emerald-100 text-emerald-700", Lost:"bg-red-100 text-red-700", Proposed:"bg-sky-100 text-sky-700", "New Lead":"bg-indigo-100 text-indigo-700", Hold:"bg-amber-100 text-amber-700", Completed:"bg-teal-100 text-teal-700", New:"bg-indigo-100 text-indigo-700", Ongoing:"bg-sky-100 text-sky-700", "Followed up":"bg-purple-100 text-purple-700" };
  return m[s] || "bg-zinc-100 text-zinc-600";
};

// ─── FORM DEFAULTS ────────────────────────────────────────────────────────────
const defaultLead = () => ({ customerName:"", contactName:"", designation:"", phone:"", email:"", region:REGIONS[0], address:"", mapLink:"", coordinates:"", source:SOURCES[0], status:"New Lead", implementationType:IMPL_TYPES[0], salesPerson:SALES_PEOPLE[0], salesType:SALES_TYPES[0], requestedPerson:"", comment:"", projectValue:"", priceDetails:"", accessories:"", newQty:0, migrateQty:0, tradingQty:0, serviceQty:0, otherQty:0 });
const defaultTicket = () => ({ customerName:"", description:"", status:"New", quantity:1, requestedPerson:"", payment:PAY_OPTIONS[0], invoiceStatus:INV_STATUSES[0], paymentStatus:PAY_STATUSES[0], amount:"", assignee:"" });

// ─── FIELD COMPONENT ──────────────────────────────────────────────────────────
const F = ({ label, required, children }) => (
  <div className="space-y-1">
    <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
      {label}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    {children}
  </div>
);
const inp = "w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 text-xs text-zinc-800 font-medium focus:outline-none focus:border-teal-500/50 focus:bg-white transition-all";

// ─── NAV ICONS (inline SVG) ───────────────────────────────────────────────────
const Icons = {
  Dashboard: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
  Plus: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M12 5v14M5 12h14"/></svg>,
  Edit: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  Bot: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4M8 14h.01M16 14h.01"/></svg>,
  DB: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>,
  Ticket: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 0 0-2 2v3a2 2 0 0 1 0 4v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3a2 2 0 0 1 0-4V7a2 2 0 0 0-2-2H5z"/></svg>,
  Send: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg>,
  Search: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>,
  X: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M18 6L6 18M6 6l12 12"/></svg>,
  Shield: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  Truck: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><rect x="1" y="3" width="15" height="13"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
  Users: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  Zap: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>,
  Trash: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><path d="M3 6h18M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/></svg>,
  Pen: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>,
  Check: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4"><path d="M20 6L9 17l-5-5"/></svg>,
};

// ─── MODAL ────────────────────────────────────────────────────────────────────
const Modal = ({ isOpen, onClose, title, children, wide }) => (
  <AnimatePresence>
    {isOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={onClose} className="absolute inset-0 bg-zinc-900/50 backdrop-blur-sm" />
        <motion.div initial={{opacity:0,scale:0.95,y:20}} animate={{opacity:1,scale:1,y:0}} exit={{opacity:0,scale:0.95,y:20}} className={cn("bg-white rounded-2xl shadow-2xl w-full overflow-hidden relative z-10 flex flex-col max-h-[90vh]", wide ? "max-w-5xl" : "max-w-2xl")}>
          <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between bg-zinc-50 shrink-0">
            <h3 className="font-bold text-zinc-900 text-sm">{title}</h3>
            <button onClick={onClose} className="p-1.5 hover:bg-zinc-200 rounded-lg text-zinc-400 transition-colors"><Icons.X /></button>
          </div>
          <div className="p-6 overflow-y-auto">{children}</div>
        </motion.div>
      </div>
    )}
  </AnimatePresence>
);

// ─── LEAD FORM BODY ───────────────────────────────────────────────────────────
const LeadFormBody = ({ form, setForm, customers, onSubmit, submitLabel = "SAVE RECORD", isExisting = false }) => {
  const total = (form.newQty||0)+(form.migrateQty||0)+(form.tradingQty||0)+(form.serviceQty||0)+(form.otherQty||0);
  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* Auto-fill from existing customer */}
      <div className="flex items-center gap-2 pb-3 border-b border-zinc-100">
        <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest shrink-0">Auto-fill from customer:</span>
        <select onChange={e => {
          const c = customers.find(x => x.id === parseInt(e.target.value));
          if (c) setForm(f => ({...f, customerName:c.name, contactName:c.contactName, phone:c.phone, email:c.email, region:c.region, implementationType:c.implementationType}));
        }} className="flex-1 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none">
          <option value="">— Select existing customer —</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* Row 1 */}
      <div className="grid grid-cols-3 gap-4">
        <F label="Source" required><select required value={form.source||""} onChange={e=>setForm(f=>({...f,source:e.target.value}))} className={inp}>{SOURCES.map(s=><option key={s}>{s}</option>)}</select></F>
        <F label="Region"><select value={form.region||""} onChange={e=>setForm(f=>({...f,region:e.target.value}))} className={inp}>{REGIONS.map(r=><option key={r}>{r}</option>)}</select></F>
        <F label="Status" required><select required value={form.status||""} onChange={e=>setForm(f=>({...f,status:e.target.value}))} className={inp}>{LEAD_STATUSES.map(s=><option key={s}>{s}</option>)}</select></F>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <F label="Implementation Type" required><select required value={form.implementationType||""} onChange={e=>setForm(f=>({...f,implementationType:e.target.value}))} className={inp}>{IMPL_TYPES.map(t=><option key={t}>{t}</option>)}</select></F>
        <F label="Price Details"><input value={form.priceDetails||""} onChange={e=>setForm(f=>({...f,priceDetails:e.target.value}))} placeholder="e.g. 450/unit" className={inp}/></F>
        <F label="Project Value"><input value={form.projectValue||""} onChange={e=>setForm(f=>({...f,projectValue:e.target.value}))} placeholder="AED 0.00" className={inp}/></F>
      </div>

      {/* Row 2: Customer Info */}
      <div className="grid grid-cols-6 gap-4">
        <div className="col-span-2"><F label="Company Name" required><input required value={form.customerName||""} onChange={e=>setForm(f=>({...f,customerName:e.target.value}))} placeholder="Company / Customer name" className={inp}/></F></div>
        <F label="Contact Name" required><input required value={form.contactName||""} onChange={e=>setForm(f=>({...f,contactName:e.target.value}))} className={inp}/></F>
        <F label="Phone" required><input required value={form.phone||""} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} placeholder="+971..." className={inp}/></F>
        <F label="Email"><input type="email" value={form.email||""} onChange={e=>setForm(f=>({...f,email:e.target.value}))} className={inp}/></F>
        <F label="Designation"><input value={form.designation||""} onChange={e=>setForm(f=>({...f,designation:e.target.value}))} className={inp}/></F>
      </div>

      {/* Row 3: Location */}
      <div className="grid grid-cols-4 gap-4">
        <div className="col-span-2"><F label="Address"><input value={form.address||""} onChange={e=>setForm(f=>({...f,address:e.target.value}))} className={inp}/></F></div>
        <F label="Map Link"><input value={form.mapLink||""} onChange={e=>setForm(f=>({...f,mapLink:e.target.value}))} placeholder="https://maps.google.com/..." className={inp}/></F>
        <F label="Coordinates"><input value={form.coordinates||""} onChange={e=>setForm(f=>({...f,coordinates:e.target.value}))} placeholder="25.2048, 55.2708" className={inp}/></F>
      </div>

      {/* Row 4: Sales */}
      <div className="grid grid-cols-3 gap-4">
        <F label="Sales Person" required><select required value={form.salesPerson||""} onChange={e=>setForm(f=>({...f,salesPerson:e.target.value}))} className={inp}><option value="">Select...</option>{SALES_PEOPLE.map(p=><option key={p}>{p}</option>)}</select></F>
        <F label="Sales Type" required><select required value={form.salesType||""} onChange={e=>setForm(f=>({...f,salesType:e.target.value}))} className={inp}>{SALES_TYPES.map(t=><option key={t}>{t}</option>)}</select></F>
        <F label="Requested By" required><select required value={form.requestedPerson||""} onChange={e=>setForm(f=>({...f,requestedPerson:e.target.value}))} className={inp}><option value="">Select...</option>{REQ_PEOPLE.map(p=><option key={p}>{p}</option>)}</select></F>
      </div>

      {/* Row 5: Quantities */}
      <div className="bg-zinc-50 rounded-xl p-4 border border-zinc-200">
        <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-3">Unit Quantities — Total: <span className="text-teal-600">{total}</span></div>
        <div className="grid grid-cols-5 gap-3">
          {[["New","newQty"],["Migrate","migrateQty"],["Trading","tradingQty"],["Service","serviceQty"],["Other","otherQty"]].map(([l,k])=>(
            <div key={k} className="text-center">
              <div className="text-[9px] font-bold text-zinc-500 uppercase mb-1">{l}</div>
              <input type="number" min="0" value={form[k]||0} onChange={e=>setForm(f=>({...f,[k]:parseInt(e.target.value)||0}))} className="w-full bg-white border border-zinc-200 rounded-lg py-2 text-center text-sm font-bold text-zinc-700 focus:outline-none focus:border-teal-500/50"/>
            </div>
          ))}
        </div>
      </div>

      {/* Accessories + Comment */}
      <div className="grid grid-cols-2 gap-4">
        <F label="Accessories"><input value={form.accessories||""} onChange={e=>setForm(f=>({...f,accessories:e.target.value}))} placeholder="e.g. Panic button x10" className={inp}/></F>
        <F label="Comment"><input value={form.comment||""} onChange={e=>setForm(f=>({...f,comment:e.target.value}))} className={inp}/></F>
      </div>

      <div className="flex justify-end pt-2">
        <button type="submit" className="bg-teal-600 hover:bg-teal-700 text-white font-bold px-8 py-2.5 rounded-xl text-xs uppercase tracking-widest shadow-lg shadow-teal-600/20 transition-all flex items-center gap-2">
          <Icons.Check />{submitLabel}
        </button>
      </div>
    </form>
  );
};

// ─── SERVICE TICKET FORM ──────────────────────────────────────────────────────
const TicketFormBody = ({ form, setForm, customers, onSubmit, submitLabel = "CREATE TICKET" }) => (
  <form onSubmit={onSubmit} className="space-y-5">
    <div className="grid grid-cols-2 gap-4">
      <F label="Company / Customer Name" required>
        <input required list="cust-list-t" value={form.customerName||""} onChange={e=>setForm(f=>({...f,customerName:e.target.value}))} className={inp}/>
        <datalist id="cust-list-t">{customers.map(c=><option key={c.id} value={c.name}/>)}</datalist>
      </F>
      <F label="Ticket Status"><select value={form.status||"New"} onChange={e=>setForm(f=>({...f,status:e.target.value}))} className={inp}>{TICKET_STATUSES.map(s=><option key={s}>{s}</option>)}</select></F>
      <F label="Issue Type"><select value={form.issueType||""} onChange={e=>setForm(f=>({...f,issueType:e.target.value}))} className={inp}><option value="">Select issue type...</option>{ISSUE_TYPES.map(i=><option key={i}>{i}</option>)}</select></F>
      <F label="Quantity"><input type="number" min="1" value={form.quantity||1} onChange={e=>setForm(f=>({...f,quantity:parseInt(e.target.value)||1}))} className={inp}/></F>
      <F label="Assignee / Technician"><select value={form.assignee||""} onChange={e=>setForm(f=>({...f,assignee:e.target.value}))} className={inp}><option value="">Unassigned</option>{TECHNICIANS.map(t=><option key={t}>{t}</option>)}</select></F>
      <F label="Requested By"><select value={form.requestedPerson||""} onChange={e=>setForm(f=>({...f,requestedPerson:e.target.value}))} className={inp}><option value="">Select...</option>{REQ_PEOPLE.map(p=><option key={p}>{p}</option>)}</select></F>
      <F label="Payment"><select value={form.payment||PAY_OPTIONS[0]} onChange={e=>setForm(f=>({...f,payment:e.target.value}))} className={inp}>{PAY_OPTIONS.map(o=><option key={o}>{o}</option>)}</select></F>
      <F label="Amount (AED)"><input value={form.amount||""} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} placeholder="AED 0.00" className={inp}/></F>
      <F label="Invoice Status"><select value={form.invoiceStatus||INV_STATUSES[0]} onChange={e=>setForm(f=>({...f,invoiceStatus:e.target.value}))} className={inp}>{INV_STATUSES.map(s=><option key={s}>{s}</option>)}</select></F>
      <F label="Payment Status"><select value={form.paymentStatus||PAY_STATUSES[0]} onChange={e=>setForm(f=>({...f,paymentStatus:e.target.value}))} className={inp}>{PAY_STATUSES.map(s=><option key={s}>{s}</option>)}</select></F>
    </div>
    <F label="Description / Issue Details" required>
      <textarea required rows={3} value={form.description||""} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Describe the issue, vehicle numbers, location, etc." className={cn(inp,"resize-none")}/>
    </F>
    <div className="flex justify-end">
      <button type="submit" className="bg-zinc-900 hover:bg-zinc-700 text-white font-bold px-8 py-2.5 rounded-xl text-xs uppercase tracking-widest shadow-lg transition-all flex items-center gap-2">
        <Icons.Ticket />{submitLabel}
      </button>
    </div>
  </form>
);

// ─── CHAT INTERFACE ───────────────────────────────────────────────────────────
const SynoAIChat = ({ db, setDb }) => {
  const [messages, setMessages] = useState([{role:"assistant", content:"👋 Hey! I'm **SynoHub AI Assistant** — your fleet operations brain.\n\nI can help you:\n• 📋 Create & manage leads and service tickets\n• 🔍 Query your customer database\n• 👨‍🔧 Assign technicians to tickets\n• 📊 Get operational analytics\n• 🚗 Track GPS & device issues\n\nJust type naturally — WhatsApp style is fine!", ts: Date.now()}]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { if(scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages]);

  const buildSystemPrompt = () => {
    const custSummary = db.customers.map(c=>`  - ID:${c.id} | ${c.name} | Contact: ${c.contactName} | Phone: ${c.phone} | Region: ${c.region} | Vehicles: ${c.vehicleCount} | Type: ${c.implementationType}`).join("\n");
    const leadSummary = db.leads.map(l=>`  - ID:${l.id} | ${l.customerName} | Status: ${l.status} | Region: ${l.region} | Sales: ${l.salesPerson} | Qty: ${(l.newQty||0)+(l.migrateQty||0)} | Comment: ${l.comment||""}`).join("\n");
    const svcSummary = db.services.map(s=>`  - ID:${s.id} | ${s.ticketId} | ${s.customerName} | Status: ${s.status} | Assignee: ${s.assignee||"Unassigned"} | Issue: ${s.description?.substring(0,60)}`).join("\n");

    return `You are SynoHub AI Assistant, an intelligent fleet and service management chatbot for Synosys Fleet Intelligence, Dubai UAE.

LIVE DATABASE CONTEXT:
=== CUSTOMERS (${db.customers.length} records) ===
${custSummary || "  (empty)"}

=== LEAD REGISTRATIONS (${db.leads.length} records) ===
${leadSummary || "  (empty)"}

=== SERVICE TICKETS (${db.services.length} records) ===
${svcSummary || "  (empty)"}

Available technicians: ${TECHNICIANS.join(", ")}
Sales people: ${SALES_PEOPLE.join(", ")}
Regions: ${REGIONS.join(", ")}
Issue types: ${ISSUE_TYPES.join(", ")}

YOUR CAPABILITIES:
1. DATABASE QUERIES: Answer questions about existing data — counts, summaries, who has what, pending tickets, etc. Answer factually from the data above.
2. CREATE RECORDS: When user wants to create a lead or service ticket, extract details and output a JSON trigger block on its own line.
3. UPDATE RECORDS: When user wants to update status/assignee/field, output update trigger.
4. ANALYTICS: Summarize operations, flag issues, find patterns.
5. CONVERSATIONAL: Handle greetings, general fleet ops questions, abbreviations like "bro tracker not working", "urvan offline", "assign tech", etc.

INTENT DETECTION:
- "create/add/new lead/registration" → create_lead
- "create/new/log ticket/service/complaint/issue" → create_service  
- "update/change/mark/set" → update_record
- "assign/give to" → assign_technician
- "how many/count/total/which/who/show me/list" → db_query
- greetings → respond warmly

FOLLOW-UP: If key info is missing for record creation, ask concisely. Don't hallucinate data.

RESPONSE FORMAT:
- Be concise and operational
- Use markdown: **bold**, bullet points
- For record creation, end your message with a JSON block on its own line:
  [[SAVE_LEAD:{"customerName":"","contactName":"","phone":"","email":"","region":"","source":"","status":"New Lead","implementationType":"","salesPerson":"","salesType":"New","requestedPerson":"","comment":"","newQty":0,"migrateQty":0}]]
  OR
  [[SAVE_SERVICE:{"customerName":"","description":"","status":"New","quantity":1,"assignee":"","requestedPerson":"","payment":"Not Applicable","amount":""}]]
  OR
  [[UPDATE_LEAD:{"id":X,"data":{...fields}}]]
  OR
  [[UPDATE_SERVICE:{"id":X,"data":{...fields}}]]

For typos and messy input: "urvan 23543 offline" = vehicle tracking issue; "bro no gps" = GPS complaint; "need locator support abu dhabi" = new service request in Abu Dhabi.`;
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    const newMsg = { role:"user", content:userMsg, ts:Date.now() };
    setMessages(prev => [...prev, newMsg]);
    setLoading(true);

    try {
      const history = messages.slice(-8).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          model:"claude-sonnet-4-20250514",
          max_tokens:1000,
          system: buildSystemPrompt(),
          messages: [...history, { role:"user", content:userMsg }]
        })
      });
      const data = await res.json();
      const reply = data.content?.[0]?.text || "Sorry, I couldn't process that. Please try again.";

      // Parse and execute triggers
      const saveLeadMatch = reply.match(/\[\[SAVE_LEAD:(\{[\s\S]*?\})\]\]/);
      const saveSvcMatch = reply.match(/\[\[SAVE_SERVICE:(\{[\s\S]*?\})\]\]/);
      const updateLeadMatch = reply.match(/\[\[UPDATE_LEAD:(\{[\s\S]*?\})\]\]/);
      const updateSvcMatch = reply.match(/\[\[UPDATE_SERVICE:(\{[\s\S]*?\})\]\]/);

      let notification = null;

      if (saveLeadMatch) {
        try {
          const rec = JSON.parse(saveLeadMatch[1]);
          const newId = Math.max(0, ...db.leads.map(l=>l.id)) + 1;
          const newLead = { ...defaultLead(), ...rec, id: newId, createdAt: new Date().toISOString().split('T')[0] };
          setDb(prev => ({ ...prev, leads: [...prev.leads, newLead] }));
          notification = "✅ Lead record saved to database!";
        } catch(e) { notification = "⚠️ Could not parse lead record."; }
      }
      if (saveSvcMatch) {
        try {
          const rec = JSON.parse(saveSvcMatch[1]);
          const newId = Math.max(0, ...db.services.map(s=>s.id)) + 1;
          const newSvc = { ...defaultTicket(), ...rec, id: newId, ticketId:`SVC-${String(newId).padStart(3,'0')}`, invoiceStatus:"Not Invoiced", paymentStatus:"Not Paid", createdAt: new Date().toISOString().split('T')[0] };
          setDb(prev => ({ ...prev, services: [...prev.services, newSvc] }));
          notification = "✅ Service ticket created!";
        } catch(e) { notification = "⚠️ Could not parse ticket."; }
      }
      if (updateLeadMatch) {
        try {
          const { id, data: upd } = JSON.parse(updateLeadMatch[1]);
          setDb(prev => ({ ...prev, leads: prev.leads.map(l => l.id === id ? {...l,...upd} : l) }));
          notification = `✅ Lead #${id} updated!`;
        } catch(e) {}
      }
      if (updateSvcMatch) {
        try {
          const { id, data: upd } = JSON.parse(updateSvcMatch[1]);
          setDb(prev => ({ ...prev, services: prev.services.map(s => s.id === id ? {...s,...upd} : s) }));
          notification = `✅ Ticket #${id} updated!`;
        } catch(e) {}
      }

      // Clean reply of trigger blocks
      const cleanReply = reply.replace(/\[\[SAVE_LEAD:[\s\S]*?\]\]/g,"").replace(/\[\[SAVE_SERVICE:[\s\S]*?\]\]/g,"").replace(/\[\[UPDATE_LEAD:[\s\S]*?\]\]/g,"").replace(/\[\[UPDATE_SERVICE:[\s\S]*?\]\]/g,"").trim();

      setMessages(prev => [...prev, { role:"assistant", content: cleanReply + (notification ? `\n\n${notification}` : ""), ts:Date.now() }]);
    } catch(e) {
      setMessages(prev => [...prev, { role:"assistant", content:"⚠️ Network issue. Please check connection and retry.", ts:Date.now() }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const QUICK = [
    "How many service tickets are pending?",
    "Show all customers in Dubai",
    "Which technician is assigned to the most tickets?",
    "Create a GPS offline complaint for Emirates Freight",
    "Assign Athul to ticket SVC-002",
    "What leads are in Proposed status?",
  ];

  const renderMsg = (content) => {
    // Simple markdown: **bold**, bullet points, line breaks
    const lines = content.split('\n');
    return lines.map((line, i) => {
      const parts = line.split(/\*\*(.*?)\*\*/g);
      const rendered = parts.map((p, j) => j % 2 === 1 ? <strong key={j}>{p}</strong> : p);
      if (line.startsWith('• ') || line.startsWith('- ')) return <div key={i} className="flex gap-1.5"><span className="text-teal-500 shrink-0">•</span><span>{rendered.map((p,j)=>j%2===1?<strong key={j}>{p}</strong>:p)}</span></div>;
      return <div key={i} className={line === '' ? 'h-2' : ''}>{rendered}</div>;
    });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] max-w-4xl mx-auto">
      {/* Header */}
      <div className="bg-gradient-to-r from-teal-600 to-teal-700 rounded-t-2xl px-6 py-4 flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
          <Icons.Bot />
        </div>
        <div>
          <div className="font-bold text-white text-sm">SynoHub AI Assistant</div>
          <div className="text-teal-200 text-[10px] flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-teal-300 animate-pulse"/>
            Fleet Intelligence · Cog-Ops Neural Link · {db.leads.length} leads · {db.services.length} tickets · {db.customers.length} customers
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-zinc-50 p-4 space-y-4 border-x border-zinc-200">
        {messages.map((m, i) => (
          <motion.div key={i} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} className={cn("flex", m.role==="user" ? "justify-end" : "justify-start")}>
            {m.role === "assistant" && (
              <div className="w-7 h-7 rounded-full bg-teal-600 flex items-center justify-center shrink-0 mr-2 mt-1">
                <Icons.Zap />
              </div>
            )}
            <div className={cn(
              "max-w-[80%] rounded-2xl px-4 py-3 text-xs leading-relaxed space-y-0.5",
              m.role==="user" ? "bg-zinc-800 text-white rounded-br-none" : "bg-white text-zinc-700 border border-zinc-100 shadow-sm rounded-bl-none"
            )}>
              {renderMsg(m.content)}
            </div>
          </motion.div>
        ))}
        {loading && (
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-teal-600 flex items-center justify-center"><Icons.Zap /></div>
            <div className="bg-white border border-zinc-100 rounded-2xl rounded-bl-none px-4 py-3 flex gap-1.5 shadow-sm">
              {[0,150,300].map(d=><div key={d} className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-bounce" style={{animationDelay:`${d}ms`}}/>)}
            </div>
          </div>
        )}
      </div>

      {/* Quick prompts */}
      <div className="bg-white border-x border-zinc-200 px-4 py-2 flex gap-2 overflow-x-auto">
        {QUICK.map((q,i) => (
          <button key={i} onClick={() => { setInput(q); inputRef.current?.focus(); }} className="shrink-0 bg-zinc-50 hover:bg-teal-50 hover:text-teal-700 border border-zinc-200 hover:border-teal-200 rounded-full px-3 py-1 text-[10px] font-medium text-zinc-500 transition-all whitespace-nowrap">
            {q}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="bg-white border border-zinc-200 rounded-b-2xl p-3 flex gap-3 items-end">
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if(e.key==="Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }}}
          placeholder="Type here... e.g. 'bro tracker not working', 'create locator request abu dhabi', 'assign athul to svc-002'"
          className="flex-1 bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 text-xs text-zinc-800 resize-none focus:outline-none focus:border-teal-500/50 transition-all leading-relaxed"
          style={{minHeight:"40px", maxHeight:"120px"}}
        />
        <button onClick={handleSend} disabled={loading || !input.trim()} className="w-10 h-10 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-30 disabled:cursor-not-allowed text-white flex items-center justify-center transition-all shrink-0">
          <Icons.Send />
        </button>
      </div>
    </div>
  );
};

// ─── STAT CARD ────────────────────────────────────────────────────────────────
const StatCard = ({ label, value, icon: Icon, sub, color="teal" }) => (
  <div className={cn("bg-white border border-zinc-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow")}>
    <div className="flex items-center justify-between mb-3">
      <div className={cn("p-2 rounded-lg", color==="teal" ? "bg-teal-50" : color==="amber" ? "bg-amber-50" : "bg-zinc-50")}>
        <Icon />
      </div>
      {sub && <span className={cn("text-[10px] font-bold uppercase tracking-wider", color==="teal"?"text-teal-600":color==="amber"?"text-amber-600":"text-zinc-500")}>{sub}</span>}
    </div>
    <div className="text-2xl font-bold text-zinc-900">{value}</div>
    <div className="text-xs text-zinc-400 mt-0.5 font-medium">{label}</div>
  </div>
);

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [db, setDb] = useState({ customers: SEED_CUSTOMERS, leads: SEED_LEADS, services: SEED_SERVICES });
  const [search, setSearch] = useState("");

  // New form state
  const [newLeadForm, setNewLeadForm] = useState(defaultLead());
  const [newTicketForm, setNewTicketForm] = useState(defaultTicket());
  const [newFormMode, setNewFormMode] = useState("lead"); // "lead" | "ticket"
  const [newFormSuccess, setNewFormSuccess] = useState(false);

  // Existing form: search & select lead/ticket
  const [existingSearch, setExistingSearch] = useState("");
  const [existingType, setExistingType] = useState("lead");
  const [selectedExisting, setSelectedExisting] = useState(null);
  const [existingForm, setExistingForm] = useState(null);

  // DB Manager
  const [dbTab, setDbTab] = useState("leads");
  const [dbSearch, setDbSearch] = useState("");
  const [editItem, setEditItem] = useState(null);

  // Modals
  const [showNewLeadModal, setShowNewLeadModal] = useState(false);
  const [showNewTicketModal, setShowNewTicketModal] = useState(false);

  // ── CRUD ──
  const saveLead = async (e) => {
    e.preventDefault();
    const newId = Math.max(0, ...db.leads.map(l=>l.id)) + 1;
    const rec = { ...newLeadForm, id: newId, createdAt: new Date().toISOString().split('T')[0] };
    setDb(prev => ({ ...prev, leads: [...prev.leads, rec] }));
    setNewLeadForm(defaultLead());
    setNewFormSuccess(true);
    setTimeout(() => setNewFormSuccess(false), 3000);
  };
  const saveTicket = async (e) => {
    e.preventDefault();
    const newId = Math.max(0, ...db.services.map(s=>s.id)) + 1;
    const rec = { ...newTicketForm, id: newId, ticketId:`SVC-${String(newId).padStart(3,'0')}`, invoiceStatus:"Not Invoiced", paymentStatus:"Not Paid", createdAt: new Date().toISOString().split('T')[0] };
    setDb(prev => ({ ...prev, services: [...prev.services, rec] }));
    setNewTicketForm(defaultTicket());
    setNewFormSuccess(true);
    setTimeout(() => setNewFormSuccess(false), 3000);
  };
  const saveExisting = async (e) => {
    e.preventDefault();
    if (!selectedExisting) return;
    if (existingType === "lead") {
      setDb(prev => ({ ...prev, leads: prev.leads.map(l => l.id === existingForm.id ? existingForm : l) }));
    } else {
      setDb(prev => ({ ...prev, services: prev.services.map(s => s.id === existingForm.id ? existingForm : s) }));
    }
    setNewFormSuccess(true);
    setTimeout(() => setNewFormSuccess(false), 3000);
  };
  const deleteItem = (type, id) => {
    if (!confirm("Delete this record?")) return;
    if (type === "lead") setDb(prev => ({ ...prev, leads: prev.leads.filter(l=>l.id!==id) }));
    else if (type === "service") setDb(prev => ({ ...prev, services: prev.services.filter(s=>s.id!==id) }));
    else setDb(prev => ({ ...prev, customers: prev.customers.filter(c=>c.id!==id) }));
    setEditItem(null);
  };
  const saveEditItem = (e) => {
    e.preventDefault();
    if (editItem.type === "lead") setDb(prev => ({ ...prev, leads: prev.leads.map(l => l.id===editItem.data.id ? editItem.data : l) }));
    else if (editItem.type === "service") setDb(prev => ({ ...prev, services: prev.services.map(s => s.id===editItem.data.id ? editItem.data : s) }));
    else setDb(prev => ({ ...prev, customers: prev.customers.map(c => c.id===editItem.data.id ? editItem.data : c) }));
    setEditItem(null);
  };

  const nav = [
    { id:"dashboard", label:"Dashboard", icon:Icons.Dashboard },
    { id:"new-form", label:"New Form", icon:Icons.Plus },
    { id:"existing-form", label:"Existing Form", icon:Icons.Edit },
    { id:"ai", label:"SynoAI Chat", icon:Icons.Bot },
    { id:"db-manager", label:"Data Manager", icon:Icons.DB },
  ];

  const pendingTickets = db.services.filter(s=>s.status==="New"||s.status==="Hold").length;
  const wonLeads = db.leads.filter(l=>l.status==="Won").length;

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-zinc-800">
      {/* ── SIDEBAR ── */}
      <aside className="w-60 bg-white border-r border-zinc-200 flex flex-col shadow-sm z-20">
        <div className="px-6 py-6 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-teal-600 flex items-center justify-center shadow-lg shadow-teal-600/30">
              <Icons.Shield />
            </div>
            <div>
              <div className="font-black text-zinc-900 text-base tracking-tight">SynoHub</div>
              <div className="text-[9px] text-zinc-400 font-bold uppercase tracking-widest">Fleet Intelligence</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-0.5">
          {nav.map(item => (
            <button key={item.id} onClick={() => setTab(item.id)} className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold transition-all",
              tab===item.id ? "bg-teal-600 text-white shadow-md shadow-teal-600/20" : "text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100"
            )}>
              <item.icon />
              {item.label}
              {item.id==="ai" && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse"/>}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-zinc-100">
          <div className="bg-teal-50 rounded-xl p-3 border border-teal-100">
            <div className="text-[9px] font-bold text-teal-600 uppercase tracking-widest mb-1">Live DB Stats</div>
            <div className="space-y-1 text-[10px] text-zinc-600">
              <div className="flex justify-between"><span>Leads</span><span className="font-bold">{db.leads.length}</span></div>
              <div className="flex justify-between"><span>Tickets</span><span className="font-bold">{db.services.length}</span></div>
              <div className="flex justify-between"><span>Customers</span><span className="font-bold">{db.customers.length}</span></div>
            </div>
          </div>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <main className="flex-1 overflow-y-auto">
        {/* Header */}
        <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-zinc-200 px-8 py-4 flex items-center justify-between">
          <h2 className="font-black text-zinc-900 text-base capitalize">{nav.find(n=>n.id===tab)?.label}</h2>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Icons.Search />
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Global search..." className="bg-zinc-50 border border-zinc-200 rounded-xl py-2 pl-8 pr-4 text-xs font-medium focus:outline-none focus:border-teal-500/30 w-56 absolute right-0 top-1/2 -translate-y-1/2 opacity-0 focus:opacity-100 transition-all"/>
            </div>
            <button onClick={() => { setShowNewLeadModal(true); }} className="bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-2 shadow-md shadow-teal-600/20 transition-all">
              <Icons.Plus /><span>New Lead</span>
            </button>
            <button onClick={() => { setShowNewTicketModal(true); }} className="bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-2 transition-all">
              <Icons.Ticket /><span>New Ticket</span>
            </button>
          </div>
        </header>

        <div className="p-8">
          <AnimatePresence mode="wait">

            {/* ── DASHBOARD ── */}
            {tab === "dashboard" && (
              <motion.div key="dashboard" initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-10}} className="space-y-8">
                <div className="grid grid-cols-4 gap-5">
                  <StatCard label="Total Leads" value={db.leads.length} icon={Icons.Users} sub="CRM" />
                  <StatCard label="Won Deals" value={wonLeads} icon={Icons.Check} sub="Closed" color="teal" />
                  <StatCard label="Service Queue" value={db.services.length} icon={Icons.Ticket} sub="Tickets" color="amber" />
                  <StatCard label="Active Customers" value={db.customers.length} icon={Icons.Truck} />
                </div>

                <div className="grid grid-cols-3 gap-6">
                  {/* Recent Leads */}
                  <div className="col-span-2 bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
                      <h3 className="font-bold text-zinc-800 text-sm">Recent Lead Registrations</h3>
                      <button onClick={()=>setTab("db-manager")} className="text-teal-600 text-xs font-bold hover:underline">View All →</button>
                    </div>
                    <table className="w-full text-xs">
                      <thead className="bg-zinc-50 text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                        <tr>{["Company Name","Contact","Region","Sales Agent","Status"].map(h=><th key={h} className="px-5 py-3 text-left">{h}</th>)}</tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-50">
                        {db.leads.slice(-6).reverse().map(l=>(
                          <tr key={l.id} className="hover:bg-zinc-50/60 transition-colors">
                            <td className="px-5 py-3 font-semibold text-zinc-900">{l.customerName}</td>
                            <td className="px-5 py-3 text-zinc-500">{l.contactName}</td>
                            <td className="px-5 py-3"><span className="bg-zinc-100 text-zinc-600 rounded px-1.5 py-0.5 text-[10px] font-bold">{l.region}</span></td>
                            <td className="px-5 py-3 text-zinc-600">{l.salesPerson}</td>
                            <td className="px-5 py-3"><span className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold", statusColor(l.status))}>{l.status}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Service Tickets */}
                  <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-zinc-100">
                      <h3 className="font-bold text-zinc-800 text-sm">Service Tickets</h3>
                      {pendingTickets > 0 && <div className="text-[10px] text-amber-600 font-bold mt-0.5">{pendingTickets} pending action</div>}
                    </div>
                    <div className="divide-y divide-zinc-50">
                      {db.services.slice(-5).reverse().map(s=>(
                        <div key={s.id} className="px-5 py-3 hover:bg-zinc-50 transition-colors">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-bold text-[11px] text-zinc-800 font-mono">{s.ticketId}</span>
                            <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full", statusColor(s.status))}>{s.status}</span>
                          </div>
                          <div className="text-[10px] text-zinc-600 font-semibold">{s.customerName}</div>
                          <div className="text-[9px] text-zinc-400 mt-0.5 truncate">{s.description?.substring(0,55)}...</div>
                          {s.assignee && <div className="text-[9px] text-teal-600 font-bold mt-1">→ {s.assignee}</div>}
                        </div>
                      ))}
                      {db.services.length === 0 && <div className="p-8 text-center text-zinc-400 text-xs">No tickets yet</div>}
                    </div>
                  </div>
                </div>

                {/* Note about field naming */}
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-800">
                  <strong>📌 Field Naming Note:</strong> In <em>Leads</em>, "Company Name" = the prospect's company (formerly labeled "Customer Name" — now unified). In <em>Customers</em>, "Company Name" is the same field for established clients. These refer to the same concept at different pipeline stages — not a mistake, but now consistently labeled.
                </div>
              </motion.div>
            )}

            {/* ── NEW FORM ── */}
            {tab === "new-form" && (
              <motion.div key="new-form" initial={{opacity:0,scale:0.99}} animate={{opacity:1,scale:1}} exit={{opacity:0}} className="max-w-5xl mx-auto">
                {/* Mode toggle */}
                <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
                  <div className="bg-zinc-50 border-b border-zinc-200 px-5 py-3 flex items-center justify-between">
                    <div className="flex bg-zinc-100 p-1 rounded-xl gap-1">
                      <button onClick={()=>{setNewFormMode("lead");setNewFormSuccess(false);}} className={cn("px-5 py-2 rounded-lg text-xs font-bold transition-all",newFormMode==="lead"?"bg-white text-teal-700 shadow-sm":"text-zinc-500 hover:text-zinc-700")}>Lead Registration</button>
                      <button onClick={()=>{setNewFormMode("ticket");setNewFormSuccess(false);}} className={cn("px-5 py-2 rounded-lg text-xs font-bold transition-all",newFormMode==="ticket"?"bg-white text-zinc-900 shadow-sm":"text-zinc-500 hover:text-zinc-700")}>Service Ticket</button>
                    </div>
                    <span className="text-[10px] text-zinc-400">{new Date().toLocaleDateString('en-GB')}</span>
                  </div>

                  <div className="p-6">
                    {newFormSuccess && (
                      <motion.div initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}} className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-5 text-xs text-emerald-700 font-bold flex items-center gap-2">
                        <Icons.Check />Record saved successfully to database!
                      </motion.div>
                    )}
                    {newFormMode === "lead"
                      ? <LeadFormBody form={newLeadForm} setForm={setNewLeadForm} customers={db.customers} onSubmit={saveLead} submitLabel="SAVE LEAD" />
                      : <TicketFormBody form={newTicketForm} setForm={setNewTicketForm} customers={db.customers} onSubmit={saveTicket} submitLabel="CREATE TICKET" />
                    }
                  </div>
                </div>
              </motion.div>
            )}

            {/* ── EXISTING FORM ── */}
            {tab === "existing-form" && (
              <motion.div key="existing-form" initial={{opacity:0,scale:0.99}} animate={{opacity:1,scale:1}} exit={{opacity:0}} className="max-w-5xl mx-auto space-y-5">
                {/* Search & Select */}
                <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5">
                  <div className="flex items-center gap-4">
                    <div className="flex bg-zinc-100 p-1 rounded-xl gap-1">
                      <button onClick={()=>{setExistingType("lead");setSelectedExisting(null);setExistingForm(null);}} className={cn("px-4 py-1.5 rounded-lg text-xs font-bold transition-all",existingType==="lead"?"bg-white text-teal-700 shadow-sm":"text-zinc-500")}>Leads ({db.leads.length})</button>
                      <button onClick={()=>{setExistingType("ticket");setSelectedExisting(null);setExistingForm(null);}} className={cn("px-4 py-1.5 rounded-lg text-xs font-bold transition-all",existingType==="ticket"?"bg-white text-zinc-900 shadow-sm":"text-zinc-500")}>Tickets ({db.services.length})</button>
                    </div>
                    <div className="relative flex-1">
                      <input value={existingSearch} onChange={e=>setExistingSearch(e.target.value)} placeholder={`Search ${existingType === "lead" ? "leads by company/contact..." : "tickets by customer/ID..."}`} className="w-full bg-zinc-50 border border-zinc-200 rounded-xl py-2 pl-4 pr-4 text-xs font-medium focus:outline-none focus:border-teal-500/30"/>
                    </div>
                    {selectedExisting && <button onClick={()=>{setSelectedExisting(null);setExistingForm(null);}} className="text-xs text-red-500 font-bold hover:underline">Clear</button>}
                  </div>

                  {/* Results */}
                  {existingSearch && !selectedExisting && (
                    <div className="mt-3 border border-zinc-200 rounded-xl overflow-hidden">
                      {(existingType === "lead" ? db.leads.filter(l=>l.customerName.toLowerCase().includes(existingSearch.toLowerCase())||l.contactName?.toLowerCase().includes(existingSearch.toLowerCase())) : db.services.filter(s=>s.customerName.toLowerCase().includes(existingSearch.toLowerCase())||s.ticketId.toLowerCase().includes(existingSearch.toLowerCase()))).slice(0,6).map(item=>(
                        <button key={item.id} onClick={()=>{setSelectedExisting(item.id);setExistingForm({...item});setExistingSearch("");}} className="w-full flex items-center gap-4 px-4 py-3 hover:bg-teal-50 transition-colors text-left border-b border-zinc-50 last:border-0">
                          <div className="flex-1">
                            <div className="font-semibold text-xs text-zinc-900">{item.customerName}</div>
                            <div className="text-[10px] text-zinc-400">{existingType==="lead" ? `${item.contactName} · ${item.region}` : `${item.ticketId} · ${item.status}`}</div>
                          </div>
                          <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-bold", statusColor(item.status))}>{item.status}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Edit Form */}
                {existingForm && (
                  <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
                    <div className="bg-zinc-50 border-b border-zinc-200 px-5 py-3 flex items-center justify-between">
                      <div>
                        <div className="font-bold text-zinc-800 text-sm">{existingForm.customerName}</div>
                        <div className="text-[10px] text-zinc-400">{existingType==="lead" ? `Lead #${existingForm.id}` : `Ticket ${existingForm.ticketId}`}</div>
                      </div>
                      <button onClick={()=>deleteItem(existingType==="lead"?"lead":"service", existingForm.id)} className="text-red-500 hover:text-red-700 text-xs font-bold flex items-center gap-1">
                        <Icons.Trash /> Delete Record
                      </button>
                    </div>
                    <div className="p-6">
                      {newFormSuccess && (
                        <motion.div initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}} className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-5 text-xs text-emerald-700 font-bold flex items-center gap-2">
                          <Icons.Check />Changes saved successfully!
                        </motion.div>
                      )}
                      {existingType === "lead"
                        ? <LeadFormBody form={existingForm} setForm={f=>setExistingForm(typeof f==="function"?f(existingForm):f)} customers={db.customers} onSubmit={saveExisting} submitLabel="UPDATE LEAD" isExisting />
                        : <TicketFormBody form={existingForm} setForm={f=>setExistingForm(typeof f==="function"?f(existingForm):f)} customers={db.customers} onSubmit={saveExisting} submitLabel="UPDATE TICKET" />
                      }
                    </div>
                  </div>
                )}
                {!existingForm && !existingSearch && (
                  <div className="text-center py-16 text-zinc-400">
                    <Icons.Search />
                    <p className="text-sm font-medium mt-3">Search for a {existingType} to edit</p>
                    <p className="text-xs mt-1">Type in the search box above to find records</p>
                  </div>
                )}
              </motion.div>
            )}

            {/* ── AI CHAT ── */}
            {tab === "ai" && (
              <motion.div key="ai" initial={{opacity:0,scale:0.98}} animate={{opacity:1,scale:1}} exit={{opacity:0}}>
                <SynoAIChat db={db} setDb={setDb} />
              </motion.div>
            )}

            {/* ── DB MANAGER ── */}
            {tab === "db-manager" && (
              <motion.div key="db-manager" initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} exit={{opacity:0}} className="space-y-6">
                <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
                  <div className="p-4 border-b border-zinc-100 bg-zinc-50/60 flex items-center gap-4 flex-wrap">
                    <div className="flex bg-zinc-100 p-1 rounded-xl gap-1">
                      {[["leads","Leads"],["services","Tickets"],["customers","Customers"]].map(([k,l])=>(
                        <button key={k} onClick={()=>{setDbTab(k);setDbSearch("");}} className={cn("px-4 py-2 rounded-lg text-xs font-extrabold uppercase tracking-wider transition-all",dbTab===k?"bg-white text-zinc-900 shadow-sm":"text-zinc-500 hover:text-zinc-700")}>
                          {l} ({k==="leads"?db.leads.length:k==="services"?db.services.length:db.customers.length})
                        </button>
                      ))}
                    </div>
                    <div className="relative flex-1 min-w-48">
                      <input value={dbSearch} onChange={e=>setDbSearch(e.target.value)} placeholder={`Search ${dbTab}...`} className="w-full bg-white border border-zinc-200 rounded-xl py-2 pl-8 pr-4 text-xs font-medium focus:outline-none focus:border-teal-500/40"/>
                      <Icons.Search />
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    {/* LEADS TABLE */}
                    {dbTab === "leads" && (
                      <table className="w-full text-xs">
                        <thead className="bg-zinc-50 text-[10px] text-zinc-400 font-bold uppercase tracking-wider border-b border-zinc-100">
                          <tr>{["#","Company Name","Contact Name","Phone","Region","Sales Agent","Status","Qty","Actions"].map(h=><th key={h} className="px-5 py-3.5 text-left">{h}</th>)}</tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-50 text-zinc-700">
                          {db.leads.filter(l=>l.customerName.toLowerCase().includes(dbSearch.toLowerCase())||l.contactName?.toLowerCase().includes(dbSearch.toLowerCase())).map(l=>(
                            <tr key={l.id} className="hover:bg-zinc-50/50">
                              <td className="px-5 py-3 text-zinc-400 font-mono">#{l.id}</td>
                              <td className="px-5 py-3 font-bold text-zinc-900">{l.customerName}</td>
                              <td className="px-5 py-3 text-zinc-500">{l.contactName||"—"}</td>
                              <td className="px-5 py-3 text-zinc-500">{l.phone}</td>
                              <td className="px-5 py-3"><span className="bg-zinc-100 rounded px-1.5 py-0.5 text-[10px] font-bold">{l.region}</span></td>
                              <td className="px-5 py-3">{l.salesPerson}</td>
                              <td className="px-5 py-3"><span className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold",statusColor(l.status))}>{l.status}</span></td>
                              <td className="px-5 py-3 font-mono font-bold text-zinc-500">{(l.newQty||0)+(l.migrateQty||0)+(l.tradingQty||0)}</td>
                              <td className="px-5 py-3 flex gap-3">
                                <button onClick={()=>{setTab("existing-form");setExistingType("lead");setSelectedExisting(l.id);setExistingForm({...l});}} className="text-teal-600 font-bold hover:text-teal-800 flex items-center gap-1"><Icons.Pen/>Edit</button>
                                <button onClick={()=>deleteItem("lead",l.id)} className="text-red-500 font-bold hover:text-red-700 flex items-center gap-1"><Icons.Trash/>Del</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {/* SERVICES TABLE */}
                    {dbTab === "services" && (
                      <table className="w-full text-xs">
                        <thead className="bg-zinc-50 text-[10px] text-zinc-400 font-bold uppercase tracking-wider border-b border-zinc-100">
                          <tr>{["Ticket ID","Company Name","Description","Status","Qty","Assignee","Payment","Amount","Actions"].map(h=><th key={h} className="px-5 py-3.5 text-left">{h}</th>)}</tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-50 text-zinc-700">
                          {db.services.filter(s=>s.customerName.toLowerCase().includes(dbSearch.toLowerCase())||s.ticketId.toLowerCase().includes(dbSearch.toLowerCase())).map(s=>(
                            <tr key={s.id} className="hover:bg-zinc-50/50">
                              <td className="px-5 py-3 font-mono font-bold text-teal-700">{s.ticketId}</td>
                              <td className="px-5 py-3 font-bold text-zinc-900">{s.customerName}</td>
                              <td className="px-5 py-3 text-zinc-500 max-w-xs truncate">{s.description}</td>
                              <td className="px-5 py-3"><span className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold",statusColor(s.status))}>{s.status}</span></td>
                              <td className="px-5 py-3 font-mono">{s.quantity}</td>
                              <td className="px-5 py-3 text-zinc-600">{s.assignee||<span className="text-zinc-300">—</span>}</td>
                              <td className="px-5 py-3"><span className={cn("text-[10px] font-bold",s.paymentStatus==="Paid"?"text-emerald-600":"text-amber-600")}>{s.paymentStatus}</span></td>
                              <td className="px-5 py-3 font-mono">{s.amount||"—"}</td>
                              <td className="px-5 py-3 flex gap-3">
                                <button onClick={()=>{setTab("existing-form");setExistingType("ticket");setSelectedExisting(s.id);setExistingForm({...s});}} className="text-teal-600 font-bold hover:text-teal-800 flex items-center gap-1"><Icons.Pen/>Edit</button>
                                <button onClick={()=>deleteItem("service",s.id)} className="text-red-500 font-bold hover:text-red-700 flex items-center gap-1"><Icons.Trash/>Del</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {/* CUSTOMERS TABLE */}
                    {dbTab === "customers" && (
                      <table className="w-full text-xs">
                        <thead className="bg-zinc-50 text-[10px] text-zinc-400 font-bold uppercase tracking-wider border-b border-zinc-100">
                          <tr>{["#","Company Name","Contact Person","Phone","Email","Region","Vehicle Count","Impl. Type","Actions"].map(h=><th key={h} className="px-5 py-3.5 text-left">{h}</th>)}</tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-50 text-zinc-700">
                          {db.customers.filter(c=>c.name.toLowerCase().includes(dbSearch.toLowerCase())||c.contactName?.toLowerCase().includes(dbSearch.toLowerCase())).map(c=>(
                            <tr key={c.id} className="hover:bg-zinc-50/50">
                              <td className="px-5 py-3 text-zinc-400 font-mono">#{c.id}</td>
                              <td className="px-5 py-3 font-bold text-zinc-900">{c.name}</td>
                              <td className="px-5 py-3 text-zinc-500">{c.contactName||"—"}</td>
                              <td className="px-5 py-3 text-zinc-500">{c.phone||"—"}</td>
                              <td className="px-5 py-3 text-zinc-500">{c.email||"—"}</td>
                              <td className="px-5 py-3"><span className="bg-zinc-100 rounded px-1.5 py-0.5 text-[10px] font-bold">{c.region||"—"}</span></td>
                              <td className="px-5 py-3 font-bold text-teal-600 font-mono">{c.vehicleCount} units</td>
                              <td className="px-5 py-3 text-zinc-500">{c.implementationType||"—"}</td>
                              <td className="px-5 py-3 flex gap-3">
                                <button onClick={()=>setEditItem({type:"customer",data:{...c}})} className="text-teal-600 font-bold hover:text-teal-800 flex items-center gap-1"><Icons.Pen/>Edit</button>
                                <button onClick={()=>deleteItem("customer",c.id)} className="text-red-500 font-bold hover:text-red-700 flex items-center gap-1"><Icons.Trash/>Del</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </main>

      {/* ── QUICK NEW LEAD MODAL ── */}
      <Modal isOpen={showNewLeadModal} onClose={()=>setShowNewLeadModal(false)} title="Quick New Lead Registration" wide>
        <LeadFormBody form={newLeadForm} setForm={setNewLeadForm} customers={db.customers} onSubmit={async(e)=>{await saveLead(e);setShowNewLeadModal(false);}} submitLabel="SAVE & CLOSE" />
      </Modal>

      {/* ── QUICK NEW TICKET MODAL ── */}
      <Modal isOpen={showNewTicketModal} onClose={()=>setShowNewTicketModal(false)} title="Create Service Ticket">
        <TicketFormBody form={newTicketForm} setForm={setNewTicketForm} customers={db.customers} onSubmit={async(e)=>{await saveTicket(e);setShowNewTicketModal(false);}} submitLabel="CREATE TICKET" />
      </Modal>

      {/* ── EDIT CUSTOMER MODAL ── */}
      <Modal isOpen={!!editItem} onClose={()=>setEditItem(null)} title={editItem ? `Edit ${editItem.type==="customer"?"Customer":"Record"}` : ""}>
        {editItem && editItem.type === "customer" && (
          <form onSubmit={saveEditItem} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <F label="Company Name" required><input required value={editItem.data.name||""} onChange={e=>setEditItem(p=>({...p,data:{...p.data,name:e.target.value}}))} className={inp}/></F>
              <F label="Contact Person"><input value={editItem.data.contactName||""} onChange={e=>setEditItem(p=>({...p,data:{...p.data,contactName:e.target.value}}))} className={inp}/></F>
              <F label="Phone"><input value={editItem.data.phone||""} onChange={e=>setEditItem(p=>({...p,data:{...p.data,phone:e.target.value}}))} className={inp}/></F>
              <F label="Email"><input type="email" value={editItem.data.email||""} onChange={e=>setEditItem(p=>({...p,data:{...p.data,email:e.target.value}}))} className={inp}/></F>
              <F label="Region"><select value={editItem.data.region||""} onChange={e=>setEditItem(p=>({...p,data:{...p.data,region:e.target.value}}))} className={inp}>{REGIONS.map(r=><option key={r}>{r}</option>)}</select></F>
              <F label="Implementation Type"><select value={editItem.data.implementationType||""} onChange={e=>setEditItem(p=>({...p,data:{...p.data,implementationType:e.target.value}}))} className={inp}><option value="">—</option>{IMPL_TYPES.map(t=><option key={t}>{t}</option>)}</select></F>
              <F label="Vehicle Count"><input type="number" min="0" value={editItem.data.vehicleCount||0} onChange={e=>setEditItem(p=>({...p,data:{...p.data,vehicleCount:parseInt(e.target.value)||0}}))} className={inp}/></F>
            </div>
            <div className="flex justify-end gap-3 pt-3 border-t border-zinc-100">
              <button type="button" onClick={()=>setEditItem(null)} className="px-4 py-2 border border-zinc-200 rounded-lg text-xs font-bold text-zinc-500 hover:bg-zinc-50">Cancel</button>
              <button type="submit" className="px-6 py-2 bg-teal-600 text-white rounded-lg text-xs font-bold hover:bg-teal-700 shadow-md shadow-teal-600/20">Save Changes</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}