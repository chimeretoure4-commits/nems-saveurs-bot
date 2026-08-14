require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  adminUser: process.env.ADMIN_USER || 'admin',
  adminPass: process.env.ADMIN_PASS || 'changeme',
  whatsappNumber: process.env.WHATSAPP_NUMBER || '+221776886486'
};
