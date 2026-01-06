require('dotenv').config()

module.exports = {
  "development": {
    "username": process.env.DB_USERNAME_DEV,
    "password": process.env.DB_PASSWORD_DEV,
    "database": process.env.DB_NAME_DEV,
    "host": process.env.DB_HOST_DEV,
    "port": process.env.DB_PORT_DEV,
    "dialect": "postgres"
  },
  "uat": {
    "username": process.env.DB_USERNAME_UAT,
    "password": process.env.DB_PASSWORD_UAT,
    "database": process.env.DB_NAME_UAT,
    "host": process.env.DB_HOST_UAT,
    "port": process.env.DB_PORT_UAT,
    "dialect": "postgres"
  },
  "production": {
    "username": process.env.DB_USERNAME_PRODUCT,
    "password": process.env.DB_PASSWORD_PRODUCT,
    "database": process.env.DB_NAME_PRODUCT,
    "host": process.env.DB_HOST_PRODUCT,
    "port": process.env.DB_PORT_PRODUCT,
    "dialect": "postgres"
  }
}
