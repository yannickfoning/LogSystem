import { z } from "zod";

// Zod schemas for different endpoints
export const loginSchema = z.object({
  email: z.string().email("Email invalide"),
  password: z.string().min(1, "Mot de passe requis"),
});

export const profileSchema = z.object({
  display_name: z.string().max(255).optional().nullable(),
});

export const passwordSchema = z.object({
  current_password: z.string().min(1, "Mot de passe actuel requis"),
  new_password: z
    .string()
    .min(12, "Le mot de passe doit faire au moins 12 caractères")
    .regex(/[A-Z]/, "Le mot de passe doit contenir au moins une majuscule")
    .regex(/[a-z]/, "Le mot de passe doit contenir au moins une minuscule")
    .regex(/\d/, "Le mot de passe doit contenir au moins un chiffre"),
});

export const importUploadSchema = z.object({
  source: z.string().max(100).optional().nullable(),
  service: z.string().max(100).optional().nullable(),
  locale: z.enum(["fr", "us", "iso"]).optional().nullable(),
});

export const createUserSchema = z.object({
  email: z.string().email("Email invalide"),
  password: z
    .string()
    .min(12, "Le mot de passe doit faire au moins 12 caractères")
    .regex(/[A-Z]/, "Le mot de passe doit contenir au moins une majuscule")
    .regex(/[a-z]/, "Le mot de passe doit contenir au moins une minuscule")
    .regex(/\d/, "Le mot de passe doit contenir au moins un chiffre"),
  display_name: z.string().max(255).optional().nullable(),
  role: z.enum(["user", "analyst", "admin"]).optional(),
});

export const updateUserSchema = z.object({
  display_name: z.string().max(255).optional(),
  role: z.enum(["user", "analyst", "admin"]).optional(),
  is_active: z.boolean().optional(),
});

export const resetPasswordSchema = z.object({
  password: z
    .string()
    .min(12, "Le mot de passe doit faire au moins 12 caractères")
    .regex(/[A-Z]/, "Le mot de passe doit contenir au moins une majuscule")
    .regex(/[a-z]/, "Le mot de passe doit contenir au moins une minuscule")
    .regex(/\d/, "Le mot de passe doit contenir au moins un chiffre"),
});

export const alertRuleSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(500).optional(),
  condition_type: z.enum([
    "level",
    "count",
    "silence",
    "fingerprint",
    "threshold",
  ]),
  condition_value: z.string().max(100).optional(),
  threshold_value: z.number().int().positive().optional(),
  time_window_minutes: z.number().int().positive(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  cooldown_minutes: z.number().int().min(0),
});

export const alertUpdateSchema = z.object({
  status: z.enum(["new", "read", "dismissed"]).optional(),
  is_read: z.boolean().optional(),
});

const purgeBoundarySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}:\d{2})?$/).refine((value) => {
  const [datePart, timePart = "00:00:00"] = value.split(" ");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute, second] = timePart.split(":").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day &&
    date.getUTCHours() === hour && date.getUTCMinutes() === minute && date.getUTCSeconds() === second;
}, "Date invalide");

export const purgeSchema = z.object({
  log_level: z
    .enum(["TRACE", "DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL", "FATAL", "SECURITY"])
    .optional(),
  date_from: purgeBoundarySchema.optional(),
  date_before: purgeBoundarySchema.optional(),
}).superRefine((data, context) => {
  if (!data.log_level && !data.date_from && !data.date_before) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Spécifiez au moins un critère de purge" });
  }

  if (data.date_from && data.date_before) {
    const toUtcTimestamp = (value) => `${value.replace(" ", "T")}${value.length === 10 ? "T00:00:00" : ""}Z`;
    if (Date.parse(toUtcTimestamp(data.date_from)) >= Date.parse(toUtcTimestamp(data.date_before))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["date_before"], message: "La date de fin doit être postérieure à la date de début" });
    }
  }
});

export const externalSourceSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(500).optional(),
  source_type: z.enum(["http_json", "http_lines", "webhook", "syslog"]),
  endpoint_url: z.string().url().optional(),
  service_name: z.string().max(128).optional(),
  auth_token: z.string().max(256).optional(),
  custom_headers: z.record(z.string()).optional(),
  poll_interval: z.enum(["realtime", "frequent", "normal", "slow"]).optional(),
  is_active: z.boolean().optional(),
  user_id: z.number().int().positive().optional(),
});

// Validation middleware factory
export function validateBody(schema) {
  return (req, res, next) => {
    try {
      schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation failed",
          details: error.errors.map((e) => e.message),
        });
      }
      return res.status(400).json({ error: "Validation error" });
    }
  };
}
