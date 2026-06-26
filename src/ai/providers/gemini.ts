export async function runGeminiChatCompletion(args: {
  genAI: any;
  model: string;
  systemInstruction: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  message: string;
}): Promise<string> {
  const conversation = [
    ...args.history.map(h => `${h.role === "assistant" ? "Assistant" : "User"}: ${h.content}`),
    `User: ${args.message}`,
  ].join("\n\n");

  const response = await args.genAI.models.generateContent({
    model: args.model,
    contents: conversation,
    config: {
      systemInstruction: args.systemInstruction,
    },
  });

  return response.text;
}
