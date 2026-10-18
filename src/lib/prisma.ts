// PrismaClient is the object you use to query the database
import { PrismaClient } from "@prisma/client";

// One shared instance. Every file that imports `prisma` gets this same object
export const prisma = new PrismaClient();