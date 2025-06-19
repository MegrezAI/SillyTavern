/**
 * SillyTavern World Info Backend Module - Utilities
 * 世界书后端模块 - 工具函数
 */

import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';

import { sync as writeFileAtomicSync } from 'write-file-atomic';
import tiktoken from 'tiktoken';
import { Tokenizer } from '@agnai/web-tokenizers';
import { SentencePieceProcessor } from '@agnai/sentencepiece-js';

import { convertClaudePrompt } from '../prompt-converters.js';
import { getConfigValue, isValidUrl } from '../util.js';

// 常量定义
const CHARS_PER_TOKEN = 3.35;
const IS_DOWNLOAD_ALLOWED = getConfigValue('enableDownloadableTokenizers', true, 'boolean');

/**
 * @type {{[key: string]: import('tiktoken').Tiktoken}} Tokenizers cache
 */
const tokenizersCache = {};

/**
 * @type {string[]}
 */
const TEXT_COMPLETION_MODELS = [
    'gpt-3.5-turbo-instruct',
    'gpt-3.5-turbo-instruct-0914',
    'text-davinci-003',
    'text-davinci-002',
    'text-davinci-001',
    'text-curie-001',
    'text-babbage-001',
    'text-ada-001',
    'code-davinci-002',
    'code-davinci-001',
    'code-cushman-002',
    'code-cushman-001',
    'text-davinci-edit-001',
    'code-davinci-edit-001',
    'text-embedding-ada-002',
    'text-similarity-davinci-001',
    'text-similarity-curie-001',
    'text-similarity-babbage-001',
    'text-similarity-ada-001',
    'text-search-davinci-doc-001',
    'text-search-curie-doc-001',
    'text-search-babbage-doc-001',
    'text-search-ada-doc-001',
    'code-search-babbage-code-001',
    'code-search-ada-code-001',
];

/**
 * Gets a path to the tokenizer model. Downloads the model if it's a URL.
 * @param {string} model Model URL or path
 * @param {string|undefined} fallbackModel Fallback model path
 * @returns {Promise<string>} Path to the tokenizer model
 */
async function getPathToTokenizer(model, fallbackModel) {
    if (!isValidUrl(model)) {
        return model;
    }

    try {
        const url = new URL(model);

        if (!['https:', 'http:'].includes(url.protocol)) {
            throw new Error('Invalid URL protocol');
        }

        const fileName = url.pathname.split('/').pop();

        if (!fileName) {
            throw new Error('Failed to extract the file name from the URL');
        }

        const CACHE_PATH = path.join(globalThis.DATA_ROOT, '_cache');
        if (!fs.existsSync(CACHE_PATH)) {
            fs.mkdirSync(CACHE_PATH, { recursive: true });
        }

        const cachedFile = path.join(CACHE_PATH, fileName);
        if (fs.existsSync(cachedFile)) {
            return cachedFile;
        }

        if (!IS_DOWNLOAD_ALLOWED) {
            throw new Error('Downloading tokenizers is disabled, the model is not cached');
        }

        console.info('Downloading tokenizer model:', model);
        const response = await fetch(model);
        if (!response.ok) {
            throw new Error(`Failed to fetch the model: ${response.status} ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        writeFileAtomicSync(cachedFile, Buffer.from(arrayBuffer));
        return cachedFile;
    } catch (error) {
        const getLastSegment = str => str?.split('/')?.pop() || '';
        if (fallbackModel) {
            console.error(`Could not get a tokenizer from ${getLastSegment(model)}. Reason: ${error.message}. Using a fallback model: ${getLastSegment(fallbackModel)}.`);
            return fallbackModel;
        }

        throw new Error(`Failed to instantiate a tokenizer and fallback is not provided. Reason: ${error.message}`);
    }
}

/**
 * Sentencepiece tokenizer for tokenizing text.
 */
class SentencePieceTokenizer {
    /**
     * @type {import('@agnai/sentencepiece-js').SentencePieceProcessor} Sentencepiece tokenizer instance
     */
    #instance;
    /**
     * @type {string} Path to the tokenizer model
     */
    #model;
    /**
     * @type {string|undefined} Path to the fallback model
     */
    #fallbackModel;

    /**
     * Creates a new Sentencepiece tokenizer.
     * @param {string} model Path to the tokenizer model
     * @param {string} [fallbackModel] Path to the fallback model
     */
    constructor(model, fallbackModel) {
        this.#model = model;
        this.#fallbackModel = fallbackModel;
    }

    /**
     * Gets the Sentencepiece tokenizer instance.
     * @returns {Promise<import('@agnai/sentencepiece-js').SentencePieceProcessor|null>} Sentencepiece tokenizer instance
     */
    async get() {
        if (this.#instance) {
            return this.#instance;
        }

        try {
            const pathToModel = await getPathToTokenizer(this.#model, this.#fallbackModel);
            this.#instance = new SentencePieceProcessor();
            await this.#instance.load(pathToModel);
            console.info('Instantiated the tokenizer for', path.parse(pathToModel).name);
            return this.#instance;
        } catch (error) {
            console.error('Sentencepiece tokenizer failed to load: ' + this.#model, error);
            return null;
        }
    }
}

/**
 * Web tokenizer for tokenizing text.
 */
class WebTokenizer {
    /**
     * @type {Tokenizer} Web tokenizer instance
     */
    #instance;
    /**
     * @type {string} Path to the tokenizer model
     */
    #model;
    /**
     * @type {string|undefined} Path to the fallback model
     */
    #fallbackModel;

    /**
     * Creates a new Web tokenizer.
     * @param {string} model Path to the tokenizer model
     * @param {string} [fallbackModel] Path to the fallback model
     */
    constructor(model, fallbackModel) {
        this.#model = model;
        this.#fallbackModel = fallbackModel;
    }

    /**
     * Gets the Web tokenizer instance.
     * @returns {Promise<Tokenizer|null>} Web tokenizer instance
     */
    async get() {
        if (this.#instance) {
            return this.#instance;
        }

        try {
            const pathToModel = await getPathToTokenizer(this.#model, this.#fallbackModel);
            const arrayBuffer = fs.readFileSync(pathToModel).buffer;
            this.#instance = await Tokenizer.fromJSON(arrayBuffer);
            console.info('Instantiated the tokenizer for', path.parse(pathToModel).name);
            return this.#instance;
        } catch (error) {
            console.error('Web tokenizer failed to load: ' + this.#model, error);
            return null;
        }
    }
}

// Tokenizer实例
const spp_llama = new SentencePieceTokenizer('src/tokenizers/llama.model');
const spp_nerd = new SentencePieceTokenizer('src/tokenizers/nerdstash.model');
const spp_nerd_v2 = new SentencePieceTokenizer('src/tokenizers/nerdstash_v2.model');
const spp_mistral = new SentencePieceTokenizer('src/tokenizers/mistral.model');
const spp_yi = new SentencePieceTokenizer('src/tokenizers/yi.model');
const spp_gemma = new SentencePieceTokenizer('src/tokenizers/gemma.model');
const spp_jamba = new SentencePieceTokenizer('src/tokenizers/jamba.model');
const claude_tokenizer = new WebTokenizer('src/tokenizers/claude.json');
const llama3_tokenizer = new WebTokenizer('src/tokenizers/llama3.json');
const commandRTokenizer = new WebTokenizer('https://github.com/SillyTavern/SillyTavern-Tokenizers/raw/main/command-r.json', 'src/tokenizers/llama3.json');
const commandATokenizer = new WebTokenizer('https://github.com/SillyTavern/SillyTavern-Tokenizers/raw/main/command-a.json', 'src/tokenizers/llama3.json');
const qwen2Tokenizer = new WebTokenizer('https://github.com/SillyTavern/SillyTavern-Tokenizers/raw/main/qwen2.json', 'src/tokenizers/llama3.json');
const nemoTokenizer = new WebTokenizer('https://github.com/SillyTavern/SillyTavern-Tokenizers/raw/main/nemo.json', 'src/tokenizers/llama3.json');
const deepseekTokenizer = new WebTokenizer('https://github.com/SillyTavern/SillyTavern-Tokenizers/raw/main/deepseek.json', 'src/tokenizers/llama3.json');

/**
 * Gets the tokenizer model by the model name.
 * @param {string} requestModel Models to use for tokenization
 * @returns {string} Tokenizer model to use
 */
function getTokenizerModel(requestModel) {
    if (requestModel === 'o1' || requestModel.includes('o1-preview') || requestModel.includes('o1-mini') || requestModel.includes('o3-mini')) {
        return 'o1';
    }

    if (requestModel.includes('o3') || requestModel.includes('o4-mini')) {
        return 'o1';
    }

    if (requestModel.includes('gpt-4o') || requestModel.includes('chatgpt-4o-latest')) {
        return 'gpt-4o';
    }

    if (requestModel.includes('gpt-4.1') || requestModel.includes('gpt-4.5')) {
        return 'gpt-4o';
    }

    if (requestModel.includes('gpt-4-32k')) {
        return 'gpt-4-32k';
    }

    if (requestModel.includes('gpt-4')) {
        return 'gpt-4';
    }

    if (requestModel.includes('gpt-3.5-turbo-0301')) {
        return 'gpt-3.5-turbo-0301';
    }

    if (requestModel.includes('gpt-3.5-turbo')) {
        return 'gpt-3.5-turbo';
    }

    if (TEXT_COMPLETION_MODELS.includes(requestModel)) {
        return requestModel;
    }

    if (requestModel.includes('claude')) {
        return 'claude';
    }

    if (requestModel.includes('llama3') || requestModel.includes('llama-3')) {
        return 'llama3';
    }

    if (requestModel.includes('llama')) {
        return 'llama';
    }

    if (requestModel.includes('mistral')) {
        return 'mistral';
    }

    if (requestModel.includes('yi')) {
        return 'yi';
    }

    if (requestModel.includes('deepseek')) {
        return 'deepseek';
    }

    if (requestModel.includes('gemma') || requestModel.includes('gemini') || requestModel.includes('learnlm')) {
        return 'gemma';
    }

    if (requestModel.includes('jamba')) {
        return 'jamba';
    }

    if (requestModel.includes('qwen2')) {
        return 'qwen2';
    }

    if (requestModel.includes('command-r')) {
        return 'command-r';
    }

    if (requestModel.includes('command-a')) {
        return 'command-a';
    }

    if (requestModel.includes('nemo')) {
        return 'nemo';
    }

    // default
    return 'gpt-3.5-turbo';
}

/**
 * Gets the Tiktoken tokenizer.
 * @param {any} model Model name
 * @returns {import('tiktoken').Tiktoken} Tiktoken tokenizer
 */
function getTiktokenTokenizer(model) {
    if (tokenizersCache[model]) {
        return tokenizersCache[model];
    }

    const tokenizer = tiktoken.encoding_for_model(model);
    console.info('Instantiated the tokenizer for', model);
    tokenizersCache[model] = tokenizer;
    return tokenizer;
}

/**
 * Counts the tokens for the given messages using the WebTokenizer and Claude prompt conversion.
 * @param {Tokenizer} tokenizer Web tokenizer
 * @param {object[]} messages Array of messages
 * @returns {number} Number of tokens
 */
function countWebTokenizerTokens(tokenizer, messages) {
    // Should be fine if we use the old conversion method instead of the messages API one i think?
    const convertedPrompt = convertClaudePrompt(messages, false, '', false, false, '', false);

    // Fallback to strlen estimation
    if (!tokenizer) {
        return Math.ceil(convertedPrompt.length / CHARS_PER_TOKEN);
    }

    const count = tokenizer.encode(convertedPrompt).length;
    return count;
}

/**
 * Gets the Sentencepiece tokenizer by the model name.
 * @param {string} model Sentencepiece model name
 * @returns {SentencePieceTokenizer|null} Sentencepiece tokenizer
 */
function getSentencepiceTokenizer(model) {
    if (model.includes('llama')) {
        return spp_llama;
    }

    if (model.includes('nerdstash')) {
        return spp_nerd;
    }

    if (model.includes('mistral')) {
        return spp_mistral;
    }

    if (model.includes('nerdstash_v2')) {
        return spp_nerd_v2;
    }

    if (model.includes('yi')) {
        return spp_yi;
    }

    if (model.includes('gemma')) {
        return spp_gemma;
    }

    if (model.includes('jamba')) {
        return spp_jamba;
    }

    return null;
}

/**
 * Gets the Web tokenizer by the model name.
 * @param {string} model Web tokenizer model name
 * @returns {WebTokenizer|null} Web tokenizer
 */
function getWebTokenizer(model) {
    if (model.includes('llama3')) {
        return llama3_tokenizer;
    }

    if (model.includes('claude')) {
        return claude_tokenizer;
    }

    if (model.includes('command-r')) {
        return commandRTokenizer;
    }

    if (model.includes('command-a')) {
        return commandATokenizer;
    }

    if (model.includes('qwen2')) {
        return qwen2Tokenizer;
    }

    if (model.includes('nemo')) {
        return nemoTokenizer;
    }

    if (model.includes('deepseek')) {
        return deepseekTokenizer;
    }

    return null;
}

/**
 * 转义正则表达式特殊字符
 * @param {string} text 要转义的文本
 * @returns {string} 转义后的文本
 */
function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 检查是否为有效的正则表达式
 * @param {string} input 输入字符串
 * @returns {boolean} 是否为有效正则表达式
 */
function isValidRegex(input) {
    try {
        new RegExp(input);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * 从字符串中解析正则表达式
 * @param {string} input 输入字符串，可能包含正则表达式
 * @returns {RegExp|null} 解析后的正则表达式对象，如果不是正则则返回null
 */
function parseRegexFromString(input) {
    if (!input || typeof input !== 'string') {
        return null;
    }

    // 检查是否为正则表达式格式 /pattern/flags
    const match = input.match(/^\/(.+)\/([gimsuxy]*)$/);
    if (match) {
        try {
            return new RegExp(match[1], match[2]);
        } catch (e) {
            console.warn('[WI] Invalid regex pattern:', input, e.message);
            return null;
        }
    }

    return null;
}

/**
 * 计算字符串的哈希值
 * @param {string} str 输入字符串
 * @returns {number} 哈希值
 */
function getStringHash(str) {
    if (!str || typeof str !== 'string') {
        return 0;
    }

    // 使用简单的哈希算法，与前端保持一致
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // 转换为32位整数
    }
    return Math.abs(hash);
}

/**
 * 安全解析JSON字符串
 * @param {string} str JSON字符串
 * @returns {any} 解析后的对象，失败返回null
 */
function tryParse(str) {
    try {
        return JSON.parse(str);
    } catch (e) {
        return null;
    }
}

/**
 * 分割关键词和正则表达式
 * @param {string} input 输入字符串
 * @returns {string[]} 分割后的数组
 */
function splitKeywordsAndRegexes(input) {
    if (!input || typeof input !== 'string') {
        return [];
    }

    // 按逗号分割，但保留正则表达式的完整性
    const parts = [];
    let current = '';
    let inRegex = false;
    // let depth = 0; // 暂时不需要，可能用于将来的嵌套处理

    for (let i = 0; i < input.length; i++) {
        const char = input[i];

        if (char === '/' && !inRegex) {
            inRegex = true;
            current += char;
        } else if (char === '/' && inRegex && input[i - 1] !== '\\') {
            inRegex = false;
            current += char;
            // 跳过可能的修饰符
            while (i + 1 < input.length && /[gimsuxy]/.test(input[i + 1])) {
                i++;
                current += input[i];
            }
        } else if (char === ',' && !inRegex) {
            if (current.trim()) {
                parts.push(current.trim());
            }
            current = '';
        } else {
            current += char;
        }
    }

    if (current.trim()) {
        parts.push(current.trim());
    }

    return parts;
}

/**
 * 解析装饰器
 * @param {string} content 世界书条目内容
 * @returns {[string[], string]} 返回 [装饰器数组, 清理后的内容]
 */
function parseDecorators(content) {
    const KNOWN_DECORATORS = ['@@activate', '@@dont_activate'];

    /**
     * 检查装饰器是否已知
     * @param {string} data 装饰器字符串
     * @returns {boolean} 是否为已知装饰器
     */
    const isKnownDecorator = (data) => {
        if (data.startsWith('@@@')) {
            data = data.substring(1);
        }

        for (let i = 0; i < KNOWN_DECORATORS.length; i++) {
            if (data.startsWith(KNOWN_DECORATORS[i])) {
                return true;
            }
        }
        return false;
    };

    if (!content || !content.startsWith('@@')) {
        return [[], content || ''];
    }

    let newContent = content;
    const splited = content.split('\n');
    let decorators = [];
    let fallbacked = false;

    for (let i = 0; i < splited.length; i++) {
        if (splited[i].startsWith('@@')) {
            if (splited[i].startsWith('@@@') && !fallbacked) {
                continue;
            }

            if (isKnownDecorator(splited[i])) {
                decorators.push(splited[i].startsWith('@@@') ? splited[i].substring(1) : splited[i]);
                fallbacked = false;
            } else {
                fallbacked = true;
            }
        } else {
            newContent = splited.slice(i).join('\n');
            break;
        }
    }
    return [decorators, newContent];
}

/**
 * 替换参数占位符（简化版本）
 * @param {string} content 包含占位符的内容
 * @param {object} params 参数对象
 * @returns {string} 替换后的内容
 */
function substituteParams(content, params = {}) {
    if (!content || typeof content !== 'string') {
        return content || '';
    }

    // 简单的参数替换，可以根据需要扩展
    let result = content;

    // 替换常见的占位符
    if (params.char) {
        result = result.replace(/\{\{char\}\}/gi, params.char);
    }
    if (params.user) {
        result = result.replace(/\{\{user\}\}/gi, params.user);
    }

    return result;
}

/**
 * 检查文件扩展名是否为lorebook格式
 * @param {string} filename 文件名
 * @returns {boolean} 是否为lorebook文件
 */
function isLorebookFile(filename) {
    if (!filename || typeof filename !== 'string') {
        return false;
    }

    const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    return ['.json', '.lorebook'].includes(ext);
}

/**
 * 安全的对象深度克隆
 * @param {any} obj 要克隆的对象
 * @returns {any} 克隆后的对象
 */
function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }

    if (obj instanceof Date) {
        return new Date(obj.getTime());
    }

    if (obj instanceof Array) {
        return obj.map(item => deepClone(item));
    }

    if (typeof obj === 'object') {
        const cloned = {};
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                cloned[key] = deepClone(obj[key]);
            }
        }
        return cloned;
    }

    return obj;
}

/**
 * 获取安全的字符名（用于文件名等）
 * @param {string} name 原始名称
 * @returns {string} 安全的名称
 */
function sanitize(name) {
    if (!name || typeof name !== 'string') {
        return '';
    }

    // 移除或替换不安全的字符
    return name.replace(/[<>:"/\\|?*]/g, '_').trim();
}

/**
 * 计算文本的token数量 - 完整复刻/openai/count的实现
 * @param {string|object[]|object} input 要计算的文本或消息数组
 * @param {string} model 模型名称（用于选择tokenizer）
 * @returns {Promise<number>} token数量
 */
async function getTokenCount(input, model = '') {
    try {
        // 如果输入为空，返回0
        if (!input) {
            return 0;
        }

        // 统一转换为消息数组格式
        let messageArray;
        if (typeof input === 'string') {
            messageArray = [{ role: 'user', content: input }];
        } else if (Array.isArray(input)) {
            messageArray = input;
        } else if (typeof input === 'object') {
            messageArray = [input];
        } else {
            return 0;
        }

        let num_tokens = 0;
        const queryModel = String(model || '');
        const tokenizerModel = getTokenizerModel(queryModel);

        // Claude tokenizer
        if (tokenizerModel === 'claude') {
            const claudeTokenizer = getWebTokenizer('claude');
            const instance = await claudeTokenizer?.get();
            if (instance) {
                num_tokens = countWebTokenizerTokens(instance, messageArray);
                return num_tokens;
            }
            throw new Error('Failed to load the Claude tokenizer');
        }

        // Llama3 tokenizer
        if (tokenizerModel === 'llama3' || tokenizerModel === 'llama-3') {
            const llama3Tokenizer = getWebTokenizer('llama3');
            const instance = await llama3Tokenizer?.get();
            if (instance) {
                num_tokens = countWebTokenizerTokens(instance, messageArray);
                return num_tokens;
            }
            throw new Error('Failed to load the Llama3 tokenizer');
        }

        // Sentencepiece tokenizers
        if (tokenizerModel === 'llama') {
            const llamaTokenizer = getSentencepiceTokenizer('llama');
            const jsonBody = messageArray.flatMap(x => Object.values(x)).join('\n\n');
            const result = await countSentencepieceTokens(llamaTokenizer, jsonBody);
            return result.count;
        }

        if (tokenizerModel === 'mistral') {
            const mistralTokenizer = getSentencepiceTokenizer('mistral');
            const jsonBody = messageArray.flatMap(x => Object.values(x)).join('\n\n');
            const result = await countSentencepieceTokens(mistralTokenizer, jsonBody);
            return result.count;
        }

        if (tokenizerModel === 'yi') {
            const yiTokenizer = getSentencepiceTokenizer('yi');
            const jsonBody = messageArray.flatMap(x => Object.values(x)).join('\n\n');
            const result = await countSentencepieceTokens(yiTokenizer, jsonBody);
            return result.count;
        }

        if (tokenizerModel === 'gemma' || tokenizerModel === 'gemini') {
            const gemmaTokenizer = getSentencepiceTokenizer('gemma');
            const jsonBody = messageArray.flatMap(x => Object.values(x)).join('\n\n');
            const result = await countSentencepieceTokens(gemmaTokenizer, jsonBody);
            return result.count;
        }

        if (tokenizerModel === 'jamba') {
            const jambaTokenizer = getSentencepiceTokenizer('jamba');
            const jsonBody = messageArray.flatMap(x => Object.values(x)).join('\n\n');
            const result = await countSentencepieceTokens(jambaTokenizer, jsonBody);
            return result.count;
        }

        // Web tokenizers
        if (tokenizerModel === 'qwen2') {
            const qwen2Tokenizer = getWebTokenizer('qwen2');
            const instance = await qwen2Tokenizer?.get();
            if (instance) {
                num_tokens = countWebTokenizerTokens(instance, messageArray);
                return num_tokens;
            }
            throw new Error('Failed to load the Qwen2 tokenizer');
        }

        if (tokenizerModel === 'command-r') {
            const commandRTokenizer = getWebTokenizer('command-r');
            const instance = await commandRTokenizer?.get();
            if (instance) {
                num_tokens = countWebTokenizerTokens(instance, messageArray);
                return num_tokens;
            }
            throw new Error('Failed to load the Command-R tokenizer');
        }

        if (tokenizerModel === 'command-a') {
            const commandATokenizer = getWebTokenizer('command-a');
            const instance = await commandATokenizer?.get();
            if (instance) {
                num_tokens = countWebTokenizerTokens(instance, messageArray);
                return num_tokens;
            }
            throw new Error('Failed to load the Command-A tokenizer');
        }

        if (tokenizerModel === 'nemo') {
            const nemoTokenizer = getWebTokenizer('nemo');
            const instance = await nemoTokenizer?.get();
            if (instance) {
                num_tokens = countWebTokenizerTokens(instance, messageArray);
                return num_tokens;
            }
            throw new Error('Failed to load the Nemo tokenizer');
        }

        if (tokenizerModel === 'deepseek') {
            const deepseekTokenizer = getWebTokenizer('deepseek');
            const instance = await deepseekTokenizer?.get();
            if (instance) {
                num_tokens = countWebTokenizerTokens(instance, messageArray);
                return num_tokens;
            }
            throw new Error('Failed to load the DeepSeek tokenizer');
        }

        // Tiktoken tokenizers (OpenAI models)
        const tokensPerName = queryModel.includes('gpt-3.5-turbo-0301') ? -1 : 1;
        const tokensPerMessage = queryModel.includes('gpt-3.5-turbo-0301') ? 4 : 3;
        const tokensPadding = 3;

        const tokenizer = getTiktokenTokenizer(tokenizerModel);

        for (const msg of messageArray) {
            try {
                num_tokens += tokensPerMessage;
                for (const [key, value] of Object.entries(msg)) {
                    num_tokens += tokenizer.encode(String(value)).length;
                    if (key == 'name') {
                        num_tokens += tokensPerName;
                    }
                }
            } catch (error) {
                console.warn('[WI] Error tokenizing message:', msg, error);
            }
        }
        num_tokens += tokensPadding;

        // GPT-3.5 Turbo 0301的特殊处理
        if (queryModel.includes('gpt-3.5-turbo-0301')) {
            num_tokens += 9;
        }

        return num_tokens;

    } catch (error) {
        console.warn('[WI] Error counting tokens, using fallback estimation:', error);
        // 回退到字符长度估算
        const fallbackCharsPerToken = 3.35;

        let text = '';
        if (typeof input === 'string') {
            text = input;
        } else {
            text = JSON.stringify(input);
        }

        return Math.ceil(text.length / fallbackCharsPerToken);
    }
}

/**
 * 辅助函数：计算Sentencepiece tokens
 * @param {object} tokenizer Sentencepiece tokenizer实例
 * @param {string} text 要计算的文本
 * @returns {Promise<{ids: number[], count: number}>} 计算结果
 */
async function countSentencepieceTokens(tokenizer, text) {
    const instance = await tokenizer?.get();

    // 回退到字符长度估算
    if (!instance) {
        return {
            ids: [],
            count: Math.ceil(text.length / CHARS_PER_TOKEN),
        };
    }

    let cleaned = text; // 不清理文本以避免错误的token化
    let ids = instance.encodeIds(cleaned);
    return {
        ids,
        count: ids.length,
    };
}

export {
    escapeRegex,
    isValidRegex,
    parseRegexFromString,
    getStringHash,
    tryParse,
    splitKeywordsAndRegexes,
    parseDecorators,
    substituteParams,
    isLorebookFile,
    deepClone,
    sanitize,
    getTokenCount,
};
