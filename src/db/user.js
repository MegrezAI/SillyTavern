import { eq } from 'drizzle-orm';
import { db } from './index.js';
import { userInfo } from './schema/user.js';

export async function createUserInfo(user) {
    try {
        await db
            .insert(userInfo)
            .values({
                user_id: user.user_id,
                name: user.name,
                enabled: user.enabled,
                created_at: Date.now(),
                updated_at: Date.now(),
            });
    } catch (error) {
        console.error('Error creating user in database:', error);
        throw error;
    }
}

export async function updateUserInfo(user) {
    try {
        await db
            .update(userInfo)
            .set({
                name: user.name,
                enabled: user.enabled,
                updated_at: Date.now(),
            })
            .where(eq(userInfo.user_id, user.user_id));
    } catch (error) {
        console.error('Error updating user in database:', error);
        throw error;
    }
}



export async function findUserById(user_id) {
    try {
        const user = await db.query.userInfo.findFirst({
            where: eq(userInfo.user_id, user_id),
        });
        return user;
    } catch (error) {
        console.error('Error getting user from database:', error);
        throw error;
    }
}

export async function findAllUsers() {
    try {
        const users = await db.select().from(userInfo);
        return users;
    } catch (error) {
        console.error('Error getting all users from database:', error);
        throw error;
    }
}
