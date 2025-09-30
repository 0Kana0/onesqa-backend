const bcrypt = require('bcrypt')

exports.hashPassword = async (plainPassword) => {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plainPassword, salt);
};

exports.comparePassword = async (plainPassword, hash) => {
  return bcrypt.compare(plainPassword, hash);
};
