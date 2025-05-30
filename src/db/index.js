import { drizzle } from 'drizzle-orm/node-postgres';
import { getConfigValue } from '../util.js';
import * as schema from './schema/user.js';

const DATABASE_URL = getConfigValue('databaseUrl', 'postgresql://postgres:leap0715@localhost:5432/tavern');

export const db = drizzle(DATABASE_URL, { schema });
