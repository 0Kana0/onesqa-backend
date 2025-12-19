exports.requireAuth = (ctx) => {
  console.log("ctx", ctx?.req?.user);
  
  if (ctx?.req?.user === null || ctx?.req?.user == undefined) {
    console.log("Unauthorized");
    
    throw new Error('Unauthorized'); // หรือโยน GraphQLError พร้อม code ก็ได้
  }
  return ctx.req.user; // คืน user ให้เรียกต่อ
}
