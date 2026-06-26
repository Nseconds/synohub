import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { messages } from "../db/schema";

export async function saveChatMessage(role: "user" | "assistant", content: string, username: string) {
  await db.insert(messages).values({
    role,
    content,
    username,
  });
}

export async function getRecentChatMessages(username: string, limit = 12) {
  return db.select().from(messages)
    .where(eq(messages.username, username))
    .orderBy(desc(messages.timestamp))
    .limit(limit);
}

export async function getChatMessagesByPredicate(predicate: any) {
  return db.select().from(messages)
    .where(predicate)
    .orderBy(messages.timestamp);
}
