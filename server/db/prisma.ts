import { PrismaClient } from '@prisma/client';

const globalPrisma = globalThis as typeof globalThis & { studioPrisma?: PrismaClient };

export function prismaClient() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for Prisma database access.');
  return globalPrisma.studioPrisma ??= new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}
