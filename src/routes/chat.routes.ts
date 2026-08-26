import { Router } from "express";
import { z } from "zod";
import { ChatNotConfiguredError, getChatReply } from "../services/chat.service";

const router = Router();

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
});

const chatSchema = z.object({
  messages: z.array(messageSchema).min(1).max(30),
});

// POST /api/chat - stateless: the frontend sends the full conversation history each
// time (a lightweight assistant widget, not a persisted chat feature), so there's
// nothing to store server-side.
router.post("/", async (req, res, next) => {
  try {
    const { messages } = chatSchema.parse(req.body);
    const reply = await getChatReply(messages);
    res.json({ reply });
  } catch (err) {
    if (err instanceof ChatNotConfiguredError) {
      return res.status(503).json({ error: "The AI assistant isn't configured yet (no OPENAI_API_KEY set)." });
    }
    next(err);
  }
});

export default router;
