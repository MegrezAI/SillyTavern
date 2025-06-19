/**
 * SillyTavern World Info Backend Module - Core Processing
 * 世界书后端模块 - 核心处理函数
 */

import {
    SCAN_STATE,
    WORLD_INFO_INSERTION_STRATEGY,
    DEFAULT_WORLD_INFO_SETTINGS,
    WORLD_INFO_LOGIC,
} from './constants.js';
import { getStringHash, parseDecorators, substituteParams, getTokenCount } from './utils.js';
import {
    getGlobalLore,
    getCharacterLore,
    getChatLore,
    getPersonaLore,
    normalizeWorldEntry,
    validateWorldEntry,
} from './loaders.js';
import WorldInfoBuffer from './WorldInfoBuffer.js';
import WorldInfoTimedEffects from './WorldInfoTimedEffects.js';
import { getChatCompletionModel } from '../chat-util.js';

/**
 * 条目排序函数（按order降序）
 * @param {object} a 条目A
 * @param {object} b 条目B
 * @returns {number} 排序结果
 */
const sortFn = (a, b) => b.order - a.order;

/**
 * 获取排序后的世界书条目
 * @param {object} userDirectories 用户目录
 * @param {object} characterData 角色数据
 * @param {object} chatMetadata 聊天元数据
 * @param {object} userSettings 用户设置
 * @param {number} insertionStrategy 插入策略
 * @returns {Promise<object[]>} 排序后的条目数组
 */
async function getSortedEntries(userDirectories, characterData, chatMetadata, userSettings, insertionStrategy) {
    console.debug('[WI] Getting sorted entries...');

    try {
        const selectedWorldInfo = userSettings.world_info?.globalSelect || [];

        const [
            globalLore,
            characterLore,
            chatLore,
            personaLore,
        ] = await Promise.all([
            getGlobalLore(userDirectories, selectedWorldInfo),
            getCharacterLore(userDirectories, characterData, userSettings),
            getChatLore(userDirectories, chatMetadata),
            getPersonaLore(userDirectories, userSettings),
        ]);

        let entries;

        switch (Number(insertionStrategy)) {
            case WORLD_INFO_INSERTION_STRATEGY.EVENLY:
                entries = [...globalLore, ...characterLore].sort(sortFn);
                break;
            case WORLD_INFO_INSERTION_STRATEGY.CHARACTER_FIRST:
                entries = [...characterLore.sort(sortFn), ...globalLore.sort(sortFn)];
                break;
            case WORLD_INFO_INSERTION_STRATEGY.GLOBAL_FIRST:
                entries = [...globalLore.sort(sortFn), ...characterLore.sort(sortFn)];
                break;
            default:
                console.error('[WI] Unknown WI insertion strategy:', insertionStrategy, 'defaulting to evenly');
                entries = [...globalLore, ...characterLore].sort(sortFn);
                break;
        }

        // 聊天相关和设定相关的条目总是优先
        entries = [...chatLore.sort(sortFn), ...personaLore.sort(sortFn), ...entries];

        entries = entries
            .filter(validateWorldEntry)
            .map(normalizeWorldEntry)
            .map((entry) => {
                const [decorators, content] = parseDecorators(entry.content || '');
                return { ...entry, decorators, content };
            })
            .map((entry) => {
                const hash = getStringHash(JSON.stringify(entry));
                return { ...entry, hash };
            });

        console.debug(`[WI] Found ${entries.length} world lore entries. Sorted by strategy ${insertionStrategy}`);

        const loadedEntries = entries.flat();
        console.debug(`[WI] Total entries loaded: ${loadedEntries.length}`);
        loadedEntries.forEach(entry => {
            console.debug(`[WI] Loaded entry ${entry.uid}: constant=${entry.constant}, key=[${entry.key?.join(', ') || 'empty'}], content_length=${entry.content?.length || 0}`);
        });

        const sorted = loadedEntries.sort(sortFn);
        console.debug(`[WI] Entries after sorting: ${sorted.length}`);

        return JSON.parse(JSON.stringify(sorted));
    } catch (e) {
        console.error('[WI] Error in getSortedEntries:', e);
        return [];
    }
}

/**
 * 检查世界书并返回激活的条目
 * @param {string[]} chat 聊天消息数组（反向排序）
 * @param {number} maxContext 生成的最大上下文大小
 * @param {boolean} isDryRun 是否为测试运行
 * @param {object} globalScanData 聊天无关的上下文扫描数据
 * @param {object[]} sortedEntries 排序后的世界书条目
 * @param {object} wiSettings 世界书设置
 * @param {object} chatMetadata 聊天元数据
 * @param {string} model 模型名称
 * @param {object} characterData 角色数据
 * @returns {Promise<object>} 激活的世界书数据
 */
async function checkWorldInfo(chat, maxContext, isDryRun, globalScanData, sortedEntries, wiSettings, chatMetadata, characterData = {}, model) {
    // 将世界书设置添加到全局扫描数据中，这样WorldInfoBuffer可以访问它们
    const enhancedGlobalScanData = {
        ...globalScanData,
        world_info_depth: wiSettings.world_info_depth || 4,
        world_info_settings: wiSettings,
    };

    const buffer = new WorldInfoBuffer(chat, enhancedGlobalScanData);

    console.debug(`[WI] --- START WI SCAN (on ${chat.length} messages)${isDryRun ? ' (DRY RUN)' : ''} ---`);

    let scanState = SCAN_STATE.INITIAL;
    let count = 0;
    let allActivatedEntries = new Map();
    let failedProbabilityChecks = new Set();
    let tokenBudgetOverflowed = false;

    let budget = Math.round(wiSettings.world_info_budget * maxContext / 100) || 1;

    if (wiSettings.world_info_budget_cap > 0 && budget > wiSettings.world_info_budget_cap) {
        console.debug(`[WI] Budget ${budget} exceeds cap ${wiSettings.world_info_budget_cap}, using cap`);
        budget = wiSettings.world_info_budget_cap;
    }

    console.debug(`[WI] Context size: ${maxContext}; WI budget: ${budget} (max% = ${wiSettings.world_info_budget}%, cap = ${wiSettings.world_info_budget_cap})`);

    const timedEffects = new WorldInfoTimedEffects(chat, sortedEntries, isDryRun, chatMetadata);
    timedEffects.checkTimedEffects();

    if (sortedEntries.length === 0) {
        return {
            worldInfoBefore: '',
            worldInfoAfter: '',
            WIDepthEntries: [],
            EMEntries: [],
            ANBeforeEntries: [],
            ANAfterEntries: [],
            allActivatedEntries: new Set(),
        };
    }

    // 获取递归延迟级别
    const availableRecursionDelayLevels = [...new Set(sortedEntries
        .filter(entry => entry.delayUntilRecursion)
        .map(entry => entry.delayUntilRecursion === true ? 1 : entry.delayUntilRecursion),
    )].sort((a, b) => a - b);

    let currentRecursionDelayLevel = availableRecursionDelayLevels.shift() ?? 0;
    if (currentRecursionDelayLevel > 0 && availableRecursionDelayLevels.length) {
        console.debug('[WI] Preparing first delayed recursion level', currentRecursionDelayLevel, '. Still delayed:', availableRecursionDelayLevels);
    }

    console.debug(`[WI] --- SEARCHING ENTRIES (on ${sortedEntries.length} entries) ---`);

    while (scanState) {
        // 如果设置了最大递归步数且达到限制，停止
        if (wiSettings.world_info_max_recursion_steps && wiSettings.world_info_max_recursion_steps <= count) {
            console.debug('[WI] Search stopped by reaching max recursion steps', wiSettings.world_info_max_recursion_steps);
            break;
        }

        // 安全检查：防止死循环，最大100次循环
        if (count > 100) {
            console.error('[WI] Emergency stop: Too many scan iterations (>100), breaking to prevent infinite loop');
            break;
        }

        count++;
        console.debug(`[WI] --- LOOP #${count} START ---`);
        console.debug('[WI] Scan state', scanState);

        let nextScanState = SCAN_STATE.NONE;
        let activatedNow = new Set();

        for (let entry of sortedEntries) {
            let headerLogged = false;
            function log(...args) {
                if (!headerLogged) {
                    // console.debug(`[WI] Entry ${entry.uid}`, `from '${entry.world}' processing`, entry);
                    headerLogged = true;
                }
                console.debug(`[WI] Entry ${entry.uid}`, ...args);
            }

            // 跳过已处理的条目
            if (failedProbabilityChecks.has(entry) || allActivatedEntries.has(`${entry.world}.${entry.uid}`)) {
                continue;
            }

            if (entry.disabled == true) {
                log('disabled');
                continue;
            }

            // 时间效果检查
            const isSticky = timedEffects.isEffectActive('sticky', entry);
            const isCooldown = timedEffects.isEffectActive('cooldown', entry);
            const isDelay = timedEffects.isEffectActive('delay', entry);

            if (isDelay) {
                log('suppressed by delay');
                continue;
            }

            if (isCooldown && !isSticky) {
                log('suppressed by cooldown');
                continue;
            }

            // 递归延迟检查
            if (scanState !== SCAN_STATE.RECURSION && entry.delayUntilRecursion && !isSticky) {
                log('suppressed by delay until recursion');
                continue;
            }

            if (scanState === SCAN_STATE.RECURSION && entry.delayUntilRecursion &&
                entry.delayUntilRecursion > currentRecursionDelayLevel && !isSticky) {
                log('suppressed by delay until recursion level', entry.delayUntilRecursion, '. Currently', currentRecursionDelayLevel);
                continue;
            }

            if (scanState === SCAN_STATE.RECURSION && wiSettings.world_info_recursive &&
                entry.excludeRecursion && !isSticky) {
                log('suppressed by exclude recursion');
                continue;
            }

            // 装饰器检查
            if (entry.decorators.includes('@@activate')) {
                log('activated by @@activate decorator');
                activatedNow.add(entry);
                continue;
            }

            if (entry.decorators.includes('@@dont_activate')) {
                log('suppressed by @@dont_activate decorator');
                continue;
            }

            // 外部激活检查
            if (buffer.getExternallyActivated(entry)) {
                log('externally activated');
                activatedNow.add(buffer.getExternallyActivated(entry));
                continue;
            }

            // 常量条目
            if (entry.constant) {
                console.debug(`[WI] Entry ${entry.uid} activated as constant. Key: [${entry.key?.join(', ') || 'empty'}], Content length: ${entry.content?.length || 0}`);
                log('activated because of constant');
                activatedNow.add(entry);
                continue;
            }

            // 粘性条目
            if (isSticky) {
                log('activated because active sticky');
                activatedNow.add(entry);
                continue;
            }

            if (!Array.isArray(entry.key) || !entry.key.length) {
                log('has no keys defined, skipped');
                continue;
            }

            // 缓存要扫描的文本
            const textToScan = buffer.get(entry, scanState);

            // 主关键词匹配
            let primaryKeyMatch = entry.key.find(key => {
                const substituted = substituteParams(key);
                return substituted && buffer.matchKeys(textToScan, substituted.trim(), entry);
            });

            if (!primaryKeyMatch) {
                // 没有主关键词匹配，跳过
                continue;
            }

            // 检查是否有二级关键词需要验证
            const hasSecondaryKeywords = (
                entry.selective && // 所有条目现在都是selective
                Array.isArray(entry.keysecondary) && // 总是true
                entry.keysecondary.length // 忽略空数组
            );

            if (!hasSecondaryKeywords) {
                // 没有二级关键词，主关键词匹配就足够了
                log('activated by primary key match', primaryKeyMatch);
                activatedNow.add(entry);
                continue;
            }

            // 二级关键词检查
            const selectiveLogic = entry.selectiveLogic ?? WORLD_INFO_LOGIC.AND_ANY;
            log('Entry with primary key match', primaryKeyMatch, 'has secondary keywords. Checking with logic', selectiveLogic);

            let hasAnySecondaryMatch = false;
            let hasAllSecondaryMatch = true;

            for (let keysecondary of entry.keysecondary) {
                const secondarySubstituted = substituteParams(keysecondary);
                const hasSecondaryMatch = secondarySubstituted && buffer.matchKeys(textToScan, secondarySubstituted.trim(), entry);

                if (hasSecondaryMatch) hasAnySecondaryMatch = true;
                if (!hasSecondaryMatch) hasAllSecondaryMatch = false;

                // AND ANY 逻辑：找到任一匹配就激活
                if (selectiveLogic === WORLD_INFO_LOGIC.AND_ANY && hasSecondaryMatch) {
                    log('activated. (AND ANY) Found match secondary keyword', secondarySubstituted);
                    activatedNow.add(entry);
                    break;
                }

                // NOT ALL 逻辑：找到任一不匹配就激活
                if (selectiveLogic === WORLD_INFO_LOGIC.NOT_ALL && !hasSecondaryMatch) {
                    log('activated. (NOT ALL) Found not matching secondary keyword', secondarySubstituted);
                    activatedNow.add(entry);
                    break;
                }
            }

            // 如果已经在循环中激活了，继续下一个条目
            if (activatedNow.has(entry)) {
                continue;
            }

            // 处理其他逻辑类型
            if (selectiveLogic === WORLD_INFO_LOGIC.NOT_ANY && !hasAnySecondaryMatch) {
                log('activated. (NOT ANY) No secondary keywords found', entry.keysecondary);
                activatedNow.add(entry);
                continue;
            }

            if (selectiveLogic === WORLD_INFO_LOGIC.AND_ALL && hasAllSecondaryMatch) {
                log('activated. (AND ALL) All secondary keywords found', entry.keysecondary);
                activatedNow.add(entry);
                continue;
            }

            // 如果到这里，说明二级关键词检查失败
            log('skipped. Secondary keywords not satisfied', entry.keysecondary);
        }

        console.debug(`[WI] Search done. Found ${activatedNow.size} possible entries.`);

        // 将激活的条目转换为数组并排序（为概率和预算检查做准备）
        const newEntries = [...activatedNow]
            .filter(entry => {
                // 字符过滤检查
                if (entry.characterFilter && entry.characterFilter?.names?.length > 0) {
                    // 简化的字符名获取（后端没有getCharaFilename函数）
                    const characterName = characterData?.name || characterData?.char_name || '';
                    const nameIncluded = entry.characterFilter.names.includes(characterName);
                    const filtered = entry.characterFilter.isExclude ? nameIncluded : !nameIncluded;

                    if (filtered) {
                        console.debug(`[WI] Entry ${entry.uid} filtered out by character`);
                        return false;
                    }
                }

                // TODO: 标签过滤需要标签系统支持
                // if (entry.characterFilter && entry.characterFilter?.tags?.length > 0) { ... }

                return true;
            })
            .sort((a, b) => {
                const isASticky = timedEffects.isEffectActive('sticky', a) ? 1 : 0;
                const isBSticky = timedEffects.isEffectActive('sticky', b) ? 1 : 0;
                return isBSticky - isASticky || sortedEntries.indexOf(a) - sortedEntries.indexOf(b);
            });

        let newContent = '';
        const allActivatedText = Array.from(allActivatedEntries.values()).map(x => x.content).join('\n');

        // TODO: 包含组过滤（暂时跳过，需要完整实现）
        // filterByInclusionGroups(newEntries, allActivatedEntries, buffer, scanState, timedEffects);

        console.debug('[WI] --- PROBABILITY CHECKS ---');
        !newEntries.length && console.debug('[WI] No probability checks to do');

        // 获取allActivatedText的token数
        const allActivatedTextTokens = await getTokenCount(allActivatedText, model);

        // 概率检查和预算管理
        for (const entry of newEntries) {
            // 概率检查
            function verifyProbability() {
                if (!entry.useProbability || entry.probability === 100) {
                    console.debug(`WI entry ${entry.uid} does not use probability`);
                    return true;
                }

                const isSticky = timedEffects.isEffectActive('sticky', entry);
                if (isSticky) {
                    console.debug(`WI entry ${entry.uid} is sticky, does not need to re-roll probability`);
                    return true;
                }

                const rollValue = Math.random() * 100;
                if (rollValue <= entry.probability) {
                    console.debug(`WI entry ${entry.uid} passed probability check of ${entry.probability}%`);
                    return true;
                }

                failedProbabilityChecks.add(entry);
                return false;
            }

            const success = verifyProbability();
            if (!success) {
                console.debug(`WI entry ${entry.uid} failed probability check, removing from activated entries`, entry);
                continue;
            }

            // 处理参数替换
            entry.content = substituteParams(entry.content);
            newContent += `${entry.content}\n`;

            // 精确的Token预算检查（与前端对齐）
            const newContentTokens = await getTokenCount(newContent, model);
            const totalTokens = allActivatedTextTokens + newContentTokens;

            if (totalTokens >= budget) {
                console.debug(`[WI] Budget overflow reached, stopping after ${allActivatedEntries.size} entries. Tokens: ${totalTokens}, Budget: ${budget}`);
                tokenBudgetOverflowed = true;
                break;
            }

            const key = `${entry.world}.${entry.uid}`;
            allActivatedEntries.set(key, entry);
            const contentPreview = entry.content ? (entry.content.length > 50 ? entry.content.substring(0, 50) + '...' : entry.content) : '';

            console.debug(`[WI] Entry ${entry.uid} activation successful, adding to prompt. Content: "${contentPreview}"`);

            // 如果条目内容不为空，添加到递归缓冲区
            if (entry.content && entry.content.trim()) {
                buffer.addRecurse(entry.content);
            }
        }

        // 成功条目分类（与前端对齐）
        const successfulNewEntries = newEntries.filter(x => !failedProbabilityChecks.has(x));
        const successfulNewEntriesForRecursion = successfulNewEntries.filter(x => !x.preventRecursion);

        console.debug(`[WI] --- LOOP #${count} RESULT ---`);
        if (!newEntries.length) {
            console.debug('[WI] No new entries activated.');
        } else if (!successfulNewEntries.length) {
            console.debug('[WI] Probability checks failed for all activated entries. No new entries activated.');
        } else {
            console.debug(`[WI] Successfully activated ${successfulNewEntries.length} new entries to prompt. ${allActivatedEntries.size} total entries activated.`);
        }

        // 决定下一个扫描状态（与前端对齐）
        if (wiSettings.world_info_recursive && !tokenBudgetOverflowed && successfulNewEntriesForRecursion.length) {
            nextScanState = SCAN_STATE.RECURSION;
            console.debug('[WI] Found', successfulNewEntriesForRecursion.length, 'new entries for recursion');
        }

        // 添加完整的状态转换逻辑以防止死循环
        tokenBudgetOverflowed = allActivatedEntries.size >= sortedEntries.length;
        if (wiSettings.world_info_recursive && !tokenBudgetOverflowed && scanState === SCAN_STATE.MIN_ACTIVATIONS && buffer.hasRecurse()) {
            nextScanState = SCAN_STATE.RECURSION;
        }

        // 最小激活检查
        if (wiSettings.world_info_min_activations > 0 && allActivatedEntries.size < wiSettings.world_info_min_activations && buffer.getDepth() < wiSettings.world_info_min_activations_depth_max) {
            // 推进扫描深度
            buffer.advanceScan();
            if (buffer.getDepth() <= wiSettings.world_info_min_activations_depth_max) {
                nextScanState = SCAN_STATE.MIN_ACTIVATIONS; // 继续扫描
            }
        }

        // 处理递归延迟级别
        if (nextScanState === SCAN_STATE.NONE && availableRecursionDelayLevels.length) {
            nextScanState = SCAN_STATE.RECURSION;
            currentRecursionDelayLevel = availableRecursionDelayLevels.shift();
            console.debug('[WI] Advancing to recursion delay level', currentRecursionDelayLevel, '. Still delayed:', availableRecursionDelayLevels);
        }

        // 清理递归缓冲区（如果有必要）
        if (nextScanState === SCAN_STATE.NONE) {
            buffer.clearRecurseBuffer();
        }

        console.debug(`[WI] --- LOOP #${count} END --- Next scan state: ${nextScanState}, activated this round: ${activatedNow.size}`);

        // 最终状态更新和递归缓冲区处理（与前端对齐）
        scanState = nextScanState;
        if (scanState) {
            const text = successfulNewEntriesForRecursion
                .map(x => x.content).join('\n');
            if (text) {
                buffer.addRecurse(text);
                // 更新allActivatedText用于下次循环的token计算
                console.debug('[WI] Adding recursive content to buffer:', text.length, 'chars');
            }
        } else {
            console.debug('[WI] Scan done. No new entries to prompt. Stopping.');
        }
    }

    // 设置时间效果
    timedEffects.setTimedEffects(new Set(allActivatedEntries.values()));

    // 构建结果
    const result = buildWorldInfoResult(allActivatedEntries, budget);

    console.debug(`[WI] --- END WI SCAN (activated ${allActivatedEntries.size} entries) ---`);

    return result;
}

/**
 * 构建世界书结果 - 按照前端逻辑处理
 * @param {Map} allActivatedEntries 所有激活的条目
 * @param {number} budget Token预算
 * @returns {object} 世界书结果
 */
function buildWorldInfoResult(allActivatedEntries, budget) {
    console.debug('[WI] --- BUILDING PROMPT ---');

    // 将激活的条目转换为数组并按insertion_order排序（高到低，999->1）
    const entries = Array.from(allActivatedEntries.values()).sort(sortFn);

    // 初始化各个位置的数组 - 使用前端相同的变量名
    const WIBeforeEntries = [];
    const WIAfterEntries = [];
    const WIDepthEntries = [];
    const EMEntries = [];
    const ANTopEntries = [];
    const ANBottomEntries = [];

    console.debug(`[WI] Processing ${entries.length} entries for prompt building`);

    // 按照前端逻辑处理每个条目
    entries.forEach((entry) => {
        // 处理内容（这里可以添加正则替换等逻辑）
        let content = entry.content || '';

        if (!content.trim()) {
            console.debug(`[WI] Entry ${entry.uid} skipped adding to prompt due to empty content`, entry);
            return;
        }

        console.debug(`[WI] Processing entry ${entry.uid} with position ${entry.position}, order ${entry.order}`);

        // 根据位置插入到对应数组 - 使用unshift匹配前端逻辑
        switch (entry.position) {
            case 0: // before_char / WI_POSITION.BEFORE
                WIBeforeEntries.unshift(content);
                break;
            case 1: // after_char / WI_POSITION.AFTER
                WIAfterEntries.unshift(content);
                break;
            case 2: { // at_depth / WI_POSITION.AT_DEPTH
                const depth = entry.depth ?? 4;
                const role = entry.role ?? 0; // 0 = system

                // 查找相同深度和角色的现有条目
                const existingDepthIndex = WIDepthEntries.findIndex(
                    (e) => e.depth === depth && e.role === role,
                );

                if (existingDepthIndex !== -1) {
                    // 添加到现有条目 - 使用unshift保持顺序
                    WIDepthEntries[existingDepthIndex].entries.unshift(content);
                } else {
                    // 创建新的深度条目
                    WIDepthEntries.push({
                        depth: depth,
                        entries: [content],
                        role: role,
                    });
                }
                break;
            }
            case 3: // an_top / WI_POSITION.AN_TOP
                ANTopEntries.unshift(content);
                break;
            case 4: // an_bottom / WI_POSITION.AN_BOTTOM
                ANBottomEntries.unshift(content);
                break;
            case 5: // EMTop - 映射到前端格式
                EMEntries.unshift({
                    position: 0, // wi_anchor_position.before
                    content: content,
                });
                break;
            case 6: // EMBottom - 映射到前端格式
                EMEntries.unshift({
                    position: 1, // wi_anchor_position.after
                    content: content,
                });
                break;
            case 7: // as_examples / WI_POSITION.AS_EXAMPLES
                // 示例条目单独处理，不使用unshift
                break;
            default:
                console.warn(`[WI] Unknown position ${entry.position} for entry ${entry.uid}`);
                break;
        }
    });

    // 构建最终文本 - 匹配前端格式
    const worldInfoBefore = WIBeforeEntries.length ? WIBeforeEntries.join('\n') : '';
    const worldInfoAfter = WIAfterEntries.length ? WIAfterEntries.join('\n') : '';
    const worldInfoString = worldInfoBefore + worldInfoAfter;

    // 获取示例条目（单独处理，不参与unshift逻辑）
    const exampleEntries = entries.filter(e => e.position === 7);
    const worldInfoExamples = exampleEntries.map(e => e.content).join('\n');

    // AN条目处理
    const anBefore = ANTopEntries.length ? ANTopEntries.join('\n') : '';
    const anAfter = ANBottomEntries.length ? ANBottomEntries.join('\n') : '';

    console.debug('[WI] Final content lengths:', {
        worldInfoBefore: worldInfoBefore.length,
        worldInfoAfter: worldInfoAfter.length,
        worldInfoDepth: WIDepthEntries.length,
        anBefore: anBefore.length,
        anAfter: anAfter.length,
        worldInfoExamples: worldInfoExamples.length,
    });

    const result = {
        worldInfoString,
        worldInfoBefore,
        worldInfoAfter,
        worldInfoExamples,
        worldInfoDepth: WIDepthEntries,
        anBefore,
        anAfter,
        EMEntries,
        WIDepthEntries, // 也包含这个字段用于兼容
        ANBeforeEntries: anBefore, // 兼容字段
        ANAfterEntries: anAfter,   // 兼容字段
        allActivatedEntries: new Set(allActivatedEntries.values()),
    };

    console.debug('[WI] World Info result built successfully');
    return result;
}

/**
 * 获取世界书提示词
 * @param {string[]} chat 聊天消息数组
 * @param {number} maxContext 最大上下文大小
 * @param {boolean} isDryRun 是否为测试运行
 * @param {object} globalScanData 全局扫描数据
 * @param {object} userDirectories 用户目录
 * @param {object} characterData 角色数据
 * @param {object} chatMetadata 聊天元数据
 * @param {object} userSettings 用户设置
 * @param {string} chat_completion_source 聊天完成源
 * @returns {Promise<object>} 世界书提示词结果
 */
async function getWorldInfoPrompt(chat, maxContext, isDryRun, globalScanData, userDirectories, characterData, chatMetadata, userSettings, chat_completion_source) {

    const model = getChatCompletionModel(chat_completion_source || userSettings.oai_settings.chat_completion_source, userSettings.oai_settings);
    console.debug('[WI] Using model:', model);
    try {
        // 合并世界书设置
        const wiSettings = {
            ...DEFAULT_WORLD_INFO_SETTINGS,
            ...userSettings.world_info_settings,
        };

        // 获取排序后的条目
        const sortedEntries = await getSortedEntries(
            userDirectories,
            characterData,
            chatMetadata,
            userSettings,
            wiSettings.world_info_character_strategy,
        );

        // 检查世界书
        const activatedWorldInfo = await checkWorldInfo(
            chat,
            maxContext,
            isDryRun,
            globalScanData,
            sortedEntries,
            wiSettings,
            chatMetadata,
            characterData,
            model,
        );

        return activatedWorldInfo;
    } catch (error) {
        console.error('[WI] Error in getWorldInfoPrompt:', error);
        return {
            worldInfoString: '',
            worldInfoBefore: '',
            worldInfoAfter: '',
            worldInfoExamples: [],
            worldInfoDepth: [],
            anBefore: [],
            anAfter: [],
            allActivatedEntries: new Set(),
        };
    }
}

export {
    getSortedEntries,
    checkWorldInfo,
    getWorldInfoPrompt,
    buildWorldInfoResult,
};
