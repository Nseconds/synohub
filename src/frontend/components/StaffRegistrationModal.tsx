import { Zap } from "lucide-react";
import { motion } from "motion/react";

interface StaffRegistrationModalProps {
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export const StaffRegistrationModal = ({
  name,
  onCancel,
  onConfirm,
}: StaffRegistrationModalProps) => (
  <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
    <div className="absolute inset-0 bg-zinc-950/40 backdrop-blur-sm" onClick={onCancel} />
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
        We detected a self-introduction from <strong className="text-zinc-900 font-semibold">{name}</strong> in the conversation.
        Would you like to register them as a new SynoHub Fleet Coordinator, update all CRM dropdown forms with their name, and default newly drafted lead registrations or service tickets to them as the Requested Person?
      </p>

      <div className="flex gap-3 justify-end text-[11px]">
        <button 
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-zinc-200 hover:bg-zinc-50 rounded-lg font-bold text-zinc-600 transition"
        >
          No, Cancel
        </button>
        <button 
          type="button"
          onClick={onConfirm}
          className="px-4 py-2 bg-[#0EA5E9] hover:bg-[#0284C7] text-white rounded-lg font-bold shadow-sm transition"
        >
          Yes, Register Coordinator
        </button>
      </div>
    </motion.div>
  </div>
);
