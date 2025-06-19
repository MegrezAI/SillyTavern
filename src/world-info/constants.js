/**
 * SillyTavern World Info Backend Module - Constants
 * 世界书后端模块 - 常量定义
 */

// 扫描状态枚举
const SCAN_STATE = {
    NONE: 0,
    INITIAL: 1,
    RECURSION: 2,
    MIN_ACTIVATIONS: 3,
};

// 世界书插入策略
const WORLD_INFO_INSERTION_STRATEGY = {
    EVENLY: 0,
    CHARACTER_FIRST: 1,
    GLOBAL_FIRST: 2,
};

// 时间效果类型
const TIMED_EFFECT_TYPE = {
    STICKY: 'sticky',
    COOLDOWN: 'cooldown',
    DELAY: 'delay',
};

// 已知装饰器列表
const KNOWN_DECORATORS = [
    '@@activate',
    '@@dont_activate',
];

// 扫描深度限制
const MAX_SCAN_DEPTH = 1000;

// 默认配置值
const DEFAULT_WORLD_INFO_SETTINGS = {
    world_info_depth: 4,
    world_info_min_activations: 0,
    world_info_min_activations_depth_max: 0,
    world_info_budget: 25,
    world_info_include_names: true,
    world_info_recursive: false,
    world_info_overflow_alert: false,
    world_info_case_sensitive: false,
    world_info_match_whole_words: false,
    world_info_character_strategy: WORLD_INFO_INSERTION_STRATEGY.EVENLY,
    world_info_budget_cap: 0,
    world_info_use_group_scoring: false,
    world_info_max_recursion_steps: 0,
};

// 世界书位置
const WI_POSITION = {
    BEFORE: 0,
    AFTER: 1,
    AT_DEPTH: 2,
    AN_TOP: 3,
    AN_BOTTOM: 4,
    TOP: 5,
    BOTTOM: 6,
    AS_EXAMPLES: 7,
};

// 世界书选择性逻辑常量
const WORLD_INFO_LOGIC = {
    AND_ANY: 0,
    NOT_ALL: 1,
    NOT_ANY: 2,
    AND_ALL: 3,
};

// 元数据键
const METADATA_KEY = 'world_info';

// 默认权重值
const DEFAULT_DEPTH = 4;
const DEFAULT_WEIGHT = 100;

// 文件扩展名
const LOREBOOK_EXTENSIONS = ['.json', '.lorebook'];

// 导出所有常量
export {
    SCAN_STATE,
    WORLD_INFO_INSERTION_STRATEGY,
    TIMED_EFFECT_TYPE,
    KNOWN_DECORATORS,
    MAX_SCAN_DEPTH,
    DEFAULT_WORLD_INFO_SETTINGS,
    WI_POSITION,
    WORLD_INFO_LOGIC,
    METADATA_KEY,
    DEFAULT_DEPTH,
    DEFAULT_WEIGHT,
    LOREBOOK_EXTENSIONS,
};
