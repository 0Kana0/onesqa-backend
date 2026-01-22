// controllers/academy.controller.js
const axios = require("axios");
require("dotenv").config();
const { Op, fn, col, literal, QueryTypes } = require("sequelize");
const db = require("../db/models"); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { Academy, SarHistory, User, sequelize } = db;
const moment = require("moment-timezone");
const https = require("https");

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 10_000,
  maxSockets: 20,      // ปรับตามที่ไหว
  maxFreeSockets: 10,
});

const TZ = "Asia/Bangkok";

exports.countByAcademyLevel = async () => {
  const rows = await Academy.findAll({
    attributes: [
      "academy_level_id",
      [fn("COUNT", col("id")), "count"], // ใช้ id เป็น PK ปกติของตาราง
    ],
    group: ["academy_level_id"],
    order: [["academy_level_id", "ASC"]],
    raw: true,
  });

  // แปลง count ให้เป็น number (บาง DB จะคืนเป็น string)
  return rows.map((r) => ({
    academy_level_id: r.academy_level_id,
    count: Number(r.count) || 0,
  }));
};

exports.getAcademyByCode = async (code) => {
  return await Academy.findOne({
    where: { code }, // หรือ { group_name: name }
  });
};

exports.getAcademyByCodeChat = async (code) => {
  const academy = await Academy.findOne({ where: { code } });
  if (!academy) return null;

  const sarFiles = Array.isArray(academy.sar_file) ? academy.sar_file : [];
  if (sarFiles.length === 0) return academy;

  const toYearNum = (y) => {
    const s = String(y ?? "").replace(/[^\d]/g, "");
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : null;
  };

  const years = sarFiles.map((x) => toYearNum(x?.year)).filter((n) => n !== null);
  if (years.length === 0) {
    academy.setDataValue("sar_file", []);
    return academy;
  }

  const latestYear = Math.max(...years);

  // ✅ เหลือเฉพาะรายการของปีล่าสุด (ไม่ตัดซ้ำ)
  const latestYearFiles = sarFiles.filter((x) => toYearNum(x?.year) === latestYear);

  academy.setDataValue("sar_file", latestYearFiles);
  academy.setDataValue("sar_latest_year", latestYear);

  return academy;
};

exports.removeSarFiles = async ({ academy_id, files = [], ctx }) => {
  if (!academy_id) throw new Error("academy_id is required");
  if (!Array.isArray(files) || files.length === 0) {
    return { ok: true, removedCount: 0 };
  }

  // clean + unique
  const cleanFiles = [
    ...new Set(
      files
        .map(String)
        .map((x) => x.trim())
        .filter(Boolean)
    ),
  ];
  const removeSet = new Set(cleanFiles);

  const user = await User.findByPk(ctx?.req?.user?.id, {
    attributes: ["firstname", "lastname"]
  })

  const delete_name = user?.firstname + " " + user?.lastname;

  return await db.sequelize.transaction(async (t) => {
    const academy = await Academy.findByPk(academy_id, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!academy) throw new Error("Academy not found");

    // sar_file ควรเป็น array ของ {year, file}
    const current = Array.isArray(academy.sar_file) ? academy.sar_file : [];

    // ✅ หา "รายการที่ถูกลบจริง" จากข้อมูลเดิม
    const removedItems = current.filter((item) => removeSet.has(item?.file));

    // ✅ คงรายการที่ไม่ถูกลบ
    const next = current.filter((item) => !removeSet.has(item?.file));
    const removedCount = current.length - next.length;

    // ถ้าไม่มีอะไรถูกลบจริง ก็จบ
    if (removedCount === 0) {
      return { ok: true, removedCount: 0 };
    }

    academy.sar_file = next;
    await academy.save({ transaction: t });

    // ✅ บันทึกประวัติการลบ
    // SarHistory.sar_file เป็น String -> เก็บชื่อ/พาธไฟล์ที่ถูกลบ
    await SarHistory.bulkCreate(
      removedItems.map((it) => ({
        academy_id: academy.id,
        delete_name: delete_name,
        sar_file: String(it?.file || "").trim(),
      })),
      { transaction: t }
    );

    return { ok: true, removedCount };
  });
};

// ✅ helper: ใช้เรียก ONESQA และถ้า ONESQA "ล่มจริง" ให้ throw ตามที่ต้องการ
const ONESQA_TIMEOUT = 30000;

async function mapPool(items, limit, mapper) {
  const ret = new Array(items.length);
  let i = 0;

  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) break;
      ret[idx] = await mapper(items[idx], idx);
    }
  });

  await Promise.all(workers);
  return ret;
}

const isOnesqaDownError = (err) => {
  const status = err?.response?.status;

  if (!err?.response) return true; // network/timeout/DNS/ECONNRESET

  if (typeof status === "number") {
    if (status >= 500) return true;
    if ([408, 429].includes(status)) return true; // timeout / rate limit
  }
  return false;
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const isRetryable = (err) => {
  const code = err?.code;
  const status = err?.response?.status;

  // network ชั้น transport
  if (!err?.response && ["ECONNRESET", "ETIMEDOUT", "ECONNABORTED", "EAI_AGAIN", "ENOTFOUND"].includes(code)) {
    return true;
  }

  // ปลายทาง/เกตเวย์/โดนจำกัด
  if (typeof status === "number" && [408, 429, 500, 502, 503, 504].includes(status)) {
    return true;
  }

  return false;
};
async function onesqaPost(endpoint, data, headers, opts = {}) {
  const baseURL = process.env.ONESQA_URL;
  const timeout = opts.timeout ?? ONESQA_TIMEOUT;
  const retries = opts.retries ?? 3;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await axios.post(`${baseURL}${endpoint}`, data, {
        httpsAgent,
        headers,
        timeout,
      });
    } catch (err) {
      // log แบบไม่พ่น token
      console.log("[ONESQA]", endpoint, "attempt", attempt + 1, {
        code: err?.code,
        status: err?.response?.status,
        msg: err?.message,
      });

      if (!isRetryable(err) || attempt === retries) {
        // ถ้าเป็น "ล่ม/ไม่พร้อม" จริง ค่อยแปลงข้อความ
        if (isOnesqaDownError(err)) {
          throw new Error(
            locale === "th" ? "ระบบ ONESQA ไม่พร้อมใช้งาน" : "ONESQA system is unavailable",
            { cause: err } // เก็บต้นตอไว้
          );
        }
        throw err;
      }

      // backoff + jitter
      const jitter = Math.floor(Math.random() * 200);
      await wait(500 * 2 ** attempt + jitter);
    }
  }
}

const ACADEMY_PAGE_CONCURRENCY = 3;
const SAR_CONCURRENCY = 5;

exports.syncAcademyFromApi = async (ctx) => {
  const headers = {
    Accept: "application/json",
    "X-Auth-ID": process.env.X_AUTH_ID,
    "X-Auth-Token": process.env.X_AUTH_TOKEN,
  };

  const sequelize = db.sequelize;
  const qi = sequelize.getQueryInterface();
  const qg = qi.queryGenerator;
  const table = qg.quoteTable(Academy.getTableName());

  for (let level = 1; level < 7; level++) {
    console.log("academy_level_id =", level);

    const length = 1000;

    const first = await onesqaPost(
      "/basics/get_academy",
      { start: "0", length: String(length), academy_level_id: String(level) },
      headers
    );

    const total = Number(first.data?.total ?? 0);
    const firstItems = Array.isArray(first.data?.data) ? first.data.data : [];
    const pages = Math.ceil(total / length);

    const starts = [];
    for (let page = 1; page < pages; page++) starts.push(page * length);

    const restPages = await mapPool(starts, ACADEMY_PAGE_CONCURRENCY, async (start) => {
      const res = await onesqaPost(
        "/basics/get_academy",
        { start: String(start), length: String(length), academy_level_id: String(level) },
        headers
      );
      return Array.isArray(res.data?.data) ? res.data.data : [];
    });

    const academyArray = [...firstItems, ...restPages.flat()];
    console.log("✅ academy fetched:", academyArray.length);

    // ✅ apiIds ของชุดนี้ (ใช้ทั้งตัดไฟล์ + DELETE NOT IN)
    const apiIds = academyArray
      .map((a) => Number(a.id))
      .filter((n) => Number.isInteger(n));

    // ✅ map ไฟล์ที่เคยถูกลบ: apiId -> Set(files)
    const deletedMap = new Map(); // Map<number, Set<string>>

    if (apiIds.length > 0) {
      const deletedRows = await SarHistory.findAll({
        attributes: ["sar_file"],
        include: [
          {
            model: Academy,
            as: "academy",
            required: true,
            attributes: ["academy_api_id"],
            where: {
              academy_level_id: String(level),
              academy_api_id: { [Op.in]: apiIds },
            },
          },
        ],
        raw: true,
      });

      for (const r of deletedRows) {
        const apiId = Number(r["academy.academy_api_id"]);
        const f = String(r.sar_file ?? "").trim();
        if (!Number.isInteger(apiId) || !f) continue;

        if (!deletedMap.has(apiId)) deletedMap.set(apiId, new Set());
        deletedMap.get(apiId).add(f);
      }
    }

    // ✅ ของเดิมใน DB (ไว้ fallback)
    const existingAcademies = await Academy.findAll({
      where: { academy_level_id: String(level) },
      attributes: ["academy_api_id", "sar_file"],
      raw: true,
    });
    const existingMap = new Map(existingAcademies.map((r) => [r.academy_api_id, r]));

    // ✅ ดึง sar จาก API
    const sarResults = await mapPool(academyArray, SAR_CONCURRENCY, async (a) => {
      try {
        const sarRes = await onesqaPost(
          "/basics/get_sar",
          { academy_code: a.code },
          headers
        );        
        const raw = Array.isArray(sarRes.data?.data) ? sarRes.data.data : [];
        const sar_file = raw
          .filter((x) => x && x.year != null && x.file)
          .map((x) => ({ year: String(x.year), file: x.file }))
          .filter((v, i, arr) => i === arr.findIndex((t) => t.year === v.year && t.file === v.file))
          .sort((a, b) => Number(b.year) - Number(a.year));

        return { apiId: a.id, sar_file };
      } catch {
        return { apiId: a.id, sar_file: null }; // null = ใช้ของเดิม
      }
    });

    const sarMap = new Map(sarResults.map((x) => [x.apiId, x.sar_file]));

    // ✅ สร้าง payload และ "ตัดไฟล์ที่เคยลบ (SarHistory) ออก"
    const payloads = academyArray.map((a) => {
      const prev = existingMap.get(a.id);
      const sar_file = sarMap.get(a.id);

      const baseSar =
        sar_file === null ? (prev?.sar_file ?? []) : (sar_file ?? []);

      const delSet = deletedMap.get(Number(a.id));

      const filteredSar =
        Array.isArray(baseSar) && delSet
          ? baseSar.filter((it) => {
              const f = String(it?.file ?? "").trim();
              return f && !delSet.has(f);
            })
          : baseSar;

      return {
        academy_level_id: String(level),
        academy_api_id: a.id,
        name: a.name,
        code: a.code,
        sar_file: filteredSar,
      };
    });

    await sequelize.transaction(async (t) => {
      // ✅ UPSERT
      await sequelize.query(
        `
        INSERT INTO ${table}
          (academy_level_id, academy_api_id, name, code, sar_file, "createdAt", "updatedAt")
        SELECT
          x.academy_level_id,
          x.academy_api_id,
          x.name,
          x.code,
          x.sar_file,
          NOW(),
          NOW()
        FROM jsonb_to_recordset(:rows::jsonb) AS x(
          academy_level_id text,
          academy_api_id int,
          name text,
          code text,
          sar_file jsonb
        )
        ON CONFLICT (academy_level_id, academy_api_id)
        DO UPDATE SET
          name = EXCLUDED.name,
          code = EXCLUDED.code,
          sar_file = EXCLUDED.sar_file,
          "updatedAt" = NOW();
        `,
        {
          transaction: t,
          replacements: { rows: JSON.stringify(payloads) },
        }
      );

      // ✅ DELETE รายการที่ไม่มีใน API แล้ว
      if (apiIds.length > 0) {
        await sequelize.query(
          `
          DELETE FROM ${table}
          WHERE academy_level_id = $level
            AND NOT (academy_api_id = ANY($apiIds::int[]));
          `,
          {
            transaction: t,
            bind: { level: String(level), apiIds },
          }
        );
      } else {
        await sequelize.query(
          `
          DELETE FROM ${table}
          WHERE academy_level_id = $level;
          `,
          {
            transaction: t,
            bind: { level: String(level) },
          }
        );
      }
    });

    console.log(`✅ sync สำเร็จ (level=${level}, total=${academyArray.length})`);
  }

  return { message: "sync ข้อมูลสถานศึกษาสำเร็จ", status: "success" };
};
