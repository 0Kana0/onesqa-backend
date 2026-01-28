require("dotenv").config();

const express = require("express");
const { createHandler } = require("graphql-http/lib/use/express");
const { ruruHTML } = require("ruru/server");
const { createServer } = require("http");
const { WebSocketServer } = require("ws");
const { useServer } = require("graphql-ws/lib/use/ws");
const { graphqlUploadExpress } = require("graphql-upload"); // v13 (CJS)
const { execute, parse, validate, specifiedRules, GraphQLError } = require("graphql");
const { sequelize } = require("./db/models");
const { schema } = require("./graphql/schema");
const path = require("path");
const cookieParser = require("cookie-parser");
const cors = require("cors");

const verifyToken = require("./middleware/auth-middleware");
//const { startDailyJobs } = require("./cron/dailyJob");

// ✅ LOG
const pino = require("pino");
const pinoHttp = require("pino-http");
const { v4: uuidv4 } = require("uuid");

// ✅ METRICS
const client = require("prom-client");

const PORT = Number(process.env.PORT || 4000);
const URL = process.env.URL || "http://localhost";
const WS_URL = process.env.WS_URL || "ws://localhost";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

async function start() {
  await sequelize.authenticate();

  const app = express();
  const httpServer = createServer(app);

  app.set("trust proxy", true);

  // -----------------------
  // ✅ Logger (stdout JSON)
  // -----------------------
  const logger = pino({
    level: process.env.LOG_LEVEL || "info",
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers['x-api-key']",
      ],
      remove: true,
    },
  });

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.headers["x-request-id"] || uuidv4(),
      customLogLevel: (res, err) => {
        if (err || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
      customSuccessMessage: (req, res) =>
        `${req.method} ${req.url} -> ${res.statusCode}`,
      customErrorMessage: (req, res, err) =>
        `${req.method} ${req.url} -> ${res.statusCode} (${err?.message || "error"})`,
    })
  );

  // -----------------------
  // ✅ Metrics (Prometheus)
  // -----------------------
  client.collectDefaultMetrics();

  const httpRequestDuration = new client.Histogram({
    name: "http_request_duration_seconds",
    help: "Duration of HTTP requests in seconds",
    labelNames: ["method", "route", "status"],
    buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  });

  const httpRequestsTotal = new client.Counter({
    name: "http_requests_total",
    help: "Total number of HTTP requests",
    labelNames: ["method", "route", "status"],
  });

  // เก็บ route label แบบปลอดภัย (กันแตก)
  function getRouteLabel(req) {
    if (req.route && req.route.path) return String(req.route.path);
    if (req.baseUrl && req.path) return `${req.baseUrl}${req.path}`;
    return req.path || "unknown";
  }

  // middleware วัดเวลา + นับจำนวน
  app.use((req, res, next) => {
    const end = httpRequestDuration.startTimer();

    res.on("finish", () => {
      const route = getRouteLabel(req);
      const status = String(res.statusCode);

      end({ method: req.method, route, status });
      httpRequestsTotal.inc({ method: req.method, route, status });
    });

    next();
  });

  // -----------------------
  // CORS / Cookie
  // -----------------------
  app.use(
    cors({
      origin: FRONTEND_URL,
      credentials: true,
    })
  );
  app.use(cookieParser());

  // -----------------------
  // ✅ Health + Metrics (bypass auth)
  // -----------------------
  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  app.get("/metrics", async (_req, res) => {
    try {
      res.set("Content-Type", client.register.contentType);
      res.end(await client.register.metrics());
    } catch (e) {
      res.status(500).json({ message: "metrics error" });
    }
  });

  // -----------------------
  // ✅ Auth middleware (skip some paths)
  // -----------------------
  app.use((req, res, next) => {
    const p = req.path || "";
    if (p === "/healthz" || p === "/metrics" || p.startsWith("/uploads")) return next();
    return verifyToken(req, res, next);
  });

  // -----------------------
  // ✅ Upload GraphQL (multipart only)
  // -----------------------
  app.post(
    "/graphql",
    (req, res, next) => {
      const ct = req.headers["content-type"] || "";
      if (ct.startsWith("multipart/form-data")) return next();
      return next("route");
    },
    graphqlUploadExpress({ maxFileSize: 25 * 1024 * 1024, maxFiles: 10 }),
    async (req, res) => {
      try {
        if (!req.body || typeof req.body.query !== "string") {
          return res.status(400).json({
            errors: [
              {
                message: "Bad multipart payload: missing query",
                bodyKeys: Object.keys(req.body || {}),
              },
            ],
          });
        }

        const { query, variables, operationName } = req.body;

        let document;
        try {
          document = parse(query);
        } catch (e) {
          return res.status(400).json({ errors: [{ message: e.message }] });
        }

        const vErrors = validate(schema, document, specifiedRules);
        if (vErrors.length) {
          return res
            .status(400)
            .json({ errors: vErrors.map((e) => ({ message: e.message })) });
        }

        // ✅ ใส่ log เพิ่มนิด: operationName (ถ้ามี)
        req.log.info({ operationName }, "graphql upload request");

        const result = await execute({
          schema,
          document,
          variableValues: variables,
          operationName,
          contextValue: { req, res },
        });

        res.setHeader("content-type", "application/json");
        res.status(200).end(JSON.stringify(result));
      } catch (err) {
        req.log.error({ err }, "UPLOAD_EXECUTOR_ERROR");
        const msg =
          err instanceof GraphQLError
            ? err.message
            : err?.message || "Internal error";
        res.status(500).json({ errors: [{ message: msg }] });
      }
    }
  );

  // -----------------------
  // ✅ GraphQL JSON handler
  // -----------------------
  app.all("/graphql", (req, res) => {
    return createHandler({
      schema,
      context: (_req, params) => {
        // ✅ params มักมี operationName/query/variables ใน graphql-http
        // log แบบไม่ใส่ sensitive
        req.log.debug(
          { operationName: params?.operationName },
          "graphql request"
        );
        return { req, res, params };
      },
    })(req, res);
  });

  // ✅ GraphiQL (ruru) - ทำให้ auto เป็น ws/wss ตาม https จริง
  app.get("/", (req, res) => {
    const xfProto = String(req.headers["x-forwarded-proto"] || "")
      .split(",")[0]
      .trim();
    const proto = xfProto || req.protocol || "http";

    const xfHost = String(req.headers["x-forwarded-host"] || "")
      .split(",")[0]
      .trim();
    const host = xfHost || String(req.headers.host || "");

    const wsProto = proto === "https" ? "wss" : "ws";
    const subscriptionsEndpoint = `${wsProto}://${host}/graphql`;

    res.type("html").send(
      ruruHTML({
        endpoint: "/graphql",
        subscriptionsEndpoint,
      })
    );
  });

  // ✅ static uploads
  app.use("/uploads", express.static(path.join(__dirname, "uploads")));

  // ✅ cronjob
  //startDailyJobs();

  // ✅ WS Subscriptions
  const wsServer = new WebSocketServer({
    server: httpServer,
    path: "/graphql",
  });

  useServer({ schema }, wsServer);

  // ✅ error handler กลาง (กันหลุดแบบไม่ log)
  app.use((err, req, res, _next) => {
    req.log.error({ err }, "UNHANDLED_ERROR");
    res.status(500).json({ message: "Internal Server Error" });
  });

  httpServer.listen(PORT, () => {
    logger.info(`🚀 GraphQL HTTP:  ${URL}:${PORT}/graphql`);
    logger.info(`🔌 WebSocket WS: ${WS_URL}:${PORT}/graphql`);
    logger.info(`🧠 GraphiQL:     ${URL}:${PORT}`);
    logger.info(`📈 Metrics:      ${URL}:${PORT}/metrics`);
  });
}

start().catch((err) => {
  // start ก่อนมี req.log ให้ใช้ console ได้
  console.error(err);
  process.exit(1);
});
