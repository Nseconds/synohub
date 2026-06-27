import { motion } from "motion/react";
import { ChatInterface } from "../components/ChatInterface";

interface CurrentUser {
  name: string;
  role: string;
  token: string;
}

interface AiPageProps {
  user: CurrentUser | null;
  staffOptions: string[];
  forcedInput: string;
  onInputLoaded: () => void;
  onNewStaffDetected: (name: string) => void;
  onRecordSaved: (savedRecord?: any) => void;
}

export const AiPage = ({
  user,
  staffOptions,
  forcedInput,
  onInputLoaded,
  onNewStaffDetected,
  onRecordSaved,
}: AiPageProps) => (
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
      staffOptions={staffOptions}
      forcedInput={forcedInput}
      onInputLoaded={onInputLoaded}
      onNewStaffDetected={onNewStaffDetected}
      onRecordSaved={onRecordSaved}
    />
  </motion.div>
);
