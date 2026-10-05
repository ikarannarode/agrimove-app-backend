import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { env } from '../config';
import { User } from '../models';

async function main() {
  const [emailArg, password] = process.argv.slice(2);
  if (!emailArg || !password || password.length < 12) {
    throw new Error('Usage: npm run admin:bootstrap -- <email> <password-at-least-12-characters>');
  }
  await mongoose.connect(env.MONGODB_URI);
  const email = emailArg.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.findOneAndUpdate(
    { email },
    {
      $set: {
        email,
        fullName: email,
        role: 'admin',
        passwordHash,
        emailVerifiedAt: new Date(),
        passwordResetRequired: false,
        isActive: true,
      },
      $setOnInsert: { phone: null },
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  );
  console.info(`Trusted administrator provisioned: ${user.email} (${user._id})`);
}

main()
  .catch((error: unknown) => {
    console.error('Administrator provisioning failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
