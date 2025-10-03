require('dotenv').config();
const express = require('express');
const { createHandler } = require('graphql-http/lib/use/express');
const { ruruHTML } = require('ruru/server');
const { sequelize } = require('./db/models'); // ใช้ index.js ที่ประกาศไว้
const { schema } = require('./graphql/schema');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors')
// server.js (ส่วนสำคัญ)
const verifyToken = require('./middleware/auth-middleware');


const PORT = Number(process.env.PORT || 4000);
const URL = process.env.URL || "http://localhost";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

async function start() {
  await sequelize.authenticate(); // ตรวจการเชื่อมต่อ
  // ไม่เรียก sync() เพราะเราใช้ CLI migration แล้ว
  const app = express();
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

  app.get('/', (_req, res) => {
    res.type('html').send(ruruHTML({ endpoint: '/graphql' }));
  });

  // Static middleware สำหรับให้บริการไฟล์สาธารณะ
	app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

  app.listen(PORT, () =>
    console.log(`→ ${URL}:${PORT} (GraphiQL via ruru)`)
  );
}

start().catch(err => {
  console.error(err);
  process.exit(1);
});
