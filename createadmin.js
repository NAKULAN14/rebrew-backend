require('dotenv').config();

const mongoose = require('mongoose');
const User = require('./models/User');

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    const existing = await User.findOne({
      email: 'info@rebrew.in'
    });

    if (existing) {
      console.log('Admin already exists');
      process.exit();
    }

    await User.create({
      name: 'ReBrew Admin',
      email: 'info@rebrew.in',
      password: 'Rebrew@2025@rebrew',
      role: 'admin',
      isEmailVerified: true
    });

    console.log('✅ Admin created');
    process.exit();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();