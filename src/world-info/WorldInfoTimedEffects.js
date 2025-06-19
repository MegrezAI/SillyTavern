/**
 * SillyTavern World Info Backend Module - WorldInfoTimedEffects
 * 世界书后端模块 - 世界书时间效果类
 */

import { TIMED_EFFECT_TYPE } from './constants.js';

/**
 * 世界书时间效果类 - 管理粘性、冷却和延迟效果
 */
class WorldInfoTimedEffects {
    /**
     * @type {string[]} 聊天消息数组
     */
    #chat = [];

    /**
     * @type {object[]} 条目数组
     */
    #entries = [];

    /**
     * @type {boolean} 是否为测试运行？
     */
    #isDryRun = false;

    /**
     * @type {object} 活动时间效果的缓冲区
     */
    #buffer = {
        [TIMED_EFFECT_TYPE.STICKY]: [],
        [TIMED_EFFECT_TYPE.COOLDOWN]: [],
        [TIMED_EFFECT_TYPE.DELAY]: [],
    };

    /**
     * @type {object} 聊天元数据（用于存储时间效果状态）
     */
    #chatMetadata = {};

    /**
     * @type {object} 效果类型结束时的回调函数
     */
    #onEnded = {
        /**
         * 粘性条目结束时的回调
         * 如果条目有冷却时间，立即设置冷却
         * @param {object} entry 结束粘性的条目
         */
        [TIMED_EFFECT_TYPE.STICKY]: (entry) => {
            if (!entry.cooldown) {
                return;
            }

            const key = this.#getEntryKey(entry);
            const effect = this.#getEntryTimedEffect(TIMED_EFFECT_TYPE.COOLDOWN, entry, true);
            this.#chatMetadata.timedWorldInfo.cooldown[key] = effect;
            console.log(`[WI] Adding cooldown entry ${key} on ended sticky: start=${effect.start}, end=${effect.end}, protected=${effect.protected}`);
            // 立即为此次评估设置冷却
            this.#buffer.cooldown.push(entry);
        },

        /**
         * 冷却条目结束时的回调
         * 本质上是无操作
         * @param {object} entry 结束冷却的条目
         */
        [TIMED_EFFECT_TYPE.COOLDOWN]: (entry) => {
            console.debug('[WI] Cooldown ended for entry', entry.uid);
        },

        [TIMED_EFFECT_TYPE.DELAY]: () => { },
    };

    /**
     * 使用给定消息初始化时间效果
     * @param {string[]} chat 聊天消息数组
     * @param {object[]} entries 条目数组
     * @param {boolean} isDryRun 操作是否为测试运行
     * @param {object} chatMetadata 聊天元数据对象
     */
    constructor(chat, entries, isDryRun = false, chatMetadata = {}) {
        this.#chat = chat || [];
        this.#entries = entries || [];
        this.#isDryRun = isDryRun;
        this.#chatMetadata = chatMetadata;
        this.#ensureChatMetadata();
    }

    /**
     * 验证聊天元数据的正确结构
     */
    #ensureChatMetadata() {
        if (!this.#chatMetadata.timedWorldInfo) {
            this.#chatMetadata.timedWorldInfo = {};
        }

        [TIMED_EFFECT_TYPE.STICKY, TIMED_EFFECT_TYPE.COOLDOWN].forEach(type => {
            // 确保属性存在且为对象
            if (!this.#chatMetadata.timedWorldInfo[type] || typeof this.#chatMetadata.timedWorldInfo[type] !== 'object') {
                this.#chatMetadata.timedWorldInfo[type] = {};
            }

            // 清理无效条目
            Object.entries(this.#chatMetadata.timedWorldInfo[type]).forEach(([key, value]) => {
                if (!value || typeof value !== 'object') {
                    delete this.#chatMetadata.timedWorldInfo[type][key];
                }
            });
        });
    }

    /**
     * 获取WI条目的哈希
     * @param {object} entry WI条目
     * @returns {number} 字符串哈希
     */
    #getEntryHash(entry) {
        return entry.hash || 0;
    }

    /**
     * 获取WI条目的唯一键
     * @param {object} entry WI条目
     * @returns {string} 条目的字符串键
     */
    #getEntryKey(entry) {
        return `${entry.world}.${entry.uid}`;
    }

    /**
     * 获取WI条目的时间效果
     * @param {string} type 时间效果类型
     * @param {object} entry WI条目
     * @param {boolean} isProtected 效果是否应受保护
     * @returns {object} 条目的时间效果
     */
    #getEntryTimedEffect(type, entry, isProtected) {
        return {
            hash: this.#getEntryHash(entry),
            start: this.#chat.length,
            end: this.#chat.length + Number(entry[type]),
            protected: !!isProtected,
        };
    }

    /**
     * 处理给定类型时间效果的条目
     * @param {string} type 时间效果类型的标识符
     * @param {object[]} buffer 存储条目的缓冲区
     * @param {function} onEnded 时间效果结束时的回调
     */
    #checkTimedEffectOfType(type, buffer, onEnded) {
        const effects = Object.entries(this.#chatMetadata.timedWorldInfo[type] || {});
        for (const [key, value] of effects) {
            console.log(`[WI] Processing ${type} entry ${key}`, value);
            const entry = this.#entries.find(x => String(this.#getEntryHash(x)) === String(value.hash));

            if (this.#chat.length <= Number(value.start) && !value.protected) {
                console.log(`[WI] Removing ${type} entry ${key} from timedWorldInfo: chat not advanced`, value);
                delete this.#chatMetadata.timedWorldInfo[type][key];
                continue;
            }

            // 缺失的条目（可能来自另一个角色的lorebook）
            if (!entry) {
                if (this.#chat.length >= Number(value.end)) {
                    console.log(`[WI] Removing ${type} entry from timedWorldInfo: entry not found and interval passed`, entry);
                    delete this.#chatMetadata.timedWorldInfo[type][key];
                }
                continue;
            }

            // 忽略无效条目（未配置时间效果）
            if (!entry[type]) {
                console.log(`[WI] Removing ${type} entry from timedWorldInfo: entry not ${type}`, entry);
                delete this.#chatMetadata.timedWorldInfo[type][key];
                continue;
            }

            if (this.#chat.length >= Number(value.end)) {
                console.log(`[WI] Removing ${type} entry from timedWorldInfo: ${type} interval passed`, entry);
                delete this.#chatMetadata.timedWorldInfo[type][key];
                if (typeof onEnded === 'function') {
                    onEnded(entry);
                }
                continue;
            }

            buffer.push(entry);
            console.log(`[WI] Timed effect "${type}" applied to entry`, entry);
        }
    }

    /**
     * 处理"延迟"时间效果的条目
     * @param {object[]} buffer 存储条目的缓冲区
     */
    #checkDelayEffect(buffer) {
        for (const entry of this.#entries) {
            if (!entry.delay) {
                continue;
            }

            if (this.#chat.length < entry.delay) {
                buffer.push(entry);
                console.log('[WI] Timed effect "delay" applied to entry', entry);
            }
        }
    }

    /**
     * 检查时间效果
     */
    checkTimedEffects() {
        this.#checkTimedEffectOfType(
            TIMED_EFFECT_TYPE.STICKY,
            this.#buffer.sticky,
            this.#onEnded[TIMED_EFFECT_TYPE.STICKY],
        );

        this.#checkTimedEffectOfType(
            TIMED_EFFECT_TYPE.COOLDOWN,
            this.#buffer.cooldown,
            this.#onEnded[TIMED_EFFECT_TYPE.COOLDOWN],
        );

        this.#checkDelayEffect(this.#buffer.delay);
    }

    /**
     * 获取效果元数据
     * @param {string} type 效果类型
     * @param {object} entry 条目
     * @returns {object} 效果元数据
     */
    getEffectMetadata(type, entry) {
        const key = this.#getEntryKey(entry);
        return this.#chatMetadata.timedWorldInfo[type]?.[key] || null;
    }

    /**
     * 设置时间效果
     * @param {Set} activatedEntries 激活的条目集合
     */
    setTimedEffects(activatedEntries) {
        if (this.#isDryRun) {
            return;
        }

        for (const entry of activatedEntries) {
            this.setTimedEffect(TIMED_EFFECT_TYPE.STICKY, entry, true);
        }
    }

    /**
     * 为条目设置时间效果
     * @param {string} type 效果类型
     * @param {object} entry 条目
     * @param {boolean} newState 新状态
     */
    setTimedEffect(type, entry, newState) {
        if (this.#isDryRun) {
            return;
        }

        if (!this.isValidEffectType(type)) {
            console.error(`[WI] Invalid effect type: ${type}`);
            return;
        }

        const key = this.#getEntryKey(entry);

        if (newState && entry[type]) {
            const effect = this.#getEntryTimedEffect(type, entry, false);
            this.#chatMetadata.timedWorldInfo[type][key] = effect;
            console.log(`[WI] Setting ${type} entry ${key}: start=${effect.start}, end=${effect.end}, protected=${effect.protected}`);
        } else if (!newState) {
            delete this.#chatMetadata.timedWorldInfo[type][key];
            console.log(`[WI] Removing ${type} entry ${key}`);
        }
    }

    /**
     * 检查是否为有效的效果类型
     * @param {string} type 要检查的类型
     * @returns {boolean} 是否有效
     */
    isValidEffectType(type) {
        return Object.values(TIMED_EFFECT_TYPE).includes(type);
    }

    /**
     * 检查效果是否激活
     * @param {string} type 效果类型
     * @param {object} entry 条目
     * @returns {boolean} 效果是否激活
     */
    isEffectActive(type, entry) {
        if (!this.isValidEffectType(type)) {
            return false;
        }

        // 延迟效果有特殊处理
        if (type === TIMED_EFFECT_TYPE.DELAY) {
            return this.#buffer.delay.includes(entry);
        }

        return this.#buffer[type].includes(entry);
    }

    /**
     * 清理资源
     */
    cleanUp() {
        // 在这里进行必要的清理
        this.#buffer = {
            [TIMED_EFFECT_TYPE.STICKY]: [],
            [TIMED_EFFECT_TYPE.COOLDOWN]: [],
            [TIMED_EFFECT_TYPE.DELAY]: [],
        };
    }

    /**
     * 获取聊天元数据的引用（用于外部更新）
     * @returns {object} 聊天元数据对象
     */
    getChatMetadata() {
        return this.#chatMetadata;
    }

    /**
     * 获取所有激活的效果
     * @returns {object} 包含所有效果类型的激活条目
     */
    getActiveEffects() {
        return {
            sticky: [...this.#buffer.sticky],
            cooldown: [...this.#buffer.cooldown],
            delay: [...this.#buffer.delay],
        };
    }
}

export default WorldInfoTimedEffects;
