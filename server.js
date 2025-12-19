require("dotenv").config();
const express = require("express");
const { createHandler } = require("graphql-http/lib/use/express");
const { ruruHTML } = require("ruru/server");
const { createServer } = require("http");
const { WebSocketServer } = require("ws");
const { useServer } = require("graphql-ws/lib/use/ws");
const { graphqlUploadExpress } = require("graphql-upload"); // <-- v13 (CJS)
const {
  execute,
  parse,
  validate,
  specifiedRules,
  GraphQLError,
} = require("graphql");
const { sequelize } = require("./db/models"); // ใช้ index.js ที่ประกาศไว้
const { schema } = require("./graphql/schema");
const path = require("path");
const cookieParser = require("cookie-parser");
const cors = require("cors");
// server.js (ส่วนสำคัญ)
const verifyToken = require("./middleware/auth-middleware");
const { startDailyJobs } = require("./cron/dailyJob");

const PORT = Number(process.env.PORT || 4000);
const URL = process.env.URL || "http://localhost";
const WS_URL = process.env.WS_URL || "ws://localhost";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

async function start() {
  await sequelize.authenticate(); // ตรวจการเชื่อมต่อ
  // ไม่เรียก sync() เพราะเราใช้ CLI migration แล้ว
  const app = express();
  const httpServer = createServer(app); // ✅ ใช้ HTTP server เดียวกัน

  app.set("trust proxy", true);

  app.use(
    cors({
      origin: FRONTEND_URL,
      credentials: true,
    })
  );
  app.use(cookieParser());

  // ถ้า verifyToken ตรวจทุกเมธอด แนะนำให้ allow OPTIONS ด้วย (กัน preflight ติด)
  // if (req.method === 'OPTIONS') return res.sendStatus(204);
  app.use(verifyToken);

  // *** เพิ่มเฉพาะบรรทัดนี้ เพื่อรองรับ Upload ผ่าน GraphQL ***
  // ✅ รองรับอัปโหลดไฟล์ผ่าน GraphQL เฉพาะ POST /graphql
  app.post(
    "/graphql",
    // รับเฉพาะ multipart เท่านั้น, ไม่ใช่ multipart ให้ไป handler ถัดไป
    (req, res, next) => {
      const ct = req.headers["content-type"] || "";
      if (ct.startsWith("multipart/form-data")) return next();
      return next("route");
    },
    graphqlUploadExpress({ maxFileSize: 25 * 1024 * 1024, maxFiles: 10 }),
    async (req, res) => {
      try {
        // หลัง graphqlUploadExpress, req.body ควรเป็น { query, variables, operationName }
        if (!req.body || typeof req.body.query !== "string") {
          // debug ให้เห็นว่า body กลายเป็นอะไร
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
          // parse error = 400
          return res.status(400).json({ errors: [{ message: e.message }] });
        }

        const vErrors = validate(schema, document, specifiedRules);
        if (vErrors.length) {
          return res
            .status(400)
            .json({ errors: vErrors.map((e) => ({ message: e.message })) });
        }

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
        console.error("UPLOAD_EXECUTOR_ERROR:", err);
        const msg =
          err instanceof GraphQLError
            ? err.message
            : err?.message || "Internal error";
        res.status(500).json({ errors: [{ message: msg }] });
      }
    }
  );

  app.all("/graphql", (req, res) => {
    return createHandler({
      schema,
      context: (_req, params) => ({ req, res, params }), // ← ใช้ res จากคลอเชอร์นี้
    })(req, res);
  });

  // ✅ หน้า GraphiQL (ruru)
  app.get("/", (_req, res) => {
    res.type("html").send(
      ruruHTML({
        endpoint: "/graphql",
        subscriptionsEndpoint: `${WS_URL}:${PORT}/graphql`, // 🔥 เพิ่มสำหรับ subscription
      })
    );
  });

  // Static middleware สำหรับให้บริการไฟล์สาธารณะ
  app.use("/uploads", express.static(path.join(__dirname, "uploads")));

  // เริ่ม cronjob
  startDailyJobs();

  // ✅ WebSocket Server สำหรับ GraphQL Subscriptions
  const wsServer = new WebSocketServer({
    server: httpServer,
    path: "/graphql",
  });

  useServer({ schema }, wsServer);

  httpServer.listen(PORT, () => {
    console.log(`🚀 GraphQL HTTP:  ${URL}:${PORT}/graphql`);
    console.log(`🔌 WebSocket WS: ${WS_URL}:${PORT}/graphql`);
    console.log(`🧠 GraphiQL:     ${URL}:${PORT}`);
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
