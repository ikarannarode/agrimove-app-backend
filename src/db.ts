import mongoose from 'mongoose';
import { env } from './config';
import dns from "node:dns";

dns.setServers(["8.8.8.8", "1.1.1.1"]);
export async function connectDatabase() {
  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10_000,
  });
  const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
  if (!hello || !supportsTransactions(hello)) {
    throw new Error(
      'MongoDB transactions are required. Configure MONGODB_URI to use a replica set or mongos; standalone MongoDB is not supported.',
    );
  }
}

export function supportsTransactions(hello: {
  setName?: string;
  msg?: string;
  logicalSessionTimeoutMinutes?: number | null;
}) {
  return Boolean(
    hello.logicalSessionTimeoutMinutes != null
    && (hello.setName || hello.msg === 'isdbgrid'),
  );
}
