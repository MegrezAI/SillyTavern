import { text, boolean, pgTable, varchar, bigint, integer } from 'drizzle-orm/pg-core';


export const userInfo = pgTable('user_info', {
    group_id: varchar('group_id', { length: 36 }).primaryKey(),
    name: text('name').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    created_at: bigint('created_at', { mode: 'number' }),
    updated_at: bigint('updated_at', { mode: 'number' }),
    total_tokens: integer('total_tokens').default(0),
});

