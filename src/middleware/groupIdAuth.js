import path from 'path';
import { findUserInfoById } from '../db/user.js';
import { getUserDirectories } from '../users.js';
import { safeReadFileSync } from '../util.js';
import { DEFAULT_USER, SETTINGS_FILE } from '../constants.js';

export async function groupIdApiAuthMiddleware(request, response, next) {
    try {
        const headerValue = request.headers['x-group-id'];
        const groupId = headerValue ? (Array.isArray(headerValue) ? headerValue[0] : headerValue) : null;

        if (!groupId) {
            return next();
        }

        // For user creation endpoint, set temporary user info
        if (request.method === 'POST' && request.path === '/api/users/create') {
            request.user = {
                profile: {
                    admin: true,
                },
            };
            return next();
        }

        // For other endpoints, verify user exists
        const user = await findUserInfoById(groupId);
        if (!user) {
            return response.status(401).json({ error: `Invalid group id ${groupId}` });
        }
        const defaultDirectories = getUserDirectories(DEFAULT_USER.handle);
        const pathToSettings = path.join(defaultDirectories.root, SETTINGS_FILE);
        const fileContent = safeReadFileSync(pathToSettings, 'utf-8');
        const settings = fileContent !== null ? JSON.parse(typeof fileContent === 'string' ? fileContent : fileContent.toString('utf-8')) : {};
        const leaprag_api_url = settings?.power_user?.leaprag_api_url || '';
        const leaprag_apikey = settings?.power_user?.leaprag_apikey || '';


        request.user = {
            profile: {
                ...user,
                handle: user.group_id,
                created: user.created_at,
                password: '',
                salt: '',
                admin: false,
                leaprag_apikey,
                leaprag_api_url,
            },
            directories: getUserDirectories(groupId),
        };

        next();
    } catch (error) {
        console.error('Error in groupIdApiAuthMiddleware:', error);
        return response.status(500).json({ error: 'Internal server error' });
    }
}

