// cron/dailyJob.js
const axios = require("axios");
require("dotenv").config();
const cron = require("node-cron");
const moment = require("moment-timezone");
const { Op, fn, col } = require("sequelize");
const https = require("https");

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const db = require("../db/models");
const {
  Group,
  Group_ai,
  Ai,
  User_count,
  Notification,
  RefreshToken,
  User,
  User_ai,
  Role,
  User_role,
  User_daily_active,
  User_login_history,
  Academy, 
  SarHistory
} = db;

const TZ = "Asia/Bangkok";

// ✅ helper: ใช้เรียก ONESQA และถ้า ONESQA "ล่มจริง" ให้ throw ตามที่ต้องการ
const ONESQA_TIMEOUT_USER = 10000;
const isOnesqaDownError = (err) => {
  const status = err?.response?.status;

  // ไม่มี response = network/timeout/DNS/ECONNREFUSED ฯลฯ
  if (!err?.response) return true;

  // 5xx = ฝั่ง ONESQA มีปัญหา
  if (typeof status === "number" && status >= 500) return true;

  return false;
};
async function onesqaPostUser(endpoint, data, headers) {
  try {
    return await axios.post(`${process.env.ONESQA_URL}${endpoint}`, data, {
      httpsAgent,
      headers,
      timeout: ONESQA_TIMEOUT_USER,
    });
  } catch (err) {
    if (isOnesqaDownError(err)) {
      throw new Error("ONESQA system is unavailable");
    }
    // ✅ 4xx หรือ error อื่น ๆ ให้คง behavior เดิม (throw ต่อไป)
    throw err;
  }
}

// ✅ helper: ใช้เรียก ONESQA และถ้า ONESQA "ล่มจริง" ให้ throw ตามที่ต้องการ
const ONESQA_TIMEOUT_SAR = 30000;
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
async function onesqaPostSar(endpoint, data, headers) {
  try {
    return await axios.post(`${process.env.ONESQA_URL}${endpoint}`, data, {
      httpsAgent,
      headers,
      timeout: ONESQA_TIMEOUT_SAR,
    });
  } catch (err) {
    console.log(err);
    if (isOnesqaDownError(err)) {
      throw new Error("ONESQA system is unavailable");
    }
    // ✅ 4xx หรือ error อื่น ๆ ให้คง behavior เดิม (throw ต่อไป)
    throw err;
  }
}
const ACADEMY_PAGE_CONCURRENCY = 3;
const SAR_CONCURRENCY = 5;

/***************** ดึงข้อมูล Group ทุก 00:01  *****************/
/**
 * ดึง group จาก ONESQA API แล้ว sync กับ table group
 */
async function syncGroupsFromApi() {
  try {
    const response = await axios.post(
      `${process.env.ONESQA_URL}/basics/get_group`,
      null,
      {
        httpsAgent,
        headers: {
          Accept: "application/json",
          "X-Auth-ID": process.env.X_AUTH_ID,
          "X-Auth-Token": process.env.X_AUTH_TOKEN,
        },
      }
    );

    const apiGroups = response.data?.data || [];

    const rootGroups = apiGroups.filter((item) => item.parent_id !== 15);

    console.log("API rootGroups count =", rootGroups.length);

    const existingGroups = await Group.findAll({
      where: {
        group_api_id: {
          [Op.ne]: null,
        },
      },
    });

    const existingMap = new Map(
      existingGroups.map((g) => [g.group_api_id, g])
    );

    const apiIds = [];

    for (const g of rootGroups) {
      const payload = {
        group_api_id: g.id,
        name: g.name,
        code: g.code,
        data_level: g.data_level,
        academy_level_id: g.academy_level_id,
      };

      apiIds.push(g.id);

      const existing = existingMap.get(g.id);
      if (existing) {
        await existing.update(payload);
      } else {
        await Group.create(payload);
      }
    }

    await Group.destroy({
      where: {
        group_api_id: {
          [Op.ne]: null,
          [Op.notIn]: apiIds,
        },
      },
    });

    console.log(
      `✅ syncGroupsFromApi สำเร็จ (total from API: ${rootGroups.length})`
    );

    await syncGroupAiFromAiTable();
  } catch (err) {
    console.error("❌ syncGroupsFromApi error:", err.message);
    if (err.response) {
      console.error("response data:", err.response.data);
    }
  }
}
/**
 * sync group_ai จาก ai table
 */
async function syncGroupAiFromAiTable() {
  const groups = await Group.findAll({
    where: {
      group_api_id: {
        [Op.ne]: null,
      },
    },
  });

  const ais = await Ai.findAll();

  console.log(
    `🔗 syncGroupAiFromAiTable: groups=${groups.length}, ais=${ais.length}`
  );

  for (const group of groups) {
    for (const ai of ais) {
      await Group_ai.findOrCreate({
        where: {
          group_id: group.id,
          ai_id: ai.id,
        },
        defaults: {
          init_token: 0,
        },
      });
    }
  }

  console.log("✅ syncGroupAiFromAiTable เสร็จแล้ว");
}

/***************** ดึงข้อมูล User ทุก 00:11  *****************/
async function upsertUserCountDaily(totalUser) {
  const today = moment.tz(TZ).startOf("day");
  const todayStr = today.format("YYYY-MM-DD");

  // หาแถวล่าสุด (อิง count_date)
  const lastRow = await User_count.findOne({
    order: [["count_date", "DESC"]],
    raw: true,
  });

  const lastDate = lastRow?.count_date
    ? moment.tz(String(lastRow.count_date), TZ).startOf("day")
    : null;

  // ค่าไว้เติมวันที่ขาด (6-9) ใช้ค่าล่าสุดที่มีอยู่ ไม่งั้น 0
  const carry = lastRow ? Number(lastRow.total_user) || 0 : 0;

  // 1) Backfill วันขาด: จากวันถัดจาก lastDate -> เมื่อวาน
  if (lastDate && lastDate.isBefore(today, "day")) {
    const rows = [];
    for (
      let d = lastDate.clone().add(1, "day");
      d.isBefore(today, "day");
      d.add(1, "day")
    ) {
      rows.push({
        count_date: d.format("YYYY-MM-DD"),
        total_user: carry,
      });
    }

    if (rows.length) {
      await User_count.bulkCreate(rows, { ignoreDuplicates: true });
      console.log(
        `📊 Backfilled user_count: ${rows[0].count_date} -> ${rows[rows.length - 1].count_date} (total_user=${carry})`
      );
    }
  }

  // 2) Upsert ของวันนี้ด้วยค่าที่คำนวณจาก API จริง
  // ถ้ามีแล้วให้ update, ไม่มีให้ create
  const [row, created] = await User_count.findOrCreate({
    where: { count_date: todayStr },
    defaults: { total_user: totalUser },
  });

  if (!created) {
    await User_count.update(
      { total_user: totalUser },
      { where: { count_date: todayStr } }
    );
    console.log(`📊 Updated user_count today (${todayStr}) total_user=${totalUser}`);
  } else {
    console.log(`📊 Created user_count today (${todayStr}) total_user=${totalUser}`);
  }

  return { count_date: todayStr, total_user: totalUser };
}
async function syncUsersFromApi() {
  let staffApiCount = 0;
  let assessorApiCount = 0;

  const SPECIAL_ID = "Admin01";

  const officerRoleName = "เจ้าหน้าที่";
  const adminRoleName = "ผู้ดูแลระบบ";

  const assessorGroupName = "กลุ่มผู้ประเมินภายนอก";
  const assessorRoleName = "ผู้ประเมินภายนอก";

  const headers = {
    Accept: "application/json",
    "X-Auth-ID": process.env.X_AUTH_ID,
    "X-Auth-Token": process.env.X_AUTH_TOKEN,
  };

  const existingGroups = await Group.findAll({
    attributes: ["id", "group_api_id", "name", "status"],
    where: { group_api_id: { [Op.ne]: null } },
    raw: true,
  });
  // ✅ หา group เพื่อดึง group_ai (init_token)
  const assessorGroup = await Group.findOne({
    where: { name: assessorGroupName },
    attributes: ["id", "name", "status"],
    raw: true,
  });
  const assessorGroupAis = await Group_ai.findAll({
    where: { group_id: assessorGroup.id },
    attributes: ["ai_id", "init_token"],
    raw: true,
  });

  // -------------------------------
  // 1) ดึง assessor ทั้งหมดแบบ pagination
  // -------------------------------
  const length = 1000;

  // ✅ REPLACE: axios.post -> onesqaPostUser
  const first = await onesqaPostUser(
    "/assessments/get_assessor",
    { start: "0", length: String(length) },
    headers
  );

  const total = Number(first.data?.total ?? 0);
  const firstItems = Array.isArray(first.data?.data) ? first.data.data : [];
  const pages = Math.ceil(total / length);

  const assessors = [...firstItems];

  for (let page = 1; page < pages; page++) {
    const start = page * length;

    // ✅ REPLACE: axios.post -> onesqaPostUser
    const res = await onesqaPostUser(
      "/assessments/get_assessor",
      { start: String(start), length: String(length) },
      headers
    );
    const items = Array.isArray(res.data?.data) ? res.data.data : [];
    assessors.push(...items);
  }
  console.log("✅ assessors fetched:", assessors.length);

  // 1) ✅ ดึง username ที่มีอยู่แล้วใน DB ไว้ตัดของเดิมออกจาก API
  const dbUsers = await User.findAll({
    attributes: ["username"],
    where: { username: { [Op.ne]: null } },
    raw: true,
  });

  const existingUsernameSet = new Set(
    dbUsers
      .map((u) => String(u.username || "").trim())
      .filter(Boolean)
  );

  // 2) ✅ DB USED: รวม token_count ของ User_ai แยกตาม ai_id (token_count != 0)
  const dbUsedRows = await User_ai.findAll({
    attributes: ["ai_id", [fn("SUM", col("token_count")), "used"]],
    where: { token_count: { [Op.ne]: 0 } },
    group: ["ai_id"],
    raw: true,
  });

  const dbUsedByAiId = new Map(
    dbUsedRows.map((r) => [Number(r.ai_id), Number(r.used) || 0])
  );

  // 3) ✅ API ADD: สะสม (newUserCount * init_token) แยกตาม ai_id
  const apiAddByAiId = new Map(); // ai_id -> token ที่จะเพิ่มจาก user ใหม่

  // helper: key ของ user จาก API get_user
  // helper: key ของ assessor จาก API get_assessor (ใช้ id_card)
  const getAssessorKey = (a) => String(a?.id_card ?? "").trim();

  // ----------------------------------------------------
  // 3.A) ✅ เพิ่ม get_assessor เข้าไปในการคำนวณ (เฉพาะ user ใหม่)
  //     โดยใช้ id_card เทียบกับ username ใน DB
  // ----------------------------------------------------
  if (!assessorGroup || !assessorGroup.id) {
    throw new Error(`Assessor group not found: ${assessorGroupName}`);
  }

  if (assessorGroupAis?.length) {
    const newAssessors = assessors.filter((a) => {
      const key = getAssessorKey(a); // ✅ id_card
      if (!key) return false;
      return !existingUsernameSet.has(key); // ✅ DB username เก็บ id_card
    });

    const newAssessorCount = newAssessors.length;

    if (newAssessorCount > 0) {
      // กันนับซ้ำในรอบเดียวกัน
      for (const a of newAssessors) {
        const key = getAssessorKey(a);
        if (key) existingUsernameSet.add(key); // ✅ add id_card เข้า set
      }

      // คิด token เพิ่มของ assessor ตาม group_ai ของ assessorGroup
      for (const ga of assessorGroupAis) {
        const aiId = Number(ga.ai_id);
        const initToken = Number(ga.init_token) || 0;
        if (!aiId || initToken === 0) continue;

        const add = newAssessorCount * initToken;
        apiAddByAiId.set(aiId, (apiAddByAiId.get(aiId) || 0) + add);
      }
    }
  } 

  // ----------------------------------------------------
  // 3.B) ✅ ของเดิม: วนทุก group แล้วคิดเฉพาะ user ใหม่จาก get_user (ใช้ username ตามเดิม)
  // ----------------------------------------------------
  for (const g of existingGroups) {
    // 3.1) ดึง group_ai ของกลุ่มนี้
    const groupAis = await Group_ai.findAll({
      where: { group_id: g.id },
      attributes: ["ai_id", "init_token"],
      raw: true,
    });
    if (!groupAis?.length) continue;

    // ✅ REPLACE: axios.post -> onesqaPostUser
    const response = await onesqaPostUser(
      "/basics/get_user",
      { group_id: String(g.group_api_id) },
      headers
    );

    const users = Array.isArray(response.data?.data) ? response.data.data : [];
    if (!users.length) continue;

    // 3.3) ตัด user ที่มีอยู่แล้วใน DB ออก (เทียบด้วย username)
    const newUsers = users.filter((u) => {
      const username = String(u?.username || "").trim();
      if (!username) return false;
      return !existingUsernameSet.has(username);
    });

    const newUserCount = newUsers.length;
    if (newUserCount === 0) continue;

    // กันการนับซ้ำ username ข้ามกลุ่มในรอบเดียวกัน
    for (const u of newUsers) {
      const username = String(u?.username || "").trim();
      if (username) existingUsernameSet.add(username);
    }

    // 3.4) คูณ newUserCount กับ init_token ของ group_ai แต่ละตัว แล้วรวมใส่ Map
    for (const ga of groupAis) {
      const aiId = Number(ga.ai_id);
      const initToken = Number(ga.init_token) || 0;
      if (!aiId || initToken === 0) continue;

      const add = newUserCount * initToken;
      apiAddByAiId.set(aiId, (apiAddByAiId.get(aiId) || 0) + add);
    }
  }

  // 4) ✅ เทียบกับ token_count ของ Ai โดยใช้ (DB + API ใหม่)
  const aiIds = Array.from(
    new Set([...dbUsedByAiId.keys(), ...apiAddByAiId.keys()])
  );

  //if (aiIds.length === 0) return; // ไม่มีอะไรต้องเช็ค

  const ais = await Ai.findAll({
    where: { id: { [Op.in]: aiIds } },
    attributes: ["id", "token_count"],
    raw: true,
  });

  const quotaByAiId = new Map(
    ais.map((a) => [Number(a.id), Number(a.token_count) || 0])
  );

  const exceeded = [];
  for (const aiId of aiIds) {
    const dbUsed = dbUsedByAiId.get(aiId) || 0;
    const apiAdd = apiAddByAiId.get(aiId) || 0;
    const total = dbUsed + apiAdd;

    const quota = quotaByAiId.get(aiId);

    console.log("aiId", aiId);
    console.log("dbUsed", dbUsed);
    console.log("apiAdd(new)", apiAdd);
    console.log("total", total);
    console.log("quota", quota);

    // ไม่เจอ ai => error
    if (quota == null) {
      exceeded.push({ aiId, dbUsed, apiAdd, total, quota: null });
      continue;
    }

    // กันเคส total=0 แล้ว quota=0 จะชนเงื่อนไขโดยไม่จำเป็น
    if (total > 0 && total >= quota) {
      exceeded.push({ aiId, dbUsed, apiAdd, total, quota });
    }
  }
  if (exceeded.length > 0) {
    throw new Error("AI token quota is insufficient");
  }

  // ส่วนของข้อมูล เจ้าหน้าที่
  try {
    // ✅ หา role_id ของ "เจ้าหน้าที่" และ "ผู้ดูแลระบบ" ก่อน (ทำครั้งเดียว)
    const [officerRole, adminRole] = await Promise.all([
      Role.findOne({
        where: { role_name_th: officerRoleName },
        attributes: ["id"],
        raw: true,
      }),
      Role.findOne({
        where: { role_name_th: adminRoleName },
        attributes: ["id"],
        raw: true,
      }),
    ]);

    if (!officerRole?.id) {
      throw new Error(`Role not found: ${officerRoleName}`);
    }
    if (!adminRole?.id) {
      throw new Error(`Role not found: ${adminRoleName}`);
    }
    const officerRoleId = officerRole.id;
    const adminRoleId = adminRole.id;

    let created = 0;
    let updated = 0;
    let deletedDup = 0;
    let deletedMissing = 0;
    let userAiCreated = 0;
    let userRoleCreated = 0;

    for (const g of existingGroups) {
      try {
        const groupAis = await Group_ai.findAll({
          where: { group_id: g.id },
          attributes: ["ai_id", "init_token"],
          raw: true,
        });

        // ✅ REPLACE: axios.post -> onesqaPostUser
        const response = await onesqaPostUser(
          "/basics/get_user",
          { group_id: String(g.group_api_id) },
          headers
        );

        const users = Array.isArray(response.data?.data) ? response.data.data : [];

        staffApiCount += users.length

        const apiUsernames = users
          .map((u) => (u?.username || "").trim())
          .filter((x) => x && x !== SPECIAL_ID);

        const isAdminGroup = String(g?.name ?? "").trim().toLowerCase() === "admin";
        const roleIdForGroup = isAdminGroup ? adminRoleId : officerRoleId;

        await db.sequelize.transaction(async (t) => {
          // =========================
          // 1) ลบ user ที่ไม่อยู่ใน API แล้ว (เฉพาะ group_name นี้) ยกเว้น Admin01
          // =========================
          const whereMissing =
            apiUsernames.length > 0
              ? {
                  group_name: g.name,
                  username: {
                    [Op.and]: [{ [Op.ne]: SPECIAL_ID }, { [Op.notIn]: apiUsernames }],
                  },
                }
              : {
                  group_name: g.name,
                  username: { [Op.ne]: SPECIAL_ID },
                };

          const missingRows = await User.findAll({
            where: whereMissing,
            attributes: ["id"],
            transaction: t,
            lock: t.LOCK.UPDATE,
          });

          if (missingRows.length > 0) {
            const ids = missingRows.map((r) => r.id);
            await User.destroy({
              where: { id: { [Op.in]: ids } },
              transaction: t,
            });
            deletedMissing += ids.length;
          }

          // =========================
          // 2) Upsert user จาก API + ลบ duplicate username (ถ้ามี)
          // =========================
          for (const apiUser of users) {
            const username = (apiUser?.username || "").trim();
            if (!username) continue;

            // ❌ ไม่แตะ Admin01
            if (username === SPECIAL_ID) continue;

            const payload = {
              firstname: apiUser?.fname ?? "",
              lastname: apiUser?.lname ?? "",
              username,
              email: apiUser?.email ?? "",
              phone: apiUser?.phone ?? "",
              position: apiUser?.position ?? "",
              group_name: g.name,
              ai_access: g.status,
              login_type: "NORMAL",
            };

            const found = await User.findAll({
              where: { username },
              order: [["id", "ASC"]],
              transaction: t,
              lock: t.LOCK.UPDATE,
            });

            let userRow = found[0] || null;

            // ลบ duplicate (เหลือแถวแรก)
            if (found.length > 1) {
              const dupIds = found.slice(1).map((u) => u.id);
              await User.destroy({
                where: { id: { [Op.in]: dupIds } },
                transaction: t,
              });
              deletedDup += dupIds.length;
            }

            const isNewUser = !userRow;

            if (!userRow) {
              userRow = await User.create(payload, { transaction: t }); // ✅ id auto
              created++;
            } else {
              await User.update(payload, {
                where: { id: userRow.id },
                transaction: t,
              });
              updated++;
            }

            // =========================
            // 3) สร้าง user_role (role = "เจ้าหน้าที่") ถ้ายังไม่มี
            // =========================
            // ✅ บันทึก role เฉพาะ "ครั้งแรก" (user ใหม่)
            if (isNewUser) {
              const existingUserRole = await User_role.findOne({
                where: { user_id: userRow.id, role_id: roleIdForGroup },
                transaction: t,
                lock: t.LOCK.UPDATE,
              });

              if (!existingUserRole) {
                await User_role.create(
                  { user_id: userRow.id, role_id: roleIdForGroup },
                  { transaction: t }
                );
                userRoleCreated++;
              }
            }

            // =========================
            // 4) sync user_ai ตาม group_ai ของกลุ่มนี้
            //    - user ใหม่: create token ตาม init_token
            //    - user เก่า: ไม่ update token (แต่ถ้าไม่มี record ให้ create)
            // =========================
            for (const ga of groupAis) {
              const aiId = Number(ga.ai_id);
              const initToken = Number(ga.init_token ?? 0);

              const ua = await User_ai.findOne({
                where: { user_id: userRow.id, ai_id: aiId },
                transaction: t,
                lock: t.LOCK.UPDATE,
              });

              if (!ua) {
                // ✅ ถ้าไม่มี record -> สร้าง
                await User_ai.create(
                  {
                    user_id: userRow.id,
                    ai_id: aiId,
                    token_count: initToken,
                    token_all: initToken,
                    is_notification: false,
                  },
                  { transaction: t }
                );
                userAiCreated++;
              } else {
                // ✅ มีอยู่แล้ว:
                // - user ใหม่: ปกติจะเพิ่งสร้าง record ใหม่อยู่แล้ว (แต่ถ้ามีอยู่ก็ไม่ต้องแก้)
                // - user เก่า: "ห้าม update token" ตาม requirement
                // do nothing
                if (isNewUser) {
                  // do nothing
                }
              }
            }
          }
        });
      } catch (err) {
        // ✅ ถ้า ONESQA ล่ม -> ต้อง throw ออกไปทันที
        if (err?.message === "ระบบ ONESQA ไม่พร้อมใช้งาน") throw err;

        console.error(`❌ group_api_id=${g.group_api_id} (${g.name}) error:`, err.message);
        if (err.response) console.error("response data:", err.response.data);
      }
    }

    console.log("✅ sync summary:", {
      created,
      updated,
      deletedDup,
      deletedMissing,
      userRoleCreated,
      userAiCreated,
    });
  } catch (err) {
    // ✅ ถ้า ONESQA ล่ม -> ต้อง throw ออกไปทันที
    if (err?.message === "ระบบ ONESQA ไม่พร้อมใช้งาน") throw err;

    console.error("❌ main error:", err.message);
    if (err.response) console.error("response data:", err.response.data);
  }

  // ส่วนของข้อมูล ผู้ประเมินภายนอก
  try {
    const groupAis = await Group_ai.findAll({
      where: { group_id: assessorGroup.id },
      attributes: ["ai_id", "init_token"],
      raw: true,
    });

    // ✅ หา role_id ของ "ผู้ประเมินภายนอก"
    const assessorRole = await Role.findOne({
      where: { role_name_th: assessorRoleName },
      attributes: ["id"],
      raw: true,
    });
    const assessorRoleId = assessorRole.id;

    assessorApiCount += assessors.length;

    // -------------------------------
    // 2) เตรียม username จาก assessor
    // ใช้ id_card เป็นหลัก (เสถียร/ไม่ซ้ำ) ถ้าไม่มีค่อย fallback
    // -------------------------------
    const toUsername = (a) => {
      const idCard = (a?.id_card || "").trim();
      if (idCard) return idCard;
      const email = (a?.email || "").trim();
      if (email) return email;
      const badge = (a?.badge_no || "").trim();
      if (badge) return badge;
      return `assessor_${a?.id ?? Math.random().toString(36).slice(2)}`;
    };

    const apiUsernames = assessors
      .map((a) => toUsername(a))
      .filter((u) => u && u !== SPECIAL_ID); // เผื่อมีหลุดมา

    let created = 0;
    let updated = 0;
    let deletedDup = 0;
    let deletedMissing = 0;
    let userRoleCreated = 0;
    let userAiCreated = 0;

    // -------------------------------
    // 3) Sync ลง DB (เหมือน flow ก่อนหน้า)
    // -------------------------------
    await db.sequelize.transaction(async (t) => {
      // 3.1) ลบ user ที่ไม่อยู่ใน API แล้ว (เฉพาะกลุ่มผู้ประเมินภายนอก) ยกเว้น Admin01
      const whereMissing =
        apiUsernames.length > 0
          ? {
              group_name: assessorGroupName,
              username: {
                [Op.and]: [{ [Op.ne]: SPECIAL_ID }, { [Op.notIn]: apiUsernames }],
              },
            }
          : {
              group_name: assessorGroupName,
              username: { [Op.ne]: SPECIAL_ID },
            };

      const missingRows = await User.findAll({
        where: whereMissing,
        attributes: ["id"],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (missingRows.length > 0) {
        const ids = missingRows.map((r) => r.id);
        await User.destroy({
          where: { id: { [Op.in]: ids } },
          transaction: t,
        });
        deletedMissing += ids.length;
      }

      // 3.2) upsert assessor ทีละคน
      for (const a of assessors) {
        const username = toUsername(a);
        if (!username) continue;
        if (username === SPECIAL_ID) continue; // ❌ ไม่แตะ

        const payload = {
          firstname: a?.name ?? "",
          lastname: a?.lastname ?? "",
          username,
          email: a?.email ?? "",
          phone: a?.tel ?? "",
          group_name: assessorGroupName,
          ai_access: assessorGroup?.status,
          login_type: "INSPEC", // ถ้าต้องการแยกผู้ประเมินเป็น INSPEC เปลี่ยนเป็น "INSPEC"
          position: "",
        };

        // กันเคส username ซ้ำหลายแถว
        const found = await User.findAll({
          where: { username },
          order: [["id", "ASC"]],
          transaction: t,
          lock: t.LOCK.UPDATE,
        });

        let userRow = found[0] || null;

        if (found.length > 1) {
          const dupIds = found.slice(1).map((u) => u.id);
          await User.destroy({
            where: { id: { [Op.in]: dupIds } },
            transaction: t,
          });
          deletedDup += dupIds.length;
        }

        const isNewUser = !userRow;

        if (!userRow) {
          userRow = await User.create(payload, { transaction: t });
          created++;
        } else {
          await User.update(payload, {
            where: { id: userRow.id },
            transaction: t,
          });
          updated++;
        }

        // 3.3) สร้าง user_role = ผู้ประเมินภายนอก ถ้ายังไม่มี
        // ✅ role: ทำเฉพาะ "user ใหม่" เท่านั้น (คนเดิมไม่แตะ role)
        if (isNewUser) {
          const existingUserRole = await User_role.findOne({
            where: { user_id: userRow.id, role_id: assessorRoleId },
            transaction: t,
            lock: t.LOCK.UPDATE,
          });

          if (!existingUserRole) {
            await User_role.create(
              { user_id: userRow.id, role_id: assessorRoleId },
              { transaction: t }
            );
            userRoleCreated++;
          }
        }

        // 3.4) user_ai: ถ้า user ใหม่ -> create token ตาม init_token
        //     ถ้า user เก่า -> "ไม่ update token" (แต่ถ้าไม่มี record ให้ create)
        for (const ga of groupAis) {
          const aiId = Number(ga.ai_id);
          const initToken = Number(ga.init_token ?? 0);

          const ua = await User_ai.findOne({
            where: { user_id: userRow.id, ai_id: aiId },
            transaction: t,
            lock: t.LOCK.UPDATE,
          });

          if (!ua) {
            await User_ai.create(
              {
                user_id: userRow.id,
                ai_id: aiId,
                token_count: initToken,
                token_all: initToken,
                is_notification: false,
              },
              { transaction: t }
            );
            userAiCreated++;
          } else {
            // ✅ มีอยู่แล้ว: ไม่ update token ตาม requirement (ทั้ง user ใหม่/เก่า)
            // do nothing
            if (isNewUser) {
              // do nothing
            }
          }
        }
      }
    });

    console.log("✅ assessor sync summary:", {
      fetched: assessors.length,
      created,
      updated,
      deletedDup,
      deletedMissing,
      userRoleCreated,
      userAiCreated,
    });
  } catch (err) {
    // ✅ ถ้า ONESQA ล่ม -> ต้อง throw ออกไปทันที
    if (err?.message === "ระบบ ONESQA ไม่พร้อมใช้งาน") throw err;

    console.error("❌ assessor sync error:", err.message);
    if (err.response) console.error("response data:", err.response.data);
  }

    // 🔢 นับจำนวน user ทั้งหมดจริงจากระบบ
  const totalUser = staffApiCount + assessorApiCount;

  // ✅ บันทึกแบบรายวัน + backfill วันที่ขาด
  await upsertUserCountDaily(totalUser);

  return {
    totalUsersFromApis: totalUser,
    staffApiCount,
    assessorApiCount,
  };
}

/***************** ดึงข้อมูล SAR File ของระดับที่ 1 ทุก 01:01  *****************/
async function syncAcademyFromApiOne() {
  const headers = {
    Accept: "application/json",
    "X-Auth-ID": process.env.X_AUTH_ID,
    "X-Auth-Token": process.env.X_AUTH_TOKEN,
  };

  const sequelize = db.sequelize;
  const qi = sequelize.getQueryInterface();
  const qg = qi.queryGenerator;
  const table = qg.quoteTable(Academy.getTableName());

  for (let level = 1; level < 2; level++) {
    console.log("academy_level_id =", level);

    const length = 1000;

    const first = await onesqaPostSar(
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
      const res = await onesqaPostSar(
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
        const sarRes = await onesqaPostSar("/basics/get_sar", { academy_code: a.code }, headers);
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

/***************** ดึงข้อมูล SAR File ของระดับที่ 2-6 ทุก 02:01 *****************/
async function syncAcademyFromApiTwoSix() {
  const headers = {
    Accept: "application/json",
    "X-Auth-ID": process.env.X_AUTH_ID,
    "X-Auth-Token": process.env.X_AUTH_TOKEN,
  };

  const sequelize = db.sequelize;
  const qi = sequelize.getQueryInterface();
  const qg = qi.queryGenerator;
  const table = qg.quoteTable(Academy.getTableName());

  for (let level = 2; level < 7; level++) {
    console.log("academy_level_id =", level);

    const length = 1000;

    const first = await onesqaPostSar(
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
      const res = await onesqaPostSar(
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
        const sarRes = await onesqaPostSar("/basics/get_sar", { academy_code: a.code }, headers);
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

/***************** สร้าง User Count วันล่าสุด ทุก 00:01  *****************/
async function dailyUserCount() {
  try {
    const now = moment().tz(TZ);
    const today = now.clone().startOf("day");
    const todayStr = today.format("YYYY-MM-DD");

    // หา record ล่าสุดตาม count_date
    const lastRow = await User_count.findOne({
      order: [["count_date", "DESC"]],
    });

    // ถ้ามีข้อมูลวันนี้แล้ว -> ไม่ทำอะไร
    if (lastRow?.count_date === todayStr) {
      console.log("📊 user_count วันนี้มีอยู่แล้ว — skip");
      return;
    }

    // ใช้ total_user ของวันล่าสุด (ที่ไม่ใช่วันนี้) ถ้ามี ไม่งั้น 0
    const carryTotalUser = lastRow ? Number(lastRow.total_user) || 0 : 0;

    // ถ้าไม่มีข้อมูลเลย -> สร้างเฉพาะวันนี้เป็น 0
    let startDate = today.clone();
    if (lastRow?.count_date) {
      const lastDate = moment.tz(String(lastRow.count_date), TZ).startOf("day");

      // ถ้า lastDate อยู่อนาคต (กรณีเวลาเพี้ยน) ให้กันไว้
      if (lastDate.isAfter(today, "day")) {
        console.log("⚠️ last count_date is in the future — skip");
        return;
      }

      // เริ่มสร้างจากวันถัดจาก lastDate ถึง today (เช่น last=5 วันนี้=10 -> สร้าง 6-10)
      startDate = lastDate.clone().add(1, "day");
    }

    const rows = [];
    for (let d = startDate.clone(); d.isSameOrBefore(today, "day"); d.add(1, "day")) {
      rows.push({
        count_date: d.format("YYYY-MM-DD"),
        total_user: carryTotalUser,
      });
    }

    if (!rows.length) {
      console.log("📊 ไม่มีวันที่ต้องสร้างเพิ่ม");
      return;
    }

    // ใช้ bulkCreate + ignoreDuplicates (ปลอดภัย ถ้า cron เผลอรันซ้ำ)
    await User_count.bulkCreate(rows, { ignoreDuplicates: true });

    console.log(
      `📊 Created user_count rows: ${rows[0].count_date} -> ${rows[rows.length - 1].count_date} (total_user=${carryTotalUser})`
    );
  } catch (err) {
    console.error("❌ dailyUserCount error:", err);
  }
}

/***************** ลบ Notification ที่เกิน 1 เดือน ทุก 00:01  *****************/
const cleanupOldNotifications = async () => {
  try {
    const now = moment().tz(TZ);

    // ลบข้อมูลที่เก่ากว่า 1 เดือน
    // const oneMonthAgo = now.clone().subtract(1, "months").toDate();
    // หรือถ้าอยากชัดเป็นต้นวัน:
    const oneMonthAgo = now.clone().subtract(1, "months").startOf("day").toDate();

    const deletedCount = await Notification.destroy({
      where: {
        createdAt: {
          [Op.lt]: oneMonthAgo,
        },
      },
    });

    console.log(
      `[CRON][Notification] ${now.format("YYYY-MM-DD HH:mm:ss")} ลบข้อมูลแล้ว ${deletedCount} รายการ`
    );
    return deletedCount;
  } catch (error) {
    console.error("[CRON][Notification] Error:", error);
    throw error;
  }
};

/***************** ลบ User Daily Active ที่เกิน 6 เดือน ทุก 00:01  *****************/
const cleanupOldUserDailyActives = async () => {
  try {
    const now = moment().tz(TZ);

    // ลบข้อมูลที่เก่ากว่า 6 เดือน (ยึดเวลาไทย)
    // const sixMonthsAgo = now.clone().subtract(6, "months").toDate();
    // ถ้าต้องการให้ชัดเจนเป็นต้นวัน:
    const sixMonthsAgo = now.clone().subtract(6, "months").startOf("day").toDate();

    const deletedCount = await User_daily_active.destroy({
      where: {
        createdAt: {
          [Op.lt]: sixMonthsAgo,
        },
      },
    });

    console.log(
      `[CRON][User_daily_active] ${now.format("YYYY-MM-DD HH:mm:ss")} ลบข้อมูลแล้ว ${deletedCount} รายการ`
    );
    return deletedCount;
  } catch (error) {
    console.error("[CRON][User_daily_active] Error:", error);
    throw error;
  }
};

/***************** ลบ RefreshToken ที่หมดอายุ ทุก 10 นาที  *****************/
const cleanupExpiredRefreshTokens = async () => {
  const nowMoment = moment().tz(TZ);
  const now = nowMoment.toDate();

  try {
    const result = await db.sequelize.transaction(async (t) => {
      // 1) หา token ที่หมดอายุ (ล็อคแถวกันรันซ้ำซ้อน)
      const expiredTokens = await RefreshToken.findAll({
        where: {
          expiresAt: { [Op.lt]: now },
        },
        attributes: ["id", "user_id", "user_agent", "expiresAt"],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!expiredTokens.length) {
        return { deletedCount: 0, offlineUsers: 0 };
      }

      // 2) บันทึกลง user_login_history เป็น LOGOUT (ต่อ 1 token ที่ถูกลบ)
      const historyRows = expiredTokens
        .filter((rt) => rt.user_id)
        .map((rt) => ({
          user_id: rt.user_id,
          event_type: "LOGOUT",
          user_agent: rt.user_agent ?? null,
        }));

      if (historyRows.length) {
        await User_login_history.bulkCreate(historyRows, { transaction: t });
      }

      // 3) ลบ token ที่หมดอายุ
      const ids = expiredTokens.map((rt) => rt.id);
      const userIds = [
        ...new Set(expiredTokens.map((rt) => rt.user_id).filter(Boolean)),
      ];

      const deletedCount = await RefreshToken.destroy({
        where: { id: { [Op.in]: ids } },
        transaction: t,
      });

      // 4) ถ้า user ไม่เหลือ refreshToken ที่ยังไม่หมดอายุแล้ว -> set is_online=false
      let offlineUsers = 0;

      if (userIds.length) {
        const remaining = await RefreshToken.findAll({
          attributes: ["user_id", [fn("COUNT", col("id")), "cnt"]],
          where: {
            user_id: { [Op.in]: userIds },
            expiresAt: { [Op.gte]: now }, // ยังไม่หมดอายุ
          },
          group: ["user_id"],
          raw: true,
          transaction: t,
        });

        const remainingMap = new Map(
          remaining.map((r) => [Number(r.user_id), Number(r.cnt) || 0])
        );

        const toOffline = userIds.filter(
          (uid) => (remainingMap.get(Number(uid)) || 0) === 0
        );

        if (toOffline.length) {
          const [affected] = await User.update(
            { is_online: false },
            { where: { id: { [Op.in]: toOffline } }, transaction: t }
          );
          offlineUsers = affected || 0;
        }
      }

      return { deletedCount, offlineUsers };
    });

    console.log(
      `[CRON][RefreshToken] ${nowMoment.format(
        "YYYY-MM-DD HH:mm:ss"
      )} ลบ refresh token หมดอายุแล้ว ${result.deletedCount} รายการ, set is_online=false ${result.offlineUsers} users`
    );
  } catch (error) {
    console.error("[CRON][RefreshToken] Error:", error);
  }
};

/**
 * ▶️ เริ่ม cron ทั้งชุด
 */
function startDailyJobs() {
  // รันตอนเปิดเซิร์ฟเวอร์
  syncGroupsFromApi();
  dailyUserCount();

  // ⚠️ ปกติไม่ต้องรันทันที (กันพลาด)
  //syncUsersFromApi();
  //syncAcademyFromApiOne();
  //syncAcademyFromApiTwoSix();
  //cleanupOldNotifications();
  //cleanupOldUserDailyActives();
  //cleanupExpiredRefreshTokens();

  // ⏰ ดึง Group ทุกวัน 00:01
  cron.schedule(
    "1 0 * * *",
    () => {
      console.log("⏰ Running daily job (00:01): syncGroupsFromApi()");
      syncGroupsFromApi();
    },
    { timezone: TZ }
  );

  // ✅ ดึง User ทุกวัน 00:11
  cron.schedule(
    "11 0 * * *",
    () => {
      console.log("⏰ Running daily job (00:11): syncUsersFromApi()");
      syncUsersFromApi();
    },
    { timezone: TZ }
  );

  // ✅ ดึง SAR File ทุกวัน 01:01
  cron.schedule(
    "1 1 * * *",
    () => {
      console.log("⏰ Running daily job (01:01): syncAcademyFromApiOne()");
      syncAcademyFromApiOne();
    },
    { timezone: TZ }
  );

  // ✅ ดึง SAR File ทุกวัน 02:01
  cron.schedule(
    "1 2 * * *",
    () => {
      console.log("⏰ Running daily job (02:01): syncAcademyFromApiTwoSix()");
      syncAcademyFromApiTwoSix();
    },
    { timezone: TZ }
  );

  // 📅 รันทุกวัน 00:01
  cron.schedule(
    "1 0 * * *",
    () => {
      console.log("⏰ Running daily job: dailyUserCount()");
      dailyUserCount();
    },
    { timezone: TZ }
  );

  // ⏰ รันทุกวัน 00:01
  cron.schedule(
    "1 0 * * *",
    () => {
      console.log("⏰ Running daily job: cleanupOldNotifications()");
      cleanupOldNotifications();
    },
    { timezone: TZ }
  );

  // ⏰ รันทุกวัน 00:01
  cron.schedule(
    "1 0 * * *",
    () => {
      console.log("⏰ Running daily job: cleanupOldUserDailyActives()");
      cleanupOldUserDailyActives();
    },
    { timezone: TZ }
  );

  // ⏰ รันทุก 10 นาที
  cron.schedule(
    "*/10 * * * *",
    () => {
      console.log("⏰ Running daily job: cleanupExpiredRefreshTokens()");
      cleanupExpiredRefreshTokens();
    },
    { timezone: TZ }
  );
}

module.exports = {
  startDailyJobs,
  syncGroupsFromApi,
  syncGroupAiFromAiTable,
  syncUsersFromApi,
  syncAcademyFromApiOne,
  syncAcademyFromApiTwoSix,
  dailyUserCount,
  cleanupOldNotifications,
  cleanupOldUserDailyActives,
  cleanupExpiredRefreshTokens,
};
