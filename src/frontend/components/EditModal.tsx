import type React from "react";
import { Database, X } from "lucide-react";
import { motion } from "motion/react";
import { ServiceRequestsPage } from "../pages/ServiceRequestsPage";

interface EditModalProps {
  editingItem: any;
  setEditingItem: (item: any) => void;
  userRole?: string;
  onSubmit: (event: React.FormEvent) => void;
  regions: string[];
  leadStatuses: string[];
  implementationTypes: string[];
  salesPeople: string[];
  ticketStatuses: string[];
  paymentOptions: string[];
}

export const EditModal = ({
  editingItem,
  setEditingItem,
  userRole,
  onSubmit,
  regions,
  leadStatuses,
  implementationTypes,
  salesPeople,
  ticketStatuses,
  paymentOptions,
}: EditModalProps) => (
  <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
    <div className="absolute inset-0 bg-zinc-950/40 backdrop-blur-sm" onClick={() => setEditingItem(null)} />
    <motion.div 
      initial={{ opacity: 0, scale: 0.95, y: 15 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden z-10 flex flex-col max-h-[85vh]"
    >
      <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between bg-zinc-50">
        <h3 className="font-extrabold text-zinc-900 text-xs uppercase tracking-wider flex items-center gap-2">
          <Database size={14} className="text-teal-accent" /> Edit {editingItem.type === "lead" ? "Lead Registration" : editingItem.type === "service" ? "Service Ticket" : "Customer Account"}
        </h3>
        <button onClick={() => setEditingItem(null)} className="p-1.5 hover:bg-zinc-250 rounded-lg text-zinc-400">
          <X size={16} />
        </button>
      </div>
      
      <form onSubmit={onSubmit} className="p-6 overflow-y-auto space-y-4 text-xs">
        <fieldset disabled={userRole !== "admin"} className="space-y-4 w-full border-none p-0 m-0">
        
        {editingItem.type === "lead" && (
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
                {regions.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Status</label>
              <select value={editingItem.data.status || ""} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, status: e.target.value}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs font-semibold">
                {leadStatuses.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Implementation Type</label>
              <select value={editingItem.data.implementationType || ""} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, implementationType: e.target.value}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs font-semibold">
                {implementationTypes.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Sales Person</label>
              <select value={editingItem.data.salesPerson || ""} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, salesPerson: e.target.value}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs font-semibold">
                {salesPeople.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">New Qty</label>
              <input type="number" value={editingItem.data.newQty || 0} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, newQty: parseInt(e.target.value || "0")}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs font-semibold" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Migrate Qty</label>
              <input type="number" value={editingItem.data.migrateQty || 0} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, migrateQty: parseInt(e.target.value || "0")}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs font-semibold" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Comment</label>
              <textarea rows={2} value={editingItem.data.comment || ""} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, comment: e.target.value}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-3 text-xs font-semibold" />
            </div>
          </div>
        )}

        {editingItem.type === "service" && (
          <ServiceRequestsPage
            editingItem={editingItem}
            setEditingItem={setEditingItem}
            ticketStatuses={ticketStatuses}
            paymentOptions={paymentOptions}
          />
        )}

        {editingItem.type === "customer" && (
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
              <input type="number" value={editingItem.data.vehicleCount || 0} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, vehicleCount: parseInt(e.target.value || "0")}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs font-semibold" />
            </div>
          </div>
        )}
        </fieldset>

        <div className="flex justify-end gap-3 pt-4 border-t border-zinc-100">
          <button type="button" onClick={() => setEditingItem(null)} className="px-4 py-2 border border-zinc-200 rounded-lg text-zinc-500 font-bold text-[10px] uppercase hover:bg-zinc-50">Cancel</button>
          <button 
            type="submit" 
            disabled={userRole !== "admin"}
            className="px-6 py-2 bg-teal-accent disabled:bg-zinc-300 disabled:text-zinc-500 disabled:cursor-not-allowed disabled:shadow-none text-white rounded-lg font-bold text-[10px] uppercase hover:opacity-95 shadow-md shadow-teal-accent/10 whitespace-nowrap cursor-pointer"
          >
            {userRole !== "admin" ? "Read Only" : "Save Changes"}
          </button>
        </div>
      </form>
    </motion.div>
  </div>
);
