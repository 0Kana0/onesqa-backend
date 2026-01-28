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

  // อัปเดต user แบบไม่ให้ hook วนซ้ำ
  await User.update(
    { login_type: findUser.login_type },
    { where: { id: user_id }, hooks: false }
  );

  const active_date = moment.tz(TZ).format("YYYY-MM-DD");

  try {
    // ✅ atomic จริง: INSERT อย่างเดียว + DB unique กันซ้ำ
    return await User_daily_active.create({ user_id, active_type, active_date });
  } catch (err) {
    if (err?.name === "SequelizeUniqueConstraintError") return null;
    throw err;
  }
}

module.exports = { setUserLoginHistory, setUserDailyActive };
