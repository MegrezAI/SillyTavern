import fs from 'node:fs';
import path from 'node:path';
import sanitize from 'sanitize-filename';
import { readCharacterData } from './endpoints/characters.js';

/**
 * Build a complete request body like the frontend would send
 * @param {object} params Parameters
 * @param {object} params.characterData Character data
 * @param {object[]} params.messages Messages array
 * @param {boolean} params.stream Whether to stream
 * @param {object} params.userSettings Complete user settings
 * @returns {object} Complete request body
 */
export function buildFullRequestBody({ characterData, messages, stream, userSettings }) {
    // Convert ST messages to OpenAI format
    const openaiMessages = [];

    // Add system prompt
    const systemPrompt = buildSystemPrompt(characterData, userSettings);
    if (systemPrompt) {
        openaiMessages.push({
            role: 'system',
            content: systemPrompt,
        });
    }

    // Convert messages to OpenAI format
    for (const msg of messages) {
        if (msg.is_system) continue; // Skip system messages

        // Handle both OpenAI format (role/content) and ST format (is_user/mes)
        let role, content;
        if (msg.role) {
            // OpenAI format
            role = msg.role;
            content = msg.content || '';
        } else {
            // SillyTavern format
            role = msg.is_user ? 'user' : 'assistant';
            content = msg.mes || '';
        }

        // Apply macro substitution to message content
        content = substituteMacros(
            content,
            userSettings.username || 'User',
            characterData.name,
            characterData,
            userSettings
        );

        openaiMessages.push({ role, content });
    }

    // Simple requests use OpenAI-compatible APIs configured in oai_settings
    const oaiSettings = userSettings.oai_settings || {};

    // Check if oai_settings has a configured chat_completion_source
    if (!oaiSettings.chat_completion_source) {
        throw new Error(`No chat_completion_source configured in oai_settings. Current main_api is "${userSettings.main_api}", but simple requests require an OpenAI-compatible API to be configured in oai_settings.`);
    }

    const chatCompletionSource = oaiSettings.chat_completion_source;
    const model = getChatCompletionModel(chatCompletionSource, oaiSettings);

    return {
        messages: openaiMessages,
        model: model,
        temperature: oaiSettings.temp_openai || 1,
        frequency_penalty: oaiSettings.freq_pen_openai || 0,
        presence_penalty: oaiSettings.pres_pen_openai || 0,
        top_p: oaiSettings.top_p_openai || 1,
        max_tokens: oaiSettings.openai_max_tokens || 300,
        stream: stream,
        chat_completion_source: chatCompletionSource,
        user_name: userSettings.username || '',
        char_name: characterData.name || '',
        group_names: [],
        include_reasoning: oaiSettings.show_thoughts !== false,
        reasoning_effort: oaiSettings.reasoning_effort || 'auto',
        enable_web_search: oaiSettings.enable_web_search || false,
        request_images: oaiSettings.request_images || false,
        custom_prompt_post_processing: oaiSettings.custom_prompt_post_processing || '',
        file_name: '', // Will be set by caller if needed
    };
}

/**
 * Enhanced macro substitution function similar to frontend's substituteParams
 * @param {string} content Content to substitute
 * @param {string} userName User name
 * @param {string} charName Character name
 * @param {object} characterData Character data for additional macros
 * @param {object} userSettings User settings for persona info
 * @returns {string} Content with macros substituted
 */
export function substituteMacros(content, userName, charName, characterData = {}, userSettings = {}) {
    if (!content) return '';

    // Get persona description from user settings if available
    const personaDescription = userSettings.persona_description || '';

    // Define macro replacements similar to frontend
    const macros = {
        // Basic character and user macros
        '{{char}}': charName || 'Character',
        '{{user}}': userName || 'User',

        // Character card fields
        '{{description}}': characterData.description || '',
        '{{personality}}': characterData.personality || '',
        '{{scenario}}': characterData.scenario || '',
        '{{mesExamples}}': characterData.mes_example || '',
        '{{mesExamplesRaw}}': characterData.mes_example || '',
        '{{charPrompt}}': characterData.data?.system_prompt || characterData.system || '',
        '{{charInstruction}}': characterData.data?.post_history_instructions || '',
        '{{charJailbreak}}': characterData.data?.post_history_instructions || '',
        '{{creatorNotes}}': characterData.data?.creator_notes || '',
        '{{charVersion}}': characterData.data?.character_version || '',
        '{{char_version}}': characterData.data?.character_version || '',
        '{{charDepthPrompt}}': characterData.data?.extensions?.depth_prompt?.prompt || '',

        // Persona macros
        '{{persona}}': personaDescription || '',

        // Legacy support
        '<USER>': userName || 'User',
        '<BOT>': charName || 'Character',
        '<CHAR>': charName || 'Character',
        '<CHARIFNOTGROUP>': charName || 'Character',
        '<GROUP>': charName || 'Character',

        // Time-related macros (static values for backend)
        '{{time}}': new Date().toLocaleTimeString('en-US', { hour12: true }),
        '{{date}}': new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        '{{weekday}}': new Date().toLocaleDateString('en-US', { weekday: 'long' }),
        '{{isotime}}': new Date().toTimeString().slice(0, 5),
        '{{isodate}}': new Date().toISOString().slice(0, 10),

        // Other utility macros
        '{{newline}}': '\n',
        '{{noop}}': '',
    };

    let result = content;

    // Replace each macro (case-insensitive)
    for (const [macro, replacement] of Object.entries(macros)) {
        const regex = new RegExp(macro.replace(/[{}()<>]/g, '\\$&'), 'gi');
        result = result.replace(regex, replacement);
    }

    // Handle trim macro (removes surrounding newlines)
    result = result.replace(/(?:\r?\n)*{{trim}}(?:\r?\n)*/gi, '');

    // Handle comment macros (remove them)
    result = result.replace(/\{\{\/\/([\s\S]*?)\}\}/gm, '');

    return result;
}

/**
 * Build system prompt from character data and user settings
 * @param {object} characterData Character data
 * @param {object} userSettings User settings
 * @returns {string} System prompt
 */
export function buildSystemPrompt(characterData, userSettings) {
    const oaiSettings = userSettings.oai_settings || {};

    // Check if character has its own system prompt
    const charSystemPrompt = characterData.data?.system_prompt;
    if (charSystemPrompt && charSystemPrompt.trim()) {
        // Use character's system prompt with macro substitution
        return substituteMacros(
            charSystemPrompt,
            userSettings.username || 'User',
            characterData.name,
            characterData,
            userSettings
        );
    }

    // Fall back to main prompt from settings
    const mainPrompt = oaiSettings.prompts?.find(p => p.identifier === 'main')?.content ||
        `Write ${characterData.name}'s next reply in a fictional chat between ${characterData.name} and ${userSettings.username}.`;

    // Use the macro substitution function
    let systemContent = substituteMacros(
        mainPrompt,
        userSettings.username || 'User',
        characterData.name,
        characterData,
        userSettings
    );

    // Add character data sections with macro substitution
    if (characterData.description) {
        const description = substituteMacros(characterData.description, userSettings.username, characterData.name, characterData, userSettings);
        systemContent += `\n\n${description}`;
    }

    if (characterData.personality) {
        const personality = substituteMacros(characterData.personality, userSettings.username, characterData.name, characterData, userSettings);
        systemContent += `\n\nPersonality: ${personality}`;
    }

    if (characterData.scenario) {
        const scenario = substituteMacros(characterData.scenario, userSettings.username, characterData.name, characterData, userSettings);
        systemContent += `\n\nScenario: ${scenario}`;
    }

    return systemContent;
}

/**
 * Gets the API model for the selected chat completion source.
 * Copied and adapted from public/scripts/openai.js
 * @param {string} source Chat completion source
 * @param {object} oaiSettings OAI settings object
 * @returns {string} API model
 */
export function getChatCompletionModel(source, oaiSettings) {
    switch (source) {
        case 'claude':
            return oaiSettings.claude_model;
        case 'openai':
            return oaiSettings.openai_model;
        case 'makersuite':
            return oaiSettings.google_model;
        case 'vertexai':
            return oaiSettings.vertexai_model;
        case 'openrouter':
            return oaiSettings.openrouter_model;
        case 'ai21':
            return oaiSettings.ai21_model;
        case 'mistralai':
            return oaiSettings.mistralai_model;
        case 'custom':
            return oaiSettings.custom_model;
        case 'cohere':
            return oaiSettings.cohere_model;
        case 'perplexity':
            return oaiSettings.perplexity_model;
        case 'groq':
            return oaiSettings.groq_model;
        case 'zerooneai':
            return oaiSettings.zerooneai_model;
        case 'nanogpt':
            return oaiSettings.nanogpt_model;
        case 'deepseek':
            return oaiSettings.deepseek_model;
        case 'xai':
            return oaiSettings.xai_model;
        case 'pollinations':
            return oaiSettings.pollinations_model;
        case 'scale':
            return '';
        default:
            console.error(`Unknown chat completion source: ${source}`);
            return '';
    }
}

/**
 * Load user settings from settings.json
 * @param {object} userDirectories User directories
 * @returns {object} User settings object
 */
export function loadUserSettings(userDirectories) {
    try {
        const settingsPath = path.join(userDirectories.root, 'settings.json');
        if (fs.existsSync(settingsPath)) {
            const settingsData = fs.readFileSync(settingsPath, 'utf8');
            const settings = JSON.parse(settingsData);
            return settings;
        }
    } catch (error) {
        console.error('Error loading user settings:', error);
    }
    return {};
}

/**
 * Load character data from character file
 * @param {object} userDirectories User directories
 * @param {string} charName Character name
 * @returns {Promise<object|null>} Character data or null if not found
 */
export async function loadCharacterData(userDirectories, charName) {
    try {
        // Find character file by name
        const files = fs.readdirSync(userDirectories.characters);
        const pngFiles = files.filter(file => file.endsWith('.png'));

        for (const file of pngFiles) {
            const filePath = path.join(userDirectories.characters, file);
            try {
                // Use the exported readCharacterData function
                const imgData = await readCharacterData(filePath);
                if (imgData) {
                    const jsonData = JSON.parse(imgData);
                    const characterName = jsonData.data?.name || jsonData.name;
                    if (characterName === charName) {
                        return {
                            avatar: file,
                            name: characterName,
                            description: jsonData.data?.description || jsonData.description || '',
                            personality: jsonData.data?.personality || jsonData.personality || '',
                            scenario: jsonData.data?.scenario || jsonData.scenario || '',
                            first_mes: jsonData.data?.first_mes || jsonData.first_mes || '',
                            mes_example: jsonData.data?.mes_example || jsonData.mes_example || '',
                            system_prompt: jsonData.data?.system_prompt || '',
                            data: jsonData.data || jsonData,
                        };
                    }
                }
            } catch (error) {
                // Skip files that can't be parsed
                console.warn(`Could not parse character file ${file}:`, error.message);
                continue;
            }
        }
        return null;
    } catch (error) {
        console.error('Error loading character data:', error);
        return null;
    }
}

/**
 * Load chat history from chat file
 * @param {object} userDirectories User directories
 * @param {string} charAvatar Character avatar filename
 * @param {string} fileName Chat file name
 * @returns {Promise<object[]>} Chat messages array
 */
export async function loadChatHistory(userDirectories, charAvatar, fileName) {
    try {
        const dirName = charAvatar.replace('.png', '');
        const directoryPath = path.join(userDirectories.chats, dirName);

        if (!fs.existsSync(directoryPath)) {
            fs.mkdirSync(directoryPath, { recursive: true });
            return [];
        }

        const chatFileName = `${fileName}.jsonl`;
        const filePath = path.join(directoryPath, sanitize(chatFileName));

        if (!fs.existsSync(filePath)) {
            return [];
        }

        const data = fs.readFileSync(filePath, 'utf8');
        const lines = data.split('\n').filter(line => line.trim());

        // Parse each line as JSON, skip metadata (first line)
        const jsonData = lines.map((l) => {
            try {
                return JSON.parse(l);
            } catch (_) {
                return null;
            }
        }).filter(x => x);

        // Remove metadata line (first line) and return only messages
        return jsonData.slice(1);
    } catch (error) {
        console.error('Error loading chat history:', error);
        return [];
    }
}

export function getMessageTimeStamp() {
    const date = Date.now();
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const d = new Date(date);
    const month = months[d.getMonth()];
    const day = d.getDate();
    const year = d.getFullYear();
    let hours = d.getHours();
    const minutes = ('0' + d.getMinutes()).slice(-2);
    const seconds = ('0' + d.getSeconds()).slice(-2);
    const milliseconds = ('00' + d.getMilliseconds()).slice(-3);
    let meridiem = 'am';

    if (hours >= 12) {
        meridiem = 'pm';
        hours -= 12;
    }
    if (hours === 0) {
        hours = 12;
    }

    const formattedDate = `${month} ${day}, ${year} ${hours}:${minutes}:${seconds}.${milliseconds}${meridiem}`;
    return formattedDate;
}