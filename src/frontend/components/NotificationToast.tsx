import { CheckCircle2, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "../../lib/utils";

interface NotificationToastProps {
  notification: { message: string; type: "success" | "error" } | null;
  onClose: () => void;
}

export const NotificationToast = ({
  notification,
  onClose,
}: NotificationToastProps) => (
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
        <button onClick={onClose} className="ml-3 hover:opacity-75 transition-opacity text-zinc-400">
          <X size={14} />
        </button>
      </motion.div>
    )}
  </AnimatePresence>
);
