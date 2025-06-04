import { findUserInfoById } from '../db/user.js';
import { getUserDirectories } from '../users.js';

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

        request.user = {
            profile: {
                ...user,
                handle: user.group_id,
                created: user.created_at,
                password: '',
                salt: '',
                admin: false,
                leaprag_apikey: '',
                leaprag_api_url: '',
            },
            directories: getUserDirectories(groupId),
        };

        next();
    } catch (error) {
        console.error('Error in groupIdApiAuthMiddleware:', error);
        return response.status(500).json({ error: 'Internal server error' });
    }
}

