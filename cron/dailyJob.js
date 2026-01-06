// cron/dailyJob.js
const axios = require("axios");
require("dotenv").config();
const cron = require("node-cron");
const moment = require("moment-timezone");
const { Op } = require("sequelize");

const db = require("../db/models");
const { Group, Group_ai, Ai, User_count, Notification, RefreshToken } = db;

const TZ = "Asia/Bangkok";

/**
 * ดึง group จาก ONESQA API แล้ว sync กับ table group
 */
async function syncGroupsFromApi() {
  try {
    const response = await axios.post(
      `${process.env.ONESQA_URL}/basics/get_group`,
      null,
      {
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

/**
 * 🧮 สร้าง user_count ของเดือนปัจจุบัน
 * - ใช้ total_user ของเดือนที่แล้ว
 * - รัน 00:01 วันที่ 1 ของทุกเดือน
 */
async function monthlyUserCount() {
  try {
    console.log("📊 Start monthlyUserCount");

    const startOfThisMonth = moment.tz(TZ).startOf("month").toDate();
    const endOfThisMonth = moment.tz(TZ).endOf("month").toDate();

    // ❗ ป้องกันสร้างซ้ำ
    const exists = await User_count.findOne({
      where: {
        createdAt: {
          [Op.between]: [startOfThisMonth, endOfThisMonth],
        },
      },
    });

    if (exists) {
      console.log("📊 user_count เดือนนี้มีอยู่แล้ว — skip");
      return;
    }

    const startOfLastMonth = moment
      .tz(TZ)
      .subtract(1, "month")
      .startOf("month")
      .toDate();

    const endOfLastMonth = moment
      .tz(TZ)
      .subtract(1, "month")
      .endOf("month")
      .toDate();

    const lastMonth = await User_count.findOne({
      where: {
        createdAt: {
          [Op.between]: [startOfLastMonth, endOfLastMonth],
        },
      },
      order: [["createdAt", "DESC"]],
    });

    const totalUser = lastMonth?.total_user ?? 0;

    await User_count.create({
      total_user: totalUser,
    });

    console.log(
      `📊 Created user_count for new month (total_user=${totalUser})`
    );
  } catch (err) {
    console.error("❌ monthlyUserCount error:", err);
  }
}

/**
 * 🧹 ลบ Notification ที่เกิน 6 เดือน
 */
const cleanupOldNotifications = async () => {
  try {
    const now = moment().tz(TZ);

    // วันที่ย้อนหลัง 6 เดือน
    const sixMonthsAgo = now.clone().subtract(6, "months").toDate();

    const deletedCount = await Notification.destroy({
      where: {
        createdAt: {
          [require("sequelize").Op.lt]: sixMonthsAgo,
        },
      },
    });

    console.log(
      `[CRON][Notification] ${now.format("YYYY-MM-DD HH:mm:ss")} ลบข้อมูลแล้ว ${deletedCount} รายการ`
    );
  } catch (error) {
    console.error("[CRON][Notification] Error:", error);
  }
};

/**
 * 🧹 ลบ RefreshToken ที่หมดอายุ
 */
const cleanupExpiredRefreshTokens = async () => {
  try {
    const now = moment().tz(TZ).toDate();

    const deletedCount = await RefreshToken.destroy({
      where: {
        expiresAt: {
          [Op.lt]: now, // expiresAt < เวลาปัจจุบัน
        },
      },
    });

    console.log(
      `[CRON][RefreshToken] ${moment(now)
        .tz(TZ)
        .format("YYYY-MM-DD HH:mm:ss")} ลบ refresh token หมดอายุแล้ว ${deletedCount} รายการ`
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

  // ⚠️ ปกติไม่ต้องรันทันที (กันพลาด)
  //monthlyUserCount();
  //cleanupOldNotifications();
  //cleanupExpiredRefreshTokens();

  // ⏰ รันทุกวัน 00:01
  cron.schedule(
    "1 0 * * *",
    () => {
      console.log("⏰ Running daily job: syncGroupsFromApi()");
      syncGroupsFromApi();
    },
    { timezone: TZ }
  );

  // ⏰ รันทุกวัน 00:10
  cron.schedule(
    "10 0 * * *",
    () => {
      console.log("⏰ Running daily job: cleanupExpiredRefreshTokens()");
      cleanupExpiredRefreshTokens();
    },
    { timezone: TZ }
  );

  // ⏰ รันทุกวัน 01:01
  cron.schedule(
    "1 1 * * *",
    () => {
      console.log("⏰ Running daily job: cleanupOldNotifications()");
      cleanupOldNotifications();
    },
    { timezone: TZ }
  );

  // 📅 รันทุกเดือน 00:01 วันที่ 1
  cron.schedule(
    "1 0 1 * *",
    () => {
      console.log("⏰ Running monthly job: monthlyUserCount()");
      monthlyUserCount();
    },
    { timezone: TZ }
  );
}

module.exports = {
  startDailyJobs,
  syncGroupsFromApi,
  syncGroupAiFromAiTable,
  cleanupOldNotifications,
  cleanupExpiredRefreshTokens,
  monthlyUserCount,
};
