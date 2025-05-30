import { eq } from 'drizzle-orm';
import { db } from './index.js';
import { userInfo } from './schema/user.js';

export async function createUserInfo(user) {
    try {
        await db
            .insert(userInfo)
            .values({
                group_id: user.group_id,
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
            .where(eq(userInfo.group_id, user.group_id));
    } catch (error) {
        console.error('Error updating user in database:', error);
        throw error;
    }
}



export async function findUserInfoById(group_id) {
    try {
        const user = await db.query.userInfo.findFirst({
            where: eq(userInfo.group_id, group_id),
        });
        return user;
    } catch (error) {
        console.error('Error getting user info from database:', error);
        throw error;
    }
}

export async function findAllUsersInfo() {
    try {
        const users = await db.select().from(userInfo);
        return users;
    } catch (error) {
        console.error('Error getting all users from database:', error);
        throw error;
    }
}
