import { useEffect, useRef, useState } from "react";
import { fetchChatHistory, sendChatMessage, sendSafeQuery } from "../api/chatApi";
import { REQUESTED_PEOPLE } from "../constants/options";
import { ChatPage, type CompareProvider, type SafeQueryAiMode } from "../pages/ChatPage";
import type { Message } from "../types";
import { isSafeQueryMessage } from "../utils/chatQuery";

interface CurrentUser {
  name: string;
  role: string;
  token: string;
}

interface ChatInterfaceProps {
  onRecordSaved?: (savedRecord?: any) => void;
  onNewStaffDetected?: (name: string) => void;
  forcedInput?: string;
  onInputLoaded?: () => void;
  userKey?: string;
  currentUser?: CurrentUser | null;
  staffOptions?: string[];
}

export const ChatInterface = ({
  onRecordSaved,
  onNewStaffDetected,
  forcedInput,
  onInputLoaded,
  userKey,
  currentUser,
  staffOptions = REQUESTED_PEOPLE,
}: ChatInterfaceProps) => {
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
    setMessages(prev => [...prev, { role: "user", content: userMsg, username: messageChannel }]);
    setLoading(true);
    const sendScopeKey = chatScopeKey;

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
      setMessages(prev => [...prev, { role: "assistant", content: res.answer || res.reply, username: messageChannel }]);
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
      setMessages(prev => [...prev, { role: "assistant", content: errorMessage, username: messageChannel }]);
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
