// ─────────────────────────────────────────────────────────────────────────────
// server/index.ts  —  Entry point for the I-Sync Express server
// ─────────────────────────────────────────────────────────────────────────────

import dotenv from "dotenv";
dotenv.config();

import express from "express";
import type { Request, Response, NextFunction } from "express";
import { registerRoutes, sendEmergencySMS, sendExpoPushNotifications } from "./routes";
import { storage } from "./storage";
import * as fs from "fs";
import * as path from "path";
import { WebSocketServer, WebSocket } from "ws";

const app = express();
const log = console.log;

// ── Device Pairing Registry ───────────────────────────────────────────────────
// Maps a device's IP address → patientId after a successful /pair call.
// This lets the ESP32 omit patientId from /fall and /vitals once paired.
const devicePairings = new Map<string, string>();

function getClientIp(req: Request): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    'unknown'
  );
}

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// ── CORS Middleware ───────────────────────────────────────────────────────────
function setupCors(app: express.Application) {
  app.use((req, res, next) => {
    const origin = req.header("origin");
    res.header("Access-Control-Allow-Origin", origin || "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.header("Access-Control-Allow-Credentials", "true");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });
}

// ── Body Parsing Middleware ───────────────────────────────────────────────────
function setupBodyParsing(app: express.Application) {
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: false }));
}

// ── Request Logging Middleware ────────────────────────────────────────────────
function setupRequestLogging(app: express.Application) {
  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, unknown> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      if (!path.startsWith("/api")) return;
      const duration = Date.now() - start;
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }
      log(logLine);
    });

    next();
  });
}

// ── App Name Helper ───────────────────────────────────────────────────────────
function getAppName(): string {
  try {
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

// ── Expo Manifest Serving ─────────────────────────────────────────────────────
function serveExpoManifest(platform: string, res: Response) {
  const manifestPath = path.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json",
  );

  if (!fs.existsSync(manifestPath)) {
    return res
      .status(404)
      .json({ error: `Manifest not found for platform: ${platform}` });
  }

  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");

  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}

// ── Landing Page Serving ──────────────────────────────────────────────────────
function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName,
}: {
  req: Request;
  res: Response;
  landingPageTemplate: string;
  appName: string;
}) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;

  log(`baseUrl`, baseUrl);
  log(`expsUrl`, expsUrl);

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
    .replace(/APP_NAME_PLACEHOLDER/g, appName);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}

// ── Expo Routing + Static Files ───────────────────────────────────────────────
function configureExpoAndLanding(app: express.Application) {
  const templatePath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html",
  );
  const landingPageTemplate = fs.readFileSync(templatePath, "utf-8");
  const appName = getAppName();

  log("Serving static Expo files with dynamic manifest routing");

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api")) {
      return next();
    }
    if (req.path !== "/" && req.path !== "/manifest") {
      return next();
    }
    const platform = req.header("expo-platform");
    if (platform && (platform === "ios" || platform === "android")) {
      return serveExpoManifest(platform, res);
    }
    if (req.path === "/") {
      return serveLandingPage({ req, res, landingPageTemplate, appName });
    }
    next();
  });

  app.use("/assets", express.static(path.resolve(process.cwd(), "assets")));
  app.use("/pose-engine", express.static(path.resolve(process.cwd(), "server/public/pose-engine")));
  app.use("/pose_landmarker_full.task", express.static(path.resolve(process.cwd(), "server/public/pose-engine/pose_landmarker_full.task")));
  app.use(express.static(path.resolve(process.cwd(), "static-build")));

  app.get("/download/defence", (_req, res) => {
    const filePath = path.resolve(process.cwd(), "server/public/docs/isync-defence-document.txt");
    res.download(filePath, "I-Sync-Defence-Document.txt", (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ error: "Document not found" });
      }
    });
  });

  log("Expo routing: Checking expo-platform header on / and /manifest");
}

// ── Global Error Handler ──────────────────────────────────────────────────────
function setupErrorHandler(app: express.Application) {
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    const error = err as {
      status?: number;
      statusCode?: number;
      message?: string;
    };
    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    if (res.headersSent) {
      return next(err);
    }
    return res.status(status).json({ message });
  });
}

// ── Process-Level Error Guards ────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION — server will keep running:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION — server will keep running:', reason);
});

// ── Main Startup ──────────────────────────────────────────────────────────────
(async () => {
  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);

  configureExpoAndLanding(app);

  const server = await registerRoutes(app);

  setupErrorHandler(app);

  // ── WEBSOCKET SERVER ────────────────────────────────────────────────────────
  const wss = new WebSocketServer({ server });
  const rooms = new Map<string, Set<WebSocket>>();

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url || "", "http://localhost");
    const patientId = url.searchParams.get("patientId");

    if (!patientId) {
      ws.close();
      return;
    }

    if (!rooms.has(patientId)) rooms.set(patientId, new Set());
    rooms.get(patientId)!.add(ws);
    console.log(`WS connected: ${patientId}`);

    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message.toString());
        const room = rooms.get(patientId);
        if (room) {
          room.forEach((client) => {
            if (client !== ws && client.readyState === 1) {
              client.send(JSON.stringify(data));
            }
          });
        }
      } catch (e) {
        console.error("WS parse error:", e);
      }
    });

    ws.on("close", () => {
      rooms.get(patientId)?.delete(ws);
      if (rooms.get(patientId)?.size === 0) {
        rooms.delete(patientId);
      }
      console.log(`WS disconnected: ${patientId}`);
    });
  });

  console.log("WebSocket server attached to HTTP server on port 5000");

  // ── FALL ENDPOINT (ESP32 → SERVER) ─────────────────────────────────────────
  app.post("/fall", async (req, res) => {
    // Accept patientId from body OR look up by the device's IP (set during /pair)
    const ip = getClientIp(req);
    const patientId = req.body?.patientId || devicePairings.get(ip);
    if (!patientId) {
      return res.status(400).json({ error: "patientId required — call /pair first" });
    }
    console.log(`Fall from: ${patientId}`);

    // 1. Broadcast to any connected WebSocket clients (app open on phone)
    const room = rooms.get(patientId);
    if (room) {
      room.forEach((client) => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({ type: "FALL_DETECTED", patientId }));
        }
      });
    }

    // 2. Send emergency SMS directly from server so alert works even if app is closed
    try {
      const user = await storage.getUserByUniqueId(patientId);
      if (user) {
        const profile = await storage.getPatientProfile(user.id);
        const emergencyContact = profile?.emergencyContact;
        if (emergencyContact?.phone) {
          const vitalsHistory = await storage.getVitalsHistory(user.id, 1);
          const latest = vitalsHistory.length > 0 ? vitalsHistory[vitalsHistory.length - 1] : null;
          const vitals = latest
            ? {
                hr: latest.heartRate,
                bp: latest.systolicBP && latest.diastolicBP
                  ? `${latest.systolicBP}/${latest.diastolicBP}`
                  : undefined,
                spo2: latest.spo2,
              }
            : null;
          await sendEmergencySMS(
            emergencyContact.phone,
            user.name ?? 'Unknown patient',
            patientId,
            vitals,
          );
          console.log(`[/fall] Emergency SMS sent to ${emergencyContact.phone}`);
        }
      }
    } catch (smsErr: any) {
      console.error('[/fall] SMS send failed:', smsErr?.message ?? smsErr);
    }

    // 3. Send push notification to all caregivers monitoring this patient
    try {
      const user = await storage.getUserByUniqueId(patientId);
      if (user) {
        const tokens = await storage.getCaregiversPushTokensForPatient(user.id);
        if (tokens.length > 0) {
          await sendExpoPushNotifications(
            tokens,
            '🚨 Fall Detected!',
            `${user.name ?? patientId} may have fallen. Open I-Sync immediately.`,
            { patientId, type: 'FALL_ALERT' },
          );
          console.log(`[/fall] Push notification sent to ${tokens.length} caregiver(s)`);
        }
      }
    } catch (pushErr: any) {
      console.error('[/fall] Push send failed:', pushErr?.message ?? pushErr);
    }

    res.json({ received: true });
  });

  // ── VITALS ENDPOINT (ESP32 → SERVER) ───────────────────────────────────────
  app.post("/vitals", (req, res) => {
    const ip = getClientIp(req);
    // Accept patientId from body OR from the IP-based pairing registry
    // Also accept ESP32's field names: bpm → heartRate
    const patientId = req.body?.patientId || devicePairings.get(ip);
    const heartRate  = req.body?.heartRate  ?? req.body?.bpm;
    const spo2       = req.body?.spo2;
    const systolicBP = req.body?.systolicBP;
    const diastolicBP = req.body?.diastolicBP;
    const temperature = req.body?.temperature;
    if (!patientId) {
      return res.status(400).json({ error: "patientId required — call /pair first" });
    }
    console.log(`Vitals from: ${patientId} — HR:${heartRate} SpO2:${spo2}`);
    const room = rooms.get(patientId);
    if (room) {
      room.forEach((client) => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({
            type: "VITALS_UPDATE",
            patientId,
            heartRate,
            spo2,
            systolicBP,
            diastolicBP,
            temperature,
            timestamp: new Date().toISOString(),
          }));
        }
      });
    }
    res.json({ received: true });
  });

  // ── PAIR ENDPOINT (ESP32 → SERVER) ─────────────────────────────────────────
  app.post("/pair", async (req, res) => {
    const { patientId } = req.body;
    if (!patientId) {
      return res.status(400).json({ error: "patientId required" });
    }
    try {
      const user = await storage.getUserByUniqueId(patientId);
      if (!user || user.role !== "patient") {
        return res.status(404).json({ valid: false, error: "Patient not found" });
      }
      // Store this device's IP so /fall and /vitals don't need patientId every time
      const ip = getClientIp(req);
      devicePairings.set(ip, user.uniqueId);
      console.log(`ESP32 paired: ${user.uniqueId} (${user.name}) ← IP ${ip}`);
      res.json({ valid: true, patientId: user.uniqueId, name: user.name });
    } catch (err) {
      res.status(500).json({ error: "Server error" });
    }
  });

  // ── START LISTENING ─────────────────────────────────────────────────────────
  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen(port, "0.0.0.0", () => {
    log(`express server serving on port ${port}`);
    storage.initNutritionTables().catch(e => console.error('Nutrition table init error:', e));
    storage.initFallTable().catch(e => console.error('Fall table init error:', e));
    storage.initMealPlanTables().catch(e => console.error('Meal plan table init error:', e));
    storage.initCareGiverPatientsTable().catch(e => console.error('Care giver patients table init error:', e));
    storage.initPushTokensTable().catch(e => console.error('Push tokens table init error:', e));
  });
})().catch(err => {
  console.error('FATAL startup error:', err);
  process.exit(1);
});