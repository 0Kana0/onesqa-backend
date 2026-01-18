const moment = require("moment-timezone");
const UAParser = require("ua-parser-js");
const { Op } = require("sequelize");
const db = require("../db/models");
const { User, User_daily_active, User_login_history  } = db;

async function setUserLoginHistory(user_id, event_type, ctx) {
  //console.log("ctx setUserLoginHistory", ctx);
  const SPECIAL_ID = "Admin01";

  const findUser = await User.findByPk(user_id, {
    attributes: ["id", "username", "login_type"],
  })
  // ถ้าไม่เจอ user ก็ไม่ต้องทำอะไร (กัน error)
  if (!findUser) return null;
  // ✅ ถ้าเป็น Admin01 ไม่ต้องบันทึก login history
  if (findUser.username === SPECIAL_ID) return null;

  const req = ctx.req;

  const ua = req.headers["user-agent"] || "";
  const parsed = new UAParser(ua).getResult();

  const browserName = parsed.browser.name;
  const browserVersion = parsed.browser.version;
  // const osName = parsed.os.name;
  // const osVersion = parsed.os.version;

  console.log(browserName, browserVersion);
  
  const loginHistory = await User_login_history.create({
    user_id: user_id,
    event_type: event_type,
    user_agent: browserName + " " + browserVersion
  })

  return loginHistory
} 

async function setUserDailyActive(user_id, active_type) {
  const SPECIAL_ID = "Admin01";
  const TZ = "Asia/Bangkok";

  const findUser = await User.findByPk(user_id, {
    attributes: ["id", "username", "login_type"],
  });

  if (!findUser) return null;
  if (findUser.username === SPECIAL_ID) return null;

  // ทำให้ updateAt เปลี่ยนค่า
  await User.update(
    { login_type: findUser?.login_type },
    { where: { id: user_id } }
  );

  // ✅ ช่วง "วันนี้" ตามเวลาไทย
  const startOfToday = moment.tz(TZ).startOf("day").toDate();
  const startOfTomorrow = moment.tz(TZ).add(1, "day").startOf("day").toDate();

  // ✅ ถ้า active_type ของผู้ใช้งานนี้ "วันนี้" มีอยู่แล้วไม่ต้องบันทึก
  const findDailyActive = await User_daily_active.findOne({
    where: {
      user_id,
      active_type,
      createdAt: {
        [Op.gte]: startOfToday,
        [Op.lt]: startOfTomorrow,
      },
    },
  });

  if (findDailyActive) return null;

  const dailyActive = await User_daily_active.create({
    user_id,
    active_type,
  });

  return dailyActive;
}

module.exports = { setUserLoginHistory, setUserDailyActive };
