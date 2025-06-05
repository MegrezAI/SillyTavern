

function getLeapRagConfig(user_profile) {
    console.info({ user_profile });
    return {
        apiKey: user_profile?.leaprag_apikey,
        apiUrl: user_profile?.leaprag_api_url,
    };
}

export async function createKnowledge(user_profile, name, kb_id = '') {
    const { apiKey, apiUrl } = getLeapRagConfig(user_profile);
    if (!apiKey || !apiUrl) {
        return null;
    }

    try {
        const requestBody = {
            name: user_profile?.handle + '_' + name,
            language: 'Chinese',
            use_raptor: false,
            extract_metadata: false,
        };

        if (kb_id) {
            requestBody.id = kb_id;
        }

        const response = await fetch(`${apiUrl}/rag/kb`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': `${apiKey}`,
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            console.warn('Failed to create knowledge base:', await response.text());
            return null;
        }

        const data = await response.json();
        console.info('created knowledge', { name, kb_id });

        return data.data;
    } catch (error) {
        console.error('Error creating knowledge base:', error);
        return null;
    }
}

export async function retrievalMemories(user_profile, {
    question,
    kb_ids,
    page = 1,
    page_size = 10,
    similarity_threshold = 0.2,
    vector_similarity_weight = 0.3,
    top_k = 5,
    doc_ids = [],
    skip_recent = 5,
    highlight = false,
    use_kg = false,
}) {
    const { apiKey, apiUrl } = getLeapRagConfig(user_profile);
    if (!apiKey || !apiUrl) {
        return '';
    }

    try {
        const body = {
            question,
            kb_ids,
            page,
            page_size,
            similarity_threshold,
            vector_similarity_weight,
            doc_ids,
            skip_recent,
            highlight,
            use_kg,
        };
        console.log('Retrieve kb id:', kb_ids);

        const response = await fetch(`${apiUrl}/rag/chunk/retrieval-test`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': `${apiKey}`,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            console.warn('Failed to fetch memories:', await response.text());
            return '';
        }

        const data = await response.json();
        if (!data.chunks || !Array.isArray(data.chunks) || !data.chunks.length) {
            return '';
        }
        // console.log('found chunk:', data.chunks);

        const memoryContent = data.chunks
            .map((chunk, index) => `${index + 1}:${chunk.content_with_weight}`)
            .join('\n');

        return memoryContent;
    } catch (error) {
        console.error('Error fetching memories:', error);
        return '';
    }
}

export async function uploadChatContent(user_profile, query, res, kb_id, user_name = '', char_name = '', gen_finished = '') {
    const { apiKey, apiUrl, handle } = getLeapRagConfig(user_profile);
    if (!apiKey || !apiUrl) {
        return null;
    }

    try {
        const formData = new FormData();
        const content = `${user_name || 'Question'}：${query}\n${char_name || 'Response'}：${res}`;
        const fileName = `${handle}_chat_${char_name}_${gen_finished}.txt`;
        formData.append('file', new Blob([content], { type: 'text/plain' }), fileName);

        if (kb_id) {
            formData.append('kb_id', kb_id);
        }
        formData.append('parser_id', 'one');
        formData.append('run', '1');
        const response = await fetch(`${apiUrl}/rag/document`, {
            method: 'PUT',
            headers: {
                'X-API-Key': `${apiKey}`,
            },
            body: formData,
        });

        if (!response.ok) {
            console.warn('Failed to upload chat content:', await response.text());
            return null;
        }

        const data = await response.json();
        console.info('uploaded chat content to knowledge', { fileName, content });
        return data.data;
    } catch (error) {
        console.error('Error uploading chat content:', error);
        return null;
    }
}


