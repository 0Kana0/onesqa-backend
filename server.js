require('dotenv').config();
const express = require('express');
const { createHandler } = require('graphql-http/lib/use/express');
const { ruruHTML } = require('ruru/server');
const { sequelize } = require('./db/models'); // ใช้ index.js ที่ประกาศไว้
const { schema } = require('./graphql/schema');

const PORT = Number(process.env.PORT || 4000);
const URL = process.env.URL || "http://localhost";

async function start() {
  await sequelize.authenticate(); // ตรวจการเชื่อมต่อ
  // ไม่เรียก sync() เพราะเราใช้ CLI migration แล้ว
  const app = express();

  app.all('/graphql', createHandler({ schema }));

  app.get('/', (_req, res) => {
    res.type('html').send(ruruHTML({ endpoint: '/graphql' }));
  });

  app.listen(PORT, () =>
    console.log(`→ ${URL}:${PORT} (GraphiQL via ruru)`)
  );
}

start().catch(err => {
  console.error(err);
  process.exit(1);
});
