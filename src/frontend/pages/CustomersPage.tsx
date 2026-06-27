import { Search } from "lucide-react";

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
  salesPerson: string;
  requestedPerson?: string;
}

interface CustomersPageProps {
  searchTerm: string;
  customers: Customer[];
  registrations: Registration[];
  actionLabel: string;
  onSelectCustomer: (customer: Customer) => void;
}

export const CustomersPage = ({
  searchTerm,
  customers,
  registrations,
  actionLabel,
  onSelectCustomer,
}: CustomersPageProps) => (
  <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden shadow-md mb-6">
    <div className="bg-[#00ADC6]/5 border-b border-[#00ADC6]/10 px-4 py-2.5 flex items-center justify-between">
      <span className="text-[11px] font-bold text-[#00ADC6] flex items-center gap-1.5 uppercase tracking-wider">
        <Search size={12} /> Matched Customer Accounts For "{searchTerm}"
      </span>
      <span className="text-[10px] font-mono text-zinc-500 font-bold">{customers.length} Found</span>
    </div>
    {customers.length === 0 ? (
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
              <th className="px-4 py-2 bg-zinc-50">Requested Person</th>
              <th className="px-4 py-2 bg-zinc-50">Contact Name</th>
              <th className="px-4 py-2 bg-zinc-50">Phone</th>
              <th className="px-4 py-2 bg-zinc-50">Locator Username</th>
              <th className="px-4 py-2 bg-zinc-50">Locator Status</th>
              <th className="px-4 py-2 bg-zinc-50 text-center">Vehicle Count</th>
              <th className="px-4 py-2 text-center bg-zinc-50">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 text-zinc-650">
            {customers.map(cust => {
              const latestRequest = [...registrations].reverse().find(r => r && r.customerName && cust && cust.name && (r.customerName || "").toLowerCase() === (cust.name || "").toLowerCase());
              const salesPersonVal = latestRequest?.salesPerson || "Unassigned";
              const requestedPersonVal = latestRequest?.requestedPerson || "Unassigned";
              const locatorUsername = cust.name ? cust.name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) : "temco";
              const locatorStatus = "active";

              return (
                <tr key={cust.id} className="hover:bg-teal-50/40 hover:text-zinc-950 transition-colors cursor-pointer" onClick={() => onSelectCustomer(cust)}>
                  <td className="px-4 py-2 font-bold text-zinc-900">{cust.name}</td>
                  <td className="px-4 py-2 font-medium">
                    <span className="bg-zinc-100 text-zinc-700 px-1.5 py-0.5 rounded text-[10px] font-semibold">{cust.implementationType || "LOCATOR"}</span>
                  </td>
                  <td className="px-4 py-2 font-medium text-zinc-650">{salesPersonVal}</td>
                  <td className="px-4 py-2 font-medium text-zinc-650">{requestedPersonVal}</td>
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
                        onSelectCustomer(cust);
                      }}
                      className="bg-[#00ADC6] hover:opacity-90 text-white font-bold text-[9px] px-2 py-1 rounded shadow-sm uppercase tracking-wide cursor-pointer"
                    >
                      {actionLabel}
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
);
