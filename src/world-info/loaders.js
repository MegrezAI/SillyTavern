/**
 * SillyTavern World Info Backend Module - Data Loaders
 * 世界书后端模块 - 数据加载器
 */

import fs from 'fs';
import path from 'path';
import { tryParse, isLorebookFile, sanitize } from './utils.js';
import { METADATA_KEY } from './constants.js';

/**
 * 加载世界书文件
 * @param {string} worldInfoPath 世界书文件路径
 * @param {string} name 世界书名称
 * @returns {Promise<object|null>} 世界书数据或null
 */
async function loadWorldInfo(worldInfoPath, name) {
    if (!name || !worldInfoPath) {
        return null;
    }

    try {
        const filePath = path.join(worldInfoPath, sanitize(name) + '.json');

        if (!fs.existsSync(filePath)) {
            console.debug(`[WI] World info file not found: ${filePath}`);
            return null;
        }

        const fileContent = fs.readFileSync(filePath, 'utf8');
        const data = tryParse(fileContent);

        if (!data) {
            console.error(`[WI] Failed to parse world info file: ${filePath}`);
            return null;
        }

        return data;
    } catch (error) {
        console.error(`[WI] Error loading world info file ${name}:`, error);
        return null;
    }
}

/**
 * 加载全局世界书
 * @param {object} userDirectories 用户目录配置
 * @param {string[]} selectedWorldInfo 选中的世界书列表
 * @returns {Promise<object[]>} 全局世界书条目数组
 */
async function getGlobalLore(userDirectories, selectedWorldInfo = []) {
    const entries = [];

    if (!selectedWorldInfo || selectedWorldInfo.length === 0) {
        return entries;
    }

    for (const worldName of selectedWorldInfo) {
        try {
            const worldData = await loadWorldInfo(userDirectories.worlds, worldName);
            if (worldData && worldData.entries) {
                const worldEntries = Object.values(worldData.entries).map(entry => ({
                    ...entry,
                    world: worldName,
                    global: true,
                }));
                entries.push(...worldEntries);
            }
        } catch (error) {
            console.error(`[WI] Error loading global world info ${worldName}:`, error);
        }
    }

    console.debug(`[WI] Loaded ${entries.length} global lore entries from ${selectedWorldInfo.length} worlds`);
    return entries;
}

/**
 * 加载角色相关的世界书
 * @param {object} userDirectories 用户目录配置
 * @param {object} characterData 角色数据
 * @param {object} userSettings 用户设置（包含world_info.charLore配置）
 * @returns {Promise<object[]>} 角色世界书条目数组
 */
async function getCharacterLore(userDirectories, characterData, userSettings = {}) {
    const entries = [];

    if (!characterData) {
        return entries;
    }

    // 收集要搜索的世界书名称
    const worldsToSearch = new Set();

    // 检查角色是否有嵌入的世界书
    if (characterData.data?.character_book && characterData.data.character_book.entries) {
        const characterEntries = Object.values(characterData.data.character_book.entries).map(entry => ({
            ...entry,
            world: characterData.name,
            character: true,
        }));
        entries.push(...characterEntries);
        console.debug(`[WI] Loaded ${characterEntries.length} embedded character lore entries`);
    }

    // 检查角色是否有关联的外部世界书
    const baseWorldName = characterData.data?.extensions?.world;
    if (baseWorldName) {
        worldsToSearch.add(baseWorldName);
    }

    // 检查用户设置中的额外角色世界书
    const characterFileName = characterData.avatar?.replace(/\.[^/.]+$/, '') ?? null;
    const extraCharLore = userSettings.world_info?.charLore?.find(e => e.name === characterFileName);
    if (extraCharLore && Array.isArray(extraCharLore.extraBooks)) {
        extraCharLore.extraBooks.forEach(bookName => worldsToSearch.add(bookName));
    }

    // 加载所有相关的世界书
    for (const worldName of worldsToSearch) {
        try {
            const worldData = await loadWorldInfo(userDirectories.worlds, worldName);
            if (worldData && worldData.entries) {
                const worldEntries = Object.values(worldData.entries).map(entry => ({
                    ...entry,
                    world: worldName,
                    character: true,
                }));
                entries.push(...worldEntries);
                console.debug(`[WI] Loaded ${worldEntries.length} character lore entries from ${worldName}`);
            }
        } catch (error) {
            console.debug(`[WI] Character world info ${worldName} could not be loaded:`, error);
        }
    }

    console.debug(`[WI] Total character lore entries: ${entries.length} from ${worldsToSearch.size} worlds`);
    return entries;
}

/**
 * 加载聊天相关的世界书
 * @param {object} userDirectories 用户目录配置
 * @param {object} chatMetadata 聊天元数据
 * @returns {Promise<object[]>} 聊天世界书条目数组
 */
async function getChatLore(userDirectories, chatMetadata = {}) {
    const entries = [];

    // 检查聊天元数据中是否指定了世界书
    const chatWorldInfo = chatMetadata[METADATA_KEY];
    if (!chatWorldInfo) {
        return entries;
    }

    try {
        const chatWorldData = await loadWorldInfo(userDirectories.worlds, chatWorldInfo);
        if (chatWorldData && chatWorldData.entries) {
            const chatEntries = Object.values(chatWorldData.entries).map(entry => ({
                ...entry,
                world: chatWorldInfo,
                chat: true,
            }));
            entries.push(...chatEntries);
            console.debug(`[WI] Loaded ${chatEntries.length} chat lore entries from ${chatWorldInfo}`);
        }
    } catch (error) {
        console.error(`[WI] Error loading chat world info ${chatWorldInfo}:`, error);
    }

    return entries;
}

/**
 * 加载用户设定相关的世界书
 * @param {object} userDirectories 用户目录配置
 * @param {object} userSettings 用户设置
 * @returns {Promise<object[]>} 用户设定世界书条目数组
 */
async function getPersonaLore(userDirectories, userSettings = {}) {
    const entries = [];

    // 检查是否有设定描述相关的世界书
    const personaLorebookName = userSettings.power_user?.persona_description_lorebook;
    if (!personaLorebookName) {
        return entries;
    }

    try {
        const personaWorldData = await loadWorldInfo(userDirectories.worlds, personaLorebookName);
        if (personaWorldData && personaWorldData.entries) {
            const personaEntries = Object.values(personaWorldData.entries).map(entry => ({
                ...entry,
                world: personaLorebookName,
                persona: true,
            }));
            entries.push(...personaEntries);
            console.debug(`[WI] Loaded ${personaEntries.length} persona lore entries from ${personaLorebookName}`);
        }
    } catch (error) {
        console.error(`[WI] Error loading persona world info ${personaLorebookName}:`, error);
    }

    return entries;
}

/**
 * 获取可用的世界书列表
 * @param {object} userDirectories 用户目录配置
 * @returns {Promise<string[]>} 世界书名称列表
 */
async function getAvailableWorldInfo(userDirectories) {
    const worldNames = [];

    if (!fs.existsSync(userDirectories.worlds)) {
        return worldNames;
    }

    try {
        const files = fs.readdirSync(userDirectories.worlds);

        for (const file of files) {
            if (isLorebookFile(file)) {
                const name = path.basename(file, path.extname(file));
                worldNames.push(name);
            }
        }
    } catch (error) {
        console.error('[WI] Error reading world info directory:', error);
    }

    return worldNames.sort();
}

/**
 * 验证世界书条目的完整性
 * @param {object} entry 世界书条目
 * @returns {boolean} 是否有效
 */
function validateWorldEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        return false;
    }

    // 检查必需字段
    if (typeof entry.uid === 'undefined' ||
        (!entry.key || !Array.isArray(entry.key)) ||
        typeof entry.content !== 'string') {
        return false;
    }

    return true;
}

/**
 * 清理和标准化世界书条目
 * @param {object} entry 原始条目
 * @returns {object} 清理后的条目
 */
function normalizeWorldEntry(entry) {
    // 处理extensions字段中的配置
    const extensions = entry.extensions || {};

    const normalized = {
        uid: entry.uid,
        key: Array.isArray(entry.key) ? entry.key : (entry.key ? [entry.key] : []),
        keysecondary: Array.isArray(entry.secondary_keys) ? entry.secondary_keys : (entry.secondary_keys ? [entry.secondary_keys] : []),
        content: entry.content || '',
        comment: entry.comment || '',
        constant: !!entry.constant,
        disabled: !!entry.disabled,
        selective: !!entry.selective,

        // 修复：正确处理insertion_order字段
        order: Number(entry.insertion_order || entry.order) || 0,

        // 修复：正确处理position字段映射
        position: getPositionFromString(entry.position) ?? Number(entry.position) ?? 0,

        probability: Number(entry.probability) || 100,
        useProbability: !!entry.useProbability,

        // 匹配设置 - 从extensions中获取
        caseSensitive: extensions.case_sensitive ?? entry.caseSensitive ?? entry.case_sensitive ?? false,
        matchWholeWords: extensions.match_whole_words ?? entry.matchWholeWords ?? entry.match_whole_words ?? false,

        // 扫描设置 - 支持extensions中的depth字段
        scanDepth: extensions.scan_depth !== null && extensions.scan_depth !== undefined ? Number(extensions.scan_depth) :
            (extensions.depth !== null && extensions.depth !== undefined ? Number(extensions.depth) :
                (entry.scanDepth ? Number(entry.scanDepth) : undefined)),

        // 扫描目标设置
        matchPersonaDescription: !!entry.matchPersonaDescription,
        matchCharacterDescription: !!entry.matchCharacterDescription,
        matchCharacterPersonality: !!entry.matchCharacterPersonality,
        matchCharacterDepthPrompt: !!entry.matchCharacterDepthPrompt,
        matchScenario: !!entry.matchScenario,
        matchCreatorNotes: !!entry.matchCreatorNotes,

        // 时间效果 - 从extensions中获取
        sticky: extensions.sticky ? Number(extensions.sticky) : (entry.sticky ? Number(entry.sticky) : 0),
        cooldown: extensions.cooldown ? Number(extensions.cooldown) : (entry.cooldown ? Number(entry.cooldown) : 0),
        delay: extensions.delay ? Number(extensions.delay) : (entry.delay ? Number(entry.delay) : 0),

        // 递归设置 - 从extensions中获取
        delayUntilRecursion: extensions.delay_until_recursion || entry.delayUntilRecursion || false,
        excludeRecursion: !!(extensions.exclude_recursion ?? entry.excludeRecursion),
        preventRecursion: !!(extensions.prevent_recursion ?? entry.preventRecursion),

        // 选择性逻辑
        selectiveLogic: Number(extensions.selectiveLogic || entry.selectiveLogic) || 0,

        // 过滤设置
        characterFilter: entry.characterFilter || null,

        // 包含组 - 从extensions中获取
        group: extensions.group || entry.group || '',
        groupOverride: !!(extensions.group_override ?? entry.groupOverride),
        groupWeight: Number(extensions.group_weight || entry.groupWeight) || 100,
        useGroupScoring: !!(extensions.use_group_scoring ?? entry.useGroupScoring),

        // 深度和角色设置 - 从extensions中获取
        depth: extensions.depth !== null && extensions.depth !== undefined ? Number(extensions.depth) :
            (entry.depth !== null && entry.depth !== undefined ? Number(entry.depth) : 4),
        role: extensions.role !== null && extensions.role !== undefined ? Number(extensions.role) :
            (entry.role !== null && entry.role !== undefined ? Number(entry.role) : 0),

        // 自动化ID
        automationId: extensions.automation_id || entry.automationId || '',

        // 元数据
        world: entry.world || '',
        global: !!entry.global,
        character: !!entry.character,
        chat: !!entry.chat,
        persona: !!entry.persona,
    };

    return normalized;
}

/**
 * 将字符串位置转换为数字
 * @param {string|number} position 位置字符串或数字
 * @returns {number|null} 位置数字
 */
function getPositionFromString(position) {
    if (typeof position === 'number') {
        return position;
    }

    switch (position) {
        case 'before_char':
        case 'before':
            return 0; // WI_POSITION.BEFORE
        case 'after_char':
        case 'after':
            return 1; // WI_POSITION.AFTER
        case 'depth':
        case 'at_depth':
            return 2; // WI_POSITION.AT_DEPTH
        case 'an_top':
        case 'top':
            return 3; // WI_POSITION.AN_TOP
        case 'an_bottom':
        case 'bottom':
            return 4; // WI_POSITION.AN_BOTTOM
        case 'examples':
        case 'as_examples':
            return 7; // WI_POSITION.AS_EXAMPLES
        default:
            return null;
    }
}

export {
    loadWorldInfo,
    getGlobalLore,
    getCharacterLore,
    getChatLore,
    getPersonaLore,
    getAvailableWorldInfo,
    validateWorldEntry,
    normalizeWorldEntry,
};
