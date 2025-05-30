import { findUserById } from '../db/user.js';
import { getUserDirectories } from '../users.js';



export async function groupIdApiAuthMiddleware(request, response, next) {
    try {
        if (
            request.method === 'POST' &&
            request.path === '/api/users/create'
        ) {
            return next();
        }

        const headerValue = request.headers['x-group-id'];
        const groupId = headerValue ? (Array.isArray(headerValue) ? headerValue[0] : headerValue) : null;

        if (!groupId) {
            return next();
        }

        const user = await findUserById(groupId);
        if (!user) {
            return response.status(401).json({ error: 'Invalid user ID' });
        }

        request.user = {
            profile: {
                ...user,
                handle: user.user_id,
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
        console.error('Error in internalApiAuthMiddleware:', error);
        return response.status(500).json({ error: 'Internal server error' });
    }
}

