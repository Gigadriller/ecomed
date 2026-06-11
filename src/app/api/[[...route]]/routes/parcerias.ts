/**
 * POST /api/parcerias — recebe o formulário público de parceria e envia
 * por e-mail para parcerias@ecomed.eco.br via Resend.
 */
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { sendEmail } from "@/lib/email";
import { checkRateLimit } from "@/lib/ratelimit";

const PARCERIAS_EMAIL = "parcerias@ecomed.eco.br";

const parceriaSchema = z.object({
  nome: z.string().trim().min(3).max(120),
  email: z.string().trim().email().max(160),
  telefone: z.string().trim().min(8).max(30),
  cargo: z.string().trim().max(80).optional().default(""),
  organizacao: z.string().trim().min(2).max(160),
  tipoParceria: z.enum([
    "Farmácia",
    "Indústria Farmacêutica",
    "Escola / Universidade",
    "Secretaria de Saúde",
    "ONG Ambiental",
    "Outro",
  ]),
  cidadeEstado: z.string().trim().min(2).max(120),
  mensagem: z.string().trim().max(2000).optional().default(""),
});

const app = new Hono();

app.post("/", zValidator("json", parceriaSchema), async (c) => {
  const ip = c.req.header("CF-Connecting-IP") ?? c.req.header("x-forwarded-for") ?? "unknown";
  try {
    // Limite estrito: formulário público é alvo clássico de spam
    const { success } = await checkRateLimit("auth", ip);
    if (!success) {
      return c.json({ error: "Muitas tentativas. Aguarde um minuto e tente novamente." }, 429);
    }
  } catch (err) {
    console.warn("[parcerias] rate limit indisponível, prosseguindo:", err);
  }

  const dados = c.req.valid("json");

  try {
    await sendEmail("partnership-inquiry", PARCERIAS_EMAIL, dados);
    return c.json({ ok: true });
  } catch (err) {
    console.error("[parcerias] falha ao enviar e-mail:", err);
    return c.json(
      { error: "Não foi possível enviar agora. Tente novamente ou escreva para parcerias@ecomed.eco.br." },
      502,
    );
  }
});

export const parceriasRouter = app;
