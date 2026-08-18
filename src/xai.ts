import { z } from "zod";
import { resolveXaiToken } from "./auth.js";

const ToolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});

const MessageSchema = z.object({
  role: z.enum(["assistant"]),
  content: z.string().nullable(),
  tool_calls: z.array(ToolCallSchema).optional(),
});

const CompletionSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable(),
        message: MessageSchema,
      })
    )
    .min(1),
});

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: z.infer<typeof ToolCallSchema>[];
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatResult {
  content: string | null;
  toolCalls: z.infer<typeof ToolCallSchema>[];
}

export async function chat(messages: ChatMessage[], tools: ToolDef[]): Promise<ChatResult> {
  const key = await resolveXaiToken();
  const model = process.env.XAI_MODEL ?? "grok-4-1-fast-reasoning";
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages,
      tools: tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
    }),
  });
  const json: unknown = await res.json();
  if (!res.ok) {
    throw new Error(`xAI HTTP ${res.status}: ${JSON.stringify(json)}`);
  }
  const parsed = CompletionSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`xAI response failed validation: ${parsed.error.message}`);
  }
  const choice = parsed.data.choices[0];
  if (!choice) {
    throw new Error("xAI returned no choices");
  }
  return {
    content: choice.message.content,
    toolCalls: choice.message.tool_calls ?? [],
  };
}
