require('dotenv').config();
const express = require('express');
const { createHandler } = require('graphql-http/lib/use/express');
const { ruruHTML } = require('ruru/server');
const { createServer } = require("http");
const { WebSocketServer } = require("ws");
const { useServer } = require("graphql-ws/lib/use/ws");
const { sequelize } = require('./db/models'); // ใช้ index.js ที่ประกาศไว้
const { schema } = require('./graphql/schema');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors')
// server.js (ส่วนสำคัญ)
const verifyToken = require('./middleware/auth-middleware');


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

	app.use(cors({
    origin: FRONTEND_URL, // หรือลิสต์โดเมนจริงของ frontend
		credentials: true,                       // ← สำคัญ
	}));
	app.use(cookieParser());
	app.use(verifyToken);

  app.all('/graphql', (req, res) => {
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
	app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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

start().catch(err => {
  console.error(err);
  process.exit(1);
});
