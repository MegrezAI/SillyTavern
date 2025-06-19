/**
 * SillyTavern World Info Backend Module - WorldInfoBuffer
 * 世界书后端模块 - 世界书缓冲区类
 */

import { SCAN_STATE, MAX_SCAN_DEPTH } from './constants.js';
import { parseRegexFromString, escapeRegex } from './utils.js';

/**
 * 世界书缓冲区类 - 管理世界书扫描和匹配逻辑
 */
class WorldInfoBuffer {
    /**
     * @type {Map<string, object>} 需要强制激活的条目映射
     */
    static externalActivations = new Map();

    /**
     * @type {object} 聊天无关的扫描数据，如角色和用户描述
     */
    #globalScanData = null;

    /**
     * @type {string[]} 按深度升序排列的消息数组
     */
    #depthBuffer = [];

    /**
     * @type {string[]} 递归扫描添加的字符串数组
     */
    #recurseBuffer = [];

    /**
     * @type {string[]} 当前扫描有效的提示注入字符串数组
     */
    #injectBuffer = [];

    /**
     * @type {number} 全局扫描深度的偏移量。用于"最小激活"
     */
    #skew = 0;

    /**
     * @type {number} 全局扫描深度的起始深度
     */
    #startDepth = 0;

    /**
     * 使用给定消息初始化缓冲区
     * @param {string[]} messages 要添加到缓冲区的消息数组
     * @param {object} globalScanData 聊天无关的上下文扫描数据
     */
    constructor(messages, globalScanData) {
        this.#initDepthBuffer(messages);
        this.#globalScanData = globalScanData || {};
    }

    /**
     * 使用给定消息填充缓冲区
     * @param {string[]} messages 要添加到缓冲区的消息数组
     * @returns {void}
     */
    #initDepthBuffer(messages) {
        for (let depth = 0; depth < MAX_SCAN_DEPTH; depth++) {
            if (messages[depth]) {
                this.#depthBuffer[depth] = messages[depth].trim();
            }
            // 如果到达最后一条消息就停止
            if (depth === messages.length - 1) {
                break;
            }
        }
    }

    /**
     * 获取遵循大小写敏感设置的字符串
     * @param {string} str 要转换的字符串
     * @param {object} entry 触发扫描的条目
     * @returns {string} 转换后的字符串
     */
    #transformString(str, entry) {
        const caseSensitive = entry.caseSensitive ?? entry.case_sensitive ?? false;
        return caseSensitive ? str : str.toLowerCase();
    }

    /**
     * 获取到给定深度的所有消息 + 递归缓冲区
     * @param {object} entry 触发扫描的条目
     * @param {number} scanState 扫描状态
     * @returns {string} 缓冲区到给定深度的切片（包含）
     */
    get(entry, scanState) {
        let depth = entry.scanDepth ?? this.getDepth();

        // 修复：depth=0应该扫描最新消息（索引0），而不是返回空
        // 只有当depth小于等于startDepth并且不是0时才返回空
        if (depth < 0) {
            console.error(`[WI] Invalid WI scan depth ${depth}. Must be >= 0`);
            return '';
        }

        if (depth > MAX_SCAN_DEPTH) {
            console.warn(`[WI] Invalid WI scan depth ${depth}. Truncating to ${MAX_SCAN_DEPTH}`);
            depth = MAX_SCAN_DEPTH;
        }

        const MATCHER = '\x01';
        const JOINER = '\n' + MATCHER;

        // 修复：确保depth=0时能扫描第一条消息
        // 如果depth为0，应该只扫描索引0的消息
        // 如果depth为1，应该扫描索引0和1的消息，以此类推
        const endIndex = Math.max(1, depth + 1); // 至少扫描1条消息
        const scanBuffer = this.#depthBuffer.slice(this.#startDepth, endIndex);

        let result = '';
        if (scanBuffer.length > 0) {
            result = MATCHER + scanBuffer.join(JOINER);
        }

        // 添加全局扫描数据
        if (entry.matchPersonaDescription && this.#globalScanData.personaDescription) {
            result += JOINER + this.#globalScanData.personaDescription;
        }
        if (entry.matchCharacterDescription && this.#globalScanData.characterDescription) {
            result += JOINER + this.#globalScanData.characterDescription;
        }
        if (entry.matchCharacterPersonality && this.#globalScanData.characterPersonality) {
            result += JOINER + this.#globalScanData.characterPersonality;
        }
        if (entry.matchCharacterDepthPrompt && this.#globalScanData.characterDepthPrompt) {
            result += JOINER + this.#globalScanData.characterDepthPrompt;
        }
        if (entry.matchScenario && this.#globalScanData.scenario) {
            result += JOINER + this.#globalScanData.scenario;
        }
        if (entry.matchCreatorNotes && this.#globalScanData.creatorNotes) {
            result += JOINER + this.#globalScanData.creatorNotes;
        }

        if (this.#injectBuffer.length > 0) {
            result += JOINER + this.#injectBuffer.join(JOINER);
        }

        // 最小激活不应包含递归缓冲区
        if (this.#recurseBuffer.length > 0 && scanState !== SCAN_STATE.MIN_ACTIVATIONS) {
            result += JOINER + this.#recurseBuffer.join(JOINER);
        }

        console.debug(`[WI] Buffer scan: depth=${depth}, endIndex=${endIndex}, scanned=${scanBuffer.length} messages, result_length=${result.length}`);
        return result;
    }

    /**
     * 将给定字符串与缓冲区进行匹配
     * @param {string} haystack 要搜索的字符串
     * @param {string} needle 要搜索的字符串
     * @param {object} entry 触发扫描的条目
     * @returns {boolean} 如果在缓冲区中找到字符串则返回true
     */
    matchKeys(haystack, needle, entry) {
        // 如果needle是正则表达式，我们进行正则模式匹配并覆盖所有其他选项
        const keyRegex = parseRegexFromString(needle);
        if (keyRegex) {
            return keyRegex.test(haystack);
        }

        // 否则我们使用选择的条目设置进行普通的纯文本匹配
        haystack = this.#transformString(haystack, entry);
        const transformedString = this.#transformString(needle, entry);
        const matchWholeWords = entry.matchWholeWords ?? entry.match_whole_words ?? false;

        if (matchWholeWords) {
            const keyWords = transformedString.split(/\s+/);

            if (keyWords.length > 1) {
                return haystack.includes(transformedString);
            } else {
                // 使用自定义边界来包含标点符号和其他非字母数字字符
                const regex = new RegExp(`(?:^|\\W)(${escapeRegex(transformedString)})(?:$|\\W)`);
                if (regex.test(haystack)) {
                    return true;
                }
            }
        } else {
            return haystack.includes(transformedString);
        }

        return false;
    }

    /**
     * 将消息添加到递归缓冲区
     * @param {string} message 要添加的消息
     */
    addRecurse(message) {
        this.#recurseBuffer.push(message);
    }

    /**
     * 将注入添加到缓冲区
     * @param {string} message 要添加的注入
     */
    addInject(message) {
        this.#injectBuffer.push(message);
    }

    /**
     * 检查递归缓冲区是否不为空
     * @returns {boolean} 如果递归缓冲区不为空则返回true，否则返回false
     */
    hasRecurse() {
        return this.#recurseBuffer.length > 0;
    }

    /**
     * 增加偏移量以推进扫描范围
     */
    advanceScan() {
        this.#skew++;
    }

    /**
     * 获取当前的有效扫描深度
     * @returns {number} 当前深度
     */
    getDepth() {
        // 修复：从全局设置获取深度，而不是直接使用buffer长度
        const globalDepth = this.#globalScanData.world_info_depth || 4; // 默认深度为4
        return globalDepth + this.#skew;
    }

    /**
     * 获取外部激活的条目
     * @param {object} entry 要检查的条目
     * @returns {object|null} 外部激活的条目或null
     */
    getExternallyActivated(entry) {
        const key = `${entry.world}.${entry.uid}`;
        return WorldInfoBuffer.externalActivations.get(key) || null;
    }

    /**
     * 重置外部效果
     */
    resetExternalEffects() {
        WorldInfoBuffer.externalActivations.clear();
    }

    /**
     * 获取条目的评分
     * @param {object} entry 要评分的条目
     * @param {number} scanState 扫描状态
     * @returns {number} 条目评分
     */
    getScore(entry, scanState) {
        // 简化的评分实现，可以根据需要扩展
        let score = 0;

        // 基础分数
        score += entry.order || 0;

        // 常量条目有更高的优先级
        if (entry.constant) {
            score += 1000;
        }

        // 根据位置调整分数
        switch (entry.position) {
            case 0: // BEFORE
                score += 100;
                break;
            case 1: // AFTER
                score += 50;
                break;
            default:
                break;
        }

        return score;
    }

    /**
     * 获取当前偏移量
     * @returns {number} 当前偏移量
     */
    getSkew() {
        return this.#skew;
    }

    /**
     * 设置起始深度
     * @param {number} depth 起始深度
     */
    setStartDepth(depth) {
        this.#startDepth = Math.max(0, depth);
    }

    /**
     * 获取起始深度
     * @returns {number} 起始深度
     */
    getStartDepth() {
        return this.#startDepth;
    }

    /**
     * 获取缓冲区长度
     * @returns {number} 缓冲区长度
     */
    getBufferLength() {
        return this.#depthBuffer.length;
    }

    /**
     * 清空递归缓冲区
     */
    clearRecurseBuffer() {
        this.#recurseBuffer = [];
    }

    /**
     * 清空注入缓冲区
     */
    clearInjectBuffer() {
        this.#injectBuffer = [];
    }
}

export default WorldInfoBuffer;
