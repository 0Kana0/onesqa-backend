// utils/currentUser.js
const db = require("../db/models"); // <-- ปรับ path ให้ตรงโปรเจกต์ของคุณ
const { User } = db; // ปรับ path ให้ตรงโปรเจกต์คุณ

async function getCurrentUser(ctx, opts = {}) {
  const {
    required = false,
    attributes = ["id", "locale"],
    reload = false,
  } = opts;

  // ✅ cache ต่อ 1 request
  if (!reload && ctx?._currentUser) return ctx._currentUser;

  const userId = ctx?.req?.user?.id;
  if (!userId) {
    if (required) throw new Error("Unauthenticated");
    return null;
  }

  // ✅ ถ้า middleware ใส่ user มาแล้วก็ใช้ได้
  if (!reload && ctx?.req?.user?.locale && attributes.includes("locale")) {
    ctx._currentUser = { id: userId, locale: ctx.req.user.locale };
    return ctx._currentUser;
  }

  const user = await User.findByPk(userId, { attributes });
  if (!user) {
    if (required) throw new Error("User not found");
    return null;
  }

  ctx._currentUser = user; // cache
  return user;
}

async function getLocale(ctx, fallback = "th") {
  const user = await getCurrentUser(ctx);
  return user?.locale || fallback;
}

module.exports = { getCurrentUser, getLocale };
