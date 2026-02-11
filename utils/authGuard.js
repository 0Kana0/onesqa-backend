const db = require("../db/models"); // หรือ '../../db/models' ถ้าโปรเจกต์คุณใช้ path นั้น
const { User } = db;

exports.requireAuth = (ctx) => {
  //console.log("ctx", ctx?.req?.user);
  
  if (ctx?.req?.user === null || ctx?.req?.user == undefined) {
    // console.log("Unauthorized");
    
    throw new Error('Unauthorized'); // หรือโยน GraphQLError พร้อม code ก็ได้
  }
  return ctx.req.user; // คืน user ให้เรียกต่อ
}

exports.checkUserInDB = async (ctx) => {
  //console.log("ctx checkUserInDB", ctx?.req?.user);

  const user = await User.findByPk(ctx?.req?.user?.id, {
    attributes: ["id"],
  });

  //console.log("findUser", user);

  if (user === null || user == undefined) {
    // console.log("No User Found");
    
    throw new Error('No User Found'); // หรือโยน GraphQLError พร้อม code ก็ได้
  }
  return ctx.req.user; // คืน user ให้เรียกต่อ
}
