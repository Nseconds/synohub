interface ServiceRequestsPageProps {
  editingItem: any;
  setEditingItem: (item: any) => void;
  ticketStatuses: string[];
  paymentOptions: string[];
}

export const ServiceRequestsPage = ({
  editingItem,
  setEditingItem,
  ticketStatuses,
  paymentOptions,
}: ServiceRequestsPageProps) => (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    <div>
      <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Customer Name</label>
      <input type="text" required value={editingItem.data.customerName || ""} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, customerName: e.target.value}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs font-semibold" />
    </div>
    <div>
      <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Status</label>
      <select value={editingItem.data.status || "New"} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, status: e.target.value}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs font-semibold">
        {ticketStatuses.map(ts => <option key={ts} value={ts}>{ts}</option>)}
      </select>
    </div>
    <div>
      <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Qty</label>
      <input type="number" value={editingItem.data.quantity || 1} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, quantity: parseInt(e.target.value || '1')}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs font-semibold" />
    </div>
    <div>
      <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Payment Option</label>
      <select value={editingItem.data.payment || ""} onChange={e => setEditingItem({...editingItem, data: {...editingItem.data, payment: e.target.value}})} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2 text-xs font-semibold">
        {paymentOptions.map(po => <option key={po} value={po}>{po}</option>)}
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
);
